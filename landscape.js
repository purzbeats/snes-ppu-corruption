// ============================================================
//  SNES PPU CORRUPTION ENGINE — LANDSCAPE MODE
//  Glitch landscapes: corrupted skies over tile-built terrain.
//  Forest, ice, alien, volcanic, digital ocean, void temple.
//  Each biome uses the PPU's own rendering for authentic SNES feel.
// ============================================================

if (typeof LANDSCAPE_LOADED === "undefined") { var LANDSCAPE_LOADED = true; }

// ============================================================
//  SECTION 1: TILE WRITING HELPERS
// ============================================================

// Write a single 4bpp tile to VRAM from an 8x8 pixel array (values 0-15)
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

// Parse a tile from 8 row strings ("00112300" etc) and write to VRAM
function writeTileStr(tileAddr, rows) {
  const px = new Uint8Array(64);
  for (let r = 0; r < 8; r++) {
    for (let x = 0; x < 8; x++) {
      px[r * 8 + x] = parseInt(rows[r][x], 16);
    }
  }
  writeTilePixels(tileAddr, px);
}

// Write a SNES color to CGRAM
function writeCGRAM(palIdx, colIdx, r, g, b) {
  const snes = rgbToSnesColor(r, g, b);
  const addr = (palIdx * 16 + colIdx) * 2;
  CGRAM[addr] = snes & 0xFF;
  CGRAM[addr + 1] = (snes >> 8) & 0xFF;
}

// Write a tilemap entry
function writeTilemapEntry(base, tx, ty, tileIdx, palette, hFlip, vFlip) {
  const addr = base + (ty * 32 + tx) * 2;
  const entry = (tileIdx & 0x3FF) | ((palette & 7) << 10) |
                ((hFlip ? 1 : 0) << 14) | ((vFlip ? 1 : 0) << 15);
  VRAM[addr] = entry & 0xFF;
  VRAM[addr + 1] = (entry >> 8) & 0xFF;
}

// ============================================================
//  SECTION 2: LANDSCAPE TILE GENERATION
// ============================================================

// Ground landscape tiles live at 0x2000 (enhanced tile region).
// Tile indices 0-31 in this region, referenced as tiles 0-31
// when bgCharAddr points to 0x2000.
const LAND_TILE_BASE = 0x2000;

function landTileAddr(idx) { return LAND_TILE_BASE + idx * 32; }

// Generate common landscape tiles used across biomes
function generateCommonLandTiles() {
  // 0: Empty (transparent — sky shows through)
  writeTileStr(landTileAddr(0), [
    "00000000","00000000","00000000","00000000",
    "00000000","00000000","00000000","00000000",
  ]);
  // 1: Solid ground fill
  writeTileStr(landTileAddr(1), [
    "11111111","11111111","11511151","11111111",
    "15111111","11111111","11111511","11111111",
  ]);
  // 2: Deep ground (darker)
  writeTileStr(landTileAddr(2), [
    "55155515","15551555","55155515","15555155",
    "55515555","15551555","55155551","15555515",
  ]);
  // 3: Ground surface top — flat
  writeTileStr(landTileAddr(3), [
    "00000000","22222222","21111112","11111111",
    "11151111","11111111","11111151","11111111",
  ]);
  // 4: Ground surface — left slope rising
  writeTileStr(landTileAddr(4), [
    "00000000","00000000","00000022","00002211",
    "00221111","22111111","11111111","11111111",
  ]);
  // 5: Ground surface — right slope rising
  writeTileStr(landTileAddr(5), [
    "00000000","00000000","22000000","11220000",
    "11112200","11111122","11111111","11111111",
  ]);
}

// Forest-specific tiles (6-19)
function generateForestTiles() {
  generateCommonLandTiles();

  // 6: Tree trunk
  writeTileStr(landTileAddr(6), [
    "00066000","00066000","00066000","00066000",
    "00066000","00066000","00066000","00066000",
  ]);
  // 7: Thick trunk
  writeTileStr(landTileAddr(7), [
    "00677600","00677600","00677600","00677600",
    "00677600","00677600","00677600","00677600",
  ]);
  // 8: Canopy dense
  writeTileStr(landTileAddr(8), [
    "33433343","34333433","33343334","43333343",
    "33433333","33334333","43333433","33343334",
  ]);
  // 9: Canopy top
  writeTileStr(landTileAddr(9), [
    "00034000","00343400","03343340","33433343",
    "34333433","33343334","43333343","33433333",
  ]);
  // 10: Canopy left edge
  writeTileStr(landTileAddr(10), [
    "00000033","00000343","00003334","00034333",
    "00343334","03333433","33343334","33433343",
  ]);
  // 11: Canopy right edge
  writeTileStr(landTileAddr(11), [
    "33000000","34300000","43300000","33340000",
    "43334000","33433300","43334330","34333433",
  ]);
  // 12: Canopy bottom (with trunk gap)
  writeTileStr(landTileAddr(12), [
    "33433343","33343300","03330000","00300000",
    "00000000","00000000","00000000","00000000",
  ]);
  // 13: Bush / undergrowth
  writeTileStr(landTileAddr(13), [
    "00000000","00000000","00340030","03434340",
    "34343434","34343434","43434343","22222222",
  ]);
  // 14: Mushroom / flower
  writeTileStr(landTileAddr(14), [
    "00000000","00000000","00000000","00088000",
    "00888800","00088000","00066000","00066000",
  ]);
  // 15: Roots / trunk base spreading
  writeTileStr(landTileAddr(15), [
    "00066000","00066000","00666600","06666660",
    "66666666","11666611","11166111","11111111",
  ]);
  // 16: Sparse canopy (thinner)
  writeTileStr(landTileAddr(16), [
    "00300030","03003003","30030030","03003003",
    "00300300","03003003","30030030","00300300",
  ]);
  // 17: Dead tree / bare trunk with branch
  writeTileStr(landTileAddr(17), [
    "00066060","00066600","00066000","06066000",
    "06666000","00066000","00066000","00066000",
  ]);
  // 18: Grass tuft on ground
  writeTileStr(landTileAddr(18), [
    "00000000","04000040","34000430","34300430",
    "34340434","22222222","11111111","11111111",
  ]);
  // 19: Ground with stones
  writeTileStr(landTileAddr(19), [
    "22222222","11151111","11555111","11155111",
    "11111111","15111151","11111111","11111111",
  ]);
}

