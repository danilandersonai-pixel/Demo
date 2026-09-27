import { Container, Sprite, Texture } from 'pixi.js';
import { HALF_H, HALF_W } from '../core/iso';
import { BUILDINGS } from '../data/buildings';
import type { Sim } from '../sim/sim';
import type { TextureBank } from './textures';

const iso = (x: number, y: number): [number, number] => [(x - y) * HALF_W, (x + y) * HALF_H];

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
  grow: number;
  fade: number;
  add: boolean;
}

/** Drones, enemies, map markers and particles. */
export class UnitLayer {
  shadows = new Container();
  air = new Container();
  markers = new Container();
  fxBack = new Container();
  fxAdd = new Container();
  lights = new Container();
  private drones = new Map<number, { s: Sprite; sh: Sprite; l: Sprite }>();
  private enemies = new Map<number, { s: Sprite; sh: Sprite }>();
  private pois = new Map<number, Sprite>();
  private nests: Sprite[] = [];
  private particles: Particle[] = [];
  private pool: Sprite[] = [];
  tex: TextureBank;
  private emitAcc = 0;

  constructor(tex: TextureBank) {
    this.tex = tex;
    this.fxAdd.blendMode = 'add';
    this.lights.blendMode = 'add';
    this.air.sortableChildren = true;
  }

  update(sim: Sim, time: number, alpha: number, dt: number, inView: (x: number, y: number) => boolean): void {
    // drones
    const seen = new Set<number>();
    for (const d of sim.drones) {
      seen.add(d.id);
      let v = this.drones.get(d.id);
      if (!v) {
        const s = new Sprite(this.tex.drones.get(d.kind) ?? Texture.WHITE);
        s.anchor.set(0.5, 0.5);
        const sh = new Sprite(this.tex.shadow);
        sh.anchor.set(0.5, 0.5);
        const l = new Sprite(this.tex.glowTex);
        l.anchor.set(0.5, 0.5);
        l.scale.set(0.25);
        this.air.addChild(s);
        this.shadows.addChild(sh);
        this.lights.addChild(l);
        v = { s, sh, l };
        this.drones.set(d.id, v);
      }
      const x = d.px + (d.x - d.px) * alpha;
      const y = d.py + (d.y - d.py) * alpha;
      const [sx, sy] = iso(x, y);
      const idle = d.state === 'idle';
      const alt = idle ? 26 : d.kind === 'engineer' ? 6 : 40;
      const bob = Math.sin(time * 4 + d.id) * 2;
      v.s.x = sx + (idle ? Math.cos(time * 0.7 + d.id * 1.7) * 14 : 0);
      v.s.y = sy - alt + bob + (idle ? Math.sin(time * 0.7 + d.id * 1.7) * 7 : 0);
      v.s.zIndex = y + x;
      v.s.scale.x = Math.cos(d.ang) - Math.sin(d.ang) >= 0 ? 1 : -1;
      v.s.tint = d.state === 'rogue' ? 0xff6a5a : 0xffffff;
      v.sh.x = v.s.x;
      v.sh.y = sy + (idle ? Math.sin(time * 0.7 + d.id * 1.7) * 7 : 0);
      v.sh.alpha = d.kind === 'engineer' ? 0.6 : 0.35;
      v.l.x = v.s.x;
      v.l.y = v.s.y + 2;
      v.l.tint = d.state === 'rogue' ? 0xff3a2a : d.kind === 'combat' ? 0xff5a4a : d.kind === 'construction' ? 0xffc84a : 0x66d8ff;
      v.l.alpha = 0.4 + (Math.sin(time * 8 + d.id) > 0.6 ? 0.6 : 0);
      const vis = inView(x, y);
      v.s.visible = v.sh.visible = v.l.visible = vis;
    }
    for (const [id, v] of this.drones) if (!seen.has(id)) {
      v.s.destroy();
      v.sh.destroy();
      v.l.destroy();
      this.drones.delete(id);
    }
    // enemies
    const seenE = new Set<number>();
    for (const en of sim.enemies) {
      seenE.add(en.id);
      let v = this.enemies.get(en.id);
      if (!v) {
        const s = new Sprite(this.tex.enemy);
        s.anchor.set(0.5, 0.8);
        const sh = new Sprite(this.tex.shadow);
        sh.anchor.set(0.5, 0.5);
        sh.scale.set(0.8);
        this.air.addChild(s);
        this.shadows.addChild(sh);
        v = { s, sh };
        this.enemies.set(en.id, v);
      }
      const x = en.px + (en.x - en.px) * alpha;
      const y = en.py + (en.y - en.py) * alpha;
      const [sx, sy] = iso(x, y);
      v.s.x = sx;
      v.s.y = sy + Math.abs(Math.sin(time * 10 + en.id)) * -2;
      v.s.zIndex = x + y;
      v.sh.x = sx;
      v.sh.y = sy;
      v.s.visible = v.sh.visible = sim.world.isRevealed(Math.floor(x), Math.floor(y));
    }
    for (const [id, v] of this.enemies) if (!seenE.has(id)) {
      v.s.destroy();
      v.sh.destroy();
      this.enemies.delete(id);
    }
    // POI markers
    for (const p of sim.world.pois) {
      let s = this.pois.get(p.id);
      if (!s) {
        s = new Sprite(this.tex.poi);
        s.anchor.set(0.5, 1);
        this.markers.addChild(s);
        this.pois.set(p.id, s);
      }
      s.visible = !p.explored;
      const [sx, sy] = iso(p.x + 0.5, p.y + 0.5);
      s.x = sx;
      s.y = sy - 6 + Math.sin(time * 2 + p.id) * 3;
    }
    if (!this.nests.length) {
      for (const n of sim.world.nests) {
        const s = new Sprite(this.tex.nest);
        s.anchor.set(0.5, 1);
        const [sx, sy] = iso(n.x + 0.5, n.y + 0.5);
        s.x = sx;
        s.y = sy;
        this.markers.addChild(s);
        this.nests.push(s);
      }
    }
    sim.world.nests.forEach((n, i) => {
      if (this.nests[i]) this.nests[i].visible = sim.world.isRevealed(n.x, n.y);
    });
    this.emitAmbient(sim, dt, inView);
    this.stepParticles(dt);
  }

