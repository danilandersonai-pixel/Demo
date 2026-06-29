// Canvas-2D isometric renderer: floor, wall blocks, creatures, items,
// projectiles (depth-sorted) and a torch-light / fog-of-war overlay.

import { TILE_W, TILE_H, HW, HH, WALL_H, gridToScreen } from './iso.js';
import { FLOOR, WALL, STAIRS } from './dungeon.js';

const WINDOW = 18; // tiles around the player to consider each frame

function hash(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ox = 0; this.oy = 0;
    this.dpr = 1;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.dpr = dpr;
    this.W = this.canvas.width; this.H = this.canvas.height;
  }

  setCamera(px, py) {
    const s = gridToScreen(px, py);
    this.ox = this.W / 2 - s.x;
    this.oy = this.H / 2 - s.y;
  }

  worldToScreen(gx, gy) {
    const s = gridToScreen(gx, gy);
    return { x: s.x + this.ox, y: s.y + this.oy };
  }

  screenToWorldPx(clientX, clientY) {
    // client px -> canvas px (account for DPR) -> camera-relative
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * this.dpr - this.ox;
    const y = (clientY - rect.top) * this.dpr - this.oy;
    return { x, y };
  }

  clear() {
    const ctx = this.ctx;
    ctx.fillStyle = '#070608';
    ctx.fillRect(0, 0, this.W, this.H);
  }

  _diamond(ctx, cx, cy, dh = 0) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - HH - dh);
    ctx.lineTo(cx + HW, cy - dh);
    ctx.lineTo(cx, cy + HH - dh);
    ctx.lineTo(cx - HW, cy - dh);
    ctx.closePath();
  }

  drawWorld(game) {
    const ctx = this.ctx;
    const d = game.dungeon;
    const exp = game.explored;
    const p = game.player;
    const pcx = p.x | 0, pcy = p.y | 0;
    const objs = []; // depth-sorted tall things

    // Floor pass (flat) + collect walls.
    for (let y = pcy - WINDOW; y <= pcy + WINDOW; y++) {
      for (let x = pcx - WINDOW; x <= pcx + WINDOW; x++) {
        if (x < 0 || y < 0 || x >= d.W || y >= d.H) continue;
        if (!exp[d.idx(x, y)]) continue;
        const t = d.tiles[d.idx(x, y)];
        if (t === FLOOR || t === STAIRS) {
          const s = this.worldToScreen(x + 0.5, y + 0.5);
          if (s.x < -TILE_W || s.x > this.W + TILE_W || s.y < -TILE_H || s.y > this.H + TILE_H) continue;
          this._floor(ctx, s.x, s.y, x, y, t === STAIRS);
        } else if (t === WALL) {
          const s = this.worldToScreen(x + 0.5, y + 0.5);
          if (s.x < -TILE_W || s.x > this.W + TILE_W || s.y < -TILE_H - WALL_H || s.y > this.H + TILE_H) continue;
          objs.push({ d: x + y - 0.001, fn: () => this._wall(ctx, s.x, s.y, x, y) });
        }
      }
    }

    // Items.
    for (const it of game.items) {
      const s = this.worldToScreen(it.x, it.y);
      objs.push({ d: it.x + it.y, fn: () => this._item(ctx, s.x, s.y, it, game.time) });
    }
    // Monsters.
    for (const m of game.monsters) {
      const s = this.worldToScreen(m.x, m.y);
      objs.push({ d: m.x + m.y, fn: () => this._creature(ctx, s.x, s.y, m, game.time, false) });
    }
    // Player.
    {
      const s = this.worldToScreen(p.x, p.y);
      objs.push({ d: p.x + p.y, fn: () => this._creature(ctx, s.x, s.y, p, game.time, true) });
    }
    // Projectiles.
    for (const pr of game.projectiles) {
      const s = this.worldToScreen(pr.x, pr.y);
      objs.push({ d: pr.x + pr.y + 0.5, fn: () => this._bolt(ctx, s.x, s.y, game.time) });
    }

    objs.sort((a, b) => a.d - b.d);
    for (const o of objs) o.fn();
  }

  _floor(ctx, cx, cy, gx, gy, stairs) {
    const v = hash(gx, gy);
    const base = stairs ? 70 : 52 + Math.floor(v * 14);
    ctx.fillStyle = `rgb(${base - 6},${base - 4},${base + 4})`;
    this._diamond(ctx, cx, cy);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (stairs) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(cx - 10, cy - 8 + i * 6, 20, 3);
      }
      ctx.fillStyle = 'rgba(255,220,150,0.5)';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('▼', cx, cy + 5);
    }
  }

  _wall(ctx, cx, cy, gx, gy) {
    const v = hash(gx + 7, gy - 3) * 12;
    // left and right faces
    ctx.fillStyle = `rgb(${58 + v},${58 + v},${66 + v})`;
    ctx.beginPath();
    ctx.moveTo(cx - HW, cy);
    ctx.lineTo(cx, cy + HH);
    ctx.lineTo(cx, cy + HH - WALL_H);
    ctx.lineTo(cx - HW, cy - WALL_H);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = `rgb(${40 + v},${40 + v},${47 + v})`;
    ctx.beginPath();
    ctx.moveTo(cx + HW, cy);
    ctx.lineTo(cx, cy + HH);
    ctx.lineTo(cx, cy + HH - WALL_H);
    ctx.lineTo(cx + HW, cy - WALL_H);
    ctx.closePath(); ctx.fill();

    // top face
    ctx.fillStyle = `rgb(${84 + v},${84 + v},${92 + v})`;
    this._diamond(ctx, cx, cy, WALL_H);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1; ctx.stroke();
  }

  _creature(ctx, cx, cy, e, time, isPlayer) {
    const size = e.r * TILE_W;
    const bob = Math.sin(time * 4 + e.bob) * (e.path ? 1.5 : 0.8);
    const feetY = cy - bob;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, size * 0.95, size * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    const bodyH = size * 1.9;
    const bw = size * 0.95;
    const topY = feetY - bodyH;
    const flash = e.hitFlash > 0;
    const body = flash ? '#ffffff' : e.body || '#4a6cb0';
    const dark = flash ? '#ffd0d0' : (isPlayer ? '#2a3f73' : e.dark);

    // body capsule
    ctx.fillStyle = body;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    roundRect(ctx, cx - bw / 2, topY + size * 0.5, bw, bodyH - size * 0.5, bw * 0.45);
    ctx.fill(); ctx.stroke();
    // shaded side
    ctx.fillStyle = dark;
    roundRect(ctx, cx - bw / 2, topY + size * 0.5, bw * 0.4, bodyH - size * 0.5, bw * 0.4);
    ctx.fill();

    // head
    const headR = size * 0.5;
    ctx.fillStyle = flash ? '#fff' : (isPlayer ? '#e6c2a0' : body);
    ctx.beginPath();
    ctx.arc(cx, topY + size * 0.45, headR, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    if (isPlayer) {
      // simple sword on the facing side
      ctx.strokeStyle = '#d8dde6'; ctx.lineWidth = 3;
      const fx = e.facing >= 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(cx + fx * bw * 0.55, feetY - size * 0.8);
      ctx.lineTo(cx + fx * bw * 0.95, feetY - bodyH * 0.95);
      ctx.stroke();
    } else {
      // menacing eyes
      ctx.fillStyle = '#1a0000';
      const ey = topY + size * 0.42;
      ctx.fillRect(cx - headR * 0.5, ey, headR * 0.35, headR * 0.3);
      ctx.fillRect(cx + headR * 0.18, ey, headR * 0.35, headR * 0.3);
    }

    // health bar for hurt/aggro monsters
    if (!isPlayer && (e.hp < e.maxHp || e.state === 'chase' || e.state === 'attack')) {
      const w = size * 1.7, h = 4, by = topY - 7;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(cx - w / 2, by, w, h);
      ctx.fillStyle = '#c0392b'; ctx.fillRect(cx - w / 2, by, w * Math.max(0, e.hp / e.maxHp), h);
    }
  }

  _item(ctx, cx, cy, it, time) {
    const glow = 0.5 + 0.5 * Math.sin(time * 3 + cx);
    if (it.type === 'gold') {
      ctx.fillStyle = `rgba(255,215,90,${0.25 + 0.25 * glow})`;
      ctx.beginPath(); ctx.ellipse(cx, cy, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffcf3a'; ctx.strokeStyle = '#a8730f'; ctx.lineWidth = 1;
      for (const [dx, dy] of [[-3, 1], [3, 1], [0, -2]]) {
        ctx.beginPath(); ctx.ellipse(cx + dx, cy + dy, 4, 2.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    } else { // potion
      ctx.fillStyle = `rgba(220,60,60,${0.2 + 0.25 * glow})`;
      ctx.beginPath(); ctx.arc(cx, cy - 4, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d83a3a'; ctx.strokeStyle = '#5a1515'; ctx.lineWidth = 1.5;
      roundRect(ctx, cx - 4, cy - 9, 8, 10, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9aa'; ctx.fillRect(cx - 2, cy - 12, 4, 3);
    }
  }

  _bolt(ctx, cx, cy, time) {
    const r = 9 + Math.sin(time * 20) * 1.5;
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    g.addColorStop(0, 'rgba(255,250,210,1)');
    g.addColorStop(0.4, 'rgba(255,160,40,0.95)');
    g.addColorStop(1, 'rgba(200,40,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }

  drawLighting(player) {
    const ctx = this.ctx;
    const s = this.worldToScreen(player.x, player.y);
    const R = 8.2 * HW * this.dpr / this.dpr; // pixels
    const cy = s.y - 18;
    const g = ctx.createRadialGradient(s.x, cy, R * 0.12, s.x, cy, R);
    g.addColorStop(0, 'rgba(10,7,4,0)');
    g.addColorStop(0.55, 'rgba(8,6,8,0.30)');
    g.addColorStop(1, 'rgba(2,2,5,0.88)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);

    // warm torch core (additive)
    ctx.globalCompositeOperation = 'lighter';
    const wg = ctx.createRadialGradient(s.x, cy, 1, s.x, cy, R * 0.5);
    wg.addColorStop(0, 'rgba(120,70,25,0.22)');
    wg.addColorStop(1, 'rgba(120,70,25,0)');
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
