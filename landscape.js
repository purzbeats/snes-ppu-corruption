// ============================================================
//  SNES PPU CORRUPTION ENGINE — LANDSCAPE MODE
//  Hand-authored still portrait setpieces with color cycling.
//  Corrupted skies over tile-built terrain silhouettes.
//  Each biome is a unique, recognizable composition.
// ============================================================

if (typeof LANDSCAPE_LOADED === "undefined") { var LANDSCAPE_LOADED = true; }

// ============================================================
//  SECTION 1: TILE WRITING HELPERS
// ============================================================

function writeTilePixels(tileAddr, pixels) {
  for (let row = 0; row < 8; row++) {
    let bp0 = 0, bp1 = 0, bp2 = 0, bp3 = 0;
    for (let x = 0; x < 8; x++) {
      const bit = 7 - x;
      const p = pixels[row * 8 + x] & 0xF;
      bp0 |= ((p >> 0) & 1) << bit;
      bp1 |= ((p >> 1) & 1) << bit;
      bp2 |= ((p >> 2) & 1) << bit;
      bp3 |= ((p >> 3) & 1) << bit;
    }
    VRAM[tileAddr + row * 2]      = bp0;
    VRAM[tileAddr + row * 2 + 1]  = bp1;
    VRAM[tileAddr + row * 2 + 16] = bp2;
    VRAM[tileAddr + row * 2 + 17] = bp3;
  }
}

function writeTileStr(tileAddr, rows) {
  const px = new Uint8Array(64);
  for (let r = 0; r < 8; r++) {
    for (let x = 0; x < 8; x++) {
      px[r * 8 + x] = parseInt(rows[r][x], 16);
    }
  }
  writeTilePixels(tileAddr, px);
}

function writeCGRAM(palIdx, colIdx, r, g, b) {
  const snes = rgbToSnesColor(r, g, b);
  const addr = (palIdx * 16 + colIdx) * 2;
  CGRAM[addr] = snes & 0xFF;
  CGRAM[addr + 1] = (snes >> 8) & 0xFF;
}

function writeTilemapEntry(base, tx, ty, tileIdx, palette, hFlip, vFlip) {
  if (tx < 0 || tx >= 32 || ty < 0 || ty >= 32) return;
  const addr = base + (ty * 32 + tx) * 2;
  const entry = (tileIdx & 0x3FF) | ((palette & 7) << 10) |
                ((hFlip ? 1 : 0) << 14) | ((vFlip ? 1 : 0) << 15);
  VRAM[addr] = entry & 0xFF;
  VRAM[addr + 1] = (entry >> 8) & 0xFF;
}

// Composition helpers
function clearTilemap(base) {
  for (let ty = 0; ty < 32; ty++)
    for (let tx = 0; tx < 32; tx++)
      writeTilemapEntry(base, tx, ty, 0, 0, false, false);
}

function fillRect(base, x, y, w, h, tile, pal) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      writeTilemapEntry(base, x + dx, y + dy, tile, pal, false, false);
}

function fillRow(base, y, x0, x1, tile, pal) {
  for (let x = x0; x <= x1; x++)
    writeTilemapEntry(base, x, y, tile, pal, false, false);
}

function fillCol(base, x, y0, y1, tile, pal) {
  for (let y = y0; y <= y1; y++)
    writeTilemapEntry(base, x, y, tile, pal, false, false);
}

// ============================================================
//  SECTION 2: TILE DEFINITIONS
// ============================================================

const LAND_TILE_BASE = 0x2000;
function T(idx) { return LAND_TILE_BASE + idx * 32; }

// -- Shared tiles (0-5) --
function generateSharedTiles() {
  // 0: Empty (transparent)
  writeTileStr(T(0), [
    "00000000","00000000","00000000","00000000",
    "00000000","00000000","00000000","00000000"]);
  // 1: Solid earth
  writeTileStr(T(1), [
    "11111111","11511151","15111511","11111111",
    "11151111","11111151","15111111","11111111"]);
  // 2: Deep earth
  writeTileStr(T(2), [
    "55155515","15551555","55155515","15555155",
    "55515555","15551555","55155551","15555515"]);
  // 3: Grass surface
  writeTileStr(T(3), [
    "00000000","24242424","21212121","11111111",
    "11151111","11111111","11111511","11111111"]);
  // 4: Left slope
  writeTileStr(T(4), [
    "00000000","00000000","00000032","00003211",
    "00321111","32111111","11111111","11111111"]);
  // 5: Right slope
  writeTileStr(T(5), [
    "00000000","00000000","23000000","11230000",
    "11112300","11111123","11111111","11111111"]);
}

// -- Forest tiles (6-25) --
function generateForestTiles() {
  generateSharedTiles();
  // 6: Thin trunk
  writeTileStr(T(6), [
    "00066000","00066000","00066000","00066000",
    "00066000","00066000","00066000","00066000"]);
  // 7: Thick trunk
  writeTileStr(T(7), [
    "00677600","00677600","06677660","06677660",
    "06677660","06677660","00677600","00677600"]);
  // 8: Dense canopy
  writeTileStr(T(8), [
    "33433343","43334334","34333433","33434333",
    "43333434","33343333","34334333","43333434"]);
  // 9: Canopy top rounded
  writeTileStr(T(9), [
    "00033000","00334300","03343340","33433343",
    "43334334","34333433","33434333","43333434"]);
  // 10: Canopy left
  writeTileStr(T(10), [
    "00000003","00000034","00000343","00003433",
    "00034334","00343334","03433343","34334334"]);
  // 11: Canopy right
  writeTileStr(T(11), [
    "30000000","43000000","34300000","33430000",
    "43340000","43334000","34333430","43343343"]);
  // 12: Trunk base / roots
  writeTileStr(T(12), [
    "00677600","06677660","66677666","11677611",
    "11167111","11111111","11111111","11111111"]);
  // 13: Small bush
  writeTileStr(T(13), [
    "00000000","00000000","00340000","03434300",
    "34343430","43434343","24242424","11111111"]);
  // 14: Tall bush
  writeTileStr(T(14), [
    "00000000","00340000","03434300","34343430",
    "43434343","34343434","24242424","11111111"]);
  // 15: Mushroom
  writeTileStr(T(15), [
    "00000000","00000000","00088000","00899800",
    "08999980","00899800","00066000","00066000"]);
  // 16: Water surface (for pond)
  writeTileStr(T(16), [
    "77877877","78787878","87878787","78787878",
    "87878787","78787878","87878787","77877877"]);
  // 17: Water deep
  writeTileStr(T(17), [
    "77177717","17771777","77177717","17777177",
    "77717777","17771777","77177771","17777717"]);
  // 18: Grass tuft
  writeTileStr(T(18), [
    "00000000","04000040","24000420","34200430",
    "24242424","11111111","11111111","11111111"]);
  // 19: Pine top
  writeTileStr(T(19), [
    "00030000","00034000","00343400","03434340",
    "00343400","03434340","34343434","03434340"]);
  // 20: Pine middle
  writeTileStr(T(20), [
    "34343434","03434340","34343434","43434343",
    "03434340","34343434","43434343","34343434"]);
  // 21: Pine base + trunk
  writeTileStr(T(21), [
    "43434343","34343434","03434340","00343400",
    "00066000","00066000","00066000","00066000"]);
  // 22: Firefly tile (color 8 = cycling glow)
  writeTileStr(T(22), [
    "00000000","00000000","00800000","00000000",
    "00000008","00000000","00080000","00000000"]);
  // 23: Fallen log
  writeTileStr(T(23), [
    "00000000","00000000","00000000","00000000",
    "66666666","56565656","65656565","11111111"]);
  // 24: Stars / night sky detail (placed in ground layer for static sparkle)
  writeTileStr(T(24), [
    "00000000","00080000","00000000","00000008",
    "08000000","00000000","00000080","00000000"]);
  // 25: Ground stones
  writeTileStr(T(25), [
    "11151111","11555111","15555511","11555111",
    "11151111","11111111","11151111","11111111"]);
}