  // ------------------------------------------------------------ particles
  private get(tex: Texture, add: boolean): Sprite {
    let s = this.pool.pop();
    if (!s) {
      s = new Sprite(tex);
      s.anchor.set(0.5, 0.5);
    }
    s.texture = tex;
    s.visible = true;
    (add ? this.fxAdd : this.fxBack).addChild(s);
    return s;
  }

  spawn(kind: 'smoke' | 'steam' | 'spark' | 'dust' | 'explode' | 'build' | 'shot' | 'glint', x: number, y: number, z = 0, x2?: number, y2?: number): void {
    if (this.particles.length > 900) return;
    const [sx, sy] = iso(x, y);
    const py = sy - z;
    const P = (tex: Texture, add: boolean, vx: number, vy: number, life: number, scale: number, grow: number, tint: number, alpha: number) => {
      const s = this.get(tex, add);
      s.x = sx;
      s.y = py;
      s.scale.set(scale);
      s.tint = tint;
      s.alpha = alpha;
      s.rotation = 0;
      this.particles.push({ s, vx, vy, life, max: life, grow, fade: alpha, add });
      return s;
    };
    switch (kind) {
      case 'smoke':
        P(this.tex.smoke, false, 3 + Math.random() * 4, -14 - Math.random() * 6, 3.2, 0.35, 0.45, 0x4a4a4e, 0.55);
        break;
      case 'steam':
        P(this.tex.smoke, false, 2 + Math.random() * 3, -18 - Math.random() * 6, 3.6, 0.45, 0.6, 0xe8eef2, 0.5);
        break;
      case 'spark':
        for (let i = 0; i < 3; i++) P(this.tex.spark, true, (Math.random() - 0.5) * 60, -30 - Math.random() * 40, 0.45, 0.35, -0.3, 0xffa04a, 1);
        break;
      case 'dust':
        P(this.tex.smoke, false, (Math.random() - 0.5) * 10, -4, 1.4, 0.25, 0.3, 0x8a7a60, 0.4);
        break;
      case 'explode':
        P(this.tex.glowTex, true, 0, 0, 0.5, 0.6, 2.5, 0xff8a3a, 1);
        for (let i = 0; i < 6; i++) P(this.tex.spark, true, (Math.random() - 0.5) * 120, -20 - Math.random() * 80, 0.7, 0.45, -0.3, 0xffc070, 1);
        for (let i = 0; i < 4; i++) P(this.tex.smoke, false, (Math.random() - 0.5) * 20, -10 - Math.random() * 10, 2, 0.4, 0.5, 0x2a2a2e, 0.7);
        break;
      case 'build':
        P(this.tex.glowTex, true, 0, 0, 0.6, 0.4, 2.2, 0x66d8ff, 0.9);
        for (let i = 0; i < 6; i++) P(this.tex.spark, true, (Math.random() - 0.5) * 70, -20 - Math.random() * 40, 0.6, 0.3, -0.2, 0x9ae8ff, 1);
        break;
      case 'glint': {
        const s = P(this.tex.spark, true, (Math.random() - 0.5) * 6, 0, 1.6, 0.18, 0, 0xbfe8ff, 0.55);
        s.scale.set(0.35, 0.12);
        break;
      }
      case 'shot': {
        if (x2 === undefined || y2 === undefined) break;
        const [ex, ey] = iso(x2, y2);
        const s = P(Texture.WHITE, true, 0, 0, 0.12, 1, 0, 0xff5a4a, 1);
        s.anchor.set(0, 0.5);
        const dx = ex - sx;
        const dy = ey - 8 - py;
        s.width = Math.hypot(dx, dy);
        s.height = 2;
        s.rotation = Math.atan2(dy, dx);
        break;
      }
    }
  }

