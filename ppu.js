// ============================================================
//  SNES PPU CORRUPTION ENGINE
//  A generative art piece that simulates the Super Nintendo's
//  Picture Processing Unit and then breaks it beautifully.
//
//  This is NOT a toy approximation — it models real SNES
//  hardware concepts: bitplane-encoded tiles in VRAM,
//  tilemaps with flip/priority/palette bits, 15-bit BGR
//  palettes (CGRAM), Mode 7 affine transforms, HDMA
//  scanline register writes, mosaic filtering, color math,
//  and OAM sprites. Then it corrupts all of them.
// ============================================================

// Global scope — engine.js extends this

// --- SNES constants (W/H are mutable for fullscreen extended rendering) ---
let SCREEN_W = 256;
let SCREEN_H = 224;
const SNES_W = 256; // native SNES width (for reference)
const SNES_H = 224; // native SNES height
const TILE_SIZE = 8;
let TILES_PER_ROW = SCREEN_W / TILE_SIZE; // 32
let TILES_PER_COL = SCREEN_H / TILE_SIZE; // 28
const VRAM_SIZE = 0x10000;   // 64KB VRAM (word-addressed, but we use bytes)
const CGRAM_SIZE = 512;       // 256 colors × 2 bytes (15-bit BGR)
const OAM_SIZE = 544;         // 128 sprites × 4 bytes + 32 bytes high table
const TILEMAP_SIZE = 0x800;   // 2KB per tilemap (32×32 entries × 2 bytes)

// --- Canvas setup ---
const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
let imgData = ctx.createImageData(SCREEN_W, SCREEN_H);
let fb = new Uint32Array(imgData.data.buffer); // framebuffer as packed RGBA
const ui = document.getElementById("ui");

// --- Resize the PPU framebuffer (called by engine.js for fullscreen) ---
function resizePPU(w, h) {
  SCREEN_W = w;
  SCREEN_H = h;
  TILES_PER_ROW = Math.ceil(w / TILE_SIZE);
  TILES_PER_COL = Math.ceil(h / TILE_SIZE);
  canvas.width = w;
  canvas.height = h;
  imgData = ctx.createImageData(w, h);
  fb = new Uint32Array(imgData.data.buffer);
  reallocScanlineBuffers();
}

// --- PPU State ---
// All memory as typed arrays to mirror real hardware
const VRAM = new Uint8Array(VRAM_SIZE);
const CGRAM = new Uint8Array(CGRAM_SIZE);
const OAM = new Uint8Array(OAM_SIZE);

// BG scroll registers
const bgScrollX = new Int16Array(4);
const bgScrollY = new Int16Array(4);

// BG tilemap base addresses (VRAM word address << 1 for byte address)
const bgTilemapAddr = new Uint16Array(4);
// BG character (tile) base addresses
const bgCharAddr = new Uint16Array(4);
// BG enable flags
const bgEnabled = [true, true, false, false];

// Mode 7 matrix (a, b, c, d are 1.7.8 fixed point on real HW, we use floats)
let m7a = 1.0, m7b = 0.0, m7c = 0.0, m7d = 1.0;
let m7x = 128, m7y = 112; // center of rotation
let m7hofs = 0, m7vofs = 0;

// HDMA tables — array of {startScanline, register, values[]}
let hdmaEffects = [];

// Mosaic
let mosaicSize = 1; // 1 = off, 2-16 = mosaic block size
let mosaicEnabled = [false, false, false, false];

// Color math
let colorMathMode = 0; // 0=off, 1=add, 2=sub, 3=avg
let fixedColor = { r: 0, g: 0, b: 0 };
let colorMathBG = [false, false, false, false]; // which BGs affected

// PPU mode (0-7)
let ppuMode = 1;

// Glitch state
let glitchIntensity = 0.0; // 0-1, drives how aggressively we corrupt
let glitchMode = 0; // which glitch family is active
let frozen = false;
let frameCount = 0;
let lastGlitchBurst = 0;
let autoGlitch = true;

// --- 15-bit SNES color conversion ---
// PERF: snesColorToRGB now returns packed RGBA uint32 (no object allocation)
function snesColorToRGB(lo, hi) {
  const w = lo | (hi << 8);
  const r = (w & 0x1F) << 3;
  const g = ((w >> 5) & 0x1F) << 3;
  const b = ((w >> 10) & 0x1F) << 3;
  return 0xFF000000 | (b << 16) | (g << 8) | r;
}

function rgbToSnesColor(r, g, b) {
  const sr = (r >> 3) & 0x1F;
  const sg = (g >> 3) & 0x1F;
  const sb = (b >> 3) & 0x1F;
  return sr | (sg << 5) | (sb << 10);
}

function packRGBA(r, g, b, a = 255) {
  return (a << 24) | (b << 16) | (g << 8) | r;
}

// --- CGRAM cache: pre-computed packed RGBA for each palette entry ---
// Rebuilt once per frame — avoids per-pixel snesColorToRGB calls
const cgramCache = new Uint32Array(256);

function rebuildCGRAMCache() {
  for (let i = 0; i < 256; i++) {
    const lo = CGRAM[i * 2];
    const hi = CGRAM[i * 2 + 1];
    const w = lo | (hi << 8);
    const r = (w & 0x1F) << 3;
    const g = ((w >> 5) & 0x1F) << 3;
    const b = ((w >> 10) & 0x1F) << 3;
    cgramCache[i] = 0xFF000000 | (b << 16) | (g << 8) | r;
  }
}

// Pre-allocated scanline buffers — reused every scanline, zero GC pressure
let _lineBuffer = new Uint32Array(1024);
let _priorityBuffer = new Int8Array(1024);

function reallocScanlineBuffers() {
  if (_lineBuffer.length < SCREEN_W) {
    _lineBuffer = new Uint32Array(SCREEN_W + 64);
    _priorityBuffer = new Int8Array(SCREEN_W + 64);
  }
}

// --- Initialize VRAM with tile patterns ---
function generateTileData() {
  // Generate 256 tiles in 4bpp SNES format at VRAM address 0x0000
  // 4bpp = 32 bytes per tile (8 rows × 2 bitplane pairs)
  for (let tile = 0; tile < 256; tile++) {
    const baseAddr = tile * 32;
    for (let row = 0; row < 8; row++) {
      // Generate interesting patterns per tile
      let pixels = new Uint8Array(8);
      for (let x = 0; x < 8; x++) {
        const patternType = (tile >> 4) & 0xF;
        const variant = tile & 0xF;
        let val = 0;
        switch (patternType) {
          case 0: // solid fills
            val = variant;
            break;
          case 1: // vertical stripes
            val = (x % (1 + (variant & 3))) === 0 ? variant : 0;
            break;
          case 2: // horizontal stripes
            val = (row % (1 + (variant & 3))) === 0 ? variant : 0;
            break;
          case 3: // diagonal
            val = ((x + row + variant) % 8 < 4) ? variant : 15 - variant;
            break;
          case 4: // checkerboard
            val = ((x ^ row) & (1 + (variant & 3))) ? variant : 0;
            break;
          case 5: // border/box
            val = (x === 0 || x === 7 || row === 0 || row === 7) ? variant : 0;
            break;
          case 6: // circle-ish
            val = (Math.abs(x - 3.5) + Math.abs(row - 3.5) < 3 + (variant & 3)) ? variant : 0;
            break;
          case 7: // noise seeded by tile index
            val = (((tile * 7 + row * 13 + x * 31) >>> 0) % 16);
            break;
          case 8: // gradient horizontal
            val = (x + variant) & 0xF;
            break;
          case 9: // gradient vertical
            val = (row + variant) & 0xF;
            break;
          case 10: // cross
            val = (x === 3 || x === 4 || row === 3 || row === 4) ? variant : 0;
            break;
          case 11: // diamond
            val = (Math.abs(x - 3.5) + Math.abs(row - 3.5) < 2 + variant * 0.3) ? variant : 15 - variant;
            break;
          case 12: // scattered dots
            val = ((x * 3 + row * 7 + variant * 11) % 5 === 0) ? variant : 0;
            break;
          case 13: // zigzag
            val = (((row & 1) ? x : 7 - x) + variant) & 0xF;
            break;
          case 14: // arcs
            val = ((x * x + row * row + variant * 4) >> 2) & 0xF;
            break;
          case 15: // dithered
            val = ((x ^ row ^ variant) & 1) ? variant : 0;
            break;
        }
        pixels[x] = val & 0xF;
      }

      // Encode as SNES 4bpp bitplanes
      // Bitplane layout: rows interleaved
      // Bytes 0-15: bitplane 0,1 pairs (row0 bp0, row0 bp1, row1 bp0, ...)
      // Bytes 16-31: bitplane 2,3 pairs
      let bp0 = 0, bp1 = 0, bp2 = 0, bp3 = 0;
      for (let x = 0; x < 8; x++) {
        const bit = 7 - x;
        bp0 |= ((pixels[x] >> 0) & 1) << bit;
        bp1 |= ((pixels[x] >> 1) & 1) << bit;
        bp2 |= ((pixels[x] >> 2) & 1) << bit;
        bp3 |= ((pixels[x] >> 3) & 1) << bit;
      }
      VRAM[baseAddr + row * 2 + 0] = bp0;
      VRAM[baseAddr + row * 2 + 1] = bp1;
      VRAM[baseAddr + 16 + row * 2 + 0] = bp2;
      VRAM[baseAddr + 16 + row * 2 + 1] = bp3;
    }
  }
}

