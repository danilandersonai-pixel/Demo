// Chunked voxel world: deterministic terrain generation, trees, edits.

import { CHUNK_SX, CHUNK_SY, CHUNK_SZ, SEA_LEVEL, B } from './blocks.js';
import { Noise, hash2 } from './noise.js';

const AREA = CHUNK_SX * CHUNK_SZ;
const VOL = AREA * CHUNK_SY;

export function blockIndex(lx, y, lz) { return y * AREA + lz * CHUNK_SX + lx; }
export function chunkKey(cx, cz) { return cx + ',' + cz; }

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(VOL); // all AIR (0)
    this.generated = false;
    this.dirty = true;     // needs (re)mesh
    this.glOpaque = null;  // { buffer, count } set by renderer
    this.glWater = null;
  }
}

export class World {
  constructor(seed = 1337) {
    this.seed = seed >>> 0;
    this.noise = new Noise(this.seed);
    this.biome = new Noise((this.seed ^ 0x9e3779b9) >>> 0);
    this.chunks = new Map();
  }

  getChunk(cx, cz) { return this.chunks.get(chunkKey(cx, cz)); }

  terrainHeight(gx, gz) {
    const base = this.noise.fbm(gx * 0.012, gz * 0.012, 4, 2, 0.5);   // hills
    const detail = this.noise.fbm(gx * 0.05, gz * 0.05, 3, 2, 0.5);   // bumps
    let h = SEA_LEVEL + 5 + base * 20 + detail * 5;
    const m = this.noise.fbm(gx * 0.0045 + 100, gz * 0.0045 - 100, 3, 2, 0.5);
    if (m > 0.35) h += (m - 0.35) * 80; // occasional mountains
    h = Math.floor(h);
    if (h < 2) h = 2;
    if (h > CHUNK_SY - 14) h = CHUNK_SY - 14;
    return h;
  }

  treeAt(gx, gz) {
    // Sparse, deterministic. Keep trees off the immediate beach.
    return hash2(gx, gz, 4242) < 0.018;
  }