// -- Ice tiles (6-25) --
function generateIceTiles() {
  generateSharedTiles();
  // 6: Mountain fill
  writeTileStr(T(6), [
    "55655565","56565656","65656565","55655565",
    "56565656","65656565","55655565","56565656"]);
  // 7: Mountain peak
  writeTileStr(T(7), [
    "00000000","00000000","00033000","00355300",
    "03555530","35555553","55655565","56565656"]);
  // 8: Mountain left slope
  writeTileStr(T(8), [
    "00000000","00000005","00000055","00000556",
    "00005565","00055656","00556565","05565656"]);
  // 9: Mountain right slope
  writeTileStr(T(9), [
    "00000000","50000000","55000000","65500000",
    "56550000","65650000","56565000","65656500"]);
  // 10: Snow surface
  writeTileStr(T(10), [
    "00000000","33333333","23232323","11111111",
    "11111111","11511151","11111111","11111111"]);
  // 11: Ice crystal
  writeTileStr(T(11), [
    "00070000","00070000","00777000","07777700",
    "00777000","00070000","00070000","00000000"]);
  // 12: Frozen lake
  writeTileStr(T(12), [
    "33733373","37373737","73737373","33733373",
    "37373737","73737373","33733373","37373737"]);
  // 13: Cracked ice
  writeTileStr(T(13), [
    "33333333","33303333","33300333","30000033",
    "33000333","33300333","33330333","33333333"]);
  // 14: Snow pile
  writeTileStr(T(14), [
    "00000000","00000000","00333000","03232300",
    "32323230","33333333","23232323","11111111"]);
  // 15: Icicle
  writeTileStr(T(15), [
    "77777777","07070707","07070700","00700700",
    "00700000","00000000","00000000","00000000"]);
  // 16: Aurora color (cycling palette entry 8)
  writeTileStr(T(16), [
    "00000000","00080000","00000800","08000000",
    "00000008","00800000","00000080","00000000"]);
  // 17: Snowdrift left
  writeTileStr(T(17), [
    "00000000","00000000","00000003","00000033",
    "00003323","00033232","03323232","33232323"]);
  // 18: Snowdrift right
  writeTileStr(T(18), [
    "00000000","00000000","30000000","33000000",
    "32330000","23233000","23232330","32323233"]);
  // 19: Mountain snow cap
  writeTileStr(T(19), [
    "00000000","00000000","00033000","00322300",
    "03222230","32222223","55555555","56565656"]);
}

// -- Alien tiles (6-25) --
function generateAlienTiles() {
  generateSharedTiles();
  // Override shared ground with alien texture
  writeTileStr(T(1), [
    "11181118","18111811","11818118","81118111",
    "18111181","11181118","81118111","11811181"]);
  writeTileStr(T(3), [
    "00000000","89898989","18181818","11181118",
    "18111811","11111111","11811181","18111811"]);
  // 6: Tall spire
  writeTileStr(T(6), [
    "00088000","00088000","00088000","00088000",
    "00088000","00088000","00088000","00088000"]);
  // 7: Spire top bulb
  writeTileStr(T(7), [
    "00099000","00999900","09AAAA90","9AAAAAA9",
    "09AAAA90","00999900","00099000","00088000"]);
  // 8: Organic pod
  writeTileStr(T(8), [
    "00000000","00099000","00999900","09AAAA90",
    "09AAAA90","00999900","00099000","00000000"]);
  // 9: Bioluminescent plant (color 8,9,A = cycling glow)
  writeTileStr(T(9), [
    "00000000","00090000","00989000","09898900",
    "00989000","00090000","00000000","00000000"]);
  // 10: Tendril curving left
  writeTileStr(T(10), [
    "00000088","00000880","00008800","00088000",
    "00880000","08800000","88000000","80000000"]);
  // 11: Tendril curving right
  writeTileStr(T(11), [
    "88000000","08800000","00880000","00088000",
    "00008800","00000880","00000088","00000008"]);
  // 12: Alien ground growth
  writeTileStr(T(12), [
    "00900090","09009009","90099009","09900990",
    "89898989","18181818","11111111","11811181"]);
  // 13: Crystal formation
  writeTileStr(T(13), [
    "000A0000","000AA000","00AAAA00","0AAAAAA0",
    "00AAAA00","000AA000","000A0000","00000000"]);
  // 14: Egg cluster
  writeTileStr(T(14), [
    "00000000","09009000","99099900","09009000",
    "00900090","09909900","09009000","00000000"]);
  // 15: Alien tree trunk
  writeTileStr(T(15), [
    "00880000","00088000","00880000","00088000",
    "00880000","00088000","00880000","00088000"]);
  // 16: Tentacle base
  writeTileStr(T(16), [
    "88088088","08808808","88088088","88888888",
    "89898989","18181818","11111111","11811181"]);
  // 17: Floating spore
  writeTileStr(T(17), [
    "00000000","00000000","00090000","00999000",
    "00090000","00000000","00000000","00000000"]);
  // 18: Double moon (sky detail)
  writeTileStr(T(18), [
    "00770000","07777000","07777000","00770000",
    "00000770","00007777","00007777","00000770"]);
}

// -- Volcanic tiles (6-25) --
function generateVolcanicTiles() {
  generateSharedTiles();
  // Override ground to ash/stone
  writeTileStr(T(1), [
    "55155515","15551555","55155515","15555155",
    "55515555","15551555","55155551","15555515"]);
  writeTileStr(T(3), [
    "00000000","55555555","51515151","15151515",
    "55155515","15551555","55515555","15555155"]);
  // 6: Volcano slope fill
  writeTileStr(T(6), [
    "55655565","56565656","65656565","55655565",
    "56565656","65656565","55655565","56565656"]);
  // 7: Volcano peak
  writeTileStr(T(7), [
    "00000000","00000000","00066000","00688600",
    "06899860","68999986","56888865","55666655"]);
  // 8: Lava surface (color 8,9=cycling fire)
  writeTileStr(T(8), [
    "88998899","98899889","89988998","99889988",
    "88998899","98899889","89988998","99889988"]);
  // 9: Lava glow from below
  writeTileStr(T(9), [
    "55555555","55585555","55888555","58888855",
    "88999888","89999988","99AA9999","AAAAAAAA"]);
  // 10: Ruined pillar
  writeTileStr(T(10), [
    "00566500","00566500","00566500","00566500",
    "00566500","00566500","00566500","00566500"]);
  // 11: Pillar capital
  writeTileStr(T(11), [
    "05555550","56666665","05666650","00566500",
    "00566500","00566500","00566500","00566500"]);
  // 12: Pillar base / rubble
  writeTileStr(T(12), [
    "00566500","05566550","55566555","55555555",
    "55055505","50050050","00000000","00000000"]);
  // 13: Smoke wisp
  writeTileStr(T(13), [
    "00050000","00555000","05050500","00505000",
    "05005000","00050000","00000000","00000000"]);
  // 14: Lava channel left slope
  writeTileStr(T(14), [
    "55555588","55555889","55558899","55588999",
    "55889999","58899999","88999999","99999999"]);
  // 15: Lava channel right slope
  writeTileStr(T(15), [
    "88555555","98855555","99885555","99988555",
    "99998855","99999885","99999988","99999999"]);
  // 16: Volcano left slope
  writeTileStr(T(16), [
    "00000000","00000005","00000056","00005656",
    "00056565","00565656","05656565","56565656"]);
  // 17: Volcano right slope
  writeTileStr(T(17), [
    "00000000","50000000","65000000","56560000",
    "65650000","56565000","56565650","56565656"]);
  // 18: Ruined arch
  writeTileStr(T(18), [
    "55555555","56000065","56000065","56000065",
    "56000065","56000065","56000065","56000065"]);
  // 19: Crumbling block
  writeTileStr(T(19), [
    "05565005","55665560","56665665","56656565",
    "05560550","00500500","00000000","00000000"]);
}