// --- Generate more tile data for BG2 ---
function generateBG2Tiles() {
  // Place a second set of tiles at 0x4000
  const base = 0x4000;
  for (let tile = 0; tile < 128; tile++) {
    for (let row = 0; row < 8; row++) {
      let bp0 = 0, bp1 = 0, bp2 = 0, bp3 = 0;
      for (let x = 0; x < 8; x++) {
        const bit = 7 - x;
        // Geometric patterns
        const v = Math.floor(Math.sin(tile * 0.3 + row * 0.7 + x * 0.5) * 7.5 + 7.5);
        bp0 |= ((v >> 0) & 1) << bit;
        bp1 |= ((v >> 1) & 1) << bit;
        bp2 |= ((v >> 2) & 1) << bit;
        bp3 |= ((v >> 3) & 1) << bit;
      }
      VRAM[base + tile * 32 + row * 2 + 0] = bp0;
      VRAM[base + tile * 32 + row * 2 + 1] = bp1;
      VRAM[base + tile * 32 + 16 + row * 2 + 0] = bp2;
      VRAM[base + tile * 32 + 16 + row * 2 + 1] = bp3;
    }
  }
}

// --- Initialize tilemaps ---
function generateTilemaps() {
  // BG1 tilemap at 0x8000
  bgTilemapAddr[0] = 0x8000;
  bgCharAddr[0] = 0x0000;
  for (let ty = 0; ty < 32; ty++) {
    for (let tx = 0; tx < 32; tx++) {
      const addr = 0x8000 + (ty * 32 + tx) * 2;
      const tileIdx = ((tx + ty * 3) ^ (tx * ty)) & 0xFF;
      const palette = (ty >> 2) & 7;
      const hFlip = ((tx ^ ty) & 4) ? 1 : 0;
      const vFlip = ((tx ^ ty) & 8) ? 1 : 0;
      // Tilemap entry: vhopppcc cccccccc
      // v=vflip, h=hflip, o=priority, p=palette, c=character
      const entry = tileIdx | (palette << 10) | (hFlip << 14) | (vFlip << 15);
      VRAM[addr] = entry & 0xFF;
      VRAM[addr + 1] = (entry >> 8) & 0xFF;
    }
  }

  // BG2 tilemap at 0x8800
  bgTilemapAddr[1] = 0x8800;
  bgCharAddr[1] = 0x4000;
  for (let ty = 0; ty < 32; ty++) {
    for (let tx = 0; tx < 32; tx++) {
      const addr = 0x8800 + (ty * 32 + tx) * 2;
      const tileIdx = ((tx * 5 + ty * 7) % 128);
      const palette = ((tx + ty) >> 1) & 7;
      const entry = tileIdx | (palette << 10);
      VRAM[addr] = entry & 0xFF;
      VRAM[addr + 1] = (entry >> 8) & 0xFF;
    }
  }

  // BG3 tilemap at 0x9000 (used in some modes)
  bgTilemapAddr[2] = 0x9000;
  bgCharAddr[2] = 0x0000;
  for (let ty = 0; ty < 32; ty++) {
    for (let tx = 0; tx < 32; tx++) {
      const addr = 0x9000 + (ty * 32 + tx) * 2;
      const tileIdx = (tx ^ ty) & 0xFF;
      VRAM[addr] = tileIdx;
      VRAM[addr + 1] = 0;
    }
  }

  bgTilemapAddr[3] = 0x9800;
  bgCharAddr[3] = 0x4000;
}

// --- Initialize palette (CGRAM) ---
function generatePalette() {
  // 8 palettes of 16 colors each for 4bpp mode
  for (let pal = 0; pal < 8; pal++) {
    for (let col = 0; col < 16; col++) {
      const idx = pal * 16 + col;
      let r, g, b;
      if (col === 0) {
        // Color 0 is transparent (use a deep dark blue as backdrop)
        r = 0; g = 0; b = 8;
      } else {
        // Generate distinct palettes inspired by SNES games
        const hue = (pal * 45 + col * 22) % 360;
        const sat = 0.6 + col * 0.025;
        const lum = 0.15 + col * 0.05;
        [r, g, b] = hslToRGB(hue, sat, lum);
      }
      const snesCol = rgbToSnesColor(r, g, b);
      CGRAM[idx * 2] = snesCol & 0xFF;
      CGRAM[idx * 2 + 1] = (snesCol >> 8) & 0xFF;
    }
  }
}

function hslToRGB(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
}

// --- Initialize OAM with some sprites ---
function generateOAM() {
  for (let i = 0; i < 128; i++) {
    const base = i * 4;
    OAM[base + 0] = Math.floor(Math.random() * SCREEN_W) & 0xFF; // X
    OAM[base + 1] = Math.floor(Math.random() * SCREEN_H) & 0xFF; // Y
    OAM[base + 2] = Math.floor(Math.random() * 256); // tile index
    // Byte 3: vhoopppc — vflip, hflip, priority(2), palette(3), tile bit9(unused for 4bpp we keep simple)
    OAM[base + 3] = Math.floor(Math.random() * 256);
  }
  // High table (size/x-bit9) — 32 bytes for 128 sprites, 2 bits each
  for (let i = 0; i < 32; i++) {
    OAM[512 + i] = Math.floor(Math.random() * 256);
  }
}

// --- Decode a 4bpp tile pixel from VRAM ---
function decodeTilePixel(charBase, tileIdx, px, py, hFlip, vFlip) {
  const tx = hFlip ? (7 - px) : px;
  const ty = vFlip ? (7 - py) : py;
  const addr = (charBase + tileIdx * 32) & 0xFFFF;
  const bp0 = (VRAM[(addr + ty * 2 + 0) & 0xFFFF] >> (7 - tx)) & 1;
  const bp1 = (VRAM[(addr + ty * 2 + 1) & 0xFFFF] >> (7 - tx)) & 1;
  const bp2 = (VRAM[(addr + 16 + ty * 2 + 0) & 0xFFFF] >> (7 - tx)) & 1;
  const bp3 = (VRAM[(addr + 16 + ty * 2 + 1) & 0xFFFF] >> (7 - tx)) & 1;
  return bp0 | (bp1 << 1) | (bp2 << 2) | (bp3 << 3);
}

// --- Get color from CGRAM (returns packed RGBA from cache) ---
function getCGRAMColor(paletteIdx, colorIdx) {
  return cgramCache[(paletteIdx * 16 + colorIdx) & 0xFF];
}

