---
name: snes-ppu-dev
description: Expert skill for developing the SNES PPU Corruption Engine — generative art simulator with authentic hardware glitch algorithms
match:
  - "scene"
  - "glitch"
  - "tile"
  - "palette"
  - "VRAM"
  - "HDMA"
  - "Mode 7"
  - "sprite"
  - "corruption"
  - "render"
  - "effect"
  - "morph"
  - "scanline"
  - "raster"
---

# SNES PPU Corruption Engine — Development Skill

You are working on a **generative art engine** that simulates the Super Nintendo PPU at the bit level, then applies controlled corruption algorithms to create evolving abstract art. The user loves DMA/tilemap glitch interactions and tile morphing. They want autonomous creative execution — build ambitious features and ship them without asking for approval on creative decisions.

## Project Architecture

Two main files, no build system, no dependencies — pure vanilla JS + HTML5 Canvas:

| File | Role | Key exports |
|---|---|---|
| `ppu.js` (~1500 lines) | Core PPU simulation: VRAM, CGRAM, OAM, tilemaps, Mode 7, all 10 glitch algorithms, tile morph system, rendering pipeline | All PPU state is global scope |
| `engine.js` (~2300 lines) | Scene director (25 scenes), extended PPU features (sprites, windows, ghost frame, raster bars, color cycling, particles), UI, input handling | Extends ppu.js globals |
| `index.html` | Live viewer — loads ppu.js then engine.js | |
| `render.html` | Offline video export UI (MP4/WebM/PNG frames) | |

**Load order matters**: `ppu.js` first (defines globals), `engine.js` second (extends them). Both share global scope.

## SNES Hardware Model

### Memory Layout
```
VRAM (64KB Uint8Array):
  0x0000-0x1FFF  256 base tiles (32 bytes each, 4bpp bitplane)
  0x2000-0x3FFF  256 enhanced tiles (circuit, rune, wave, organic, etc.)
  0x4000-0x4FFF  128 BG2 tiles
  0x6000-0x67FF  BG1 tilemap (32×32 entries × 2 bytes = 2KB)
  0x6800-0x6FFF  BG2 tilemap

CGRAM (512 bytes): 8 palettes × 16 colors × 2 bytes (15-bit BGR: 0bbbbbgggggrrrrr)
OAM (544 bytes): 128 sprites × 4B + 32B high table
```

### Tile Format (4bpp Bitplane)
Each tile = 32 bytes for 8×8 pixels (16 colors). Bitplanes 0-1 at offset 0-15, bitplanes 2-3 at offset 16-31. To decode pixel (x, row):
```js
const addr = tileAddr + row * 2;
const bit = 7 - x;
const p0 = (VRAM[addr] >> bit) & 1;
const p1 = (VRAM[addr + 1] >> bit) & 1;
const p2 = (VRAM[addr + 16] >> bit) & 1;
const p3 = (VRAM[addr + 17] >> bit) & 1;
const colorIdx = p0 | (p1 << 1) | (p2 << 2) | (p3 << 3);
```

### Tilemap Entry (2 bytes)
```
Byte 0: tile index (low 8 bits)
Byte 1: vhopppcc
  v = vertical flip, h = horizontal flip
  o = priority, ppp = palette (0-7), cc = tile index high bits
```

### Color Format
15-bit BGR: `color = r | (g << 5) | (b << 10)` where r,g,b are 0-31.
Convert with `snesColorToRGB(c)` → packed RGBA uint32 for framebuffer.

## Rendering Pipeline (per frame)

1. Apply HDMA effects (per-scanline register writes)
2. For each scanline 0-223:
   - Fill backdrop (or raster gradient if enabled)
   - Render BG layers via `renderBGScanline()` or `renderMode7Scanline()`
   - Render sprites via `renderSpriteScanline()`
   - Apply mosaic, window masking, color math, brightness
3. Blend ghost frame (phosphor feedback) if enabled
4. `putImageData` to canvas

**Performance-critical**: Use typed arrays, bitwise clamping, pre-allocated buffers, CGRAM cache. No `Math.min/max` in hot loops — use `(v < 0 ? 0 : v > 255 ? 255 : v)` or `>>> 0`.

## Glitch System

10 glitch types in `GLITCH_FNS[]` array (ppu.js:1366):

