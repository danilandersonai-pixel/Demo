import { isWater } from '../data/biomes';
import { RES_BY_CODE, type ResourceId } from '../data/items';

export const CHUNK = 32;

export type PoiKind = 'ruins' | 'drone' | 'cache' | 'anomaly';

export interface Poi {
  id: number;
  x: number;
  y: number;
  kind: PoiKind;
  explored: boolean;
  /** Drone id currently on expedition here. */
  claimedBy?: number;
}

export interface Deposit {
  res: ResourceId;
  x: number;
  y: number;
  /** Total amount at generation (for labels). */
  total: number;
}

export interface WorldData {
  w: number;
  h: number;
  seed: number;
  biome: Uint8Array;
  height: Uint8Array;
  res: Uint8Array;
  amt: Float32Array;
  deco: Uint8Array;
  fog: Uint8Array;
  pois: Poi[];
  deposits: Deposit[];
  base: { x: number; y: number };
  nests: { x: number; y: number }[];
}

/** Tile grid of the island. Entities live in Sim; `occ` maps tiles to entity ids. */
export class World {
  w: number;
  h: number;
  seed: number;
  biome: Uint8Array;
  height: Uint8Array;
  res: Uint8Array;
  amt: Float32Array;
  deco: Uint8Array;
  fog: Uint8Array;
  occ: Int32Array;
  pois: Poi[];
  deposits: Deposit[];
  base: { x: number; y: number };
  nests: { x: number; y: number }[];
  /** Chunks whose fog/deco/resources changed since the renderer last looked. */
  dirtyChunks = new Set<number>();
  revealedCount = 0;

  constructor(d: WorldData) {
    this.w = d.w;
    this.h = d.h;
    this.seed = d.seed;
    this.biome = d.biome;
    this.height = d.height;
    this.res = d.res;
    this.amt = d.amt;
    this.deco = d.deco;
    this.fog = d.fog;
    this.pois = d.pois;
    this.deposits = d.deposits;
    this.base = d.base;
    this.nests = d.nests;
    this.occ = new Int32Array(d.w * d.h);
    for (let i = 0; i < this.fog.length; i++) if (this.fog[i]) this.revealedCount++;
  }

  get chunksX(): number {
    return Math.ceil(this.w / CHUNK);
  }
  get chunksY(): number {
    return Math.ceil(this.h / CHUNK);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  idx(x: number, y: number): number {
    return y * this.w + x;
  }
  isWaterAt(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return isWater(this.biome[this.idx(x, y)]);
  }
  resourceAt(x: number, y: number): ResourceId | null {
    if (!this.inBounds(x, y)) return null;
    const i = this.idx(x, y);
    if (this.amt[i] <= 0) return null;
    return RES_BY_CODE[this.res[i]];
  }
  chunkOf(x: number, y: number): number {
    return Math.floor(y / CHUNK) * this.chunksX + Math.floor(x / CHUNK);
  }
  markDirty(x: number, y: number): void {
    this.dirtyChunks.add(this.chunkOf(x, y));
  }

  /** Reveal fog in a circle. Returns number of newly revealed tiles. */
  reveal(cx: number, cy: number, r: number): number {
    let n = 0;
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * this.w + x;
        if (!this.fog[i]) {
          this.fog[i] = 1;
          n++;
          this.dirtyChunks.add(this.chunkOf(x, y));
        }
      }
    }
    this.revealedCount += n;
    return n;
  }

  isRevealed(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.fog[this.idx(x, y)] === 1;
  }

  toData(): WorldData {
    return {
      w: this.w, h: this.h, seed: this.seed, biome: this.biome, height: this.height, res: this.res, amt: this.amt,
      deco: this.deco, fog: this.fog, pois: this.pois, deposits: this.deposits, base: this.base, nests: this.nests,
    };
  }
}
