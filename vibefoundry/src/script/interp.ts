import type { ClassDef, Expr, Stmt } from './ast';
import { ScriptError } from './lexer';

export interface BuildingRef {
  __b: true;
  id: number;
}
export interface Callable {
  __fn: (args: Value[], kwargs: Record<string, Value>, line: number) => Value;
  name: string;
}
export interface SelfRef {
  __self: true;
}
export type Value = number | string | boolean | null | Value[] | { [k: string]: Value } | BuildingRef | Callable | SelfRef;

/** What the interpreter needs from the game world (implemented by worldApi). */
export interface ScriptHost {
  /** Read-only sensor on self (power, energy, time, ...). undefined = not a sensor. */
  selfSensor(name: string): Value | undefined;
  /** API action/query callable via self.name(...). */
  selfApi(name: string): Callable | undefined;
  /** Global function or constant (stock, rate, buildings, len, ...). */
  global(name: string): Value | undefined;
  buildingAttr(ref: BuildingRef, name: string, line: number): Value;
  /** Called for every executed operation. */
  onOp?(): void;
}

class ReturnSignal {
  constructor(public value: Value) {}
}
const BREAK = { brk: true };
const CONTINUE = { cont: true };

export const READONLY_SELF = new Set(['power', 'energy', 'time', 'is_night', 'alerts', 'day', 'era', 'model']);

export function isCallable(v: Value): v is Callable {
  return !!v && typeof v === 'object' && '__fn' in (v as any);
}
export function isBuilding(v: Value): v is BuildingRef {
  return !!v && typeof v === 'object' && '__b' in (v as any);
}
function isSelf(v: Value): v is SelfRef {
  return !!v && typeof v === 'object' && '__self' in (v as any);
}