// Ice-specific tiles (6-19)
function generateIceTiles() {
  generateCommonLandTiles();

  // 6: Ice crystal spire (tall)
  writeTileStr(landTileAddr(6), [
    "00030000","00030000","00370000","00373000",
    "03737300","03737300","37373730","37373730",
  ]);
  // 7: Ice crystal spire top
  writeTileStr(landTileAddr(7), [
    "00000300","00000300","00003700","00003730",
    "00037370","00037370","00373730","00373730",
  ]);
  // 8: Snow surface
  writeTileStr(landTileAddr(8), [
    "00000000","22222222","23333332","33333333",
    "33133313","11111111","11511151","11111111",
  ]);
  // 9: Ice block
  writeTileStr(landTileAddr(9), [
    "33733373","37373737","73737373","33733373",
    "37373737","73737373","33733373","37373737",
  ]);
  // 10: Snowdrift left
  writeTileStr(landTileAddr(10), [
    "00000000","00000000","00000002","00000023",
    "00002333","00023331","00233111","02331111",
  ]);
  // 11: Snowdrift right
  writeTileStr(landTileAddr(11), [
    "00000000","00000000","20000000","32000000",
    "33320000","13332000","11133200","11113320",
  ]);
  // 12: Icicle hanging
  writeTileStr(landTileAddr(12), [
    "77777777","07070707","07070700","00700700",
    "00700000","00700000","00000000","00000000",
  ]);
  // 13: Frozen ground
  writeTileStr(landTileAddr(13), [
    "11711171","17171717","71717171","17171711",
    "11711171","17111717","71711711","11171171",
  ]);
  // 14: Snow pile
  writeTileStr(landTileAddr(14), [
    "00000000","00000000","00222000","02333200",
    "23333320","33333333","13333331","11111111",
  ]);
  // 15: Cracked ice
  writeTileStr(landTileAddr(15), [
    "33333333","33303333","33300333","30000033",
    "33000333","33300333","33330333","33333333",
  ]);
}

// Alien surface tiles (6-19)
function generateAlienTiles() {
  generateCommonLandTiles();

  // 6: Alien tendril rising
  writeTileStr(landTileAddr(6), [
    "00088000","00088000","00880000","00880000",
    "08800000","08800000","08800000","08800000",
  ]);
  // 7: Alien tendril tip
  writeTileStr(landTileAddr(7), [
    "00099000","00989900","09889890","08888980",
    "00888800","00088000","00088000","00088000",
  ]);
  // 8: Alien pod / egg
  writeTileStr(landTileAddr(8), [
    "00000000","00099000","00999900","09AAAA90",
    "09AAAA90","00999900","00099000","00000000",
  ]);
  // 9: Alien ground texture
  writeTileStr(landTileAddr(9), [
    "11181118","18111811","11818118","81118111",
    "18111181","11181118","81118111","11811181",
  ]);
  // 10: Organic growth left
  writeTileStr(landTileAddr(10), [
    "00000088","00000889","00008898","00088989",
    "00889898","08898989","88989811","98981111",
  ]);
  // 11: Organic growth right
  writeTileStr(landTileAddr(11), [
    "88000000","98800000","89880000","98988000",
    "89898800","98989800","11898988","11118989",
  ]);
  // 12: Spore cluster
  writeTileStr(landTileAddr(12), [
    "00000000","00900090","09009009","00900090",
    "00000000","09000900","00909000","00000000",
  ]);
  // 13: Alien crystal formation
  writeTileStr(landTileAddr(13), [
    "000A0000","000AA000","00AAA000","0AAAA000",
    "0AAAAA00","AAAAAA00","AAAAAAA0","22222222",
  ]);
  // 14: Alien platform
  writeTileStr(landTileAddr(14), [
    "00000000","00000000","88888888","98989898",
    "89898989","88888888","00000000","00000000",
  ]);
  // 15: Bubbling surface
  writeTileStr(landTileAddr(15), [
    "22222222","12191121","11111911","19111111",
    "11119111","11111191","91111119","11911111",
  ]);
}

// Volcanic ruin tiles (6-19)
function generateVolcanicTiles() {
  generateCommonLandTiles();

  // 6: Ruined pillar
  writeTileStr(landTileAddr(6), [
    "05566550","00566500","00566500","00566500",
    "00566500","00566500","00566500","00566500",
  ]);
  // 7: Pillar top / capital
  writeTileStr(landTileAddr(7), [
    "00000000","05555550","55666655","56666665",
    "05666650","05566550","00566500","00566500",
  ]);
  // 8: Lava surface (animated via color cycling)
  writeTileStr(landTileAddr(8), [
    "88998899","98899889","89988998","99889988",
    "88998899","98899889","89988998","99889988",
  ]);
  // 9: Crumbling stone
  writeTileStr(landTileAddr(9), [
    "55155515","15551555","55005515","10050150",
    "55015005","15500500","00155010","05050151",
  ]);
  // 10: Smoke / ash rising
  writeTileStr(landTileAddr(10), [
    "00050000","00555000","05050500","00505000",
    "05050500","00555000","00050000","00000000",
  ]);
  // 11: Volcanic rock fill
  writeTileStr(landTileAddr(11), [
    "55655565","56565656","65656565","55655565",
    "56565656","65656565","55655565","56565656",
  ]);
  // 12: Lava glow from below
  writeTileStr(landTileAddr(12), [
    "11111111","11181111","11888111","18888811",
    "88999888","89999988","99AA9999","AAAAAAAA",
  ]);
  // 13: Ruined arch left
  writeTileStr(landTileAddr(13), [
    "00000055","00000565","00005655","00056555",
    "00565555","05655555","56555555","65555555",
  ]);
  // 14: Ruined arch right
  writeTileStr(landTileAddr(14), [
    "55000000","56500000","55650000","55565000",
    "55556500","55555650","55555565","55555556",
  ]);
  // 15: Ash ground
  writeTileStr(landTileAddr(15), [
    "55555555","51515151","15151515","51555155",
    "15515515","55155151","51515515","15151515",
  ]);
}

