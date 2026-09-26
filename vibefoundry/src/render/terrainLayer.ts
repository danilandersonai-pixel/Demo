import { Container, Sprite, Texture } from 'pixi.js';
import { BIOMES, Deco, isWater } from '../data/biomes';
import { CHUNK, type World } from '../world/world';
import { hash2 } from '../core/rng';
import { HALF_H, HALF_W, TILE_H } from '../core/iso';
import { LAND_DEPTH, WATER_DROP, TILE_VARIANTS, type TextureBank } from './textures';
import { Simplex2 } from '../core/noise';

export interface ChunkView {
  cx: number;
  cy: number;
  ground: Container;
  objects: Container;
  built: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const FOG = 0x1a2433;
const FOG_EDGE = 0x8f98a4;

/** Terrain tiles + decorations per chunk, built lazily and culled by camera. */
export class TerrainLayer {
  ground = new Container();
  objects = new Container();
  overview: Sprite | null = null;
  chunks: ChunkView[] = [];
  world: World;
  tex: TextureBank;
  private overviewCanvas: HTMLCanvasElement | null = null;
  private tintNoise: Simplex2;
  private overviewDirty = true;

  constructor(world: World, tex: TextureBank) {
    this.world = world;
    this.tex = tex;
    this.tintNoise = new Simplex2(world.seed ^ 0x51ed);
    this.ground.label = 'ground';
    this.objects.label = 'objects';
    const cw = world.chunksX;
    const ch = world.chunksY;
    // order chunk containers by diagonal so painter's order holds across chunks
    const order: [number, number][] = [];
    for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) order.push([cx, cy]);
    order.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
    this.chunks = new Array(cw * ch);
    for (const [cx, cy] of order) {
      const g = new Container();
      const o = new Container();
      o.sortableChildren = true;
      g.visible = false;
      o.visible = false;
      this.ground.addChild(g);
      this.objects.addChild(o);
      const tx0 = cx * CHUNK;
      const ty0 = cy * CHUNK;
      const tx1 = tx0 + CHUNK;
      const ty1 = ty0 + CHUNK;
      const view: ChunkView = {
        cx, cy, ground: g, objects: o, built: false,
        x0: (tx0 - ty1) * HALF_W - 8,
        x1: (tx1 - ty0) * HALF_W + 8,
        y0: (tx0 + ty0) * HALF_H - 120,
        y1: (tx1 + ty1) * HALF_H + LAND_DEPTH + 20,
      };
      this.chunks[cy * cw + cx] = view;
    }
  }

  chunkAt(x: number, y: number): ChunkView {
    return this.chunks[Math.floor(y / CHUNK) * this.world.chunksX + Math.floor(x / CHUNK)];
  }