| # | Function | What it corrupts |
|---|---|---|
| 1 | `glitchDMAMisfire()` | Copies wrong VRAM regions |
| 2 | `glitchVRAMBitRot()` | Random bit flips in tile data |
| 3 | `glitchPaletteCorrupt()` | Rotates/XORs/shifts palette colors |
| 4 | `glitchTilemapScramble()` | Shifts rows, flips entries, fills |
| 5 | `glitchMode7()` | Skews affine matrix |
| 6 | `glitchHDMA()` | Injects/modifies scanline effects |
| 7 | `glitchBitplaneError()` | Swaps bitplane pairs |
| 8 | `glitchBusConflict()` | XORs different memory regions |
| 9 | `glitchScrollOverflow()` | Pushes scroll past boundaries |
| 10 | `glitchTileMorph()` | 8-phase tile evolution (crown jewel) |

### Tile Morph Phases (glitch #10)
The most complex system — 8 orchestrated phases that cycle:
1. **Infection** — tile copies to neighbors, spreading
2. **Genome Splice** — two tiles interleave bitplanes
3. **Wandering Tiles** — tilemap indices drift smoothly
4. **Cross-Pollination** — tilemap ↔ VRAM byte swap
5. **Echo** — region copies with offset (stuttering)
6. **Cascade** — tiles corrupt their source data
7. **Feedback** — tilemap→VRAM→tilemap loop (fractal)
8. **Row Drag / Column Cascade** — tiles "fall" or "drag"

Each phase runs 120-300 frames with smooth transitions.

## Scene System

Scenes are objects in the `scenes[]` array (engine.js:809) with `name`, `setup()`, and `update(localFrame)`:

```js
{
  name: "SCENE_NAME",
  setup() {
    // Reset PPU state for this scene
    ppuMode = 1;  // or 7 for Mode 7
    bgEnabled[0] = true; bgEnabled[1] = true; ...
    generateTileData(); generateBG2Tiles(); generateEnhancedTiles();
    generateTilemaps();
    generateThemedPalette("theme_name");
    // Configure: raster, ghost, windows, sprites, colorMath, HDMA, scroll
    initColorCycling("preset");
    hdmaEffects = [];
  },
  update(localFrame) {
    // Per-frame animation logic
    // Modify scroll, glitch intensity, call specific glitches, etc.
  }
}
```

**Scene director** runs 20s per scene with 1s fade transitions. `sceneTransitionPhase`: 0=running, 1=fade-out, 2=switch, 3=fade-in.

### Available Palette Themes
ocean, fire, forest, neon, ruins, blood, ice, void, stained, crt, amber, synthwave, moss, infrared, midnight, coral

### Color Cycling Presets
full, slow, split, pulse, chase, breathe

### Raster Gradient Presets
sunset, ocean, fire, void, rainbow, crt, blood, amber, synthwave, infrared, midnight

### Particle Styles
scatter, rain, orbit, rise

## Extended PPU Features (engine.js)

- **Sprites/Particles**: `spritesEnabled`, `initParticles(style)`, max 128 sprites / 32 per scanline
- **Hardware Windows**: 2 windows with modes (inside/outside/AND/XOR/OR), actions (clip black/color/invert)
- **Ghost Frame**: Phosphor feedback (`ghostEnabled`, `ghostAlpha` 0-1)
- **Raster Bars**: Per-scanline color gradients (`rasterEnabled`, `generateRasterGradient(preset)`)
- **Color Cycling**: Palette rotation ranges (`initColorCycling(preset)`)
- **Color Math**: Add/subtract/average blending (`colorMathMode` 0-3)
- **Mosaic**: Block pixelation (`mosaicSize` 1-16)
- **HDMA**: Per-scanline register writes (scroll, Mode 7, mosaic, color)

## Key Development Patterns

1. **All state is global** — no classes, no modules. Just extend the global scope.
2. **Typed arrays everywhere** — `Uint8Array` for memory, `Uint32Array` for framebuffer, `Int16Array` for scroll.
3. **Bitwise operations** for flag packing and fast clamping — no `Math.min/max` in render loops.
4. **Seeded PRNG** — `glitchRand()` / `glitchRandInt(n)` for reproducible corruption.
5. **Pre-allocated buffers** — `lineBuffer`, `priorityBuffer` reused each scanline.
6. **CGRAM cache** — `rebuildCGRAMCache()` after palette changes, avoids per-pixel conversion.
7. **Delta-time animation** — `performance.now()` based, not frame-count based.
8. **No build step** — edit JS, refresh browser.