// --- Render a BG layer scanline ---
function renderBGScanline(bgIdx, scanline, lineBuffer, priorityBuffer) {
  if (!bgEnabled[bgIdx]) return;

  const tmBase = bgTilemapAddr[bgIdx];
  const chBase = bgCharAddr[bgIdx];
  const scrollX = bgScrollX[bgIdx];
  const scrollY = bgScrollY[bgIdx];

  for (let screenX = 0; screenX < SCREEN_W; screenX++) {
    const mapX = (screenX + scrollX) & 0xFF;
    const mapY = (scanline + scrollY) & 0xFF;
    const tileX = mapX >> 3;
    const tileY = mapY >> 3;
    const pixX = mapX & 7;
    const pixY = mapY & 7;

    const tmAddr = (tmBase + (tileY * 32 + tileX) * 2) & 0xFFFF;
    const lo = VRAM[tmAddr];
    const hi = VRAM[(tmAddr + 1) & 0xFFFF];
    const entry = lo | (hi << 8);

    const tileIdx = entry & 0x3FF;
    const palette = (entry >> 10) & 7;
    const priority = (entry >> 13) & 1;
    const hFlip = (entry >> 14) & 1;
    const vFlip = (entry >> 15) & 1;

    const colorIdx = decodeTilePixel(chBase, tileIdx, pixX, pixY, hFlip, vFlip);

    if (colorIdx !== 0) { // color 0 = transparent
      const layerPriority = bgIdx * 2 + priority;
      if (layerPriority >= priorityBuffer[screenX]) {
        const color = getCGRAMColor(palette, colorIdx);
        lineBuffer[screenX] = color;
        priorityBuffer[screenX] = layerPriority;
      }
    }
  }
}

// --- Render Mode 7 scanline ---
function renderMode7Scanline(scanline, lineBuffer, priorityBuffer) {
  // Mode 7 uses a single 128×128 tilemap of 8×8 tiles, each byte = tile index
  // Tile data is interleaved with tilemap in VRAM (every other byte)
  // We simulate this with our existing VRAM

  const cy = m7y;
  const cx = m7x;

  // PERF: pre-check matrix sanity once per scanline, not per pixel
  if (!isFinite(m7a) || !isFinite(m7b) || !isFinite(m7c) || !isFinite(m7d)) return;

  // PERF: pre-compute row constants
  const sy = scanline - cy + m7vofs;
  const rowBaseX = m7b * sy + cx;
  const rowBaseY = m7d * sy + cy;

  for (let screenX = 0; screenX < SCREEN_W; screenX++) {
    const sx = screenX - cx + m7hofs;
    // PERF: use bitwise floor + AND wrap instead of Math.floor + modulo
    const texX = (rowBaseX + m7a * sx + 0x100000) & 0x3FF; // +offset to ensure positive before mask
    const texY = (rowBaseY + m7c * sx + 0x100000) & 0x3FF;

    // Get tile from mode 7 tilemap (128×128 tiles = 1024×1024 pixels)
    const tmx = (texX >> 3) & 127;
    const tmy = (texY >> 3) & 127;
    const tileIdx = VRAM[(tmy * 128 + tmx) & 0xFFFF]; // simplified

    const px = texX & 7;
    const py = texY & 7;

    // Mode 7 tiles are 8bpp but we'll use our 4bpp decode for artistic purposes
    const colorIdx = decodeTilePixel(0, tileIdx, px, py, false, false);

    if (colorIdx !== 0) {
      lineBuffer[screenX] = getCGRAMColor(0, colorIdx);
      priorityBuffer[screenX] = 10; // mode 7 = high priority
    }
  }
}

// --- Apply HDMA effects for a scanline ---
function applyHDMAEffects(scanline) {
  for (const effect of hdmaEffects) {
    if (scanline >= effect.startScanline &&
        scanline < effect.startScanline + effect.values.length) {
      const val = effect.values[scanline - effect.startScanline];
      switch (effect.register) {
        case "bgScrollX0": bgScrollX[0] = val; break;
        case "bgScrollY0": bgScrollY[0] = val; break;
        case "bgScrollX1": bgScrollX[1] = val; break;
        case "bgScrollY1": bgScrollY[1] = val; break;
        case "mosaic": mosaicSize = (val >> 4) + 1; break;
        case "colorMathR": fixedColor.r = val & 0x1F; break;
        case "colorMathG": fixedColor.g = val & 0x1F; break;
        case "colorMathB": fixedColor.b = val & 0x1F; break;
        case "m7a": m7a = val; break;
        case "m7b": m7b = val; break;
        case "m7c": m7c = val; break;
        case "m7d": m7d = val; break;
      }
    }
  }
}

// --- Apply mosaic to a scanline ---
function applyMosaic(lineBuffer) {
  if (mosaicSize <= 1) return;
  for (let x = 0; x < SCREEN_W; x++) {
    const blockX = x - (x % mosaicSize);
    lineBuffer[x] = lineBuffer[blockX];
  }
}

// --- Apply color math (packed uint32 in/out, no allocations) ---
function applyColorMath(packed) {
  if (colorMathMode === 0) return packed;
  let r = packed & 0xFF;
  let g = (packed >> 8) & 0xFF;
  let b = (packed >> 16) & 0xFF;
  const fr = fixedColor.r << 3;
  const fg = fixedColor.g << 3;
  const fbl = fixedColor.b << 3;
  switch (colorMathMode) {
    case 1: r += fr; g += fg; b += fbl; break;
    case 2: r -= fr; g -= fg; b -= fbl; break;
    case 3: r = (r + fr) >> 1; g = (g + fg) >> 1; b = (b + fbl) >> 1; break;
  }
  // Clamp using bitwise (no Math.min/max)
  r = r < 0 ? 0 : r > 255 ? 255 : r;
  g = g < 0 ? 0 : g > 255 ? 255 : g;
  b = b < 0 ? 0 : b > 255 ? 255 : b;
  return 0xFF000000 | (b << 16) | (g << 8) | r;
}