// -- Ocean tiles (6-25) --
function generateOceanTiles() {
  generateSharedTiles();
  // 6: Wave crest
  writeTileStr(T(6), [
    "00000000","00300030","03730373","37373737",
    "73737373","77777777","71717171","17171717"]);
  // 7: Calm water surface
  writeTileStr(T(7), [
    "77377737","73737373","37373737","77377737",
    "73737373","37373737","77377737","73737373"]);
  // 8: Deep water
  writeTileStr(T(8), [
    "11711171","17171717","71717171","11711171",
    "17171717","71717171","11711171","17171717"]);
  // 9: Data tower segment
  writeTileStr(T(9), [
    "0AAAAAA0","A0A0A0A0","AAAAAAAA","A0A0A0A0",
    "AAAAAAAA","A0A0A0A0","0AAAAAA0","00000000"]);
  // 10: Data tower top
  writeTileStr(T(10), [
    "00000000","000AA000","00AAAA00","0AAAAAA0",
    "AAAAAAAA","A0A0A0A0","AAAAAAAA","A0A0A0A0"]);
  // 11: Shore/sand
  writeTileStr(T(11), [
    "22322232","23232323","32323232","22322232",
    "23232323","32323232","22322232","23232323"]);
  // 12: Shore left edge
  writeTileStr(T(12), [
    "00000000","00000000","00000002","00000023",
    "00002322","00023232","02323232","23232322"]);
  // 13: Shore right edge
  writeTileStr(T(13), [
    "00000000","00000000","20000000","32000000",
    "22320000","23232000","23232320","22323232"]);
  // 14: Coral / reef (cycling color 9)
  writeTileStr(T(14), [
    "00000000","00900000","09990000","09990900",
    "00909990","00009990","00000900","00000000"]);
  // 15: Distant structure silhouette
  writeTileStr(T(15), [
    "00550000","00550000","05555000","05555000",
    "55555500","55555500","55555550","55555550"]);
  // 16: Sunset reflection shimmer (color 8 = cycling)
  writeTileStr(T(16), [
    "80000008","00800080","00080800","00000000",
    "00800080","08000008","00008000","00000000"]);
  // 17: Seabed
  writeTileStr(T(17), [
    "11511151","15111511","11111111","51111151",
    "11515111","11111111","11151115","51111151"]);
  // 18: Pier / dock post
  writeTileStr(T(18), [
    "00066000","00066000","00066000","00066000",
    "00066000","00066000","00066000","00066000"]);
  // 19: Horizon glow (color 8)
  writeTileStr(T(19), [
    "88888888","80808080","08080808","00800080",
    "00080800","00000000","00000000","00000000"]);
}

// -- Void temple tiles (6-25) --
function generateVoidTiles() {
  generateSharedTiles();
  // Override ground to void stone
  writeTileStr(T(1), [
    "55755575","57575757","75757575","55755575",
    "57575757","75757575","55755575","57575757"]);
  // 6: Temple column
  writeTileStr(T(6), [
    "05777750","05777750","05777750","05777750",
    "05777750","05777750","05777750","05777750"]);
  // 7: Column capital
  writeTileStr(T(7), [
    "57777775","77555577","75777757","57777775",
    "05777750","05777750","05777750","05777750"]);
  // 8: Column base
  writeTileStr(T(8), [
    "05777750","05777750","57777775","77555577",
    "75555557","55555555","55555555","55555555"]);
  // 9: Temple pediment (triangle)
  writeTileStr(T(9), [
    "00000000","00077000","00777700","07777770",
    "77777777","57777775","55777755","55577555"]);
  // 10: Floating platform
  writeTileStr(T(10), [
    "00000000","77777777","75555557","57777775",
    "00000000","00000000","00000000","00000000"]);
  // 11: Void crystal (cycling color 8)
  writeTileStr(T(11), [
    "00080000","00888000","08888800","88888888",
    "08888800","00888000","00080000","00000000"]);
  // 12: Ethereal wisp
  writeTileStr(T(12), [
    "00000000","00080000","00808000","08000800",
    "00808000","00080000","00000000","00000000"]);
  // 13: Temple step
  writeTileStr(T(13), [
    "00000000","00000000","00000000","55555555",
    "57575757","55555555","75757575","55555555"]);
  // 14: Floating debris
  writeTileStr(T(14), [
    "00000000","00055000","00577500","05555550",
    "00577500","00055000","00000000","00000000"]);
  // 15: Arch left
  writeTileStr(T(15), [
    "00000577","00005775","00057750","00577500",
    "05775000","57750000","77500000","75000000"]);
  // 16: Arch right
  writeTileStr(T(16), [
    "77500000","57750000","05775000","00577500",
    "00057750","00005775","00000577","00000057"]);
  // 17: Stardust
  writeTileStr(T(17), [
    "00000000","00080000","00000000","80000008",
    "00000000","00000080","00800000","00000000"]);
  // 18: Broken column
  writeTileStr(T(18), [
    "00577000","05770500","57700050","77050005",
    "05777750","05777750","05777750","05777750"]);
}

// ============================================================
//  SECTION 3: PALETTES
// ============================================================

function setGroundPalette(palIdx, ...colors) {
  for (let i = 0; i < colors.length && i < 16; i++) {
    writeCGRAM(palIdx, i, colors[i][0], colors[i][1], colors[i][2]);
  }
}

