import { Container, Graphics, Rectangle, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
import { BIOMES, Biome, Deco } from '../data/biomes';
import { BUILDING_LIST, type BuildingType } from '../data/buildings';
import { ITEM_LIST } from '../data/items';
import { Rng } from '../core/rng';
import { P, poly, box, boxColors, cyl, glow, shade, mix, PAL } from './art';
import { drawBuilding } from './buildingArt';
import type { DroneKind } from '../sim/types';

export const LAND_DEPTH = 12;
export const WATER_DROP = 7;
export const TILE_VARIANTS = 6;

export interface BuildingTex {
  base: Texture;
  lights: Texture;
  ax: number;
  ay: number;
}

/** Local frame of a belt tile: u along flow (0..1), v across (0 = left of flow). */
export function beltLocalToTile(dir: number, u: number, v: number): [number, number] {
  switch (dir) {
    case 1: return [u, v];
    case 2: return [1 - v, u];
    case 3: return [1 - u, 1 - v];
    default: return [v, 1 - u];
  }
}

/** Path of an item across a belt tile (s ∈ 0..1) in local (u, v). curve: 0 straight, -1 from left, 1 from right. */
export function beltPath(curve: number, s: number): [number, number] {
  if (curve === 0) return [s, 0.5];
  const v0 = curve < 0 ? 0 : 1;
  // quadratic bezier: (0.5, v0) → (0.5, 0.5) → (1, 0.5)
  const a = (1 - s) * (1 - s);
  const b = 2 * (1 - s) * s;
  const c = s * s;
  return [a * 0.5 + b * 0.5 + c * 1, a * v0 + b * 0.5 + c * 0.5];
}

export class TextureBank {
  renderer: Renderer;
  tiles: Texture[][] = [];
  deco: Texture[][] = [];
  ore: Texture[][] = [];
  buildings = new Map<BuildingType, BuildingTex>();
  belts: Texture[][][] = []; // [shape][dir][frame]
  underground: Texture[][] = []; // [in/out][dir]
  splitter: Texture[] = [];
  pipes: Texture[] = [];
  items: Texture[] = [];
  drones = new Map<DroneKind, Texture>();
  enemy!: Texture;
  shadow!: Texture;
  smoke!: Texture;
  spark!: Texture;
  glowTex!: Texture;
  poi!: Texture;
  nest!: Texture;
  inserterBase!: Texture;
  hand!: Texture;
  fogCloud!: Texture;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  private gen(g: Container, frame: Rectangle, resolution = 2): Texture {
    const t = this.renderer.generateTexture({ target: g, frame, resolution, antialias: true });
    g.destroy({ children: true });
    return t;
  }

  buildAll(): void {
    this.buildTiles();
    this.buildDeco();
    this.buildOre();
    this.buildBuildings();
    this.buildBelts();
    this.buildPipes();
    this.buildItems();
    this.buildUnits();
    this.buildFx();
    // Textures swapped every frame (belt animation, pooled item sprites) must share one source,
    // otherwise Pixi rebuilds batches for the whole layer on every swap.
    const belts = this.belts.flat(2);
    const items = this.items.slice(1);
    const packed = this.pack([...belts, ...items]);
    let k = 0;
    for (const shape of this.belts) for (const dir of shape) for (let f = 0; f < dir.length; f++) dir[f] = packed[k++];
    for (let i = 1; i < this.items.length; i++) this.items[i] = packed[k++];
  }

  /** Pack textures into one RenderTexture atlas and return sub-textures in the same order. */
  private pack(list: Texture[]): Texture[] {
    const pad = 2;
    const maxW = 2048;
    let x = 0;
    let y = 0;
    let rowH = 0;
    const places: { x: number; y: number }[] = [];
    for (const t of list) {
      if (x + t.width + pad > maxW) {
        x = 0;
        y += rowH + pad;
        rowH = 0;
      }
      places.push({ x, y });
      x += t.width + pad;
      rowH = Math.max(rowH, t.height);
    }
    const H = y + rowH + pad;
    const rt = RenderTexture.create({ width: maxW, height: Math.ceil(H), resolution: 2, antialias: true });
    const c = new Container();
    list.forEach((t, i) => {
      const sp = new Sprite(t);
      sp.x = places[i].x;
      sp.y = places[i].y;
      c.addChild(sp);
    });
    this.renderer.render({ container: c, target: rt, clear: true });
    c.destroy({ children: true });
    return list.map((t, i) => {
      const nt = new Texture({ source: rt.source, frame: new Rectangle(places[i].x, places[i].y, t.width, t.height) });
      t.destroy(true);
      return nt;
    });
  }

  // ------------------------------------------------------------- terrain
  private buildTiles(): void {
    const rng = new Rng(99);
    for (const b of BIOMES) {
      const arr: Texture[] = [];
      for (let v = 0; v < TILE_VARIANTS; v++) {
        const g = new Graphics();
        // variants differ only slightly; large-scale colour variation comes from a smooth tint field
        const top = mix(b.top[0], b.top[v % 3], 0.35);
        if (b.water) {
          poly(g, [P(0, 0), P(1, 0), P(1, 1), P(0, 1)], top);
          for (let k = 0; k < 3; k++) {
            const x = rng.range(-14, 14);
            const y = rng.range(8, 24);
            g.moveTo(x - 5, y).lineTo(x + 5, y).stroke({ color: shade(top, 0.18), width: 1, alpha: 0.35 });
          }
          arr.push(this.gen(g, new Rectangle(-32, 0, 64, 32), 1));
          continue;
        }
        // side faces (the "cube" edge)
        const side = b.side;
        poly(g, [P(0, 1), P(1, 1), P(1, 1, -LAND_DEPTH), P(0, 1, -LAND_DEPTH)], shade(side, 0.05));
        poly(g, [P(1, 0), P(1, 1), P(1, 1, -LAND_DEPTH), P(1, 0, -LAND_DEPTH)], shade(side, -0.25));
        // grass lip on sides
        if (b.id !== Biome.Desert && b.id !== Biome.Beach && b.id !== Biome.Snow && b.id !== Biome.Volcanic) {
          poly(g, [P(0, 1), P(1, 1), P(1, 1, -3), P(0, 1, -3)], shade(top, -0.15));
          poly(g, [P(1, 0), P(1, 1), P(1, 1, -3), P(1, 0, -3)], shade(top, -0.3));
        }
        poly(g, [P(0, 0), P(1, 0), P(1, 1), P(0, 1)], top);
        // texture speckles in tile space
        const n = b.id === Biome.Forest ? 26 : b.id === Biome.Desert || b.id === Biome.Beach ? 14 : 20;
        for (let k = 0; k < n; k++) {
          const u = rng.range(0.06, 0.94);
          const w = rng.range(0.06, 0.94);
          const [x, y] = P(u, w);
          const light = rng.next() < 0.5;
          let c = shade(top, light ? rng.range(0.06, 0.16) : -rng.range(0.08, 0.2));
          if (b.id === Biome.Meadow && rng.next() < 0.12) c = [0xe8d86a, 0xe8eef2, 0xd88ab8][rng.int(0, 2)];
          if (b.id === Biome.Volcanic && rng.next() < 0.25) c = rng.next() < 0.5 ? 0xf07a2a : 0xed5347;
          if (b.id === Biome.Crystal && rng.next() < 0.3) c = 0xa7abf0;
          const r = rng.range(0.8, 1.8);
          g.ellipse(x, y, r * 1.6, r * 0.8).fill({ color: c, alpha: 0.8 });
        }
        if (b.id === Biome.Desert) {
          for (let k = 0; k < 3; k++) {
            const w = rng.range(0.2, 0.8);
            const [x0, y0] = P(0.15, w);
            const [x1, y1] = P(0.85, w + 0.05);
            g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: shade(top, 0.12), width: 1, alpha: 0.5 });
          }
        }
        if (b.id === Biome.Volcanic) {
          const [x0, y0] = P(rng.range(0.1, 0.4), rng.range(0.1, 0.9));
          const [x1, y1] = P(rng.range(0.6, 0.9), rng.range(0.1, 0.9));
          g.moveTo(x0, y0).lineTo((x0 + x1) / 2 + 3, (y0 + y1) / 2 - 2).lineTo(x1, y1).stroke({ color: 0xf07a2a, width: 1.2, alpha: 0.9 });
        }
        arr.push(this.gen(g, new Rectangle(-32, 0, 64, 32 + LAND_DEPTH), 1));
      }
      this.tiles[b.id] = arr;
    }
    // fog cloud puff
    const g = new Graphics();
    for (let i = 0; i < 6; i++) g.circle(0, 0, 30 - i * 4).fill({ color: 0xffffff, alpha: 0.08 });
    this.fogCloud = this.gen(g, new Rectangle(-32, -32, 64, 64), 1);
  }

  private buildDeco(): void {
    const rng = new Rng(7);
    const make = (fn: (g: Graphics, v: number) => void, variants = 3, h = 64): Texture[] => {
      const out: Texture[] = [];
      for (let v = 0; v < variants; v++) {
        const g = new Graphics();
        fn(g, v);
        out.push(this.gen(g, new Rectangle(-24, -h, 48, h + 8), 2));
      }
      return out;
    };
    const pine = (g: Graphics, v: number, snow = false, tall = 1) => {
      const hgt = (30 + v * 6) * tall;
      g.ellipse(4, 2, 12, 5).fill({ color: 0x000000, alpha: 0.25 });
      g.rect(-1.5, -6, 3, 8).fill(0x4a3422);
      const base = snow ? 0x2f4a3a : [0x1f4a22, 0x24552a, 0x1b401e][v % 3];
      for (let k = 0; k < 3; k++) {
        const y = -6 - k * hgt * 0.26;
        const w = 12 - k * 3;
        g.poly([-w, y, 0, y - hgt * 0.5, w, y]).fill(shade(base, k * 0.06));
        g.poly([0, y, 0, y - hgt * 0.5, w, y]).fill(shade(base, -0.25 + k * 0.05));
        if (snow) g.poly([-w * 0.5, y - hgt * 0.22, 0, y - hgt * 0.5, w * 0.4, y - hgt * 0.24]).fill(0xdfe8ee);
      }
      void rng;
    };
    this.deco[Deco.Pine] = make((g, v) => pine(g, v));
    this.deco[Deco.Pine2] = make((g, v) => pine(g, v, false, 1.35));
    this.deco[Deco.SnowPine] = make((g, v) => pine(g, v, true));
    this.deco[Deco.Oak] = make((g, v) => {
      g.ellipse(4, 2, 14, 6).fill({ color: 0x000000, alpha: 0.25 });
      g.rect(-2, -12, 4, 14).fill(0x5a4028);
      const c = [0x3a6a24, 0x467a2a, 0x2f5a20][v];
      g.circle(-6, -18, 9).fill(c);
      g.circle(6, -19, 9).fill(shade(c, -0.15));
      g.circle(0, -26, 10).fill(shade(c, 0.08));
      g.circle(-3, -29, 4).fill({ color: 0xffffff, alpha: 0.1 });
    });
    this.deco[Deco.Bush] = make((g, v) => {
      const c = [0x4a6a28, 0x55702c, 0x3e5a22][v];
      g.ellipse(-3, -4, 7, 5).fill(c);
      g.ellipse(4, -3, 6, 4).fill(shade(c, -0.15));
    });
    this.deco[Deco.Rock] = make((g, v) => {
      const c = [0x7a7874, 0x6a6864, 0x86827a][v];
      g.poly([-8, 0, -6, -7, 1, -10, 7, -6, 8, 0]).fill(c);
      g.poly([1, -10, 7, -6, 8, 0, 2, 0]).fill(shade(c, -0.25));
    });
    this.deco[Deco.Boulder] = make((g, v) => {
      const c = [0x6e6c68, 0x7e7c78, 0x5e5c58][v];
      const snow = v === 1;
      g.poly([-18, 2, -14, -14, -4, -30, 8, -22, 16, -8, 18, 2]).fill(c);
      g.poly([-4, -30, 8, -22, 16, -8, 18, 2, 4, 2]).fill(shade(c, -0.28));
      if (snow) g.poly([-10, -18, -4, -30, 8, -22, 2, -18]).fill(0xdfe8ee);
    });
    this.deco[Deco.Crystal] = make((g, v) => {
      const c = [0x9096db, 0xb0a8ff, 0x7a70c8][v];
      g.ellipse(0, 0, 10, 4).fill({ color: 0x000000, alpha: 0.2 });
      g.poly([-6, 0, -4, -18, 0, -24, 2, 0]).fill(c);
      g.poly([2, 0, 0, -24, 4, -16, 6, 0]).fill(shade(c, -0.3));
      g.poly([4, 0, 8, -12, 10, 0]).fill(shade(c, 0.2));
    });
    this.deco[Deco.Reed] = make((g, v) => {
      for (let k = 0; k < 5; k++) g.moveTo(-6 + k * 3, 0).lineTo(-7 + k * 3 + v, -10 - (k % 3) * 3).stroke({ color: 0x6a7a3a, width: 1.2 });
    });
    this.deco[Deco.Cactus] = make((g) => {
      g.rect(-2.5, -18, 5, 18).fill(0x4a7a3a);
      g.rect(-8, -12, 5, 3).fill(0x4a7a3a);
      g.rect(-8, -16, 3, 6).fill(0x4a7a3a);
    });
    this.deco[Deco.Lava] = make((g, v) => {
      g.ellipse(0, -2, 12 + v * 2, 5).fill(0x2a120e);
      g.ellipse(0, -2, 9 + v * 2, 3.5).fill(0xf07a2a);
      g.ellipse(-2, -2.5, 4, 1.5).fill(0xffd070);
    });
  }

  private buildOre(): void {
    const rng = new Rng(3);
    const colors: Record<number, [number, number]> = {
      1: [0x8f949c, 0x5a6068], // iron
      2: [0xd37c4f, 0x8c4a2a], // copper
      3: [0xdfe6f2, 0x9aa6bb], // silicon
      4: [0x9a9080, 0x6a6258], // stone
      5: [0xa7abf0, 0x6a60c0], // rare earth
      6: [0xc6ee5a, 0x6a9a2a], // uranium
      7: [0x10161e, 0x2a3440], // oil
    };
    for (let code = 1; code <= 7; code++) {
      const arr: Texture[] = [];
      for (let v = 0; v < 3; v++) {
        const g = new Graphics();
        const [c, d] = colors[code];
        if (code === 7) {
          g.ellipse(0, 16, 20, 9).fill({ color: c, alpha: 0.9 });
          g.ellipse(-4, 14, 8, 3).fill({ color: 0x4a6a8a, alpha: 0.5 });
          g.ellipse(5, 18, 5, 2).fill({ color: 0x8a5ab0, alpha: 0.35 });
        } else {
          for (let k = 0; k < 4 + v; k++) {
            const [x, y] = P(rng.range(0.15, 0.85), rng.range(0.15, 0.85));
            const s = rng.range(3, 6);
            if (code === 3 || code === 5 || code === 6) {
              g.poly([x - s * 0.6, y, x - s * 0.2, y - s * 1.6, x + s * 0.3, y - s * 1.1, x + s * 0.6, y]).fill(c);
              g.poly([x - s * 0.2, y - s * 1.6, x + s * 0.3, y - s * 1.1, x + s * 0.6, y, x, y]).fill(d);
            } else {
              g.poly([x - s, y, x - s * 0.6, y - s * 0.9, x + s * 0.3, y - s, x + s, y - s * 0.3, x + s * 0.8, y]).fill(c);
              g.poly([x + s * 0.3, y - s, x + s, y - s * 0.3, x + s * 0.8, y, x, y]).fill(d);
            }
          }
        }
        arr.push(this.gen(g, new Rectangle(-32, -12, 64, 44), 2));
      }
      this.ore[code] = arr;
    }
  }

  // ------------------------------------------------------------ buildings
  private buildBuildings(): void {
    for (const def of BUILDING_LIST) {
      if (['belt', 'underground', 'splitter', 'pipe', 'inserter'].includes(def.id)) continue;
      const g = new Graphics();
      const L = new Graphics();
      const maxZ = drawBuilding(def.id, def.w, def.h, g, L);
      const fx = -def.h * 32 - 8;
      const fy = -maxZ - 12;
      const fw = (def.w + def.h) * 32 + 16;
      const fh = (def.w + def.h) * 16 + maxZ + 20;
      const frame = new Rectangle(fx, fy, fw, fh);
      const base = this.gen(g, frame, 2);
      const lights = this.gen(L, frame, 1);
      this.buildings.set(def.id, { base, lights, ax: -fx / fw, ay: -fy / fh });
    }
    // inserter base & hand
    {
      const g = new Graphics();
      const [x, y] = P(0.5, 0.5, 0);
      g.ellipse(x, y, 9, 4.5).fill(0x2a3440);
      cyl(g, 0.5, 0.5, 6, 0, 7, 0x4a5560);
      this.inserterBase = this.gen(g, new Rectangle(-32, 0, 64, 40), 2);
      const h = new Graphics();
      h.rect(-4, -3, 8, 6).fill(PAL.hazard);
      h.rect(-5, 2, 3, 4).fill(0x3a4046);
      h.rect(2, 2, 3, 4).fill(0x3a4046);
      this.hand = this.gen(h, new Rectangle(-8, -6, 16, 14), 2);
    }
  }

  // ---------------------------------------------------------------- belts
  private buildBelts(): void {
    const FRAMES = 8;
    for (let shape = 0; shape < 3; shape++) {
      const curve = shape === 0 ? 0 : shape === 1 ? -1 : 1;
      this.belts[shape] = [];
      for (let dir = 0; dir < 4; dir++) {
        this.belts[shape][dir] = [];
        for (let f = 0; f < FRAMES; f++) {
          const g = new Graphics();
          this.drawBeltBand(g, dir, curve, f / FRAMES);
          this.belts[shape][dir].push(this.gen(g, new Rectangle(-32, -4, 64, 40), 2));
        }
      }
    }
    for (let io = 0; io < 2; io++) {
      this.underground[io] = [];
      for (let dir = 0; dir < 4; dir++) {
        const g = new Graphics();
        this.drawBeltBand(g, dir, 0, 0, io === 0 ? [0, 0.55] : [0.45, 1]);
        const [hu0, hu1] = io === 0 ? [0.45, 0.95] : [0.05, 0.55];
        // hood
        const q = (u: number, v: number, z: number) => {
          const [tx, ty] = beltLocalToTile(dir, u, v);
          return P(tx, ty, z);
        };
        poly(g, [q(hu0, 0.12, 14), q(hu1, 0.12, 14), q(hu1, 0.88, 14), q(hu0, 0.88, 14)], 0x4a5560);
        poly(g, [q(hu0, 0.88, 14), q(hu1, 0.88, 14), q(hu1, 0.88, 0), q(hu0, 0.88, 0)], 0x2a3440);
        poly(g, [q(hu0, 0.12, 14), q(hu0, 0.88, 14), q(hu0, 0.88, 0), q(hu0, 0.12, 0)], 0x1a222d);
        poly(g, [q(hu1, 0.12, 14), q(hu1, 0.88, 14), q(hu1, 0.88, 0), q(hu1, 0.12, 0)], 0x1a222d);
        this.underground[io].push(this.gen(g, new Rectangle(-32, -20, 64, 56), 2));
      }
    }
    for (let dir = 0; dir < 4; dir++) {
      const g = new Graphics();
      this.drawBeltBand(g, dir, 0, 0);
      const q = (u: number, v: number, z: number) => {
        const [tx, ty] = beltLocalToTile(dir, u, v);
        return P(tx, ty, z);
      };
      poly(g, [q(0.3, 0.05, 12), q(0.7, 0.05, 12), q(0.7, 0.95, 12), q(0.3, 0.95, 12)], 0x3a4652);
      poly(g, [q(0.3, 0.95, 12), q(0.7, 0.95, 12), q(0.7, 0.95, 2), q(0.3, 0.95, 2)], 0x222c38);
      poly(g, [q(0.7, 0.05, 12), q(0.7, 0.95, 12), q(0.7, 0.95, 2), q(0.7, 0.05, 2)], 0x1a222d);
      // three arrows on the roof
      for (const v of [0.2, 0.5, 0.8]) {
        const [ax, ay] = q(0.62, v, 12.5);
        const [bx, by] = q(0.38, v - 0.07, 12.5);
        const [cx, cy] = q(0.38, v + 0.07, 12.5);
        g.poly([ax, ay, bx, by, cx, cy]).fill(PAL.cyan);
      }
      this.splitter.push(this.gen(g, new Rectangle(-32, -16, 64, 52), 2));
    }
  }

  drawBeltBand(g: Graphics, dir: number, curve: number, phase: number, range: [number, number] = [0, 1]): void {
    const N = curve === 0 ? 2 : 10;
    const half = 0.34;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let i = 0; i <= N; i++) {
      const s = range[0] + ((range[1] - range[0]) * i) / N;
      const [u, v] = beltPath(curve, s);
      const [u2, v2] = beltPath(curve, Math.min(1, s + 0.01));
      const [u1, v1] = beltPath(curve, Math.max(0, s - 0.01));
      let du = u2 - u1;
      let dv = v2 - v1;
      const l = Math.hypot(du, dv) || 1;
      du /= l;
      dv /= l;
      // normal pointing to v- side (left)
      const nu = dv;
      const nv = -du;
      const a = beltLocalToTile(dir, u + nu * half, v + nv * half);
      const b = beltLocalToTile(dir, u - nu * half, v - nv * half);
      left.push(P(a[0], a[1], 0));
      right.push(P(b[0], b[1], 0));
    }
    const edge = (pts: [number, number][], z: number) => pts.map((p) => [p[0], p[1] - z] as [number, number]);
    // side rails (raised edges)
    poly(g, [...edge(left, 3), ...left.slice().reverse()], 0x4a5560);
    poly(g, [...edge(right, 3), ...right.slice().reverse()], 0x3a4450);
    poly(g, [...edge(left, 3), ...edge(right, 3).reverse()], 0x1c2229);
    // inner rubber
    const inner: [number, number][] = [];
    const inner2: [number, number][] = [];
    for (let i = 0; i < left.length; i++) {
      const l = edge(left, 3)[i];
      const r = edge(right, 3)[i];
      inner.push([l[0] + (r[0] - l[0]) * 0.12, l[1] + (r[1] - l[1]) * 0.12]);
      inner2.push([l[0] + (r[0] - l[0]) * 0.88, l[1] + (r[1] - l[1]) * 0.88]);
    }
    poly(g, [...inner, ...inner2.reverse()], 0x252c34);
    // chevrons
    for (let k = 0; k < 3; k++) {
      const s = (k + phase) / 3;
      if (s < range[0] || s > range[1]) continue;
      const [u, v] = beltPath(curve, s);
      const [uf, vf] = beltPath(curve, Math.min(1, s + 0.08));
      const du = uf - u;
      const dv = vf - v;
      const tip = beltLocalToTile(dir, u + du, v + dv);
      const l1 = beltLocalToTile(dir, u - dv * 2.2, v + du * 2.2);
      const l2 = beltLocalToTile(dir, u + dv * 2.2, v - du * 2.2);
      const [tx, ty] = P(tip[0], tip[1], 3.2);
      const [ax, ay] = P(l1[0], l1[1], 3.2);
      const [bx, by] = P(l2[0], l2[1], 3.2);
      g.moveTo(ax, ay).lineTo(tx, ty).lineTo(bx, by).stroke({ color: 0x5a6a78, width: 1.6, alpha: 0.9 });
    }
  }

  private buildPipes(): void {
    for (let mask = 0; mask < 16; mask++) {
      const g = new Graphics();
      const col = 0x8a949c;
      const seg = (d: number) => {
        const ends: Record<number, [number, number]> = { 0: [0.5, 0], 1: [1, 0.5], 2: [0.5, 1], 3: [0, 0.5] };
        const [ex, ey] = ends[d];
        const [x0, y0] = P(0.5, 0.5, 6);
        const [x1, y1] = P(ex, ey, 6);
        g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: shade(col, -0.35), width: 7.5, cap: 'round' });
        g.moveTo(x0, y0 - 1).lineTo(x1, y1 - 1).stroke({ color: col, width: 5, cap: 'round' });
        g.moveTo(x0, y0 - 2.5).lineTo(x1, y1 - 2.5).stroke({ color: shade(col, 0.3), width: 1.4, cap: 'round' });
      };
      // draw back segments first
      for (const d of [0, 3, 1, 2]) if (mask & (1 << d)) seg(d);
      const [x, y] = P(0.5, 0.5, 6);
      g.ellipse(x, y - 1, 5, 4).fill(shade(col, -0.1));
      g.ellipse(x, y - 1, 5, 4).stroke({ color: shade(col, -0.4), width: 1 });
      this.pipes.push(this.gen(g, new Rectangle(-32, -8, 64, 44), 2));
    }
  }

  // ---------------------------------------------------------------- items
  private buildItems(): void {
    this.items[0] = Texture.EMPTY;
    ITEM_LIST.forEach((it, i) => {
      const g = new Graphics();
      const c = it.color;
      const d = shade(c, -0.35);
      switch (it.shape) {
        case 'ore':
          g.poly([-5, 1, -4, -3, 0, -5, 4, -3, 5, 1, 0, 3]).fill(c);
          g.poly([0, -5, 4, -3, 5, 1, 0, 3]).fill(d);
          break;
        case 'plate':
          g.poly([-6, 0, 0, -3, 6, 0, 0, 3]).fill(c);
          g.poly([-6, 0, 0, 3, 0, 4.5, -6, 1.5]).fill(d);
          g.poly([0, 3, 6, 0, 6, 1.5, 0, 4.5]).fill(shade(c, -0.5));
          break;
        case 'brick':
          g.poly([-5, -1, 0, -3.5, 5, -1, 0, 1.5]).fill(shade(c, 0.1));
          g.poly([-5, -1, 0, 1.5, 0, 4, -5, 1.5]).fill(c);
          g.poly([0, 1.5, 5, -1, 5, 1.5, 0, 4]).fill(d);
          break;
        case 'gear':
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            g.rect(Math.cos(a) * 5 - 1.2, Math.sin(a) * 3 - 1.2, 2.4, 2.4).fill(c);
          }
          g.ellipse(0, 0, 4.5, 3).fill(c);
          g.ellipse(0, 0, 1.6, 1).fill(0x1a222d);
          break;
        case 'wire':
          g.ellipse(0, 0, 5, 3).stroke({ color: c, width: 1.8 });
          g.ellipse(0, -1, 3.5, 2).stroke({ color: shade(c, 0.2), width: 1.4 });
          break;
        case 'chip':
          g.poly([-5, 0, 0, -3, 5, 0, 0, 3]).fill(0x1a222d);
          g.poly([-3, 0, 0, -1.8, 3, 0, 0, 1.8]).fill(c);
          for (let k = -2; k <= 2; k += 2) {
            g.rect(-6 + k * 0.5, k * 0.6, 1, 1).fill(0xb8c4cc);
            g.rect(5 + k * 0.5, k * 0.6, 1, 1).fill(0xb8c4cc);
          }
          break;
        case 'cell':
          g.rect(-3, -5, 6, 9).fill(c);
          g.rect(0, -5, 3, 9).fill(d);
          g.ellipse(0, -5, 3, 1.5).fill(shade(c, 0.3));
          g.rect(-1, -7, 2, 2).fill(0xb8c4cc);
          break;
        case 'crystal':
          g.poly([-4, 2, -2, -5, 1, -7, 3, -3, 4, 2]).fill(c);
          g.poly([1, -7, 3, -3, 4, 2, 0, 2]).fill(d);
          break;
        case 'drop':
          g.poly([0, -6, 4, 1, 0, 4, -4, 1]).fill(0x1a222d);
          break;
        case 'pack':
          g.rect(-3, -6, 6, 3).fill(0xb8c4cc);
          g.poly([-3, -3, 3, -3, 5, 3, -5, 3]).fill(c);
          g.poly([0, -3, 3, -3, 5, 3, 0, 3]).fill(d);
          break;
        case 'module':
          g.poly([-5, 0, 0, -3, 5, 0, 0, 3]).fill(shade(c, 0.2));
          g.poly([-5, 0, 0, 3, 0, 5, -5, 2]).fill(c);
          g.poly([0, 3, 5, 0, 5, 2, 0, 5]).fill(d);
          g.rect(-1, -1, 2, 1).fill(0x66d8ff);
          break;
      }
      this.items[i + 1] = this.gen(g, new Rectangle(-8, -8, 16, 16), 3);
    });
  }

  // ---------------------------------------------------------------- units
  private buildUnits(): void {
    const drone = (body: number, accent: number, kind: DroneKind) => {
      const g = new Graphics();
      if (kind === 'worker' || kind === 'construction' || kind === 'logistic') {
        // quadcopter
        for (const [x, y] of [[-9, -4], [9, -4], [-9, 4], [9, 4]]) {
          g.moveTo(0, 0).lineTo(x, y).stroke({ color: 0x3a4652, width: 2 });
          g.ellipse(x, y - 1, 5, 2).fill({ color: 0xb8c4cc, alpha: 0.5 });
        }
        if (kind === 'logistic') g.rect(-5, 2, 10, 6).fill(PAL.copper);
        if (kind === 'construction') {
          g.rect(-4, 3, 8, 4).fill(PAL.hazard);
          g.moveTo(0, 6).lineTo(0, 11).stroke({ color: 0x3a4652, width: 1.5 });
        }
        g.ellipse(0, 0, 7, 4.5).fill(body);
        g.ellipse(0, -1.5, 5, 2.5).fill(shade(body, 0.2));
        g.circle(0, 1, 1.8).fill(accent);
      } else if (kind === 'engineer') {
        g.rect(-4, -2, 8, 10).fill(body);
        g.circle(0, -6, 4.5).fill(shade(body, 0.2));
        g.rect(-2.5, -7, 5, 2).fill(accent);
        g.rect(-8, -1, 3, 8).fill(shade(body, -0.2));
        g.rect(5, -1, 3, 8).fill(shade(body, -0.2));
        g.rect(-3, 8, 2.5, 5).fill(0x3a4652);
        g.rect(0.5, 8, 2.5, 5).fill(0x3a4652);
      } else {
        // combat
        g.poly([-10, 0, 0, -6, 10, 0, 0, 5]).fill(body);
        g.poly([0, -6, 10, 0, 0, 5]).fill(shade(body, -0.3));
        g.rect(-12, -1, 6, 2).fill(0x3a4652);
        g.rect(6, -1, 6, 2).fill(0x3a4652);
        g.circle(0, -1, 2.2).fill(accent);
      }
      return this.gen(g, new Rectangle(-16, -14, 32, 28), 2);
    };
    this.drones.set('worker', drone(0xe8eef2, PAL.cyan, 'worker'));
    this.drones.set('construction', drone(0xd9a227, 0x2a3440, 'construction'));
    this.drones.set('logistic', drone(0x3a4551, PAL.copper, 'logistic'));
    this.drones.set('engineer', drone(0x8a99a6, PAL.cyan, 'engineer'));
    this.drones.set('combat', drone(0x1a222d, PAL.red, 'combat'));
    const e = new Graphics();
    e.ellipse(0, 4, 10, 4).fill({ color: 0x000000, alpha: 0.3 });
    for (const [x, y] of [[-9, 2], [9, 2], [-7, 6], [7, 6]]) e.moveTo(0, -2).lineTo(x, y).stroke({ color: 0x3a2a2a, width: 2 });
    e.ellipse(0, -4, 8, 6).fill(0x4a2a24);
    e.ellipse(0, -6, 5, 3).fill(0x6a3a30);
    e.circle(-2, -4, 1.6).fill(0xff4a3a);
    e.circle(2, -4, 1.6).fill(0xff4a3a);
    this.enemy = this.gen(e, new Rectangle(-14, -14, 28, 24), 2);
    const s = new Graphics();
    s.ellipse(0, 0, 10, 5).fill({ color: 0x000000, alpha: 0.35 });
    this.shadow = this.gen(s, new Rectangle(-12, -6, 24, 12), 1);
  }

  private buildFx(): void {
    const sm = new Graphics();
    for (let i = 0; i < 8; i++) sm.circle(0, 0, 16 - i * 2).fill({ color: 0xffffff, alpha: 0.06 + i * 0.02 });
    this.smoke = this.gen(sm, new Rectangle(-16, -16, 32, 32), 1);
    const sp = new Graphics();
    sp.circle(0, 0, 3).fill(0xffffff);
    glow(sp, 0, 0, 6, 0xffffff, 0.5);
    this.spark = this.gen(sp, new Rectangle(-6, -6, 12, 12), 1);
    const gl = new Graphics();
    glow(gl, 0, 0, 32, 0xffffff, 0.8);
    this.glowTex = this.gen(gl, new Rectangle(-32, -32, 64, 64), 1);
    const q = new Graphics();
    q.poly([0, -34, 14, -20, 0, -6, -14, -20]).fill(0x0a1b2b);
    q.poly([0, -34, 14, -20, 0, -6, -14, -20]).stroke({ color: PAL.cyan, width: 2 });
    q.moveTo(0, -6).lineTo(0, 0).stroke({ color: PAL.cyan, width: 1.5 });
    this.poi = this.gen(q, new Rectangle(-18, -38, 36, 40), 2);
    const n = new Graphics();
    n.poly([0, -34, 14, -20, 0, -6, -14, -20]).fill(0x2a1210);
    n.poly([0, -34, 14, -20, 0, -6, -14, -20]).stroke({ color: PAL.red, width: 2 });
    n.circle(0, -22, 6).fill(0xe8d8d0);
    n.rect(-3, -18, 6, 4).fill(0xe8d8d0);
    n.circle(-2.2, -22.5, 1.6).fill(0x2a1210);
    n.circle(2.2, -22.5, 1.6).fill(0x2a1210);
    this.nest = this.gen(n, new Rectangle(-18, -38, 36, 40), 2);
    void box;
    void boxColors;
    void mix;
  }
}