// --- Render a full frame (standalone fallback — engine.js overrides this) ---
function renderFrame() {
  rebuildCGRAMCache();
  reallocScanlineBuffers();
  const lineBuffer = _lineBuffer;
  const priorityBuffer = _priorityBuffer;
  const backdropColor = cgramCache[0];

  for (let scanline = 0; scanline < SCREEN_H; scanline++) {
    applyHDMAEffects(scanline);
    lineBuffer.fill(backdropColor, 0, SCREEN_W);
    priorityBuffer.fill(-1, 0, SCREEN_W);

    if (ppuMode === 7) {
      renderMode7Scanline(scanline, lineBuffer, priorityBuffer);
    } else {
      for (let bg = 3; bg >= 0; bg--) {
        renderBGScanline(bg, scanline, lineBuffer, priorityBuffer);
      }
    }

    applyMosaic(lineBuffer);

    const fbOffset = scanline * SCREEN_W;
    for (let x = 0; x < SCREEN_W; x++) {
      let px = lineBuffer[x];
      if (colorMathMode !== 0) px = applyColorMath(px);
      fb[fbOffset + x] = px;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// ============================================================
//  GLITCH ENGINE
//  These simulate real SNES hardware failures and exploits:
//  - DMA controller writing to wrong addresses
//  - Bus conflicts corrupting VRAM mid-transfer
//  - Palette DMA hitting CGRAM during rendering
//  - Mode register corruption
//  - HDMA table pointer corruption
//  - Stack overflow into OAM
//  - Bitplane interleave errors
// ============================================================

// Seeded PRNG for reproducible glitches
let glitchSeed = Date.now();
function glitchRand() {
  glitchSeed = (glitchSeed * 1664525 + 1013904223) & 0xFFFFFFFF;
  return (glitchSeed >>> 0) / 4294967296;
}
function glitchRandInt(max) {
  return Math.floor(glitchRand() * max);
}

// --- GLITCH: DMA misfire (copy wrong region of VRAM over tiles) ---
function glitchDMAMisfire() {
  const srcAddr = glitchRandInt(VRAM_SIZE);
  const dstAddr = glitchRandInt(0x8000); // tile data region
  const length = 16 + glitchRandInt(512);
  for (let i = 0; i < length; i++) {
    VRAM[(dstAddr + i) & 0xFFFF] = VRAM[(srcAddr + i) & 0xFFFF];
  }
}

// --- GLITCH: VRAM bit rot (flip random bits in tile data) ---
function glitchVRAMBitRot() {
  const count = 1 + glitchRandInt(Math.floor(64 * glitchIntensity + 1));
  for (let i = 0; i < count; i++) {
    const addr = glitchRandInt(VRAM_SIZE);
    const bit = glitchRandInt(8);
    VRAM[addr] ^= (1 << bit);
  }
}

// --- GLITCH: Palette corruption (shift CGRAM entries) ---
function glitchPaletteCorrupt() {
  const mode = glitchRandInt(5);
  switch (mode) {
    case 0: {
      // Rotate a palette
      const pal = glitchRandInt(8);
      const base = pal * 32;
      const saved = [CGRAM[base], CGRAM[base + 1]];
      for (let i = 0; i < 30; i++) {
        CGRAM[base + i] = CGRAM[base + i + 2];
      }
      CGRAM[base + 30] = saved[0];
      CGRAM[base + 31] = saved[1];
      break;
    }
    case 1: {
      // XOR a section of CGRAM
      const start = glitchRandInt(CGRAM_SIZE);
      const mask = glitchRandInt(256);
      for (let i = 0; i < 8 + glitchRandInt(24); i++) {
        CGRAM[(start + i) & 0x1FF] ^= mask;
      }
      break;
    }
    case 2: {
      // Copy one palette over another
      const src = glitchRandInt(8) * 32;
      const dst = glitchRandInt(8) * 32;
      for (let i = 0; i < 32; i++) {
        CGRAM[dst + i] = CGRAM[src + i];
      }
      break;
    }
    case 3: {
      // Channel shift — swap R/G/B components
      for (let i = 0; i < CGRAM_SIZE; i += 2) {
        const w = CGRAM[i] | (CGRAM[i + 1] << 8);
        const r = w & 0x1F;
        const g = (w >> 5) & 0x1F;
        const b = (w >> 10) & 0x1F;
        // Rotate channels
        const nw = g | (b << 5) | (r << 10);
        CGRAM[i] = nw & 0xFF;
        CGRAM[i + 1] = (nw >> 8) & 0xFF;
      }
      break;
    }
    case 4: {
      // Gradient flood — fill a palette with a smooth gradient
      const pal = glitchRandInt(8);
      const hue = glitchRand() * 360;
      for (let i = 0; i < 16; i++) {
        const [r, g, b] = hslToRGB((hue + i * 15) % 360, 0.8, 0.1 + i * 0.05);
        const sc = rgbToSnesColor(r, g, b);
        CGRAM[(pal * 16 + i) * 2] = sc & 0xFF;
        CGRAM[(pal * 16 + i) * 2 + 1] = (sc >> 8) & 0xFF;
      }
      break;
    }
  }
}

// --- GLITCH: Tilemap scramble (corrupt tilemap entries) ---
function glitchTilemapScramble() {
  const bgIdx = glitchRandInt(2);
  const tmBase = bgTilemapAddr[bgIdx];
  const mode = glitchRandInt(4);

  switch (mode) {
    case 0: {
      // Shift a row
      const row = glitchRandInt(32);
      const shift = 1 + glitchRandInt(5);
      const rowAddr = tmBase + row * 64;
      const saved = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        saved[i] = VRAM[(rowAddr + i) & 0xFFFF];
      }
      for (let i = 0; i < 64; i++) {
        VRAM[(rowAddr + i) & 0xFFFF] = saved[(i + shift * 2) % 64];
      }
      break;
    }
    case 1: {
      // Flip random entries
      const count = 4 + glitchRandInt(32);
      for (let i = 0; i < count; i++) {
        const addr = (tmBase + glitchRandInt(TILEMAP_SIZE)) & 0xFFFF;
        VRAM[(addr + 1) & 0xFFFF] ^= (0x40 | 0x80); // flip H and V flags
      }
      break;
    }
    case 2: {
      // Overwrite a rectangular region with incrementing tiles
      const sx = glitchRandInt(28);
      const sy = glitchRandInt(24);
      const w = 2 + glitchRandInt(8);
      const h = 2 + glitchRandInt(8);
      let tile = glitchRandInt(256);
      for (let y = sy; y < Math.min(sy + h, 32); y++) {
        for (let x = sx; x < Math.min(sx + w, 32); x++) {
          const addr = (tmBase + (y * 32 + x) * 2) & 0xFFFF;
          VRAM[addr] = tile & 0xFF;
          tile = (tile + 1) & 0xFF;
        }
      }
      break;
    }
    case 3: {
      // XOR the tilemap with a pattern
      const pattern = glitchRandInt(256);
      const startY = glitchRandInt(32);
      const height = 1 + glitchRandInt(8);
      for (let y = startY; y < Math.min(startY + height, 32); y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tmBase + (y * 32 + x) * 2) & 0xFFFF;
          VRAM[addr] ^= pattern;
        }
      }
      break;
    }
  }
}

// --- GLITCH: Mode 7 matrix corruption ---
function glitchMode7() {
  const mode = glitchRandInt(4);
  switch (mode) {
    case 0: // Slight rotation drift
      const angle = (glitchRand() - 0.5) * 0.3;
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const na = m7a * ca - m7c * sa;
      const nb = m7b * ca - m7d * sa;
      const nc = m7a * sa + m7c * ca;
      const nd = m7b * sa + m7d * ca;
      m7a = na; m7b = nb; m7c = nc; m7d = nd;
      break;
    case 1: // Scale corruption
      m7a *= 0.8 + glitchRand() * 0.4;
      m7d *= 0.8 + glitchRand() * 0.4;
      break;
    case 2: // Shear
      m7b += (glitchRand() - 0.5) * 0.5;
      m7c += (glitchRand() - 0.5) * 0.5;
      break;
    case 3: // Offset jump
      m7hofs += glitchRandInt(64) - 32;
      m7vofs += glitchRandInt(64) - 32;
      break;
  }
  // Clamp matrix values to prevent Infinity/NaN propagation
  const M7_MAX = 256;
  m7a = Math.max(-M7_MAX, Math.min(M7_MAX, m7a));
  m7b = Math.max(-M7_MAX, Math.min(M7_MAX, m7b));
  m7c = Math.max(-M7_MAX, Math.min(M7_MAX, m7c));
  m7d = Math.max(-M7_MAX, Math.min(M7_MAX, m7d));
  // Reset if NaN crept in
  if (isNaN(m7a) || isNaN(m7b) || isNaN(m7c) || isNaN(m7d)) {
    m7a = 1; m7b = 0; m7c = 0; m7d = 1;
  }
}

// --- GLITCH: HDMA table corruption ---
function glitchHDMA() {
  const mode = glitchRandInt(5);
  switch (mode) {
    case 0: {
      // Wavy scroll effect (like real SNES water effects, but broken)
      const values = [];
      const amp = 2 + glitchRand() * 30;
      const freq = 0.02 + glitchRand() * 0.3;
      const phase = glitchRand() * Math.PI * 2;
      for (let i = 0; i < SCREEN_H; i++) {
        values.push(Math.floor(Math.sin(i * freq + phase) * amp));
      }
      hdmaEffects.push({
        startScanline: 0,
        register: glitchRand() > 0.5 ? "bgScrollX0" : "bgScrollX1",
        values
      });
      break;
    }
    case 1: {
      // Mosaic gradient
      const values = [];
      for (let i = 0; i < SCREEN_H; i++) {
        values.push(((i >> 3) & 0xF) << 4);
      }
      hdmaEffects.push({ startScanline: 0, register: "mosaic", values });
      break;
    }
    case 2: {
      // Color wash
      const channel = ["colorMathR", "colorMathG", "colorMathB"][glitchRandInt(3)];
      const values = [];
      for (let i = 0; i < SCREEN_H; i++) {
        values.push(Math.floor(Math.sin(i * 0.05 + frameCount * 0.02) * 15 + 16));
      }
      hdmaEffects.push({ startScanline: 0, register: channel, values });
      colorMathMode = 1;
      break;
    }
    case 3: {
      // Mode 7 per-scanline rotation (fake "floor" perspective)
      if (ppuMode === 7) {
        const values = [];
        for (let i = 0; i < SCREEN_H; i++) {
          const scale = 0.5 + (i / SCREEN_H) * 3.0;
          values.push(scale);
        }
        hdmaEffects.push({ startScanline: 0, register: "m7a", values });
        hdmaEffects.push({ startScanline: 0, register: "m7d", values: [...values] });
      }
      break;
    }
    case 4: {
      // Garbage HDMA data (simulates corrupted table pointer)
      const reg = ["bgScrollX0", "bgScrollY0", "bgScrollX1", "bgScrollY1"][glitchRandInt(4)];
      const values = [];
      const len = 16 + glitchRandInt(SCREEN_H - 16);
      const start = glitchRandInt(SCREEN_H - len);
      for (let i = 0; i < len; i++) {
        // Read "garbage" from random VRAM as if the DMA pointer was wrong
        const vramAddr = glitchRandInt(VRAM_SIZE);
        values.push(((VRAM[vramAddr] | (VRAM[(vramAddr + 1) & 0xFFFF] << 8)) - 32768) >> 6);
      }
      hdmaEffects.push({ startScanline: start, register: reg, values });
      break;
    }
  }
}