// Digital ocean tiles (6-19)
function generateOceanTiles() {
  generateCommonLandTiles();

  // 6: Wave crest
  writeTileStr(landTileAddr(6), [
    "00000000","00000000","00300030","03730373",
    "37373737","73737373","33333333","11111111",
  ]);
  // 7: Wave body
  writeTileStr(landTileAddr(7), [
    "33333333","13131313","31313131","13131313",
    "31313131","13131313","31313131","11111111",
  ]);
  // 8: Data stream vertical
  writeTileStr(landTileAddr(8), [
    "00770000","00770000","00770000","00770000",
    "00000770","00000770","00000770","00000770",
  ]);
  // 9: Digital reef
  writeTileStr(landTileAddr(9), [
    "00000000","07000070","77000770","77707770",
    "77777777","77777777","17171717","11111111",
  ]);
  // 10: Distant shore left
  writeTileStr(landTileAddr(10), [
    "00000000","00000000","00000000","00000000",
    "00000002","00000023","00002311","00023111",
  ]);
  // 11: Distant shore right
  writeTileStr(landTileAddr(11), [
    "00000000","00000000","00000000","00000000",
    "20000000","32000000","11320000","11132000",
  ]);
  // 12: Deep water
  writeTileStr(landTileAddr(12), [
    "11111111","11211121","12112112","11211121",
    "21121112","11211121","12112112","11111111",
  ]);
  // 13: Data tower base
  writeTileStr(landTileAddr(13), [
    "07777770","70707070","77777777","70707070",
    "77777777","70707070","07777770","00000000",
  ]);
  // 14: Floating data block
  writeTileStr(landTileAddr(14), [
    "00000000","07777700","07070700","07777700",
    "07070700","07777700","00000000","00000000",
  ]);
  // 15: Seabed
  writeTileStr(landTileAddr(15), [
    "11111111","11151115","15111511","11111111",
    "51111151","11111111","11511115","11111111",
  ]);
}

// Void temple tiles (6-19)
function generateVoidTiles() {
  generateCommonLandTiles();

  // 6: Temple pillar
  writeTileStr(landTileAddr(6), [
    "00577500","00577500","00577500","00577500",
    "00577500","00577500","00577500","00577500",
  ]);
  // 7: Temple pillar capital
  writeTileStr(landTileAddr(7), [
    "57777775","77555577","75777757","05777750",
    "00577500","00577500","00577500","00577500",
  ]);
  // 8: Floating platform
  writeTileStr(landTileAddr(8), [
    "00000000","77777777","75555557","57777775",
    "00000000","00000000","00000000","00000000",
  ]);
  // 9: Void brick
  writeTileStr(landTileAddr(9), [
    "55555555","57575757","55555555","75757575",
    "55555555","57575757","55555555","75757575",
  ]);
  // 10: Arch left
  writeTileStr(landTileAddr(10), [
    "00000057","00000577","00005775","00057755",
    "00577500","05775000","57750000","77500000",
  ]);
  // 11: Arch right
  writeTileStr(landTileAddr(11), [
    "75000000","77500000","57750000","55775000",
    "00577500","00057750","00005775","00000577",
  ]);
  // 12: Floating debris
  writeTileStr(landTileAddr(12), [
    "00000000","00055000","00577500","05555550",
    "00577500","00055000","00000000","00000000",
  ]);
  // 13: Void crystal
  writeTileStr(landTileAddr(13), [
    "00070000","00777000","07777700","77777770",
    "07777700","00777000","00070000","00000000",
  ]);
  // 14: Temple step
  writeTileStr(landTileAddr(14), [
    "00000000","00000000","00000000","55555555",
    "57575757","55555555","55555555","55555555",
  ]);
  // 15: Ethereal wisp
  writeTileStr(landTileAddr(15), [
    "00000000","00070000","00707000","07000700",
    "00707000","00070000","00000000","00000000",
  ]);
}

// ============================================================
//  SECTION 3: LANDSCAPE PALETTE GENERATION
// ============================================================