function generateLandscapePalette(biome) {
  switch (biome) {
    case "forest":
      generateThemedPalette("void");
      // Pal 4: earth + grass
      setGroundPalette(4, [0,0,0],[50,35,20],[35,75,25],[45,95,30],[60,120,40],[80,50,28],[42,30,15],[70,45,25],
                          [255,200,80],[55,40,18],[90,70,35],[65,50,22],[100,80,40],[75,55,25],[110,85,45],[85,65,30]);
      // Pal 5: trunk + wood
      setGroundPalette(5, [0,0,0],[50,35,15],[65,45,20],[80,55,28],[45,30,12],[60,40,18],[95,65,32],[40,25,10],
                          [255,200,80],[110,75,38],[55,38,16],[100,68,34],[75,50,24],[120,80,42],[85,58,30],[90,62,32]);
      // Pal 6: canopy + foliage
      setGroundPalette(6, [0,0,0],[25,60,15],[35,80,22],[45,105,30],[55,125,40],[30,70,18],[40,90,25],[50,115,35],
                          [255,200,80],[65,135,45],[70,145,50],[60,110,38],[75,150,52],[80,155,55],[85,160,58],[90,165,60]);
      // Pal 7: accent (flowers, mushrooms, fireflies)
      setGroundPalette(7, [0,0,0],[120,30,30],[80,40,110],[140,100,40],[200,50,50],[100,30,90],[60,90,150],[180,120,50],
                          [255,220,60],[220,180,40],[180,140,30],[200,100,20],[160,60,80],[120,80,130],[100,160,60],[255,255,100]);
      break;

    case "ice":
      generateThemedPalette("ice");
      setGroundPalette(4, [0,0,0],[200,220,240],[180,200,230],[160,190,220],[220,235,250],[240,245,255],[90,130,170],[170,195,225],
                          [60,255,180],[130,170,200],[210,230,245],[230,240,250],[250,252,255],[140,175,205],[160,185,215],[180,200,230]);
      setGroundPalette(5, [0,0,0],[80,100,140],[100,120,160],[120,140,180],[140,160,200],[160,180,220],[70,90,130],[90,110,150],
                          [60,255,180],[110,130,170],[130,150,190],[150,170,210],[170,190,230],[60,80,120],[80,100,140],[100,120,160]);
      setGroundPalette(6, [0,0,0],[160,210,240],[140,200,235],[180,225,248],[200,240,255],[120,190,230],[220,245,255],[170,218,242],
                          [60,255,180],[100,180,225],[230,248,255],[190,232,250],[210,242,252],[80,170,220],[150,205,238],[130,195,232]);
      setGroundPalette(7, [0,0,0],[180,230,250],[200,240,255],[160,220,245],[140,210,240],[120,200,235],[100,190,230],[220,245,255],
                          [60,255,180],[80,180,225],[60,170,220],[190,235,250],[210,242,252],[170,225,248],[150,215,242],[130,205,238]);
      break;

    case "alien":
      generateThemedPalette("neon");
      setGroundPalette(4, [0,0,0],[40,20,50],[60,30,70],[50,40,60],[70,20,80],[80,35,90],[45,25,55],[65,15,75],
                          [0,255,100],[55,30,65],[100,50,110],[75,25,85],[110,45,120],[85,35,95],[120,55,130],[95,40,105]);
      setGroundPalette(5, [0,0,0],[20,80,40],[30,100,50],[40,120,60],[50,140,70],[25,90,45],[35,110,55],[45,130,65],
                          [0,255,100],[70,160,90],[55,135,72],[80,170,95],[15,70,35],[90,180,100],[65,145,78],[75,155,85]);
      setGroundPalette(6, [0,0,0],[180,40,180],[200,50,200],[220,60,220],[160,30,160],[240,80,240],[140,25,140],[200,70,200],
                          [0,255,100],[170,35,170],[230,75,230],[150,28,150],[210,65,210],[190,55,190],[245,90,245],[220,80,220]);
      setGroundPalette(7, [0,0,0],[0,200,80],[0,180,60],[0,220,100],[0,160,50],[0,240,120],[0,140,40],[0,255,140],
                          [0,255,100],[50,255,150],[30,240,110],[20,220,100],[40,200,90],[60,180,80],[80,160,70],[100,140,60]);
      break;

    case "volcanic":
      generateThemedPalette("fire");
      setGroundPalette(4, [0,0,0],[60,40,30],[80,55,35],[50,35,25],[70,45,30],[90,60,40],[100,70,45],[45,30,20],
                          [220,100,20],[65,42,28],[120,80,55],[55,38,22],[130,85,58],[75,50,32],[85,58,38],[95,65,42]);
      setGroundPalette(5, [0,0,0],[80,60,50],[100,75,60],[120,85,70],[60,45,35],[90,68,55],[110,80,65],[70,52,42],
                          [220,100,20],[130,90,75],[50,38,28],[140,95,78],[105,72,58],[85,62,48],[115,82,68],[95,70,55]);
      setGroundPalette(6, [0,0,0],[60,40,30],[80,50,35],[100,60,40],[120,70,50],[140,80,55],[90,55,38],[110,65,45],
                          [220,100,20],[150,85,60],[70,45,32],[160,90,62],[50,35,25],[170,95,65],[95,58,40],[180,100,68]);
      // Pal 7: lava colors (8,9,A = cycling)
      setGroundPalette(7, [0,0,0],[60,40,30],[80,50,35],[100,60,40],[120,70,45],[140,80,50],[90,55,35],[110,65,42],
                          [255,80,10],[255,140,20],[255,200,40],[220,60,5],[200,50,5],[240,100,15],[255,160,30],[255,220,50]);
      break;

    case "ocean":
      generateThemedPalette("synthwave");
      setGroundPalette(4, [0,0,0],[10,30,60],[15,45,85],[20,55,105],[25,65,125],[30,75,145],[12,38,72],[18,50,95],
                          [255,120,60],[28,68,135],[35,78,155],[8,28,58],[40,85,165],[32,72,142],[16,42,78],[45,90,170]);
      setGroundPalette(5, [0,0,0],[40,35,25],[55,48,32],[70,60,40],[50,42,28],[60,52,35],[80,68,45],[45,38,26],
                          [255,120,60],[90,75,50],[35,30,20],[100,82,55],[65,55,38],[110,90,60],[75,62,42],[85,70,48]);
      setGroundPalette(6, [0,0,0],[0,140,160],[0,160,180],[0,180,200],[0,120,140],[0,200,220],[0,100,120],[0,220,240],
                          [255,120,60],[20,150,170],[30,170,190],[0,80,100],[40,190,210],[10,130,150],[50,210,230],[60,220,240]);
      setGroundPalette(7, [0,0,0],[80,40,120],[100,50,150],[120,60,180],[60,30,100],[140,70,200],[50,25,90],[160,80,220],
                          [255,120,60],[110,55,165],[130,65,190],[70,35,110],[150,75,210],[90,45,135],[170,85,230],[180,90,240]);
      break;

    case "void":
      generateThemedPalette("midnight");
      setGroundPalette(4, [0,0,0],[40,30,60],[55,42,82],[70,55,105],[85,65,125],[50,38,72],[65,48,95],[80,58,115],
                          [200,150,255],[45,35,68],[100,72,142],[60,45,88],[110,78,155],[75,55,108],[90,65,128],[105,75,148]);
      setGroundPalette(5, [0,0,0],[60,50,80],[80,65,105],[100,80,130],[70,58,90],[90,72,115],[110,88,140],[120,95,155],
                          [200,150,255],[75,62,95],[130,102,165],[85,70,110],[140,110,175],[95,78,120],[105,85,135],[115,92,148]);
      setGroundPalette(6, [0,0,0],[120,80,180],[140,100,200],[100,60,160],[160,120,220],[80,50,140],[180,140,240],[110,70,170],
                          [200,150,255],[150,110,210],[170,130,230],[90,55,150],[190,148,245],[200,155,250],[60,40,120],[210,160,252]);
      setGroundPalette(7, [0,0,0],[200,180,255],[180,160,240],[220,200,255],[160,140,220],[240,220,255],[140,120,200],[250,235,255],
                          [200,150,255],[210,190,248],[190,170,242],[230,210,252],[150,130,210],[255,245,255],[120,100,190],[245,230,255]);
      break;
  }
  rebuildCGRAMCache();
}

// ============================================================
//  SECTION 4: RASTER SKY GRADIENTS
// ============================================================

function generateLandscapeRaster(biome) {
  const h = SCREEN_H;
  for (let y = 0; y < h; y++) {
    const t = y / h;
    let r, g, b;
    switch (biome) {
      case "forest":
        r = 25 + t * 160; g = 8 + t * 60; b = 80 - t * 50;
        break;
      case "ice":
        r = 200 - t * 140; g = 215 - t * 95; b = 250 - t * 30;
        break;
      case "alien":
        r = 15 + t * 120; g = 40 + t * 80; b = 70 - t * 40;
        break;
      case "volcanic":
        r = 30 + t * 200; g = 5 + t * 60; b = 5;
        break;
      case "ocean":
        r = 10 + t * 180; g = 15 + t * 50; b = 50 + t * 80;
        break;
      case "void":
        r = 5 + t * 50; g = 0 + t * 10; b = 20 + t * 80;
        break;
      default: r = g = b = t * 60;
    }
    rasterColors[y] = rgbToSnesColor(
      Math.min(255, Math.max(0, Math.round(r))),
      Math.min(255, Math.max(0, Math.round(g))),
      Math.min(255, Math.max(0, Math.round(b))));
  }
}

// ============================================================
//  SECTION 5: SETPIECE COMPOSITIONS
// ============================================================