// --- GLITCH: Bitplane interleave error ---
function glitchBitplaneError() {
  // Simulate a timing error where bitplane data gets shifted
  const tileStart = glitchRandInt(200);
  const tileCount = 2 + glitchRandInt(20);
  const shift = 1 + glitchRandInt(3);

  for (let t = tileStart; t < tileStart + tileCount && t < 256; t++) {
    const addr = t * 32;
    // Shift the bitplane pairs
    for (let row = 0; row < 8; row++) {
      const temp = VRAM[(addr + row * 2) & 0xFFFF];
      VRAM[(addr + row * 2) & 0xFFFF] = VRAM[(addr + row * 2 + shift) & 0xFFFF];
      VRAM[(addr + row * 2 + shift) & 0xFFFF] = temp;
    }
  }
}

// --- GLITCH: Bus conflict (simulate simultaneous read/write) ---
function glitchBusConflict() {
  // When CPU and PPU access VRAM simultaneously, data gets ORed or ANDed
  const addr = glitchRandInt(VRAM_SIZE - 256);
  const length = 32 + glitchRandInt(256);
  const op = glitchRandInt(3);
  const conflictByte = VRAM[glitchRandInt(VRAM_SIZE)];

  for (let i = 0; i < length; i++) {
    const a = (addr + i) & 0xFFFF;
    switch (op) {
      case 0: VRAM[a] |= conflictByte; break;
      case 1: VRAM[a] &= conflictByte; break;
      case 2: VRAM[a] ^= conflictByte; break;
    }
  }
}

// --- GLITCH: Scroll register overflow ---
function glitchScrollOverflow() {
  const bg = glitchRandInt(2);
  bgScrollX[bg] += glitchRandInt(128) - 64;
  bgScrollY[bg] += glitchRandInt(128) - 64;
}

// ============================================================
//  TILE MORPH MODE
//  A dedicated fusion of DMA misfire + tilemap scramble that
//  creates organic, evolving interactions between the tile set
//  and the tilemap. Tiles infect neighbors, tilemaps drag tile
//  data around, genome splicing breeds hybrid tiles, and VRAM
//  feedback loops create visual recursion.
// ============================================================

// Persistent state for tile morph mode
let tileMorphPhase = 0;        // current sub-effect phase
let tileMorphTimer = 0;        // frames in current phase
let tileMorphCycleLen = 180;   // frames per phase
let tileMorphWanderAccum = new Float32Array(32 * 32); // per-cell drift accumulator
let tileMorphInfectionMap = new Uint8Array(256); // which tiles are "infected"
let tileMorphEpoch = 0;        // how many full cycles we've completed

// --- TILE MORPH: Tile Infection ---
// A tile slowly overwrites its neighbors in tile memory,
// spreading its pattern outward like a virus
function tileMorphInfection() {
  // Pick a source tile (prefer already-infected ones for chain reactions)
  let src;
  const infectedTiles = [];
  for (let i = 0; i < 256; i++) {
    if (tileMorphInfectionMap[i] > 0) infectedTiles.push(i);
  }
  if (infectedTiles.length > 0 && glitchRand() < 0.7) {
    src = infectedTiles[glitchRandInt(infectedTiles.length)];
  } else {
    src = glitchRandInt(256);
  }

  // Infect 1-3 neighbors (adjacent tile indices)
  const count = 1 + glitchRandInt(3);
  for (let i = 0; i < count; i++) {
    const offset = (glitchRand() < 0.5 ? 1 : -1) * (1 + glitchRandInt(3));
    const dst = (src + offset + 256) & 0xFF;
    const srcAddr = src * 32;
    const dstAddr = dst * 32;

    // Don't fully overwrite — blend by copying only some rows
    // This creates hybrid tiles that are part-source, part-original
    const startRow = glitchRandInt(8);
    const rowCount = 1 + glitchRandInt(4);
    for (let row = startRow; row < Math.min(startRow + rowCount, 8); row++) {
      // Copy one or both bitplane pairs (partial infection)
      if (glitchRand() < 0.6) {
        // Low bitplanes
        VRAM[(dstAddr + row * 2) & 0xFFFF] = VRAM[(srcAddr + row * 2) & 0xFFFF];
        VRAM[(dstAddr + row * 2 + 1) & 0xFFFF] = VRAM[(srcAddr + row * 2 + 1) & 0xFFFF];
      }
      if (glitchRand() < 0.4) {
        // High bitplanes
        VRAM[(dstAddr + 16 + row * 2) & 0xFFFF] = VRAM[(srcAddr + 16 + row * 2) & 0xFFFF];
        VRAM[(dstAddr + 16 + row * 2 + 1) & 0xFFFF] = VRAM[(srcAddr + 16 + row * 2 + 1) & 0xFFFF];
      }
    }
    tileMorphInfectionMap[dst] = Math.min(255, tileMorphInfectionMap[dst] + 30);
    tileMorphInfectionMap[src] = Math.min(255, tileMorphInfectionMap[src] + 5);
  }

  // Slowly decay infection map so it stays dynamic
  for (let i = 0; i < 256; i++) {
    if (tileMorphInfectionMap[i] > 0) tileMorphInfectionMap[i]--;
  }
}

// --- TILE MORPH: Genome Splicing ---
// Takes two tiles and interleaves their bitplane rows to breed
// a new hybrid, writing it into a third tile slot
function tileMorphGenomeSplice() {
  const parentA = glitchRandInt(256);
  const parentB = glitchRandInt(256);
  const child = glitchRandInt(256);
  const addrA = parentA * 32;
  const addrB = parentB * 32;
  const addrC = child * 32;

  // Splice method varies
  const method = glitchRandInt(4);
  for (let bp = 0; bp < 32; bp++) {
    const row = bp < 16 ? (bp >> 1) : ((bp - 16) >> 1); // which row this byte belongs to
    const fromA = VRAM[(addrA + bp) & 0xFFFF];
    const fromB = VRAM[(addrB + bp) & 0xFFFF];
    let result;
    switch (method) {
      case 0: // alternating rows from each parent
        result = (row & 1) ? fromA : fromB;
          break;
        case 1: // XOR crossover — creates interference patterns
          result = fromA ^ fromB;
          break;
        case 2: // bitwise interleave — even bits from A, odd from B
          result = (fromA & 0xAA) | (fromB & 0x55);
          break;
        case 3: // average (OR then shift, lossy blend)
          result = (fromA | fromB) & ((fromA & fromB) | (glitchRandInt(256)));
          break;
      }
      VRAM[(addrC + bp) & 0xFFFF] = result;
  }
}

