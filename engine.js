// ============================================================
//  SNES PPU CORRUPTION ENGINE — EXTENDED
//  Scene director, sprites, color cycling, raster bars,
//  window masking, enhanced tile generation, and new glitch
//  types that push the PPU simulation into full visual chaos.
// ============================================================

if (typeof ENGINE_LOADED === "undefined") { var ENGINE_LOADED = true; }

// ============================================================
//  SECTION 1: NEW PPU STATE
// ============================================================

// --- Sprites ---
let spritesEnabled = false;
const MAX_SPRITES_PER_LINE = 32;

// --- Hardware Windows (SNES has 2 windows for masking) ---
let windowEnabled = false;
let window1Left = 0, window1Right = 255;
let window2Left = 0, window2Right = 255;
let windowMode = 0; // 0=off, 1=inside W1, 2=outside W1, 3=W1 AND W2, 4=W1 XOR W2
let windowMaskAction = 0; // 0=clip to black, 1=clip to color, 2=invert

// --- Color Cycling ---
let colorCycleRanges = [];
// Each: { palIdx, startCol, endCol, speed, counter, direction }

// --- Raster Bars ---
let rasterEnabled = false;
let rasterColors = new Uint16Array(1024); // max possible height
let rasterOffset = 0;

// --- Scene Director ---
let currentScene = -1;
let sceneTimer = 0;
let sceneTransitionPhase = 0; // 0=running, 1=fade-out, 2=switch, 3=fade-in
let sceneTransitionTimer = 0;
let sceneBrightness = 1.0;
let sceneAutoAdvance = true;
let sceneName = "";

// --- Particle sprites (managed OAM subset) ---
let particles = []; // {x, y, vx, vy, tile, palette, life, maxLife}

// --- Scanline offset table (for per-line X displacement beyond HDMA) ---
let scanlineOffsets = new Float32Array(SCREEN_H);

// --- Ghost frame buffer (previous frame for feedback effects) ---
let ghostBuffer = null;
let ghostEnabled = false;
let ghostAlpha = 0.3;

// ============================================================
//  SECTION 2: ENHANCED TILE GENERATION
// ============================================================

// Richer tile patterns — game-like glyphs, circuit traces, organic shapes
function generateEnhancedTiles() {
  // Keep the original 256 tiles at 0x0000 from ppu.js generateTileData()
  // Add 256 MORE tiles at 0x2000 with wilder patterns
  const base = 0x2000;
  for (let tile = 0; tile < 256; tile++) {
    const addr = base + tile * 32;
    for (let row = 0; row < 8; row++) {
      let pixels = new Uint8Array(8);
      const family = (tile >> 5) & 7;
      const variant = tile & 0x1F;

      switch (family) {
        case 0: // Circuit traces — horizontal and vertical lines with corners
          for (let x = 0; x < 8; x++) {
            const isHLine = row === (variant & 7);
            const isVLine = x === ((variant >> 3) & 7);
            const isCorner = isHLine && isVLine;
            pixels[x] = isCorner ? 15 : (isHLine || isVLine) ? (8 + (variant & 3)) : 0;
          }
          break;

        case 1: // Runes / glyphs — pseudo-random connected shapes
          for (let x = 0; x < 8; x++) {
            const seed = tile * 2654435761;
            const hash = ((seed + row * 2246822519 + x * 3266489917) >>> 0);
            const connected = (hash % 7) < 3;
            const border = x === 0 || x === 7 || row === 0 || row === 7;
            pixels[x] = connected ? (border ? 4 + (variant & 3) : 10 + (variant & 5)) : 0;
          }
          break;

        case 2: // Wave interference patterns
          for (let x = 0; x < 8; x++) {
            const wave1 = Math.sin((x + variant * 0.5) * 0.8 + row * 0.6);
            const wave2 = Math.cos((x * 0.7 - row * 0.9) + variant * 0.3);
            pixels[x] = Math.floor(Math.abs(wave1 + wave2) * 7.5) & 0xF;
          }
          break;

        case 3: // Organic cells — voronoi-ish
          for (let x = 0; x < 8; x++) {
            const cx1 = (variant & 3) * 2, cy1 = ((variant >> 2) & 3) * 2;
            const cx2 = 7 - cx1, cy2 = 7 - cy1;
            const d1 = Math.abs(x - cx1) + Math.abs(row - cy1);
            const d2 = Math.abs(x - cx2) + Math.abs(row - cy2);
            pixels[x] = Math.min(15, Math.abs(d1 - d2) * 3);
          }
          break;

        case 4: // Sierpinski-like fractals
          for (let x = 0; x < 8; x++) {
            const level = (x + variant) & (row + variant);
            pixels[x] = level ? (level & 0xF) : 0;
          }
          break;

        case 5: // Arrow / directional shapes
          for (let x = 0; x < 8; x++) {
            const dir = variant & 3;
            let val = 0;
            if (dir === 0) val = (x === row || x === 7 - row) && row < 5 ? 12 : (x === 3 || x === 4) && row >= 3 ? 8 : 0;
            else if (dir === 1) val = (row === x || row === 7 - x) && x < 5 ? 12 : (row === 3 || row === 4) && x >= 3 ? 8 : 0;
            else if (dir === 2) val = Math.abs(x - 3.5) < (7 - row) * 0.5 ? 10 + (variant & 3) : 0;
            else val = (x + row) % (2 + (variant & 3)) === 0 ? 14 : (x * row) % 5 === 0 ? 6 : 0;
            pixels[x] = val & 0xF;
          }
          break;

        case 6: // Brick / masonry patterns
          for (let x = 0; x < 8; x++) {
            const brickH = 2 + (variant & 1);
            const brickW = 3 + (variant & 3);
            const rowOffset = (Math.floor(row / brickH) & 1) * Math.floor(brickW / 2);
            const isGap = (row % brickH === 0) || ((x + rowOffset) % brickW === 0);
            pixels[x] = isGap ? 2 : 7 + (variant & 7);
          }
          break;

        case 7: // Starfield dots
          for (let x = 0; x < 8; x++) {
            const h = ((tile * 7 + row * 13 + x * 31 + 12345) >>> 0) % 37;
            pixels[x] = h < 3 ? (10 + h * 2) : 0;
          }
          break;
      }

      // Encode as 4bpp bitplanes
      let bp0 = 0, bp1 = 0, bp2 = 0, bp3 = 0;
      for (let x = 0; x < 8; x++) {
        const bit = 7 - x;
        bp0 |= ((pixels[x] >> 0) & 1) << bit;
        bp1 |= ((pixels[x] >> 1) & 1) << bit;
        bp2 |= ((pixels[x] >> 2) & 1) << bit;
        bp3 |= ((pixels[x] >> 3) & 1) << bit;
      }
      VRAM[(addr + row * 2) & 0xFFFF] = bp0;
      VRAM[(addr + row * 2 + 1) & 0xFFFF] = bp1;
      VRAM[(addr + 16 + row * 2) & 0xFFFF] = bp2;
      VRAM[(addr + 16 + row * 2 + 1) & 0xFFFF] = bp3;
    }
  }
}

// ============================================================
//  SECTION 3: THEMED PALETTE GENERATION
// ============================================================

function generateThemedPalette(theme) {
  const themes = {
    ocean: { hues: [180, 220, 200, 240, 190, 210, 230, 170], sat: 0.7, lumBase: 0.12 },
    fire: { hues: [0, 15, 30, 45, 350, 10, 25, 40], sat: 0.85, lumBase: 0.1 },
    forest: { hues: [90, 120, 100, 80, 110, 130, 70, 140], sat: 0.6, lumBase: 0.08 },
    neon: { hues: [300, 180, 60, 330, 150, 270, 30, 210], sat: 1.0, lumBase: 0.05 },
    ruins: { hues: [30, 35, 40, 45, 25, 50, 20, 55], sat: 0.3, lumBase: 0.15 },
    blood: { hues: [350, 0, 10, 340, 355, 5, 345, 15], sat: 0.8, lumBase: 0.06 },
    ice: { hues: [190, 200, 210, 220, 185, 195, 205, 215], sat: 0.5, lumBase: 0.2 },
    void: { hues: [270, 280, 290, 260, 275, 285, 295, 265], sat: 0.6, lumBase: 0.04 },
    stained: { hues: [0, 45, 90, 135, 180, 225, 270, 315], sat: 0.9, lumBase: 0.1 },
    crt: { hues: [120, 100, 80, 140, 60, 160, 40, 180], sat: 0.8, lumBase: 0.02 },
    amber: { hues: [35, 40, 45, 30, 50, 38, 42, 33], sat: 0.6, lumBase: 0.08 },
    synthwave: { hues: [300, 180, 280, 310, 190, 290, 320, 170], sat: 0.9, lumBase: 0.06 },
    moss: { hues: [90, 110, 130, 70, 100, 120, 140, 150], sat: 0.55, lumBase: 0.04 },
    infrared: { hues: [0, 10, 20, 30, 40, 50, 15, 5], sat: 0.95, lumBase: 0.05 },
    midnight: { hues: [230, 240, 250, 220, 260, 235, 245, 225], sat: 0.5, lumBase: 0.02 },
    coral: { hues: [5, 10, 15, 20, 25, 30, 0, 8], sat: 0.85, lumBase: 0.12 },
  };

  const t = themes[theme] || themes.ocean;

  for (let pal = 0; pal < 8; pal++) {
    for (let col = 0; col < 16; col++) {
      const idx = pal * 16 + col;
      let r, g, b;
      if (col === 0) {
        r = 0; g = 0; b = 0;
      } else {
        const hue = (t.hues[pal] + col * 8 + Math.sin(pal * col * 0.3) * 15) % 360;
        const sat = Math.max(0, Math.min(1, t.sat + Math.sin(col * 0.7) * 0.15));
        const lum = t.lumBase + col * 0.05 + Math.sin(col * 1.2) * 0.02;
        [r, g, b] = hslToRGB((hue + 360) % 360, sat, Math.min(0.95, lum));
      }
      const sc = rgbToSnesColor(r, g, b);
      CGRAM[idx * 2] = sc & 0xFF;
      CGRAM[idx * 2 + 1] = (sc >> 8) & 0xFF;
    }
  }
}

