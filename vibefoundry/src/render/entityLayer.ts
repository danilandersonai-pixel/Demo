import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { BUILDINGS, BELTLIKE } from '../data/buildings';
import { HALF_H, HALF_W, DX, DY } from '../core/iso';
import { BELT_SPEED } from '../sim/logistics';
import type { Sim } from '../sim/sim';
import type { Entity } from '../sim/types';
import { beltLocalToTile, beltPath, type TextureBank } from './textures';
import type { TerrainLayer } from './terrainLayer';

interface View {
  e: Entity;
  root: Sprite | Container;
  base?: Sprite;
  light?: Sprite;
  hand?: Sprite;
  arm?: Sprite;
  item?: Sprite;
  ghost: boolean;
  dir: number;
  curve: number;
  ug?: string;
  pipeMask?: number;
  chunkKey: number;
  icon?: Sprite;
  lastStatus?: string;
}

const iso = (x: number, y: number): [number, number] => [(x - y) * HALF_W, (x + y) * HALF_H];

/** Buildings, belts, items on belts, inserters, ghosts, power wires. */
export class EntityLayer {
  flat = new Container();
  beltsC = new Container();
  pipesC = new Container();
  itemsC = new Container();
  lights = new Container();
  wires = new Graphics();
  icons = new Container();
  views = new Map<number, View>();
  private itemPool: Sprite[] = [];
  private itemUsed = 0;
  private wireVersion = -1;
  tex: TextureBank;
  terrain: TerrainLayer;
  statusTex: Record<string, Texture> = {};

  constructor(tex: TextureBank, terrain: TerrainLayer) {
    this.tex = tex;
    this.terrain = terrain;
    this.flat.addChild(this.pipesC, this.beltsC, this.itemsC);
    this.lights.blendMode = 'add';
  }

  setStatusTextures(t: Record<string, Texture>): void {
    this.statusTex = t;
  }

  private makeView(sim: Sim, e: Entity): View {
    const t = e.type;
    const [sx, sy] = iso(e.x, e.y);
    const chunk = this.terrain.chunkAt(Math.min(sim.world.w - 1, e.x + e.w - 1), Math.min(sim.world.h - 1, e.y + e.h - 1));
    const chunkKey = chunk.cy * 1000 + chunk.cx;
    const v: View = { e, root: null as any, ghost: !!e.ghost, dir: e.dir, curve: e.curve ?? 0, chunkKey };
    if (BELTLIKE.has(t)) {
      let tx: Texture;
      if (t === 'splitter') tx = this.tex.splitter[e.dir];
      else if (t === 'underground') tx = this.tex.underground[e.ug === 'out' ? 1 : 0][e.dir];
      else tx = this.tex.belts[0][e.dir][0];
      const s = new Sprite(tx);
      s.anchor.set(0.5, t === 'belt' ? 4 / 40 : t === 'splitter' ? 16 / 52 : 20 / 56);
      s.x = sx;
      s.y = sy;
      v.root = s;
      v.ug = e.ug;
      this.beltsC.addChild(s);
      if (t !== 'belt') {
        s.zIndex = (e.x + e.y) * 10 + 4;
      }
    } else if (t === 'pipe') {
      const s = new Sprite(this.tex.pipes[0]);
      s.anchor.set(0.5, 8 / 44);
      s.x = sx;
      s.y = sy;
      v.root = s;
      v.pipeMask = -1;
      this.pipesC.addChild(s);
    } else if (t === 'inserter') {
      const c = new Container();
      const base = new Sprite(this.tex.inserterBase);
      base.anchor.set(0.5, 0);
      c.addChild(base);
      const arm = new Sprite(Texture.WHITE);
      arm.tint = 0x6a7680;
      arm.anchor.set(0, 0.5);
      arm.height = 2.5;
      const hand = new Sprite(this.tex.hand);
      hand.anchor.set(0.5, 0.5);
      const item = new Sprite(Texture.EMPTY);
      item.anchor.set(0.5, 0.5);
      item.scale.set(0.8);
      c.addChild(arm, hand, item);
      c.x = sx;
      c.y = sy;
      c.zIndex = (e.x + e.y) * 10 + 6;
      v.root = c;
      v.base = base;
      v.arm = arm;
      v.hand = hand;
      v.item = item;
      chunk.objects.addChild(c);
    } else {
      const bt = this.tex.buildings.get(t)!;
      const s = new Sprite(bt.base);
      s.anchor.set(bt.ax, bt.ay);
      s.x = sx;
      s.y = sy;
      s.zIndex = (e.x + e.w - 1 + e.y + e.h - 1) * 10 + 7;
      v.root = s;
      v.base = s;
      chunk.objects.addChild(s);
      const l = new Sprite(bt.lights);
      l.anchor.set(bt.ax, bt.ay);
      l.x = sx;
      l.y = sy;
      v.light = l;
      this.lights.addChild(l);
    }
    this.applyGhost(v);
    return v;
  }

