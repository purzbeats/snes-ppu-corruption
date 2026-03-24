// ============================================================
//  SNES PPU CORRUPTION ENGINE — MENU SYSTEM
//  Authentic SNES-style bitmap font menu with gamepad support.
//  Designed for CRT installations with PS5/modern controllers.
//  Renders directly to the PPU framebuffer as an overlay.
// ============================================================

if (typeof MENU_LOADED === "undefined") { var MENU_LOADED = true; }

// ============================================================
//  SECTION 1: 8×8 BITMAP FONT
//  1-bpp, 8 bytes per glyph, MSB = leftmost pixel.
//  Covers ASCII 32–126 + custom glyphs 128+.
// ============================================================

const FONT_8x8 = (() => {
  // Flat array: (charCode - 32) * 8 = offset.  96 standard chars = 768 bytes.
  // Then custom glyphs starting at index 96*8.
  const data = new Uint8Array(128 * 8); // room for 128 glyphs

  // Helper — define a glyph from 8 hex bytes
  function g(code, b0,b1,b2,b3,b4,b5,b6,b7) {
    const o = (code - 32) * 8;
    data[o]=b0; data[o+1]=b1; data[o+2]=b2; data[o+3]=b3;
    data[o+4]=b4; data[o+5]=b5; data[o+6]=b6; data[o+7]=b7;
  }

  // -- Punctuation & symbols (ASCII 32–64) --
  g(32, 0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00); // space
  g(33, 0x18,0x18,0x18,0x18,0x18,0x00,0x18,0x00); // !
  g(34, 0x6C,0x6C,0x6C,0x00,0x00,0x00,0x00,0x00); // "
  g(35, 0x6C,0x6C,0xFE,0x6C,0xFE,0x6C,0x6C,0x00); // #
  g(36, 0x18,0x7E,0xC0,0x7C,0x06,0xFC,0x18,0x00); // $
  g(37, 0xC6,0xCC,0x18,0x30,0x66,0xC6,0x00,0x00); // %
  g(38, 0x38,0x6C,0x38,0x76,0xDC,0xCC,0x76,0x00); // &
  g(39, 0x18,0x18,0x30,0x00,0x00,0x00,0x00,0x00); // '
  g(40, 0x0C,0x18,0x30,0x30,0x30,0x18,0x0C,0x00); // (
  g(41, 0x30,0x18,0x0C,0x0C,0x0C,0x18,0x30,0x00); // )
  g(42, 0x00,0x66,0x3C,0xFF,0x3C,0x66,0x00,0x00); // *
  g(43, 0x00,0x18,0x18,0x7E,0x18,0x18,0x00,0x00); // +
  g(44, 0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x30); // ,
  g(45, 0x00,0x00,0x00,0x7E,0x00,0x00,0x00,0x00); // -
  g(46, 0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x00); // .
  g(47, 0x06,0x0C,0x18,0x30,0x60,0xC0,0x80,0x00); // /

  // -- Digits (48–57) --
  g(48, 0x7C,0xC6,0xCE,0xDE,0xF6,0xE6,0x7C,0x00); // 0
  g(49, 0x18,0x38,0x78,0x18,0x18,0x18,0x7E,0x00); // 1
  g(50, 0x7C,0xC6,0x06,0x1C,0x30,0x60,0xFE,0x00); // 2
  g(51, 0x7C,0xC6,0x06,0x3C,0x06,0xC6,0x7C,0x00); // 3
  g(52, 0x1C,0x3C,0x6C,0xCC,0xFE,0x0C,0x0C,0x00); // 4
  g(53, 0xFE,0xC0,0xFC,0x06,0x06,0xC6,0x7C,0x00); // 5
  g(54, 0x38,0x60,0xC0,0xFC,0xC6,0xC6,0x7C,0x00); // 6
  g(55, 0xFE,0x06,0x0C,0x18,0x30,0x30,0x30,0x00); // 7
  g(56, 0x7C,0xC6,0xC6,0x7C,0xC6,0xC6,0x7C,0x00); // 8
  g(57, 0x7C,0xC6,0xC6,0x7E,0x06,0x0C,0x78,0x00); // 9

  // -- Symbols (58–64) --
  g(58, 0x00,0x18,0x18,0x00,0x18,0x18,0x00,0x00); // :
  g(59, 0x00,0x18,0x18,0x00,0x18,0x18,0x30,0x00); // ;
  g(60, 0x0C,0x18,0x30,0x60,0x30,0x18,0x0C,0x00); // <
  g(61, 0x00,0x00,0x7E,0x00,0x7E,0x00,0x00,0x00); // =
  g(62, 0x60,0x30,0x18,0x0C,0x18,0x30,0x60,0x00); // >
  g(63, 0x7C,0xC6,0x06,0x1C,0x18,0x00,0x18,0x00); // ?
  g(64, 0x7C,0xC6,0xDE,0xDE,0xDC,0xC0,0x7C,0x00); // @

  // -- Uppercase letters (65–90) --
  g(65, 0x38,0x6C,0xC6,0xC6,0xFE,0xC6,0xC6,0x00); // A
  g(66, 0xFC,0xC6,0xC6,0xFC,0xC6,0xC6,0xFC,0x00); // B
  g(67, 0x3C,0x66,0xC0,0xC0,0xC0,0x66,0x3C,0x00); // C
  g(68, 0xF8,0xCC,0xC6,0xC6,0xC6,0xCC,0xF8,0x00); // D
  g(69, 0xFE,0xC0,0xC0,0xFC,0xC0,0xC0,0xFE,0x00); // E
  g(70, 0xFE,0xC0,0xC0,0xFC,0xC0,0xC0,0xC0,0x00); // F
  g(71, 0x3C,0x66,0xC0,0xCE,0xC6,0x66,0x3C,0x00); // G
  g(72, 0xC6,0xC6,0xC6,0xFE,0xC6,0xC6,0xC6,0x00); // H
  g(73, 0x7E,0x18,0x18,0x18,0x18,0x18,0x7E,0x00); // I
  g(74, 0x1E,0x06,0x06,0x06,0xC6,0xC6,0x7C,0x00); // J
  g(75, 0xC6,0xCC,0xD8,0xF0,0xD8,0xCC,0xC6,0x00); // K
  g(76, 0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xFE,0x00); // L
  g(77, 0xC6,0xEE,0xFE,0xD6,0xC6,0xC6,0xC6,0x00); // M
  g(78, 0xC6,0xE6,0xF6,0xDE,0xCE,0xC6,0xC6,0x00); // N
  g(79, 0x7C,0xC6,0xC6,0xC6,0xC6,0xC6,0x7C,0x00); // O
  g(80, 0xFC,0xC6,0xC6,0xFC,0xC0,0xC0,0xC0,0x00); // P
  g(81, 0x7C,0xC6,0xC6,0xC6,0xD6,0xCC,0x76,0x00); // Q
  g(82, 0xFC,0xC6,0xC6,0xFC,0xD8,0xCC,0xC6,0x00); // R
  g(83, 0x7C,0xC6,0xC0,0x7C,0x06,0xC6,0x7C,0x00); // S
  g(84, 0xFE,0x18,0x18,0x18,0x18,0x18,0x18,0x00); // T
  g(85, 0xC6,0xC6,0xC6,0xC6,0xC6,0xC6,0x7C,0x00); // U
  g(86, 0xC6,0xC6,0xC6,0xC6,0x6C,0x38,0x10,0x00); // V
  g(87, 0xC6,0xC6,0xC6,0xD6,0xFE,0xEE,0xC6,0x00); // W
  g(88, 0xC6,0xC6,0x6C,0x38,0x6C,0xC6,0xC6,0x00); // X
  g(89, 0xC6,0xC6,0x6C,0x38,0x18,0x18,0x18,0x00); // Y
  g(90, 0xFE,0x06,0x0C,0x18,0x30,0x60,0xFE,0x00); // Z

  // -- Symbols & lowercase mapped to upper (91–126) --
  g(91, 0x3C,0x30,0x30,0x30,0x30,0x30,0x3C,0x00); // [
  g(92, 0xC0,0x60,0x30,0x18,0x0C,0x06,0x02,0x00); // backslash
  g(93, 0x3C,0x0C,0x0C,0x0C,0x0C,0x0C,0x3C,0x00); // ]
  g(94, 0x10,0x38,0x6C,0xC6,0x00,0x00,0x00,0x00); // ^
  g(95, 0x00,0x00,0x00,0x00,0x00,0x00,0xFE,0x00); // _

  // Lowercase a-z → copy uppercase glyphs
  for (let i = 97; i <= 122; i++) {
    const src = (i - 32 - 32) * 8; // uppercase version
    const dst = (i - 32) * 8;
    for (let j = 0; j < 8; j++) data[dst + j] = data[src + j];
  }

  // Additional symbols
  g(96,  0x18,0x18,0x0C,0x00,0x00,0x00,0x00,0x00); // `
  g(123, 0x0E,0x18,0x18,0x70,0x18,0x18,0x0E,0x00); // {
  g(124, 0x18,0x18,0x18,0x18,0x18,0x18,0x18,0x00); // |
  g(125, 0x70,0x18,0x18,0x0E,0x18,0x18,0x70,0x00); // }
  g(126, 0x76,0xDC,0x00,0x00,0x00,0x00,0x00,0x00); // ~

  // -- Custom glyphs (code 128+, stored at index 96+) --
  // 128: ▶ right arrow (cursor)
  g(128, 0x00,0x40,0x60,0x70,0x78,0x70,0x60,0x40);
  // 129: ● filled dot (active indicator)
  g(129, 0x00,0x18,0x3C,0x7E,0x7E,0x3C,0x18,0x00);
  // 130: ○ hollow dot
  g(130, 0x00,0x18,0x24,0x42,0x42,0x24,0x18,0x00);
  // 131: ■ filled square (toggle on)
  g(131, 0x00,0x7E,0x7E,0x7E,0x7E,0x7E,0x00,0x00);
  // 132: □ hollow square (toggle off)
  g(132, 0x00,0x7E,0x42,0x42,0x42,0x7E,0x00,0x00);
  // 133: ◀ left arrow
  g(133, 0x00,0x04,0x0C,0x1C,0x3C,0x1C,0x0C,0x04);
  // 134: ▲ up arrow
  g(134, 0x18,0x3C,0x7E,0x18,0x18,0x18,0x18,0x00);
  // 135: ▼ down arrow
  g(135, 0x18,0x18,0x18,0x18,0x7E,0x3C,0x18,0x00);
  // 136: ─ horizontal line
  g(136, 0x00,0x00,0x00,0xFF,0xFF,0x00,0x00,0x00);
  // 137: │ vertical line
  g(137, 0x18,0x18,0x18,0x18,0x18,0x18,0x18,0x18);
  // 138: ┌ top-left corner
  g(138, 0x00,0x00,0x00,0x1F,0x1F,0x18,0x18,0x18);
  // 139: ┐ top-right corner
  g(139, 0x00,0x00,0x00,0xF8,0xF8,0x18,0x18,0x18);
  // 140: └ bottom-left corner
  g(140, 0x18,0x18,0x18,0x1F,0x1F,0x00,0x00,0x00);
  // 141: ┘ bottom-right corner
  g(141, 0x18,0x18,0x18,0xF8,0xF8,0x00,0x00,0x00);
  // 142: ┤ right T
  g(142, 0x18,0x18,0x18,0xF8,0xF8,0x18,0x18,0x18);
  // 143: ├ left T
  g(143, 0x18,0x18,0x18,0x1F,0x1F,0x18,0x18,0x18);

  return data;
})();

