import type { ItemId } from '../data/items';
import type { BuildingType } from '../data/buildings';
import { ITEM_PATTERNS, BUILDING_PATTERNS, RX, PROD_ALIAS, PLURAL, BUILDING_GROUP } from './lexicon';

export type Cond =
  | { kind: 'power'; op: '<' | '>'; value: number; implicit: boolean; word: 'power' | 'energy' }
  | { kind: 'stock'; item: ItemId; op: '<' | '>'; value: number }
  | { kind: 'rate'; item: ItemId; op: '<' | '>'; value: number }
  | { kind: 'night' }
  | { kind: 'day' }
  | { kind: 'enemies' };

export type Action =
  | { kind: 'disable' | 'enable'; target: string }
  | { kind: 'priority'; target: string; level: number }
  | { kind: 'route'; item: ItemId; target: string }
  | { kind: 'limit'; item: ItemId; value: number }
  | { kind: 'notify'; text: string; level: string }
  | { kind: 'recipe'; group: string; item: ItemId }
  | { kind: 'dispatch'; drone: string; target: string }
  | { kind: 'balance'; item: ItemId; groups: string[] }
  | { kind: 'disable_except'; types: string[] }
  | { kind: 'log'; item: ItemId };

export interface Rule {
  cond?: Cond;
  actions: Action[];
}

export type Special =
  | { kind: 'blueprint'; item: ItemId; rate: number }
  | { kind: 'refactor' }
  | { kind: 'scan' }
  | { kind: 'status' }
  | { kind: 'optimize'; item?: ItemId }
  | { kind: 'test'; test: { kind: 'rate_ge' | 'power_ge' | 'stock_ge'; key: string; value: number; name: string } };

export interface IntentResult {
  rules: Rule[];
  special?: Special;
  every?: number;
  /** 0..1 how much of the request was understood. */
  understanding: number;
  /** Fragments that were not understood. */
  unknown: string[];
  lang: 'ru' | 'en';
  /** Named intent patterns matched (for the response and statistics). */
  patterns: string[];
}

interface Clause {
  text: string;
  cond?: Cond;
  hasCondWord: boolean;
  action?: string;
  items: ItemId[];
  buildings: BuildingType[];
  groups: string[];
  numbers: { v: number; pct: boolean; perMin: boolean }[];
  except: BuildingType[];
  all: boolean;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"“”]/g, '')
    .replace(/\s+[—–-]\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findItems(t: string): ItemId[] {
  const out: ItemId[] = [];
  let rest = t;
  for (const [rx, id] of ITEM_PATTERNS) {
    const m = rest.match(rx);
    if (m) {
      if (!out.includes(id)) out.push(id);
      rest = rest.replace(rx, ' ');
    }
  }
  return out;
}

function findBuildings(t: string): BuildingType[] {
  const out: BuildingType[] = [];
  for (const [rx, id] of BUILDING_PATTERNS) if (rx.test(t) && !out.includes(id)) out.push(id);
  return out;
}

function findNumbers(t: string): Clause['numbers'] {
  const out: Clause['numbers'] = [];
  const rx = /(\d+(?:[.,]\d+)?)\s*(%|процент\w*|percent)?(\s*(в минуту|\/ ?мин|per minute|\/ ?min|в мин\b|штук в минуту))?/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(t))) {
    const v = Number(m[1].replace(',', '.'));
    out.push({ v, pct: !!m[2], perMin: !!m[3] || /в минуту|\/мин|per minute|rate|скорост/.test(t) });
  }
  return out;
}

const GROUP_TOKEN = /\b([a-z][a-z0-9]*_[a-z0-9_]+|line_?[a-z0-9]+)\b/g;

function findGroups(t: string, known: string[]): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const rx = new RegExp(GROUP_TOKEN.source, 'g');
  while ((m = rx.exec(t))) if (!out.includes(m[1])) out.push(m[1]);
  for (const g of known) if (new RegExp(`\\b${g}\\b`).test(t) && !out.includes(g)) out.push(g);
  return out;
}

