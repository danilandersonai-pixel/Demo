import type { Sim } from '../sim/sim';
import type { ClassDef } from './ast';
import { parse } from './parser';
import { ScriptError } from './lexer';
import { Interpreter, type Value } from './interp';
import { makeHost, newClaims, type Claims, type LogLine } from './worldApi';
import { resolveGroup } from './groups';
import { headFiles } from '../vibe/git';
import { SCRIPT_SLOTS } from '../ai/eras';
import { BELTLIKE } from '../data/buildings';
import { DX, DY } from '../core/iso';

export const BASE_BUDGET = 500;
const COMPUTE_PER_OP = 0.004;

export interface Instance {
  key: string;
  file: string;
  cls: ClassDef;
  every: number;
  timer: number;
  fields: Record<string, Value>;
  claims: Claims;
  status: 'ok' | 'error' | 'no_compute' | 'no_slot' | 'idle';
  error?: { line: number; message: string; kind: string };
  lastOps: number;
  runs: number;
  logs: LogLine[];
  lastRunAt: number;
  warnings: string[];
}

export interface FileStatus {
  file: string;
  ok: boolean;
  error?: { line: number; message: string };
  classes: string[];
  active: boolean;
}

/** Executes the automation code at git HEAD: one interpreter instance per agent class. */
export class ScriptRuntime {
  instances: Instance[] = [];
  fileStatus: FileStatus[] = [];
  private current: Record<string, string> = {};
  private dirty = true;
  private effectsDirty = true;
  private routeKey = '';
  opsLastSecond = 0;
  private opsAcc = 0;
  private lastSecond = 0;
  private savedFields: Record<string, Record<string, Value>> = {};
  budget = BASE_BUDGET;

  invalidate(): void {
    this.routeKey = '';
    this.effectsDirty = true;
  }

  files(): Record<string, string> {
    return this.current;
  }

  loadFromGit(sim: Sim): void {
    this.current = { ...headFiles(sim.git) };
    this.dirty = true;
  }

  /** Force the given file set (sandbox branches, tests). */
  setFiles(files: Record<string, string>): void {
    this.current = { ...files };
    this.dirty = true;
  }

  private compile(sim: Sim): void {
    this.dirty = false;
    const prev = new Map(this.instances.map((i) => [i.key, i]));
    const slots = SCRIPT_SLOTS[sim.ai.era] ?? 1;
    this.instances = [];
    this.fileStatus = [];
    const names = Object.keys(this.current).sort();
    names.forEach((file, idx) => {
      const active = idx < slots;
      try {
        const prog = parse(this.current[file]);
        this.fileStatus.push({ file, ok: true, classes: prog.classes.map((c) => c.name), active });
        for (const cls of prog.classes) {
          const key = `${file}:${cls.name}`;
          const old = prev.get(key);
          const everyField = cls.fields.find((f) => f.name === 'every');
          let every = 1;
          if (everyField && everyField.value.k === 'num') every = Math.max(0.25, everyField.value.v);
          this.instances.push({
            key, file, cls, every, timer: old ? Math.min(old.timer, every) : Math.min(0.5, every),
            fields: old?.fields ?? this.savedFields[key] ?? {}, claims: old?.claims ?? newClaims(),
            status: active ? 'ok' : 'no_slot', lastOps: 0, runs: old?.runs ?? 0, logs: old?.logs ?? [], lastRunAt: 0, warnings: [],
          });
        }
      } catch (e) {
        const se = e as ScriptError;
        this.fileStatus.push({ file, ok: false, error: { line: se.line ?? 0, message: se.message }, classes: [], active });
      }
    });
    this.effectsDirty = true;
  }

  /** Recompile if the era changed the slot count. */
  refreshSlots(): void {
    this.dirty = true;
  }

  update(sim: Sim, dt: number): void {
    if (this.dirty) this.compile(sim);
    this.budget = BASE_BUDGET + (sim.ai.era - 1) * 250;
    let ran = false;
    for (const inst of this.instances) {
      if (inst.status === 'no_slot' || inst.status === 'error') continue;
      inst.timer -= dt;
      if (inst.timer > 0) continue;
      inst.timer += inst.every;
      if (inst.timer < 0) inst.timer = inst.every;
      this.runInstance(sim, inst);
      ran = true;
    }
    if (ran || this.effectsDirty) this.applyEffects(sim);
    if (sim.time - this.lastSecond >= 1) {
      this.lastSecond = sim.time;
      this.opsLastSecond = this.opsAcc;
      this.opsAcc = 0;
    }
  }