// ============================================================
//  SECTION 2: FONT RENDERING (direct to fb)
// ============================================================

// packRGBA is defined in ppu.js — reuse it

const MENU_WHITE  = packRGBA(255, 255, 255, 255);
const MENU_SHADOW = packRGBA(0, 0, 0, 255);
const MENU_DIM    = packRGBA(140, 140, 140, 255);
const MENU_CYAN   = packRGBA(100, 220, 255, 255);
const MENU_YELLOW = packRGBA(255, 220, 80, 255);
const MENU_GREEN  = packRGBA(80, 255, 120, 255);
const MENU_RED    = packRGBA(255, 80, 80, 255);

// Draw one character to the framebuffer (no bounds checking for speed)
function drawGlyph(charCode, px, py, color) {
  if (charCode < 32) return;
  const idx = (charCode >= 128)
    ? (96 + charCode - 128) * 8
    : (charCode - 32) * 8;
  if (idx < 0 || idx + 8 > FONT_8x8.length) return;

  for (let row = 0; row < 8; row++) {
    const sy = py + row;
    if (sy < 0 || sy >= SCREEN_H) continue;
    const bits = FONT_8x8[idx + row];
    if (bits === 0) continue;
    const fbRow = sy * SCREEN_W;
    for (let bit = 7; bit >= 0; bit--) {
      if (bits & (1 << bit)) {
        const sx = px + (7 - bit);
        if (sx >= 0 && sx < SCREEN_W) {
          fb[fbRow + sx] = color;
        }
      }
    }
  }
}