// ============================================================
//  SECTION 4: SPRITE RENDERING
// ============================================================

function initParticles(count, style) {
  particles = [];
  for (let i = 0; i < Math.min(count, 96); i++) {
    const p = { x: 0, y: 0, vx: 0, vy: 0, tile: 0, palette: 0, life: 0, maxLife: 120, size: 8 };
    switch (style) {
      case "scatter":
        p.x = glitchRand() * SCREEN_W;
        p.y = glitchRand() * SCREEN_H;
        p.vx = (glitchRand() - 0.5) * 2;
        p.vy = (glitchRand() - 0.5) * 2;
        p.tile = glitchRandInt(256);
        p.palette = glitchRandInt(8);
        p.life = glitchRandInt(300);
        p.maxLife = 180 + glitchRandInt(200);
        break;
      case "rain":
        p.x = glitchRand() * SCREEN_W;
        p.y = -8 - glitchRand() * SCREEN_H;
        p.vx = (glitchRand() - 0.5) * 0.5;
        p.vy = 1 + glitchRand() * 3;
        p.tile = glitchRandInt(64);
        p.palette = glitchRandInt(3);
        p.life = 0;
        p.maxLife = 300;
        break;
      case "orbit":
        const angle = (i / count) * Math.PI * 2;
        const radius = 40 + glitchRand() * 60;
        p.x = Math.floor(SCREEN_W / 2) + Math.cos(angle) * radius;
        p.y = Math.floor(SCREEN_H / 2) + Math.sin(angle) * radius;
        p.vx = -Math.sin(angle) * 0.375;
        p.vy = Math.cos(angle) * 0.375;
        p.tile = i * 4;
        p.palette = (i >> 2) & 7;
        p.life = 0;
        p.maxLife = 9999;
        break;
      case "rise":
        p.x = glitchRand() * SCREEN_W;
        p.y = SCREEN_H + glitchRand() * 100;
        p.vx = (glitchRand() - 0.5) * 0.8;
        p.vy = -(0.3 + glitchRand() * 1.5);
        p.tile = glitchRandInt(128);
        p.palette = glitchRandInt(8);
        p.life = 0;
        p.maxLife = 250 + glitchRandInt(200);
        break;
    }
    particles.push(p);
  }
  spritesEnabled = true;
}

function updateParticles() {
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.life++;

    // Wrap around screen
    if (p.x < -16) p.x += SCREEN_W + 32;
    if (p.x > SCREEN_W + 16) p.x -= SCREEN_W + 32;

    // Respawn if dead or off screen
    if (p.life > p.maxLife || p.y > SCREEN_H + 16 || p.y < -20) {
      p.life = 0;
      p.y = p.vy > 0 ? -8 : SCREEN_H + 8;
      p.x = glitchRand() * SCREEN_W;
      p.tile = (p.tile + glitchRandInt(8)) & 0xFF;
    }
  }

  // Write particles into OAM
  for (let i = 0; i < Math.min(particles.length, 128); i++) {
    const p = particles[i];
    const base = i * 4;
    OAM[base] = Math.floor(p.x) & 0xFF;
    OAM[base + 1] = Math.floor(p.y) & 0xFF;
    OAM[base + 2] = p.tile & 0xFF;
    OAM[base + 3] = (p.palette & 7) | ((glitchRandInt(4)) << 4);

    // High table
    const hiIdx = 512 + (i >> 2);
    const hiShift = (i & 3) * 2;
    const x9 = p.x < 0 ? 1 : 0;
    const large = p.size > 8 ? 1 : 0;
    OAM[hiIdx] = (OAM[hiIdx] & ~(3 << hiShift)) | ((x9 | (large << 1)) << hiShift);
  }
}

function renderSpriteScanline(scanline, lineBuffer, priorityBuffer) {
  if (!spritesEnabled) return;
  let spritesOnLine = 0;

  for (let i = 127; i >= 0 && spritesOnLine < MAX_SPRITES_PER_LINE; i--) {
    const base = i * 4;
    let x = OAM[base];
    const y = OAM[base + 1];
    const tileIdx = OAM[base + 2];
    const attr = OAM[base + 3];

    const highByte = OAM[512 + (i >> 2)];
    const highBits = (highByte >> ((i & 3) * 2)) & 3;
    if (highBits & 1) x = x - 256;
    const large = highBits & 2;
    const size = large ? 16 : 8;

    const vFlip = (attr >> 7) & 1;
    const hFlip = (attr >> 6) & 1;
    const palette = attr & 7;

    const spriteY = (scanline - y) & 0xFF;
    if (spriteY >= size) continue;
    if (x <= -size || x >= SCREEN_W) continue;

    spritesOnLine++;
    const py = vFlip ? (size - 1 - spriteY) : spriteY;

    for (let px = 0; px < size; px++) {
      const screenX = x + px;
      if (screenX < 0 || screenX >= SCREEN_W) continue;

      const tx = hFlip ? (size - 1 - px) : px;
      let subTile = tileIdx;
      if (size === 16) {
        subTile = (tileIdx + (tx >> 3) + ((py >> 3) * 16)) & 0xFF;
      }

      const colorIdx = decodeTilePixel(bgCharAddr[0], subTile & 0xFF, tx & 7, py & 7, false, false);
      if (colorIdx !== 0) {
        const spritePriority = 12;
        if (spritePriority >= priorityBuffer[screenX]) {
          lineBuffer[screenX] = getCGRAMColor(palette, colorIdx);
          priorityBuffer[screenX] = spritePriority;
        }
      }
    }
  }
}

// ============================================================
//  SECTION 5: COLOR CYCLING
// ============================================================

function initColorCycling(preset) {
  colorCycleRanges = [];
  switch (preset) {
    case "full":
      for (let p = 0; p < 8; p++) {
        colorCycleRanges.push({
          palIdx: p, startCol: 1, endCol: 15,
          speed: 2 + (p & 3), counter: 0,
          direction: (p & 1) ? 1 : -1
        });
      }
      break;
    case "slow":
      colorCycleRanges.push({ palIdx: 0, startCol: 1, endCol: 15, speed: 8, counter: 0, direction: 1 });
      colorCycleRanges.push({ palIdx: 1, startCol: 4, endCol: 12, speed: 6, counter: 0, direction: -1 });
      break;
    case "split":
      for (let p = 0; p < 8; p++) {
        colorCycleRanges.push({ palIdx: p, startCol: 1, endCol: 7, speed: 3, counter: 0, direction: 1 });
        colorCycleRanges.push({ palIdx: p, startCol: 8, endCol: 15, speed: 5, counter: 0, direction: -1 });
      }
      break;
    case "pulse":
      colorCycleRanges.push({ palIdx: 0, startCol: 1, endCol: 15, speed: 1, counter: 0, direction: 1 });
      colorCycleRanges.push({ palIdx: 3, startCol: 1, endCol: 15, speed: 2, counter: 0, direction: -1 });
      colorCycleRanges.push({ palIdx: 5, startCol: 1, endCol: 15, speed: 3, counter: 0, direction: 1 });
      break;
    case "chase":
      for (let p = 0; p < 8; p++) {
        colorCycleRanges.push({
          palIdx: p, startCol: 1, endCol: 15,
          speed: 1 + p * 2, counter: 0,
          direction: (p & 1) ? 1 : -1
        });
      }
      break;
    case "breathe":
      for (let p = 0; p < 8; p++) {
        colorCycleRanges.push({
          palIdx: p, startCol: 1, endCol: 15,
          speed: 12 + (p & 3), counter: 0,
          direction: (p & 1) ? 1 : -1
        });
      }
      break;
    case "off":
      break;
  }
}

function updateColorCycling() {
  for (const range of colorCycleRanges) {
    range.counter++;
    if (range.counter < range.speed) continue;
    range.counter = 0;

    const base = range.palIdx * 16;
    const start = base + range.startCol;
    const end = base + range.endCol;

    if (range.direction > 0) {
      const savedLo = CGRAM[end * 2];
      const savedHi = CGRAM[end * 2 + 1];
      for (let i = end; i > start; i--) {
        CGRAM[i * 2] = CGRAM[(i - 1) * 2];
        CGRAM[i * 2 + 1] = CGRAM[(i - 1) * 2 + 1];
      }
      CGRAM[start * 2] = savedLo;
      CGRAM[start * 2 + 1] = savedHi;
    } else {
      const savedLo = CGRAM[start * 2];
      const savedHi = CGRAM[start * 2 + 1];
      for (let i = start; i < end; i++) {
        CGRAM[i * 2] = CGRAM[(i + 1) * 2];
        CGRAM[i * 2 + 1] = CGRAM[(i + 1) * 2 + 1];
      }
      CGRAM[end * 2] = savedLo;
      CGRAM[end * 2 + 1] = savedHi;
    }
  }
}

// ============================================================
//  SECTION 6: RASTER BAR BACKDROP
// ============================================================