  private applyGhost(v: View): void {
    const r = v.root;
    if (v.e.ghost) {
      r.alpha = 0.45;
      if (r instanceof Sprite) r.tint = 0x88ddff;
      if (v.light) v.light.visible = false;
    } else {
      r.alpha = 1;
      if (r instanceof Sprite) r.tint = 0xffffff;
      if (v.light) v.light.visible = true;
    }
    v.ghost = !!v.e.ghost;
  }

  private destroyView(v: View): void {
    v.root.destroy({ children: true });
    v.light?.destroy();
    v.icon?.destroy();
  }

  /** Sync views with the sim and animate. */
  update(sim: Sim, time: number, alpha: number, visibleChunk: (key: number) => boolean, lightAlpha: number): void {
    // diff
    const seen = new Set<number>();
    for (const e of sim.list) {
      seen.add(e.id);
      let v = this.views.get(e.id);
      if (!v) {
        v = this.makeView(sim, e);
        this.views.set(e.id, v);
      }
      if (v.ghost !== !!e.ghost) this.applyGhost(v);
      if (e.type === 'underground' && v.ug !== e.ug) {
        this.destroyView(v);
        v = this.makeView(sim, e);
        this.views.set(e.id, v);
      }
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        this.destroyView(v);
        this.views.delete(id);
      }
    }
    // animate visible
    this.itemUsed = 0;
    const beltFrame = Math.floor(time * BELT_SPEED * (1 + sim.effects.beltSpeed) * 3 * 8) % 8;
    const bs = sim.belts;
    const step = BELT_SPEED * (1 + sim.effects.beltSpeed) / 60;
    for (const v of this.views.values()) {
      const e = v.e;
      const vis = visibleChunk(v.chunkKey);
      v.root.visible = vis;
      if (v.light) v.light.visible = vis && !e.ghost;
      if (!vis) {
        if (v.icon) v.icon.visible = false;
        continue;
      }
      if (e.type === 'belt') {
        const curve = e.curve ?? 0;
        const shape = curve === 0 ? 0 : curve < 0 ? 1 : 2;
        (v.root as Sprite).texture = this.tex.belts[shape][e.dir][e.ghost ? 0 : beltFrame];
      } else if (e.type === 'splitter' && v.dir !== e.dir) {
        (v.root as Sprite).texture = this.tex.splitter[e.dir];
      } else if (e.type === 'underground' && v.dir !== e.dir) {
        (v.root as Sprite).texture = this.tex.underground[e.ug === 'out' ? 1 : 0][e.dir];
      } else if (e.type === 'pipe') {
        const m = pipeMask(sim, e);
        if (m !== v.pipeMask) {
          (v.root as Sprite).texture = this.tex.pipes[m];
          v.pipeMask = m;
        }
      }
      v.dir = e.dir;
      // items on belts
      if (e.bi !== undefined && !e.ghost) {
        const n = bs.cnt[e.bi];
        if (n) {
          const curve = e.type === 'belt' ? e.curve ?? 0 : 0;
          const blocked = e.nextMode === 0;
          for (let k = 0; k < n; k++) {
            let p = bs.pos[e.bi * 4 + k] + (blocked ? 0 : step * alpha);
            if (p > 1) p = 1;
            if (e.type === 'underground' && ((e.ug === 'in' && p > 0.5) || (e.ug === 'out' && p < 0.5))) continue;
            const [u, vv] = beltPath(curve, p);
            const [tx, ty] = beltLocalToTile(e.dir, u, vv);
            const s = this.itemSprite(bs.items[e.bi * 4 + k]);
            const [ix, iy] = iso(e.x + tx, e.y + ty);
            s.x = ix;
            s.y = iy - 5;
          }
        }
      }
      if (e.type === 'inserter' && !e.ghost) this.animateInserter(sim, v);
      // gentle pulse for working buildings' lights
      if (v.light) {
        const working = e.status === 'working' || BUILDINGS[e.type].gen || e.type === 'hq';
        v.light.alpha = lightAlpha * (working ? 0.85 + Math.sin(time * 3 + e.id) * 0.15 : 0.35);
      }
      this.updateIcon(v, time);
    }
    for (let i = this.itemUsed; i < this.itemPool.length; i++) this.itemPool[i].visible = false;
    if (sim.topoVersion !== this.wireVersion) this.drawWires(sim);
  }

  private itemSprite(idx: number): Sprite {
    let s = this.itemPool[this.itemUsed];
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5, 0.5);
      this.itemPool.push(s);
      this.itemsC.addChild(s);
    }
    this.itemUsed++;
    s.visible = true;
    s.texture = this.tex.items[idx] ?? Texture.EMPTY;
    return s;
  }

  private animateInserter(sim: Sim, v: View): void {
    const e = v.e;
    const t = e.t ?? 0;
    // hand path: from back tile centre (t=0) to front tile centre (t=1)
    const bx = 0.5 - DX[e.dir] * 0.75;
    const by = 0.5 - DY[e.dir] * 0.75;
    const fx = 0.5 + DX[e.dir] * 0.75;
    const fy = 0.5 + DY[e.dir] * 0.75;
    const hx = bx + (fx - bx) * t;
    const hy = by + (fy - by) * t;
    const [px, py] = iso(hx, hy);
    const lift = 12 + Math.sin(t * Math.PI) * 10;
    const [ox, oy] = iso(0.5, 0.5);
    const ax = ox;
    const ay = oy - 8;
    const hxs = px;
    const hys = py - lift;
    v.hand!.x = hxs;
    v.hand!.y = hys;
    const dx = hxs - ax;
    const dy = hys - ay;
    v.arm!.x = ax;
    v.arm!.y = ay;
    v.arm!.width = Math.hypot(dx, dy);
    v.arm!.rotation = Math.atan2(dy, dx);
    if (e.hand) {
      v.item!.texture = this.tex.items[e.hand];
      v.item!.visible = true;
      v.item!.x = hxs;
      v.item!.y = hys + 5;
    } else v.item!.visible = false;
    void sim;
  }

  private updateIcon(v: View, time: number): void {
    const e = v.e;
    let key: string | null = null;
    if (e.ghost) key = e.status === 'no_materials' ? 'no_materials' : e.status === 'out_of_range' ? 'out_of_range' : null;
    else if (e.status === 'no_power' && BUILDINGS[e.type].power > 0) key = 'no_power';
    else if (e.decon) key = 'decon';
    else if (e.status === 'disabled' && (e.scriptOff || e.off)) key = 'disabled';
    else if (e.hp < BUILDINGS[e.type].hp * 0.6) key = 'damaged';
    if (!key || !this.statusTex[key]) {
      if (v.icon) v.icon.visible = false;
      return;
    }
    if (!v.icon) {
      v.icon = new Sprite(this.statusTex[key]);
      v.icon.anchor.set(0.5, 1);
      this.icons.addChild(v.icon);
    }
    v.icon.texture = this.statusTex[key];
    v.icon.visible = true;
    const [x, y] = iso(e.x + e.w / 2, e.y + e.h / 2);
    v.icon.x = x;
    v.icon.y = y - 18 - Math.min(40, e.w * 10) + Math.sin(time * 4) * 2;
    v.icon.alpha = 0.75 + Math.sin(time * 5) * 0.25;
  }

  private drawWires(sim: Sim): void {
    this.wireVersion = sim.topoVersion;
    const g = this.wires;
    g.clear();
    const poles = sim.list.filter((e) => !e.ghost && BUILDINGS[e.type].poleReach);
    const top = (e: Entity): [number, number] => {
      const [x, y] = iso(e.x + e.w / 2, e.y + e.h / 2);
      const h = e.type === 'hq' ? 120 : e.type === 'big_pole' ? 66 : 42;
      return [x, y - h];
    };
    for (let i = 0; i < poles.length; i++) {
      for (let j = i + 1; j < poles.length; j++) {
        const a = poles[i];
        const b = poles[j];
        if (a.net !== b.net) continue;
        const reach = Math.min(BUILDINGS[a.type].poleReach!, BUILDINGS[b.type].poleReach!) + (a.w + b.w) / 2 - 1;
        const d = Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);
        if (d > reach) continue;
        const [x0, y0] = top(a);
        const [x1, y1] = top(b);
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2 + Math.min(18, d * 1.5);
        g.moveTo(x0, y0).quadraticCurveTo(mx, my, x1, y1).stroke({ color: 0x2a2420, width: 1.2, alpha: 0.85 });
      }
    }
  }

  viewOf(id: number): View | undefined {
    return this.views.get(id);
  }
}

function pipeMask(sim: Sim, e: Entity): number {
  let m = 0;
  for (let d = 0; d < 4; d++) {
    const o = sim.entityAt(e.x + DX[d], e.y + DY[d]);
    if (o && (o.type === 'pipe' || BUILDINGS[o.type].fluid)) m |= 1 << d;
  }
  return m;
}