// Draw a string with optional 1px drop shadow
function drawText(str, px, py, color, shadow) {
  if (shadow) {
    for (let i = 0; i < str.length; i++) {
      drawGlyph(str.charCodeAt(i), px + i * 8 + 1, py + 1, MENU_SHADOW);
    }
  }
  for (let i = 0; i < str.length; i++) {
    drawGlyph(str.charCodeAt(i), px + i * 8, py, color);
  }
}

// Draw text centered horizontally within a pixel region
function drawTextCentered(str, regionX, regionW, py, color, shadow) {
  const textW = str.length * 8;
  const px = regionX + ((regionW - textW) >> 1);
  drawText(str, px, py, color, shadow);
}

// Darken a rectangular region of the framebuffer (semi-transparent panel)
function darkenRect(rx, ry, rw, rh, amount) {
  // amount: 0-255, where 0 = black, 255 = original
  for (let y = ry; y < ry + rh; y++) {
    if (y < 0 || y >= SCREEN_H) continue;
    const row = y * SCREEN_W;
    for (let x = rx; x < rx + rw; x++) {
      if (x < 0 || x >= SCREEN_W) continue;
      const px = fb[row + x];
      const r = ((px & 0xFF) * amount) >> 8;
      const g = (((px >> 8) & 0xFF) * amount) >> 8;
      const b = (((px >> 16) & 0xFF) * amount) >> 8;
      fb[row + x] = 0xFF000000 | (b << 16) | (g << 8) | r;
    }
  }
}

