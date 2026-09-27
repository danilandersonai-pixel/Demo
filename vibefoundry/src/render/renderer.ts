import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { BUILDINGS, BELTLIKE, type BuildingType } from '../data/buildings';
import { RECIPES } from '../data/recipes';
import { ITEM_INDEX, type ItemId } from '../data/items';
import { HALF_H, HALF_W, DX, DY, toTile, type Dir } from '../core/iso';
import type { Sim } from '../sim/sim';
import type { Entity } from '../sim/types';
import { outputTile } from '../sim/logistics';
import { HQ_RANGE, PORT_RANGE } from '../sim/drones';
import { TextureBank } from './textures';
import { TerrainLayer } from './terrainLayer';
import { EntityLayer } from './entityLayer';
import { UnitLayer } from './unitLayer';
import { mix, PAL } from './color';
import { CHUNK } from '../world/world';

const iso = (x: number, y: number): [number, number] => [(x - y) * HALF_W, (x + y) * HALF_H];

export interface PreviewSpec {
  type: BuildingType;
  tiles: { x: number; y: number; dir: Dir }[];
  valid: boolean[];
}

export class WorldRenderer {
  app: Application;
  tex!: TextureBank;
  world = new Container();
  terrain!: TerrainLayer;
  ents!: EntityLayer;
  units!: UnitLayer;
  overlay = new Container();
  overlayG = new Graphics();
  coverageG = new Graphics();
  previewC = new Container();
  altC = new Container();
  lightsRoot = new Container();
  cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tzoom: 1, flying: false };
  sim!: Sim;
  hover: { x: number; y: number } | null = null;
  selected: Entity | null = null;
  preview: PreviewSpec | null = null;
  altMode = false;
  showCoverage = false;
  lod = false;
  private time = 0;
  private altPool: Sprite[] = [];
  private coverageKey = '';
  private lastOverview = 0;
  lightFactor = 0;

  constructor(app: Application) {
    this.app = app;
  }

  init(sim: Sim): void {
    this.tex = new TextureBank(this.app.renderer);
    this.tex.buildAll();
    this.app.stage.addChild(this.world);
    this.attach(sim);
  }

  /** (Re)attach to a sim — used on new game / load. */
  attach(sim: Sim): void {
    this.sim = sim;
    this.world.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.overlay = new Container();
    this.overlayG = new Graphics();
    this.coverageG = new Graphics();
    this.previewC = new Container();
    this.altC = new Container();
    this.lightsRoot = new Container();
    this.altPool = [];
    this.terrain = new TerrainLayer(sim.world, this.tex);
    this.ents = new EntityLayer(this.tex, this.terrain);
    this.ents.setStatusTextures(this.makeStatusTextures());
    this.units = new UnitLayer(this.tex);
    const overview = this.terrain.getOverview();
    this.lightsRoot.addChild(this.ents.lights, this.units.lights, this.units.fxAdd);
    this.overlay.addChild(this.coverageG, this.overlayG, this.previewC, this.altC);
    // Independent render groups: a change inside one layer (belt animation, item pool, culling)
    // rebuilds only that layer's instructions instead of the whole world.
    for (const c of [this.terrain.ground, this.terrain.objects, this.ents.beltsC, this.ents.itemsC, this.ents.pipesC, this.lightsRoot, this.units.air, this.overlay]) c.isRenderGroup = true;
    this.world.addChild(
      overview,
      this.terrain.ground,
      this.ents.flat,
      this.units.shadows,
      this.terrain.objects,
      this.ents.wires,
      this.units.air,
      this.units.fxBack,
      this.lightsRoot,
      this.units.markers,
      this.ents.icons,
      this.overlay,
    );
    this.lastOverview = performance.now();
    const [bx, by] = iso(sim.world.base.x + 0.5, sim.world.base.y + 0.5);
    this.cam.x = this.cam.tx = bx + 120;
    this.cam.y = this.cam.ty = by + 20;
    this.cam.zoom = this.cam.tzoom = 1.1;
    sim.events.on('fx', (f) => {
      if (f.kind === 'reveal') return;
      this.units.spawn(f.kind === 'build' ? 'build' : f.kind === 'explode' ? 'explode' : f.kind === 'spark' ? 'spark' : 'shot', f.x, f.y, f.kind === 'build' ? 10 : 8, f.x2, f.y2);
    });
  }

  private makeStatusTextures(): Record<string, Texture> {
    const mk = (draw: (g: Graphics) => void) => {
      const g = new Graphics();
      g.circle(0, 0, 11).fill({ color: 0x03111d, alpha: 0.9 });
      draw(g);
      const t = this.app.renderer.generateTexture({ target: g, frame: new Rectangle(-13, -13, 26, 26), resolution: 2, antialias: true });
      g.destroy();
      return t;
    };
    return {
      no_power: mk((g) => {
        g.circle(0, 0, 11).stroke({ color: PAL.red, width: 2 });
        g.poly([2, -8, -5, 1, 0, 1, -2, 8, 5, -1, 0, -1]).fill(PAL.amber);
      }),
      no_materials: mk((g) => {
        g.circle(0, 0, 11).stroke({ color: PAL.amber, width: 2 });
        g.rect(-5, -4, 10, 8).stroke({ color: PAL.amber, width: 1.5 });
        g.moveTo(-5, -1).lineTo(5, -1).stroke({ color: PAL.amber, width: 1.2 });
      }),
      out_of_range: mk((g) => {
        g.circle(0, 0, 11).stroke({ color: 0x8a99a6, width: 2 });
        g.ellipse(0, 0, 6, 3.5).fill(0x8a99a6);
        g.moveTo(-7, -7).lineTo(7, 7).stroke({ color: PAL.red, width: 2 });
      }),
      decon: mk((g) => {
        g.circle(0, 0, 11).stroke({ color: PAL.red, width: 2 });
        g.moveTo(-5, -5).lineTo(5, 5).stroke({ color: PAL.red, width: 2.5 });
        g.moveTo(5, -5).lineTo(-5, 5).stroke({ color: PAL.red, width: 2.5 });
      }),
      disabled: mk((g) => {
        g.circle(0, 0, 11).stroke({ color: 0x8a99a6, width: 2 });
        g.rect(-4, -5, 3, 10).fill(0xb7c2cc);
        g.rect(1, -5, 3, 10).fill(0xb7c2cc);
      }),
      damaged: mk((g) => {
        g.circle(0, 0, 11).stroke({ color: PAL.copper, width: 2 });
        g.moveTo(-5, 5).lineTo(4, -4).stroke({ color: PAL.copper, width: 3 });
        g.circle(4, -4, 3).stroke({ color: PAL.copper, width: 2 });
      }),
    };
  }

  // -------------------------------------------------------------- camera
  get screenW(): number {
    return this.app.screen.width;
  }
  get screenH(): number {
    return this.app.screen.height;
  }
  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.screenW / 2) / this.cam.zoom + this.cam.x, (sy - this.screenH / 2) / this.cam.zoom + this.cam.y];
  }
  screenToTile(sx: number, sy: number): { x: number; y: number; fx: number; fy: number } {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const t = toTile(wx, wy);
    return { x: Math.floor(t.x), y: Math.floor(t.y), fx: t.x, fy: t.y };
  }
  tileToScreen(x: number, y: number): [number, number] {
    const [wx, wy] = iso(x, y);
    return [(wx - this.cam.x) * this.cam.zoom + this.screenW / 2, (wy - this.cam.y) * this.cam.zoom + this.screenH / 2];
  }
  pan(dxScreen: number, dyScreen: number): void {
    this.cam.flying = false;
    this.cam.x += dxScreen / this.cam.zoom;
    this.cam.y += dyScreen / this.cam.zoom;
    this.cam.tx = this.cam.x;
    this.cam.ty = this.cam.y;
  }
  zoomAt(factor: number, sx: number, sy: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const z = Math.max(0.12, Math.min(2.6, this.cam.zoom * factor));
    this.cam.zoom = this.cam.tzoom = z;
    this.cam.x = wx - (sx - this.screenW / 2) / z;
    this.cam.y = wy - (sy - this.screenH / 2) / z;
    this.cam.tx = this.cam.x;
    this.cam.ty = this.cam.y;
  }
  flyTo(tx: number, ty: number, zoom?: number): void {
    const [wx, wy] = iso(tx, ty);
    this.cam.tx = wx;
    this.cam.ty = wy;
    if (zoom) this.cam.tzoom = zoom;
    this.cam.flying = true;
  }
  /** Current view rectangle in tile space (approx, for minimap). */
  viewCorners(): { x: number; y: number }[] {
    const pts = [[0, 0], [this.screenW, 0], [this.screenW, this.screenH], [0, this.screenH]];
    return pts.map(([sx, sy]) => {
      const t = this.screenToTile(sx, sy);
      return { x: t.fx, y: t.fy };
    });
  }

  // -------------------------------------------------------------- frame
  render(alpha: number, dt: number): void {
    const sim = this.sim;
    this.time += dt;
    // camera easing
    if (this.cam.flying) {
      const k = 1 - Math.pow(0.001, dt);
      this.cam.x += (this.cam.tx - this.cam.x) * k;
      this.cam.y += (this.cam.ty - this.cam.y) * k;
      this.cam.zoom += (this.cam.tzoom - this.cam.zoom) * k;
      if (Math.abs(this.cam.tx - this.cam.x) < 1 && Math.abs(this.cam.ty - this.cam.y) < 1 && Math.abs(this.cam.tzoom - this.cam.zoom) < 0.01) this.cam.flying = false;
    }
    const z = this.cam.zoom;
    this.world.scale.set(z);
    this.world.x = Math.round(this.screenW / 2 - this.cam.x * z);
    this.world.y = Math.round(this.screenH / 2 - this.cam.y * z);
    const vx0 = this.cam.x - this.screenW / 2 / z;
    const vx1 = this.cam.x + this.screenW / 2 / z;
    const vy0 = this.cam.y - this.screenH / 2 / z;
    const vy1 = this.cam.y + this.screenH / 2 / z;
    this.lod = z < 0.3;
    if (this.lod && performance.now() - this.lastOverview > 2500) {
      this.terrain.getOverview();
      this.lastOverview = performance.now();
    }
    this.terrain.update(vx0, vy0, vx1, vy1, this.lod);
    const chunkVisible = (key: number) => {
      const cy = Math.floor(key / 1000);
      const cx = key % 1000;
      const v = this.terrain.chunks[cy * sim.world.chunksX + cx];
      return !!v && v.objects.visible;
    };
    // day / night
    const dl = sim.daylight;
    const f = sim.dayFrac;
    let tint: number;
    const NIGHT = 0x3c4a78;
    if (f < 0.06 || f > 0.72) tint = NIGHT;
    else if (f < 0.14) tint = mix(NIGHT, 0xffe2c8, (f - 0.06) / 0.08);
    else if (f < 0.2) tint = mix(0xffe2c8, 0xfff8ee, (f - 0.14) / 0.06);
    else if (f < 0.55) tint = 0xfff8ee;
    else if (f < 0.62) tint = mix(0xfff8ee, 0xffd6a0, (f - 0.55) / 0.07);
    else tint = mix(0xffd6a0, NIGHT, (f - 0.62) / 0.1);
    for (const c of [this.terrain.ground, this.ents.flat, this.terrain.objects, this.units.air, this.units.shadows, this.ents.wires, this.units.fxBack]) c.tint = tint;
    if (this.terrain.overview) this.terrain.overview.tint = tint;
    this.app.renderer.background.color = mix(0x03263a, 0x041424, 1 - dl);
    this.lightFactor = Math.max(0.28, Math.min(1, 1.1 - dl * 0.85));
    this.lightsRoot.alpha = 1;
    this.ents.update(sim, this.time, alpha, chunkVisible, this.lightFactor);
    const margin = 4;
    const inView = (x: number, y: number) => {
      const [sx, sy] = iso(x, y);
      return sx > vx0 - margin * 64 && sx < vx1 + margin * 64 && sy > vy0 - margin * 32 && sy < vy1 + margin * 64;
    };
    this.units.update(sim, this.time, alpha, dt, inView);
    // water shimmer: a few glints on random visible water tiles
    if (!this.lod) {
      for (let k = 0; k < 3; k++) {
        const t = this.screenToTile(Math.random() * this.screenW, Math.random() * this.screenH);
        const w = sim.world;
        if (w.inBounds(t.x, t.y) && w.biome[w.idx(t.x, t.y)] <= 2 && w.fog[w.idx(t.x, t.y)]) this.units.spawn('glint', t.fx, t.fy, -7);
      }
    }
    this.ents.icons.visible = !this.lod;
    this.drawOverlay();
    if (this.altMode) this.drawAlt(chunkVisible);
    else this.altC.visible = false;
  }

  // ------------------------------------------------------------ overlays
  private diamond(g: Graphics, x: number, y: number, w: number, h: number, color: number, width = 2, alpha = 1, fill?: { color: number; alpha: number }): void {
    const a = iso(x, y);
    const b = iso(x + w, y);
    const c = iso(x + w, y + h);
    const d = iso(x, y + h);
    const pts = [a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]];
    if (fill) g.poly(pts).fill(fill);
    g.poly(pts).stroke({ color, width: width / this.cam.zoom, alpha });
  }

  private drawOverlay(): void {
    const g = this.overlayG;
    g.clear();
    this.previewC.removeChildren().forEach((c) => c.destroy());
    if (this.hover && !this.preview) this.diamond(g, this.hover.x, this.hover.y, 1, 1, 0xffffff, 1.5, 0.35);
    const sel = this.selected;
    if (sel && this.sim.ents.has(sel.id)) {
      this.diamond(g, sel.x, sel.y, sel.w, sel.h, PAL.cyan, 2.5, 1, { color: PAL.cyan, alpha: 0.08 });
      const def = BUILDINGS[sel.type];
      if (def.poleSupply) this.diamond(g, sel.x - def.poleSupply, sel.y - def.poleSupply, sel.w + def.poleSupply * 2, sel.h + def.poleSupply * 2, PAL.amber, 1.5, 0.7, { color: PAL.amber, alpha: 0.05 });
      if (sel.type === 'hq' || sel.type === 'droneport') this.circle(g, sel.x + sel.w / 2, sel.y + sel.h / 2, sel.type === 'hq' ? HQ_RANGE : PORT_RANGE, PAL.teal);
      if (sel.type === 'radar') this.circle(g, sel.x + 1, sel.y + 1, sel.scanR ?? 12, PAL.cyan);
      if (sel.type === 'turret') this.circle(g, sel.x + 1, sel.y + 1, 12, PAL.red);
      this.drawIO(g, sel);
    } else if (sel) this.selected = null;
    const p = this.preview;
    if (p) {
      const def = BUILDINGS[p.type];
      const coverage = !!def.power || !!def.poleReach || !!def.gen || this.altMode;
      this.drawCoverage(coverage);
      p.tiles.forEach((t, i) => {
        const ok = p.valid[i];
        const col = ok ? 0x4fd8be : PAL.red;
        this.diamond(g, t.x, t.y, def.w, def.h, col, 2, 0.9, { color: col, alpha: 0.12 });
        let s: Sprite;
        if (p.type === 'belt') {
          s = new Sprite(this.tex.belts[0][t.dir][0]);
          s.anchor.set(0.5, 4 / 40);
        } else if (p.type === 'splitter') {
          s = new Sprite(this.tex.splitter[t.dir]);
          s.anchor.set(0.5, 16 / 52);
        } else if (p.type === 'underground') {
          s = new Sprite(this.tex.underground[0][t.dir]);
          s.anchor.set(0.5, 20 / 56);
        } else if (p.type === 'pipe') {
          s = new Sprite(this.tex.pipes[0]);
          s.anchor.set(0.5, 8 / 44);
        } else if (p.type === 'inserter') {
          s = new Sprite(this.tex.inserterBase);
          s.anchor.set(0.5, 0);
        } else {
          const bt = this.tex.buildings.get(p.type)!;
          s = new Sprite(bt.base);
          s.anchor.set(bt.ax, bt.ay);
        }
        const [sx, sy] = iso(t.x, t.y);
        s.x = sx;
        s.y = sy;
        s.alpha = 0.7;
        s.tint = ok ? 0xc8fff0 : 0xff9a8a;
        this.previewC.addChild(s);
        if (def.rotatable && p.type !== 'belt') this.drawArrowFor(g, p.type, t.x, t.y, t.dir, def.w, def.h);
        if (def.poleSupply && i === 0) this.diamond(g, t.x - def.poleSupply, t.y - def.poleSupply, 1 + def.poleSupply * 2, 1 + def.poleSupply * 2, PAL.amber, 1.5, 0.8, { color: PAL.amber, alpha: 0.06 });
      });
    } else this.drawCoverage(this.altMode);
  }

  private circle(g: Graphics, cx: number, cy: number, r: number, color: number): void {
    const pts: number[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const [x, y] = iso(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      pts.push(x, y);
    }
    g.poly(pts).stroke({ color, width: 1.5 / this.cam.zoom, alpha: 0.7 });
  }

  private drawArrowFor(g: Graphics, type: BuildingType, x: number, y: number, dir: Dir, w: number, h: number): void {
    let tx: number, ty: number;
    if (type === 'drill') {
      const o = outputTile({ x, y, w, h, dir });
      tx = o.x + 0.5;
      ty = o.y + 0.5;
    } else {
      tx = x + 0.5 + DX[dir] * 0.9;
      ty = y + 0.5 + DY[dir] * 0.9;
    }
    const [ax, ay] = iso(tx - DX[dir] * 0.35, ty - DY[dir] * 0.35);
    const [bx, by] = iso(tx + DX[dir] * 0.25, ty + DY[dir] * 0.25);
    g.moveTo(ax, ay).lineTo(bx, by).stroke({ color: PAL.amber, width: 3 / this.cam.zoom });
    const [lx, ly] = iso(tx - DY[dir] * 0.2, ty + DX[dir] * 0.2);
    const [rx, ry] = iso(tx + DY[dir] * 0.2, ty - DX[dir] * 0.2);
    g.poly([bx, by, lx, ly, rx, ry]).fill(PAL.amber);
  }

  private drawIO(g: Graphics, e: Entity): void {
    if (e.type === 'inserter') {
      const s = { x: e.x - DX[e.dir], y: e.y - DY[e.dir] };
      const d = { x: e.x + DX[e.dir], y: e.y + DY[e.dir] };
      this.diamond(g, s.x, s.y, 1, 1, PAL.teal, 1.5, 0.8);
      this.diamond(g, d.x, d.y, 1, 1, PAL.amber, 1.5, 0.8);
    }
    if (e.type === 'drill') this.drawArrowFor(g, 'drill', e.x, e.y, e.dir, e.w, e.h);
  }

  /** Power coverage tint for tiles in view (cached by topology/view). */
  private drawCoverage(on: boolean): void {
    const g = this.coverageG;
    if (!on) {
      if (this.coverageKey) {
        g.clear();
        this.coverageKey = '';
      }
      return;
    }
    const corners = this.viewCorners();
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const x1 = Math.min(this.sim.world.w - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(this.sim.world.h - 1, Math.ceil(Math.max(...ys)));
    const key = `${this.sim.topoVersion}:${x0 >> 3}:${y0 >> 3}:${x1 >> 3}:${y1 >> 3}`;
    if (key === this.coverageKey) return;
    this.coverageKey = key;
    g.clear();
    const W = this.sim.world.w;
    for (let y = y0; y <= y1; y++) {
      let run = -1;
      for (let x = x0; x <= x1 + 1; x++) {
        const cov = x <= x1 && this.sim.supply[y * W + x] > 0;
        if (cov && run < 0) run = x;
        if (!cov && run >= 0) {
          const a = iso(run, y);
          const b = iso(x, y);
          const c = iso(x, y + 1);
          const d = iso(run, y + 1);
          g.poly([a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]]).fill({ color: PAL.amber, alpha: 0.1 });
          run = -1;
        }
      }
    }
  }

  private drawAlt(chunkVisible: (k: number) => boolean): void {
    this.altC.visible = true;
    let used = 0;
    const g = this.overlayG;
    for (const v of this.ents.views.values()) {
      const e = v.e;
      if (e.ghost || !chunkVisible(v.chunkKey)) continue;
      if (BELTLIKE.has(e.type) || e.type === 'pipe' || e.type === 'pole') continue;
      // status colouring: yellow = starved, red = no power
      const st = e.status;
      const col = st === 'no_power' || st === 'no_fluid' ? PAL.red : st === 'no_input' || st === 'output_full' || st === 'limit' ? PAL.amber : st === 'disabled' ? 0x8a99a6 : null;
      if (col) this.diamond(g, e.x, e.y, e.w, e.h, col, 2, 0.9, { color: col, alpha: 0.18 });
      let icon: ItemId | null = null;
      if (e.recipe && RECIPES[e.recipe]) icon = RECIPES[e.recipe].outputs[0].item;
      else if (e.type === 'drill' && e.recipe) icon = e.recipe as ItemId;
      if (!icon) continue;
      let s = this.altPool[used];
      if (!s) {
        s = new Sprite();
        s.anchor.set(0.5);
        this.altPool.push(s);
        this.altC.addChild(s);
      }
      used++;
      s.visible = true;
      s.texture = this.tex.items[ITEM_INDEX[icon]] ?? Texture.EMPTY;
      const [sx, sy] = iso(e.x + e.w / 2, e.y + e.h / 2);
      s.x = sx;
      s.y = sy - 10;
      s.scale.set(Math.min(3, 1.2 + e.w * 0.5));
    }
    for (let i = used; i < this.altPool.length; i++) this.altPool[i].visible = false;
    void CHUNK;
  }
}