// --- TILE MORPH: Wandering Tiles ---
// Tile indices in the tilemap slowly drift, making tiles appear
// to "walk" through the tileset — the image morphs continuously
function tileMorphWanderingTiles() {
  const bgIdx = glitchRandInt(2);
  const tmBase = bgTilemapAddr[bgIdx];

  // Drift speed varies by region — creates organic flow
  const driftAngle = frameCount * 0.01 + tileMorphEpoch * 0.5;
  const driftX = Math.cos(driftAngle) * 0.3;
  const driftY = Math.sin(driftAngle * 0.7) * 0.3;

  // Only affect a region (wandering window)
  const wx = Math.floor(16 + Math.sin(frameCount * 0.007) * 12);
  const wy = Math.floor(14 + Math.cos(frameCount * 0.009) * 10);
  const ww = 6 + glitchRandInt(12);
  const wh = 4 + glitchRandInt(10);

  for (let y = wy; y < Math.min(wy + wh, 32); y++) {
    for (let x = wx; x < Math.min(wx + ww, 32); x++) {
      const idx = y * 32 + x;
      // Accumulate fractional drift
      tileMorphWanderAccum[idx] += driftX + Math.sin(y * 0.5 + frameCount * 0.02) * 0.2;

      // When accumulator crosses ±1, adjust the tile index
      if (Math.abs(tileMorphWanderAccum[idx]) >= 1.0) {
        const step = Math.sign(tileMorphWanderAccum[idx]);
        tileMorphWanderAccum[idx] -= step;

        const addr = (tmBase + idx * 2) & 0xFFFF;
        const lo = VRAM[addr];
        const hi = VRAM[(addr + 1) & 0xFFFF];
        const entry = lo | (hi << 8);
        let tileIdx = entry & 0x3FF;
        const flags = entry & 0xFC00;
        tileIdx = (tileIdx + step + 256) & 0xFF;
        const newEntry = tileIdx | flags;
        VRAM[addr] = newEntry & 0xFF;
        VRAM[(addr + 1) & 0xFFFF] = (newEntry >> 8) & 0xFF;
      }
    }
  }
}

// --- TILE MORPH: Cross-Pollination DMA ---
// The DMA controller "accidentally" copies tilemap data into tile
// memory and vice versa — the map becomes the texture and the
// texture becomes the map. This is a real failure mode.
function tileMorphCrossPollination() {
  const mode = glitchRandInt(3);
  switch (mode) {
    case 0: {
      // Tilemap bytes → tile data (map becomes texture)
      const bgIdx = glitchRandInt(2);
      const tmSrc = bgTilemapAddr[bgIdx] + glitchRandInt(TILEMAP_SIZE);
      const tileDst = glitchRandInt(200) * 32 + glitchRandInt(32);
      const len = 8 + glitchRandInt(48);
      for (let i = 0; i < len; i++) {
        VRAM[(tileDst + i) & 0xFFFF] = VRAM[(tmSrc + i) & 0xFFFF];
      }
      break;
    }
    case 1: {
      // Tile data → tilemap (texture poisons the map)
      const tileSrc = glitchRandInt(256) * 32;
      const bgIdx = glitchRandInt(2);
      const tmDst = bgTilemapAddr[bgIdx] + glitchRandInt(TILEMAP_SIZE - 64);
      const len = 4 + glitchRandInt(32);
      for (let i = 0; i < len; i++) {
        VRAM[(tmDst + i) & 0xFFFF] = VRAM[(tileSrc + i) & 0xFFFF];
      }
      break;
    }
    case 2: {
      // Swap a chunk between tile data and tilemap
      const tileSrc = glitchRandInt(256) * 32;
      const bgIdx = glitchRandInt(2);
      const tmAddr = bgTilemapAddr[bgIdx] + glitchRandInt(TILEMAP_SIZE - 32);
      const len = 8 + glitchRandInt(24);
      for (let i = 0; i < len; i++) {
        const a = (tileSrc + i) & 0xFFFF;
        const b = (tmAddr + i) & 0xFFFF;
        const tmp = VRAM[a];
        VRAM[a] = VRAM[b];
        VRAM[b] = tmp;
      }
      break;
    }
  }
}

// --- TILE MORPH: Tilemap Echo ---
// Copies a rectangular region of the tilemap to a nearby offset,
// creating stuttering/ghosting patterns where the same tiles
// appear in slightly wrong positions
function tileMorphTilemapEcho() {
  const bgIdx = glitchRandInt(2);
  const tmBase = bgTilemapAddr[bgIdx];

  // Source region
  const sx = glitchRandInt(24);
  const sy = glitchRandInt(20);
  const w = 3 + glitchRandInt(10);
  const h = 3 + glitchRandInt(8);

  // Offset (small = subtle echo, large = dramatic)
  const ox = (glitchRandInt(5) - 2);
  const oy = (glitchRandInt(5) - 2);
  if (ox === 0 && oy === 0) return;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcX = sx + x;
      const srcY = sy + y;
      const dstX = (sx + x + ox + 32) & 31;
      const dstY = (sy + y + oy + 32) & 31;
      const srcAddr = (tmBase + (srcY * 32 + srcX) * 2) & 0xFFFF;
      const dstAddr = (tmBase + (dstY * 32 + dstX) * 2) & 0xFFFF;
      // Echo — overwrite destination but maybe corrupt the flags
      VRAM[dstAddr] = VRAM[srcAddr];
      // Keep or corrupt the high byte
      if (glitchRand() < 0.3) {
        VRAM[(dstAddr + 1) & 0xFFFF] = VRAM[(srcAddr + 1) & 0xFFFF];
      } else {
        // Mix flags from source and destination — palette bleeds
        VRAM[(dstAddr + 1) & 0xFFFF] =
          (VRAM[(dstAddr + 1) & 0xFFFF] & 0xC0) | // keep flip flags
          (VRAM[(srcAddr + 1) & 0xFFFF] & 0x1C) |  // steal palette
          (VRAM[(srcAddr + 1) & 0xFFFF] & 0x03);   // steal high tile bits
      }
    }
  }
}

// --- TILE MORPH: Cascade Corruption ---
// Read which tiles the tilemap references in a region, then
// corrupt THOSE specific tiles. The tilemap "causes" the tile
// corruption — a feedback chain.
function tileMorphCascade() {
  const bgIdx = glitchRandInt(2);
  const tmBase = bgTilemapAddr[bgIdx];
  const chBase = bgCharAddr[bgIdx];

  // Pick a region of the visible tilemap
  const sx = glitchRandInt(TILES_PER_ROW);
  const sy = glitchRandInt(TILES_PER_COL);
  const w = 2 + glitchRandInt(6);
  const h = 2 + glitchRandInt(4);

  // Collect the tile indices this region references
  const referencedTiles = new Set();
  for (let y = sy; y < Math.min(sy + h, 32); y++) {
    for (let x = sx; x < Math.min(sx + w, 32); x++) {
      const scrolledX = (x + (bgScrollX[bgIdx] >> 3)) & 31;
      const scrolledY = (y + (bgScrollY[bgIdx] >> 3)) & 31;
      const addr = (tmBase + (scrolledY * 32 + scrolledX) * 2) & 0xFFFF;
      const tileIdx = VRAM[addr] | ((VRAM[(addr + 1) & 0xFFFF] & 0x03) << 8);
      referencedTiles.add(tileIdx & 0xFF);
    }
  }

  // Now corrupt those tiles — they'll visually change in place
  const corruptMode = glitchRandInt(4);
  for (const tileIdx of referencedTiles) {
    const tileAddr = (chBase + tileIdx * 32) & 0xFFFF;
    switch (corruptMode) {
      case 0: {
        // Shift all rows down by 1 (tile appears to scroll within itself)
        const lastRow = new Uint8Array(4);
        for (let b = 0; b < 4; b++) {
          lastRow[b] = VRAM[(tileAddr + 14 + (b < 2 ? b : 14 + b)) & 0xFFFF];
        }
        for (let row = 7; row > 0; row--) {
          VRAM[(tileAddr + row * 2) & 0xFFFF] = VRAM[(tileAddr + (row - 1) * 2) & 0xFFFF];
          VRAM[(tileAddr + row * 2 + 1) & 0xFFFF] = VRAM[(tileAddr + (row - 1) * 2 + 1) & 0xFFFF];
        }
        VRAM[tileAddr & 0xFFFF] = lastRow[0];
        VRAM[(tileAddr + 1) & 0xFFFF] = lastRow[1];
        break;
      }
      case 1: {
        // Horizontal bit-shift (tile slides sideways)
        const dir = glitchRand() < 0.5 ? 1 : -1;
        for (let row = 0; row < 8; row++) {
          for (let bp = 0; bp < 2; bp++) {
            const addr = (tileAddr + row * 2 + bp) & 0xFFFF;
            if (dir > 0) {
              VRAM[addr] = ((VRAM[addr] >> 1) | (VRAM[addr] << 7)) & 0xFF;
            } else {
              VRAM[addr] = ((VRAM[addr] << 1) | (VRAM[addr] >> 7)) & 0xFF;
            }
          }
        }
        break;
      }
      case 2: {
        // Mirror vertically
        for (let row = 0; row < 4; row++) {
          for (let bp = 0; bp < 32; bp += 16) {
            const a = (tileAddr + bp + row * 2) & 0xFFFF;
            const b = (tileAddr + bp + (7 - row) * 2) & 0xFFFF;
            const tmp0 = VRAM[a]; const tmp1 = VRAM[(a + 1) & 0xFFFF];
            VRAM[a] = VRAM[b]; VRAM[(a + 1) & 0xFFFF] = VRAM[(b + 1) & 0xFFFF];
            VRAM[b] = tmp0; VRAM[(b + 1) & 0xFFFF] = tmp1;
          }
        }
        break;
      }
      case 3: {
        // XOR with a neighboring tile (blend visible tiles together)
        const neighbor = (tileIdx + (glitchRand() < 0.5 ? 1 : -1) + 256) & 0xFF;
        const nAddr = (chBase + neighbor * 32) & 0xFFFF;
        for (let b = 0; b < 32; b++) {
          VRAM[(tileAddr + b) & 0xFFFF] ^= VRAM[(nAddr + b) & 0xFFFF];
        }
        break;
      }
    }
  }
}