// Ground tilemap backup for corruption resistance
let landscapeGroundBackup = null;

function backupGroundTilemap() {
  const base = bgTilemapAddr[0];
  landscapeGroundBackup = new Uint8Array(32 * 32 * 2);
  for (let i = 0; i < landscapeGroundBackup.length; i++)
    landscapeGroundBackup[i] = VRAM[base + i];
}

function restoreLandscapeGround(strength) {
  if (!landscapeGroundBackup) return;
  const base = bgTilemapAddr[0];
  for (let i = 0; i < landscapeGroundBackup.length; i++) {
    if (glitchRand() < strength) VRAM[base + i] = landscapeGroundBackup[i];
  }
}

// --- CORRUPTED FOREST ---
// Dense treeline portrait. Tall pines, thick oaks, a small pond clearing,
// mushrooms, fallen log, fireflies in the canopy.
function composeForest(tm) {
  const R = Math.ceil(SCREEN_H / 8);
  clearTilemap(tm);

  // Ground fill (bottom 8 rows)
  fillRect(tm, 0, R - 8, 32, 1, 3, 4);  // grass surface
  fillRect(tm, 0, R - 7, 32, 7, 1, 4);  // earth
  fillRect(tm, 0, R - 3, 32, 3, 2, 5);  // deep earth

  // --- Tall pine left (cols 1-3) ---
  writeTilemapEntry(tm, 2, R-16, 19, 6, false, false); // pine top
  fillRect(tm, 1, R-15, 3, 2, 20, 6);                  // pine body
  writeTilemapEntry(tm, 1, R-13, 20, 6, false, false);
  writeTilemapEntry(tm, 2, R-13, 21, 6, false, false); // pine base+trunk
  writeTilemapEntry(tm, 3, R-13, 20, 6, false, false);
  fillCol(tm, 2, R-12, R-9, 6, 5);                     // trunk
  writeTilemapEntry(tm, 2, R-9, 12, 5, false, false);  // roots

  // --- Large oak center-left (cols 6-10) ---
  writeTilemapEntry(tm, 8, R-14, 9, 6, false, false);  // canopy top
  fillRect(tm, 7, R-13, 3, 1, 8, 6);                    // canopy mid
  writeTilemapEntry(tm, 6, R-13, 10, 6, false, false);  // canopy left
  writeTilemapEntry(tm, 10, R-13, 11, 6, false, false); // canopy right
  fillRect(tm, 6, R-12, 5, 2, 8, 6);                    // dense canopy
  writeTilemapEntry(tm, 8, R-10, 7, 5, false, false);   // thick trunk
  writeTilemapEntry(tm, 8, R-9, 12, 5, false, false);   // roots

  // --- Pond clearing (cols 12-16) ---
  fillRect(tm, 12, R-9, 5, 1, 16, 7);   // water surface
  fillRect(tm, 12, R-8, 5, 1, 17, 4);   // water deep
  writeTilemapEntry(tm, 11, R-9, 18, 6, false, false); // grass tuft left
  writeTilemapEntry(tm, 17, R-9, 18, 6, false, false); // grass tuft right

  // --- Medium tree right-center (cols 18-21) ---
  writeTilemapEntry(tm, 19, R-12, 9, 6, false, false);
  fillRect(tm, 18, R-11, 3, 2, 8, 6);
  writeTilemapEntry(tm, 19, R-9, 7, 5, false, false);

  // --- Tall pine right (cols 24-26) ---
  writeTilemapEntry(tm, 25, R-15, 19, 6, false, false);
  fillRect(tm, 24, R-14, 3, 2, 20, 6);
  writeTilemapEntry(tm, 25, R-12, 21, 6, false, false);
  fillCol(tm, 25, R-11, R-9, 6, 5);
  writeTilemapEntry(tm, 25, R-9, 12, 5, false, false);

  // --- Bushes and undergrowth ---
  writeTilemapEntry(tm, 5, R-9, 13, 6, false, false);
  writeTilemapEntry(tm, 22, R-9, 14, 6, false, false);
  writeTilemapEntry(tm, 28, R-9, 13, 6, false, false);

  // --- Fallen log ---
  writeTilemapEntry(tm, 29, R-9, 23, 5, false, false);
  writeTilemapEntry(tm, 30, R-9, 23, 5, false, false);

  // --- Mushroom ---
  writeTilemapEntry(tm, 11, R-9, 15, 7, false, false);

  // --- Firefly sparkle tiles scattered in canopy zone ---
  writeTilemapEntry(tm, 4, R-14, 22, 7, false, false);
  writeTilemapEntry(tm, 14, R-12, 22, 7, false, false);
  writeTilemapEntry(tm, 23, R-13, 22, 7, false, false);
  writeTilemapEntry(tm, 16, R-15, 22, 7, false, false);
  writeTilemapEntry(tm, 27, R-11, 22, 7, false, false);

  // --- Ground detail ---
  writeTilemapEntry(tm, 0, R-9, 25, 4, false, false);
  writeTilemapEntry(tm, 31, R-9, 25, 4, false, false);
}

// --- ICE WASTES ---
// Mountain range with central peak, frozen lake foreground, ice crystals.
function composeIce(tm) {
  const R = Math.ceil(SCREEN_H / 8);
  clearTilemap(tm);

  // Deep snow ground (bottom 6 rows)
  fillRect(tm, 0, R-6, 32, 1, 10, 4);  // snow surface
  fillRect(tm, 0, R-5, 32, 5, 1, 5);   // packed snow

  // Frozen lake (cols 8-24, rows R-8 to R-7)
  fillRect(tm, 8, R-8, 17, 2, 12, 6);  // frozen lake
  writeTilemapEntry(tm, 10, R-7, 13, 6, false, false); // cracked ice
  writeTilemapEntry(tm, 18, R-7, 13, 6, false, false);

  // Snow bank around lake
  fillRect(tm, 0, R-8, 8, 1, 10, 4);
  fillRect(tm, 25, R-8, 7, 1, 10, 4);
  fillRect(tm, 0, R-7, 8, 1, 1, 5);
  fillRect(tm, 25, R-7, 7, 1, 1, 5);
  writeTilemapEntry(tm, 7, R-8, 17, 4, false, false);  // drift left
  writeTilemapEntry(tm, 25, R-8, 18, 4, false, false); // drift right

  // --- Central mountain (cols 10-22, peak at row R-18) ---
  writeTilemapEntry(tm, 16, R-18, 19, 4, false, false); // snow-capped peak
  writeTilemapEntry(tm, 15, R-17, 8, 5, false, false);  // left slope
  writeTilemapEntry(tm, 17, R-17, 9, 5, false, false);  // right slope
  fillRect(tm, 15, R-16, 3, 1, 6, 5);                    // mountain body
  // Expanding slopes downward
  for (let dy = 0; dy < 6; dy++) {
    const row = R - 15 + dy;
    const left = 14 - dy;
    const right = 18 + dy;
    if (left >= 0) writeTilemapEntry(tm, left, row, 8, 5, false, false);
    if (right < 32) writeTilemapEntry(tm, right, row, 9, 5, false, false);
    fillRow(tm, row, Math.max(0, left + 1), Math.min(31, right - 1), 6, 5);
  }

  // --- Smaller peak left (cols 2-8, peak at R-13) ---
  writeTilemapEntry(tm, 5, R-13, 7, 4, false, false);
  writeTilemapEntry(tm, 4, R-12, 8, 5, false, false);
  writeTilemapEntry(tm, 6, R-12, 9, 5, false, false);
  fillRow(tm, R-11, 3, 7, 6, 5);
  fillRow(tm, R-10, 2, 8, 6, 5);
  writeTilemapEntry(tm, 1, R-10, 8, 5, false, false);
  fillRow(tm, R-9, 1, 8, 6, 5);

  // --- Smaller peak right (cols 25-30, peak at R-12) ---
  writeTilemapEntry(tm, 28, R-12, 7, 4, false, false);
  writeTilemapEntry(tm, 27, R-11, 8, 5, false, false);
  writeTilemapEntry(tm, 29, R-11, 9, 5, false, false);
  fillRow(tm, R-10, 27, 30, 6, 5);
  fillRow(tm, R-9, 26, 31, 6, 5);

  // --- Ice crystals ---
  writeTilemapEntry(tm, 6, R-9, 11, 6, false, false);
  writeTilemapEntry(tm, 26, R-9, 11, 6, false, false);
  writeTilemapEntry(tm, 3, R-9, 14, 4, false, false);  // snow pile
  writeTilemapEntry(tm, 30, R-9, 14, 4, false, false);

  // --- Aurora tiles (sky details with cycling color) ---
  writeTilemapEntry(tm, 5, 2, 16, 7, false, false);
  writeTilemapEntry(tm, 12, 1, 16, 7, false, false);
  writeTilemapEntry(tm, 20, 3, 16, 7, false, false);
  writeTilemapEntry(tm, 27, 2, 16, 7, false, false);
}

