import { describe, it, expect } from 'vitest';
import { parse } from '../src/script/parser';
import { tokenize, ScriptError } from '../src/script/lexer';
import { Interpreter, type ScriptHost, type Value } from '../src/script/interp';
import { testSim, give, buildGearLine } from './helpers';
import type { Sim } from '../src/sim/sim';
import { mainPower, powerRatio } from '../src/sim/power';

const REFERENCE = `class CopperRouter(Agent):
    every = 2          # запускать каждые 2 секунды игрового времени
    def run(self):
        if self.power < 0.8:
            self.disable("chip_production")
        self.set_priority("batteries", 1)
        self.route("copper_ore", "smelter")

class EnergyManager(Agent):
    def monitor(self):
        if self.energy < 0.6:
            self.shutdown("chip_production")
            self.notify("low_energy")
`;

/** Minimal host for pure-language tests. */
function pureHost(extra: Record<string, Value> = {}): ScriptHost {
  const g: Record<string, Value> = {
    range: { __fn: (a) => Array.from({ length: Number(a[0]) }, (_, i) => i), name: 'range' },
    len: { __fn: (a) => (a[0] as any[]).length, name: 'len' },
    str: { __fn: (a) => String(a[0]), name: 'str' },
    ...extra,
  };
  return {
    selfSensor: (n) => (n === 'power' ? 0.5 : undefined),
    selfApi: () => undefined,
    global: (n) => g[n],
    buildingAttr: () => null,
  };
}

function runFn(body: string, extra: Record<string, Value> = {}, budget = 500): Value {
  const src = `class T(Agent):\n    def run(self):\n${body.split('\n').map((l) => '        ' + l).join('\n')}\n`;
  const prog = parse(src);
  const it = new Interpreter(prog.classes[0], {}, pureHost(extra), budget);
  return it.callMethod('run');
}

function expectErr(fn: () => unknown, re: RegExp, line?: number): ScriptError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ScriptError);
    expect((e as Error).message).toMatch(re);
    if (line !== undefined) expect((e as ScriptError).line).toBe(line);
    return e as ScriptError;
  }
  throw new Error('expected an error');
}

// ------------------------------------------------------------------ language
describe('FactoryScript: lexer & parser', () => {
  it('parses the reference script into two agent classes', () => {
    const p = parse(REFERENCE);
    expect(p.classes.map((c) => c.name)).toEqual(['CopperRouter', 'EnergyManager']);
    expect(p.classes[0].base).toBe('Agent');
    expect(p.classes[0].fields[0].name).toBe('every');
    expect(p.classes[0].methods[0].name).toBe('run');
    expect(p.classes[1].methods[0].name).toBe('monitor');
  });

  it('emits INDENT/DEDENT tokens for nested blocks', () => {
    const toks = tokenize('class A(Agent):\n    def run(self):\n        if x:\n            pass\n');
    expect(toks.filter((t) => t.t === 'indent').length).toBe(3);
    expect(toks.filter((t) => t.t === 'dedent').length).toBe(3);
  });

  it('reports inconsistent dedent with line number', () => {
    expectErr(() => parse('class A(Agent):\n    def run(self):\n        pass\n      x = 1\n'), /отступ/i, 4);
  });

  it('reports unclosed string', () => {
    expectErr(() => parse('class A(Agent):\n    def run(self):\n        self.log("oops)\n'), /Незакрытая строка/, 3);
  });

  it('reports unclosed bracket', () => {
    expectErr(() => parse('class A(Agent):\n    def run(self):\n        x = (1 + 2\n'), /скобк/);
  });

  it('rejects top-level statements', () => {
    expectErr(() => parse('x = 1\n'), /только классы/, 1);
  });

  it('ignores comments and blank lines', () => {
    const p = parse('# header\n\nclass A(Agent):  # trailing\n\n    # inside\n    every = 3\n    def run(self):\n        pass  # ok\n');
    expect(p.classes[0].fields[0].name).toBe('every');
  });

  it('supports implicit line joining inside brackets', () => {
    expect(runFn('x = [1,\n    2,\n    3]\nreturn len(x)')).toBe(3);
  });

  it('reports missing colon after if', () => {
    expectErr(() => parse('class A(Agent):\n    def run(self):\n        if True\n            pass\n'), /«:»/, 3);
  });
});