// --- TILE MORPH: VRAM Feedback Loop ---
// Read the currently rendered tilemap pattern and write it back
// as tile data — like pointing a camera at its own screen.
// Creates recursive, fractal-like visual feedback.
function tileMorphFeedback() {
  const bgIdx = glitchRandInt(2);
  const tmBase = bgTilemapAddr[bgIdx];

  // Read an 8×8 region of tilemap entries (= 64 tile references)
  // and pack them as pixel data into a new tile
  const startTX = glitchRandInt(24);
  const startTY = glitchRandInt(24);
  const dstTile = glitchRandInt(256);
  const dstAddr = dstTile * 32;

  for (let row = 0; row < 8; row++) {
    let bp0 = 0, bp1 = 0, bp2 = 0, bp3 = 0;
    for (let col = 0; col < 8; col++) {
      const tmX = (startTX + col) & 31;
      const tmY = (startTY + row) & 31;
      const addr = (tmBase + (tmY * 32 + tmX) * 2) & 0xFFFF;
      // Use the low bits of the tile index as pixel color
      const val = VRAM[addr] & 0xF;
      const bit = 7 - col;
      bp0 |= ((val >> 0) & 1) << bit;
      bp1 |= ((val >> 1) & 1) << bit;
      bp2 |= ((val >> 2) & 1) << bit;
      bp3 |= ((val >> 3) & 1) << bit;
    }
    VRAM[(dstAddr + row * 2) & 0xFFFF] = bp0;
    VRAM[(dstAddr + row * 2 + 1) & 0xFFFF] = bp1;
    VRAM[(dstAddr + 16 + row * 2) & 0xFFFF] = bp2;
    VRAM[(dstAddr + 16 + row * 2 + 1) & 0xFFFF] = bp3;
  }

  // Also place this tile INTO the tilemap where we read from,
  // closing the feedback loop
  if (glitchRand() < 0.4) {
    const insertX = startTX + glitchRandInt(4);
    const insertY = startTY + glitchRandInt(4);
    const addr = (tmBase + ((insertY & 31) * 32 + (insertX & 31)) * 2) & 0xFFFF;
    VRAM[addr] = dstTile;
  }
}

// --- TILE MORPH: Tile Row Propagation ---
// A row of tiles in the tilemap "drags" — the last entry duplicates
// forward, creating streaking artifacts where tiles smear across
function tileMorphRowDrag() {
  const bgIdx = glitchRandInt(2);
  const tmBase = bgTilemapAddr[bgIdx];

  const row = glitchRandInt(32);
  const startCol = glitchRandInt(20);
  const dragLen = 3 + glitchRandInt(12);
  const direction = glitchRand() < 0.5 ? 1 : -1;

  // Read the "stuck" entry
  const stuckAddr = (tmBase + (row * 32 + startCol) * 2) & 0xFFFF;
  const stuckLo = VRAM[stuckAddr];
  const stuckHi = VRAM[(stuckAddr + 1) & 0xFFFF];

  // Drag it across
  for (let i = 1; i <= dragLen; i++) {
    const col = (startCol + i * direction + 32) & 31;
    const addr = (tmBase + (row * 32 + col) * 2) & 0xFFFF;
    // Gradually degrade the dragged entry
    VRAM[addr] = stuckLo ^ (glitchRand() < 0.15 ? (1 << glitchRandInt(8)) : 0);
    VRAM[(addr + 1) & 0xFFFF] = stuckHi;
  }
}

// --- TILE MORPH: Tile Column Cascade ---
// A column of tiles cascades downward — each entry takes the value
// of the one above it, like tiles "falling"
function tileMorphColumnCascade() {
  const bgIdx = glitchRandInt(2);
  const tmBase = bgTilemapAddr[bgIdx];

  const col = glitchRandInt(32);
  const startRow = glitchRandInt(10);
  const cascadeLen = 4 + glitchRandInt(16);

  // Cascade downward (or upward)
  const dir = glitchRand() < 0.7 ? 1 : -1;
  for (let i = cascadeLen; i > 0; i--) {
    const dstRow = (startRow + i * dir + 32) & 31;
    const srcRow = (startRow + (i - 1) * dir + 32) & 31;
    const dstAddr = (tmBase + (dstRow * 32 + col) * 2) & 0xFFFF;
    const srcAddr = (tmBase + (srcRow * 32 + col) * 2) & 0xFFFF;
    VRAM[dstAddr] = VRAM[srcAddr];
    VRAM[(dstAddr + 1) & 0xFFFF] = VRAM[(srcAddr + 1) & 0xFFFF];
  }
}

// --- TILE MORPH: Orchestrator ---
// Phases cycle through sub-effects with smooth transitions.
// Each phase emphasizes certain interactions while mixing in others.
const TILE_MORPH_PHASES = [
  { name: "Infection",     primary: tileMorphInfection,        secondary: tileMorphWanderingTiles },
  { name: "Splicing",      primary: tileMorphGenomeSplice,     secondary: tileMorphTilemapEcho },
  { name: "Cross-Talk",    primary: tileMorphCrossPollination,  secondary: tileMorphCascade },
  { name: "Wandering",     primary: tileMorphWanderingTiles,   secondary: tileMorphInfection },
  { name: "Feedback",      primary: tileMorphFeedback,         secondary: tileMorphGenomeSplice },
  { name: "Cascade",       primary: tileMorphCascade,          secondary: tileMorphRowDrag },
  { name: "Echoes",        primary: tileMorphTilemapEcho,      secondary: tileMorphColumnCascade },
  { name: "Drag",          primary: tileMorphRowDrag,          secondary: tileMorphCrossPollination },
];

let tileMorphPhaseName = "";

