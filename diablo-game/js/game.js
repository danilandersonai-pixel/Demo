// Game orchestration: state, input, update (movement/AI/combat/loot), descend.

import { makeRng } from './rng.js';
import { Dungeon } from './dungeon.js';
import { findPath } from './pathfind.js';
import { screenToGrid } from './iso.js';
import { makePlayer, spawnMonster, levelUpPlayer } from './entities.js';

const VISION = 7;

function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

export class Game {
  constructor(renderer, ui) {
    this.renderer = renderer;
    this.ui = ui;
    this.state = 'start';
    this.time = 0;
    this.messages = [];
    this.floatTexts = [];
    this.marker = null;
  }

  newGame(seed) {
    this.seed = (seed >>> 0) || 1;
    this.depth = 1;
    this.player = makePlayer(0, 0);
    this._loadLevel();
    this.state = 'playing';
    this.message('Добро пожаловать в подземелье.');
  }

  _loadLevel() {
    const d = new Dungeon(this.seed, this.depth);
    this.dungeon = d;
    this.explored = new Uint8Array(d.W * d.H);
    this.monsters = [];
    this.items = [];
    this.projectiles = [];
    this.floatTexts = [];
    this.marker = null;

    const p = this.player;
    p.x = d.spawn.x; p.y = d.spawn.y;
    p.path = null; p.target = null; p.pathI = 0;

    // Monsters scale with depth.
    const rng = d.rng;
    const count = 6 + this.depth * 2;
    const pool = this.depth < 2 ? ['fallen', 'skeleton']
      : this.depth < 4 ? ['fallen', 'skeleton', 'zombie']
        : ['skeleton', 'zombie', 'zombie', 'demon'];
    for (let i = 0; i < count; i++) {
      const t = d.randomSpawnTile(true);
      if (!t) break;
      if (dist(t.x, t.y, p.x, p.y) < 5) continue; // not on top of the player
      this.monsters.push(spawnMonster(rng.pick(pool), t.x, t.y, this.depth));
    }
    // A couple of floor potions.
    for (let i = 0; i < 2; i++) {
      const t = d.randomSpawnTile(true);
      if (t) this.items.push({ type: 'potion', x: t.x, y: t.y });
    }
    this._updateVision();
  }

  descend() {
    this.depth++;
    this.message(`Спуск на уровень ${this.depth}…`);
    this._loadLevel();
  }

  message(text) { this.messages.push({ text, t: this.time }); }

  floatText(x, y, text, color) { this.floatTexts.push({ x, y, text, color, life: 1 }); }

  // --- input -------------------------------------------------------------------
  handleTap(clientX, clientY) {
    if (this.state !== 'playing') return;
    const sp = this.renderer.screenToWorldPx(clientX, clientY);
    const g = screenToGrid(sp.x, sp.y);
    const p = this.player;

    // Tap a (visible) monster -> target it.
    let best = null, bestD = 0.85;
    for (const m of this.monsters) {
      const dd = dist(g.x, g.y, m.x, m.y);
      if (dd < bestD && this.explored[this.dungeon.idx(m.x | 0, m.y | 0)]) { best = m; bestD = dd; }
    }
    if (best) {
      p.target = best;
      p.path = null;
      this.marker = { x: best.x, y: best.y, life: 0.6 };
      return;
    }

    // Otherwise move to the tapped tile.
    const tx = Math.floor(g.x), ty = Math.floor(g.y);
    if (!this.dungeon.walkable(tx, ty)) return;
    p.target = null;
    const path = findPath(p.x | 0, p.y | 0, tx, ty, (x, y) => this.dungeon.walkable(x, y));
    if (path && path.length) { p.path = path; p.pathI = 0; this.marker = { x: tx + 0.5, y: ty + 0.5, life: 1 }; }
  }

  drinkPotion() {
    const p = this.player;
    if (this.state !== 'playing' || p.potions <= 0 || p.hp >= p.maxHp) return;
    p.potions--;
    const heal = Math.round(p.maxHp * 0.5);
    p.hp = Math.min(p.maxHp, p.hp + heal);
    this.floatText(p.x, p.y, '+' + heal, 'rgba(120,230,120,ALPHA)');
    this.message('Выпито зелье лечения.');
  }

