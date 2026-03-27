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
//  SECTION 2B: DITHERING TILE PATTERNS
// ============================================================

// 32 classic SNES dithering pattern tiles at VRAM address 0x5000
function generateDitherTiles() {
  const base = 0x5000;

  for (let tile = 0; tile < 32; tile++) {
    const addr = base + tile * 32;
    for (let row = 0; row < 8; row++) {
      let pixels = new Uint8Array(8);
      const group = (tile >> 3) & 3; // 0-3: four families of 8

      switch (group) {
        case 0: { // Ordered Bayer matrix dithering (8 tiles)
          const variant = tile & 7;
          // Bayer matrices at different sizes/thresholds
          const bayer2x2 = [0, 2, 3, 1]; // 2x2 normalized
          const bayer4x4 = [
             0,  8,  2, 10,
            12,  4, 14,  6,
             3, 11,  1,  9,
            15,  7, 13,  5
          ];
          const bayer8x8 = [
             0, 32,  8, 40,  2, 34, 10, 42,
            48, 16, 56, 24, 50, 18, 58, 26,
            12, 44,  4, 36, 14, 46,  6, 38,
            60, 28, 52, 20, 62, 30, 54, 22,
             3, 35, 11, 43,  1, 33,  9, 41,
            51, 19, 59, 27, 49, 17, 57, 25,
            15, 47,  7, 39, 13, 45,  5, 37,
            63, 31, 55, 23, 61, 29, 53, 21
          ];

          for (let x = 0; x < 8; x++) {
            let threshold, matrixVal;
            if (variant < 2) {
              // 2x2 Bayer, two threshold levels
              matrixVal = bayer2x2[(row & 1) * 2 + (x & 1)];
              threshold = variant === 0 ? 1 : 2;
              pixels[x] = matrixVal >= threshold ? (1 + variant) : 0;
            } else if (variant < 5) {
              // 4x4 Bayer at three threshold levels
              matrixVal = bayer4x4[(row & 3) * 4 + (x & 3)];
              threshold = 4 + (variant - 2) * 4; // 4, 8, 12
              const colA = 1 + (variant - 2);
              const colB = 4 - (variant - 2);
              pixels[x] = matrixVal >= threshold ? colA : colB;
            } else {
              // 8x8 Bayer at three threshold levels
              matrixVal = bayer8x8[row * 8 + x];
              threshold = 16 + (variant - 5) * 16; // 16, 32, 48
              const colA = 2 + (variant - 5);
              const colB = 3 - (variant - 5);
              pixels[x] = matrixVal >= threshold ? colA : colB;
            }
          }
          break;
        }

        case 1: { // Checkerboard patterns (8 tiles)
          const variant = tile & 7;
          for (let x = 0; x < 8; x++) {
            switch (variant) {
              case 0: // Standard 1x1 checkerboard
                pixels[x] = ((x ^ row) & 1) ? 2 : 1;
                break;
              case 1: // Offset checkerboard (shifted every other row)
                pixels[x] = (((x + (row >> 1)) ^ row) & 1) ? 3 : 1;
                break;
              case 2: // Double-width checkerboard (2x1 blocks)
                pixels[x] = (((x >> 1) ^ row) & 1) ? 2 : 4;
                break;
              case 3: // Double-height checkerboard (1x2 blocks)
                pixels[x] = ((x ^ (row >> 1)) & 1) ? 1 : 3;
                break;
              case 4: // 2x2 block checkerboard
                pixels[x] = (((x >> 1) ^ (row >> 1)) & 1) ? 2 : 1;
                break;
              case 5: // Alternating-row checkerboard with color pair swap
                pixels[x] = ((x ^ row) & 1) ? ((row & 2) ? 4 : 2) : ((row & 2) ? 1 : 3);
                break;
              case 6: // Sparse checkerboard (every 3rd pixel)
                pixels[x] = ((x % 3 === 0) && (row % 3 === 0)) ? 3 : ((x + row) & 1) ? 1 : 0;
                break;
              case 7: // Dense checkerboard with border highlight
                pixels[x] = (x === 0 || x === 7 || row === 0 || row === 7)
                  ? 4 : ((x ^ row) & 1) ? 2 : 1;
                break;
            }
          }
          break;
        }

        case 2: { // Horizontal line dithering (8 tiles)
          const variant = tile & 7;
          for (let x = 0; x < 8; x++) {
            switch (variant) {
              case 0: // Every-other-line
                pixels[x] = (row & 1) ? 2 : 0;
                break;
              case 1: // Every-other-line inverse
                pixels[x] = (row & 1) ? 0 : 3;
                break;
              case 2: // Every-third-line
                pixels[x] = (row % 3 === 0) ? 2 : 0;
                break;
              case 3: // Every-third-line double-thick
                pixels[x] = (row % 3 !== 2) ? 1 : 0;
                break;
              case 4: // Gradient fade: dense at top, sparse at bottom
                pixels[x] = (row < 2) ? 3 : (row < 4) ? ((x & 1) ? 2 : 0) :
                  (row < 6) ? ((x % 3 === 0) ? 1 : 0) : 0;
                break;
              case 5: // Inverse gradient: sparse at top, dense at bottom
                pixels[x] = (row >= 6) ? 3 : (row >= 4) ? ((x & 1) ? 2 : 0) :
                  (row >= 2) ? ((x % 3 === 0) ? 1 : 0) : 0;
                break;
              case 6: // Paired scan lines (two on, two off)
                pixels[x] = ((row >> 1) & 1) ? 2 : 0;
                break;
              case 7: // Alternating color scan lines
                pixels[x] = [1, 0, 2, 0, 3, 0, 4, 0][row];
                break;
            }
          }
          break;
        }

        case 3: { // Diagonal / cross / dot dithering (8 tiles)
          const variant = tile & 7;
          for (let x = 0; x < 8; x++) {
            switch (variant) {
              case 0: // 45-degree diagonal stripes (2px wide)
                pixels[x] = ((x + row) & 3) < 2 ? 2 : 0;
                break;
              case 1: // 45-degree diagonal stripes (1px)
                pixels[x] = ((x + row) & 3) === 0 ? 3 : 0;
                break;
              case 2: // Opposite diagonal stripes
                pixels[x] = ((x - row + 8) & 3) < 2 ? 1 : 0;
                break;
              case 3: // Cross-hatch (both diagonals)
                pixels[x] = (((x + row) & 3) === 0 || ((x - row + 8) & 3) === 0) ? 3 : 0;
                break;
              case 4: // Diamond pattern
                pixels[x] = ((Math.abs(x - 3.5) + Math.abs(row - 3.5)) < 3) ? 2 :
                  ((Math.abs(x - 3.5) + Math.abs(row - 3.5)) < 4) ? 1 : 0;
                break;
              case 5: // Dot screen (halftone)
                pixels[x] = ((x & 3) === 0 && (row & 3) === 0) ? 4 :
                  ((x & 3) === 2 && (row & 3) === 2) ? 2 : 0;
                break;
              case 6: // Wide cross-hatch
                pixels[x] = (((x + row) % 4 < 2) && ((x - row + 8) % 4 < 2)) ? 3 : 1;
                break;
              case 7: // Stipple (pseudo-random ordered dots)
                pixels[x] = (((x * 5 + row * 3) & 7) < 2) ? 2 :
                  (((x * 3 + row * 7) & 7) < 1) ? 4 : 0;
                break;
            }
          }
          break;
        }
      }

      // Encode as 4bpp bitplanes (same layout as other tile generators)
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
//  SECTION 2C: MODE 7 PERSPECTIVE FLOOR HELPER
// ============================================================

// Sets up a Mode 7 perspective floor with per-scanline HDMA scaling.
// horizonLine: scanline where the floor begins (above = sky)
// scale: base scale multiplier for the floor
// rotation: initial rotation angle in radians
function setupMode7PerspectiveFloor(horizonLine, scale, rotation) {
  ppuMode = 7;
  bgEnabled[0] = false;
  bgEnabled[1] = false;

  m7x = SCREEN_W >> 1;
  m7y = SCREEN_H >> 1;
  m7hofs = 0;
  m7vofs = 0;

  // Set base rotation
  m7a = Math.cos(rotation) * scale;
  m7b = Math.sin(rotation) * scale;
  m7c = -Math.sin(rotation) * scale;
  m7d = Math.cos(rotation) * scale;

  // Build per-scanline HDMA tables for the perspective effect.
  // Above the horizon: very small scale values (sky tiles stay flat/tiled).
  // Below the horizon: progressive scaling that creates a receding plane.
  // Scanlines near horizon = large m7a/m7d (far away, zoomed out).
  // Scanlines at bottom = small m7a/m7d (close, zoomed in).
  const m7aValues = [];
  const m7dValues = [];

  for (let i = 0; i < SCREEN_H; i++) {
    if (i < horizonLine) {
      // Above horizon — sky; use a tiny flat scale so tiles remain visible
      m7aValues.push(0.05 * Math.cos(rotation));
      m7dValues.push(0.05 * Math.cos(rotation));
    } else {
      // Perspective floor: distance from horizon determines scale
      const distFromHorizon = i - horizonLine + 1; // 1..N
      const maxDist = SCREEN_H - horizonLine;
      // Near horizon (small distFromHorizon) = far away = large scale factor
      // Near bottom (large distFromHorizon) = close up = small scale factor
      const perspectiveScale = (maxDist / distFromHorizon) * scale * 0.15;
      m7aValues.push(perspectiveScale * Math.cos(rotation));
      m7dValues.push(perspectiveScale * Math.cos(rotation));
    }
  }

  hdmaEffects = [
    { startScanline: 0, register: "m7a", values: m7aValues },
    { startScanline: 0, register: "m7d", values: m7dValues }
  ];
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
  markCGRAMDirty();
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
  markCGRAMDirty();
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
    if (mosaicSize > 1) applyMosaic(lineBuffer);

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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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
      generateDitherTiles();
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

  // ---- SCENE 25: RACING HORIZON ----
  {
    name: "RACING HORIZON",
    setup() {
      // Mode 7 perspective floor with dither-tile ground pattern
      const horizonLine = 80;
      setupMode7PerspectiveFloor(horizonLine, 1.0, 0);

      // Generate ground tile data — use dither tiles for an interesting floor
      generateTileData();
      generateEnhancedTiles();
      generateDitherTiles();

      // Write a ground pattern into Mode 7 tilemap area using dither tile indices.
      // Mode 7 tilemap: 128x128 entries at VRAM[0..16383], each byte = tile index.
      // We write a repeating pattern that mixes checkerboard and stripe dither tiles
      // to create a visible grid-like racing ground.
      for (let ty = 0; ty < 128; ty++) {
        for (let tx = 0; tx < 128; tx++) {
          const addr = (ty * 128 + tx) & 0xFFFF;
          // Create a grid pattern: every 4th tile is a stripe, else checkerboard
          const isGridLine = (tx & 7) === 0 || (ty & 7) === 0;
          if (isGridLine) {
            // Use diagonal dither tile (index based on position in dither region)
            VRAM[addr] = ((tx + ty) & 0xF) + 16; // varied tile indices
          } else {
            // Alternate between checkerboard patterns
            VRAM[addr] = ((tx ^ ty) & 3) + 4; // low tile indices — geometric patterns
          }
        }
      }

      // Synthwave-inspired palette: deep purples, hot pinks, cyan highlights
      generateThemedPalette("synthwave");

      // Raster gradient sky above horizon — sunset/vaporwave gradient
      generateRasterGradient("synthwave");
      rasterEnabled = true;

      // Ghost frame for motion trails
      ghostEnabled = true;
      ghostAlpha = 0.35;

      // Subtle color math — additive glow
      colorMathMode = 1;
      fixedColor = { r: 3, g: 1, b: 6 };

      // Color cycling for palette animation
      initColorCycling("chase");

      // No sprites, no windows
      spritesEnabled = false;
      windowEnabled = false;

      // Start scrolling into the floor
      m7vofs = 0;
    },
    update(localFrame) {
      // Slow rotation of the floor plane
      const rotSpeed = 0.0003;
      const rotation = localFrame * rotSpeed;
      const horizonLine = 80;

      // Update Mode 7 matrix with rotation
      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      m7b = sinR * 0.25;
      m7c = -sinR * 0.25;

      // Rebuild HDMA perspective values with current rotation baked in
      // PERF: pre-compute constants, only loop below horizon
      const m7aValues = hdmaEffects[0].values;
      const m7dValues = hdmaEffects[1].values;
      const aboveHorizonVal = 0.05 * cosR;
      const maxDist = SCREEN_H - horizonLine;
      const scaleFactor = maxDist * 0.15 * cosR;
      for (let i = 0; i < horizonLine; i++) {
        m7aValues[i] = aboveHorizonVal;
        m7dValues[i] = aboveHorizonVal;
      }
      for (let i = horizonLine; i < SCREEN_H; i++) {
        const val = scaleFactor / (i - horizonLine + 1);
        m7aValues[i] = val;
        m7dValues[i] = val;
      }

      // Scroll forward into the plane
      if (localFrame % 4 === 0) m7vofs += 3;
      // Gentle lateral drift
      m7hofs = Math.floor(Math.sin(localFrame * 0.001) * 30);

      // Raster gradient: shift it slowly for a living sky
      rasterOffset = localFrame;

      // Ghost trail evolves
      ghostAlpha = 0.25 + Math.sin(localFrame * 0.005) * 0.15;

      // Subtle corruption that warps the perspective
      if (localFrame % 30 === 0) glitchMode7();
      if (localFrame % 50 === 0) glitchVRAMBitRot();
      if (localFrame % 60 === 0) glitchDMAMisfire();

      // Occasionally nudge the HDMA values for glitchy perspective warp
      if (glitchRand() < 0.015) {
        const scanline = glitchRandInt(SCREEN_H - horizonLine) + horizonLine;
        const jitter = (glitchRand() - 0.5) * 2.0;
        if (scanline < m7aValues.length) {
          m7aValues[scanline] += jitter;
          m7dValues[scanline] += jitter;
        }
      }

      // Slow pulsing color math glow
      fixedColor.r = Math.floor(3 + Math.sin(localFrame * 0.004) * 2) & 0x1F;
      fixedColor.b = Math.floor(6 + Math.cos(localFrame * 0.003) * 4) & 0x1F;
    }
  },

  // ---- SCENE 26: AURORA ----
  {
    name: "AURORA",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateDitherTiles();
      generateBG2Tiles();
      generateThemedPalette("ice");
      generateRasterGradient("rainbow");
      initColorCycling("chase");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.6;
      colorMathMode = 1; // add
      fixedColor = { r: 2, g: 4, b: 10 };
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x4000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;

      // HDMA wavy bands — slow sine displacement per scanline
      const waveValues = [];
      for (let i = 0; i < SCREEN_H; i++) {
        waveValues.push(Math.sin(i * 0.03) * 8);
      }
      hdmaEffects = [
        { startScanline: 0, register: "bgScrollX0", values: waveValues },
        { startScanline: 0, register: "bgScrollX1", values: waveValues.map(v => -v) }
      ];
    },
    update(localFrame) {
      // Slow dreamy horizontal drift
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      if (localFrame % 6 === 0) bgScrollX[1] -= 1;
      bgScrollY[0] = Math.floor(Math.sin(localFrame * 0.0008) * 6);
      bgScrollY[1] = Math.floor(Math.cos(localFrame * 0.0006) * 4);

      // Animate the HDMA wave — shift phase over time for undulating aurora bands
      // PERF: sinLUT replaces Math.sin (448 calls/frame → 448 LUT lookups)
      if (hdmaEffects.length >= 2) {
        const vals0 = hdmaEffects[0].values;
        const vals1 = hdmaEffects[1].values;
        const phase0 = localFrame * 0.005;
        const phase1 = localFrame * 0.004;
        for (let i = 0; i < SCREEN_H; i++) {
          vals0[i] = sinLUT(i * 0.03 + phase0) * 10;
          vals1[i] = -sinLUT(i * 0.025 + phase1) * 8;
        }
      }

      // Shift raster offset for moving color bands
      rasterOffset = localFrame;

      // Very minimal glitches — let colors breathe
      if (localFrame % 60 === 0 && glitchRand() < 0.3) glitchVRAMBitRot();
      if (localFrame % 80 === 0) tileMorphWanderingTiles();
    }
  },

  // ---- SCENE 27: DATASTREAM ----
  {
    name: "DATASTREAM",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateDitherTiles();
      generateBG2Tiles();
      generateThemedPalette("crt");
      generateRasterGradient("crt");
      initColorCycling("pulse");
      initParticles(48, "rain");
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 1;
      fixedColor = { r: 0, g: 6, b: 0 };
      hdmaEffects = [];
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x0000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      // BG1 rapid downward scroll — data cascade
      bgScrollY[0] += 3;
      // BG2 slower parallax scroll
      if (localFrame % 2 === 0) bgScrollY[1] += 1;

      updateParticles();

      // Moderate bit rot for digital corruption feel
      if (localFrame % 8 === 0) glitchVRAMBitRot();
      if (localFrame % 12 === 0) tileMorphColumnCascade();
      if (localFrame % 20 === 0) glitchBitplaneError();
      if (localFrame % 40 === 0) glitchDMAMisfire();

      // Raster shift
      rasterOffset = localFrame;
    }
  },

  // ---- SCENE 28: KALEIDOSCOPE ----
  {
    name: "KALEIDOSCOPE",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateThemedPalette("stained");
      rasterEnabled = false;
      initColorCycling("full");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.35;
      colorMathMode = 0;
      hdmaEffects = [];
      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x2000;

      // Build 4-way symmetric tilemap — more aggressive than MANDALA
      const tmBase = bgTilemapAddr[0];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tmBase + (y * 32 + x) * 2) & 0xFFFF;
          const mx = x < 16 ? x : 31 - x;
          const my = y < 16 ? y : 31 - y;
          const tileIdx = ((mx * mx * 3 + my * my * 7 + mx * my * 5) ^ (mx << 4 | my)) & 0xFF;
          const palette = ((mx ^ my) + ((mx * my) >> 3)) & 7;
          const hFlip = x >= 16 ? 1 : 0;
          const vFlip = y >= 16 ? 1 : 0;
          const entry = tileIdx | (palette << 10) | (hFlip << 14) | (vFlip << 15);
          VRAM[addr] = entry & 0xFF;
          VRAM[addr + 1] = (entry >> 8) & 0xFF;
        }
      }
      // BG2 — rotated symmetry pattern
      const tm2Base = bgTilemapAddr[1];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tm2Base + (y * 32 + x) * 2) & 0xFFFF;
          const mx = x < 16 ? x : 31 - x;
          const my = y < 16 ? y : 31 - y;
          const tileIdx = ((my * 11 + mx * 13) ^ ((mx + my) * 7)) & 0xFF;
          const palette = ((mx * my) >> 2) & 7;
          const hFlip = x >= 16 ? 1 : 0;
          const vFlip = y >= 16 ? 1 : 0;
          const entry = tileIdx | (palette << 10) | (hFlip << 14) | (vFlip << 15);
          VRAM[addr] = entry & 0xFF;
          VRAM[addr + 1] = (entry >> 8) & 0xFF;
        }
      }
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      // Counter-rotating scroll with wider orbit than MANDALA
      const angle = localFrame * 0.0015;
      bgScrollX[0] = Math.floor(Math.cos(angle) * 48);
      bgScrollY[0] = Math.floor(Math.sin(angle) * 48);
      bgScrollX[1] = Math.floor(Math.cos(-angle * 1.3) * 36);
      bgScrollY[1] = Math.floor(Math.sin(-angle * 1.3) * 36);

      // Aggressive mirror flipping every 20 frames
      if (localFrame % 20 === 0) glitchTilemapMirror();

      // Tile morph for pattern evolution
      if (localFrame % 6 === 0) tileMorphGenomeSplice();
      if (localFrame % 10 === 0) tileMorphInfection();
      if (localFrame % 8 === 0) tileMorphCrossPollination();

      // Pulsing mosaic
      mosaicSize = 1 + Math.floor(Math.abs(Math.sin(localFrame * 0.005)) * 3);
    }
  },

  // ---- SCENE 29: SUBMERGED ----
  {
    name: "SUBMERGED",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateDitherTiles();
      generateBG2Tiles();
      generateThemedPalette("ocean");
      generateRasterGradient("ocean");
      initColorCycling("slow");
      initParticles(30, "rise");
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.4;
      colorMathMode = 1; // add
      fixedColor = { r: 0, g: 2, b: 8 };
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x4000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;

      // HDMA wavy displacement on all scanlines — underwater distortion
      const waveValues = [];
      for (let i = 0; i < SCREEN_H; i++) {
        waveValues.push(Math.sin(i * 0.04) * 6);
      }
      hdmaEffects = [
        { startScanline: 0, register: "bgScrollX0", values: waveValues },
        { startScanline: 0, register: "bgScrollX1", values: waveValues.map(v => v * 0.6) }
      ];
    },
    update(localFrame) {
      // Very slow drift — peaceful
      if (localFrame % 6 === 0) bgScrollX[0] += 1;
      if (localFrame % 8 === 0) bgScrollY[0] -= 1;
      if (localFrame % 10 === 0) bgScrollX[1] -= 1;
      if (localFrame % 12 === 0) bgScrollY[1] -= 1;

      // Animate the HDMA wave for living water distortion
      // PERF: sinLUT replaces Math.sin (448 calls/frame → LUT lookups)
      if (hdmaEffects.length >= 2) {
        const vals0 = hdmaEffects[0].values;
        const vals1 = hdmaEffects[1].values;
        const phase0 = localFrame * 0.008;
        const phase1 = localFrame * 0.003;
        for (let i = 0; i < SCREEN_H; i++) {
          const v = sinLUT(i * 0.04 + phase0) * 6 + sinLUT(i * 0.08 + phase1) * 3;
          vals0[i] = v;
          vals1[i] = v * 0.6;
        }
      }

      // Rising bubble particles
      updateParticles();

      // Raster shift for moving blue gradient
      rasterOffset = localFrame;

      // Very low glitch intensity — dreamy
      if (localFrame % 50 === 0 && glitchRand() < 0.2) glitchVRAMBitRot();
      if (localFrame % 40 === 0) tileMorphWanderingTiles();
    }
  },

  // ---- SCENE 30: INFERNO ----
  {
    name: "INFERNO",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateDitherTiles();
      generateBG2Tiles();
      generateThemedPalette("fire");
      generateRasterGradient("infrared");
      initColorCycling("full");
      initParticles(40, "rise");
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.5;
      colorMathMode = 1; // add
      fixedColor = { r: 12, g: 6, b: 0 };
      hdmaEffects = [];
      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x2000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      // Fire rises — both BGs scroll upward at different speeds
      bgScrollY[0] -= 2;
      if (localFrame % 2 === 0) bgScrollY[1] -= 1;
      // Lateral flicker
      bgScrollX[0] = Math.floor(Math.sin(localFrame * 0.05) * 3);
      bgScrollX[1] = Math.floor(Math.cos(localFrame * 0.04) * 2);

      updateParticles();
      rasterOffset = localFrame;

      // Aggressive palette corruption — fire is volatile
      if (localFrame % 4 === 0) glitchPaletteCorrupt();
      if (localFrame % 6 === 0) glitchDMAMisfire();
      if (localFrame % 8 === 0) glitchVRAMBitRot();
      if (localFrame % 10 === 0) tileMorphInfection();
      if (localFrame % 15 === 0) tileMorphCascade();

      // Pulsing additive color for heat waves
      fixedColor.r = Math.floor(10 + Math.sin(localFrame * 0.03) * 5) & 0x1F;
      fixedColor.g = Math.floor(4 + Math.sin(localFrame * 0.02) * 3) & 0x1F;
    }
  },

  // ---- SCENE 31: TESSELLATION ----
  {
    name: "TESSELLATION",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateDitherTiles();
      generateBG2Tiles();
      generateThemedPalette("amber");
      rasterEnabled = false;
      initColorCycling("slow");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = false;
      colorMathMode = 0;
      hdmaEffects = [];
      // Use dither tiles for geometric patterns
      bgCharAddr[0] = 0x5000;
      bgCharAddr[1] = 0x2000;

      // Build repeating geometric tilemap
      const tmBase = bgTilemapAddr[0];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tmBase + (y * 32 + x) * 2) & 0xFFFF;
          // Repeating geometric pattern — diamond/hex-like arrangement
          const patternA = ((x + y) % 4) * 16 + ((x * y) % 16);
          const patternB = ((x ^ y) * 3 + (x & y) * 5) & 0xFF;
          const tileIdx = ((x + y) % 2 === 0) ? patternA & 0xFF : patternB;
          const palette = ((x + y) >> 2) & 7;
          const entry = tileIdx | (palette << 10);
          VRAM[addr] = entry & 0xFF;
          VRAM[addr + 1] = (entry >> 8) & 0xFF;
        }
      }
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      // Slow diagonal scroll
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      if (localFrame % 6 === 0) bgScrollX[1] -= 1;
      if (localFrame % 6 === 0) bgScrollY[1] += 1;

      // Wandering tile morph for gradual pattern evolution
      if (localFrame % 8 === 0) tileMorphWanderingTiles();
      if (localFrame % 15 === 0) tileMorphGenomeSplice();

      // Mosaic alternating between 1 and 2
      mosaicSize = 1 + (Math.floor(localFrame / 30) % 2);
    }
  },

  // ---- SCENE 32: GHOST WORLD ----
  {
    name: "GHOST WORLD",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateDitherTiles();
      generateBG2Tiles();
      generateThemedPalette("void");
      generateRasterGradient("void");
      initColorCycling("breathe");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.7; // near maximum — trails ARE the art
      colorMathMode = 3; // average
      fixedColor = { r: 4, g: 2, b: 8 };
      hdmaEffects = [];
      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x4000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      // Very slow scroll — let trails accumulate
      bgScrollX[0] = Math.floor(Math.sin(localFrame * 0.0005) * 16);
      bgScrollY[0] = Math.floor(Math.cos(localFrame * 0.0004) * 12);
      bgScrollX[1] = Math.floor(Math.sin(localFrame * 0.0003 + 1.5) * 10);
      bgScrollY[1] = Math.floor(Math.cos(localFrame * 0.0002 + 0.7) * 8);

      rasterOffset = localFrame;

      // Very slow, subtle glitches — the ghost persistence does the heavy lifting
      if (localFrame % 30 === 0) tileMorphWanderingTiles();
      if (localFrame % 50 === 0 && glitchRand() < 0.3) glitchVRAMBitRot();
      if (localFrame % 70 === 0 && glitchRand() < 0.2) glitchDMAMisfire();

      // Subtle oscillation of ghost alpha
      ghostAlpha = 0.65 + Math.sin(localFrame * 0.002) * 0.05;
    }
  },

  // ---- SCENE 33: CHROMATIC ----
  {
    name: "CHROMATIC",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateDitherTiles();
      generateBG2Tiles();
      generateThemedPalette("neon");
      rasterEnabled = false;
      initColorCycling("full");
      spritesEnabled = false;
      windowEnabled = true;
      windowMode = 4; // XOR
      windowMaskAction = 2; // invert
      window1Left = 40; window1Right = 216;
      window2Left = 80; window2Right = 176;
      ghostEnabled = false;
      colorMathMode = 0;
      hdmaEffects = [];
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x0000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 2;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      if (localFrame % 4 === 0) bgScrollX[1] -= 1;
      if (localFrame % 4 === 0) bgScrollY[1] -= 1;

      // Rapidly oscillating windows for color inversion zones
      const cx = SCREEN_W >> 1;
      window1Left = Math.floor(cx + Math.sin(localFrame * 0.02) * (cx * 0.7));
      window1Right = Math.floor(cx + Math.cos(localFrame * 0.025) * (cx * 0.7));
      window2Left = Math.floor(cx + Math.sin(localFrame * 0.018 + 2) * (cx * 0.5));
      window2Right = Math.floor(cx + Math.cos(localFrame * 0.022 + 1) * (cx * 0.5));

      // Constant palette corruption — vivid color explosions
      if (localFrame % 3 === 0) glitchPaletteCorrupt();
      if (localFrame % 5 === 0) glitchCGRAMShift();

      // Switch palette theme every 200 frames for variety
      const paletteThemes = ["neon", "synthwave", "coral", "stained", "fire", "ice"];
      if (localFrame % 200 === 0) {
        const themeIdx = Math.floor(localFrame / 200) % paletteThemes.length;
        generateThemedPalette(paletteThemes[themeIdx]);
      }

      if (localFrame % 15 === 0) tileMorphInfection();
    }
  },

  // ---- SCENE 34: EARTHQUAKE ----
  {
    name: "EARTHQUAKE",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateDitherTiles();
      generateBG2Tiles();
      generateTilemaps();
      generateThemedPalette("ruins");
      rasterEnabled = false;
      initColorCycling("pulse");
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
      // Violent random scroll shaking on both BGs
      bgScrollX[0] += Math.floor((glitchRand() - 0.5) * 8);
      bgScrollY[0] += Math.floor((glitchRand() - 0.5) * 8);
      bgScrollX[1] += Math.floor((glitchRand() - 0.5) * 6);
      bgScrollY[1] += Math.floor((glitchRand() - 0.5) * 6);

      // Tilemap scramble every other frame
      if (localFrame % 2 === 0) glitchTilemapScramble();

      // Mosaic jumping between 1-4
      mosaicSize = 1 + glitchRandInt(4);

      // Bus conflict glitches for hardware chaos
      if (localFrame % 4 === 0) glitchBusConflict();
      if (localFrame % 6 === 0) glitchDMAMisfire();
      if (localFrame % 10 === 0) glitchScrollOverflow();
      if (localFrame % 8 === 0) glitchAddressLineFault();

      // Occasional heavy corruption bursts
      if (localFrame % 30 < 2) {
        glitchVRAMBitRot();
        glitchDMAMisfire();
        glitchBitplaneError();
      }
    }
  },

  // ---- SCENE 35: STARFIELD ----
  {
    name: "STARFIELD",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateDitherTiles();
      generateBG2Tiles();
      generateThemedPalette("midnight");
      generateRasterGradient("midnight");
      initColorCycling("breathe");
      initParticles(20, "scatter");
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.35;
      colorMathMode = 0;
      hdmaEffects = [];
      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x4000;

      // Build a mostly-dark tilemap with sparse bright tiles as stars
      const tmBase = bgTilemapAddr[0];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const addr = (tmBase + (y * 32 + x) * 2) & 0xFFFF;
          // Hash to determine if this is a "star" tile — roughly 15% coverage
          const hash = ((x * 2654435761 + y * 2246822519) >>> 0) % 100;
          const isStar = hash < 15;
          const tileIdx = isStar ? (128 + (hash & 0x1F)) & 0xFF : 0;
          const palette = isStar ? (hash >> 3) & 7 : 0;
          const entry = tileIdx | (palette << 10);
          VRAM[addr] = entry & 0xFF;
          VRAM[addr + 1] = (entry >> 8) & 0xFF;
        }
      }
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      // Very slow scroll — drifting through space
      if (localFrame % 6 === 0) bgScrollX[0] += 1;
      if (localFrame % 10 === 0) bgScrollY[0] += 1;
      // BG2 even slower for depth parallax
      if (localFrame % 12 === 0) bgScrollX[1] += 1;
      if (localFrame % 16 === 0) bgScrollY[1] += 1;

      updateParticles();
      rasterOffset = localFrame;

      // Very minimal glitching — serene deep space
      if (localFrame % 60 === 0 && glitchRand() < 0.15) glitchVRAMBitRot();
      if (localFrame % 80 === 0) tileMorphWanderingTiles();
    }
  },

  // ---- SCENE 36: PRISM ----
  {
    name: "PRISM",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateDitherTiles();
      generateBG2Tiles();
      generateThemedPalette("coral");
      rasterEnabled = false;
      initColorCycling("split");
      spritesEnabled = false;
      windowEnabled = true;
      windowMode = 4; // XOR
      windowMaskAction = 2; // invert
      window1Left = 64; window1Right = 192;
      window2Left = 96; window2Right = 160;
      ghostEnabled = false;
      colorMathMode = 1; // add
      fixedColor = { r: 4, g: 2, b: 6 };
      bgCharAddr[0] = 0x2000;
      bgCharAddr[1] = 0x0000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;

      // HDMA creating per-scanline window position shifts for prismatic splitting
      const w1Vals = [];
      const w2Vals = [];
      for (let i = 0; i < SCREEN_H; i++) {
        w1Vals.push(Math.floor(128 + Math.sin(i * 0.03) * 60));
        w2Vals.push(Math.floor(128 + Math.cos(i * 0.04) * 40));
      }
      hdmaEffects = [
        { startScanline: 0, register: "window1Left", values: w1Vals },
        { startScanline: 0, register: "window2Left", values: w2Vals }
      ];
    },
    update(localFrame) {
      if (localFrame % 4 === 0) bgScrollX[0] += 1;
      if (localFrame % 4 === 0) bgScrollY[0] += 1;
      if (localFrame % 4 === 0) bgScrollX[1] -= 1;

      // Animate window positions — oscillating prismatic splits
      const cx = SCREEN_W >> 1;
      const phase1 = localFrame * 0.01;
      const phase2 = localFrame * 0.013;
      window1Left = Math.floor(cx + Math.sin(phase1) * 80);
      window1Right = Math.floor(cx + Math.cos(phase1 * 0.7) * 80);
      window2Left = Math.floor(cx + Math.sin(phase2 + 1.5) * 60);
      window2Right = Math.floor(cx + Math.cos(phase2 * 0.8 + 1) * 60);

      // Animate HDMA for per-scanline window displacement
      // PERF: sinLUT/cosLUT replaces Math.sin/cos (448 calls/frame → LUT lookups)
      if (hdmaEffects.length >= 2) {
        const w1 = hdmaEffects[0].values;
        const w2 = hdmaEffects[1].values;
        const phase1 = localFrame * 0.006;
        const phase2 = localFrame * 0.005;
        for (let i = 0; i < SCREEN_H; i++) {
          w1[i] = (cx + sinLUT(i * 0.03 + phase1) * 70) | 0;
          w2[i] = (cx + cosLUT(i * 0.04 + phase2) * 50) | 0;
        }
      }

      // Light glitching
      if (localFrame % 20 === 0) tileMorphWanderingTiles();
      if (localFrame % 30 === 0) glitchVRAMBitRot();
      if (localFrame % 40 === 0) glitchHDMA();
    }
  },

  // ---- SCENE 37: CONVERGENCE ----
  {
    name: "CONVERGENCE",
    setup() {
      ppuMode = 1;
      bgEnabled[0] = true; bgEnabled[1] = true; bgEnabled[2] = false; bgEnabled[3] = false;
      generateTileData();
      generateEnhancedTiles();
      generateDitherTiles();
      generateBG2Tiles();
      generateTilemaps();
      generateThemedPalette("blood");
      generateRasterGradient("blood");
      initColorCycling("pulse");
      spritesEnabled = false;
      windowEnabled = false;
      ghostEnabled = true;
      ghostAlpha = 0.4;
      colorMathMode = 2; // subtract — interference via subtraction
      fixedColor = { r: 4, g: 0, b: 2 };
      hdmaEffects = [];
      bgCharAddr[0] = 0x0000;
      bgCharAddr[1] = 0x2000;
      bgScrollX[0] = 0; bgScrollY[0] = 0;
      bgScrollX[1] = 0; bgScrollY[1] = 0;
    },
    update(localFrame) {
      // BG1 scrolls left, BG2 scrolls right — collision course
      bgScrollX[0] -= 2;
      bgScrollX[1] += 2;
      // Gentle vertical drift to prevent perfect alignment
      bgScrollY[0] = Math.floor(Math.sin(localFrame * 0.002) * 8);
      bgScrollY[1] = Math.floor(Math.cos(localFrame * 0.0015) * 6);

      rasterOffset = localFrame;

      // BG1 gets DMA misfire corruption
      if (localFrame % 6 === 0) glitchDMAMisfire();
      // BG2 gets tilemap scramble corruption
      if (localFrame % 8 === 0) glitchTilemapScramble();

      // Additional interference at the overlap zone
      if (localFrame % 12 === 0) glitchVRAMBitRot();
      if (localFrame % 15 === 0) tileMorphCrossPollination();
      if (localFrame % 20 === 0) glitchBitplaneError();

      // Ghost alpha pulses with the conflict
      ghostAlpha = 0.35 + Math.sin(localFrame * 0.008) * 0.1;
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
      generateDitherTiles();
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
  generateDitherTiles();

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