function generateRasterGradient(style) {
  rasterEnabled = true;
  for (let i = 0; i < SCREEN_H; i++) {
    const t = i / SCREEN_H;
    let r, g, b;
    switch (style) {
      case "sunset":
        [r, g, b] = hslToRGB(280 - t * 80, 0.8, 0.05 + t * 0.15);
        break;
      case "ocean":
        [r, g, b] = hslToRGB(200 + t * 40, 0.7, 0.02 + t * 0.08);
        break;
      case "fire":
        [r, g, b] = hslToRGB(t * 40, 0.9, 0.03 + t * 0.2);
        break;
      case "void":
        [r, g, b] = hslToRGB(270 + Math.sin(t * 6) * 30, 0.5, 0.01 + t * 0.05);
        break;
      case "rainbow":
        [r, g, b] = hslToRGB(t * 360, 0.8, 0.08 + Math.sin(t * Math.PI) * 0.1);
        break;
      case "crt":
        const scanGlow = Math.sin(t * Math.PI * 112) * 0.02;
        [r, g, b] = hslToRGB(120, 0.6, 0.01 + scanGlow + t * 0.03);
        break;
      case "blood":
        [r, g, b] = hslToRGB(350 + t * 20, 0.85, 0.02 + (1 - t) * 0.12);
        break;
      case "amber":
        [r, g, b] = hslToRGB(35 + t * 10, 0.65, 0.01 + t * 0.18);
        break;
      case "synthwave": {
        const midDist = Math.abs(t - 0.5);
        const pinkStripe = midDist < 0.05 ? 0.25 : 0;
        const hue = 270 + t * 90; // purple to cyan
        [r, g, b] = hslToRGB(hue, 0.8, 0.02 + t * 0.1 + pinkStripe);
        break;
      }
      case "infrared": {
        // black -> red -> orange -> yellow -> white
        const lum = t * t * 0.35;
        const hue = t < 0.5 ? 0 : t < 0.75 ? t * 60 : 40 + t * 20;
        const sat = t > 0.85 ? 1.0 - (t - 0.85) * 6.0 : 0.95;
        [r, g, b] = hslToRGB(hue, Math.max(0, sat), lum);
        break;
      }
      case "midnight":
        [r, g, b] = hslToRGB(230 + Math.sin(t * 4) * 15, 0.4, 0.005 + Math.sin(t * Math.PI) * 0.015);
        break;
      default:
        [r, g, b] = hslToRGB(t * 180 + 180, 0.6, 0.03 + t * 0.06);
    }
    rasterColors[i] = rgbToSnesColor(r, g, b);
  }
}

// ============================================================
//  SECTION 7: WINDOW MASKING
// ============================================================

function applyWindowMask(screenX, scanline) {
  if (!windowEnabled) return false; // false = don't mask

  // Handle inverted ranges (left > right) — treat as wrapping window
  let inW1 = window1Left <= window1Right
    ? (screenX >= window1Left && screenX <= window1Right)
    : (screenX >= window1Left || screenX <= window1Right);
  let inW2 = window2Left <= window2Right
    ? (screenX >= window2Left && screenX <= window2Right)
    : (screenX >= window2Left || screenX <= window2Right);
  let masked = false;

  switch (windowMode) {
    case 1: masked = inW1; break;        // inside W1
    case 2: masked = !inW1; break;       // outside W1
    case 3: masked = inW1 && inW2; break; // W1 AND W2
    case 4: masked = inW1 !== inW2; break; // W1 XOR W2
    case 5: masked = inW1 || inW2; break;  // W1 OR W2
  }

  return masked;
}

// ============================================================
//  SECTION 8: ENHANCED FRAME RENDERER
// ============================================================

// Override the original renderFrame with enhanced version
function renderFrame() {
  // PERF: rebuild CGRAM cache once per frame (256 entries)
  rebuildCGRAMCache();
  reallocScanlineBuffers();

  // Animated raster offset
  const rasterOfs = rasterEnabled ? (rasterOffset = rasterOffset + 0.5, rasterOffset | 0) : 0;

  // PERF: pre-compute constants outside scanline loop
  const doColorMath = colorMathMode !== 0;
  const brFast = sceneBrightness >= 1.0;
  const br256 = brFast ? 256 : Math.max(0, (sceneBrightness * 256) | 0);
  const doWindow = windowEnabled;
  const BLACK = 0xFF000000;
  const windowColor = doWindow && windowMaskAction === 1
    ? (0xFF000000 | ((fixedColor.b << 3) << 16) | ((fixedColor.g << 3) << 8) | (fixedColor.r << 3))
    : BLACK;

  // PERF: pre-compute backdrop once
  let backdropPacked;
  if (!rasterEnabled) {
    backdropPacked = cgramCache[0]; // palette 0, color 0
  }

  // Reuse pre-allocated buffers
  const lineBuffer = _lineBuffer;
  const priorityBuffer = _priorityBuffer;

  for (let scanline = 0; scanline < SCREEN_H; scanline++) {
    applyHDMAEffects(scanline);

    // Fill backdrop (packed uint32, no object allocation)
    if (rasterEnabled) {
      const rIdx = (scanline + rasterOfs) % SCREEN_H;
      const rCol = rasterColors[rIdx];
      // Convert SNES 15-bit to packed RGBA inline
      const rw = rCol & 0x7FFF;
      const rpacked = 0xFF000000 |
        (((rw >> 10) & 0x1F) << 19) |
        (((rw >> 5) & 0x1F) << 11) |
        ((rw & 0x1F) << 3);
      lineBuffer.fill(rpacked, 0, SCREEN_W);
    } else {
      lineBuffer.fill(backdropPacked, 0, SCREEN_W);
    }
    priorityBuffer.fill(-1, 0, SCREEN_W);

    // BG layers
    if (ppuMode === 7) {
      renderMode7Scanline(scanline, lineBuffer, priorityBuffer);
    } else {
      for (let bg = 3; bg >= 0; bg--) {
        renderBGScanline(bg, scanline, lineBuffer, priorityBuffer);
      }
    }

    // Sprites
    renderSpriteScanline(scanline, lineBuffer, priorityBuffer);

    // Mosaic (works on uint32 values directly)
    applyMosaic(lineBuffer);

    // Window masking (packed — no object allocation)
    if (doWindow) {
      for (let x = 0; x < SCREEN_W; x++) {
        if (applyWindowMask(x, scanline)) {
          switch (windowMaskAction) {
            case 0: lineBuffer[x] = BLACK; break;
            case 1: lineBuffer[x] = windowColor; break;
            case 2: lineBuffer[x] = lineBuffer[x] ^ 0x00FFFFFF; break; // invert RGB
          }
        }
      }
    }

    // Write to framebuffer
    const fbOffset = scanline * SCREEN_W;
    if (!doColorMath && brFast) {
      // PERF: fast path — direct copy, no per-pixel math
      for (let x = 0; x < SCREEN_W; x++) {
        fb[fbOffset + x] = lineBuffer[x];
      }
    } else {
      for (let x = 0; x < SCREEN_W; x++) {
        let px = lineBuffer[x];
        if (doColorMath) px = applyColorMath(px);
        if (!brFast) {
          // Integer brightness: (channel * br256) >> 8
          const r = ((px & 0xFF) * br256) >> 8;
          const g = (((px >> 8) & 0xFF) * br256) >> 8;
          const b = (((px >> 16) & 0xFF) * br256) >> 8;
          px = 0xFF000000 | (b << 16) | (g << 8) | r;
        }
        fb[fbOffset + x] = px;
      }
    }
  }

  // Ghost frame overlay (PERF: integer alpha, no Math.floor/Math.max calls)
  if (ghostEnabled && ghostBuffer) {
    const a256 = Math.min(128, Math.max(0, (ghostAlpha * 256) | 0));
    const totalPixels = SCREEN_W * SCREEN_H;
    for (let i = 0; i < totalPixels; i++) {
      const curr = fb[i];
      const prev = ghostBuffer[i];
      // Decay previous frame and max with current
      const pr = ((prev & 0xFF) * a256) >> 8;
      const pg = (((prev >> 8) & 0xFF) * a256) >> 8;
      const pb = (((prev >> 16) & 0xFF) * a256) >> 8;
      const cr = curr & 0xFF;
      const cg = (curr >> 8) & 0xFF;
      const cb = (curr >> 16) & 0xFF;
      fb[i] = 0xFF000000 |
        (((cb > pb ? cb : pb)) << 16) |
        (((cg > pg ? cg : pg)) << 8) |
        ((cr > pr ? cr : pr));
    }
  }
  if (ghostEnabled) {
    const totalPixels = SCREEN_W * SCREEN_H;
    if (!ghostBuffer || ghostBuffer.length < totalPixels) {
      ghostBuffer = new Uint32Array(totalPixels);
    }
    ghostBuffer.set(fb.subarray(0, totalPixels));
  }

  ctx.putImageData(imgData, 0, 0);
}

// ============================================================
//  SECTION 9: NEW GLITCH TYPES
// ============================================================

// --- Sprite OAM corruption ---
function glitchSpriteCorrupt() {
  if (!spritesEnabled) return;
  const mode = glitchRandInt(4);
  switch (mode) {
    case 0: {
      // Scatter — randomize positions of some sprites
      const count = 4 + glitchRandInt(16);
      for (let i = 0; i < count; i++) {
        const idx = glitchRandInt(128) * 4;
        OAM[idx] = glitchRandInt(SCREEN_W) & 0xFF;
        OAM[idx + 1] = glitchRandInt(SCREEN_H) & 0xFF;
      }
      break;
    }
    case 1: {
      // Tile slide — increment all sprite tile indices
      const delta = 1 + glitchRandInt(8);
      for (let i = 0; i < 128; i++) {
        OAM[i * 4 + 2] = (OAM[i * 4 + 2] + delta) & 0xFF;
      }
      break;
    }
    case 2: {
      // Mirror OAM — copy first half over second half reversed
      for (let i = 0; i < 64; i++) {
        const src = i * 4;
        const dst = (127 - i) * 4;
        for (let b = 0; b < 4; b++) OAM[dst + b] = OAM[src + b];
      }
      break;
    }
    case 3: {
      // XOR OAM with VRAM data (bus conflict)
      const vAddr = glitchRandInt(VRAM_SIZE - 512);
      for (let i = 0; i < 512; i++) {
        OAM[i] ^= VRAM[(vAddr + i) & 0xFFFF];
      }
      break;
    }
  }
}