// --- ALIEN SURFACE ---
// Strange spires, bioluminescent pods, organic tendrils, twin moons.
function composeAlien(tm) {
  const R = Math.ceil(SCREEN_H / 8);
  clearTilemap(tm);

  // Alien ground (bottom 7 rows)
  fillRect(tm, 0, R-7, 32, 1, 3, 4);   // alien surface
  fillRect(tm, 0, R-6, 32, 6, 1, 4);   // alien subsoil

  // Organic growth border at surface
  fillRow(tm, R-8, 0, 31, 12, 5);

  // --- Tall spire left (col 3) ---
  writeTilemapEntry(tm, 3, R-16, 7, 6, false, false);   // bulb top
  fillCol(tm, 3, R-15, R-8, 6, 5);                       // spire shaft

  // --- Curved tendril (cols 7-9) ---
  writeTilemapEntry(tm, 7, R-13, 11, 5, false, false);  // curve right
  writeTilemapEntry(tm, 8, R-14, 10, 5, false, false);  // curve left
  writeTilemapEntry(tm, 8, R-13, 6, 5, false, false);
  writeTilemapEntry(tm, 8, R-12, 6, 5, false, false);
  writeTilemapEntry(tm, 8, R-11, 7, 6, false, false);   // top bulb
  fillCol(tm, 7, R-12, R-8, 15, 5);                      // wavy trunk

  // --- Pod cluster center (cols 13-17) ---
  writeTilemapEntry(tm, 14, R-10, 8, 6, false, false);  // large pod
  writeTilemapEntry(tm, 16, R-11, 8, 6, false, false);  // another pod
  writeTilemapEntry(tm, 13, R-9, 9, 7, false, false);   // glowing plant
  writeTilemapEntry(tm, 15, R-9, 9, 7, false, false);
  writeTilemapEntry(tm, 17, R-9, 9, 7, false, false);
  writeTilemapEntry(tm, 15, R-12, 14, 6, false, false); // egg cluster

  // --- Crystal formation right (col 21) ---
  writeTilemapEntry(tm, 21, R-11, 13, 6, false, false); // crystal
  writeTilemapEntry(tm, 22, R-10, 13, 6, false, false);
  writeTilemapEntry(tm, 20, R-9, 9, 7, false, false);   // glow

  // --- Tall spire far right (col 27) ---
  writeTilemapEntry(tm, 27, R-14, 7, 6, false, false);
  fillCol(tm, 27, R-13, R-8, 6, 5);

  // --- Tentacle base masses ---
  writeTilemapEntry(tm, 10, R-8, 16, 5, false, false);
  writeTilemapEntry(tm, 24, R-8, 16, 5, false, false);

  // --- Twin moons (placed as ground layer tiles high up) ---
  writeTilemapEntry(tm, 8, 3, 18, 7, false, false);

  // --- Floating spores ---
  writeTilemapEntry(tm, 5, R-12, 17, 7, false, false);
  writeTilemapEntry(tm, 11, R-14, 17, 7, false, false);
  writeTilemapEntry(tm, 19, R-13, 17, 7, false, false);
  writeTilemapEntry(tm, 25, R-15, 17, 7, false, false);
  writeTilemapEntry(tm, 30, R-11, 17, 7, false, false);
}

// --- VOLCANIC RUINS ---
// Volcano right side, ruined pillars left, lava channel flowing across,
// smoke wisps, crumbling stonework.
function composeVolcanic(tm) {
  const R = Math.ceil(SCREEN_H / 8);
  clearTilemap(tm);

  // Ash ground (bottom 6 rows)
  fillRect(tm, 0, R-6, 32, 1, 3, 4);
  fillRect(tm, 0, R-5, 32, 5, 1, 4);
  fillRect(tm, 0, R-2, 32, 2, 2, 5);

  // --- Volcano (right half, cols 18-31) ---
  writeTilemapEntry(tm, 24, R-17, 7, 7, false, false);   // crater/peak
  // Slopes expanding down
  for (let dy = 0; dy < 9; dy++) {
    const row = R - 16 + dy;
    const left = 23 - dy;
    const right = 25 + dy;
    if (left >= 0) writeTilemapEntry(tm, left, row, 16, 5, false, false);
    if (right < 32) writeTilemapEntry(tm, right, row, 17, 5, false, false);
    fillRow(tm, row, Math.max(0, left + 1), Math.min(31, right - 1), 6, 5);
  }

  // Lava channel flowing down volcano left face
  writeTilemapEntry(tm, 22, R-14, 8, 7, false, false);
  writeTilemapEntry(tm, 21, R-13, 8, 7, false, false);
  writeTilemapEntry(tm, 20, R-12, 8, 7, false, false);
  writeTilemapEntry(tm, 19, R-11, 14, 7, false, false); // lava slope
  writeTilemapEntry(tm, 18, R-10, 14, 7, false, false);

  // Lava pool across bottom (cols 6-20, at R-7)
  fillRow(tm, R-7, 6, 20, 8, 7);
  writeTilemapEntry(tm, 5, R-7, 14, 7, false, false);   // lava slope left
  writeTilemapEntry(tm, 21, R-7, 15, 7, false, false);  // lava slope right
  // Lava glow below
  fillRow(tm, R-6, 6, 20, 9, 7);

  // --- Ruined pillars left ---
  // Tall pillar at col 4
  writeTilemapEntry(tm, 4, R-14, 11, 5, false, false);  // capital
  fillCol(tm, 4, R-13, R-8, 10, 5);                      // shaft
  writeTilemapEntry(tm, 4, R-7, 12, 5, false, false);   // base rubble

  // Short broken pillar at col 8
  writeTilemapEntry(tm, 8, R-11, 19, 5, false, false);  // crumbling top
  fillCol(tm, 8, R-10, R-8, 10, 5);

  // Ruined arch (cols 10-12)
  writeTilemapEntry(tm, 10, R-12, 18, 5, false, false); // arch span
  fillCol(tm, 10, R-11, R-8, 10, 5);
  fillCol(tm, 12, R-11, R-8, 10, 5);

  // --- Smoke wisps ---
  writeTilemapEntry(tm, 23, R-19, 13, 4, false, false);
  writeTilemapEntry(tm, 25, R-20, 13, 4, false, false);
  writeTilemapEntry(tm, 24, R-21, 13, 4, false, false);
  writeTilemapEntry(tm, 6, R-15, 13, 4, false, false);

  // --- Scattered rubble ---
  writeTilemapEntry(tm, 2, R-7, 19, 4, false, false);
  writeTilemapEntry(tm, 15, R-7, 19, 4, false, false);
}