// Fill a rectangle with a solid color
function fillRect(rx, ry, rw, rh, color) {
  for (let y = ry; y < ry + rh; y++) {
    if (y < 0 || y >= SCREEN_H) continue;
    const row = y * SCREEN_W;
    for (let x = rx; x < rx + rw; x++) {
      if (x < 0 || x >= SCREEN_W) continue;
      fb[row + x] = color;
    }
  }
}

// Draw a box border using custom box-drawing glyphs
function drawBorder(bx, by, bw, bh, color) {
  // Corners
  drawGlyph(138, bx, by, color);                        // ┌
  drawGlyph(139, bx + (bw - 1) * 8, by, color);        // ┐
  drawGlyph(140, bx, by + (bh - 1) * 8, color);        // └
  drawGlyph(141, bx + (bw - 1) * 8, by + (bh - 1) * 8, color); // ┘
  // Top & bottom edges
  for (let i = 1; i < bw - 1; i++) {
    drawGlyph(136, bx + i * 8, by, color);              // ─
    drawGlyph(136, bx + i * 8, by + (bh - 1) * 8, color);
  }
  // Left & right edges
  for (let i = 1; i < bh - 1; i++) {
    drawGlyph(137, bx, by + i * 8, color);              // │
    drawGlyph(137, bx + (bw - 1) * 8, by + i * 8, color);
  }
}

// ============================================================
//  SECTION 3: MENU STATE
// ============================================================

const menu = {
  open: false,
  cursor: 0,
  sub: null,          // null = main menu, string = submenu key
  subCursor: 0,
  subScroll: 0,       // scroll offset for long lists
  openT: 0,           // 0→1 animation timer
  hintT: 0,           // idle timer for "PRESS START" hint
  lastInputTime: 0,   // for idle detection
  flash: 0,           // selection flash timer
};

// Input repeat state (for held directions)
const NAV_INITIAL_DELAY = 350;
const NAV_REPEAT_RATE = 80;
let navState = { dir: null, time: 0, lastRepeat: 0, triggered: false };

// --- Attract mode / idle detection ---
// Any user input disables auto-advance. After IDLE_TIMEOUT_MS of no
// input, auto-advance re-enables (attract mode).
const IDLE_TIMEOUT_MS = 120000; // 2 minutes

function userInteracted() {
  menu.lastInputTime = performance.now();
  if (sceneAutoAdvance) {
    sceneAutoAdvance = false;
  }
}

function checkIdleAttractMode() {
  if (!sceneAutoAdvance && !menu.open) {
    const idle = performance.now() - menu.lastInputTime;
    if (idle >= IDLE_TIMEOUT_MS) {
      sceneAutoAdvance = true;
      glitchMode = 0; // restore auto glitch too
    }
  }
}

// ============================================================
//  SECTION 4: MENU STRUCTURE
// ============================================================

