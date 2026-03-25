# SNES PPU Corruption Engine

Generative art engine simulating the Super Nintendo PPU with controlled corruption algorithms. Runs entirely in the browser — no dependencies, no build step.

## Modes

| File | Purpose |
|---|---|
| `index.html` | Interactive viewer with menu + gamepad support |
| `streaming.html` | Ambient TV background — zero input, smooth transitions |
| `render.html` | Offline video export (MP4/WebM/PNG frames) |

## URL Parameters

All parameters work on `index.html` and `streaming.html`. Combine freely:

```
index.html?crt=true&scene=5&glitch=3
streaming.html?crt=true&barrel=0.06&bloom=0.5
```

### Engine

| Parameter | Default | Description |
|---|---|---|
| `scene` | random | Starting scene index (0-30) |
| `glitch` | `0` | Lock glitch mode (0=auto, 1-13=specific glitch) |
| `ghost` | per-scene | Force ghost frame on/off (`true`/`false`) |
| `autoAdvance` | `true` | Auto-cycle through scenes (`true`/`false`) |

### CRT Shader

| Parameter | Default | Description |
|---|---|---|
| `crt` | `false` | Enable CRT post-processing (`true`/`false`) |
| `scanlines` | `0.20` | Scanline darkening intensity (0-1) |
| `phosphor` | `0.15` | RGB aperture grille intensity (0-1) |
| `barrel` | `0.04` | Barrel distortion / screen curvature (0-0.2) |
| `bloom` | `0.30` | Bloom / bright pixel bleed (0-1) |
| `bloomRadius` | `1.5` | Bloom blur sample radius in texels |
| `chromatic` | `0.6` | Chromatic aberration in pixels at edges |
| `vignette` | `0.35` | Corner darkening intensity (0-1) |
| `noise` | `0.04` | Animated film grain intensity (0-0.2) |

### Examples

```
# CRT installation with heavy curvature and bloom
index.html?crt=true&barrel=0.06&bloom=0.5&scanlines=0.3

# Lock on a landscape with no auto-advance
index.html?scene=25&autoAdvance=false&ghost=true

# Streaming with subtle CRT and forced ghost trails
streaming.html?crt=true&barrel=0.02&bloom=0.2&vignette=0.5

# Clean pixel art, no effects
index.html?crt=false

# Maximum CRT authenticity
index.html?crt=true&scanlines=0.25&phosphor=0.2&barrel=0.05&bloom=0.35&chromatic=0.8&vignette=0.4&noise=0.05
```

## Controls

### Keyboard (index.html)

| Key | Action |
|---|---|
| Escape / Tab | Toggle menu |
| Arrow keys | Navigate menu |
| Enter | Select |
| Backspace | Back |
| Space | Glitch burst |
| N / P | Next / previous scene |
| H | Toggle HUD |
| G | Toggle ghost frame |
| M | Toggle Mode 7 |
| F | Freeze animation |
| S | Screenshot |
| 1-9 | Lock glitch type |
| 0 | Auto glitch mode |

### Gamepad (PS5 / Xbox / standard)

| Button | Action |
|---|---|
| Options / Start | Toggle menu |
| L1 / R1 | Previous / next scene |
| D-pad / Left stick | Navigate menu |
| Cross / A | Select |
| Circle / B | Back |

Any input disables auto-advance. After 2 minutes idle, attract mode resumes.

## Files

| File | Role |
|---|---|
| `ppu.js` | Core PPU simulation, VRAM/CGRAM/OAM, rendering pipeline, 13 glitch algorithms |
| `engine.js` | 26 scenes, scene director, sprites, windows, ghost frame, raster bars, color cycling |
| `landscape.js` | 10 landscape biomes with weather particles, parallax, day/night cycle |
| `crt.js` | WebGL2 CRT post-processing shader |
| `menu.js` | SNES bitmap font menu, gamepad support, attract mode |