function generateLandscapePalette(biome) {
  // Palettes 0-3: Sky (will be corrupted by glitches)
  // Palettes 4-7: Ground (more stable, biome-specific)
  // Color 0 in every palette = transparent (black/zero)

  switch (biome) {
    case "forest":
      // Sky: Dusk purples and oranges
      generateThemedPalette("void"); // deep purples for sky
      // Override palettes 4-7 for ground: greens and browns
      setGroundPalette(4, [0,0,0],[40,30,15],[25,60,15],[35,80,20],[50,110,30],[60,130,40],[80,50,25],[55,35,15],
                          [70,100,35],[45,120,25],[90,140,50],[30,50,10],[100,70,40],[65,90,30],[110,150,60],[80,60,30]);
      setGroundPalette(5, [0,0,0],[50,35,15],[35,25,10],[60,45,20],[45,30,12],[70,55,25],[40,28,10],[80,60,30],
                          [55,40,18],[90,70,35],[65,50,22],[100,80,40],[75,55,25],[110,85,45],[85,65,30],[120,90,50]);
      setGroundPalette(6, [0,0,0],[30,70,20],[40,90,25],[50,110,35],[60,130,45],[35,80,22],[45,100,30],[55,120,40],
                          [70,140,50],[80,150,55],[65,125,42],[90,160,60],[100,170,65],[75,135,48],[85,145,52],[95,155,58]);
      setGroundPalette(7, [0,0,0],[180,50,50],[200,80,30],[220,120,40],[200,160,60],[180,140,50],[160,100,40],[140,80,30],
                          [120,60,20],[100,50,15],[220,100,40],[240,140,50],[200,180,70],[160,120,45],[180,100,35],[200,60,25]);
      break;

    case "ice":
      generateThemedPalette("ice");
      setGroundPalette(4, [0,0,0],[200,220,240],[180,200,230],[160,190,220],[220,235,250],[240,245,255],[190,210,235],[170,195,225],
                          [150,180,210],[130,170,200],[210,230,245],[230,240,250],[250,252,255],[140,175,205],[160,185,215],[180,200,230]);
      setGroundPalette(5, [0,0,0],[100,140,180],[120,160,200],[80,120,160],[140,180,220],[160,200,240],[90,130,170],[110,150,190],
                          [130,170,210],[150,190,230],[70,110,150],[170,200,235],[60,100,140],[180,210,240],[50,90,130],[190,215,245]);
      setGroundPalette(6, [0,0,0],[150,200,230],[120,180,220],[180,220,245],[200,235,250],[100,160,210],[220,240,252],[170,215,240],
                          [140,195,230],[110,175,215],[230,245,255],[160,205,235],[190,225,248],[130,185,225],[80,150,200],[210,238,252]);
      setGroundPalette(7, [0,0,0],[180,230,250],[200,240,255],[160,220,245],[140,210,240],[120,200,235],[100,190,230],[220,245,255],
                          [240,250,255],[80,180,225],[60,170,220],[190,235,250],[210,242,252],[170,225,248],[150,215,242],[130,205,238]);
      break;

    case "alien":
      generateThemedPalette("neon");
      setGroundPalette(4, [0,0,0],[40,20,50],[60,30,70],[50,40,60],[70,20,80],[80,35,90],[45,25,55],[65,15,75],
                          [90,40,100],[55,30,65],[100,50,110],[75,25,85],[110,45,120],[85,35,95],[120,55,130],[95,40,105]);
      setGroundPalette(5, [0,0,0],[20,80,40],[30,100,50],[40,120,60],[50,140,70],[25,90,45],[35,110,55],[45,130,65],
                          [60,150,80],[70,160,90],[55,135,72],[80,170,95],[15,70,35],[90,180,100],[65,145,78],[75,155,85]);
      setGroundPalette(6, [0,0,0],[200,50,200],[180,40,180],[220,60,220],[160,30,160],[240,80,240],[140,25,140],[200,70,200],
                          [255,100,255],[170,35,170],[230,75,230],[150,28,150],[210,65,210],[190,55,190],[245,90,245],[220,80,220]);
      setGroundPalette(7, [0,0,0],[0,255,100],[0,220,80],[0,200,60],[0,180,50],[0,240,90],[0,160,40],[0,255,120],
                          [50,255,150],[0,140,30],[30,240,110],[0,120,25],[20,220,100],[40,200,90],[60,180,80],[80,160,70]);
      break;

    case "volcanic":
      generateThemedPalette("fire");
      setGroundPalette(4, [0,0,0],[60,40,30],[80,55,35],[50,35,25],[70,45,30],[90,60,40],[100,70,45],[45,30,20],
                          [110,75,50],[65,42,28],[120,80,55],[55,38,22],[130,85,58],[75,50,32],[85,58,38],[95,65,42]);
      setGroundPalette(5, [0,0,0],[80,50,40],[100,60,45],[60,40,30],[120,70,50],[90,55,42],[110,65,48],[70,45,35],
                          [130,75,55],[50,35,25],[140,80,58],[105,62,46],[85,52,38],[115,68,52],[95,58,44],[125,72,54]);
      setGroundPalette(6, [0,0,0],[60,40,30],[80,50,35],[100,60,40],[120,70,50],[140,80,55],[90,55,38],[110,65,45],
                          [130,75,52],[150,85,60],[70,45,32],[160,90,62],[50,35,25],[170,95,65],[95,58,40],[180,100,68]);
      setGroundPalette(7, [0,0,0],[200,60,10],[220,100,20],[240,140,30],[255,180,40],[200,80,15],[220,120,25],[240,160,35],
                          [255,200,50],[180,50,8],[200,90,18],[220,130,28],[240,170,38],[255,210,48],[180,70,12],[200,110,22]);
      break;

    case "ocean":
      generateThemedPalette("synthwave");
      setGroundPalette(4, [0,0,0],[10,30,60],[15,40,80],[20,50,100],[25,60,120],[30,70,140],[12,35,70],[18,45,90],
                          [22,55,110],[28,65,130],[35,75,150],[8,25,55],[40,80,160],[32,72,142],[16,38,75],[45,85,165]);
      setGroundPalette(5, [0,0,0],[20,60,100],[30,80,130],[40,100,160],[50,120,180],[25,70,115],[35,90,145],[45,110,170],
                          [55,130,190],[15,50,85],[60,140,200],[22,65,105],[65,150,210],[38,85,140],[48,105,165],[58,125,185]);
      setGroundPalette(6, [0,0,0],[0,180,200],[0,160,180],[0,200,220],[0,140,160],[0,220,240],[0,120,140],[0,240,255],
                          [30,200,220],[0,100,120],[20,190,210],[0,80,100],[40,210,230],[10,170,190],[50,220,240],[60,230,250]);
      setGroundPalette(7, [0,0,0],[80,40,120],[100,50,150],[120,60,180],[140,70,200],[160,80,220],[90,45,135],[110,55,165],
                          [130,65,190],[150,75,210],[170,85,230],[70,35,110],[180,90,240],[85,42,128],[105,52,155],[125,62,182]);
      break;

    case "void":
      generateThemedPalette("midnight");
      setGroundPalette(4, [0,0,0],[40,30,60],[55,40,80],[70,50,100],[85,60,120],[50,35,70],[65,45,90],[80,55,110],
                          [95,65,130],[45,32,65],[100,70,140],[60,42,85],[110,75,150],[75,52,105],[90,62,125],[105,72,145]);
      setGroundPalette(5, [0,0,0],[60,50,80],[80,65,105],[100,80,130],[70,58,90],[90,72,115],[110,88,140],[120,95,155],
                          [75,62,95],[130,102,165],[85,70,110],[140,110,175],[95,78,120],[105,85,135],[115,92,148],[125,98,160]);
      setGroundPalette(6, [0,0,0],[120,80,180],[140,100,200],[100,60,160],[160,120,220],[80,50,140],[180,140,240],[110,70,170],
                          [130,90,190],[150,110,210],[170,130,230],[90,55,150],[190,148,245],[200,155,250],[60,40,120],[210,160,252]);
      setGroundPalette(7, [0,0,0],[200,180,255],[180,160,240],[220,200,255],[160,140,220],[240,220,255],[140,120,200],[250,235,255],
                          [170,150,230],[210,190,248],[190,170,242],[230,210,252],[150,130,210],[255,245,255],[120,100,190],[245,230,255]);
      break;
  }

  rebuildCGRAMCache();
}

// Helper: write 16 colors to a palette from RGB triplet arrays
function setGroundPalette(palIdx, ...colors) {
  for (let i = 0; i < colors.length && i < 16; i++) {
    const c = colors[i];
    writeCGRAM(palIdx, i, c[0], c[1], c[2]);
  }
}

// ============================================================
//  SECTION 4: TERRAIN COMPOSITION
// ============================================================

// Ground tilemap backup for corruption resistance
let landscapeGroundBackup = null;

function backupGroundTilemap() {
  const base = bgTilemapAddr[0];
  const size = 32 * 32 * 2; // full 32x32 tilemap
  landscapeGroundBackup = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    landscapeGroundBackup[i] = VRAM[base + i];
  }
}