// --- DIGITAL OCEAN ---
// Calm water covering lower half, small island with data towers,
// sunset reflections, distant structure silhouettes.
function composeOcean(tm) {
  const R = Math.ceil(SCREEN_H / 8);
  clearTilemap(tm);

  const waterLine = R - 14;

  // Horizon glow
  fillRow(tm, waterLine - 1, 0, 31, 19, 7);

  // Water surface
  fillRow(tm, waterLine, 0, 31, 6, 6);

  // Water body
  fillRect(tm, 0, waterLine + 1, 32, 8, 7, 4);

  // Deep water
  fillRect(tm, 0, waterLine + 9, 32, 5, 8, 4);

  // Seabed
  fillRow(tm, R - 1, 0, 31, 17, 5);

  // --- Island (cols 16-22) ---
  writeTilemapEntry(tm, 16, waterLine - 1, 12, 5, false, false); // shore left
  fillRow(tm, waterLine - 1, 17, 21, 11, 5);                      // sand
  writeTilemapEntry(tm, 22, waterLine - 1, 13, 5, false, false); // shore right
  fillRow(tm, waterLine, 17, 21, 11, 5);                           // sand below waterline

  // Data tower on island
  writeTilemapEntry(tm, 19, waterLine - 4, 10, 7, false, false); // tower top
  writeTilemapEntry(tm, 19, waterLine - 3, 9, 7, false, false);  // tower mid
  writeTilemapEntry(tm, 19, waterLine - 2, 9, 7, false, false);  // tower base

  // Smaller tower
  writeTilemapEntry(tm, 17, waterLine - 2, 10, 7, false, false);

  // --- Distant structures on horizon ---
  writeTilemapEntry(tm, 3, waterLine - 2, 15, 5, false, false);
  writeTilemapEntry(tm, 4, waterLine - 1, 15, 5, false, false);
  writeTilemapEntry(tm, 28, waterLine - 3, 15, 5, false, false);
  writeTilemapEntry(tm, 29, waterLine - 2, 15, 5, false, false);
  writeTilemapEntry(tm, 29, waterLine - 1, 15, 5, false, false);

  // --- Sunset shimmer reflections in water ---
  writeTilemapEntry(tm, 10, waterLine + 2, 16, 7, false, false);
  writeTilemapEntry(tm, 15, waterLine + 3, 16, 7, false, false);
  writeTilemapEntry(tm, 22, waterLine + 2, 16, 7, false, false);
  writeTilemapEntry(tm, 8, waterLine + 4, 16, 7, false, false);
  writeTilemapEntry(tm, 19, waterLine + 5, 16, 7, false, false);
  writeTilemapEntry(tm, 26, waterLine + 4, 16, 7, false, false);

  // --- Coral/reef near seabed ---
  writeTilemapEntry(tm, 7, R - 3, 14, 6, false, false);
  writeTilemapEntry(tm, 14, R - 2, 14, 6, false, false);
  writeTilemapEntry(tm, 24, R - 3, 14, 6, false, false);

  // --- Pier/dock posts ---
  writeTilemapEntry(tm, 12, waterLine, 18, 5, false, false);
  writeTilemapEntry(tm, 12, waterLine + 1, 18, 5, false, false);
  writeTilemapEntry(tm, 13, waterLine, 18, 5, false, false);
  writeTilemapEntry(tm, 13, waterLine + 1, 18, 5, false, false);
}

// --- VOID TEMPLE ---
// Temple facade centered, floating platforms, ethereal wisps,
// columns framing a dark entrance.
function composeVoid(tm) {
  const R = Math.ceil(SCREEN_H / 8);
  clearTilemap(tm);

  // Ground platform (bottom 4 rows, partial)
  fillRect(tm, 4, R-4, 24, 1, 13, 4);   // steps
  fillRect(tm, 4, R-3, 24, 3, 1, 4);    // platform

  // Temple facade (cols 10-22)
  // Pediment (triangle top)
  writeTilemapEntry(tm, 16, R-14, 9, 5, false, false);  // pediment peak
  fillRow(tm, R-13, 13, 19, 1, 5);                       // pediment base
  writeTilemapEntry(tm, 12, R-13, 5, 5, false, false);  // left slope
  writeTilemapEntry(tm, 20, R-13, 4, 5, false, false);  // right slope

  // Entablature (beam across columns)
  fillRow(tm, R-12, 10, 22, 1, 5);

  // Columns
  for (const cx of [11, 14, 18, 21]) {
    writeTilemapEntry(tm, cx, R-11, 7, 5, false, false);  // capital
    fillCol(tm, cx, R-10, R-5, 6, 5);                      // shaft
    writeTilemapEntry(tm, cx, R-4, 8, 5, false, false);   // base
  }

  // Dark entrance (between inner columns)
  fillRect(tm, 15, R-11, 3, 7, 0, 0);  // void/darkness (transparent = sky shows)

  // Steps
  writeTilemapEntry(tm, 14, R-5, 13, 4, false, false);
  writeTilemapEntry(tm, 15, R-5, 13, 4, false, false);
  writeTilemapEntry(tm, 16, R-5, 13, 4, false, false);
  writeTilemapEntry(tm, 17, R-5, 13, 4, false, false);

  // --- Floating platforms ---
  fillRow(tm, R-18, 2, 5, 10, 6);
  fillRow(tm, R-16, 26, 30, 10, 6);
  fillRow(tm, R-20, 22, 24, 10, 6);

  // --- Broken column left ---
  writeTilemapEntry(tm, 6, R-8, 18, 5, false, false);   // broken top
  fillCol(tm, 6, R-7, R-5, 6, 5);
  writeTilemapEntry(tm, 6, R-4, 8, 5, false, false);

  // --- Floating debris ---
  writeTilemapEntry(tm, 3, R-19, 14, 6, false, false);
  writeTilemapEntry(tm, 28, R-17, 14, 6, false, false);
  writeTilemapEntry(tm, 9, R-20, 14, 6, false, false);

  // --- Void crystals (cycling glow) ---
  writeTilemapEntry(tm, 4, R-19, 11, 7, false, false);
  writeTilemapEntry(tm, 27, R-18, 11, 7, false, false);
  writeTilemapEntry(tm, 16, R-16, 11, 7, false, false);

  // --- Ethereal wisps ---
  writeTilemapEntry(tm, 1, R-15, 12, 7, false, false);
  writeTilemapEntry(tm, 8, R-17, 12, 7, false, false);
  writeTilemapEntry(tm, 24, R-15, 12, 7, false, false);
  writeTilemapEntry(tm, 30, R-13, 12, 7, false, false);
  writeTilemapEntry(tm, 13, R-19, 17, 7, false, false);
  writeTilemapEntry(tm, 20, R-21, 17, 7, false, false);
}

// ============================================================
//  SECTION 6: SCENE DEFINITIONS
// ============================================================

const landscapeSceneIndices = [];