function glitchTileMorph() {
  tileMorphTimer++;

  // Advance phase
  if (tileMorphTimer >= tileMorphCycleLen) {
    tileMorphTimer = 0;
    tileMorphPhase = (tileMorphPhase + 1) % TILE_MORPH_PHASES.length;
    if (tileMorphPhase === 0) {
      tileMorphEpoch++;
      // Each epoch slightly changes the cycle length for variety
      tileMorphCycleLen = 120 + glitchRandInt(180);
    }
  }

  const phase = TILE_MORPH_PHASES[tileMorphPhase];
  tileMorphPhaseName = phase.name;

  // Transition blending — at phase boundaries, run both old and new
  const phaseProgress = tileMorphTimer / tileMorphCycleLen;
  const inTransition = phaseProgress < 0.1 || phaseProgress > 0.9;

  // Primary effect runs every frame
  phase.primary();

  // Secondary effect runs less often, more during transitions
  if (glitchRand() < (inTransition ? 0.6 : 0.25)) {
    phase.secondary();
  }

  // Occasionally throw in a column cascade or row drag for texture
  if (glitchRand() < 0.08) tileMorphColumnCascade();
  if (glitchRand() < 0.08) tileMorphRowDrag();

  // Light palette drift to keep colors alive (subtle, not the full corrupt)
  if (glitchRand() < 0.03) {
    const pal = glitchRandInt(8);
    const col = 1 + glitchRandInt(15);
    const addr = (pal * 16 + col) * 2;
    // Nudge one channel
    const channel = glitchRandInt(3);
    const w = CGRAM[addr] | (CGRAM[addr + 1] << 8);
    const shift = channel * 5;
    let component = (w >> shift) & 0x1F;
    component = Math.max(0, Math.min(31, component + (glitchRand() < 0.5 ? 1 : -1)));
    const mask = ~(0x1F << shift);
    const nw = (w & mask) | (component << shift);
    CGRAM[addr] = nw & 0xFF;
    CGRAM[addr + 1] = (nw >> 8) & 0xFF;
  }
}

// --- Master glitch dispatcher ---
const GLITCH_NAMES = [
  "DMA Misfire",
  "VRAM Bit Rot",
  "Palette Corrupt",
  "Tilemap Scramble",
  "Mode 7 Warp",
  "HDMA Chaos",
  "Bitplane Error",
  "Bus Conflict",
  "Scroll Overflow",
  "Tile Morph"
];

const GLITCH_FNS = [
  glitchDMAMisfire,
  glitchVRAMBitRot,
  glitchPaletteCorrupt,
  glitchTilemapScramble,
  glitchMode7,
  glitchHDMA,
  glitchBitplaneError,
  glitchBusConflict,
  glitchScrollOverflow,
  glitchTileMorph
];

let activeGlitchNames = [];

function applyGlitches() {
  activeGlitchNames = [];

  // Auto-glitch with evolving intensity
  if (autoGlitch) {
    // Slowly evolving base intensity
    const baseIntensity = 0.3 + 0.3 * Math.sin(frameCount * 0.003);
    // Occasional bursts
    const burst = (frameCount - lastGlitchBurst < 60) ? 0.5 : 0;
    glitchIntensity = Math.min(1.0, baseIntensity + burst);

    // Random bursts
    if (glitchRand() < 0.005) {
      lastGlitchBurst = frameCount;
    }

    // Apply multiple glitch types based on intensity
    const numGlitches = 1 + Math.floor(glitchIntensity * 4);
    for (let i = 0; i < numGlitches; i++) {
      if (glitchRand() < glitchIntensity) {
        let idx;
        if (glitchMode > 0) {
          idx = glitchMode - 1;
        } else {
          idx = glitchRandInt(GLITCH_FNS.length);
        }
        GLITCH_FNS[idx]();
        if (!activeGlitchNames.includes(GLITCH_NAMES[idx])) {
          activeGlitchNames.push(GLITCH_NAMES[idx]);
        }
      }
    }
  }

  // Slowly animate scrolls
  bgScrollX[0] += 1;
  bgScrollY[0] += 0;
  bgScrollX[1] -= 1;
  bgScrollY[1] += 1;

  // Slowly rotate mode 7
  if (ppuMode === 7) {
    const angle = 0.005;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const na = m7a * ca - m7c * sa;
    const nc = m7a * sa + m7c * ca;
    const nb = m7b * ca - m7d * sa;
    const nd = m7b * sa + m7d * ca;
    m7a = na; m7b = nb; m7c = nc; m7d = nd;
  }
}

// --- Reset to clean state ---
function resetPPU() {
  VRAM.fill(0);
  CGRAM.fill(0);
  OAM.fill(0);
  bgScrollX.fill(0);
  bgScrollY.fill(0);
  hdmaEffects = [];
  mosaicSize = 1;
  colorMathMode = 0;
  m7a = 1; m7b = 0; m7c = 0; m7d = 1;
  m7hofs = 0; m7vofs = 0;
  m7x = SCREEN_W >> 1; m7y = SCREEN_H >> 1;

  // Reset tile morph state
  tileMorphPhase = 0;
  tileMorphTimer = 0;
  tileMorphCycleLen = 180;
  tileMorphWanderAccum.fill(0);
  tileMorphInfectionMap.fill(0);
  tileMorphEpoch = 0;

  generateTileData();
  generateBG2Tiles();
  generateTilemaps();
  generatePalette();
  generateOAM();
}

// Input handling is in engine.js (or standalone fallback below)
if (typeof ENGINE_LOADED === "undefined") {
  document.addEventListener("keydown", (e) => {
    switch (e.key) {
      case " ": e.preventDefault(); lastGlitchBurst = frameCount;
        for (let i = 0; i < 10; i++) GLITCH_FNS[glitchRandInt(GLITCH_FNS.length)]();
        break;
      case "r": case "R": resetPPU(); break;
      case "f": case "F": frozen = !frozen; break;
      case "0": glitchMode = 0; break;
      default:
        if (e.key >= "1" && e.key <= "9") glitchMode = parseInt(e.key);
    }
  });
}

// --- UI update ---
function updateUI() {
  const modeStr = ppuMode === 7 ? "MODE 7 (Affine)" : `MODE ${ppuMode} (Tiled)`;
  const glitchStr = glitchMode === 0 ? "ALL" : GLITCH_NAMES[glitchMode - 1] || "ALL";
  const activeStr = activeGlitchNames.join(" + ") || "—";
  const intensityBar = "█".repeat(Math.floor(glitchIntensity * 20)) +
                       "░".repeat(20 - Math.floor(glitchIntensity * 20));

  // Tile morph phase display
  let tileMorphStr = "";
  if (glitchMode === 10) {
    const phaseProgress = tileMorphTimer / tileMorphCycleLen;
    const phaseBar = "█".repeat(Math.floor(phaseProgress * 12)) +
                     "░".repeat(12 - Math.floor(phaseProgress * 12));
    tileMorphStr = `
    <div style="color:#f8a">────── TILE MORPH ──────</div>
    <div style="color:#f8a">Phase: ${tileMorphPhaseName} [${phaseBar}]</div>
    <div style="color:#f8a">Epoch: ${tileMorphEpoch} │ Cycle: ${tileMorphCycleLen}f</div>
    <div style="color:#f8a">Infected tiles: ${tileMorphInfectionMap.reduce((a, b) => a + (b > 0 ? 1 : 0), 0)}/256</div>`;
  }

  ui.innerHTML = `
    <div>SNES PPU CORRUPTION ENGINE</div>
    <div>────────────────────────</div>
    <div>${modeStr} │ Frame ${frameCount}</div>
    <div>Glitch: ${glitchStr} │ ${frozen ? "FROZEN" : "LIVE"}</div>
    <div>Intensity: [${intensityBar}] ${(glitchIntensity * 100).toFixed(0)}%</div>
    <div>Active: ${activeStr}</div>
    <div>BG1 scroll: ${bgScrollX[0]},${bgScrollY[0]}</div>
    <div>BG2 scroll: ${bgScrollX[1]},${bgScrollY[1]}</div>
    ${ppuMode === 7 ? `<div>M7: a=${m7a.toFixed(3)} b=${m7b.toFixed(3)} c=${m7c.toFixed(3)} d=${m7d.toFixed(3)}</div>` : ""}
    ${tileMorphStr}
  `;
}

// --- Main loop ---
function mainLoop() {
  if (!frozen) {
    // Clear per-frame HDMA (re-applied each frame, some persist)
    if (glitchRand() < 0.1) {
      hdmaEffects = hdmaEffects.slice(-3); // keep last few
    }

    // Reset per-frame registers that HDMA overwrites
    mosaicSize = 1;

    applyGlitches();
    renderFrame();
    frameCount++;
  }

  updateUI();
  requestAnimationFrame(mainLoop);
}

// --- Boot is handled by engine.js ---
// If no engine.js, boot standalone:
if (typeof ENGINE_LOADED === "undefined") {
  resetPPU();
  mainLoop();
}
