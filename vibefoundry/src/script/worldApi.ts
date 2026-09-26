import { ITEM_INDEX, ITEMS, type ItemId } from '../data/items';
import { RECIPES, recipesFor } from '../data/recipes';
import { BUILDINGS, BUILDING_ALIASES } from '../data/buildings';
import { STATUS_TEXT } from '../sim/types';
import { powerRatio, mainPower } from '../sim/power';
import { dispatchDrone } from '../sim/drones';
import { modelVersion } from '../ai/state';
import type { Sim } from '../sim/sim';
import type { Entity, ToastKind } from '../sim/types';
import { ScriptError } from './lexer';
import { isBuilding, repr, type BuildingRef, type Callable, type ScriptHost, type Value } from './interp';
import { resolveGroup, resolveItem, groupKnown } from './groups';

export interface Claims {
  off: Set<number>;
  on: Set<number>;
  prio: Map<number, number>;
  routes: Map<number, string>;
  balance: Set<number>;
  limits: Map<string, number>;
}

export function newClaims(): Claims {
  return { off: new Set(), on: new Set(), prio: new Map(), routes: new Map(), balance: new Set(), limits: new Map() };
}

export interface LogLine {
  t: number;
  text: string;
  level: 'info' | 'warn' | 'error';
}

export interface ApiContext {
  sim: Sim;
  claims: Claims;
  agent: string;
  log: (text: string, level?: LogLine['level']) => void;
  /** Warnings deduplicated per run (unknown items/groups). */
  warn: (text: string) => void;
}

const fn = (name: string, f: Callable['__fn']): Callable => ({ __fn: f, name });

const NOTIFY_TEXT: Record<string, { title: string; text: string; kind: ToastKind }> = {
  low_energy: { title: 'Нехватка энергии', text: 'Часть производства приостановлена.', kind: 'danger' },
  low_power: { title: 'Нехватка энергии', text: 'Часть производства приостановлена.', kind: 'danger' },
};

function levelKind(level: Value): ToastKind {
  const l = String(level ?? 'info').toLowerCase();
  if (/crit|error|danger|red|alarm/.test(l)) return 'danger';
  if (/warn|yellow/.test(l)) return 'warning';
  if (/succ|ok|green|good/.test(l)) return 'success';
  return 'info';
}

