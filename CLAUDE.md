# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Generative art engine simulating the Super Nintendo PPU with controlled corruption algorithms. Targets CRT installation with PS5 controller input.

## Development

- **No build system** — edit JS files, refresh browser
- **All state is global scope** — no modules, no classes, no bundler

### Run Modes

| File | Purpose |
|---|---|
| `index.html` | Interactive viewer with menu + gamepad support |
| `streaming.html` | Ambient TV background — zero input, smooth transitions, curated playlist (skips harsh scenes), capped glitch intensity |
| `render.html` | Offline video export (MP4/WebM/PNG frames) — sets `OFFLINE_RENDER=true` to skip auto-boot |

### URL Parameters

Engine: `scene=N`, `glitch=N` (0=auto, 1-13=specific), `ghost=true/false`, `autoAdvance=true/false`
CRT: `crt=true&scanlines=0.20&phosphor=0.15&barrel=0.04&bloom=0.30&chromatic=0.6&vignette=0.35&noise=0.04`

## Architecture

### Load Order (critical — scripts depend on prior globals)

```
ppu.js → engine.js → menu.js → landscape.js → crt.js
```

1. **ppu.js**: Core PPU simulation — VRAM/CGRAM/OAM typed arrays, rendering pipeline (`renderFrame()`, `renderBGScanline()`, `renderMode7Scanline()`), all 21 glitch algorithms (`GLITCH_FNS[]`), tile morph system (8 sub-effects), color conversion, sine LUT
2. **engine.js**: Scene system (38 scenes), scene director with transitions, main loop (`mainLoop()`), tile generation, color cycling, raster bars, sprites, windows, ghost frame, HDMA, keyboard input, fullscreen resolution
3. **menu.js**: Bitmap font rendering (`FONT_8x8[]`, `drawText()`), gamepad/keyboard menu overlay
4. **landscape.js**: 10 biomes (forest, ice, alien, volcanic, ocean, void, crystal, desert, neon, space) with tile generators, tile/tilemap writer helpers (`writeTilePixels()`, `writeTilemapEntry()`)
5. **crt.js**: WebGL2 post-processing shader — scanlines, phosphor mask, barrel distortion, bloom, chromatic aberration, vignette, grain. Wraps `renderFrame()`, must load last.

### Rendering Pipeline (per frame)

```
mainLoop()
  → updateSceneDirector(deltaMs)     // scene transitions, call scene.update()
  → updateColorCycling()             // rotate CGRAM ranges
  → apply glitches                   // GLITCH_FNS[idx]()
  → renderFrame()
      → rebuildCGRAMCache()          // only if cgramDirty flag set
      → per-scanline:
          applyHDMAEffects()         // register overrides
          render BG layers or Mode 7
          render sprites
          apply mosaic, window mask
      → color math, ghost frame blend
  → CRT shader (WebGL2 overlay)
```

### Scene System

- Scenes: `{name, setup(), update(localFrame)}` in `scenes[]` array
- `setup()` must fully reset PPU state (tiles, palette, cycling, windows, etc.)
- Auto-advance every 20s with mosaic fade transitions
- Keyboard: N/P next/prev, A auto-advance, 1-9 lock glitch, 0 auto, Space burst

## Conventions

- Typed arrays for all hardware memory (`Uint8Array`, `Uint32Array`, `Int16Array`)
- Bitwise ops for clamping in hot paths — no `Math.min/max` in render loops
- `glitchRand()` / `glitchRandInt(n)` for seeded randomness (deterministic in offline renders)
- `markCGRAMDirty()` after any palette mutation → `rebuildCGRAMCache()` runs once per frame
- `sinLUT(x)` / `cosLUT(x)` instead of `Math.sin/cos` (1024-entry precomputed table)
- Pre-allocated scanline buffers (`_lineBuffer`, `_priorityBuffer`) — zero GC in render loop
- Packed RGBA `Uint32Array` framebuffer (`fb`) — no object allocation for colors
- `snesColorToRGB(lo, hi)` returns packed uint32; `rgbToSnesColor(r, g, b)` returns two bytes
- Delta-time animation via `performance.now()`

## VRAM Layout

```
0x0000-0x1FFF  256 base tiles (32 bytes each, 4bpp bitplane)
0x2000-0x3FFF  256 enhanced tiles (circuit, rune, wave, organic, etc.)
0x4000-0x4FFF  128 BG2 tiles
0x6000-0x67FF  BG1 tilemap (32×32 entries × 2 bytes = 2KB)
0x6800-0x6FFF  BG2 tilemap
CGRAM: 8 palettes × 16 colors × 2 bytes (15-bit BGR)
OAM: 128 sprites × 4B + 32B high table
```

## Key Gotchas

- **4bpp bitplane encoding**: Each 8×8 tile = 32 bytes. Rows 0-7 of bitplanes 0-1, then rows 0-7 of bitplanes 2-3. Address: `baseAddr + row*2 + [0,1,16,17]`
- **CGRAM is 15-bit BGR** (not RGB): `r:5 | g:5 | b:5 | unused:1`
- **Tilemap entry format**: `tileIdx:10 | palette:3 | hFlip:1 | vFlip:1 | priority:1` — XOR/mask ops can corrupt palette bits
- **HDMA applied before scanline render** — array order matters, last write to same register wins
- **Ghost buffer lazily allocated** — must resize when PPU resolution changes via `resizePPU()`

## Adding New Features

### New Glitch Algorithm
1. Add function in `ppu.js` (operate on VRAM/CGRAM/OAM directly)
2. Add to `GLITCH_FNS[]` and `GLITCH_NAMES[]` at same index
3. Use `glitchRand()` / `glitchRandInt()` for seeded randomness

### New Scene
1. Add `{name, setup(), update(localFrame)}` to `scenes[]` in engine.js
2. `setup()` must fully reset PPU state (tiles, palettes, scroll, cycling, windows, etc.)
3. Update `render.html` scene dropdown if it has a hardcoded list

### New Palette Theme
Add case in `generateThemedPalette()` in ppu.js — 8 palettes × 16 colors, write to CGRAM, call `rebuildCGRAMCache()`

### New Tile Morph Phase
Add function `tileMorph*()` in ppu.js, add to phase selection switch in `glitchTileMorph()` — operate on VRAM/tilemap directly

### New Raster Gradient
Add case in `generateRasterGradient()` in engine.js — fill `rasterColors[]` with SNES 15-bit BGR values per scanline