## When Adding New Features

### New Glitch Algorithm
1. Add function in `ppu.js` following existing patterns (operate on VRAM/CGRAM/OAM directly)
2. Add to `GLITCH_FNS[]` array
3. Update `GLITCH_NAMES[]` array at same index
4. Use `glitchRand()` / `glitchRandInt()` for randomness

### New Scene
1. Add object to `scenes[]` array in engine.js
2. Must have `name`, `setup()`, `update(localFrame)`
3. `setup()` should fully reset PPU state (tiles, palettes, scroll, features)
4. `update()` receives localFrame (0-based from scene start)
5. Update `render.html` scene dropdown if it has a hardcoded list

### New Palette Theme
1. Add case in `generateThemedPalette()` in ppu.js
2. 8 palettes × 16 colors, write to CGRAM, call `rebuildCGRAMCache()`

### New Tile Morph Phase
1. Add function `tileMorph*()` in ppu.js
2. Add to the phase selection switch in `glitchTileMorph()`
3. Each phase should operate on VRAM and/or tilemap data directly

### New Raster Gradient
1. Add case in `generateRasterGradient()` in engine.js
2. Fill `rasterColors[]` with SNES 15-bit BGR values per scanline

## Offline Renderer (render.html)

Self-contained page with its own UI. Loads ppu.js + engine.js with `OFFLINE_RENDER = true`.
- Fixed timestep rendering (no requestAnimationFrame)
- MediaRecorder for MP4/WebM, manual ZIP builder for PNG frames
- Adaptive bitrate: 25% of raw pixel data rate for high quality
- Scene selection, duration, FPS, resolution, format, quality controls
- URL params for headless use: `?scene=0&duration=30&fps=60&auto=1`

## Menu System (menu.js)

SNES-style bitmap font menu rendered directly to the PPU framebuffer as an overlay. Designed for CRT installations with PS5/modern game controllers.

### Architecture
- 8x8 1-bpp bitmap font covering ASCII 32-126 + custom glyphs (arrows, box drawing, indicators)
- Renders to `fb` array after PPU renderFrame, before putImageData
- Wraps `renderFrame` via function reassignment (no modification to engine.js)
- Separate RAF loop for gamepad polling (works even when frozen)
- Keyboard capture-phase listener intercepts nav keys when menu is open

### Controller Mapping (PS5 DualSense / Standard Gamepad)
- **Always active**: Options=menu, L1/R1=prev/next scene, Triangle=glitch burst, Square=screenshot, L2/R2=cycle glitch
- **Menu open**: D-pad/stick=navigate, Cross=select, Circle=back
- Keyboard: Escape/Tab=menu, arrows=navigate, Enter=select, Backspace=back

### Menu Structure
- `getMenuItems()` returns main menu items (Scene, Glitch, Effects, Screenshot, Fullscreen)
- `getSubmenuItems(key)` returns submenu items dynamically
- Items can be: action, submenu, or toggle types
- Add new menu items by extending these functions

### Font System
- `FONT_8x8` flat Uint8Array, (charCode - 32) * 8 = offset
- Custom glyphs at codes 128+: ▶(128), ●(129), ○(130), ■(131), □(132), ◀(133), ▲(134), ▼(135), box drawing(136-143)
- `drawGlyph(charCode, x, y, color)` — single character
- `drawText(str, x, y, color, shadow)` — string with optional drop shadow
- `darkenRect(x, y, w, h, amount)` — semi-transparent panel background

## Creative Direction

This is generative art, not a utility. The goal is **controlled beautiful chaos** — corruption that evolves, interacts, and surprises. The most interesting effects come from:
- **DMA misfire + tilemap scramble** interactions (tiles and tilesets morphing together)
- **Tile morph feedback loops** (data feeding back into itself)
- **Layer cross-talk** (BG1 data bleeding into BG2)
- **Palette corruption cascades** (colors evolving over time)

When building new features, go for visually striking and surprising results. The user wants to be amazed, not consulted.
