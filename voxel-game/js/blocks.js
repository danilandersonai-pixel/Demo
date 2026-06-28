// World constants, block ids and per-block definitions (faces -> atlas tiles).

export const CHUNK_SX = 16;
export const CHUNK_SZ = 16;
export const CHUNK_SY = 96;   // world height in blocks
export const SEA_LEVEL = 28;

// Atlas layout: tiles arranged in an ATLAS_COLS x ATLAS_ROWS grid of TILE px each.
export const TILE = 16;
export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 4;

// Tile indices into the atlas (row-major, top-left = 0).
export const TILES = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  COBBLE: 4,
  LOG_TOP: 5,
  LOG_SIDE: 6,
  LEAVES: 7,
  SAND: 8,
  PLANKS: 9,
  WATER: 10,
  GLASS: 11,
  BRICK: 12,
  BEDROCK: 13,
  SNOW: 14,
  GRAVEL: 15,
};

// Block ids.
export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLE: 4,
  LOG: 5,
  PLANKS: 6,
  LEAVES: 7,
  SAND: 8,
  SNOW: 9,
  GLASS: 10,
  BRICK: 11,
  WATER: 12,
  BEDROCK: 13,
  GRAVEL: 14,
};

// Per-block face tiles. Faces order: [px, nx, py, ny, pz, nz]
//   px/nx = +x/-x (east/west), py/ny = top/bottom, pz/nz = +z/-z (south/north).
function uniform(t) { return [t, t, t, t, t, t]; }
function column(side, top, bottom) { return [side, side, top, bottom, side, side]; }

const T = TILES;

// def: { tiles[6], opaque (blocks neighbor faces & light), solid (collision),
//        liquid (translucent pass + non-solid) }
export const BLOCKS = {
  [B.AIR]:     { name: 'Air',          tiles: null,                       opaque: false, solid: false },
  [B.GRASS]:   { name: 'Grass',        tiles: column(T.GRASS_SIDE, T.GRASS_TOP, T.DIRT), opaque: true,  solid: true },
  [B.DIRT]:    { name: 'Dirt',         tiles: uniform(T.DIRT),            opaque: true,  solid: true },
  [B.STONE]:   { name: 'Stone',        tiles: uniform(T.STONE),           opaque: true,  solid: true },
  [B.COBBLE]:  { name: 'Cobblestone',  tiles: uniform(T.COBBLE),          opaque: true,  solid: true },
  [B.LOG]:     { name: 'Wood',         tiles: column(T.LOG_SIDE, T.LOG_TOP, T.LOG_TOP), opaque: true, solid: true },
  [B.PLANKS]:  { name: 'Planks',       tiles: uniform(T.PLANKS),          opaque: true,  solid: true },
  [B.LEAVES]:  { name: 'Leaves',       tiles: uniform(T.LEAVES),          opaque: true,  solid: true },
  [B.SAND]:    { name: 'Sand',         tiles: uniform(T.SAND),            opaque: true,  solid: true },
  [B.SNOW]:    { name: 'Snow',         tiles: uniform(T.SNOW),            opaque: true,  solid: true },
  [B.GLASS]:   { name: 'Glass',        tiles: uniform(T.GLASS),           opaque: false, solid: true, translucent: true },
  [B.BRICK]:   { name: 'Brick',        tiles: uniform(T.BRICK),           opaque: true,  solid: true },
  [B.WATER]:   { name: 'Water',        tiles: uniform(T.WATER),           opaque: false, solid: false, liquid: true },
  [B.BEDROCK]: { name: 'Bedrock',      tiles: uniform(T.BEDROCK),         opaque: true,  solid: true },
  [B.GRAVEL]:  { name: 'Gravel',       tiles: uniform(T.GRAVEL),          opaque: true,  solid: true },
};

export function isOpaque(id) { const b = BLOCKS[id]; return !!(b && b.opaque); }
export function isSolid(id) { const b = BLOCKS[id]; return !!(b && b.solid); }
export function isLiquid(id) { const b = BLOCKS[id]; return !!(b && b.liquid); }
export function isTranslucent(id) { const b = BLOCKS[id]; return !!(b && b.translucent); }

// Blocks available on the hotbar, in slot order.
export const HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.LOG, B.LEAVES, B.SAND, B.GLASS];