  private stepParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        p.s.parent?.removeChild(p.s);
        this.pool.push(p.s);
        this.particles.splice(i, 1);
        continue;
      }
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      if (p.add && p.grow < 0) p.vy += 120 * dt;
      const k = p.life / p.max;
      if (p.grow !== 0 && p.s.texture !== Texture.WHITE) p.s.scale.set(Math.max(0.05, p.s.scale.x + p.grow * dt));
      p.s.alpha = p.fade * Math.min(1, k * 1.5);
    }
  }

  /** Chimney smoke, cooling-tower steam, sparks and drill dust from working buildings. */
  private emitAmbient(sim: Sim, dt: number, inView: (x: number, y: number) => boolean): void {
    this.emitAcc += dt;
    if (this.emitAcc < 0.12) return;
    this.emitAcc = 0;
    for (const e of sim.list) {
      if (e.ghost || e.status !== 'working') continue;
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      if (!inView(cx, cy)) continue;
      const r = Math.random();
      switch (e.type) {
        case 'smelter':
          if (r < 0.5) this.spawn('smoke', e.x + 1.35, e.y + 0.65, 66);
          if (r < 0.12) this.spawn('spark', e.x + 1, e.y + 1.9, 10);
          break;
        case 'power_plant':
          if (r < 0.6) this.spawn('steam', e.x + 0.85, e.y + 0.8, 54);
          if (r > 0.4) this.spawn('steam', e.x + 2.1, e.y + 0.75, 50);
          break;
        case 'reactor':
          if (r < 0.7) this.spawn('steam', e.x + 3.8, e.y + 1.2, 76);
          break;
        case 'chem':
          if (r < 0.2) this.spawn('steam', e.x + 0.9, e.y + 0.8, 48);
          break;
        case 'drill':
          if (r < 0.25) this.spawn('dust', cx + (Math.random() - 0.5), cy + (Math.random() - 0.5), 4);
          break;
        case 'hq':
          if (r < 0.08) this.spawn('steam', e.x + 1.2, e.y + 1.2, 54);
          break;
      }
      void BUILDINGS;
    }
  }
}
