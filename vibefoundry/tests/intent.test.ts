import { describe, it, expect } from 'vitest';
import { analyze } from '../src/vibe/intent';
import { generate } from '../src/vibe/codegen';
import { parse } from '../src/script/parser';

const gen = (text: string, groups: string[] = []) => {
  const ir = analyze(text, groups);
  const g = generate(ir);
  return { ir, g, code: g?.code ?? '' };
};

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

describe('intent engine: 10 mandatory requests', () => {
  it('1. copper routing + battery priority + chip shutdown → exactly the reference code', () => {
    const { code, g } = gen('Сделай так, чтобы медная руда автоматически доставлялась на переработку, приоритет отдавался аккумуляторам, а если энергии не хватает — временно отключай производство микросхем.');
    expect(code).toBe(REFERENCE);
    expect(g!.checklist.slice(0, 4)).toEqual(['Написан код для агентов', 'Настроены приоритеты', 'Добавлены условия по энергии', 'Запущен мониторинг']);
    expect(() => parse(code)).not.toThrow();
  });

  it('2. stop iron smelters when iron plates exceed 1000', () => {
    const { code } = gen('Если железных пластин больше 1000 — останови плавильни железа.');
    expect(code).toContain('if self.stock("iron_plate") > 1000:');
    expect(code).toContain('self.disable("iron_smelters")');
    expect(code).toContain('class IronLimiter(Agent):');
    parse(code);
  });

  it('3. keep 500 batteries in stock', () => {
    const { code } = gen('Держи запас аккумуляторов на уровне 500.');
    expect(code).toContain('self.limit("battery", 500)');
    expect(code).toContain('class BatteryStock(Agent):');
    parse(code);
  });

  it('4. disable the chemical plant below 20% energy', () => {
    const { code } = gen('Когда энергия ниже 20%, выключи химзавод.');
    expect(code).toContain('if self.energy < 0.2:');
    expect(code).toContain('self.disable("chem")');
    expect(code).not.toContain('EnergyManager');
    parse(code);
  });

  it('5. at night disable everything except servers', () => {
    const { code } = gen('Ночью отключай всё, кроме серверов.');
    expect(code).toContain('if self.is_night:');
    expect(code).toContain('for b in self.buildings("all"):');
    expect(code).toContain('if b.type not in ["server", "datacenter"]:');
    expect(code).toContain('self.disable(b)');
    parse(code);
  });

  it('6. notify when chip production drops below 50/min', () => {
    const { code } = gen('Уведоми меня, если производство чипов упадёт ниже 50 в минуту.');
    expect(code).toContain('def monitor(self):');
    expect(code).toContain('if self.rate("microchip") < 50:');
    expect(code).toContain('self.notify(');
    expect(code).toContain('class ChipWatcher(Agent):');
    parse(code);
  });

  it('7. switch assemblers of group line_b to memory modules', () => {
    const { code } = gen('Переключи сборщики группы line_b на модули памяти.', ['line_b']);
    expect(code).toContain('self.set_recipe("line_b", "memory_module")');
    expect(code).toContain('class LineBSwitcher(Agent):');
    parse(code);
  });

  it('8. send a drone to explore the nearest unknown area', () => {
    const { code } = gen('Отправь дрона исследовать ближайшую неизвестную область.');
    expect(code).toContain('self.dispatch("scout", "nearest_unknown")');
    expect(code).toContain('every = 10');
    parse(code);
  });

  it('9. split copper plates evenly between two lines', () => {
    const { code } = gen('Распредели медные пластины поровну между двумя линиями.');
    expect(code).toContain('self.balance("copper_plate")');
    expect(code).toContain('class CopperBalancer(Agent):');
    parse(code);
  });

  it('10. English: make batteries top priority when power is low', () => {
    const { code, ir } = gen('Make batteries top priority when power is low.');
    expect(ir.lang).toBe('en');
    expect(code).toContain('if self.power < 0.8:');
    expect(code).toContain('self.set_priority("batteries", 1)');
    expect(code).toContain('class BatteryPriority(Agent):');
    parse(code);
  });
});

describe('intent engine: more templates', () => {
  const cases: [string, string[]][] = [
    ['Доставляй медную руду на переработку', ['self.route("copper_ore", "smelter")']],
    ['Если энергии больше 95%, включи лаборатории', ['if self.energy > 0.95:', 'self.enable("labs")']],
    ['Если пластика меньше 200, включи химзавод', ['if self.stock("plastic") < 200:', 'self.enable("chem")']],
    ['Ночью выключай лаборатории', ['if self.is_night:', 'self.disable("labs")']],
    ['Днём включай сборочные цеха', ['if not self.is_night:', 'self.enable("assembler")']],
    ['Сообщи, если медных пластин меньше 100', ['if self.stock("copper_plate") < 100:', 'self.notify(']],
    ['Предупреди, когда энергии не хватает', ['if self.power < 0.8:', 'self.notify("low_energy")']],
    ['Уведоми, если враги атакуют', ['if "enemies" in self.alerts:', 'self.notify(']],
    ['Если враги атакуют — отправь боевых дронов', ['if "enemies" in self.alerts:', 'self.dispatch("combat", "enemies")']],
    ['Включи все плавильни', ['self.enable("smelter")']],
    ['Выключи химзавод и плавильни', ['self.disable("chem")', 'self.disable("smelter")']],
    ['Отключи буры на железе, если железа больше 2000', ['if self.stock("iron_ore") > 2000:', 'self.disable("iron_mining")']],
    ['Логируй производство шестерён', ['self.log(', 'self.rate("gear")']],
    ['Если чипов мало — дай приоритет микросхемам', ['if self.stock("microchip") < 100:', 'self.set_priority("chips", 1)']],
    ['Keep 300 plastic in stock', ['self.limit("plastic", 300)']],
    ['Disable smelters at night', ['if self.is_night:', 'self.disable("smelter")']],
    ['Каждые 5 секунд проверяй: если энергии меньше 50%, отключи сборочные цеха', ['every = 5', 'if self.energy < 0.5:', 'self.disable("assembler")']],
  ];
  for (const [text, parts] of cases) {
    it(text, () => {
      const { code } = gen(text);
      for (const p of parts) expect(code).toContain(p);
      expect(() => parse(code)).not.toThrow();
    });
  }

  it('recognises special intents', () => {
    expect(analyze('Построй линию микросхем на 60 в минуту').special).toEqual({ kind: 'blueprint', item: 'microchip', rate: 60 });
    expect(analyze('Найди баги в автоматизации').special?.kind).toBe('scan');
    expect(analyze('Отрефактори скрипты').special?.kind).toBe('refactor');
    expect(analyze('Что происходит на фабрике?').special?.kind).toBe('status');
    expect(analyze('Найди узкие места и оптимизируй производство').special?.kind).toBe('optimize');
    const t = analyze('Добавь тест: микросхем ≥ 100 в минуту').special;
    expect(t?.kind).toBe('test');
  });

  it('returns nothing for gibberish (the agent will ask a clarifying question)', () => {
    const ir = analyze('абырвалг квазимодо');
    expect(generate(ir)).toBeNull();
    expect(ir.understanding).toBe(0);
  });
});