/** Build the host object that connects an interpreter instance with the game world. */
export function makeHost(ctx: ApiContext): ScriptHost {
  const { sim } = ctx;
  const err = (msg: string, line: number): never => {
    throw new ScriptError(msg, line, 0, 'runtime');
  };
  const itemArg = (v: Value, line: number): ItemId | null => {
    if (typeof v !== 'string') err(`Ожидалось имя предмета строкой, получено ${repr(v)}`, line);
    const it = resolveItem(v as string);
    if (!it) ctx.warn(`Неизвестный предмет «${v}» — действие не выполнено`);
    return it;
  };
  const targets = (v: Value, line: number): Entity[] => {
    if (typeof v === 'string') {
      if (!groupKnown(sim, v)) ctx.warn(`Группа «${v}» не найдена — действие не затронуло ни одного здания`);
      return resolveGroup(sim, v);
    }
    if (isBuilding(v)) {
      const e = sim.ents.get(v.id);
      return e ? [e] : [];
    }
    if (Array.isArray(v)) {
      const out: Entity[] = [];
      for (const x of v) out.push(...targets(x, line));
      return out;
    }
    return err(`Ожидалась группа (строка), здание или список, получено ${repr(v)}`, line);
  };
  const bref = (e: Entity): BuildingRef => ({ __b: true, id: e.id });
  const alerts = (): string[] => {
    const out: string[] = [];
    if (mainPower(sim).sat < 0.95) out.push('low_energy');
    if (sim.enemies.length) out.push('enemies');
    if (sim.list.some((e) => e.status === 'no_input' && !e.ghost)) out.push('starved');
    if (sim.list.some((e) => e.status === 'output_full' && !e.ghost)) out.push('blocked');
    return out;
  };

  const api: Record<string, Callable> = {
    stock: fn('stock', (a, _k, line) => {
      const it = itemArg(a[0], line);
      return it ? sim.stock(it) : 0;
    }),
    rate: fn('rate', (a, _k, line) => {
      const it = itemArg(a[0], line);
      return it ? Math.round(sim.stats.rate(it) * 10) / 10 : 0;
    }),
    consumption: fn('consumption', (a, _k, line) => {
      const it = itemArg(a[0], line);
      return it ? Math.round(sim.stats.consumeRate(it) * 10) / 10 : 0;
    }),
    buildings: fn('buildings', (a, _k, line) => targets(a[0] ?? 'all', line).slice(0, 500).map(bref)),
    count: fn('count', (a, _k, line) => {
      const n = String(a[0] ?? '');
      const bt = BUILDING_ALIASES[n] ?? (n in BUILDINGS ? n : null);
      if (bt) return sim.list.filter((e) => e.type === bt && !e.ghost).length;
      return targets(n, line).length;
    }),
    enable: fn('enable', (a, _k, line) => {
      for (const e of targets(a[0], line)) {
        ctx.claims.on.add(e.id);
        ctx.claims.off.delete(e.id);
      }
      return null;
    }),
    disable: fn('disable', (a, _k, line) => {
      for (const e of targets(a[0], line)) {
        if (e.type === 'hq') continue;
        ctx.claims.off.add(e.id);
        ctx.claims.on.delete(e.id);
      }
      return null;
    }),
    set_priority: fn('set_priority', (a, _k, line) => {
      const p = Math.max(1, Math.min(5, Math.round(Number(a[1] ?? 1))));
      for (const e of targets(a[0], line)) ctx.claims.prio.set(e.id, Math.min(p, ctx.claims.prio.get(e.id) ?? 9));
      return null;
    }),
    route: fn('route', (a, _k, line) => {
      const it = itemArg(a[0], line);
      const g = String(a[1] ?? '');
      if (!groupKnown(sim, g)) ctx.warn(`Маршрут в несуществующую группу «${g}»`);
      if (it) ctx.claims.routes.set(ITEM_INDEX[it], g);
      return null;
    }),
    balance: fn('balance', (a, _k, line) => {
      const it = itemArg(a[0], line);
      if (it) ctx.claims.balance.add(ITEM_INDEX[it]);
      return null;
    }),
    limit: fn('limit', (a, _k, line) => {
      const it = itemArg(a[0], line);
      const n = Number(a[1]);
      if (!Number.isFinite(n)) err('limit(item, max): max должен быть числом', line);
      if (it) ctx.claims.limits.set(it, Math.min(n, ctx.claims.limits.get(it) ?? Infinity));
      return null;
    }),
    set_recipe: fn('set_recipe', (a, _k, line) => {
      const it = itemArg(a[1], line);
      if (!it) return false;
      let changed = 0;
      for (const e of targets(a[0], line)) {
        const def = BUILDINGS[e.type];
        if (!def.machine) continue;
        const r = recipesFor(def.machine).find((x) => x.outputs.some((o) => o.item === it));
        if (!r || !sim.isUnlocked(r.unlock)) {
          ctx.warn(`${def.name} не умеет делать «${ITEMS[it].name}»`);
          continue;
        }
        if (e.recipe === r.id) continue;
        for (const bag of [e.inv, e.out]) if (bag) for (const k in bag) {
          if (bag[k] > 0) sim.addStock(k, bag[k]);
          bag[k] = 0;
        }
        e.recipe = r.id;
        e.crafting = false;
        e.progress = 0;
        changed++;
      }
      if (changed) ctx.log(`Рецепт «${ITEMS[it].name}» задан для ${changed} зд.`);
      return changed > 0;
    }),
    notify: fn('notify', (a) => {
      const raw = repr(a[0] ?? '');
      const pre = NOTIFY_TEXT[raw];
      const kind = a[1] !== undefined ? levelKind(a[1]) : pre?.kind ?? 'info';
      if (!sim.headless) sim.toast({ kind, title: pre?.title ?? raw, text: pre ? pre.text : `Агент ${ctx.agent}`, key: `notify:${ctx.agent}:${raw}` });
      ctx.log(`notify: ${raw}`);
      return null;
    }),
    dispatch: fn('dispatch', (a, _k, line) => {
      const kind = String(a[0] ?? 'scout');
      let target: string | { x: number; y: number } = String(a[1] ?? 'nearest_unknown');
      if (Array.isArray(a[1]) && a[1].length === 2) target = { x: Number(a[1][0]), y: Number(a[1][1]) };
      if (sim.headless) return true;
      const r = dispatchDrone(sim, kind, target);
      if (!r.ok) ctx.warn(r.msg);
      else if (r.msg !== 'Разведка уже идёт') ctx.log(r.msg);
      void line;
      return r.ok;
    }),
    build: fn('build', (a) => {
      const name = String(a[0] ?? '');
      const near = String(a[1] ?? 'base');
      const r = sim.architect?.(name, near, ctx.agent);
      if (!r) ctx.warn(`Чертёж «${name}» не найден или некуда поставить`);
      else ctx.log(`Чертёж «${name}» поставлен призраками`);
      return !!r;
    }),
    log: fn('log', (a) => {
      ctx.log(a.map(repr).join(' '));
      return null;
    }),
  };
  api.shutdown = fn('shutdown', (a, k, line) => api.disable.__fn(a, k, line));
  api.print = api.log;

  const builtins: Record<string, Value> = {
    len: fn('len', (a, _k, line) => {
      const v = a[0];
      if (Array.isArray(v) || typeof v === 'string') return v.length;
      if (v && typeof v === 'object' && !isBuilding(v)) return Object.keys(v).length;
      return err(`len() неприменим к ${repr(v)}`, line);
    }),
    min: fn('min', (a) => Math.min(...(Array.isArray(a[0]) && a.length === 1 ? (a[0] as number[]) : (a as number[])))),
    max: fn('max', (a) => Math.max(...(Array.isArray(a[0]) && a.length === 1 ? (a[0] as number[]) : (a as number[])))),
    sum: fn('sum', (a) => (Array.isArray(a[0]) ? (a[0] as number[]).reduce((s, x) => s + Number(x), 0) : 0)),
    abs: fn('abs', (a) => Math.abs(Number(a[0]))),
    round: fn('round', (a) => {
      const d = Number(a[1] ?? 0);
      const f = Math.pow(10, d);
      return Math.round(Number(a[0]) * f) / f;
    }),
    int: fn('int', (a) => Math.trunc(Number(a[0]))),
    float: fn('float', (a) => Number(a[0])),
    str: fn('str', (a) => repr(a[0] ?? null)),
    bool: fn('bool', (a) => !!a[0] && a[0] !== 0 && a[0] !== ''),
    range: fn('range', (a, _k, line) => {
      let start = 0, stop = Number(a[0]), step = 1;
      if (a.length >= 2) {
        start = Number(a[0]);
        stop = Number(a[1]);
      }
      if (a.length >= 3) step = Number(a[2]);
      if (!step) err('range(): шаг не может быть 0', line);
      const out: number[] = [];
      for (let i = start; step > 0 ? i < stop : i > stop; i += step) {
        out.push(i);
        if (out.length > 2000) err('range() слишком большой (> 2000)', line);
      }
      return out;
    }),
    ...api,
  };

  return {
    selfSensor(name: string): Value | undefined {
      switch (name) {
        case 'power':
        case 'energy':
          return Math.round(powerRatio(sim) * 1000) / 1000;
        case 'time':
          return Math.floor(sim.time);
        case 'is_night':
          return sim.isNight;
        case 'day':
          return sim.day;
        case 'alerts':
          return alerts();
        case 'era':
          return sim.ai.era;
        case 'model':
          return Math.round(modelVersion(sim.ai) * 10) / 10;
      }
      return undefined;
    },
    selfApi(name: string) {
      return api[name];
    },
    global(name: string) {
      if (name in builtins) return builtins[name];
      if (name === 'time') return Math.floor(sim.time);
      if (name === 'is_night') return sim.isNight;
      if (name === 'alerts') return alerts();
      if (name === 'power' || name === 'energy') return Math.round(powerRatio(sim) * 1000) / 1000;
      return undefined;
    },
    buildingAttr(ref: BuildingRef, name: string, line: number): Value {
      const e = sim.ents.get(ref.id);
      if (!e) return err('Здание больше не существует', line);
      switch (name) {
        case 'id':
          return e.id;
        case 'type':
          return e.type;
        case 'name':
          return BUILDINGS[e.type].name;
        case 'x':
          return e.x;
        case 'y':
          return e.y;
        case 'status':
          return e.status ?? 'idle';
        case 'status_text':
          return STATUS_TEXT[e.status ?? 'idle'];
        case 'working':
          return e.status === 'working';
        case 'idle':
          return e.status === 'idle' || e.status === 'no_input';
        case 'enabled':
          return !e.off && !e.scriptOff;
        case 'powered':
          return (e.sat ?? 0) > 0.5;
        case 'recipe':
          return e.recipe ? (RECIPES[e.recipe]?.outputs[0].item ?? e.recipe) : null;
        case 'hp':
          return Math.round(e.hp);
      }
      return err(`У здания нет атрибута «${name}»`, line);
    },
  };
}