describe('FactoryScript: interpreter', () => {
  it('evaluates arithmetic with precedence', () => {
    expect(runFn('return 2 + 3 * 4 - 10 / 5')).toBe(12);
    expect(runFn('return (2 + 3) * 4')).toBe(20);
    expect(runFn('return 7 // 2 + 7 % 3 + 2 ** 3')).toBe(12);
  });

  it('supports if / elif / else', () => {
    expect(runFn('x = 5\nif x > 10:\n    return "big"\nelif x > 3:\n    return "mid"\nelse:\n    return "small"')).toBe('mid');
  });

  it('supports and / or / not with short-circuit', () => {
    expect(runFn('return not (1 > 2) and (0 or 7)')).toBe(7);
    expect(runFn('return 0 and undefined_name')).toBe(0);
  });

  it('supports chained comparisons', () => {
    expect(runFn('x = 2\nreturn 1 < x < 3')).toBe(true);
    expect(runFn('x = 5\nreturn 1 < x < 3')).toBe(false);
  });

  it('supports for-loops over range and lists', () => {
    expect(runFn('s = 0\nfor i in range(5):\n    s += i\nreturn s')).toBe(10);
    expect(runFn('s = ""\nfor w in ["a", "b"]:\n    s = s + w\nreturn s')).toBe('ab');
  });

  it('supports while with break and continue', () => {
    expect(runFn('i = 0\nn = 0\nwhile True:\n    i += 1\n    if i % 2 == 0:\n        continue\n    n += 1\n    if i > 8:\n        break\nreturn n')).toBe(5);
  });

  it('supports lists, negative indexes and append', () => {
    expect(runFn('a = [1, 2, 3]\na.append(4)\nreturn a[-1] + a[0]')).toBe(5);
  });

  it('supports dicts with get', () => {
    expect(runFn('d = {"a": 1}\nd["b"] = 2\nreturn d.get("b") + d.get("z", 10)')).toBe(12);
  });

  it('supports in / not in', () => {
    expect(runFn('return "b" in ["a", "b"] and "z" not in ["a"]')).toBe(true);
  });

  it('supports the ternary expression', () => {
    expect(runFn('x = 3\nreturn "hi" if x > 2 else "lo"')).toBe('hi');
  });

  it('parses percent literals as fractions', () => {
    expect(runFn('return 30%')).toBeCloseTo(0.3);
    expect(runFn('return 7 % 3')).toBe(1);
  });

  it('raises division by zero with line', () => {
    expectErr(() => runFn('x = 1\nreturn x / 0'), /Деление на ноль/, 4);
  });

  it('raises unknown names', () => {
    expectErr(() => runFn('return foo + 1'), /Неизвестное имя «foo»/);
  });

  it('stops infinite loops with the operation budget', () => {
    const e = expectErr(() => runFn('while True:\n    pass', {}, 500), /бюджет/);
    expect(e.kind).toBe('budget');
  });

  it('forbids assigning read-only sensors', () => {
    expectErr(() => runFn('self.power = 1'), /показание датчика/);
  });

  it('persists self attributes between runs', () => {
    const prog = parse('class C(Agent):\n    def run(self):\n        self.n = self.get_n() + 1\n        return self.n\n    def get_n(self):\n        if "n" in self.memo():\n            return self.n\n        return 0\n    def memo(self):\n        return ["n"] if self.started else []\n    started = False\n');
    const fields: Record<string, Value> = {};
    const it = new Interpreter(prog.classes[0], fields, pureHost(), 500);
    it.callMethod('run');
    fields.started = true;
    const it2 = new Interpreter(prog.classes[0], fields, pureHost(), 500);
    expect(it2.callMethod('run')).toBe(2);
  });

  it('reads class fields and sensors via self', () => {
    const prog = parse('class C(Agent):\n    every = 4\n    def run(self):\n        return self.every + self.power\n');
    expect(new Interpreter(prog.classes[0], {}, pureHost(), 100).callMethod('run')).toBe(4.5);
  });

  it('rejects calling non-functions and missing methods', () => {
    expectErr(() => runFn('x = 1\nx()'), /нельзя вызвать/);
    expectErr(() => runFn('self.teleport()'), /нет метода «teleport»/);
  });

  it('concatenates strings with numbers via str()', () => {
    expect(runFn('return "v" + str(3)')).toBe('v3');
  });
});