  private buildChunk(v: ChunkView): void {
    v.ground.removeChildren().forEach((c) => c.destroy());
    // keep building sprites (they are owned by EntityLayer), drop only deco
    for (const c of v.objects.children.slice()) {
      if ((c as any).__deco) {
        v.objects.removeChild(c);
        c.destroy();
      }
    }
    const w = this.world;
    const x0 = v.cx * CHUNK;
    const y0 = v.cy * CHUNK;
    // diagonal order inside the chunk
    for (let s = 0; s < CHUNK * 2 - 1; s++) {
      for (let dx = 0; dx < CHUNK; dx++) {
        const dy = s - dx;
        if (dy < 0 || dy >= CHUNK) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x >= w.w || y >= w.h) continue;
        const i = y * w.w + x;
        const b = w.biome[i];
        if (b === 0) continue; // deep sea is the background
        const revealed = w.fog[i] === 1;
        const variant = Math.floor(hash2(x, y, 11) * TILE_VARIANTS);
        const sp = new Sprite(this.tex.tiles[b][variant]);
        sp.anchor.set(0.5, 0);
        sp.x = (x - y) * HALF_W;
        sp.y = (x + y) * HALF_H + (isWater(b) ? WATER_DROP : 0);
        let tint = 0xffffff;
        if (!revealed) tint = FOG;
        else if (this.nearFog(x, y)) tint = FOG_EDGE;
        else if (!isWater(b)) {
          // smooth large-scale patches (meadow light/dark) + gentle height shading
          const n = this.tintNoise.fbm(x / 11, y / 11, 2) * 0.5 + this.tintNoise.noise(x / 3.5 + 50, y / 3.5) * 0.12;
          const f = 0.95 + n * 0.16 + (w.height[i] / 255 - 0.5) * 0.08;
          const r = Math.round(255 * Math.min(1, f));
          const gg = Math.round(255 * Math.min(1, f + n * 0.03));
          const bb = Math.round(255 * Math.min(1, f - 0.02));
          tint = (r << 16) | (gg << 8) | Math.max(0, bb);
        }
        sp.tint = tint;
        v.ground.addChild(sp);
        if (!revealed) continue;
        // ore overlay
        if (w.res[i] && w.amt[i] > 0) {
          const o = new Sprite(this.tex.ore[w.res[i]][Math.floor(hash2(x, y, 5) * 3)]);
          o.anchor.set(0.5, 12 / 44);
          o.x = sp.x;
          o.y = (x + y) * HALF_H;
          if (tint !== 0xffffff) o.tint = tint;
          v.ground.addChild(o);
        }
        const d = w.deco[i];
        if (d !== Deco.None && !w.occ[i]) {
          const arr = this.tex.deco[d];
          if (!arr) continue;
          const ds = new Sprite(arr[Math.floor(hash2(x, y, 17) * arr.length)]);
          ds.anchor.set(0.5, 64 / 72);
          const jx = (hash2(x, y, 23) - 0.5) * 16;
          const jy = (hash2(x, y, 29) - 0.5) * 8;
          ds.x = sp.x + jx;
          ds.y = (x + y) * HALF_H + TILE_H / 2 + jy;
          ds.zIndex = (x + y) * 10 + 5;
          if (tint !== 0xffffff) ds.tint = tint;
          (ds as any).__deco = true;
          v.objects.addChild(ds);
        }
      }
    }
    v.built = true;
  }

  private nearFog(x: number, y: number): boolean {
    const w = this.world;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (w.inBounds(nx, ny) && !w.fog[ny * w.w + nx]) return true;
    }
    return false;
  }

  /** Mark chunks from world.dirtyChunks (and neighbours for fog edges). */
  consumeDirty(): void {
    if (!this.world.dirtyChunks.size) return;
    this.overviewDirty = true;
    const cw = this.world.chunksX;
    for (const c of this.world.dirtyChunks) {
      const cx = c % cw;
      const cy = Math.floor(c / cw);
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const v = this.chunks[(cy + dy) * cw + (cx + dx)];
        if (v && cx + dx >= 0 && cx + dx < cw) v.built = false;
      }
    }
    this.world.dirtyChunks.clear();
  }

  /** Cull & lazily build chunks within the view rectangle (world px at zoom 1). */
  update(vx0: number, vy0: number, vx1: number, vy1: number, lod: boolean): void {
    this.consumeDirty();
    let builds = 0;
    for (const v of this.chunks) {
      const vis = !lod && v.x1 >= vx0 && v.x0 <= vx1 && v.y1 >= vy0 && v.y0 <= vy1;
      if (vis && !v.built && builds < 6) {
        this.buildChunk(v);
        builds++;
      }
      v.ground.visible = vis && v.built;
      v.objects.visible = vis;
    }
    if (this.overview) this.overview.visible = lod;
  }

  /** Low-detail whole-island sprite for far zoom (drawn on a 2D canvas). */
  getOverview(): Sprite {
    if (!this.overviewCanvas) {
      this.overviewCanvas = document.createElement('canvas');
      this.overviewCanvas.width = this.world.w * 4;
      this.overviewCanvas.height = this.world.h * 2;
    }
    if (this.overviewDirty || !this.overview) {
      const w = this.world;
      const cv = this.overviewCanvas;
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      // tile (x,y) → ((x - y) * 2 + W*2, (x + y))
      ctx.setTransform(2, 1, -2, 1, w.h * 2, 0);
      for (let y = 0; y < w.h; y++) {
        for (let x = 0; x < w.w; x++) {
          const i = y * w.w + x;
          const b = w.biome[i];
          if (b === 0) continue;
          let c = BIOMES[b].top[0];
          if (w.res[i] && w.amt[i] > 0) c = 0x9a8a7a;
          if (!w.fog[i]) c = 0x1a2433;
          ctx.fillStyle = '#' + c.toString(16).padStart(6, '0');
          ctx.fillRect(x, y, 1.05, 1.05);
        }
      }
      if (!this.overview) {
        this.overview = new Sprite(Texture.from(cv));
        this.overview.scale.set(HALF_W / 2, HALF_H);
        this.overview.x = -w.h * HALF_W;
        this.overview.y = 0;
      } else this.overview.texture.source.update();
      this.overviewDirty = false;
    }
    return this.overview!;
  }
}