// --- Window glitch ---
function glitchWindow() {
  if (!windowEnabled) {
    windowEnabled = true;
    windowMode = 1 + glitchRandInt(5);
  }

  const cx = SCREEN_W >> 1;
  const mode = glitchRandInt(5);
  switch (mode) {
    case 0: // Shift window boundaries
      window1Left = Math.max(0, Math.min(SCREEN_W - 1, window1Left + glitchRandInt(20) - 10));
      window1Right = Math.max(0, Math.min(SCREEN_W - 1, window1Right + glitchRandInt(20) - 10));
      break;
    case 1: // Oscillate
      window1Left = Math.floor(cx + Math.sin(frameCount * 0.03) * (cx * 0.6));
      window1Right = Math.floor(cx + Math.cos(frameCount * 0.02) * (cx * 0.6));
      break;
    case 2: // Closing iris
      const w = Math.floor(Math.abs(Math.sin(frameCount * 0.01)) * cx);
      window1Left = cx - w;
      window1Right = cx + w;
      break;
    case 3: // Swap window mode
      windowMode = 1 + glitchRandInt(5);
      windowMaskAction = glitchRandInt(3);
      break;
    case 4: // Double window
      window2Left = glitchRandInt(cx);
      window2Right = cx + glitchRandInt(cx);
      windowMode = 3 + glitchRandInt(3); // AND, XOR, or OR
      break;
  }
}

// --- Color cycle glitch (desync cycling speeds) ---
function glitchColorCycleDesync() {
  if (colorCycleRanges.length === 0) return;
  const idx = glitchRandInt(colorCycleRanges.length);
  const range = colorCycleRanges[idx];
  const mode = glitchRandInt(3);
  switch (mode) {
    case 0: range.speed = Math.max(1, range.speed + glitchRandInt(5) - 2); break;
    case 1: range.direction *= -1; break;
    case 2: // Change range boundaries
      range.startCol = Math.max(1, range.startCol + glitchRandInt(3) - 1);
      range.endCol = Math.min(15, Math.max(range.startCol + 2, range.endCol + glitchRandInt(3) - 1));
      break;
  }
}

// --- Raster bar corruption ---
function glitchRasterCorrupt() {
  if (!rasterEnabled) return;
  const mode = glitchRandInt(3);
  switch (mode) {
    case 0: {
      // Shift raster table
      const shift = 1 + glitchRandInt(16);
      const saved = new Uint16Array(shift);
      for (let i = 0; i < shift; i++) saved[i] = rasterColors[i];
      for (let i = 0; i < SCREEN_H - shift; i++) rasterColors[i] = rasterColors[i + shift];
      for (let i = 0; i < shift; i++) rasterColors[SCREEN_H - shift + i] = saved[i];
      break;
    }
    case 1: {
      // XOR a section
      const start = glitchRandInt(SCREEN_H - 32);
      const len = 8 + glitchRandInt(32);
      const mask = glitchRandInt(0x7FFF);
      for (let i = start; i < start + len && i < SCREEN_H; i++) {
        rasterColors[i] ^= mask;
      }
      break;
    }
    case 2: {
      // Copy a section over another
      const src = glitchRandInt(SCREEN_H - 32);
      const dst = glitchRandInt(SCREEN_H - 32);
      const len = 8 + glitchRandInt(32);
      for (let i = 0; i < len && src + i < SCREEN_H && dst + i < SCREEN_H; i++) {
        rasterColors[dst + i] = rasterColors[src + i];
      }
      break;
    }
  }
}

// --- Ghost frame glitch ---
function glitchGhostFrame() {
  ghostEnabled = true;
  ghostAlpha = 0.1 + glitchRand() * 0.4; // capped to avoid wash-out
}

// ============================================================
//  SECTION 10: SCENE DIRECTOR
// ============================================================

const SCENE_DURATION_MS = 20000;      // 20 seconds in real time
const SCENE_TRANSITION_MS = 1000;     // 1 second transitions in real time
let lastFrameTime = performance.now(); // for delta-time tracking
let sceneElapsedMs = 0;               // real-time elapsed in current scene
let transitionElapsedMs = 0;          // real-time elapsed in current transition

