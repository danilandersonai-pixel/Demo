import { ITEMS, type ItemId } from '../data/items';
import { ITEM_STEM } from './lexicon';
import type { Action, Cond, IntentResult, Rule } from './intent';

export interface GenResult {
  code: string;
  classes: string[];
  mainClass: string;
  checklist: string[];
}

const I1 = '    ';
const I2 = '        ';
const I3 = '            ';

function pascal(s: string): string {
  return s.split(/[_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}
function stem(item: ItemId | undefined): string {
  return item ? ITEM_STEM[item] ?? pascal(item) : '';
}
function num(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
}
function str(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function condCode(c: Cond, forceWord?: 'power' | 'energy'): string {
  switch (c.kind) {
    case 'power':
      return `self.${forceWord ?? (c.implicit ? 'power' : c.word)} ${c.op} ${num(c.value)}`;
    case 'stock':
      return `self.stock(${str(c.item)}) ${c.op} ${num(c.value)}`;
    case 'rate':
      return `self.rate(${str(c.item)}) ${c.op} ${num(c.value)}`;
    case 'night':
      return 'self.is_night';
    case 'day':
      return 'not self.is_night';
    case 'enemies':
      return '"enemies" in self.alerts';
  }
}

function notifyText(cond: Cond | undefined): [string, string | null] {
  if (!cond) return ['Условие агента выполнено', 'info'];
  switch (cond.kind) {
    case 'rate':
      return [`Производство: ${ITEMS[cond.item].short} ${cond.op === '<' ? 'ниже' : 'выше'} ${num(cond.value)}/мин`, 'warning'];
    case 'stock':
      return [`Запас: ${ITEMS[cond.item].short} ${cond.op === '<' ? 'меньше' : 'больше'} ${num(cond.value)}`, 'warning'];
    case 'power':
      return ['low_energy', null];
    case 'enemies':
      return ['Сбойные автоматы атакуют фабрику', 'danger'];
    case 'night':
      return ['Наступила ночь', 'info'];
    case 'day':
      return ['Наступил день', 'info'];
  }
}

function actionLines(a: Action, cond: Cond | undefined, indent: string): string[] {
  switch (a.kind) {
    case 'disable':
      return [`${indent}self.disable(${str(a.target)})`];
    case 'enable':
      return [`${indent}self.enable(${str(a.target)})`];
    case 'priority':
      return [`${indent}self.set_priority(${str(a.target)}, ${a.level})`];
    case 'route':
      return [`${indent}self.route(${str(a.item)}, ${str(a.target)})`];
    case 'limit':
      return [`${indent}self.limit(${str(a.item)}, ${num(a.value)})`];
    case 'notify': {
      const [text, level] = notifyText(cond);
      return [`${indent}self.notify(${str(text)}${level ? `, ${str(level)}` : ''})`];
    }
    case 'recipe':
      return [`${indent}self.set_recipe(${str(a.group)}, ${str(a.item)})`];
    case 'dispatch':
      return [`${indent}self.dispatch(${str(a.drone)}, ${str(a.target)})`];
    case 'balance':
      return [`${indent}self.balance(${[str(a.item), ...a.groups.map(str)].join(', ')})`];
    case 'disable_except': {
      const list = '[' + a.types.map(str).join(', ') + ']';
      return [`${indent}for b in self.buildings("all"):`, `${indent}${I1}if b.type not in ${list}:`, `${indent}${I2}self.disable(b)`];
    }
    case 'log':
      return [`${indent}self.log(${str(ITEMS[a.item].name + ':')}, self.rate(${str(a.item)}), "/мин")`];
  }
}

function className(rules: Rule[]): string {
  const acts = rules.flatMap((r) => r.actions);
  const conds = rules.map((r) => r.cond).filter(Boolean) as Cond[];
  const find = <K extends Action['kind']>(k: K) => acts.find((a) => a.kind === k) as Extract<Action, { kind: K }> | undefined;
  const route = find('route');
  if (route) return `${stem(route.item)}Router`;
  const limit = find('limit');
  if (limit) return `${stem(limit.item)}Stock`;
  if (find('disable_except')) return conds.some((c) => c.kind === 'night') ? 'NightShift' : 'Shutdown';
  const recipe = find('recipe');
  if (recipe) return `${pascal(recipe.group)}Switcher`;
  const dispatch = find('dispatch');
  if (dispatch) return dispatch.drone === 'combat' ? 'DefenseManager' : dispatch.drone === 'engineer' ? 'RepairDispatcher' : 'ScoutDispatcher';
  const balance = find('balance');
  if (balance) return `${stem(balance.item)}Balancer`;
  if (find('notify')) {
    const c = conds[0];
    if (c?.kind === 'rate' || c?.kind === 'stock') return `${stem(c.item)}Watcher`;
    if (c?.kind === 'power') return 'PowerWatcher';
    if (c?.kind === 'enemies') return 'ThreatWatcher';
    return 'Watcher';
  }
  const prio = find('priority');
  if (prio && acts.every((a) => a.kind === 'priority')) {
    const it = Object.entries(ITEM_STEM).find(([k]) => prio.target.startsWith(k) || prio.target.startsWith(k.split('_')[0]));
    const s = prio.target === 'batteries' ? 'Battery' : prio.target === 'chips' ? 'Chip' : it ? it[1] : pascal(prio.target);
    return `${s}Priority`;
  }
  const c0 = conds[0];
  if (c0?.kind === 'power') return 'PowerSaver';
  if (c0?.kind === 'stock') return `${stem(c0.item)}Limiter`;
  if (c0?.kind === 'night') return 'NightShift';
  if (c0?.kind === 'day') return 'DayShift';
  if (c0?.kind === 'enemies') return 'DefenseManager';
  const log = find('log');
  if (log) return `${stem(log.item)}Logger`;
  return 'Automation';
}

/** Generate FactoryScript from analysed intent. Returns null when there is nothing to generate. */
export function generate(ir: IntentResult): GenResult | null {
  const rules = ir.rules.filter((r) => r.actions.length);
  if (!rules.length) return null;
  const name = className(rules);
  const acts = rules.flatMap((r) => r.actions);
  const onlyWatch = acts.every((a) => a.kind === 'notify' || a.kind === 'log');
  const method = onlyWatch ? 'monitor' : 'run';
  const hasRoute = acts.some((a) => a.kind === 'route');
  let every: number | undefined = ir.every;
  let everyComment = false;
  if (every === undefined) {
    if (hasRoute) {
      every = 2;
      everyComment = true;
    } else if (acts.some((a) => a.kind === 'dispatch')) every = 10;
    else if (onlyWatch && rules.some((r) => r.cond?.kind === 'rate')) every = 5;
    else if (rules.some((r) => r.cond?.kind === 'night' || r.cond?.kind === 'day')) every = 5;
  }
  const lines: string[] = [`class ${name}(Agent):`];
  if (every !== undefined) lines.push(everyComment ? `${I1}every = ${num(every)}          # запускать каждые ${num(every)} секунды игрового времени` : `${I1}every = ${num(every)}`);
  lines.push(`${I1}def ${method}(self):`);
  // conditional rules first, then priorities, then routes, then the rest (matches the reference layout)
  const conditional = rules.filter((r) => r.cond);
  const plain = rules.filter((r) => !r.cond).flatMap((r) => r.actions);
  const order: Action['kind'][] = ['priority', 'route', 'limit', 'balance', 'recipe', 'enable', 'disable', 'disable_except', 'dispatch', 'notify', 'log'];
  for (const r of conditional) {
    lines.push(`${I2}if ${condCode(r.cond!)}:`);
    for (const a of r.actions) lines.push(...actionLines(a, r.cond, I3));
  }
  for (const k of order) for (const a of plain) if (a.kind === k) lines.push(...actionLines(a, undefined, I2));
  const classes = [name];
  // Safety monitor for implicit energy shortage (the "EnergyManager" of the reference).
  const shortage = conditional.filter((r) => r.cond?.kind === 'power' && r.cond.implicit && r.cond.op === '<' && r.actions.some((a) => a.kind === 'disable'));
  if (shortage.length) {
    const targets = shortage.flatMap((r) => r.actions.flatMap((a) => (a.kind === 'disable' ? [a.target] : [])));
    lines.push('', 'class EnergyManager(Agent):', `${I1}def monitor(self):`, `${I2}if self.energy < 0.6:`);
    for (const t of targets) lines.push(`${I3}self.shutdown(${str(t)})`);
    lines.push(`${I3}self.notify("low_energy")`);
    classes.push('EnergyManager');
  }
  const code = lines.join('\n') + '\n';
  // checklist
  const cl = ['Написан код для агентов'];
  if (acts.some((a) => a.kind === 'priority')) cl.push('Настроены приоритеты');
  if (rules.some((r) => r.cond?.kind === 'power')) cl.push('Добавлены условия по энергии');
  if (method === 'monitor' || shortage.length) cl.push('Запущен мониторинг');
  if (hasRoute) cl.push('Настроены маршруты доставки');
  if (acts.some((a) => a.kind === 'limit')) cl.push('Задан лимит запаса');
  if (rules.some((r) => r.cond?.kind === 'stock' || r.cond?.kind === 'rate')) cl.push('Добавлен контроль производства');
  if (rules.some((r) => r.cond?.kind === 'night' || r.cond?.kind === 'day')) cl.push('Добавлено расписание день/ночь');
  if (acts.some((a) => a.kind === 'recipe')) cl.push('Переключены рецепты');
  if (acts.some((a) => a.kind === 'dispatch')) cl.push('Дроны получат задание');
  if (acts.some((a) => a.kind === 'balance')) cl.push('Настроено равномерное распределение');
  if (acts.some((a) => a.kind === 'notify') && method !== 'monitor') cl.push('Настроены уведомления');
  if (acts.some((a) => a.kind === 'disable' || a.kind === 'disable_except') && !rules.some((r) => r.cond)) cl.push('Здания отключены');
  return { code, classes, mainClass: name, checklist: cl };
}