  runInstance(sim: Sim, inst: Instance, method?: string, args: Value[] = []): void {
    const debtMul = 1 + sim.ai.techDebt / 100;
    if (sim.ai.compute < 0.5 && !sim.headless) {
      inst.status = 'no_compute';
      return;
    }
    const claims = newClaims();
    const warned = new Set<string>();
    const log = (text: string, level: LogLine['level'] = 'info') => {
      inst.logs.push({ t: Math.floor(sim.time), text, level });
      if (inst.logs.length > 30) inst.logs.splice(0, inst.logs.length - 30);
    };
    const ctx = {
      sim,
      claims,
      agent: inst.cls.name,
      log,
      warn: (text: string) => {
        if (warned.has(text)) return;
        warned.add(text);
        if (!inst.warnings.includes(text)) {
          inst.warnings.push(text);
          if (inst.warnings.length > 8) inst.warnings.shift();
          log(text, 'warn');
        }
      },
    };
    const host = makeHost(ctx);
    const it = new Interpreter(inst.cls, inst.fields, host, this.budget);
    try {
      if (method) {
        if (it.hasMethod(method)) it.callMethod(method, args);
      } else {
        if (it.hasMethod('run')) it.callMethod('run');
        if (it.hasMethod('monitor')) it.callMethod('monitor');
      }
      if (!method) inst.claims = claims;
      else mergeClaims(inst.claims, claims);
      inst.status = 'ok';
      inst.error = undefined;
    } catch (e) {
      const se = e as ScriptError;
      inst.status = 'error';
      inst.error = { line: se.line ?? 0, message: se.message ?? String(e), kind: se.kind ?? 'runtime' };
      inst.claims = newClaims();
      log(`Строка ${inst.error.line}: ${inst.error.message}`, 'error');
      if (!sim.headless) {
        sim.toast({ kind: 'danger', title: `Ошибка в скрипте ${inst.cls.name}`, text: `Строка ${inst.error.line}: ${inst.error.message}`, key: 'scripterr:' + inst.key, action: { label: 'Открыть код', cmd: 'panel', arg: 'vibe' } });
      }
    }
    inst.lastOps = it.ops;
    inst.runs++;
    inst.lastRunAt = sim.time;
    this.opsAcc += it.ops;
    const cost = it.ops * COMPUTE_PER_OP * debtMul;
    sim.ai.compute = Math.max(0, sim.ai.compute - cost);
    sim.stats.consume('compute', cost);
    this.effectsDirty = true;
  }

  /** Deliver an event to agents that define on_event(self, name). */
  fireEvent(sim: Sim, name: string): void {
    for (const inst of this.instances) {
      if (inst.status !== 'ok') continue;
      if (!inst.cls.methods.some((m) => m.name === 'on_event')) continue;
      this.runInstance(sim, inst, 'on_event', [name]);
    }
  }

  /** Merge all instance claims into entity flags, limits and splitter filters. */
  applyEffects(sim: Sim): void {
    this.effectsDirty = false;
    const off = new Set<number>();
    const on = new Set<number>();
    const prio = new Map<number, number>();
    const limits = new Map<string, number>();
    const routes = new Map<number, string>();
    const balance = new Set<number>();
    for (const inst of this.instances) {
      if (inst.status !== 'ok' && inst.status !== 'no_compute') continue;
      const c = inst.claims;
      for (const id of c.off) off.add(id);
      for (const id of c.on) on.add(id);
      for (const [id, p] of c.prio) prio.set(id, Math.min(p, prio.get(id) ?? 9));
      for (const [k, v] of c.limits) limits.set(k, Math.min(v, limits.get(k) ?? Infinity));
      for (const [k, v] of c.routes) routes.set(k, v);
      for (const k of c.balance) balance.add(k);
    }
    for (const e of sim.list) {
      const wasOff = !!e.scriptOff;
      e.scriptOff = off.has(e.id) || undefined;
      e.scriptOn = (on.has(e.id) && !off.has(e.id)) || undefined;
      e.scriptPrio = prio.get(e.id);
      if (wasOff !== !!e.scriptOff) e.toggles = (e.toggles ?? 0) + 1;
    }
    sim.limits = limits;
    for (const k of balance) routes.delete(k);
    const key = sim.topoVersion + '|' + [...routes].map(([a, b]) => a + '>' + b).join(',') + '|' + [...balance].join(',');
    if (key !== this.routeKey) {
      this.routeKey = key;
      computeRoutes(sim, routes);
      sim.splitterBalance = balance;
    }
  }