const scenes = [
  // ---- SCENE 0: GENESIS ----
  {
    name: "GENESIS",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateBG2Tiles();
      generateEnhancedTiles();
      generateTilemaps();
      generateThemedPalette("ocean");
      rasterEnabled = false;
      ghostEnabled = false;
      windowEnabled = false;
      spritesEnabled = false;
      colorMathMode = 0;
      initColorCycling("slow");
      hdmaEffects = [];
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      // Gentle scrolling, slowly building tile morph
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      bgScrollY[0] = Math.floor(Math.sin(localFrame * 0.00125) * 4);
      if (localFrame % 4 === 0) bgScrollX[1] -= 1;
      if (localFrame % 4 === 0) bgScrollY[1] += 1;

      glitchIntensity = Math.min(0.5, localFrame * 0.0005);
      if (localFrame % 6 === 0) tileMorphInfection();
      if (localFrame % 12 === 0) tileMorphWanderingTiles();
      if (localFrame % 30 === 0 && glitchRand() < 0.4) glitchDMAMisfire();
    }
  },

  // ---- SCENE 1: DATA RAIN ----
  {
    name: "DATA RAIN",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("crt");
      generateRasterGradient("crt");
      initColorCycling("pulse");
      initParticles(48, "rain");
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.25;
      colorMathMode = 1;
      fixedColor = { r: 0, g: 4, b: 0 };

      // Set tilemaps to use enhanced tiles
      bgCharAddr[0] = 0x2000;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollY[0] += 3; // fast vertical scroll — tiles streaming down
      if (localFrame % 4 === 0) bgScrollX[1] += 1;
      if (localFrame % 4 === 0) bgScrollY[1] += 2;

      updateParticles();
      if (localFrame % 4 === 0) tileMorphColumnCascade();
      if (localFrame % 8 === 0) tileMorphRowDrag();
      if (localFrame % 20 === 0) glitchTilemapScramble();

      // Occasional DMA corruption bursts
      if (glitchRand() < 0.03) {
        glitchDMAMisfire();
        glitchDMAMisfire();
      }
    }
  },

  // ---- SCENE 2: CATHEDRAL ----
  {
    name: "CATHEDRAL",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateBG2Tiles();
      generateThemedPalette("stained");
      rasterEnabled = false;
      ghostEnabled = false;
      initColorCycling("full");
      spritesEnabled = false;
      windowEnabled = false;
      colorMathMode = 0;
      hdmaEffects = [];

      // Build symmetric tilemap for BG1 — cathedral window pattern
      const tmBase = bgTilemapAddr[0];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tmBase + (y * 32 + x) * 2) & 0xFFFF;
          // Mirror X around center
          const mx = x < 16 ? x : 31 - x;
          // Repeating vertical pattern
          const tileIdx = ((mx * 7 + y * 3) ^ (mx + y)) & 0xFF;
          const palette = (y >> 2) & 7;
          const entry = tileIdx | (palette << 10);
          VRAM[addr] = entry & 0xFF;
          VRAM[addr + 1] = (entry >> 8) & 0xFF;
        }
      }
      bgCharAddr[0] = 0x0000;
    },
    update(localFrame) {
      // Very slow, meditative vertical scroll
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      bgScrollX[1] = Math.floor(Math.sin(localFrame * 0.00075) * 8);
      if (localFrame % 4 === 0) bgScrollY[1] -= 1;

      // Mosaic breathing
      mosaicSize = 1 + Math.floor(Math.abs(Math.sin(localFrame * 0.002)) * 3);

      // Gentle tile morphing — splicing creates stained glass breeding
      if (localFrame % 8 === 0) tileMorphGenomeSplice();
      if (localFrame % 15 === 0) tileMorphTilemapEcho();
      if (localFrame % 40 === 0) glitchPaletteCorrupt();
    }
  },

  // ---- SCENE 3: SIGNAL ----
  {
    name: "SIGNAL",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("neon");
      generateRasterGradient("rainbow");
      initColorCycling("split");
      initParticles(32, "scatter");
      windowEnabled = true;
      windowMode = 4; // XOR
      window1Left = SCREEN_W >> 2; window1Right = (SCREEN_W * 3) >> 2;
      window2Left = SCREEN_W >> 3; window2Right = (SCREEN_W * 7) >> 3;
      windowMaskAction = 2; // invert
      ghostEnabled = true;
      ghostAlpha = 0.15;
      colorMathMode = 0;

      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x0000;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 3; // fast horizontal
      bgScrollY[0] = Math.floor(Math.sin(localFrame * 0.005) * 16);
      if (localFrame % 4 === 0) bgScrollX[1] -= 2;
      if (localFrame % 4 === 0) bgScrollY[1] += 1;

      // Oscillate windows
      const scx = SCREEN_W >> 1;
      window1Left = Math.floor(scx + Math.sin(localFrame * 0.00375) * (scx * 0.75));
      window1Right = Math.floor(scx + Math.cos(localFrame * 0.003) * (scx * 0.75));
      window2Left = Math.floor(scx + Math.sin(localFrame * 0.002 + 2) * (scx * 0.6));
      window2Right = Math.floor(scx + Math.cos(localFrame * 0.0025 + 1) * (scx * 0.6));

      updateParticles();

      // HDMA waviness
      if (localFrame % 60 === 0) glitchHDMA();

      // Corruption
      if (localFrame % 5 === 0) tileMorphCrossPollination();
      if (localFrame % 10 === 0) glitchVRAMBitRot();
      if (glitchRand() < 0.02) glitchBusConflict();
    }
  },

  // ---- SCENE 4: HORIZON ----
  {
    name: "HORIZON",
    setup() {
      ppuMode = 7;
      bgEnabled[0] = false; bgEnabled[1] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("sunset");
      generateRasterGradient("sunset");
      initColorCycling("slow");
      initParticles(24, "rise");
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.4;
      colorMathMode = 1;
      fixedColor = { r: 4, g: 2, b: 8 };
      m7a = 1; m7b = 0; m7c = 0; m7d = 1;
      m7x = SCREEN_W >> 1; m7y = SCREEN_H >> 1;
      m7hofs = 0; m7vofs = 0;

      // HDMA for Mode 7 perspective floor
      const scaleValues = [];
      for (let i = 0; i < SCREEN_H; i++) {
        if (i < 80) {
          scaleValues.push(0.1);
        } else {
          scaleValues.push(0.3 + ((i - 80) / 144) * 4.0);
        }
      }
      hdmaEffects = [
        { startScanline: 0, register: "m7a", values: scaleValues },
        { startScanline: 0, register: "m7d", values: [...scaleValues] }
      ];
    },
    update(localFrame) {
      // Slow rotation of the ground plane
      const angle = localFrame * 0.00075;
      m7a = Math.cos(angle);
      m7b = Math.sin(angle) * 0.3;
      m7c = -Math.sin(angle) * 0.3;
      m7d = Math.cos(angle);
      m7hofs = Math.floor(Math.sin(localFrame * 0.00125) * 50);
      if (localFrame % 4 === 0) m7vofs += 2;

      updateParticles();

      if (localFrame % 10 === 0) glitchMode7();
      if (localFrame % 20 === 0) glitchVRAMBitRot();
      if (glitchRand() < 0.02) glitchDMAMisfire();

      // Slowly corrupt the raster gradient
      if (localFrame % 30 === 0) glitchRasterCorrupt();
    }
  },

  // ---- SCENE 5: FEEDBACK ----
  {
    name: "FEEDBACK",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateBG2Tiles();
      generateThemedPalette("void");
      rasterEnabled = false;
      initColorCycling("full");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.5;
      colorMathMode = 3; // average
      fixedColor = { r: 8, g: 4, b: 16 };

      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x4000;
    },
    update(localFrame) {
      bgScrollX[0] = Math.floor(Math.sin(localFrame * 0.00175) * 32);
      bgScrollY[0] = Math.floor(Math.cos(localFrame * 0.00125) * 32);
      bgScrollX[1] = -bgScrollX[0];
      bgScrollY[1] = -bgScrollY[0];

      // Heavy feedback + cross-pollination
      if (localFrame % 3 === 0) tileMorphFeedback();
      if (localFrame % 5 === 0) tileMorphCrossPollination();
      if (localFrame % 7 === 0) tileMorphInfection();
      if (localFrame % 20 === 0) tileMorphGenomeSplice();

      // Evolving ghost intensity
      ghostAlpha = 0.3 + Math.sin(localFrame * 0.01) * 0.2;
    }
  },

  // ---- SCENE 6: RUINS ----
  {
    name: "RUINS",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("ruins");
      generateRasterGradient("void");
      initColorCycling("off");
      spritesEnabled = false;
      windowEnabled = true;
      windowMode = 1;
      windowMaskAction = 0;
      window1Left = 0; window1Right = SCREEN_W - 1;
      ghostEnabled = false;
      colorMathMode = 2; // subtract
      fixedColor = { r: 2, g: 2, b: 2 };

      bgCharAddr[0] = 0x2000; // enhanced tiles — bricks, circuits

      // Build architectural tilemap — columns and arches
      const tmBase = bgTilemapAddr[0];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tmBase + (y * 32 + x) * 2) & 0xFFFF;
          let tileIdx;
          // Columns every 6 tiles
          if (x % 6 === 0 || x % 6 === 5) {
            tileIdx = 192 + (y & 7); // brick family
          } else if (y < 4) {
            // Arch tops
            tileIdx = 160 + ((x + y * 3) & 0x1F); // rune family
          } else {
            tileIdx = ((x * 5 + y * 11) ^ (x * y)) & 0xFF;
          }
          const palette = (y < 4) ? 3 : (x % 6 < 2) ? 1 : 5;
          const entry = (tileIdx & 0xFF) | (palette << 10);
          VRAM[addr] = entry & 0xFF;
          VRAM[addr + 1] = (entry >> 8) & 0xFF;
        }
      }
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollY[0] += 1; // slow descent into ruins
      bgScrollX[1] = Math.floor(Math.sin(localFrame * 0.001) * 16);
      if (localFrame % 4 === 0) bgScrollY[1] += 2;

      // Window slowly reveals/conceals columns
      window1Left = Math.floor(Math.abs(Math.sin(localFrame * 0.0015)) * 128);
      window1Right = (SCREEN_W - 1) - window1Left;

      // Tiles crumble via DMA misfire
      if (localFrame % 12 === 0) glitchDMAMisfire();
      if (localFrame % 20 === 0) tileMorphCascade();
      if (localFrame % 30 === 0) tileMorphTilemapEcho();
      if (localFrame % 50 === 0) glitchBitplaneError();
    }
  },

  // ---- SCENE 7: GLITCH STORM ----
  {
    name: "GLITCH STORM",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateBG2Tiles();
      generateEnhancedTiles();
      generateThemedPalette("neon");
      generateRasterGradient("fire");
      initColorCycling("full");
      initParticles(64, "scatter");
      windowEnabled = true;
      windowMode = 4; // XOR
      windowMaskAction = 2; // invert
      ghostEnabled = true;
      ghostAlpha = 0.2;
      colorMathMode = 1;
      fixedColor = { r: 8, g: 0, b: 8 };

      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x2000;
    },
    update(localFrame) {
      // Everything at maximum chaos
      if (localFrame % 4 === 0) bgScrollX[0] += 2 + Math.floor(Math.sin(localFrame * 0.025) * 4);
      if (localFrame % 4 === 0) bgScrollY[0] += Math.floor(Math.cos(localFrame * 0.0175) * 3);
      if (localFrame % 4 === 0) bgScrollX[1] -= 3;
      if (localFrame % 4 === 0) bgScrollY[1] += 2;

      updateParticles();

      // All glitch types firing
      if (localFrame % 3 === 0) glitchDMAMisfire();
      if (localFrame % 4 === 0) tileMorphCrossPollination();
      if (localFrame % 5 === 0) tileMorphInfection();
      if (localFrame % 6 === 0) glitchTilemapScramble();
      if (localFrame % 7 === 0) glitchVRAMBitRot();
      if (localFrame % 8 === 0) glitchBitplaneError();
      if (localFrame % 10 === 0) glitchPaletteCorrupt();
      if (localFrame % 12 === 0) glitchBusConflict();
      if (localFrame % 15 === 0) glitchWindow();
      if (localFrame % 20 === 0) glitchSpriteCorrupt();
      if (localFrame % 25 === 0) glitchHDMA();

      // Window chaos
      const wcx = SCREEN_W >> 1;
      window1Left = Math.floor(wcx + Math.sin(localFrame * 0.0125) * (wcx * 0.9));
      window1Right = Math.floor(wcx + Math.cos(localFrame * 0.01) * (wcx * 0.9));
      window2Left = Math.floor(wcx + Math.sin(localFrame * 0.0075 + 1) * (wcx * 0.75));
      window2Right = Math.floor(wcx + Math.cos(localFrame * 0.00875 + 2) * (wcx * 0.75));
    }
  },

  // ---- SCENE 8: MANDALA ----
  {
    name: "MANDALA",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateThemedPalette("stained");
      rasterEnabled = false;
      initColorCycling("full");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 0;

      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x0000;

      // Build 4-way symmetric tilemap
      const tmBase = bgTilemapAddr[0];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tmBase + (y * 32 + x) * 2) & 0xFFFF;
          // Mirror both axes
          const mx = x < 16 ? x : 31 - x;
          const my = y < 16 ? y : 31 - y;
          const tileIdx = ((mx * mx + my * my) ^ (mx * my * 3)) & 0xFF;
          const palette = ((mx + my) >> 2) & 7;
          const hFlip = x >= 16 ? 1 : 0;
          const vFlip = y >= 16 ? 1 : 0;
          const entry = tileIdx | (palette << 10) | (hFlip << 14) | (vFlip << 15);
          VRAM[addr] = entry & 0xFF;
          VRAM[addr + 1] = (entry >> 8) & 0xFF;
        }
      }

      // BG2 gets opposite symmetry
      const tm2Base = bgTilemapAddr[1];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tm2Base + (y * 32 + x) * 2) & 0xFFFF;
          const mx = x < 16 ? x : 31 - x;
          const my = y < 16 ? y : 31 - y;
          const tileIdx = ((mx * 5 + my * 7) ^ ((mx ^ my) * 11)) & 0xFF;
          const palette = ((mx ^ my) >> 1) & 7;
          const entry = tileIdx | (palette << 10);
          VRAM[addr] = entry & 0xFF;
          VRAM[addr + 1] = (entry >> 8) & 0xFF;
        }
      }
    },
    update(localFrame) {
      // Counter-rotating scroll creates kaleidoscope
      const angle = localFrame * 0.001;
      bgScrollX[0] = Math.floor(Math.cos(angle) * 32);
      bgScrollY[0] = Math.floor(Math.sin(angle) * 32);
      bgScrollX[1] = Math.floor(Math.cos(-angle * 0.7) * 24);
      bgScrollY[1] = Math.floor(Math.sin(-angle * 0.7) * 24);

      // Gentle tile evolution — preserve symmetry
      if (localFrame % 10 === 0) tileMorphGenomeSplice();
      if (localFrame % 15 === 0) tileMorphInfection();
      if (localFrame % 30 === 0) tileMorphWanderingTiles();

      // Mosaic pulse
      mosaicSize = 1 + Math.floor(Math.abs(Math.sin(localFrame * 0.00375)) * 2);
    }
  },

  // ---- SCENE 9: DISSOLUTION ----
  {
    name: "DISSOLUTION",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      // DON'T regenerate tiles — use whatever corrupted state we're in
      // Just set palettes
      generateThemedPalette("blood");
      generateRasterGradient("blood");
      initColorCycling("pulse");
      initParticles(24, "rise");
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.35;
      colorMathMode = 2; // subtract
      fixedColor = { r: 0, g: 0, b: 0 };

      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x4000;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      if (localFrame % 4 === 0) bgScrollX[1] -= 1;
      if (localFrame % 4 === 0) bgScrollY[1] -= 1;

      updateParticles();

      // Progressively increase fixed color (fade to black via subtraction)
      const progress = Math.min(1, sceneElapsedMs / SCENE_DURATION_MS);
      fixedColor.r = Math.floor(progress * 20);
      fixedColor.g = Math.floor(progress * 20);
      fixedColor.b = Math.floor(progress * 20);

      // Aggressive corruption that accelerates
      const rate = Math.max(1, Math.floor(20 - progress * 18));
      if (localFrame % rate === 0) glitchDMAMisfire();
      if (localFrame % rate === 0) glitchTilemapScramble();
      if (localFrame % (rate * 2) === 0) glitchVRAMBitRot();
      if (localFrame % (rate * 2) === 0) tileMorphCrossPollination();
      if (localFrame % (rate * 3) === 0) glitchBusConflict();

      // Increase mosaic as we dissolve
      mosaicSize = 1 + Math.floor(progress * 8);

      // Ghost gets stronger
      ghostAlpha = 0.3 + progress * 0.4;
    }
  },

  // ---- SCENE 10: PHOSPHOR ----
  {
    name: "PHOSPHOR",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateBG2Tiles();
      generateThemedPalette("amber");
      rasterEnabled = false;
      initColorCycling("full");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.4;
      colorMathMode = 0;
      hdmaEffects = [];
      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x4000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      if (localFrame % 4 === 0) bgScrollX[1] -= 1;
      if (localFrame % 20 === 0) glitchDMAMisfire();
      if (localFrame % 30 === 0) glitchVRAMBitRot();
    }
  },

  // ---- SCENE 11: GRID ----
  {
    name: "GRID",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("neon");
      generateRasterGradient("rainbow");
      initColorCycling("split");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 0;
      hdmaEffects = [];
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x0000;

      // Build strict grid tilemap — every 4th tile is a border, rest empty
      const tmBase = bgTilemapAddr[0];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tmBase + (y * 32 + x) * 2) & 0xFFFF;
          const isBorder = (x % 4 === 0) || (y % 4 === 0);
          const tileIdx = isBorder ? (192 + (x & 7) + (y & 7)) & 0xFF : 0;
          const palette = isBorder ? ((x + y) >> 2) & 7 : 0;
          const entry = tileIdx | (palette << 10);
          VRAM[addr] = entry & 0xFF;
          VRAM[addr + 1] = (entry >> 8) & 0xFF;
        }
      }
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 3;
      // BG2 static
      if (localFrame % 8 === 0) glitchBitplaneError();
      if (localFrame % 12 === 0) glitchTilemapScramble();
    }
  },

  // ---- SCENE 12: SYNTHWAVE ----
  {
    name: "SYNTHWAVE",
    setup() {
      ppuMode = 7;
      bgEnabled[0] = false; bgEnabled[1] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("synthwave");
      generateRasterGradient("synthwave");
      initColorCycling("chase");
      initParticles(20, "rise");
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 0;
      m7a = 1; m7b = 0; m7c = 0; m7d = 1;
      m7x = SCREEN_W >> 1; m7y = SCREEN_H >> 1;
      m7hofs = 0; m7vofs = 0;
      hdmaEffects = [];
    },
    update(localFrame) {
      const angle = localFrame * 0.0005;
      m7a = Math.cos(angle);
      m7b = Math.sin(angle) * 0.2;
      m7c = -Math.sin(angle) * 0.2;
      m7d = Math.cos(angle);
      if (localFrame % 4 === 0) m7vofs += 1;
      updateParticles();
      if (localFrame % 15 === 0) glitchMode7();
      if (localFrame % 20 === 0) glitchScrollOverflow();
    }
  },

  // ---- SCENE 13: MOSS ----
  {
    name: "MOSS",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("moss");
      generateRasterGradient("void");
      initColorCycling("breathe");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.3;
      colorMathMode = 0;
      hdmaEffects = [];
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x0000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      if (localFrame % 4 === 0) bgScrollX[1] -= 1;
      if (localFrame % 4 === 0) bgScrollY[1] -= 1;
      if (localFrame % 6 === 0) tileMorphInfection();
    }
  },

  // ---- SCENE 14: INTERFERENCE ----
  {
    name: "INTERFERENCE",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateBG2Tiles();
      generateEnhancedTiles();
      generateThemedPalette("ice");
      rasterEnabled = false;
      initColorCycling("full");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 0;
      hdmaEffects = [];
      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x2000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 2;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      if (localFrame % 4 === 0) bgScrollX[1] -= 1;
      if (localFrame % 4 === 0) bgScrollY[1] += 3;
      if (localFrame % 10 === 0) tileMorphGenomeSplice();
      if (localFrame % 15 === 0) tileMorphWanderingTiles();
    }
  },

  // ---- SCENE 15: THERMAL ----
  {
    name: "THERMAL",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("infrared");
      generateRasterGradient("infrared");
      initColorCycling("pulse");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 1;
      fixedColor = { r: 4, g: 1, b: 0 };
      hdmaEffects = [];
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x0000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      fixedColor.r = Math.floor(8 + Math.sin(localFrame * 0.005) * 6) & 0x1F;
      fixedColor.g = Math.floor(3 + Math.sin(localFrame * 0.003) * 3) & 0x1F;
      if (localFrame % 10 === 0) glitchDMAMisfire();
      if (localFrame % 18 === 0) glitchBusConflict();
    }
  },

  // ---- SCENE 16: WATERFALL ----
  {
    name: "WATERFALL",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateBG2Tiles();
      generateEnhancedTiles();
      generateThemedPalette("ocean");
      generateRasterGradient("ocean");
      initColorCycling("slow");
      initParticles(36, "rain");
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 0;
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x4000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;

      // HDMA wavy scroll
      const waveValues = [];
      for (let i = 0; i < SCREEN_H; i++) {
        waveValues.push(Math.sin(i * 0.05) * 4);
      }
      hdmaEffects = [
        { startScanline: 0, register: "bgScrollX0", values: waveValues }
      ];
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollY[0] += 4;
      if (localFrame % 4 === 0) bgScrollY[1] += 2;
      updateParticles();
      if (localFrame % 2 === 0) tileMorphColumnCascade();
      if (localFrame % 25 === 0) glitchHDMA();
    }
  },

  // ---- SCENE 17: SHATTER ----
  {
    name: "SHATTER",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateBG2Tiles();
      generateTilemaps();
      generateThemedPalette("coral");
      rasterEnabled = false;
      initColorCycling("slow");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 0;
      hdmaEffects = [];
      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x4000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      if (localFrame % 4 === 0) bgScrollY[1] += 1;
      // Burst every 60 frames
      if (localFrame % 60 < 1) {
        glitchTilemapScramble();
        glitchTilemapScramble();
        glitchTilemapScramble();
        glitchTilemapScramble();
        glitchTilemapScramble();
        glitchDMAMisfire();
        glitchDMAMisfire();
        glitchDMAMisfire();
      }
      // Gentle between bursts
      if (localFrame % 10 === 0) tileMorphWanderingTiles();
    }
  },

  // ---- SCENE 18: MIDNIGHT ----
  {
    name: "MIDNIGHT",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("midnight");
      generateRasterGradient("midnight");
      initColorCycling("breathe");
      initParticles(12, "scatter");
      windowEnabled = true;
      windowMode = 2; // outside
      windowMaskAction = 0;
      window1Left = 0; window1Right = SCREEN_W - 1;
      ghostEnabled = true;
      ghostAlpha = 0.45;
      colorMathMode = 0;
      hdmaEffects = [];
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x0000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      updateParticles();
      // Slowly closing iris
      const cx = SCREEN_W >> 1;
      const w = Math.floor((0.5 + Math.sin(localFrame * 0.001) * 0.45) * cx);
      window1Left = cx - w;
      window1Right = cx + w;
    }
  },

  // ---- SCENE 19: TAPESTRY ----
  {
    name: "TAPESTRY",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("stained");
      rasterEnabled = false;
      initColorCycling("chase");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 0;
      hdmaEffects = [];
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x2000;

      // Build diagonal stripe tilemap
      const tmBase = bgTilemapAddr[0];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tmBase + (y * 32 + x) * 2) & 0xFFFF;
          const tileIdx = (x + y * 3) & 0xFF;
          const palette = y & 7;
          const entry = tileIdx | (palette << 10);
          VRAM[addr] = entry & 0xFF;
          VRAM[addr + 1] = (entry >> 8) & 0xFF;
        }
      }
      // BG2 gets different palette assignment per row
      const tm2Base = bgTilemapAddr[1];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tm2Base + (y * 32 + x) * 2) & 0xFFFF;
          const tileIdx = (x * 2 + y * 5) & 0xFF;
          const palette = (y + 4) & 7;
          const entry = tileIdx | (palette << 10);
          VRAM[addr] = entry & 0xFF;
          VRAM[addr + 1] = (entry >> 8) & 0xFF;
        }
      }
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      if (localFrame % 4 === 0) bgScrollX[1] -= 1;
      if (localFrame % 8 === 0) tileMorphTilemapEcho();
      if (localFrame % 12 === 0) tileMorphFeedback();
    }
  },

  // ---- SCENE 20: STATIC ----
  {
    name: "STATIC",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("neon");
      generateRasterGradient("crt");
      initColorCycling("off");
      initParticles(32, "scatter");
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 0;
      hdmaEffects = [];
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x0000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 3;
      if (localFrame % 4 === 0) bgScrollY[0] += 2;
      if (localFrame % 4 === 0) bgScrollX[1] -= 2;
      if (localFrame % 4 === 0) bgScrollY[1] += 1;
      updateParticles();
      glitchVRAMBitRot();
      glitchVRAMBitRot();
      glitchTilemapScramble();
    }
  },

  // ---- SCENE 21: PULSE ----
  {
    name: "PULSE",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("fire");
      generateRasterGradient("fire");
      initColorCycling("pulse");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 1;
      fixedColor = { r: 4, g: 2, b: 0 };
      hdmaEffects = [];
      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x2000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      // Mosaic breathes 1-6 via sine
      mosaicSize = 1 + Math.floor((Math.sin(localFrame * 0.02) * 0.5 + 0.5) * 5);
      // Pulsing fixed color
      fixedColor.r = Math.floor(6 + Math.sin(localFrame * 0.015) * 5) & 0x1F;
      fixedColor.g = Math.floor(3 + Math.sin(localFrame * 0.01) * 3) & 0x1F;
      if (localFrame % 8 === 0) tileMorphCrossPollination();
      if (localFrame % 12 === 0) tileMorphGenomeSplice();
    }
  },

  // ---- SCENE 22: DRIFTER ----
  {
    name: "DRIFTER",
    setup() {
      ppuMode = 7;
      bgEnabled[0] = false; bgEnabled[1] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("forest");
      rasterEnabled = false;
      initColorCycling("slow");
      initParticles(16, "rise");
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.2;
      colorMathMode = 0;
      m7a = 1; m7b = 0; m7c = 0; m7d = 1;
      m7x = SCREEN_W >> 1; m7y = SCREEN_H >> 1;
      m7hofs = 0; m7vofs = 0;
      hdmaEffects = [];
    },
    update(localFrame) {
      const angle = localFrame * 0.0002;
      m7a = Math.cos(angle);
      m7b = Math.sin(angle) * 0.1;
      m7c = -Math.sin(angle) * 0.1;
      m7d = Math.cos(angle);
      if (localFrame % 4 === 0) m7vofs += 1;
      m7hofs = Math.floor(Math.sin(localFrame * 0.0008) * 20);
      updateParticles();
      if (localFrame % 40 === 0) glitchMode7();
    }
  },

  // ---- SCENE 23: CORRUPTION GARDEN ----
  {
    name: "CORRUPTION GARDEN",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("amber");
      generateRasterGradient("void");
      initColorCycling("full");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 0;
      hdmaEffects = [];
      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x2000;

      // Build "garden" tilemap — scattered clusters with empty space
      const tmBase = bgTilemapAddr[0];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tmBase + (y * 32 + x) * 2) & 0xFFFF;
          // Clusters: use a hash to decide if this cell is populated
          const hash = ((x * 7 + y * 13 + x * y * 3 + 12345) >>> 0) % 100;
          const inCluster = hash < 30;
          const tileIdx = inCluster ? ((x * 11 + y * 7) & 0xFF) : 0;
          const palette = inCluster ? ((x + y) >> 1) & 7 : 0;
          const entry = tileIdx | (palette << 10);
          VRAM[addr] = entry & 0xFF;
          VRAM[addr + 1] = (entry >> 8) & 0xFF;
        }
      }
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      if (localFrame % 6 === 0) tileMorphInfection();
      if (localFrame % 10 === 0) tileMorphGenomeSplice();
      if (localFrame % 12 === 0) tileMorphFeedback();
      if (localFrame % 14 === 0) tileMorphCrossPollination();
    }
  },

  // ---- SCENE 24: RAVE ----
  {
    name: "RAVE",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateBG2Tiles();
      generateThemedPalette("synthwave");
      generateRasterGradient("rainbow");
      initColorCycling("chase");
      initParticles(48, "scatter");
      windowEnabled = true;
      windowMode = 4; // XOR
      windowMaskAction = 2; // invert
      window1Left = 64; window1Right = 192;
      window2Left = 32; window2Right = 224;
      ghostEnabled = false;
      colorMathMode = 1;
      fixedColor = { r: 8, g: 0, b: 12 };
      hdmaEffects = [];
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x4000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 2;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      if (localFrame % 4 === 0) bgScrollX[1] -= 1;
      if (localFrame % 4 === 0) bgScrollY[1] += 2;
      updateParticles();
      // Fast-oscillating window boundaries
      const cx = SCREEN_W >> 1;
      window1Left = Math.floor(cx + Math.sin(localFrame * 0.025) * (cx * 0.8));
      window1Right = Math.floor(cx + Math.cos(localFrame * 0.03) * (cx * 0.8));
      window2Left = Math.floor(cx + Math.sin(localFrame * 0.02 + 1) * (cx * 0.6));
      window2Right = Math.floor(cx + Math.cos(localFrame * 0.015 + 2) * (cx * 0.6));
      // Alternate add/sub every 120 frames
      colorMathMode = (Math.floor(localFrame / 120) & 1) ? 2 : 1;
      // All glitch types at low probability
      if (localFrame % 20 === 0) glitchDMAMisfire();
      if (localFrame % 25 === 0) glitchVRAMBitRot();
      if (localFrame % 30 === 0) glitchTilemapScramble();
      if (localFrame % 35 === 0) glitchBitplaneError();
      if (localFrame % 40 === 0) glitchPaletteCorrupt();
      if (localFrame % 45 === 0) glitchBusConflict();
      if (localFrame % 50 === 0) glitchScrollOverflow();
      if (localFrame % 55 === 0) glitchHDMA();
    }
  },
];