  // Generate terrain + decorations for a chunk (idempotent).
  generate(cx, cz) {
    let c = this.getChunk(cx, cz);
    if (c && c.generated) return c;
    if (!c) { c = new Chunk(cx, cz); this.chunks.set(chunkKey(cx, cz), c); }

    const blocks = c.blocks;
    const baseX = cx * CHUNK_SX;
    const baseZ = cz * CHUNK_SZ;

    for (let x = 0; x < CHUNK_SX; x++) {
      for (let z = 0; z < CHUNK_SZ; z++) {
        const gx = baseX + x, gz = baseZ + z;
        const h = this.terrainHeight(gx, gz);
        const temp = this.biome.fbm(gx * 0.01, gz * 0.01, 3, 2, 0.5);

        const beach = h <= SEA_LEVEL + 1;
        const cold = h > SEA_LEVEL + 32 || temp < -0.42;
        const surface = beach ? B.SAND : (cold ? B.SNOW : B.GRASS);
        const subsurface = beach ? B.SAND : B.DIRT;

        const top = Math.max(h, SEA_LEVEL);
        for (let y = 0; y <= top; y++) {
          let b;
          if (y === 0) b = B.BEDROCK;
          else if (y > h) b = (y <= SEA_LEVEL) ? B.WATER : B.AIR;
          else if (y === h) b = surface;
          else if (y > h - 4) b = subsurface;
          else b = B.STONE;
          blocks[blockIndex(x, y, z)] = b;
        }
      }
    }

    this._decorate(c);
    c.generated = true;
    c.dirty = true;

    // Existing neighbours (incl. diagonals, for corner ambient occlusion) must
    // remesh so shared borders/corners are seamless.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const n = this.getChunk(cx + dx, cz + dz);
      if (n && n.generated) n.dirty = true;
    }
    return c;
  }

  _decorate(chunk) {
    const R = 2; // leaf radius scanned beyond chunk edges
    const baseX = chunk.cx * CHUNK_SX;
    const baseZ = chunk.cz * CHUNK_SZ;
    for (let ox = -R; ox < CHUNK_SX + R; ox++) {
      for (let oz = -R; oz < CHUNK_SZ + R; oz++) {
        const gx = baseX + ox, gz = baseZ + oz;
        if (!this.treeAt(gx, gz)) continue;
        const h = this.terrainHeight(gx, gz);
        if (h <= SEA_LEVEL + 1) continue; // no trees on the beach/in water
        const temp = this.biome.fbm(gx * 0.01, gz * 0.01, 3, 2, 0.5);
        if (h > SEA_LEVEL + 32 || temp < -0.42) continue; // not on snowy peaks
        const th = 4 + Math.floor(hash2(gx, gz, 7) * 3); // trunk 4..6
        const topY = h + th;

        // Trunk (overwrites).
        for (let t = 1; t <= th; t++) this._stamp(chunk, gx, h + t, gz, B.LOG, true);

        // Leaf canopy (only into air).
        for (let ly = topY - 2; ly <= topY + 1; ly++) {
          const rad = ly >= topY ? 1 : 2;
          for (let lx = -rad; lx <= rad; lx++) {
            for (let lz = -rad; lz <= rad; lz++) {
              if (Math.abs(lx) === rad && Math.abs(lz) === rad && hash2(gx + lx, gz + lz + ly, 9) < 0.5) continue;
              this._stamp(chunk, gx + lx, ly, gz + lz, B.LEAVES, false);
            }
          }
        }
      }
    }
  }

  _stamp(chunk, gx, gy, gz, block, overwrite) {
    const lx = gx - chunk.cx * CHUNK_SX;
    const lz = gz - chunk.cz * CHUNK_SZ;
    if (lx < 0 || lx >= CHUNK_SX || lz < 0 || lz >= CHUNK_SZ) return;
    if (gy < 0 || gy >= CHUNK_SY) return;
    const i = blockIndex(lx, gy, lz);
    if (!overwrite && chunk.blocks[i] !== B.AIR) return;
    chunk.blocks[i] = block;
  }

  getBlock(gx, gy, gz) {
    if (gy < 0 || gy >= CHUNK_SY) return B.AIR;
    const cx = Math.floor(gx / CHUNK_SX);
    const cz = Math.floor(gz / CHUNK_SZ);
    const c = this.getChunk(cx, cz);
    if (!c || !c.generated) return B.AIR;
    return c.blocks[blockIndex(gx - cx * CHUNK_SX, gy, gz - cz * CHUNK_SZ)];
  }

  setBlock(gx, gy, gz, id) {
    if (gy < 0 || gy >= CHUNK_SY) return false;
    const cx = Math.floor(gx / CHUNK_SX);
    const cz = Math.floor(gz / CHUNK_SZ);
    const c = this.generate(cx, cz);
    const lx = gx - cx * CHUNK_SX;
    const lz = gz - cz * CHUNK_SZ;
    const i = blockIndex(lx, gy, lz);
    if (c.blocks[i] === id) return false;
    c.blocks[i] = id;
    c.dirty = true;
    // Remesh neighbour chunks if the edit sits on a shared border (edges + corners
    // so corner ambient occlusion across chunk boundaries stays correct).
    if (lx === 0) this._touch(cx - 1, cz);
    if (lx === CHUNK_SX - 1) this._touch(cx + 1, cz);
    if (lz === 0) this._touch(cx, cz - 1);
    if (lz === CHUNK_SZ - 1) this._touch(cx, cz + 1);
    if (lx === 0 && lz === 0) this._touch(cx - 1, cz - 1);
    if (lx === 0 && lz === CHUNK_SZ - 1) this._touch(cx - 1, cz + 1);
    if (lx === CHUNK_SX - 1 && lz === 0) this._touch(cx + 1, cz - 1);
    if (lx === CHUNK_SX - 1 && lz === CHUNK_SZ - 1) this._touch(cx + 1, cz + 1);
    return true;
  }

  _touch(cx, cz) {
    const n = this.getChunk(cx, cz);
    if (n && n.generated) n.dirty = true;
  }

  // Highest non-air block at a column, for spawning.
  surfaceY(gx, gz) {
    const cx = Math.floor(gx / CHUNK_SX);
    const cz = Math.floor(gz / CHUNK_SZ);
    this.generate(cx, cz);
    for (let y = CHUNK_SY - 1; y >= 0; y--) {
      const b = this.getBlock(gx, y, gz);
      if (b !== B.AIR && b !== B.WATER) return y;
    }
    return SEA_LEVEL;
  }
}