  castSpell() {
    const p = this.player;
    if (this.state !== 'playing' || p.spellLeft > 0) return;
    if (p.mana < p.spellCost) { this.message('Недостаточно маны.'); return; }
    let target = (p.target && p.target.hp > 0 && dist(p.x, p.y, p.target.x, p.target.y) <= p.spellRange) ? p.target : null;
    if (!target) {
      let bd = p.spellRange;
      for (const m of this.monsters) {
        const dd = dist(p.x, p.y, m.x, m.y);
        if (dd < bd) { bd = dd; target = m; }
      }
    }
    if (!target) { this.message('Нет цели для заклинания.'); return; }
    p.mana -= p.spellCost; p.spellLeft = p.spellCd;
    const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy) || 1;
    p.facing = (dx - dy) >= 0 ? 1 : -1;
    this.projectiles.push({
      x: p.x, y: p.y, dx: dx / d, dy: dy / d, speed: 9,
      dmg: this.player.spellDmgMin + Math.floor(Math.random() * (p.spellDmgMax - p.spellDmgMin + 1)),
      life: 1.4,
    });
  }

  // --- update ------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    if (this.state !== 'playing') return;
    const p = this.player;

    p.atkLeft -= dt; p.spellLeft -= dt; if (p.hitFlash > 0) p.hitFlash -= dt;
    if (this.marker) { this.marker.life -= dt * 1.1; if (this.marker.life <= 0) this.marker = null; }

    this._updatePlayer(dt);
    this._updateMonsters(dt);
    this._updateProjectiles(dt);
    this._pickup();
    this._updateVision();

    for (const f of this.floatTexts) f.life -= dt * 0.8;
    this.floatTexts = this.floatTexts.filter((f) => f.life > 0);

    // Stand on stairs -> descend.
    if ((p.x | 0) === this.dungeon.stairs.x && (p.y | 0) === this.dungeon.stairs.y && !p.path) {
      this.descend();
    }
  }

  _moveToward(e, tx, ty, step) {
    const dx = tx - e.x, dy = ty - e.y;
    const d = Math.hypot(dx, dy);
    if (d <= step || d === 0) { e.x = tx; e.y = ty; return true; }
    e.x += (dx / d) * step; e.y += (dy / d) * step;
    e.facing = (dx - dy) >= 0 ? 1 : -1;
    return false;
  }

  _follow(e, step) {
    if (!e.path || e.pathI >= e.path.length) { e.path = null; return; }
    const n = e.path[e.pathI];
    if (this._moveToward(e, n.x + 0.5, n.y + 0.5, step)) e.pathI++;
    if (e.pathI >= e.path.length) e.path = null;
  }

  _updatePlayer(dt) {
    const p = this.player;
    // Auto-engage an adjacent monster when idle (so bumping an enemy attacks it).
    if (!p.target && !p.path) {
      let best = null, bd = p.range + 0.5;
      for (const m of this.monsters) {
        const d = dist(p.x, p.y, m.x, m.y);
        if (d < bd) { bd = d; best = m; }
      }
      if (best) p.target = best;
    }
    if (p.target) {
      if (p.target.hp <= 0) { p.target = null; }
      else {
        const d = dist(p.x, p.y, p.target.x, p.target.y);
        if (d <= p.range) {
          p.path = null;
          p.facing = (p.target.x - p.x - (p.target.y - p.y)) >= 0 ? 1 : -1;
          if (p.atkLeft <= 0) {
            const dmg = p.dmgMin + Math.floor(Math.random() * (p.dmgMax - p.dmgMin + 1));
            this._hitMonster(p.target, dmg);
            p.atkLeft = p.atkCd;
          }
          return;
        }
        p.retarget = (p.retarget || 0) - dt;
        if (!p.path || p.pathI >= p.path.length || p.retarget <= 0) {
          p.path = findPath(p.x | 0, p.y | 0, p.target.x | 0, p.target.y | 0, (x, y) => this.dungeon.walkable(x, y));
          p.pathI = 0; p.retarget = 0.3;
        }
      }
    }
    if (p.path) this._follow(p, p.speed * dt);
  }

  _updateMonsters(dt) {
    const p = this.player;
    for (const m of this.monsters) {
      m.cdLeft -= dt; if (m.hitFlash > 0) m.hitFlash -= dt;
      const d = dist(m.x, m.y, p.x, p.y);
      if (m.state === 'idle') { if (d <= m.aggro) m.state = 'chase'; else continue; }

      if (d <= m.range) {
        m.path = null;
        m.facing = (p.x - m.x - (p.y - m.y)) >= 0 ? 1 : -1;
        if (m.cdLeft <= 0) {
          m.cdLeft = m.cd;
          p.hp -= m.dmg; p.hitFlash = 0.12;
          this.floatText(p.x, p.y, '-' + m.dmg, 'rgba(255,90,80,ALPHA)');
          if (p.hp <= 0) { p.hp = 0; this._gameOver(); return; }
        }
      } else if (d <= m.aggro * 1.7) {
        m.retarget -= dt;
        if (!m.path || m.pathI >= m.path.length || m.retarget <= 0) {
          m.path = findPath(m.x | 0, m.y | 0, p.x | 0, p.y | 0, (x, y) => this.dungeon.walkable(x, y), 1500);
          m.pathI = 0; m.retarget = 0.4;
        }
        if (m.path) this._follow(m, m.speed * dt);
      } else {
        m.state = 'idle'; m.path = null;
      }
    }
  }

  _updateProjectiles(dt) {
    for (const pr of this.projectiles) {
      pr.life -= dt;
      pr.x += pr.dx * pr.speed * dt;
      pr.y += pr.dy * pr.speed * dt;
      const tx = pr.x | 0, ty = pr.y | 0;
      if (!this.dungeon.walkable(tx, ty)) { pr.life = 0; continue; }
      for (const m of this.monsters) {
        if (dist(pr.x, pr.y, m.x, m.y) < m.r + 0.35) {
          this._hitMonster(m, pr.dmg);
          pr.life = 0;
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => pr.life > 0);
  }

  _hitMonster(m, dmg) {
    m.hp -= dmg;
    m.hitFlash = 0.12;
    m.state = 'chase';
    this.floatText(m.x, m.y, '' + dmg, 'rgba(255,255,255,ALPHA)');
    if (m.hp <= 0) this._killMonster(m);
  }

  _killMonster(m) {
    const p = this.player;
    p.xp += m.xp;
    this.floatText(m.x, m.y - 0.3, '+' + m.xp + ' XP', 'rgba(130,220,255,ALPHA)');
    const rng = this.dungeon.rng;
    const gold = rng.int(m.goldMin, m.goldMax);
    if (gold > 0) this.items.push({ type: 'gold', x: m.x, y: m.y, amount: gold });
    if (rng.chance(0.12)) this.items.push({ type: 'potion', x: m.x + 0.2, y: m.y + 0.2 });
    this.monsters = this.monsters.filter((x) => x !== m);
    if (p.target === m) p.target = null;

    while (p.xp >= p.xpNext) {
      levelUpPlayer(p);
      this.floatText(p.x, p.y - 0.5, 'УРОВЕНЬ ' + p.level + '!', 'rgba(255,220,120,ALPHA)');
      this.message('Новый уровень: ' + p.level + '!');
    }
  }

  _pickup() {
    const p = this.player;
    for (const it of this.items) {
      if (dist(p.x, p.y, it.x, it.y) < 0.55) {
        if (it.type === 'gold') { p.gold += it.amount; this.message('Найдено золото: ' + it.amount + '.'); }
        else { p.potions++; this.message('Найдено зелье лечения.'); }
        it._gone = true;
      }
    }
    if (this.items.some((i) => i._gone)) this.items = this.items.filter((i) => !i._gone);
  }

  _updateVision() {
    const d = this.dungeon, p = this.player;
    const px = p.x | 0, py = p.y | 0;
    for (let dy = -VISION; dy <= VISION; dy++) {
      for (let dx = -VISION; dx <= VISION; dx++) {
        if (dx * dx + dy * dy > VISION * VISION) continue;
        const x = px + dx, y = py + dy;
        if (x >= 0 && y >= 0 && x < d.W && y < d.H) this.explored[d.idx(x, y)] = 1;
      }
    }
  }

  _gameOver() {
    this.state = 'dead';
    this.player.target = null; this.player.path = null;
    document.getElementById('deathDepth').textContent = this.depth;
    document.getElementById('deathLevel').textContent = this.player.level;
    document.getElementById('death').classList.add('show');
  }

  render() {
    const r = this.renderer;
    r.resize();
    if (!this.player) { r.clear(); return; } // before the first game starts
    r.setCamera(this.player.x, this.player.y);
    r.clear();
    r.drawWorld(this);
    r.drawLighting(this.player);
    this.ui.drawOverlay(r.ctx, r, this);
    this.ui.syncDOM(this);
  }
}
