// Procedurally generates a block texture atlas on a 2D canvas (no image files).

import { TILE, ATLAS_COLS, ATLAS_ROWS, TILES } from './blocks.js';

function prng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x9E3779B9) | 0;
    let t = Math.imul(a ^ (a >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

// Returns the {u0,v0,u1,v1} rect for a tile index (no Y flip on upload).
export function tileUV(tile) {
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  return {
    u0: col / ATLAS_COLS,
    v0: row / ATLAS_ROWS,
    u1: (col + 1) / ATLAS_COLS,
    v1: (row + 1) / ATLAS_ROWS,
  };
}

// Draw one TILE x TILE block face. `shade(x,y,rng)` returns [r,g,b].
function paint(img, atlasW, tile, shade, rng) {
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  const ox = col * TILE;
  const oy = row * TILE;
  const data = img.data;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const rgb = shade(x, y, rng);
      const idx = ((oy + y) * atlasW + (ox + x)) * 4;
      data[idx] = clamp8(rgb[0]);
      data[idx + 1] = clamp8(rgb[1]);
      data[idx + 2] = clamp8(rgb[2]);
      data[idx + 3] = 255;
    }
  }
}

function vary(base, rng, amt) {
  const n = (rng() - 0.5) * 2 * amt;
  return [base[0] + n, base[1] + n, base[2] + n];
}

export function buildAtlas() {
  const w = ATLAS_COLS * TILE;
  const h = ATLAS_ROWS * TILE;
  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const rng = prng(0xC0FFEE);

  const T = TILES;

  paint(img, w, T.GRASS_TOP, (x, y) => vary([86, 156, 70], rng, 22), rng);

  paint(img, w, T.GRASS_SIDE, (x, y) => {
    const lip = 3 + ((x * 7 + 3) % 3 === 0 ? 1 : 0); // jagged grass lip
    if (y < lip) return vary([86, 156, 70], rng, 20);
    return vary([134, 96, 62], rng, 16);
  }, rng);

  paint(img, w, T.DIRT, () => vary([134, 96, 62], rng, 20), rng);

  paint(img, w, T.STONE, () => vary([128, 128, 132], rng, 16), rng);

  paint(img, w, T.COBBLE, (x, y) => {
    const cx = x % 8, cy = y % 8;
    const edge = (cx === 0 || cy === 0 || cx === 7 || cy === 7);
    const base = edge ? [78, 78, 82] : [128, 128, 132];
    return vary(base, rng, 22);
  }, rng);

  paint(img, w, T.LOG_TOP, (x, y) => {
    const dx = x - 7.5, dy = y - 7.5;
    const r = Math.sqrt(dx * dx + dy * dy);
    const ring = Math.sin(r * 1.7) * 14;
    return [120 + ring, 86 + ring, 52 + ring];
  }, rng);

  paint(img, w, T.LOG_SIDE, (x, y) => {
    const bark = ((x % 4) === 0) ? -20 : 0;
    return vary([120 + bark, 86 + bark, 52 + bark], rng, 12);
  }, rng);

  paint(img, w, T.LEAVES, (x, y) => {
    const hole = rng() < 0.16 ? -34 : 0;
    return vary([54, 120, 48 + hole], rng, 26);
  }, rng);

  paint(img, w, T.SAND, () => vary([220, 206, 152], rng, 16), rng);

  paint(img, w, T.PLANKS, (x, y) => {
    const plank = (y % 5 === 0) ? -28 : 0;          // groove between planks
    const nail = (x % 7 === 1 && (y % 5 === 1)) ? -18 : 0;
    return vary([178, 138, 86 + plank + nail], rng, 12);
  }, rng);

  paint(img, w, T.WATER, () => vary([54, 104, 196], rng, 14), rng);

  paint(img, w, T.GLASS, (x, y) => {
    const frame = (x === 0 || y === 0 || x === 15 || y === 15) ? -60 : 0;
    return vary([176, 220, 230 + frame], rng, 8);
  }, rng);

  paint(img, w, T.BRICK, (x, y) => {
    const rowOff = (Math.floor(y / 4) % 2) * 4;
    const mortar = (y % 4 === 0) || ((x + rowOff) % 8 === 0);
    return mortar ? vary([186, 186, 182], rng, 8) : vary([164, 74, 58], rng, 16);
  }, rng);

  paint(img, w, T.BEDROCK, () => vary([60, 60, 64], rng, 34), rng);

  paint(img, w, T.SNOW, () => vary([236, 240, 248], rng, 10), rng);

  paint(img, w, T.GRAVEL, () => vary([122, 112, 104], rng, 30), rng);

  ctx.putImageData(img, 0, 0);
  return canvas;
}