// --- Scene transition logic ---
let pendingScene = -1;

function transitionToScene(idx) {
  sceneTransitionPhase = 1; // start fade-out
  transitionElapsedMs = 0;
  pendingScene = idx; // don't switch yet — wait for phase 2
}

function updateSceneDirector(deltaMs) {
  sceneTimer++; // frame counter still used by scene update() for animation

  switch (sceneTransitionPhase) {
    case 0: // Running
      sceneElapsedMs += deltaMs;
      if (currentScene >= 0 && currentScene < scenes.length) {
        scenes[currentScene].update(sceneTimer);
        sceneName = scenes[currentScene].name;
      }

      // Auto-advance based on real time
      if (sceneAutoAdvance && sceneElapsedMs >= SCENE_DURATION_MS) {
        const nextScene = (currentScene + 1) % scenes.length;
        transitionToScene(nextScene);
      }
      break;

    case 1: { // Fade-out
      transitionElapsedMs += deltaMs;
      const t = Math.min(1, transitionElapsedMs / SCENE_TRANSITION_MS);
      sceneBrightness = Math.max(0, 1.0 - t);
      mosaicSize = 1 + Math.min(15, (t * 12) | 0);

      if (transitionElapsedMs >= SCENE_TRANSITION_MS) {
        sceneTransitionPhase = 2;
        transitionElapsedMs = 0;
      }
      break;
    }

    case 2: // Switch
      sceneBrightness = 0;
      mosaicSize = 16;
      if (pendingScene >= 0) {
        currentScene = pendingScene;
        pendingScene = -1;
      }
      if (currentScene >= 0 && currentScene < scenes.length) {
        scenes[currentScene].setup();
      }
      sceneTimer = 0;
      sceneElapsedMs = 0;
      sceneTransitionPhase = 3;
      transitionElapsedMs = 0;
      break;

    case 3: { // Fade-in
      transitionElapsedMs += deltaMs;
      const t = Math.min(1, transitionElapsedMs / SCENE_TRANSITION_MS);
      sceneBrightness = t;
      mosaicSize = 1 + Math.min(15, ((1 - t) * 12) | 0);

      if (transitionElapsedMs >= SCENE_TRANSITION_MS) {
        sceneBrightness = 1.0;
        mosaicSize = 1;
        sceneTransitionPhase = 0;
        transitionElapsedMs = 0;
      }
      break;
  }
  } // end switch
} // end updateSceneDirector