  /** Classes whose current claims touch the entity (for the building panel). */
  controllers(id: number): string[] {
    const out: string[] = [];
    for (const inst of this.instances) {
      const c = inst.claims;
      if (c.off.has(id) || c.on.has(id) || c.prio.has(id)) out.push(inst.cls.name);
    }
    return out;
  }

  /** Entities currently managed by any script (for the autonomy index). */
  managedIds(): Set<number> {
    const s = new Set<number>();
    for (const inst of this.instances) {
      if (inst.status !== 'ok') continue;
      for (const id of inst.claims.off) s.add(id);
      for (const id of inst.claims.on) s.add(id);
      for (const id of inst.claims.prio.keys()) s.add(id);
    }
    return s;
  }

  exportState(): Record<string, Record<string, any>> {
    const out: Record<string, Record<string, any>> = {};
    for (const i of this.instances) out[i.key] = JSON.parse(JSON.stringify(i.fields));
    return out;
  }

  importState(s: Record<string, Record<string, any>>): void {
    this.savedFields = s;
    for (const i of this.instances) if (s[i.key]) i.fields = s[i.key];
  }
}

function mergeClaims(into: Claims, add: Claims): void {
  for (const id of add.off) into.off.add(id);
  for (const id of add.on) into.on.add(id);
  for (const [k, v] of add.prio) into.prio.set(k, v);
  for (const [k, v] of add.routes) into.routes.set(k, v);
  for (const k of add.balance) into.balance.add(k);
  for (const [k, v] of add.limits) into.limits.set(k, v);
}

/**
 * route(item, group): for every splitter find outputs whose belt chain reaches the group
 * (directly as a sink or via an inserter picking from the chain) and filter the item there.
 */
export function computeRoutes(sim: Sim, routes: Map<number, string>): void {
  sim.splitterFilters.clear();
  sim.routeInfo = [];
  if (!routes.size) return;
  const pickFrom = new Map<number, number[]>();
  for (const e of sim.list) {
    if (e.type !== 'inserter' || e.ghost) continue;
    const src = sim.entityAt(e.x - DX[e.dir], e.y - DY[e.dir]);
    const dst = sim.entityAt(e.x + DX[e.dir], e.y + DY[e.dir]);
    if (!src || !dst || !BELTLIKE.has(src.type)) continue;
    const arr = pickFrom.get(src.id) ?? [];
    arr.push(dst.id);
    pickFrom.set(src.id, arr);
  }
  const splitters = sim.list.filter((e) => e.type === 'splitter' && !e.ghost && e.outs);
  for (const [item, group] of routes) {
    const targets = new Set(resolveGroup(sim, group).map((e) => e.id));
    let configured = 0;
    if (targets.size) {
      for (const s of splitters) {
        const reach: number[] = [];
        for (let o = 0; o < 3; o++) {
          const start = s.outs![o * 2];
          if (start && chainReaches(sim, start, targets, pickFrom)) reach.push(o);
        }
        if (reach.length && reach.length < 3) {
          let m = sim.splitterFilters.get(s.id);
          if (!m) {
            m = new Map();
            sim.splitterFilters.set(s.id, m);
          }
          m.set(item, reach[0]);
          configured++;
        }
      }
    }
    sim.routeInfo.push({ item: String(item), group, splitters: configured });
  }
}

function chainReaches(sim: Sim, startId: number, targets: Set<number>, pickFrom: Map<number, number[]>): boolean {
  const seen = new Set<number>();
  const queue = [startId];
  while (queue.length && seen.size < 120) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (targets.has(id)) return true;
    const e = sim.ents.get(id);
    if (!e) continue;
    for (const d of pickFrom.get(id) ?? []) if (targets.has(d)) return true;
    if (e.type === 'splitter' && e.outs) {
      for (let o = 0; o < 3; o++) if (e.outs[o * 2]) queue.push(e.outs[o * 2]);
    } else if (e.next) queue.push(e.next);
  }
  return false;
}