const COND_WORD = /(^|\s)(если|когда|как только|при\s|if|when|once|whenever)/;

function parseCond(c: Clause): Cond | undefined {
  const t = c.text;
  if (RX.night.test(t) && !RX.day.test(t)) return { kind: 'night' };
  if (RX.day.test(t) && c.hasCondWord) return { kind: 'day' };
  if (RX.enemies.test(t) && c.hasCondWord) return { kind: 'enemies' };
  const less = RX.less.test(t);
  const more = RX.more.test(t) && !less;
  if (RX.power.test(t) && (less || more || c.hasCondWord)) {
    const num = c.numbers[0];
    const word: 'power' | 'energy' = /энерги|energy/.test(t) ? 'energy' : 'power';
    if (num) {
      const v = num.pct || num.v > 1 ? num.v / 100 : num.v;
      return { kind: 'power', op: more ? '>' : '<', value: Math.max(0.01, Math.min(1, v)), implicit: false, word };
    }
    return { kind: 'power', op: more ? '>' : '<', value: more ? 0.95 : 0.8, implicit: true, word };
  }
  const item = c.items[0];
  if (item && (less || more) && c.numbers.length) {
    const num = c.numbers[0];
    if (num.perMin || /производств|скорост|выпуск|production|output|rate/.test(t)) return { kind: 'rate', item, op: less ? '<' : '>', value: num.v };
    return { kind: 'stock', item, op: less ? '<' : '>', value: num.v };
  }
  if (item && (less || more) && c.hasCondWord) {
    // "если чипов мало" → stock < 100
    return { kind: 'stock', item, op: less ? '<' : '>', value: less ? 100 : 1000 };
  }
  return undefined;
}

function detectAction(t: string): string | undefined {
  if (RX.dispatch.test(t)) return 'dispatch';
  if (RX.recipe.test(t) && /\sна\s|\bto\b/.test(t)) return 'recipe';
  if (RX.balance.test(t)) return 'balance';
  if (RX.limit.test(t)) return 'limit';
  if (RX.notify.test(t)) return 'notify';
  if (RX.priority.test(t)) return 'priority';
  if (RX.disable.test(t)) return 'disable';
  if (RX.enable.test(t)) return 'enable';
  if (RX.route.test(t)) return 'route';
  if (RX.log.test(t)) return 'log';
  return undefined;
}

