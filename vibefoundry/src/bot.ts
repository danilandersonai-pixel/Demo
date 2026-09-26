import type { Sim } from './sim/sim';
import type { Entity } from './sim/types';
import type { Dir } from './core/iso';
import { DX, DY } from './core/iso';
import { BUILDINGS, type BuildingType } from './data/buildings';
import type { ResourceId } from './data/items';
import { connectPower } from './ai/architect';
import { sendRequest, acceptProposal } from './vibe/vibe';

/**
 * Playtest bot: plays the opening by the normal rules (ghosts, construction drones, materials from storage).
 * Used by the Playwright autoplay test through window.__vf.bot.
 */
export class PlaytestBot {
  sim: Sim;
  log: string[] = [];
  done = new Set<string>();
  constructor(sim: Sim) {
    this.sim = sim;
  }

  private note(s: string): void {
    this.log.push(`[${Math.floor(this.sim.time / 60)}:${String(Math.floor(this.sim.time % 60)).padStart(2, '0')}] ${s}`);
  }

  private place(t: BuildingType, x: number, y: number, dir: Dir, recipe?: string): Entity | null {
    return this.sim.place(t, x, y, dir, { recipe });
  }

  private free(x: number, y: number): boolean {
    const w = this.sim.world;
    return w.inBounds(x, y) && !w.occ[w.idx(x, y)] && !w.isWaterAt(x, y) && w.isRevealed(x, y);
  }