function restoreLandscapeGround(strength) {
  if (!landscapeGroundBackup) return;
  const base = bgTilemapAddr[0];
  const size = landscapeGroundBackup.length;
  for (let i = 0; i < size; i++) {
    if (glitchRand() < strength) {
      VRAM[base + i] = landscapeGroundBackup[i];
    }
  }
}

// Generate terrain height map
function generateTerrainHeights(biome, width) {
  const h = new Float32Array(width);
  const seed = glitchRand() * 1000;

  switch (biome) {
    case "forest":
      for (let x = 0; x < width; x++) {
        h[x] = 9 + Math.sin((x + seed) * 0.25) * 2.5 +
                    Math.sin((x + seed) * 0.6) * 1.5 +
                    Math.sin((x + seed) * 0.1) * 1;
      }
      break;
    case "ice":
      for (let x = 0; x < width; x++) {
        h[x] = 8 + Math.abs(Math.sin((x + seed) * 0.4)) * 5 +
                    Math.sin((x + seed) * 0.15) * 2;
      }
      break;
    case "alien":
      for (let x = 0; x < width; x++) {
        h[x] = 7 + Math.sin((x + seed) * 0.3) * 3 +
                    Math.abs(Math.sin((x + seed) * 0.8)) * 2 +
                    Math.sin((x + seed) * 1.5) * 1;
      }
      break;
    case "volcanic":
      for (let x = 0; x < width; x++) {
        h[x] = 6 + Math.sin((x + seed) * 0.2) * 3 +
                    Math.max(0, Math.sin((x + seed) * 0.5) * 4);
      }
      break;
    case "ocean":
      for (let x = 0; x < width; x++) {
        h[x] = 5 + Math.sin((x + seed) * 0.3) * 1 +
                    Math.sin((x + seed) * 0.7) * 0.5;
      }
      break;
    case "void":
      for (let x = 0; x < width; x++) {
        // Floating platforms — discontinuous
        const platform = Math.sin((x + seed) * 0.4) > 0.2;
        h[x] = platform ? (6 + Math.sin((x + seed) * 0.3) * 3) : 0;
      }
      break;
  }

  // Clamp
  const maxH = Math.floor(SCREEN_H / 8) - 4;
  for (let x = 0; x < width; x++) {
    h[x] = Math.max(2, Math.min(maxH, Math.round(h[x])));
  }
  return h;
}

// Place a feature pattern on the tilemap
function placeFeature(tmBase, pattern, sx, sy, palette) {
  for (let dy = 0; dy < pattern.length; dy++) {
    const row = pattern[dy];
    for (let dx = 0; dx < row.length; dx++) {
      const tile = row[dx];
      if (tile === 0) continue;
      const tx = (sx + dx) & 31; // wrap horizontally
      const ty = sy + dy;
      if (ty < 0 || ty >= 32) continue;
      writeTilemapEntry(tmBase, tx, ty, tile, palette, false, false);
    }
  }
}

// Compose a complete landscape tilemap
function composeLandscape(biome) {
  const tmBase = bgTilemapAddr[0];
  const heights = generateTerrainHeights(biome, 32);
  const totalRows = Math.ceil(SCREEN_H / 8);

  // Clear ground tilemap (all transparent = sky shows through)
  for (let ty = 0; ty < 32; ty++) {
    for (let tx = 0; tx < 32; tx++) {
      writeTilemapEntry(tmBase, tx, ty, 0, 4, false, false);
    }
  }

  // Fill terrain based on height map
  for (let tx = 0; tx < 32; tx++) {
    const terrH = heights[tx];
    const groundY = totalRows - terrH;

    for (let ty = groundY; ty < totalRows; ty++) {
      if (ty === groundY) {
        // Surface tile
        writeTilemapEntry(tmBase, tx, ty, 3, 4, false, false);
      } else if (ty === groundY + 1) {
        writeTilemapEntry(tmBase, tx, ty, 1, 4, false, false);
      } else {
        // Deep ground
        writeTilemapEntry(tmBase, tx, ty, 2, 5, false, false);
      }
    }

    // Slope detection
    if (tx > 0) {
      const prevH = heights[tx - 1];
      if (terrH > prevH + 1) {
        // Rising slope from left
        const slopeY = totalRows - terrH;
        writeTilemapEntry(tmBase, tx, slopeY, 4, 4, false, false);
      } else if (terrH < prevH - 1) {
        // Falling slope to right
        const slopeY = totalRows - prevH;
        writeTilemapEntry(tmBase, tx, slopeY, 5, 4, false, false);
      }
    }
  }

  // Place biome-specific features
  switch (biome) {
    case "forest":
      placeForestFeatures(tmBase, heights, totalRows);
      break;
    case "ice":
      placeIceFeatures(tmBase, heights, totalRows);
      break;
    case "alien":
      placeAlienFeatures(tmBase, heights, totalRows);
      break;
    case "volcanic":
      placeVolcanicFeatures(tmBase, heights, totalRows);
      break;
    case "ocean":
      placeOceanFeatures(tmBase, heights, totalRows);
      break;
    case "void":
      placeVoidFeatures(tmBase, heights, totalRows);
      break;
  }
}

// --- Feature placement per biome ---

function placeForestFeatures(tmBase, heights, totalRows) {
  // Small tree pattern
  const treeSmall = [
    [0, 9, 0],
    [8, 8, 8],
    [8, 8, 8],
    [0, 6, 0],
    [0, 6, 0],
  ];
  // Large tree pattern
  const treeLarge = [
    [0, 0, 9, 0, 0],
    [0, 8, 8, 8, 0],
    [10, 8, 8, 8, 11],
    [8, 8, 8, 8, 8],
    [0, 12, 6, 12, 0],
    [0, 0, 7, 0, 0],
    [0, 0, 15, 0, 0],
  ];
  const bush = [[0, 13, 0], [13, 13, 13]];

  // Place trees at intervals
  for (let x = 1; x < 30; x += 3 + glitchRandInt(3)) {
    const groundY = totalRows - heights[x];
    if (glitchRand() < 0.6) {
      const tree = glitchRand() < 0.5 ? treeLarge : treeSmall;
      const treeH = tree.length;
      placeFeature(tmBase, tree, x - 1, groundY - treeH, 6);
    } else {
      placeFeature(tmBase, bush, x, groundY - 2, 6);
    }
    // Grass tufts
    if (glitchRand() < 0.4) {
      placeFeature(tmBase, [[18]], x + 1, groundY - 1, 6);
    }
  }
  // Occasional mushroom
  for (let x = 2; x < 30; x += 5 + glitchRandInt(4)) {
    if (glitchRand() < 0.3) {
      const groundY = totalRows - heights[x];
      placeFeature(tmBase, [[14]], x, groundY - 1, 7);
    }
  }
}

