# SNES PPU Corruption Engine

Generative art engine simulating the Super Nintendo PPU with controlled corruption algorithms.

## Quick Reference

- **No build system** — edit JS files, refresh browser
- **Load order**: `ppu.js` (core PPU) → `engine.js` (scenes + extended features)
- **All state is global scope** — no modules, no classes
- **Test by opening** `index.html` in browser (or `render.html` for video export)

## Files

- `ppu.js` — PPU simulation, VRAM/CGRAM/OAM, rendering pipeline, 10 glitch algorithms, tile morph system
- `engine.js` — 25 scenes, scene director, sprites, windows, ghost frame, raster bars, color cycling, UI
- `index.html` — Live interactive viewer
- `render.html` — Offline video export (MP4/WebM/PNG)

## Conventions

- Typed arrays for all hardware memory (`Uint8Array`, `Uint32Array`, `Int16Array`)
- Bitwise ops for clamping in hot paths (no `Math.min/max` in render loops)
- `glitchRand()` / `glitchRandInt(n)` for seeded randomness
- `rebuildCGRAMCache()` after any palette mutation
- Scenes must fully reset PPU state in `setup()`
- Delta-time based animation via `performance.now()`