function splitClauses(t: string): string[] {
  t = t.replace(/,\s*(кроме|за исключением|except|but not)/g, ' $1');
  const sentences = t.split(/[.;!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    const parts = s.split(/,\s*(?:а|и|но|and|but|then|затем|потом)?\s*|\s+(?:а также|and also|and then|а|но|but|затем|потом)\s+|\s+и\s+(?=(?:если|когда|при|отключ|выключ|включ|останов|держи|уведом|сообщ|переключ|отправ|распредел|приоритет|направ|достав)\b)|\s+and\s+(?=(?:if|when|disable|enable|stop|turn|keep|notify|switch|send|make|route|deliver)\b)/);
    for (const p of parts) if (p && p.trim()) out.push(p.trim());
  }
  return out;
}

/** Analyse a natural-language request into rules / special intents. */
export function analyze(text: string, knownGroups: string[] = []): IntentResult {
  const t0 = normalize(text);
  const lang: 'ru' | 'en' = /[а-я]/.test(t0) ? 'ru' : 'en';
  const patterns: string[] = [];
  const everyM = t0.match(RX.every);
  const every = everyM ? Number(everyM[1] ?? everyM[3]) : undefined;
  const t = everyM ? t0.replace(RX.every, ' ').replace(/\s+/g, ' ').replace(/^[\s:,]+/, '') : t0;

  // ---- special (non-script) intents
  const anyScriptAction = [RX.disable, RX.enable, RX.limit, RX.notify, RX.priority, RX.route, RX.recipe, RX.dispatch, RX.balance].some((r) => r.test(t));
  if (RX.test.test(t) && /(≥|>=|не ниже|не меньше|at least|минимум|никогда не ниже|never below)/.test(t)) {
    const items = findItems(t);
    const nums = findNumbers(t);
    if (RX.power.test(t) && nums.length) {
      const v = nums[0].v > 1 ? nums[0].v / 100 : nums[0].v;
      return base({ kind: 'test', test: { kind: 'power_ge', key: 'power', value: v, name: `энергия никогда не ниже ${Math.round(v * 100)}%` } }, 'ci_test');
    }
    if (items[0] && nums.length) {
      const perMin = nums[0].perMin || /в минуту|\/мин|per minute/.test(t);
      return base({ kind: 'test', test: { kind: perMin ? 'rate_ge' : 'stock_ge', key: items[0], value: nums[0].v, name: '' } }, 'ci_test');
    }
  }
  if (RX.refactor.test(t) && !anyScriptAction) return base({ kind: 'refactor' }, 'refactor');
  if (RX.scan.test(t) && !anyScriptAction) return base({ kind: 'scan' }, 'debug_scan');
  if (RX.status.test(t) && !anyScriptAction) return base({ kind: 'status' }, 'status_report');
  if (RX.blueprint.test(t) && !anyScriptAction) {
    const items = findItems(t);
    const nums = findNumbers(t);
    if (items[0]) return base({ kind: 'blueprint', item: items[0], rate: nums[0]?.v ?? 30 }, 'architect_line');
  }
  if (RX.optimize.test(t) && !anyScriptAction) return base({ kind: 'optimize', item: findItems(t)[0] }, 'optimize');

  // ---- clauses
  const clauses: Clause[] = splitClauses(t).map((text) => {
    const c: Clause = {
      text,
      hasCondWord: COND_WORD.test(text) || RX.night.test(text) || RX.day.test(text),
      items: findItems(text),
      buildings: findBuildings(text),
      groups: findGroups(text, knownGroups),
      numbers: findNumbers(text),
      except: [],
      all: RX.all.test(text),
      action: undefined,
    };
    // split "action ... when/if cond" inside one clause (English style)
    const m = text.match(/^(.*?)\s+(when|if|once|whenever|когда|если)\s+(.*)$/);
    if (m && detectAction(m[1]) && !detectAction(m[3])) {
      const actionPart: Clause = { ...c, text: m[1], items: findItems(m[1]), buildings: findBuildings(m[1]), groups: findGroups(m[1], knownGroups), numbers: findNumbers(m[1]), hasCondWord: false };
      const condPart: Clause = { ...c, text: m[3], items: findItems(m[3]), buildings: findBuildings(m[3]), groups: [], numbers: findNumbers(m[3]), hasCondWord: true };
      actionPart.action = detectAction(actionPart.text);
      actionPart.cond = parseCond(condPart);
      if (!actionPart.cond) actionPart.cond = parseCond({ ...condPart, text: m[3] + ' ' + m[1] });
      return actionPart;
    }
    if (RX.except.test(text)) {
      const [before, after] = text.split(RX.except);
      c.except = findBuildings(after ?? '');
      c.buildings = findBuildings(before);
    }
    c.action = detectAction(text);
    if (c.hasCondWord || (!c.action && (RX.night.test(text) || RX.day.test(text)))) c.cond = parseCond(c);
    return c;
  });

  const rules: Rule[] = [];
  const unknown: string[] = [];
  let pendingCond: Cond | undefined;
  let understood = 0;
  let meaningful = 0;
  let last: { rule: Rule; clause: Clause } | null = null;
  const filler = /^(сделай так|сделай|пожалуйста|please|make it so|хочу|нужно|надо|давай)$/;

  for (const c of clauses) {
    if (filler.test(c.text)) continue;
    meaningful++;
    if (!c.action) {
      if (c.cond) {
        understood++;
        if (last && !last.rule.cond && !pendingCond && clauses.indexOf(c) === clauses.length - 1) {
          last.rule.cond = c.cond;
          patterns.push('trailing_condition');
        } else pendingCond = c.cond;
        continue;
      }
      if (last && (c.items.length || c.buildings.length || c.groups.length)) {
        // "... плавильни и химзаводы" → extra targets for the previous action
        const extra = buildActions(last.clause.action!, c, patterns);
        if (extra.length) {
          last.rule.actions.push(...extra);
          understood++;
          continue;
        }
      }
      unknown.push(c.text);
      continue;
    }
    const actions = buildActions(c.action, c, patterns);
    if (!actions.length) {
      unknown.push(c.text);
      continue;
    }
    understood++;
    const cond = c.cond ?? pendingCond;
    pendingCond = undefined;
    const rule: Rule = { cond, actions };
    rules.push(rule);
    last = { rule, clause: c };
  }
  if (pendingCond && last && !last.rule.cond) last.rule.cond = pendingCond;
  for (const r of rules) if (r.cond) patterns.push('cond_' + r.cond.kind);
  return { rules, every, understanding: meaningful ? understood / meaningful : 0, unknown, lang, patterns };

  function base(special: Special, pattern: string): IntentResult {
    return { rules: [], special, every, understanding: 1, unknown: [], lang, patterns: [pattern] };
  }
}

function productionGroup(item: ItemId): string {
  return `${PROD_ALIAS[item] ?? item}_production`;
}

function targetFor(c: Clause, mode: 'toggle' | 'priority'): string[] {
  if (c.groups.length) return c.groups;
  if (c.all && !c.items.length && !c.buildings.length) return ['all'];
  const out: string[] = [];
  if (c.buildings.length) {
    for (const b of c.buildings) {
      const it = c.items[0];
      if (b === 'smelter' && it) {
        const stem = it.replace(/_ore|_plate/, '');
        out.push(`${stem}_smelters`);
      } else if (it && (b === 'assembler' || b === 'chem') && mode === 'toggle') out.push(productionGroup(it));
      else out.push(BUILDING_GROUP[b] ?? b);
    }
    return out;
  }
  for (const it of c.items) out.push(mode === 'priority' ? PLURAL[it] ?? it : productionGroup(it));
  return out;
}

function buildActions(action: string, c: Clause, patterns: string[]): Action[] {
  const out: Action[] = [];
  const it = c.items[0];
  switch (action) {
    case 'disable':
    case 'enable': {
      if (c.except.length || (c.all && c.except.length === 0 && /кроме|except/.test(c.text))) {
        const types = c.except.flatMap((b) => (b === 'server' ? ['server', 'datacenter'] : [b]));
        out.push({ kind: 'disable_except', types });
        patterns.push('disable_all_except');
        break;
      }
      for (const target of targetFor(c, 'toggle')) out.push({ kind: action, target });
      if (out.length) patterns.push(action + '_group');
      break;
    }
    case 'priority': {
      const lvl = /низк|low(est)? priority|в последнюю/.test(c.text) ? 5 : c.numbers.find((n) => n.v >= 1 && n.v <= 5)?.v ?? 1;
      for (const target of targetFor(c, 'priority')) out.push({ kind: 'priority', target, level: lvl });
      if (out.length) patterns.push('priority');
      break;
    }
    case 'route': {
      if (!it) break;
      let target = 'smelter';
      if (c.groups.length) target = c.groups[0];
      else if (/склад|storage|хранил/.test(c.text)) target = 'storage';
      else if (c.buildings.length) target = BUILDING_GROUP[c.buildings[0]] ?? c.buildings[0];
      else if (!/_ore$|^stone$/.test(it)) target = 'assembler';
      out.push({ kind: 'route', item: it, target });
      patterns.push('route_item');
      break;
    }
    case 'limit': {
      const n = c.numbers[0]?.v;
      if (!it || n === undefined) break;
      out.push({ kind: 'limit', item: it, value: n });
      patterns.push('limit_stock');
      break;
    }
    case 'notify':
      out.push({ kind: 'notify', text: '', level: 'warning' });
      patterns.push('notify');
      break;
    case 'recipe': {
      const group = c.groups[0] ?? (c.buildings[0] ? BUILDING_GROUP[c.buildings[0]] ?? c.buildings[0] : 'assembler');
      const after = c.text.split(/\sна\s|\bto\b/).slice(1).join(' ');
      const item = findItems(after)[0] ?? it;
      if (!item) break;
      out.push({ kind: 'recipe', group, item });
      patterns.push('set_recipe');
      break;
    }
    case 'dispatch': {
      let drone = 'scout';
      let target = 'nearest_unknown';
      if (/боев|combat|защит|defen/.test(c.text)) {
        drone = 'combat';
        target = 'enemies';
      } else if (/инжен|engineer|почин|repair/.test(c.text)) {
        drone = 'engineer';
        target = 'damaged';
      }
      out.push({ kind: 'dispatch', drone, target });
      patterns.push('dispatch_' + drone);
      break;
    }
    case 'balance': {
      if (!it) break;
      out.push({ kind: 'balance', item: it, groups: c.groups });
      patterns.push('balance_item');
      break;
    }
    case 'log':
      if (it) {
        out.push({ kind: 'log', item: it });
        patterns.push('log_rate');
      }
      break;
  }
  return out;
}

/** The catalogue of named intent templates (documentation + UI examples). */
export const INTENT_TEMPLATES: { id: string; example: string }[] = [
  { id: 'route_item', example: 'Доставляй медную руду на переработку' },
  { id: 'priority', example: 'Приоритет — аккумуляторам' },
  { id: 'priority_when_power_low', example: 'Make batteries top priority when power is low' },
  { id: 'disable_on_power_low', example: 'Если энергии не хватает — отключай производство микросхем' },
  { id: 'disable_on_power_threshold', example: 'Когда энергия ниже 20%, выключи химзавод' },
  { id: 'enable_on_power_high', example: 'Если энергии больше 95%, включи лаборатории' },
  { id: 'stop_when_stock_above', example: 'Если железных пластин больше 1000 — останови плавильни железа' },
  { id: 'start_when_stock_below', example: 'Если пластика меньше 200, включи химзавод' },
  { id: 'limit_stock', example: 'Держи запас аккумуляторов на уровне 500' },
  { id: 'night_disable_all_except', example: 'Ночью отключай всё, кроме серверов' },
  { id: 'night_disable_group', example: 'Ночью выключай лаборатории' },
  { id: 'day_enable_group', example: 'Днём включай сборочные цеха' },
  { id: 'notify_rate_below', example: 'Уведоми меня, если производство чипов упадёт ниже 50 в минуту' },
  { id: 'notify_stock_below', example: 'Сообщи, если медных пластин меньше 100' },
  { id: 'notify_power_low', example: 'Предупреди, когда энергии не хватает' },
  { id: 'notify_enemies', example: 'Уведоми, если враги атакуют' },
  { id: 'set_recipe', example: 'Переключи сборщики группы line_b на модули памяти' },
  { id: 'dispatch_scout', example: 'Отправь дрона исследовать ближайшую неизвестную область' },
  { id: 'dispatch_combat', example: 'Если враги атакуют — отправь боевых дронов' },
  { id: 'balance_item', example: 'Распредели медные пластины поровну между двумя линиями' },
  { id: 'enable_group', example: 'Включи все плавильни' },
  { id: 'disable_group', example: 'Выключи буры на меди' },
  { id: 'log_rate', example: 'Логируй производство шестерён' },
  { id: 'priority_when_stock_low', example: 'Если чипов мало — дай приоритет микросхемам' },
  { id: 'composite', example: 'Медь — на переработку, приоритет аккумуляторам, при нехватке энергии отключай чипы' },
  { id: 'architect_line', example: 'Построй линию микросхем на 60 в минуту' },
  { id: 'refactor', example: 'Отрефактори скрипты и снизь техдолг' },
  { id: 'debug_scan', example: 'Найди баги в автоматизации' },
  { id: 'optimize', example: 'Найди узкие места и оптимизируй производство' },
  { id: 'status_report', example: 'Что происходит на фабрике?' },
  { id: 'ci_test', example: 'Добавь тест: микросхем ≥ 100 в минуту' },
];