function placeIceFeatures(tmBase, heights, totalRows) {
  const crystalTall = [[7], [6], [6]];
  const crystalShort = [[7], [6]];
  const snowPile = [[14]];
  const icicle = [[12]];

  for (let x = 0; x < 32; x += 2 + glitchRandInt(3)) {
    const groundY = totalRows - heights[x];
    if (glitchRand() < 0.4) {
      const crystal = glitchRand() < 0.4 ? crystalTall : crystalShort;
      placeFeature(tmBase, crystal, x, groundY - crystal.length, 6);
    }
    if (glitchRand() < 0.3) {
      placeFeature(tmBase, snowPile, x, groundY - 1, 4);
    }
  }
  // Icicles hanging from top
  for (let x = 0; x < 32; x += 3 + glitchRandInt(4)) {
    if (glitchRand() < 0.3) {
      placeFeature(tmBase, icicle, x, 0, 6);
    }
  }
  // Override surface tiles with snow
  for (let tx = 0; tx < 32; tx++) {
    const groundY = totalRows - heights[tx];
    if (groundY >= 0 && groundY < 32) {
      writeTilemapEntry(tmBase, tx, groundY, 8, 4, false, false);
    }
  }
}

function placeAlienFeatures(tmBase, heights, totalRows) {
  const tendril = [[7], [6], [6], [6]];
  const pod = [[8]];
  const spores = [[12]];
  const growthL = [[10]];
  const growthR = [[11]];
  const crystal = [[13]];

  for (let x = 1; x < 31; x += 2 + glitchRandInt(4)) {
    const groundY = totalRows - heights[x];
    const r = glitchRand();
    if (r < 0.3) {
      placeFeature(tmBase, tendril, x, groundY - 4, 6);
    } else if (r < 0.5) {
      placeFeature(tmBase, crystal, x, groundY - 1, 6);
    } else if (r < 0.65) {
      placeFeature(tmBase, pod, x, groundY - 1, 5);
    }
    if (glitchRand() < 0.3) {
      placeFeature(tmBase, spores, x + 1, groundY - 3 - glitchRandInt(3), 7);
    }
  }
  // Organic growth on terrain edges
  for (let tx = 1; tx < 31; tx++) {
    if (heights[tx] > heights[tx - 1] + 1 && glitchRand() < 0.5) {
      const gy = totalRows - heights[tx];
      placeFeature(tmBase, growthL, tx, gy, 5);
    }
    if (heights[tx] > heights[tx + 1] + 1 && glitchRand() < 0.5) {
      const gy = totalRows - heights[tx];
      placeFeature(tmBase, growthR, tx, gy, 5);
    }
  }
  // Override ground with alien texture
  for (let tx = 0; tx < 32; tx++) {
    const groundY = totalRows - heights[tx];
    for (let ty = groundY + 2; ty < totalRows; ty++) {
      if (ty >= 0 && ty < 32) {
        writeTilemapEntry(tmBase, tx, ty, 9, 4, (tx & 1) !== 0, false);
      }
    }
  }
}

function placeVolcanicFeatures(tmBase, heights, totalRows) {
  const pillar = [[7], [6], [6], [6]];
  const crumble = [[9]];
  const archL = [[13]];
  const archR = [[14]];
  const smoke = [[10]];

  for (let x = 2; x < 30; x += 3 + glitchRandInt(4)) {
    const groundY = totalRows - heights[x];
    if (glitchRand() < 0.35) {
      placeFeature(tmBase, pillar, x, groundY - 4, 5);
    } else if (glitchRand() < 0.3) {
      // Ruined arch
      placeFeature(tmBase, archL, x, groundY - 2, 5);
      placeFeature(tmBase, archR, x + 2, groundY - 2, 5);
    }
    if (glitchRand() < 0.2) {
      placeFeature(tmBase, smoke, x, groundY - 3 - glitchRandInt(2), 4);
    }
  }
  // Lava pools in low areas
  for (let tx = 0; tx < 32; tx++) {
    if (heights[tx] < 7) {
      const groundY = totalRows - heights[tx];
      writeTilemapEntry(tmBase, tx, groundY, 8, 7, false, false);
      // Lava glow below
      if (groundY + 1 < 32) {
        writeTilemapEntry(tmBase, tx, groundY + 1, 12, 7, false, false);
      }
    }
  }
  // Volcanic rock texture for deep ground
  for (let tx = 0; tx < 32; tx++) {
    const groundY = totalRows - heights[tx];
    for (let ty = groundY + 2; ty < totalRows; ty++) {
      if (ty >= 0 && ty < 32) {
        writeTilemapEntry(tmBase, tx, ty, 11, 5, (tx + ty) & 1, false);
      }
    }
  }
}

function placeOceanFeatures(tmBase, heights, totalRows) {
  const dataStream = [[8], [8], [8]];
  const reef = [[9]];
  const tower = [[14], [13], [13]];

  // Water surface across most of the screen
  const waterY = totalRows - 6;
  for (let tx = 0; tx < 32; tx++) {
    writeTilemapEntry(tmBase, tx, waterY, 6, 6, (tx & 1) !== 0, false);
    // Water body below
    for (let ty = waterY + 1; ty < totalRows - 1; ty++) {
      writeTilemapEntry(tmBase, tx, ty, 7, 4, false, false);
    }
    // Seabed
    writeTilemapEntry(tmBase, tx, totalRows - 1, 15, 5, false, false);
  }

  // Distant shore (small island)
  const shoreX = 10 + glitchRandInt(12);
  placeFeature(tmBase, [[10, 3, 3, 3, 11]], shoreX, waterY - 1, 5);
  placeFeature(tmBase, [[1, 1, 1, 1, 1]], shoreX, waterY, 5);

  // Data structures rising from water
  for (let x = 2; x < 30; x += 5 + glitchRandInt(4)) {
    if (glitchRand() < 0.4) {
      placeFeature(tmBase, tower, x, waterY - 3, 7);
    }
    if (glitchRand() < 0.3) {
      placeFeature(tmBase, dataStream, x + 2, waterY - 5 - glitchRandInt(3), 6);
    }
    if (glitchRand() < 0.3) {
      placeFeature(tmBase, reef, x + 1, waterY + 1, 6);
    }
  }
}