function getMenuItems() {
  return [
    {
      label: "SCENE",
      type: "submenu",
      key: "scene",
      value: () => (currentScene >= 0 && currentScene < scenes.length) ? scenes[currentScene].name : "---",
    },
    {
      label: "GLITCH",
      type: "submenu",
      key: "glitch",
      value: () => glitchMode === 0 ? "AUTO" : (GLITCH_NAMES[glitchMode - 1] || "AUTO"),
    },
    {
      label: "EFFECTS",
      type: "submenu",
      key: "effects",
    },
    {
      label: "SCREENSHOT",
      type: "action",
      action: () => {
        const link = document.createElement("a");
        link.download = `snes_corruption_${Date.now()}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      },
    },
    {
      label: "FULLSCREEN",
      type: "action",
      action: () => {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          exitFullscreen();
        } else {
          enterFullscreen();
        }
      },
    },
  ];
}

function getSubmenuItems(key) {
  switch (key) {
    case "scene":
      return scenes.map((s, i) => ({
        label: s.name,
        type: "action",
        active: () => i === currentScene,
        action: () => { transitionToScene(i); },
      }));

    case "glitch":
      return [
        { label: "AUTO", type: "action", active: () => glitchMode === 0,
          action: () => { glitchMode = 0; sceneAutoAdvance = true; } },
        ...GLITCH_NAMES.map((name, i) => ({
          label: name.toUpperCase(),
          type: "action",
          active: () => glitchMode === i + 1,
          action: () => { glitchMode = i + 1; },
        })),
      ];

    case "effects":
      return [
        { label: "GHOST FRAME", type: "toggle", get: () => ghostEnabled, set: v => { ghostEnabled = v; } },
        { label: "WINDOW MASK", type: "toggle", get: () => windowEnabled, set: v => { windowEnabled = v; } },
        { label: "SPRITES", type: "toggle", get: () => spritesEnabled, set: v => { spritesEnabled = v; } },
        { label: "MODE 7", type: "toggle", get: () => ppuMode === 7,
          set: v => { ppuMode = v ? 7 : 1; bgEnabled[0] = !v; bgEnabled[1] = !v; } },
        { label: "AUTO ADVANCE", type: "toggle", get: () => sceneAutoAdvance, set: v => { sceneAutoAdvance = v; } },
        { label: "FREEZE", type: "toggle", get: () => frozen, set: v => { frozen = v; } },
        { label: "GLITCH BURST", type: "action",
          action: () => {
            lastGlitchBurst = frameCount;
            for (let i = 0; i < 15; i++) GLITCH_FNS[glitchRandInt(GLITCH_FNS.length)]();
          }
        },
        { label: "RESET SCENE", type: "action",
          action: () => {
            resetPPU(); generateEnhancedTiles();
            if (currentScene >= 0 && currentScene < scenes.length) scenes[currentScene].setup();
            sceneTimer = 0; sceneElapsedMs = 0;
          }
        },
      ];

    default:
      return [];
  }
}

// ============================================================
//  SECTION 5: MENU NAVIGATION
// ============================================================

function menuOpen() {
  menu.open = true;
  menu.openT = 0;
  menu.flash = 0;
  userInteracted();
}

function menuClose() {
  menu.open = false;
  menu.openT = 1; // will animate to 0
  menu.sub = null;
}

function menuNav(dir) {
  userInteracted();
  menu.flash = 0;

  if (menu.sub === null) {
    // Main menu navigation
    const items = getMenuItems();
    if (dir === "up") {
      menu.cursor = (menu.cursor - 1 + items.length) % items.length;
    } else if (dir === "down") {
      menu.cursor = (menu.cursor + 1) % items.length;
    } else if (dir === "right" || dir === "confirm") {
      const item = items[menu.cursor];
      if (item.type === "submenu") {
        menu.sub = item.key;
        menu.subCursor = 0;
        menu.subScroll = 0;
        // Try to position cursor on the active item
        const subItems = getSubmenuItems(item.key);
        for (let i = 0; i < subItems.length; i++) {
          if (subItems[i].active && subItems[i].active()) {
            menu.subCursor = i;
            break;
          }
        }
        // Adjust scroll for initial cursor position
        adjustSubmenuScroll();
      } else if (item.type === "action") {
        item.action();
        menu.flash = 10;
      }
    } else if (dir === "back") {
      menuClose();
    }
  } else {
    // Submenu navigation
    const subItems = getSubmenuItems(menu.sub);
    if (dir === "up") {
      menu.subCursor = (menu.subCursor - 1 + subItems.length) % subItems.length;
      adjustSubmenuScroll();
    } else if (dir === "down") {
      menu.subCursor = (menu.subCursor + 1) % subItems.length;
      adjustSubmenuScroll();
    } else if (dir === "confirm" || dir === "right") {
      const item = subItems[menu.subCursor];
      if (item.type === "action") {
        item.action();
        menu.flash = 10;
      } else if (item.type === "toggle") {
        item.set(!item.get());
        menu.flash = 6;
      }
    } else if (dir === "left" || dir === "back") {
      menu.sub = null;
    }
  }
}

const MAX_VISIBLE_SUB = 12;

function adjustSubmenuScroll() {
  if (menu.subCursor < menu.subScroll) {
    menu.subScroll = menu.subCursor;
  } else if (menu.subCursor >= menu.subScroll + MAX_VISIBLE_SUB) {
    menu.subScroll = menu.subCursor - MAX_VISIBLE_SUB + 1;
  }
}

// ============================================================
//  SECTION 6: GAMEPAD API
// ============================================================

// Standard gamepad mapping (PS5 DualSense / Xbox / generic HID):
//  0=Cross/A  1=Circle/B  2=Square/X  3=Triangle/Y
//  4=L1  5=R1  6=L2  7=R2  8=Share  9=Options/Start
//  10=L3  11=R3  12=Up  13=Down  14=Left  15=Right
//  axes[0]=LeftX  axes[1]=LeftY

const GP_CROSS = 0, GP_CIRCLE = 1, GP_SQUARE = 2, GP_TRIANGLE = 3;
const GP_L1 = 4, GP_R1 = 5, GP_L2 = 6, GP_R2 = 7;
const GP_SHARE = 8, GP_OPTIONS = 9;
const GP_L3 = 10, GP_R3 = 11;
const GP_UP = 12, GP_DOWN = 13, GP_LEFT = 14, GP_RIGHT = 15;

let prevButtons = new Array(17).fill(false);
let gamepadConnected = false;
const STICK_DEADZONE = 0.45;

// Returns true if button was just pressed (edge-triggered)
function gpPressed(gp, idx) {
  return gp.buttons[idx] && gp.buttons[idx].pressed && !prevButtons[idx];
}

function pollGamepad() {
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (let i = 0; i < gamepads.length; i++) {
    if (gamepads[i] && gamepads[i].connected) {
      gp = gamepads[i];
      gamepadConnected = true;
      break;
    }
  }
  if (!gp) {
    gamepadConnected = false;
    prevButtons.fill(false);
    return;
  }

  const now = performance.now();

  // --- Always-active controls (work whether menu is open or closed) ---

  // Options/Start = toggle menu
  if (gpPressed(gp, GP_OPTIONS)) {
    if (menu.open) menuClose(); else menuOpen();
    userInteracted();
  }

  // L1/R1 = prev/next scene (always)
  if (gpPressed(gp, GP_L1)) {
    transitionToScene((currentScene - 1 + scenes.length) % scenes.length);
    userInteracted();
  }
  if (gpPressed(gp, GP_R1)) {
    transitionToScene((currentScene + 1) % scenes.length);
    userInteracted();
  }

  // Any other button press counts as interaction (disables attract mode)
  for (let i = 0; i < gp.buttons.length; i++) {
    if (i === GP_OPTIONS || i === GP_L1 || i === GP_R1) continue;
    if (gp.buttons[i] && gp.buttons[i].pressed) {
      userInteracted();
      break;
    }
  }

  // --- Menu-only controls ---
  if (menu.open) {
    // D-pad navigation
    const dpadDir = getDpadDirection(gp, now);
    if (dpadDir) menuNav(dpadDir);

    // Cross/A = confirm
    if (gpPressed(gp, GP_CROSS)) menuNav("confirm");

    // Circle/B = back
    if (gpPressed(gp, GP_CIRCLE)) menuNav("back");
  }

  // Save button states for edge detection
  for (let i = 0; i < gp.buttons.length && i < prevButtons.length; i++) {
    prevButtons[i] = gp.buttons[i].pressed;
  }
}

// Handle D-pad + left stick with repeat logic
function getDpadDirection(gp, now) {
  // Determine desired direction from D-pad or left stick
  let dir = null;

  if (gp.buttons[GP_UP] && gp.buttons[GP_UP].pressed) dir = "up";
  else if (gp.buttons[GP_DOWN] && gp.buttons[GP_DOWN].pressed) dir = "down";
  else if (gp.buttons[GP_LEFT] && gp.buttons[GP_LEFT].pressed) dir = "left";
  else if (gp.buttons[GP_RIGHT] && gp.buttons[GP_RIGHT].pressed) dir = "right";

  // Left stick fallback
  if (!dir && gp.axes.length >= 2) {
    const lx = gp.axes[0], ly = gp.axes[1];
    if (Math.abs(ly) > Math.abs(lx) && Math.abs(ly) > STICK_DEADZONE) {
      dir = ly < 0 ? "up" : "down";
    } else if (Math.abs(lx) > STICK_DEADZONE) {
      dir = lx < 0 ? "left" : "right";
    }
  }

  // Repeat logic
  if (dir) {
    if (dir !== navState.dir) {
      // New direction — immediate trigger
      navState.dir = dir;
      navState.time = now;
      navState.lastRepeat = now;
      navState.triggered = true;
      return dir;
    } else {
      // Same direction held — repeat after delay
      const held = now - navState.time;
      if (held > NAV_INITIAL_DELAY && now - navState.lastRepeat > NAV_REPEAT_RATE) {
        navState.lastRepeat = now;
        return dir;
      }
    }
  } else {
    navState.dir = null;
    navState.triggered = false;
  }

  return null;
}

// ============================================================
//  SECTION 7: KEYBOARD INTEGRATION
// ============================================================

// Capture-phase listener runs BEFORE engine.js's keydown handler.
// When menu is open, we intercept navigation keys and stop propagation.
document.addEventListener("keydown", (e) => {
  const now = performance.now();

  // Escape or Tab = toggle menu (always)
  if (e.key === "Escape" || e.key === "Tab") {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (menu.open) menuClose(); else menuOpen();
    userInteracted();
    return;
  }

  if (!menu.open) {
    // Menu closed — any key still counts as user interaction (disables attract mode)
    userInteracted();
    return; // let engine handle the key
  }

  // Menu is open — intercept navigation keys
  e.preventDefault();
  e.stopImmediatePropagation();

  switch (e.key) {
    case "ArrowUp":    menuNav("up"); break;
    case "ArrowDown":  menuNav("down"); break;
    case "ArrowLeft":  menuNav("left"); break;
    case "ArrowRight": menuNav("right"); break;
    case "Enter":      menuNav("confirm"); break;
    case "Backspace":  menuNav("back"); break;
  }
}, true); // ← capture phase!

// ============================================================
//  SECTION 8: MENU RENDERING
// ============================================================

// Get a scene-aware accent color from the current palette
function getAccentColor() {
  // Sample a bright color from palette 1, color 4 (usually vivid)
  if (typeof cgramCache !== "undefined" && cgramCache[20]) {
    const c = cgramCache[20]; // palette 1, color 4
    // Check if it's too dark — fall back to cyan
    const r = c & 0xFF, g = (c >> 8) & 0xFF, b = (c >> 16) & 0xFF;
    if (r + g + b > 120) return c;
  }
  return MENU_CYAN;
}

function renderMenuOverlay() {
  const now = performance.now();

  // Animate open/close
  if (menu.open) {
    menu.openT = Math.min(1, menu.openT + 0.08);
  } else {
    menu.openT = Math.max(0, menu.openT - 0.08);
  }

  // Flash timer countdown
  if (menu.flash > 0) menu.flash--;

  // Menu not visible yet (fully closed)
  if (menu.openT <= 0 && !menu.open) return;

  // Smooth ease for slide animation
  const t = menu.openT;
  const ease = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);

  const accent = getAccentColor();
  const items = getMenuItems();

  if (menu.sub === null) {
    renderMainMenu(items, ease, accent);
  } else {
    renderSubmenu(ease, accent);
  }
}

function renderMainMenu(items, ease, accent) {
  // Panel dimensions (in pixels)
  const panelW = 200;
  const panelH = items.length * 14 + 38; // title + items + footer
  const panelX = ((SCREEN_W - panelW) >> 1);
  const panelY = ((SCREEN_H - panelH) >> 1);

  // Slide from left
  const slideX = Math.round((panelX + panelW) * (1 - ease) * -1);
  const px = panelX + slideX;
  const py = panelY;

  // Dark backdrop
  darkenRect(px - 2, py - 2, panelW + 4, panelH + 4, 50);

  // Border
  const borderCharW = Math.ceil(panelW / 8);
  const borderCharH = Math.ceil(panelH / 8);
  drawBorder(px, py, borderCharW, borderCharH, accent);

  // Title
  drawTextCentered("PPU CORRUPTION", px, panelW, py + 6, accent, true);

  // Divider line under title
  const divY = py + 18;
  for (let x = px + 8; x < px + panelW - 8; x += 2) {
    if (x >= 0 && x < SCREEN_W && divY >= 0 && divY < SCREEN_H) {
      fb[divY * SCREEN_W + x] = accent;
    }
  }

  // Menu items
  const itemStartY = py + 24;
  for (let i = 0; i < items.length; i++) {
    const iy = itemStartY + i * 14;
    const selected = (i === menu.cursor);

    // Selection highlight bar
    if (selected) {
      const barColor = (menu.flash > 0 && menu.flash % 2 === 0) ? MENU_WHITE : accent;
      fillRect(px + 6, iy - 1, panelW - 12, 11, packRGBA(
        (barColor & 0xFF) >> 2,
        ((barColor >> 8) & 0xFF) >> 2,
        ((barColor >> 16) & 0xFF) >> 2, 255
      ));
    }

    // Cursor arrow
    if (selected) {
      // Bob animation
      const bob = Math.round(Math.sin(performance.now() * 0.005) * 1.5);
      drawGlyph(128, px + 10 + bob, iy, accent); // ▶
    }

    // Label
    const labelColor = selected ? MENU_WHITE : MENU_DIM;
    drawText(items[i].label, px + 22, iy, labelColor, true);

    // Value or submenu arrow
    if (items[i].type === "submenu") {
      if (items[i].value) {
        // Show current value right-aligned
        const val = items[i].value();
        const valStr = val.length > 10 ? val.substring(0, 10) : val;
        drawText(valStr, px + panelW - 10 - valStr.length * 8, iy, selected ? MENU_YELLOW : MENU_DIM, true);
      } else {
        drawGlyph(128, px + panelW - 18, iy, selected ? MENU_WHITE : MENU_DIM); // ▸
      }
    }
  }

  // Footer — controller hints
  const footY = py + panelH - 14;
  if (gamepadConnected) {
    drawText("\x80 SELECT  \x85 BACK", px + 10, footY, MENU_DIM, false);
  } else {
    drawText("ENTER SEL  ESC BACK", px + 10, footY, MENU_DIM, false);
  }
}

function renderSubmenu(ease, accent) {
  const subItems = getSubmenuItems(menu.sub);
  const visibleCount = Math.min(subItems.length, MAX_VISIBLE_SUB);
  const showScrollUp = menu.subScroll > 0;
  const showScrollDown = menu.subScroll + MAX_VISIBLE_SUB < subItems.length;

  // Panel dimensions
  const panelW = 216;
  const headerH = 22;
  const itemH = 12;
  const footerH = 16;
  const scrollH = (showScrollUp ? 10 : 0) + (showScrollDown ? 10 : 0);
  const panelH = headerH + visibleCount * itemH + footerH + scrollH + 8;
  const panelX = ((SCREEN_W - panelW) >> 1);
  const panelY = ((SCREEN_H - panelH) >> 1);

  // Slide from right
  const slideX = Math.round((SCREEN_W - panelX) * (1 - ease));
  const px = panelX + slideX;
  const py = panelY;

  // Backdrop
  darkenRect(px - 2, py - 2, panelW + 4, panelH + 4, 40);

  // Border
  const borderCharW = Math.ceil(panelW / 8);
  const borderCharH = Math.ceil(panelH / 8);
  drawBorder(px, py, borderCharW, borderCharH, accent);

  // Title (submenu name)
  const title = menu.sub.toUpperCase();
  drawTextCentered(title, px, panelW, py + 6, accent, true);

  // Divider
  const divY = py + 18;
  for (let x = px + 8; x < px + panelW - 8; x += 2) {
    if (x >= 0 && x < SCREEN_W && divY >= 0 && divY < SCREEN_H) {
      fb[divY * SCREEN_W + x] = accent;
    }
  }

  let itemY = py + headerH + 2;

  // Scroll-up indicator
  if (showScrollUp) {
    drawTextCentered("\x86 \x86 \x86", px, panelW, itemY, MENU_DIM, false);
    itemY += 10;
  }

  // Items
  for (let vi = 0; vi < visibleCount; vi++) {
    const idx = menu.subScroll + vi;
    if (idx >= subItems.length) break;
    const item = subItems[idx];
    const iy = itemY + vi * itemH;
    const selected = (idx === menu.subCursor);

    // Selection bar
    if (selected) {
      const barColor = (menu.flash > 0 && menu.flash % 2 === 0) ? MENU_WHITE : accent;
      fillRect(px + 6, iy - 1, panelW - 12, 10, packRGBA(
        (barColor & 0xFF) >> 2,
        ((barColor >> 8) & 0xFF) >> 2,
        ((barColor >> 16) & 0xFF) >> 2, 255
      ));
    }

    // Cursor
    if (selected) {
      const bob = Math.round(Math.sin(performance.now() * 0.005) * 1.5);
      drawGlyph(128, px + 8 + bob, iy, accent);
    }

    // Label
    const labelColor = selected ? MENU_WHITE : MENU_DIM;
    drawText(item.label, px + 20, iy, labelColor, true);

    // Value / state indicator (right side)
    if (item.type === "toggle") {
      const on = item.get();
      const stateColor = on ? MENU_GREEN : MENU_RED;
      const stateGlyph = on ? 131 : 132; // ■ or □
      drawGlyph(stateGlyph, px + panelW - 28, iy, stateColor);
      drawText(on ? "ON" : "OFF", px + panelW - 18 - (on ? 16 : 24), iy, stateColor, false);
    } else if (item.active && item.active()) {
      drawGlyph(129, px + panelW - 20, iy, MENU_YELLOW); // ●
    }
  }

  const afterItems = itemY + visibleCount * itemH;

  // Scroll-down indicator
  if (showScrollDown) {
    drawTextCentered("\x87 \x87 \x87", px, panelW, afterItems + 2, MENU_DIM, false);
  }

  // Footer
  const footY = py + panelH - 14;
  if (gamepadConnected) {
    drawText("\x85 BACK", px + 10, footY, MENU_DIM, false);
  } else {
    drawText("ESC BACK  BKSP BACK", px + 10, footY, MENU_DIM, false);
  }
}

// ============================================================
//  SECTION 9: HOOK INTO RENDER PIPELINE
// ============================================================

// Wrap renderFrame to inject menu overlay before putImageData.
// engine.js's renderFrame() writes to fb then calls ctx.putImageData.
// We draw the menu onto fb and re-blit.
const _menuOrigRenderFrame = renderFrame;
renderFrame = function() {
  _menuOrigRenderFrame();

  // Draw menu overlay if open or animating
  if (menu.open || menu.openT > 0) {
    renderMenuOverlay();
    ctx.putImageData(imgData, 0, 0);
  }
};

// ============================================================
//  SECTION 10: GAMEPAD POLLING LOOP
// ============================================================

// Separate RAF loop for gamepad — runs independently of frozen state.
// Also handles rendering the menu when the engine is frozen.
function menuPollLoop() {
  pollGamepad();
  checkIdleAttractMode();

  // When frozen, the main loop doesn't call renderFrame, so we render
  // the menu overlay directly if needed.
  if (frozen && (menu.open || menu.openT > 0)) {
    renderMenuOverlay();
    ctx.putImageData(imgData, 0, 0);
  }

  requestAnimationFrame(menuPollLoop);
}

// Initialize
menu.lastInputTime = performance.now();
requestAnimationFrame(menuPollLoop);

// Announce gamepad connection/disconnection
window.addEventListener("gamepadconnected", (e) => {
  gamepadConnected = true;
  console.log("Gamepad connected:", e.gamepad.id);
});
window.addEventListener("gamepaddisconnected", () => {
  gamepadConnected = false;
  console.log("Gamepad disconnected");
});
