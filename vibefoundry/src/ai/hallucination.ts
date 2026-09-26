import type { Sim } from '../sim/sim';
import type { Agent, BugRecord } from './state';
import { modelVersion } from './state';
import { contextFit } from './context';
import { ROLES } from './agents';
import type { Rng } from '../core/rng';

/** Probability that generated code contains a hidden bug. */
export function hallucinationChance(sim: Sim, agent: Agent): number {
  if (!sim.settings.hallucinations) return 0;
  const v = modelVersion(sim.ai);
  const base = Math.max(0.03, Math.min(0.4, 0.32 - (v - 1) * 0.12));
  const fit = contextFit(sim);
  const role = ROLES[agent.role].halluc;
  const level = Math.max(0.6, 1 - (agent.level - 1) * 0.05);
  const debt = 1 + sim.ai.techDebt / 100;
  const ctx = 1 + (1 - fit) * 2;
  const research = 1 - sim.effects.hallucination;
  return Math.max(0, Math.min(0.85, base * role * level * debt * ctx * research));
}

const ITEM_TYPOS: Record<string, string> = {
  copper_ore: 'coper_ore', iron_ore: 'iron_or', copper_plate: 'copper_plates_', iron_plate: 'iron_plat', battery: 'batery', microchip: 'micro_chip',
  plastic: 'plastik', gear: 'gears_', memory_module: 'memory_modul', silicon_wafer: 'silicon_waffer', steel: 'stel', uranium_fuel: 'uranium_fuell',
};

const TYPE_DESC: Record<BugRecord['type'], string> = {
  wrong_item: 'Неверное имя предмета — действие молча не выполняется',
  inverted: 'Инвертированное условие — правило срабатывает в обратной ситуации',
  flapping: 'Дребезг — здания включаются и выключаются каждую секунду',
  bad_group: 'Маршрут/действие в несуществующую группу',
  missing_else: 'Забытая ветка else — часть логики не выполняется',
  bad_threshold: 'Порог не в той шкале (доля стала процентами) — правило срабатывает всегда',
};

/**
 * Corrupt the code with one realistic bug. Returns the new code and a bug record,
 * or null if no applicable mutation exists.
 */
export function hallucinate(code: string, rng: Rng): { code: string; bug: BugRecord } | null {
  const lines = code.split('\n');
  const options: (() => { code: string; bug: BugRecord } | null)[] = [];
  const at = (i: number, text: string, type: BugRecord['type']) => {
    const copy = lines.slice();
    copy[i] = text;
    return { code: copy.join('\n'), bug: { type, line: i + 1, desc: TYPE_DESC[type], original: code } };
  };
  lines.forEach((l, i) => {
    // wrong item name in item-taking calls
    const mi = l.match(/self\.(route|limit|stock|rate|balance)\("([a-z_]+)"/);
    if (mi && ITEM_TYPOS[mi[2]]) options.push(() => at(i, l.replace(`"${mi[2]}"`, `"${ITEM_TYPOS[mi[2]]}"`), 'wrong_item'));
    // inverted comparison inside if
    const mc = l.match(/^(\s*)if (.+?) (<|>) (.+):$/);
    if (mc) options.push(() => at(i, `${mc[1]}if ${mc[2]} ${mc[3] === '<' ? '>' : '<'} ${mc[4]}:`, 'inverted'));
    // flapping: condition also true every other second
    const mf = l.match(/^(\s*)if (.+):$/);
    if (mf && /disable|shutdown|enable/.test(lines[i + 1] ?? '')) options.push(() => at(i, `${mf[1]}if ${mf[2]} or int(self.time) % 2 == 0:`, 'flapping'));
    // threshold in the wrong scale: 0.8 → 80
    const mt = l.match(/^(\s*)if (self\.(?:power|energy)) (<|>) (0\.\d+):$/);
    if (mt) options.push(() => at(i, `${mt[1]}if ${mt[2]} ${mt[3]} ${Math.round(Number(mt[4]) * 100)}:`, 'bad_threshold'));
    // hallucinated group name
    const mg = l.match(/self\.(disable|enable|shutdown|set_priority|set_recipe)\("([a-z_0-9]+)"/);
    if (mg && mg[2] !== 'all') options.push(() => at(i, l.replace(`"${mg[2]}"`, `"${mg[2]}_v2"`), 'bad_group'));
    const mr = l.match(/self\.route\("([a-z_]+)", "([a-z_0-9]+)"\)/);
    if (mr) options.push(() => at(i, l.replace(`"${mr[2]}")`, `"${mr[2]}_line")`).replace('_line_line', '_line2'), 'bad_group'));
  });
  // missing else: drop an else block
  const elseIdx = lines.findIndex((l) => /^\s*else:\s*$/.test(l));
  if (elseIdx >= 0) {
    options.push(() => {
      const indent = lines[elseIdx].match(/^\s*/)![0].length;
      let end = elseIdx + 1;
      while (end < lines.length && (lines[end].trim() === '' || lines[end].match(/^\s*/)![0].length > indent)) end++;
      const copy = [...lines.slice(0, elseIdx), ...lines.slice(end)];
      return { code: copy.join('\n'), bug: { type: 'missing_else', line: elseIdx, desc: TYPE_DESC.missing_else, original: code } };
    });
  }
  if (!options.length) return null;
  return rng.pick(options)();
}