  private rectFree(x: number, y: number, ww: number, hh: number): boolean {
    for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + ww; xx++) if (!this.free(xx, yy)) return false;
    return true;
  }

  /** BFS belt path from (sx, sy) to a tile next to the target entity; returns tiles with directions. */
  private beltPath(sx: number, sy: number, target: Entity, maxLen = 70): { x: number; y: number; dir: Dir }[] | null {
    const w = this.sim.world;
    const key = (x: number, y: number) => y * w.w + x;
    const prev = new Map<number, number>();
    const q: [number, number][] = [[sx, sy]];
    prev.set(key(sx, sy), -1);
    let goal: [number, number, Dir] | null = null;
    const inTarget = (x: number, y: number) => x >= target.x && x < target.x + target.w && y >= target.y && y < target.y + target.h;
    while (q.length) {
      const [x, y] = q.shift()!;
      for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (inTarget(nx, ny)) {
          goal = [x, y, d];
          break;
        }
      }
      if (goal) break;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        const k = key(nx, ny);
        if (prev.has(k) || !this.free(nx, ny)) continue;
        if (Math.abs(nx - sx) + Math.abs(ny - sy) > maxLen) continue;
        prev.set(k, key(x, y));
        q.push([nx, ny]);
      }
    }
    if (!goal) return null;
    const tiles: { x: number; y: number }[] = [];
    let k = key(goal[0], goal[1]);
    while (k !== -1) {
      tiles.push({ x: k % w.w, y: Math.floor(k / w.w) });
      k = prev.get(k)!;
    }
    tiles.reverse();
    return tiles.map((t, i) => {
      if (i === tiles.length - 1) return { ...t, dir: goal![2] };
      const n = tiles[i + 1];
      const dir = (n.x > t.x ? 1 : n.x < t.x ? 3 : n.y > t.y ? 2 : 0) as Dir;
      return { ...t, dir };
    });
  }

  /** Drill → smelter → inserter → belt to HQ, on the nearest deposit of `res`. */
  buildMiningCell(res: ResourceId, skip = 0): boolean {
    const sim = this.sim;
    const hq = sim.hq!;
    const deps = sim.world.deposits.filter((d) => d.res === res).sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y));
    let seen = 0;
    for (const dep of deps.slice(0, 3)) {
      for (let r = 0; r <= 6; r++) {
        for (let oy = -r; oy <= r; oy++) {
          for (let ox = -r; ox <= r; ox++) {
            const x = dep.x + ox;
            const y = dep.y + oy;
            let resTiles = 0;
            for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) if (sim.world.resourceAt(xx, yy) === res) resTiles++;
            if (resTiles < 3) continue;
            // drill faces the HQ horizontally
            const dir: Dir = hq.x > x ? 1 : 3;
            const sx = dir === 1 ? x + 2 : x - 2;
            const ix = dir === 1 ? x + 4 : x - 3;
            const bx = dir === 1 ? x + 5 : x - 4;
            if (!this.rectFree(x, y, 2, 2) || !this.rectFree(sx, y, 2, 2) || !this.free(ix, y) || !this.free(bx, y)) continue;
            if (seen++ < skip) continue;
            // reserve tiles by placing; path computed before so the belt doesn't cross the cell
            const drill = this.place('drill', x, y, dir);
            const sm = this.place('smelter', sx, y, dir);
            const ins = this.place('inserter', ix, y, dir);
            if (!drill || !sm || !ins) return false;
            const path = this.beltPath(bx, y, hq);
            if (!path) {
              this.note(`нет пути для ленты от ${res}`);
              return true;
            }
            for (const t of path) this.place('belt', t.x, t.y, t.dir);
            this.note(`ячейка ${res}: бур (${x},${y}), плавильня, лента ${path.length} тайлов до базы`);
            return true;
          }
        }
      }
    }
    return false;
  }

  /** 3×3 assembler fed from the HQ and delivering back into it (HQ as the central store). */
  buildHqModule(recipe: string, side: 'E' | 'W' | 'N' | 'S', type: BuildingType = 'assembler'): boolean {
    const hq = this.sim.hq!;
    const s = BUILDINGS[type].w;
    let ax: number, ay: number, inI: [number, number, Dir], outI: [number, number, Dir];
    switch (side) {
      case 'E':
        ax = hq.x + 6; ay = hq.y + 1; inI = [hq.x + 5, hq.y + 1, 1]; outI = [hq.x + 5, hq.y + 3, 3];
        break;
      case 'W':
        ax = hq.x - 1 - s; ay = hq.y + 1; inI = [hq.x - 1, hq.y + 1, 3]; outI = [hq.x - 1, hq.y + 3, 1];
        break;
      case 'N':
        ax = hq.x + 1; ay = hq.y - 1 - s; inI = [hq.x + 1, hq.y - 1, 0]; outI = [hq.x + 3, hq.y - 1, 2];
        break;
      default:
        ax = hq.x + 1; ay = hq.y + 6; inI = [hq.x + 1, hq.y + 5, 2]; outI = [hq.x + 3, hq.y + 5, 0];
    }
    const m = this.place(type, ax, ay, 1, type === 'lab' ? undefined : recipe);
    const a = this.place('inserter', inI[0], inI[1], inI[2]);
    const b = type === 'lab' ? true : this.place('inserter', outI[0], outI[1], outI[2]);
    if (m && a && b) this.note(`модуль у базы (${side}): ${type === 'lab' ? 'лаборатория' : recipe}`);
    return !!(m && a && b);
  }

  /** One scripted step of the opening, keyed by elapsed game time. */
  tick(): void {
    const t = this.sim.time;
    const once = (id: string, at: number, fn: () => void) => {
      if (t >= at && !this.done.has(id)) {
        this.done.add(id);
        fn();
      }
    };
    // modules hug the HQ (it is the central store); placed first so ore belts route around them
    once('gears', 0, () => this.buildHqModule('gear', 'E'));
    once('science', 0, () => this.buildHqModule('science_mech', 'W'));
    once('lab', 0, () => this.buildHqModule('', 'N', 'lab'));
    once('iron1', 1, () => this.buildMiningCell('iron_ore', 0));
    once('copper1', 2, () => this.buildMiningCell('copper_ore', 0));
    once('iron2', 20, () => this.buildMiningCell('iron_ore', 1));
    once('power', 60, () => this.note(`ЛЭП: +${connectPower(this.sim, { instant: false })} столбов (призраки)`));
    once('copper2', 90, () => this.buildMiningCell('copper_ore', 1));
    once('power2', 120, () => this.note(`ЛЭП: +${connectPower(this.sim, { instant: false })} столбов`));
    once('vibe', 150, () => {
      const r = sendRequest(this.sim, 'Держи запас шестерён на уровне 200.');
      this.note(`вайб-запрос: ${r.ok ? 'отправлен' : r.msg}`);
    });
    once('power3', 260, () => this.note(`ЛЭП: +${connectPower(this.sim, { instant: false })} столбов`));
    once('research', 300, () => {
      this.sim.research.current = 'oil_power';
      this.note('исследование: Нефтяная энергетика');
    });
    once('stone', 320, () => this.buildMiningCell('stone', 0));
    once('power4', 400, () => this.note(`ЛЭП: +${connectPower(this.sim, { instant: false })} столбов`));
    once('research2', 700, () => {
      if (this.sim.research.current === null) this.sim.research.current = 'steel';
    });
    // accept the vibe proposal once it arrives
    const p = this.sim.ai.proposals.find((x) => x.status === 'pending');
    if (p && !this.done.has('accept')) {
      this.done.add('accept');
      const c = acceptProposal(this.sim, p.id);
      this.note(`принят ${c?.version}: ${p.message}`);
    }
    if (this.sim.research.current === null && this.sim.research.done.length && !this.done.has('r' + this.sim.research.done.length)) {
      this.done.add('r' + this.sim.research.done.length);
      const next = ['steel', 'logistics', 'radar', 'silicon'].find((x) => !this.sim.doneSet.has(x));
      if (next) {
        this.sim.research.current = next;
        this.note(`исследование: ${next}`);
      }
    }
  }

  /** Advance the game by `seconds`, letting the bot act every second. */
  run(seconds: number): void {
    for (let s = 0; s < seconds; s++) {
      this.tick();
      this.sim.run(1);
    }
  }
}