// ---------------------------------------------------------------- world API
function deficitFactory(): { sim: Sim; chips: number[]; chems: number[] } {
  const sim = testSim(11);
  give(sim, { iron_plate: 5000, gear: 2000, copper_plate: 2000, stone_brick: 2000, steel: 500 });
  const { x, y } = sim.world.base;
  const chips: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = sim.place('assembler', x - 14 + (i % 5) * 3, y + 4 + Math.floor(i / 5) * 3, 0, { recipe: 'microchip', force: true })!;
    a.inv = { silicon_wafer: 999, copper_wire: 999, plastic: 999 };
    chips.push(a.id);
  }
  const chems: number[] = [];
  for (let i = 0; i < 3; i++) {
    const c = sim.place('chem', x - 14 + i * 3, y + 11, 0, { recipe: 'battery', force: true })!;
    c.inv = { iron_plate: 999, copper_plate: 999, electrolyte: 999 };
    chems.push(c.id);
  }
  for (let i = 0; i < 4; i++) {
    sim.place('pole', x - 13 + i * 4, y + 3, 0, { force: true });
    sim.place('pole', x - 13 + i * 4, y + 10, 0, { force: true });
  }
  return { sim, chips, chems };
}

function withFiles(sim: Sim, files: Record<string, string>): void {
  sim.ai.compute = 10000;
  sim.scripts.setFiles(files);
}