function createLandscapeScene(biome, displayName, composeFn) {
  return {
    name: displayName,
    landscape: true,
    biome: biome,

    setup() {
      ppuMode = 1;
      bgEnabled[0] = true;
      bgEnabled[1] = true;
      bgEnabled[2] = false;
      bgEnabled[3] = false;

      generateTileData();
      generateBG2Tiles();

      // Generate biome tiles at 0x2000
      switch (biome) {
        case "forest":   generateForestTiles(); break;
        case "ice":       generateIceTiles(); break;
        case "alien":     generateAlienTiles(); break;
        case "volcanic":  generateVolcanicTiles(); break;
        case "ocean":     generateOceanTiles(); break;
        case "void":      generateVoidTiles(); break;
      }

      // BG0 (ground foreground): landscape tiles
      bgCharAddr[0] = LAND_TILE_BASE;
      bgTilemapAddr[0] = 0x8000;

      // BG1 (sky background): normal glitchable tiles
      bgCharAddr[1] = 0x0000;
      bgTilemapAddr[1] = 0x8800;

      // Sky tilemap (textured chaos)
      for (let ty = 0; ty < 32; ty++) {
        for (let tx = 0; tx < 32; tx++) {
          const tileIdx = ((tx * 7 + ty * 13) ^ (tx * ty * 3)) & 0xFF;
          writeTilemapEntry(0x8800, tx, ty, tileIdx, ty & 3, false, false);
        }
      }

      // Compose the setpiece
      composeFn(0x8000);
      backupGroundTilemap();

      // Palette + raster
      generateLandscapePalette(biome);
      rasterEnabled = true;
      generateLandscapeRaster(biome);

      // Static — no scroll
      bgScrollX.fill(0);
      bgScrollY.fill(0);

      // Per-biome PPU effects
      ghostEnabled = (biome === "forest" || biome === "void" || biome === "ocean");
      ghostAlpha = biome === "void" ? 0.45 : biome === "ocean" ? 0.2 : 0.15;

      windowEnabled = false;
      spritesEnabled = false;
      colorMathMode = (biome === "volcanic") ? 1 : 0;
      fixedColor = biome === "volcanic" ? { r: 6, g: 1, b: 0 } : { r: 0, g: 0, b: 0 };

      // Color cycling — this is the main animation driver
      colorCycleRanges = [];
      switch (biome) {
        case "forest":
          // Firefly twinkle: palette 7, color 8 (cycling brightness)
          colorCycleRanges.push({ palIdx: 7, startCol: 8, endCol: 10, speed: 0.06, counter: 0, direction: 1 });
          break;
        case "ice":
          // Aurora shimmer: palette 7, colors 8-10
          colorCycleRanges.push({ palIdx: 7, startCol: 8, endCol: 12, speed: 0.03, counter: 0, direction: 1 });
          colorCycleRanges.push({ palIdx: 6, startCol: 8, endCol: 10, speed: 0.02, counter: 0, direction: -1 });
          break;
        case "alien":
          // Bioluminescent pulse: palette 7, colors 8-10
          colorCycleRanges.push({ palIdx: 7, startCol: 8, endCol: 12, speed: 0.05, counter: 0, direction: 1 });
          colorCycleRanges.push({ palIdx: 6, startCol: 8, endCol: 10, speed: 0.04, counter: 0, direction: -1 });
          break;
        case "volcanic":
          // Lava flow: palette 7, colors 8-11
          colorCycleRanges.push({ palIdx: 7, startCol: 8, endCol: 15, speed: 0.08, counter: 0, direction: 1 });
          break;
        case "ocean":
          // Water shimmer + sunset reflection
          colorCycleRanges.push({ palIdx: 6, startCol: 6, endCol: 10, speed: 0.03, counter: 0, direction: 1 });
          colorCycleRanges.push({ palIdx: 7, startCol: 8, endCol: 11, speed: 0.04, counter: 0, direction: -1 });
          break;
        case "void":
          // Ethereal pulse: palette 7, colors 8-10
          colorCycleRanges.push({ palIdx: 7, startCol: 8, endCol: 12, speed: 0.025, counter: 0, direction: 1 });
          colorCycleRanges.push({ palIdx: 4, startCol: 8, endCol: 10, speed: 0.015, counter: 0, direction: -1 });
          break;
      }

      hdmaEffects = [];
      mosaicSize = 1;
    },

    update(localFrame) {
      // NO SCROLLING — this is a still portrait

      // --- Sky corruption (evolving background) ---
      glitchIntensity = 0.25 + Math.sin(localFrame * 0.0015) * 0.15;

      // Targeted sky corruption — only the sky tiles/tilemap
      if (localFrame % 4 === 0) {
        // Bit rot in sky tile region only (0x0000-0x1FFF)
        const addr = glitchRandInt(0x2000);
        VRAM[addr] ^= (1 << glitchRandInt(8));
      }
      if (localFrame % 6 === 0) {
        // Sky tilemap scramble
        const addr = bgTilemapAddr[1] + glitchRandInt(32 * 20) * 2;
        VRAM[addr] = glitchRandInt(256);
      }
      if (localFrame % 15 === 0) {
        // Palette shimmer (sky palettes 0-3 only)
        const pal = glitchRandInt(4);
        const col = 1 + glitchRandInt(15);
        const addr = (pal * 16 + col) * 2;
        CGRAM[addr] ^= glitchRandInt(16);
        rebuildCGRAMCache();
      }
      // Occasional DMA misfire for dramatic tile morphing
      if (localFrame % 45 === 0) {
        glitchDMAMisfire();
      }

      // --- Ground restoration (keep the portrait stable) ---
      if (localFrame % 4 === 0) {
        restoreLandscapeGround(0.4);
      }

      // --- Biome-specific subtle animation ---
      switch (biome) {
        case "volcanic":
          // Heat shimmer HDMA near volcano
          if (localFrame % 30 === 0 && hdmaEffects.length < 4) {
            hdmaEffects.push({
              startScanline: 20,
              register: "scrollX",
              bg: 1,
              values: Array.from({ length: 40 }, (_, i) =>
                Math.floor(Math.sin((localFrame + i) * 0.08) * 2))
            });
          }
          break;

        case "ocean":
          // Gentle wave HDMA on water surface
          if (localFrame % 25 === 0 && hdmaEffects.length < 4) {
            const waterStart = Math.floor(SCREEN_H * 0.5);
            hdmaEffects.push({
              startScanline: waterStart,
              register: "scrollX",
              bg: 0,
              values: Array.from({ length: 20 }, (_, i) =>
                Math.floor(Math.sin((localFrame * 0.015 + i * 0.3)) * 2))
            });
          }
          break;
      }

      // HDMA cleanup
      if (hdmaEffects.length > 6) {
        hdmaEffects = hdmaEffects.slice(-2);
      }
    }
  };
}

// Register landscape scenes
const LANDSCAPE_BIOMES = [
  { id: "forest",   name: "CORRUPTED FOREST",  fn: composeForest },
  { id: "ice",       name: "ICE WASTES",        fn: composeIce },
  { id: "alien",     name: "ALIEN SURFACE",      fn: composeAlien },
  { id: "volcanic",  name: "VOLCANIC RUINS",     fn: composeVolcanic },
  { id: "ocean",     name: "DIGITAL OCEAN",      fn: composeOcean },
  { id: "void",      name: "VOID TEMPLE",        fn: composeVoid },
];

for (const b of LANDSCAPE_BIOMES) {
  const idx = scenes.length;
  scenes.push(createLandscapeScene(b.id, b.name, b.fn));
  landscapeSceneIndices.push(idx);
}

// ============================================================
//  SECTION 7: MENU INTEGRATION
// ============================================================

const _origGetMenuItems = getMenuItems;
getMenuItems = function() {
  const items = _origGetMenuItems();
  items.splice(1, 0, {
    label: "LANDSCAPE",
    type: "submenu",
    key: "landscape",
    value: () => {
      const sc = currentScene >= 0 && currentScene < scenes.length ? scenes[currentScene] : null;
      return (sc && sc.landscape) ? sc.name : "---";
    },
  });
  return items;
};

const _origGetSubmenuItems = getSubmenuItems;
getSubmenuItems = function(key) {
  if (key === "landscape") {
    return landscapeSceneIndices.map(idx => ({
      label: scenes[idx].name,
      type: "action",
      active: () => currentScene === idx,
      action: () => { transitionToScene(idx); },
    }));
  }
  return _origGetSubmenuItems(key);
};
