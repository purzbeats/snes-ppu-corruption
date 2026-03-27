# Changelog

## 2026-03-26 — Performance: Tier 1 hot-path optimizations

Targeted the 8 highest-value performance issues identified during a full codebase audit.
These changes focus on the per-frame render loop and reduce CPU cost by eliminating
redundant work, avoiding allocations, and replacing expensive math with lookup tables.

### CGRAM dirty flag (`ppu.js`, `engine.js`, `landscape.js`)

`rebuildCGRAMCache()` was unconditionally unpacking all 256 SNES 15-bit colors into
RGBA every single frame — even when no palette had changed. Added a `cgramDirty` flag
and `markCGRAMDirty()` function. Every CGRAM write site across all three files now marks
the cache dirty. `rebuildCGRAMCache()` early-returns when clean. This eliminates 256
color conversions per frame (~15,360/sec) during static palette periods.

### Per-tile BG scanline rendering (`ppu.js:renderBGScanline`)

The original implementation iterated per-pixel (256 iterations per scanline per BG layer),
re-fetching the tilemap entry, re-decoding tile metadata (palette, priority, flip flags),
and calling `decodeTilePixel()` + `getCGRAMColor()` as separate functions for every pixel.
Since SNES tiles are 8px wide, up to 7/8 of these fetches were redundant.

Rewrote to iterate per-tile: the tilemap entry is fetched once per 8-pixel span, all four
VRAM bitplane bytes for the tile row are read once, and the CGRAM lookup is inlined as a
direct `cgramCache[]` array access. The inner loop processes only the pixels within the
current tile, advancing by tile width. This eliminates ~75% of tilemap fetches and removes
all `decodeTilePixel()` and `getCGRAMColor()` function call overhead from the hot path.

### Color math loop split (`ppu.js`, `engine.js`)

The framebuffer write loop checked `colorMathMode !== 0` on every pixel (57,344 times per
frame). Split into two separate loops — one direct copy path when color math is off, one
with `applyColorMath()` when on. Also added a `mosaicSize > 1` guard before calling
`applyMosaic()` to skip the function call entirely when mosaic is disabled (the common case).

### Sine lookup table (`ppu.js` → shared globally)

Added a 1024-entry `Float32Array` sine LUT in `ppu.js` with `sinLUT(x)` and `cosLUT(x)`
functions that map arbitrary radian values to table indices via bitwise AND. This replaces
`Math.sin()` / `Math.cos()` calls in per-frame HDMA wave animation across three scenes:

- **AURORA** — 448 sin calls/frame → 448 LUT lookups
- **SUBMERGED** — 448 sin calls/frame (two overlapping waves) → LUT lookups
- **PRISM** — 448 sin+cos calls/frame for window displacement → LUT lookups

### Landscape HDMA allocation removal (`landscape.js`)

Four biome-specific HDMA updates (volcanic, ocean, desert, neon) used
`Array.from({ length: N }, (_, i) => Math.floor(Math.sin(...)))` to create and discard
arrays every 20–30 frames. Replaced with plain `new Array(N)` + `sinLUT()` loop fill.
Also replaced `hdmaEffects = hdmaEffects.slice(-2)` (allocates new array) with
`hdmaEffects.length = 2` (in-place truncation, zero allocation).

### RACING HORIZON perspective optimization (`engine.js`)

The Mode 7 HDMA perspective rebuild loop computed `maxDist`, `perspectiveScale`, and a
branch for above/below horizon on every scanline (224 iterations/frame). Hoisted constants
(`maxDist`, `scaleFactor = maxDist * 0.15 * cosR`) outside the loop and split into two
loops (above horizon: constant fill, below horizon: division only) to eliminate per-scanline
branching and redundant multiplication.

### Mode 7 CGRAM inline (`ppu.js:renderMode7Scanline`)

Replaced `getCGRAMColor(0, colorIdx)` function call with direct `cgramCache[colorIdx & 0xFF]`
array access in the Mode 7 per-pixel loop (256 × 224 = 57,344 calls/frame when Mode 7 active).