function placeVoidFeatures(tmBase, heights, totalRows) {
  const pillar = [[7], [6], [6], [6], [6]];
  const platform = [[8, 8, 8]];
  const arch = [[10, 0, 11]];
  const debris = [[12]];
  const wisp = [[15]];
  const crystal = [[13]];

  // Floating platforms at various heights
  for (let x = 0; x < 30; x += 3 + glitchRandInt(4)) {
    const fy = 8 + glitchRandInt(totalRows - 14);
    if (glitchRand() < 0.5) {
      placeFeature(tmBase, platform, x, fy, 4);
      // Pillar below some platforms
      if (glitchRand() < 0.3) {
        for (let py = fy + 1; py < fy + 4 && py < 32; py++) {
          placeFeature(tmBase, [[6]], x + 1, py, 5);
        }
      }
    }
    if (glitchRand() < 0.3) {
      placeFeature(tmBase, arch, x, fy - 2, 6);
    }
  }

  // Temple pillars rising from bottom
  for (let x = 3; x < 30; x += 6 + glitchRandInt(5)) {
    if (glitchRand() < 0.4) {
      const groundY = totalRows - heights[x];
      if (groundY < 32 && heights[x] > 0) {
        placeFeature(tmBase, pillar, x, groundY - 5, 5);
      }
    }
  }

  // Floating debris and wisps
  for (let x = 0; x < 32; x += 2 + glitchRandInt(3)) {
    if (glitchRand() < 0.2) {
      placeFeature(tmBase, debris, x, 4 + glitchRandInt(10), 6);
    }
    if (glitchRand() < 0.15) {
      placeFeature(tmBase, wisp, x, 2 + glitchRandInt(15), 7);
    }
    if (glitchRand() < 0.1) {
      placeFeature(tmBase, crystal, x, 6 + glitchRandInt(12), 7);
    }
  }

  // Void brick fill for grounded sections
  for (let tx = 0; tx < 32; tx++) {
    const groundY = totalRows - heights[tx];
    for (let ty = groundY + 1; ty < totalRows; ty++) {
      if (ty >= 0 && ty < 32 && heights[tx] > 0) {
        writeTilemapEntry(tmBase, tx, ty, 9, 5, false, false);
      }
    }
  }
}

// ============================================================
//  SECTION 5: RASTER SKY GRADIENTS
// ============================================================

function generateLandscapeRaster(biome) {
  const h = SCREEN_H;
  for (let y = 0; y < h; y++) {
    const t = y / h; // 0 at top, 1 at bottom
    let r, g, b;
    switch (biome) {
      case "forest": // Dusk: deep purple → orange → peach
        r = Math.round(30 + t * 180);
        g = Math.round(10 + t * 80);
        b = Math.round(80 - t * 50);
        break;
      case "ice": // Arctic: white → pale blue → steel blue
        r = Math.round(220 - t * 140);
        g = Math.round(230 - t * 100);
        b = Math.round(250 - t * 40);
        break;
      case "alien": // Toxic: dark green → yellow-green → sickly yellow
        r = Math.round(20 + t * 160);
        g = Math.round(40 + t * 100);
        b = Math.round(60 - t * 40);
        break;
      case "volcanic": // Hellfire: black → dark red → bright orange
        r = Math.round(20 + t * 220);
        g = Math.round(5 + t * 80);
        b = Math.round(10 - t * 5);
        break;
      case "ocean": // Sunset: dark navy → royal blue → pink-orange
        r = Math.round(10 + t * 200);
        g = Math.round(10 + t * 70);
        b = Math.round(60 + t * 80);
        break;
      case "void": // Abyss: black → deep purple → faint white
        r = Math.round(5 + t * 80);
        g = Math.round(0 + t * 20);
        b = Math.round(15 + t * 100);
        break;
      default:
        r = g = b = Math.round(t * 60);
    }
    rasterColors[y] = rgbToSnesColor(
      Math.min(255, Math.max(0, r)),
      Math.min(255, Math.max(0, g)),
      Math.min(255, Math.max(0, b))
    );
  }
}

// ============================================================
//  SECTION 6: LANDSCAPE SCENE DEFINITIONS
// ============================================================

const landscapeSceneIndices = [];