export function truthy(v: Value): boolean {
  if (v === null || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function repr(v: Value): string {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return '[' + v.map((x) => (typeof x === 'string' ? `"${x}"` : repr(x))).join(', ') + ']';
  if (isBuilding(v)) return `<здание #${v.id}>`;
  if (isCallable(v)) return `<функция ${v.name}>`;
  if (isSelf(v)) return '<self>';
  return '{' + Object.entries(v).map(([k, x]) => `"${k}": ${repr(x)}`).join(', ') + '}';
}

/** Tree-walking interpreter for one agent class instance, with an operation budget. */
export class Interpreter {
  ops = 0;
  budget: number;
  host: ScriptHost;
  cls: ClassDef;
  fields: Record<string, Value>;
  private selfRef: SelfRef = { __self: true };

  constructor(cls: ClassDef, fields: Record<string, Value>, host: ScriptHost, budget: number) {
    this.cls = cls;
    this.fields = fields;
    this.host = host;
    this.budget = budget;
  }

  private op(line: number): void {
    this.ops++;
    this.host.onOp?.();
    if (this.ops > this.budget) throw new ScriptError(`Превышен бюджет операций (${this.budget}) — возможно, бесконечный цикл`, line, 0, 'budget');
  }

  private err(msg: string, line: number): never {
    throw new ScriptError(msg, line, 0, 'runtime');
  }

  hasMethod(name: string): boolean {
    return this.cls.methods.some((m) => m.name === name);
  }

  /** Call a user method by name. Returns its value. */
  callMethod(name: string, args: Value[] = [], line = 0): Value {
    const m = this.cls.methods.find((x) => x.name === name);
    if (!m) this.err(`У агента ${this.cls.name} нет метода ${name}`, line);
    const locals = new Map<string, Value>();
    const params = m.params;
    if (params[0] !== 'self') this.err(`Первый параметр метода ${m.name} должен быть self`, m.line);
    locals.set('self', this.selfRef);
    for (let i = 1; i < params.length; i++) locals.set(params[i], args[i - 1] ?? null);
    try {
      this.execBlock(m.body, locals);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
    return null;
  }

  private execBlock(body: Stmt[], locals: Map<string, Value>): typeof BREAK | typeof CONTINUE | undefined {
    for (const s of body) {
      const r = this.execStmt(s, locals);
      if (r) return r;
    }
    return undefined;
  }

  private execStmt(s: Stmt, locals: Map<string, Value>): typeof BREAK | typeof CONTINUE | undefined {
    this.op(s.line);
    switch (s.k) {
      case 'expr':
        this.evalExpr(s.e, locals);
        return;
      case 'pass':
        return;
      case 'break':
        return BREAK;
      case 'continue':
        return CONTINUE;
      case 'return':
        throw new ReturnSignal(s.e ? this.evalExpr(s.e, locals) : null);
      case 'if':
        if (truthy(this.evalExpr(s.test, locals))) return this.execBlock(s.body, locals);
        return this.execBlock(s.orelse, locals);
      case 'while': {
        while (truthy(this.evalExpr(s.test, locals))) {
          const r = this.execBlock(s.body, locals);
          if (r === BREAK) break;
          this.op(s.line);
        }
        return;
      }
      case 'for': {
        const it = this.evalExpr(s.iter, locals);
        let seq: Value[];
        if (Array.isArray(it)) seq = it;
        else if (typeof it === 'string') seq = it.split('');
        else if (it && typeof it === 'object' && !isBuilding(it) && !isCallable(it) && !isSelf(it)) seq = Object.keys(it);
        else this.err(`По значению ${repr(it)} нельзя пройти циклом for`, s.line);
        if (seq.length > 2000) this.err('Слишком длинная коллекция для цикла (> 2000)', s.line);
        for (const v of seq) {
          locals.set(s.target, v);
          const r = this.execBlock(s.body, locals);
          if (r === BREAK) break;
        }
        return;
      }
      case 'assign': {
        let value = this.evalExpr(s.value, locals);
        if (s.op !== '=') {
          const cur = this.evalExpr(s.target, locals);
          value = this.binop(s.op[0], cur, value, s.line);
        }
        this.assign(s.target, value, locals, s.line);
        return;
      }
    }
  }

  private assign(t: Expr, value: Value, locals: Map<string, Value>, line: number): void {
    if (t.k === 'name') {
      if (t.id === 'self') this.err('Нельзя переопределить self', line);
      locals.set(t.id, value);
      return;
    }
    if (t.k === 'attr') {
      const obj = this.evalExpr(t.obj, locals);
      if (!isSelf(obj)) this.err('Атрибуты можно задавать только у self', line);
      if (READONLY_SELF.has(t.name)) this.err(`self.${t.name} — показание датчика, его нельзя изменить`, line);
      this.fields[t.name] = value;
      return;
    }
    if (t.k === 'index') {
      const obj = this.evalExpr(t.obj, locals);
      const idx = this.evalExpr(t.idx, locals);
      if (Array.isArray(obj)) {
        if (typeof idx !== 'number') this.err('Индекс списка должен быть числом', line);
        const i = idx < 0 ? obj.length + idx : idx;
        if (i < 0 || i >= obj.length) this.err('Индекс вне списка', line);
        obj[i] = value;
        return;
      }
      if (obj && typeof obj === 'object' && !isBuilding(obj) && !isCallable(obj) && !isSelf(obj)) {
        (obj as Record<string, Value>)[String(idx)] = value;
        return;
      }
      this.err('Этому значению нельзя присвоить элемент', line);
    }
    this.err('Недопустимая цель присваивания', line);
  }

  evalExpr(e: Expr, locals: Map<string, Value>): Value {
    this.op(e.line);
    switch (e.k) {
      case 'num':
        return e.v;
      case 'str':
        return e.v;
      case 'bool':
        return e.v;
      case 'none':
        return null;
      case 'list':
        return e.items.map((x) => this.evalExpr(x, locals));
      case 'dict': {
        const o: Record<string, Value> = {};
        e.keys.forEach((k, i) => (o[String(this.evalExpr(k, locals))] = this.evalExpr(e.values[i], locals)));
        return o;
      }
      case 'name': {
        if (locals.has(e.id)) return locals.get(e.id)!;
        const g = this.host.global(e.id);
        if (g !== undefined) return g;
        return this.err(`Неизвестное имя «${e.id}»`, e.line);
      }
      case 'attr': {
        const obj = this.evalExpr(e.obj, locals);
        return this.getAttr(obj, e.name, e.line);
      }
      case 'index': {
        const obj = this.evalExpr(e.obj, locals);
        const idx = this.evalExpr(e.idx, locals);
        if (Array.isArray(obj) || typeof obj === 'string') {
          if (typeof idx !== 'number') this.err('Индекс должен быть числом', e.line);
          const i = idx < 0 ? obj.length + idx : idx;
          if (i < 0 || i >= obj.length) this.err(`Индекс ${idx} вне диапазона (длина ${obj.length})`, e.line);
          return obj[i] as Value;
        }
        if (obj && typeof obj === 'object' && !isBuilding(obj) && !isCallable(obj) && !isSelf(obj)) {
          const v = (obj as Record<string, Value>)[String(idx)];
          if (v === undefined) this.err(`Нет ключа ${repr(idx)}`, e.line);
          return v;
        }
        return this.err('Это значение нельзя индексировать', e.line);
      }
      case 'call': {
        // method call on self: user method or API
        if (e.fn.k === 'attr') {
          const obj = this.evalExpr(e.fn.obj, locals);
          if (isSelf(obj)) {
            const args = e.args.map((a) => this.evalExpr(a, locals));
            if (this.hasMethod(e.fn.name)) return this.callMethod(e.fn.name, args, e.line);
            const api = this.host.selfApi(e.fn.name);
            if (api) return api.__fn(args, this.kw(e, locals), e.line);
            return this.err(`У self нет метода «${e.fn.name}»`, e.line);
          }
          const fn = this.getAttr(obj, e.fn.name, e.line);
          if (!isCallable(fn)) this.err(`${e.fn.name} — не функция`, e.line);
          return fn.__fn(e.args.map((a) => this.evalExpr(a, locals)), this.kw(e, locals), e.line);
        }
        const fn = this.evalExpr(e.fn, locals);
        if (!isCallable(fn)) return this.err(`${repr(fn)} нельзя вызвать`, e.line);
        return fn.__fn(e.args.map((a) => this.evalExpr(a, locals)), this.kw(e, locals), e.line);
      }
      case 'unary': {
        const v = this.evalExpr(e.e, locals);
        if (e.op === 'not') return !truthy(v);
        if (typeof v !== 'number') this.err(`Унарный «${e.op}» применим только к числам`, e.line);
        return e.op === '-' ? -v : v;
      }
      case 'bool_op': {
        const l = this.evalExpr(e.l, locals);
        if (e.op === 'and') return truthy(l) ? this.evalExpr(e.r, locals) : l;
        return truthy(l) ? l : this.evalExpr(e.r, locals);
      }
      case 'bin':
        return this.binop(e.op, this.evalExpr(e.l, locals), this.evalExpr(e.r, locals), e.line);
      case 'cmp': {
        let left = this.evalExpr(e.left, locals);
        for (let i = 0; i < e.ops.length; i++) {
          const right = this.evalExpr(e.rights[i], locals);
          if (!this.compare(e.ops[i], left, right, e.line)) return false;
          left = right;
        }
        return true;
      }
      case 'ternary':
        return truthy(this.evalExpr(e.test, locals)) ? this.evalExpr(e.a, locals) : this.evalExpr(e.b, locals);
    }
  }

  private kw(e: Extract<Expr, { k: 'call' }>, locals: Map<string, Value>): Record<string, Value> {
    const o: Record<string, Value> = {};
    for (const k of e.kwargs) o[k.name] = this.evalExpr(k.value, locals);
    return o;
  }

  private getAttr(obj: Value, name: string, line: number): Value {
    if (isSelf(obj)) {
      if (name in this.fields) return this.fields[name];
      const f = this.cls.fields.find((x) => x.name === name);
      if (f) return this.evalExpr(f.value, new Map());
      const sensor = this.host.selfSensor(name);
      if (sensor !== undefined) return sensor;
      if (this.hasMethod(name)) return { __fn: (args) => this.callMethod(name, args, line), name };
      const api = this.host.selfApi(name);
      if (api) return api;
      return this.err(`У self нет атрибута «${name}»`, line);
    }
    if (isBuilding(obj)) return this.host.buildingAttr(obj, name, line);
    if (Array.isArray(obj)) {
      if (name === 'append') return { __fn: (a) => (obj.push(a[0] ?? null), null), name: 'append' };
      if (name === 'count') return { __fn: (a) => obj.filter((x) => x === a[0]).length, name: 'count' };
    }
    if (typeof obj === 'string') {
      if (name === 'upper') return { __fn: () => obj.toUpperCase(), name };
      if (name === 'lower') return { __fn: () => obj.toLowerCase(), name };
      if (name === 'startswith') return { __fn: (a) => obj.startsWith(String(a[0])), name };
    }
    if (obj && typeof obj === 'object' && !isCallable(obj)) {
      if (name === 'get') return { __fn: (a) => (obj as any)[String(a[0])] ?? a[1] ?? null, name };
      if (name === 'keys') return { __fn: () => Object.keys(obj), name };
    }
    return this.err(`У значения ${repr(obj)} нет атрибута «${name}»`, line);
  }

  binop(op: string, l: Value, r: Value, line: number): Value {
    if (op === '+') {
      if (typeof l === 'number' && typeof r === 'number') return l + r;
      if (typeof l === 'string' && typeof r === 'string') return l + r;
      if (typeof l === 'string' || typeof r === 'string') return repr(l) + repr(r);
      if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
      return this.err(`Нельзя сложить ${repr(l)} и ${repr(r)}`, line);
    }
    if (op === '*' && typeof l === 'string' && typeof r === 'number') return l.repeat(Math.max(0, Math.min(200, r)));
    if (typeof l !== 'number' || typeof r !== 'number') return this.err(`Операция «${op}» определена только для чисел (${repr(l)}, ${repr(r)})`, line);
    switch (op) {
      case '-':
        return l - r;
      case '*':
        return l * r;
      case '/':
        if (r === 0) this.err('Деление на ноль', line);
        return l / r;
      case '//':
        if (r === 0) this.err('Деление на ноль', line);
        return Math.floor(l / r);
      case '%':
        if (r === 0) this.err('Деление на ноль', line);
        return ((l % r) + r) % r;
      case '**':
        return Math.pow(l, r);
    }
    return this.err(`Неизвестная операция ${op}`, line);
  }

  private compare(op: string, l: Value, r: Value, line: number): boolean {
    switch (op) {
      case '==':
        return eq(l, r);
      case '!=':
        return !eq(l, r);
      case 'in':
      case 'not in': {
        let res: boolean;
        if (Array.isArray(r)) res = r.some((x) => eq(x, l));
        else if (typeof r === 'string') res = typeof l === 'string' && r.includes(l);
        else if (r && typeof r === 'object' && !isBuilding(r) && !isCallable(r) && !isSelf(r)) res = String(l) in r;
        else return this.err(`Оператор in неприменим к ${repr(r)}`, line);
        return op === 'in' ? res : !res;
      }
    }
    if (typeof l === 'number' && typeof r === 'number') {
      if (op === '<') return l < r;
      if (op === '>') return l > r;
      if (op === '<=') return l <= r;
      return l >= r;
    }
    if (typeof l === 'string' && typeof r === 'string') {
      if (op === '<') return l < r;
      if (op === '>') return l > r;
      if (op === '<=') return l <= r;
      return l >= r;
    }
    return this.err(`Нельзя сравнить ${repr(l)} и ${repr(r)} оператором «${op}»`, line);
  }
}

function eq(a: Value, b: Value): boolean {
  if (isBuilding(a) && isBuilding(b)) return a.id === b.id;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  return a === b;
}