// ============================================================
//  SECTION 11: ENHANCED INPUT
// ============================================================

// Remove old keydown listener by overriding (it's in global scope)
document.addEventListener("keydown", (e) => {
  switch (e.key) {
    case " ":
      e.preventDefault();
      lastGlitchBurst = frameCount;
      for (let i = 0; i < 15; i++) {
        GLITCH_FNS[glitchRandInt(GLITCH_FNS.length)]();
      }
      // Also fire new glitches
      glitchSpriteCorrupt();
      glitchWindow();
      glitchRasterCorrupt();
      break;
    case "1": case "2": case "3": case "4":
    case "5": case "6": case "7": case "8": case "9":
      glitchMode = parseInt(e.key);
      sceneAutoAdvance = false;
      break;
    case "0":
      glitchMode = 0;
      sceneAutoAdvance = true;
      break;
    case "r":
    case "R":
      resetPPU();
      generateEnhancedTiles();
      if (currentScene >= 0 && currentScene < scenes.length) {
        scenes[currentScene].setup();
      }
      sceneTimer = 0;
      sceneElapsedMs = 0;
      break;
    case "m":
    case "M":
      ppuMode = ppuMode === 7 ? 1 : 7;
      bgEnabled[0] = ppuMode !== 7;
      bgEnabled[1] = ppuMode !== 7;
      break;
    case "f":
    case "F":
      frozen = !frozen;
      break;
    case "t":
    case "T":
      glitchMode = glitchMode === 10 ? 0 : 10;
      if (glitchMode === 10) {
        tileMorphTimer = 0;
        tileMorphPhase = 0;
        tileMorphWanderAccum.fill(0);
        tileMorphInfectionMap.fill(0);
      }
      break;
    case "n":
    case "N":
      // Next scene
      transitionToScene((currentScene + 1) % scenes.length);
      break;
    case "p":
    case "P":
      // Previous scene
      transitionToScene((currentScene - 1 + scenes.length) % scenes.length);
      break;
    case "a":
    case "A":
      // Toggle auto-advance
      sceneAutoAdvance = !sceneAutoAdvance;
      break;
    case "g":
    case "G":
      // Toggle ghost/phosphor
      ghostEnabled = !ghostEnabled;
      break;
    case "w":
    case "W":
      // Toggle window
      windowEnabled = !windowEnabled;
      break;
    case "s":
    case "S":
      // Screenshot
      {
        const link = document.createElement("a");
        link.download = `snes_corruption_${Date.now()}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      }
      break;
    case "h":
    case "H":
      hudVisible = !hudVisible;
      break;
    case "Enter":
    case "F11":
      e.preventDefault();
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        exitFullscreen();
      } else {
        enterFullscreen();
      }
      break;
  }
});

// ============================================================
//  SECTION 12: ENHANCED UI
// ============================================================

let hudVisible = false;

function updateUI() {
  if (!hudVisible) {
    ui.innerHTML = "";
    document.getElementById("controls").style.display = "none";
    return;
  }

  document.getElementById("controls").style.display = "";

  const modeStr = ppuMode === 7 ? "MODE 7" : `MODE ${ppuMode}`;
  const glitchStr = glitchMode === 0 ? "AUTO" : (GLITCH_NAMES[glitchMode - 1] || "AUTO");
  const activeStr = activeGlitchNames.slice(0, 4).join(" + ") || "—";

  const iFill = Math.max(0, Math.min(16, Math.floor(glitchIntensity * 16)));
  const intensityBar = "█".repeat(iFill) + "░".repeat(16 - iFill);

  // Scene progress bar
  const sFill = Math.max(0, Math.min(12, Math.floor((sceneElapsedMs / SCENE_DURATION_MS) * 12)));
  const sceneBar = "█".repeat(sFill) + "░".repeat(12 - sFill);

  let tileMorphStr = "";
  if (glitchMode === 10) {
    const pFill = Math.max(0, Math.min(10, Math.floor((tileMorphTimer / tileMorphCycleLen) * 10)));
    const phaseBar = "█".repeat(pFill) + "░".repeat(10 - pFill);
    tileMorphStr = `<div style="color:#f8a">Morph: ${tileMorphPhaseName} [${phaseBar}] E${tileMorphEpoch}</div>`;
  }

  const features = [];
  if (spritesEnabled) features.push("SPR");
  if (windowEnabled) features.push("WIN");
  if (ghostEnabled) features.push("GHO");
  if (rasterEnabled) features.push("RST");
  if (colorCycleRanges.length > 0) features.push("CYC");
  if (colorMathMode > 0) features.push("MTH");
  const featStr = features.join(" ");

  const transStr = sceneTransitionPhase > 0 ?
    `<div style="color:#ff0">▸ ${["","FADE OUT","SWITCH","FADE IN"][sceneTransitionPhase]}</div>` : "";

  ui.innerHTML = `
    <div style="color:#aaa">SNES PPU CORRUPTION ENGINE</div>
    <div style="color:#666">────────────────────────────</div>
    <div>Scene: <span style="color:#8ff">${sceneName}</span> [${sceneBar}] ${sceneAutoAdvance ? "AUTO" : "MANUAL"}</div>
    ${transStr}
    <div>${modeStr} │ ${SCREEN_W}×${SCREEN_H} │ F${frameCount} │ ${frozen ? "FROZEN" : "LIVE"}</div>
    <div>Intensity: [${intensityBar}]</div>
    <div style="color:#666">${activeStr}</div>
    <div style="color:#555">${featStr}</div>
    ${tileMorphStr}
  `;
}

// ============================================================
//  SECTION 13: ENHANCED MAIN LOOP
// ============================================================

function mainLoop() {
  try {
  // Real-time delta
  const now = performance.now();
  const deltaMs = Math.min(now - lastFrameTime, 100); // cap at 100ms to avoid spiral
  lastFrameTime = now;

  if (!frozen) {
    // Clear stale HDMA effects — hard cap + probabilistic cleanup
    if (hdmaEffects.length > 12) {
      hdmaEffects = hdmaEffects.slice(-4);
    } else if (glitchRand() < 0.08) {
      hdmaEffects = hdmaEffects.slice(-4);
    }

    // Reset per-frame registers
    mosaicSize = 1;

    // Scene director handles most updates now (real-time based)
    updateSceneDirector(deltaMs);

    // Color cycling runs independently
    updateColorCycling();

    // If in manual glitch mode, apply the selected glitch
    if (glitchMode > 0 && sceneTransitionPhase === 0) {
      const idx = glitchMode - 1;
      if (idx < GLITCH_FNS.length) {
        GLITCH_FNS[idx]();
        activeGlitchNames = [GLITCH_NAMES[idx]];
      }
    }

    renderFrame();
    frameCount++;
  }

  // PERF: throttle UI updates — DOM innerHTML is expensive
  if (frameCount % 10 === 0) updateUI();
  } catch (e) {
    // Don't let a single frame error kill the animation loop
    console.warn("Frame error:", e);
  }
  requestAnimationFrame(mainLoop);
}

// ============================================================
//  SECTION 14: FULLSCREEN + ADAPTIVE RESOLUTION
// ============================================================

let isFullscreen = false;

function calculateSNESResolution() {
  // Figure out how many SNES-sized pixels fill the screen
  // Use integer scaling based on screen height, extend width to fill aspect ratio
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  // Integer scale factor that fills the height
  const scale = Math.max(1, Math.floor(screenH / SNES_H));

  // How many SNES pixels we need at this scale to fill the screen
  const snesW = Math.ceil(screenW / scale);
  const snesH = Math.ceil(screenH / scale);

  return { snesW, snesH, scale };
}

function enterFullscreen() {
  const el = document.documentElement;
  const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (rfs) rfs.call(el);
}

function exitFullscreen() {
  const efs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if (efs) efs.call(document);
}

function applyFullscreenResolution() {
  const { snesW, snesH, scale } = calculateSNESResolution();

  // Resize the PPU framebuffer to the new resolution
  resizePPU(snesW, snesH);

  // Size the canvas via CSS to fill screen with integer pixel scaling
  canvas.style.width = (snesW * scale) + "px";
  canvas.style.height = (snesH * scale) + "px";

  // Regenerate raster bars for new height
  if (rasterEnabled) {
    // Re-run whatever raster style the current scene uses
    // (the scene setup will handle this on next transition)
  }

  // Reset ghost buffer for new size
  ghostBuffer = null;

  isFullscreen = true;
}

function applyWindowedResolution() {
  // Same logic as fullscreen — always fill the viewport
  applyFullscreenResolution();
  isFullscreen = false;
}

// Listen for fullscreen changes (ESC exits fullscreen via browser)
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) {
    applyFullscreenResolution();
  } else {
    applyWindowedResolution();
  }
});
document.addEventListener("webkitfullscreenchange", () => {
  if (document.webkitFullscreenElement) {
    applyFullscreenResolution();
  } else {
    applyWindowedResolution();
  }
});

// Always refill viewport on resize
window.addEventListener("resize", () => {
  applyFullscreenResolution();
});

// ============================================================
//  SECTION 15: BOOT SEQUENCE
// ============================================================

// Push new glitch types into the dispatcher
GLITCH_NAMES.push("Sprite Corrupt", "Window Glitch", "Cycle Desync", "Raster Corrupt", "Ghost Frame");
GLITCH_FNS.push(glitchSpriteCorrupt, glitchWindow, glitchColorCycleDesync, glitchRasterCorrupt, glitchGhostFrame);

// Only auto-boot when loaded from index.html (not render.html)
// render.html defines OFFLINE_RENDER before loading engine.js
if (typeof OFFLINE_RENDER === "undefined") {
  // Fill the viewport immediately
  applyFullscreenResolution();

  // Initialize PPU with enhanced tiles
  resetPPU();
  generateEnhancedTiles();

  // Start with a random scene
  currentScene = Math.floor(Math.random() * scenes.length);
  scenes[currentScene].setup();
  sceneTimer = 0;
  sceneElapsedMs = 0;
  transitionElapsedMs = 0;
  sceneTransitionPhase = 3; // fade in from black
  sceneBrightness = 0;
  lastFrameTime = performance.now();

  // GO
  mainLoop();
}