describe('FactoryScript: world API', () => {
  it('self.power reports the energy shortage (capacity / nominal demand)', () => {
    const { sim } = deficitFactory();
    sim.run(1);
    const n = mainPower(sim);
    expect(n.nominal).toBeGreaterThan(n.capacity);
    expect(powerRatio(sim)).toBeLessThan(0.8);
  });

  it('the reference script disables chip production during a shortage', () => {
    const { sim, chips } = deficitFactory();
    withFiles(sim, { 'automation.py': REFERENCE });
    sim.run(3);
    for (const id of chips) expect(sim.ents.get(id)!.scriptOff).toBe(true);
    const inst = sim.scripts.instances.find((i) => i.cls.name === 'CopperRouter')!;
    expect(inst.status).toBe('ok');
  });

  it('disabling is temporary: chips come back when power is sufficient', () => {
    const { sim, chips } = deficitFactory();
    withFiles(sim, { 'automation.py': REFERENCE });
    sim.run(3);
    expect(sim.ents.get(chips[0])!.scriptOff).toBe(true);
    // remove the batteries load and most chip makers → surplus
    for (const id of chips.slice(2)) sim.removeEntity(sim.ents.get(id)!, false);
    sim.run(5);
    expect(sim.ents.get(chips[0])!.scriptOff).toBeFalsy();
  });

  it('disabled buildings stop drawing power', () => {
    const { sim, chips } = deficitFactory();
    withFiles(sim, { 'a.py': 'class Off(Agent):\n    def run(self):\n        self.disable("chip_production")\n' });
    sim.run(2);
    expect(sim.ents.get(chips[0])!.sat).toBe(0);
    expect(mainPower(sim).demand).toBeLessThan(1000);
  });

  it('shutdown behaves like disable', () => {
    const { sim, chems } = deficitFactory();
    withFiles(sim, { 'a.py': 'class S(Agent):\n    def run(self):\n        self.shutdown("chem")\n' });
    sim.run(2);
    for (const id of chems) expect(sim.ents.get(id)!.scriptOff).toBe(true);
  });

  it('set_priority gives batteries full power during a deficit', () => {
    const { sim, chems, chips } = deficitFactory();
    withFiles(sim, { 'a.py': 'class P(Agent):\n    def run(self):\n        self.set_priority("batteries", 1)\n' });
    sim.run(2);
    expect(sim.ents.get(chems[0])!.scriptPrio).toBe(1);
    expect(sim.ents.get(chems[0])!.sat).toBe(1);
    expect(sim.ents.get(chips[0])!.sat).toBeLessThan(1);
  });

  it('enable overrides a manual off switch', () => {
    const { sim, chips } = deficitFactory();
    const e = sim.ents.get(chips[0])!;
    e.off = true;
    withFiles(sim, { 'a.py': `class E(Agent):\n    def run(self):\n        self.enable(self.buildings("chip_production")[0])\n` });
    sim.run(2);
    expect(e.scriptOn).toBe(true);
    expect(e.sat).toBeGreaterThan(0);
  });

  it('stock() and rate() read the factory', () => {
    const sim = testSim();
    const l = buildGearLine(sim);
    void l;
    let captured: any = null;
    withFiles(sim, { 'a.py': 'class R(Agent):\n    every = 1\n    def run(self):\n        self.s = self.stock("iron_plate")\n        self.r = self.rate("iron_ore")\n' });
    sim.run(70);
    captured = sim.scripts.instances[0].fields;
    expect(captured.s).toBeGreaterThan(0);
    expect(captured.r).toBeGreaterThan(10);
  });

  it('limit() stops production once the stock is reached', () => {
    const sim = testSim();
    const l = buildGearLine(sim);
    const before = sim.stock('gear');
    withFiles(sim, { 'a.py': `class L(Agent):\n    def run(self):\n        self.limit("gear", ${before + 2})\n` });
    sim.run(90);
    expect(sim.stock('gear')).toBeLessThanOrEqual(before + 4);
    expect(l.asm.status === 'limit' || l.asm.status === 'no_input').toBe(true);
  });

  it('set_recipe switches assemblers of a group', () => {
    const sim = testSim();
    give(sim, { iron_plate: 100, gear: 100, copper_plate: 100 });
    const { x, y } = sim.world.base;
    const a = sim.place('assembler', x + 5, y + 5, 0, { recipe: 'gear' })!;
    sim.groups.line_b = [a.id];
    withFiles(sim, { 'a.py': 'class R(Agent):\n    def run(self):\n        self.set_recipe("line_b", "copper_wire")\n' });
    sim.run(1);
    expect(a.recipe).toBe('copper_wire');
  });

  it('route() configures splitter filters toward the target group', () => {
    const sim = testSim();
    give(sim, { iron_plate: 500, gear: 200, copper_plate: 200, stone_brick: 200 });
    const { x, y } = sim.world.base;
    const y0 = y + 6;
    sim.place('belt', x + 4, y0, 1);
    const sp = sim.place('splitter', x + 5, y0, 1, { force: true })!;
    // forward → belt → inserter → smelter ; right (south) → belt → storage
    sim.place('belt', x + 6, y0, 1);
    sim.place('inserter', x + 7, y0, 1);
    const sm = sim.place('smelter', x + 8, y0, 1)!;
    sim.place('belt', x + 5, y0 + 1, 2);
    sim.place('storage', x + 5, y0 + 2, 1);
    withFiles(sim, { 'a.py': 'class R(Agent):\n    def run(self):\n        self.route("copper_ore", "smelter")\n' });
    sim.run(1);
    expect(sim.splitterFilters.get(sp.id)?.get(2)).toBe(0); // item index 2 = copper_ore → forward
    void sm;
  });

  it('balance() removes filters so splitters alternate', () => {
    const sim = testSim();
    withFiles(sim, { 'a.py': 'class B(Agent):\n    def run(self):\n        self.route("copper_plate", "smelter")\n        self.balance("copper_plate")\n' });
    sim.run(1);
    expect(sim.splitterBalance.size).toBe(1);
  });

  it('notify() raises a toast event', () => {
    const sim = testSim();
    const toasts: string[] = [];
    sim.events.on('toast', (t) => toasts.push(t.title));
    withFiles(sim, { 'a.py': 'class N(Agent):\n    def run(self):\n        self.notify("low_energy")\n' });
    sim.run(1);
    expect(toasts).toContain('Нехватка энергии');
  });

  it('buildings() yields building proxies with attributes', () => {
    const { sim } = deficitFactory();
    withFiles(sim, { 'a.py': 'class B(Agent):\n    def run(self):\n        n = 0\n        for b in self.buildings("all"):\n            if b.type == "chem":\n                n += 1\n        self.n = n\n' });
    sim.run(1);
    expect(sim.scripts.instances[0].fields.n).toBe(3);
  });

  it('count() counts buildings by type', () => {
    const { sim } = deficitFactory();
    withFiles(sim, { 'a.py': 'class C(Agent):\n    def run(self):\n        self.a = count("assembler")\n        self.p = count("pole")\n' });
    sim.run(1);
    expect(sim.scripts.instances[0].fields.a).toBe(10);
    expect(sim.scripts.instances[0].fields.p).toBe(8);
  });

  it('unknown items and groups produce warnings, not crashes', () => {
    const sim = testSim();
    withFiles(sim, { 'a.py': 'class W(Agent):\n    def run(self):\n        self.route("coper_ore", "smelter")\n        self.disable("nonexistent_group")\n' });
    sim.run(1);
    const inst = sim.scripts.instances[0];
    expect(inst.status).toBe('ok');
    expect(inst.warnings.some((w) => w.includes('coper_ore'))).toBe(true);
    expect(inst.warnings.some((w) => w.includes('nonexistent_group'))).toBe(true);
  });

  it('runtime errors stop the agent and report the line', () => {
    const sim = testSim();
    withFiles(sim, { 'a.py': 'class E(Agent):\n    def run(self):\n        x = 1\n        y = x / 0\n' });
    sim.run(1);
    const inst = sim.scripts.instances[0];
    expect(inst.status).toBe('error');
    expect(inst.error!.line).toBe(4);
  });

  it('syntax errors are reported per file', () => {
    const sim = testSim();
    withFiles(sim, { 'bad.py': 'class E(Agent)\n    pass\n' });
    sim.run(1);
    expect(sim.scripts.fileStatus[0].ok).toBe(false);
    expect(sim.scripts.fileStatus[0].error!.line).toBe(1);
  });

  it('every operation costs compute', () => {
    const sim = testSim();
    withFiles(sim, { 'a.py': 'class Busy(Agent):\n    def run(self):\n        for i in range(100):\n            x = i * 2\n' });
    const before = sim.ai.compute;
    sim.run(1);
    expect(sim.ai.compute).toBeLessThan(before + 2); // HQ adds 2/s; the script burns more than that per run
    expect(sim.scripts.instances[0].lastOps).toBeGreaterThan(300);
  });

  it('every = N controls run frequency', () => {
    const sim = testSim();
    withFiles(sim, { 'a.py': 'class Slow(Agent):\n    every = 5\n    def run(self):\n        pass\n\nclass Fast(Agent):\n    every = 1\n    def run(self):\n        pass\n' });
    sim.run(10);
    const slow = sim.scripts.instances.find((i) => i.cls.name === 'Slow')!;
    const fast = sim.scripts.instances.find((i) => i.cls.name === 'Fast')!;
    expect(slow.runs).toBeLessThanOrEqual(3);
    expect(fast.runs).toBeGreaterThanOrEqual(9);
  });

  it('log() writes to the agent log', () => {
    const sim = testSim();
    withFiles(sim, { 'a.py': 'class L(Agent):\n    def run(self):\n        self.log("hello", 42)\n' });
    sim.run(1);
    expect(sim.scripts.instances[0].logs.some((l) => l.text === 'hello 42')).toBe(true);
  });

  it('dispatch("scout", "nearest_unknown") sends a drone to a point of interest', () => {
    const sim = testSim();
    withFiles(sim, { 'a.py': 'class D(Agent):\n    every = 10\n    def run(self):\n        self.dispatch("scout", "nearest_unknown")\n' });
    sim.run(1);
    expect(sim.drones.some((d) => d.task?.type === 'poi')).toBe(true);
  });

  it('only one script file is active in the terminal era', () => {
    const sim = testSim();
    withFiles(sim, { 'a.py': 'class A(Agent):\n    def run(self):\n        pass\n', 'b.py': 'class B(Agent):\n    def run(self):\n        pass\n' });
    sim.run(1);
    expect(sim.scripts.instances.find((i) => i.cls.name === 'B')!.status).toBe('no_slot');
  });

  it('does not rely on eval or Function', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve(__dirname, '../src');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]));
    for (const f of walk(dir)) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
    }
  });
});

describe('FactoryScript: codex examples', () => {
  it('class fields act as defaults for self attributes (hysteresis example)', () => {
    const { sim } = deficitFactory();
    withFiles(sim, { 'h.py': 'class Hysteresis(Agent):\n    saving = False\n    def run(self):\n        if self.power < 0.6:\n            self.saving = True\n        elif self.power > 0.9:\n            self.saving = False\n        if self.saving:\n            self.disable("labs")\n        self.seen = self.saving\n' });
    sim.run(2);
    const inst = sim.scripts.instances[0];
    expect(inst.status).toBe('ok');
    expect(typeof inst.fields.seen).toBe('boolean');
  });
});