function createLandscapeScene(biome, displayName) {
  return {
    name: displayName,
    landscape: true,
    biome: biome,

    setup() {
      ppuMode = 1;
      bgEnabled[0] = true;  // Ground layer (foreground)
      bgEnabled[1] = true;  // Sky layer (background)
      bgEnabled[2] = false;
      bgEnabled[3] = false;

      // Generate base sky tiles at 0x0000
      generateTileData();
      generateBG2Tiles();

      // Generate landscape tiles at 0x2000
      switch (biome) {
        case "forest":   generateForestTiles(); break;
        case "ice":       generateIceTiles(); break;
        case "alien":     generateAlienTiles(); break;
        case "volcanic":  generateVolcanicTiles(); break;
        case "ocean":     generateOceanTiles(); break;
        case "void":      generateVoidTiles(); break;
      }

      // BG0 (ground): tiles at 0x2000, tilemap at 0x8000
      bgCharAddr[0] = LAND_TILE_BASE;
      bgTilemapAddr[0] = 0x8000;

      // BG1 (sky): tiles at 0x0000, tilemap at 0x8800
      bgCharAddr[1] = 0x0000;
      bgTilemapAddr[1] = 0x8800;

      // Generate sky tilemap (chaotic tiles for corruption)
      for (let ty = 0; ty < 32; ty++) {
        for (let tx = 0; tx < 32; tx++) {
          const tileIdx = ((tx * 7 + ty * 13) ^ (tx * ty * 3)) & 0xFF;
          const palette = ty & 3;
          writeTilemapEntry(0x8800, tx, ty, tileIdx, palette, false, false);
        }
      }

      // Compose the landscape ground tilemap
      composeLandscape(biome);

      // Backup ground tilemap for corruption resistance
      backupGroundTilemap();

      // Palette
      generateLandscapePalette(biome);

      // Raster sky gradient
      rasterEnabled = true;
      generateLandscapeRaster(biome);

      // Effects per biome
      ghostEnabled = (biome === "forest" || biome === "void" || biome === "ocean");
      ghostAlpha = biome === "void" ? 0.5 : 0.25;
      windowEnabled = (biome === "ice");
      if (biome === "ice") {
        window1Left = 40; window1Right = 216;
        windowMode = 1; windowMaskAction = 2;
      }
      spritesEnabled = (biome === "alien" || biome === "volcanic" || biome === "forest");
      if (spritesEnabled) {
        const style = biome === "volcanic" ? "rise" : biome === "alien" ? "scatter" : "rain";
        initParticles(24, style);
      }

      // Color cycling
      switch (biome) {
        case "forest":   initColorCycling("slow"); break;
        case "ice":       initColorCycling("breathe"); break;
        case "alien":     initColorCycling("pulse"); break;
        case "volcanic":  initColorCycling("full"); break;
        case "ocean":     initColorCycling("chase"); break;
        case "void":      initColorCycling("slow"); break;
      }

      colorMathMode = (biome === "volcanic") ? 1 : 0; // additive for lava glow
      fixedColor = biome === "volcanic" ? { r: 8, g: 2, b: 0 } : { r: 0, g: 0, b: 0 };

      hdmaEffects = [];
      bgScrollX.fill(0);
      bgScrollY.fill(0);
    },

    update(localFrame) {
      // --- Parallax scrolling ---
      bgScrollX[1] += 1; // sky scrolls steadily
      if (localFrame % 3 === 0) bgScrollX[0] += 1; // ground slower

      // Sky vertical drift (atmospheric)
      bgScrollY[1] = Math.floor(Math.sin(localFrame * 0.003) * 3);

      // --- Biome-specific animation ---
      switch (biome) {
        case "forest":
          // Wind gusts in canopy
          bgScrollY[0] = Math.floor(Math.sin(localFrame * 0.008) * 0.8);
          // Firefly particles drift
          if (spritesEnabled) updateParticles();
          break;

        case "ice":
          // Slow pan, window shimmer
          if (windowEnabled) {
            window1Left = Math.floor(40 + Math.sin(localFrame * 0.005) * 30);
            window1Right = Math.floor(216 - Math.sin(localFrame * 0.007) * 30);
          }
          break;

        case "alien":
          // Pulsing organic growth — scroll wobble
          bgScrollY[0] = Math.floor(Math.sin(localFrame * 0.01) * 1.5);
          if (spritesEnabled) updateParticles();
          // HDMA waviness in atmosphere
          if (localFrame % 30 === 0) {
            hdmaEffects.push({
              startScanline: glitchRandInt(Math.floor(SCREEN_H * 0.5)),
              register: "scrollX",
              bg: 1,
              values: Array.from({ length: 20 }, (_, i) =>
                Math.floor(Math.sin((localFrame + i) * 0.1) * 4))
            });
          }
          break;

        case "volcanic":
          // Rumble shake
          bgScrollX[0] += Math.floor(Math.sin(localFrame * 0.05) * 0.5);
          bgScrollY[0] = Math.floor(Math.sin(localFrame * 0.03) * 1);
          if (spritesEnabled) updateParticles();
          break;

        case "ocean":
          // Wave motion via HDMA
          if (localFrame % 20 === 0) {
            hdmaEffects.push({
              startScanline: Math.floor(SCREEN_H * 0.55),
              register: "scrollX",
              bg: 0,
              values: Array.from({ length: 30 }, (_, i) =>
                Math.floor(Math.sin((localFrame * 0.02 + i * 0.3)) * 3))
            });
          }
          bgScrollY[0] = Math.floor(Math.sin(localFrame * 0.006) * 1);
          break;

        case "void":
          // Slow drift, occasional reality warp
          bgScrollX[0] = Math.floor(Math.sin(localFrame * 0.002) * 8);
          bgScrollY[0] = Math.floor(Math.cos(localFrame * 0.003) * 4);
          break;
      }

      // --- Sky corruption (always active) ---
      glitchIntensity = 0.3 + Math.sin(localFrame * 0.002) * 0.2;

      // Apply sky-appropriate glitches
      if (localFrame % 3 === 0) {
        const skyGlitches = [
          glitchVRAMBitRot,
          glitchPaletteCorrupt,
          glitchBitplaneError,
          glitchScrollOverflow,
        ];
        skyGlitches[glitchRandInt(skyGlitches.length)]();
      }

      // DMA misfire (dramatic tile morphing) — less frequent
      if (localFrame % 25 === 0) {
        glitchDMAMisfire();
      }

      // HDMA chaos in sky
      if (localFrame % 40 === 0) {
        glitchHDMA();
      }

      // --- Ground corruption resistance ---
      // Periodically restore ground tilemap (fight the corruption)
      if (localFrame % 6 === 0) {
        restoreLandscapeGround(0.3);
      }

      // --- Corruption creep (ground slowly yields) ---
      const creepIntensity = Math.min(0.12, localFrame * 0.00004);
      if (glitchRand() < creepIntensity) {
        // Let one ground restoration fail — corruption seeps through
        const base = bgTilemapAddr[0];
        const row = Math.floor(SCREEN_H / 8) - 1 - glitchRandInt(5);
        const col = glitchRandInt(32);
        const addr = base + (row * 32 + col) * 2;
        VRAM[addr] = glitchRandInt(16);
      }

      // --- Raster animation ---
      rasterOffset = Math.floor(Math.sin(localFrame * 0.004) * 3);

      // HDMA cleanup
      if (hdmaEffects.length > 8) {
        hdmaEffects = hdmaEffects.slice(-3);
      }
    }
  };
}

// Register all landscape scenes
const LANDSCAPE_BIOMES = [
  { id: "forest",   name: "CORRUPTED FOREST" },
  { id: "ice",       name: "ICE WASTES" },
  { id: "alien",     name: "ALIEN SURFACE" },
  { id: "volcanic",  name: "VOLCANIC RUINS" },
  { id: "ocean",     name: "DIGITAL OCEAN" },
  { id: "void",      name: "VOID TEMPLE" },
];

for (const biome of LANDSCAPE_BIOMES) {
  const idx = scenes.length;
  scenes.push(createLandscapeScene(biome.id, biome.name));
  landscapeSceneIndices.push(idx);
}

// ============================================================
//  SECTION 7: MENU INTEGRATION
// ============================================================

// Patch getMenuItems to add LANDSCAPE submenu
const _origGetMenuItems = getMenuItems;
getMenuItems = function() {
  const items = _origGetMenuItems();
  // Insert after SCENE (index 0)
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

// Patch getSubmenuItems to handle landscape key
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
