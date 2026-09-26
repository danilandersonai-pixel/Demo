// Система угроз и глобальных событий: каждые 30 дней выпадает случайное событие.
// Часть событий мгновенна (временные модификаторы), часть требует решения игрока
// в течение DECISION_WINDOW дней — иначе срабатывает вариант по умолчанию.

import { BUILDINGS, DECISION_WINDOW, RESEARCH, agree, cellLabel, severityAt, threatAt } from './config.ts';
import { countBuildings, computeEconomy, effectiveDataPrice, hasResearch } from './economy.ts';
import { fmt } from './format.ts';
import { addModifier, pushEventRecord, pushLog, updateRecords } from './mutators.ts';
import type { Rng } from './rng.ts';
import type { DecisionOption, EventId, EventPolarity, GameState, LogTone, PendingDecision } from './types.ts';

interface EventDef {
  id: EventId;
  title: string;
  polarity: EventPolarity;
  weight: (s: GameState) => number;
  trigger: (s: GameState, rng: Rng) => void;
}

const ZERO = { credits: 0, data: 0 };

function positive(value: number): number {
  return Math.max(0, value);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function setPending(
  s: GameState,
  decision: Omit<PendingDecision, 'startDay' | 'expiresDay' | 'resumeSpeed'>,
): void {
  // На ускорении 10 дней — это пара секунд. Сбрасываем до 1×, чтобы игрок успел прочитать варианты.
  const resumeSpeed = s.speed > 1 ? s.speed : 0;
  if (resumeSpeed) s.speed = 1;
  s.pending = { ...decision, startDay: s.day, expiresDay: s.day + DECISION_WINDOW, resumeSpeed };
  pushLog(
    s,
    `${decision.title}! Требуется решение — ${DECISION_WINDOW} дн. на ответ${resumeSpeed ? ' (скорость снижена до 1×)' : ''}`,
    'danger',
    'event',
  );
}

function instant(s: GameState, id: EventId, title: string, text: string, tone: LogTone): void {
  pushLog(s, text, tone, 'event');
  pushEventRecord(s, id, title, text, tone);
}

const option = (o: DecisionOption): DecisionOption => o;

export const EVENTS: Record<EventId, EventDef> = {
  hack: {
    id: 'hack',
    title: 'Хакерская атака',
    polarity: 'bad',
    weight: () => 12,
    trigger(s) {
      const fw = hasResearch(s, 'neuroFirewall');
      const sev = severityAt(s.day);
      const c = positive(s.credits);
      const loss = Math.round(c * (fw ? 0.1 : 0.2));
      const dataLoss = Math.floor(s.data * (fw ? 0.05 : 0.15));
      const protect = Math.round(Math.max(50 * sev, c * 0.08) * (fw ? 0.5 : 1));
      const counterData = Math.round(35 * sev);
      const chance = fw ? 0.75 : 0.55;
      const gain = Math.round(c * 0.12 + 80 * sev);
      const failLoss = Math.round(c * (fw ? 0.15 : 0.3));
      setPending(s, {
        eventId: 'hack',
        title: 'Хакерская атака',
        description:
          'Группировка «Чёрный лёд» пробила внешний контур сети и готовит вывод средств с кошельков синдиката.',
        options: [
          option({
            id: 'protect',
            label: 'Нанять защиту',
            detail: `Контракт с кибер-наёмниками за ${fmt(protect)}₵. Атака отражена без потерь.`,
            tone: 'safe',
            cost: { credits: protect, data: 0 },
          }),
          option({
            id: 'counter',
            label: 'Контратака',
            detail: `Потратить ${fmt(counterData)} ед. данных. Шанс ${pct(chance)}: украсть ${fmt(gain)}₵. Провал: потеря ${fmt(failLoss)}₵.`,
            tone: 'risky',
            cost: { credits: 0, data: counterData },
          }),
          option({
            id: 'ignore',
            label: 'Игнорировать',
            detail: `Хакеры выведут ${fmt(loss)}₵ (${fw ? '10' : '20'}% кредитов)${dataLoss > 0 ? ` и сотрут ${fmt(dataLoss)} ед. данных` : ''}.`,
            tone: 'danger',
            cost: ZERO,
          }),
        ],
        defaultOption: 'ignore',
        ctx: { protect, counterData, chance, gain, failLoss, loss, dataLoss },
      });
    },
  },

  taxAudit: {
    id: 'taxAudit',
    title: 'Налоговая проверка',
    polarity: 'bad',
    weight: (s) => (s.day >= 60 ? 10 : 0),
    trigger(s) {
      const ledger = hasResearch(s, 'shadowLedger');
      const sev = severityAt(s.day);
      const c = positive(s.credits);
      const tax = Math.round((c * 0.1 + 3 * countBuildings(s) * sev) * (ledger ? 0.5 : 1));
      const bribe = Math.round(tax * 0.45);
      const bribeRisk = 0.35;
      const fine = Math.round(tax * 2.2);
      const lawyersData = Math.round(50 * sev);
      const lawyersChance = 0.6;
      const penalty = Math.round(tax * 1.5);
      setPending(s, {
        eventId: 'taxAudit',
        title: 'Налоговая проверка',
        description:
          'Инспекция Корпоративного Надзора запросила отчётность синдиката. Налог насчитан с капитала и числа объектов.',
        options: [
          option({
            id: 'pay',
            label: 'Уплатить налог',
            detail: `Списать ${fmt(tax)}₵. Платёж обязателен — при нехватке средств баланс уйдёт в минус.`,
            tone: 'neutral',
            cost: ZERO,
          }),
          option({
            id: 'bribe',
            label: 'Дать взятку',
            detail: `Инспектору ${fmt(bribe)}₵. Шанс ${pct(bribeRisk)} попасться: штраф ${fmt(fine)}₵.`,
            tone: 'risky',
            cost: { credits: bribe, data: 0 },
          }),
          option({
            id: 'lawyers',
            label: 'Нанять юристов',
            detail: `Потратить ${fmt(lawyersData)} ед. данных на компромат. Шанс ${pct(lawyersChance)} избежать налога, иначе ${fmt(penalty)}₵.`,
            tone: 'risky',
            cost: { credits: 0, data: lawyersData },
          }),
        ],
        defaultOption: 'pay',
        ctx: { tax, bribe, bribeRisk, fine, lawyersData, lawyersChance, penalty },
      });
    },
  },

  investor: {
    id: 'investor',
    title: 'Венчурный инвестор',
    polarity: 'neutral',
    weight: (s) => (s.credits < 300 ? 9 : 5),
    trigger(s) {
      const sev = severityAt(s.day);
      const grant = Math.round(250 * sev + 0.1 * positive(s.credits));
      setPending(s, {
        eventId: 'investor',
        title: 'Венчурный инвестор',
        description: 'Фонд «Нейрон-Капитал» предлагает вливание в обмен на долю будущей прибыли синдиката.',
        options: [
          option({
            id: 'accept',
            label: 'Принять инвестиции',
            detail: `Получить ${fmt(grant)}₵ сейчас. Добыча кредитов −15% на 40 дней.`,
            tone: 'risky',
            cost: ZERO,
          }),
          option({
            id: 'decline',
            label: 'Отказаться',
            detail: 'Сохранить полный контроль над прибылью.',
            tone: 'neutral',
            cost: ZERO,
          }),
        ],
        defaultOption: 'decline',
        ctx: { grant },
      });
    },
  },

  blackMarket: {
    id: 'blackMarket',
    title: 'Чёрный рынок данных',
    polarity: 'neutral',
    weight: (s) => (s.data >= 60 ? 5 : 0),
    trigger(s) {
      const amount = Math.floor(s.data * 0.6);
      const unit = effectiveDataPrice(s) * 2.2;
      setPending(s, {
        eventId: 'blackMarket',
        title: 'Чёрный рынок данных',
        description: 'Брокер из даркнета готов выкупить крупную партию данных с большой наценкой. Предложение разовое.',
        options: [
          option({
            id: 'sell',
            label: 'Продать партию',
            detail: `До ${fmt(amount)} ед. данных по ${fmt(unit, 2)}₵ (×2.2 к рынку) — около ${fmt(amount * unit)}₵.`,
            tone: 'safe',
            cost: ZERO,
          }),
          option({
            id: 'decline',
            label: 'Отказаться',
            detail: 'Оставить данные для исследований.',
            tone: 'neutral',
            cost: ZERO,
          }),
        ],
        defaultOption: 'decline',
        ctx: { amount, unit },
      });
    },
  },

  rivalRaid: {
    id: 'rivalRaid',
    title: 'Рейд конкурентов',
    polarity: 'bad',
    weight: (s) => (s.day >= 240 && countBuildings(s) > 0 ? 8 : 0),
    trigger(s) {
      const fw = hasResearch(s, 'neuroFirewall');
      const sev = severityAt(s.day);
      const c = positive(s.credits);
      const ransom = Math.round(c * 0.15 + 150 * sev);
      const chance = fw ? 0.7 : 0.5;
      const failLoss = Math.round(c * 0.1);
      setPending(s, {
        eventId: 'rivalRaid',
        title: 'Рейд конкурентов',
        description: 'Синдикат «Кровавый код» требует выкуп и угрожает налётом на серверную.',
        options: [
          option({
            id: 'pay',
            label: 'Заплатить выкуп',
            detail: `Отдать ${fmt(ransom)}₵ — объекты останутся целы.`,
            tone: 'safe',
            cost: { credits: ransom, data: 0 },
          }),
          option({
            id: 'defend',
            label: 'Держать оборону',
            detail: `Шанс ${pct(chance)} отбиться. Провал: лучшее здание теряет уровень (или разрушается) и ${fmt(failLoss)}₵ похищено.`,
            tone: 'danger',
            cost: ZERO,
          }),
        ],
        defaultOption: 'defend',
        ctx: { ransom, chance, failLoss },
      });
    },
  },

  solarFlare: {
    id: 'solarFlare',
    title: 'Солнечная вспышка',
    polarity: 'good',
    weight: () => 8,
    trigger(s) {
      addModifier(s, 'solarFlare', 'Солнечная вспышка', 'energyProd', 0.5, 10);
      instant(s, 'solarFlare', 'Солнечная вспышка', 'Солнечная вспышка! Выработка энергии +50% на 10 дней', 'success');
    },
  },

  geoStorm: {
    id: 'geoStorm',
    title: 'Геомагнитная буря',
    polarity: 'bad',
    weight: (s) => (countBuildings(s, 'solar') > 0 ? 8 : 0),
    trigger(s) {
      const orbital = hasResearch(s, 'orbitalMirrors');
      const value = orbital ? -0.25 : -0.5;
      addModifier(s, 'geoStorm', 'Геомагнитная буря', 'solarOutput', value, 8);
      instant(
        s,
        'geoStorm',
        'Геомагнитная буря',
        `Геомагнитная буря: солнечные панели выдают ${orbital ? '−25%' : '−50%'} энергии 8 дней`,
        'warning',
      );
    },
  },

  dataBoom: {
    id: 'dataBoom',
    title: 'Бум рынка данных',
    polarity: 'good',
    weight: () => 6,
    trigger(s) {
      addModifier(s, 'dataBoom', 'Бум рынка данных', 'dataPrice', 1, 10);
      instant(s, 'dataBoom', 'Бум рынка данных', 'Бум на рынке данных: цена ×2 на 10 дней', 'success');
    },
  },

  dataCrash: {
    id: 'dataCrash',
    title: 'Обвал рынка данных',
    polarity: 'bad',
    weight: () => 6,
    trigger(s) {
      addModifier(s, 'dataCrash', 'Обвал рынка данных', 'dataPrice', -0.5, 10);
      instant(s, 'dataCrash', 'Обвал рынка данных', 'Обвал рынка данных: цена ×0.5 на 10 дней', 'warning');
    },
  },

  cryptoRally: {
    id: 'cryptoRally',
    title: 'Крипторалли',
    polarity: 'good',
    weight: (s) => (countBuildings(s, 'miner') > 0 ? 6 : 0),
    trigger(s) {
      addModifier(s, 'cryptoRally', 'Крипторалли', 'minerOutput', 0.5, 10);
      instant(s, 'cryptoRally', 'Крипторалли', 'Крипторалли: майнинг-фермы приносят +50% кредитов 10 дней', 'success');
    },
  },

  cryptoWinter: {
    id: 'cryptoWinter',
    title: 'Криптозима',
    polarity: 'bad',
    weight: (s) => (countBuildings(s, 'miner') > 0 ? 6 : 0),
    trigger(s) {
      addModifier(s, 'cryptoWinter', 'Криптозима', 'minerOutput', -0.4, 12);
      instant(s, 'cryptoWinter', 'Криптозима', 'Криптозима: доход майнинг-ферм −40% на 12 дней', 'warning');
    },
  },

  heatwave: {
    id: 'heatwave',
    title: 'Аномальная жара',
    polarity: 'bad',
    weight: (s) => (computeEconomy(s).energyUse > 0 ? 7 : 0),
    trigger(s) {
      const nitrogen = hasResearch(s, 'nitrogenCooling');
      const value = nitrogen ? 0.12 : 0.25;
      addModifier(s, 'heatwave', 'Аномальная жара', 'energyUse', value, 8);
      instant(
        s,
        'heatwave',
        'Аномальная жара',
        `Аномальная жара: энергопотребление +${nitrogen ? 12 : 25}% на 8 дней`,
        'warning',
      );
    },
  },

  sabotage: {
    id: 'sabotage',
    title: 'Диверсия на подстанции',
    polarity: 'bad',
    weight: (s) => (s.day >= 90 ? 6 : 0),
    trigger(s) {
      const lost = Math.round(s.energy * 0.7);
      s.energy -= lost;
      addModifier(s, 'sabotage', 'Диверсия на подстанции', 'energyProd', -0.2, 6);
      instant(
        s,
        'sabotage',
        'Диверсия на подстанции',
        `Диверсия на подстанции: потеряно ${fmt(lost)}⚡ из хранилища, выработка −20% на 6 дней`,
        'danger',
      );
    },
  },

  blueprintLeak: {
    id: 'blueprintLeak',
    title: 'Утечка чертежей',
    polarity: 'good',
    weight: () => 5,
    trigger(s) {
      const active = s.research.active;
      const remainingDays = active ? RESEARCH[active].duration - s.research.progress : 0;
      // Если исследованию остался 1 день, ускорять нечего — выдаём данные.
      if (active && remainingDays > 1) {
        const remaining = remainingDays;
        const boost = Math.max(1, Math.ceil(remaining / 2));
        s.research.progress = Math.min(RESEARCH[active].duration, s.research.progress + boost);
        instant(
          s,
          'blueprintLeak',
          'Утечка чертежей',
          `Утечка чертежей: исследование «${RESEARCH[active].name}» ускорено на ${boost} дн.`,
          'success',
        );
        return;
      }
      const sev = severityAt(s.day);
      const amount = Math.round(120 * sev);
      const room = Math.max(0, computeEconomy(s).dataCap - s.data);
      const stored = Math.min(room, amount);
      const surplus = amount - stored;
      const cash = Math.round(surplus * effectiveDataPrice(s));
      s.data += stored;
      s.credits += cash;
      instant(
        s,
        'blueprintLeak',
        'Утечка чертежей',
        cash > 0
          ? `Утечка чертежей: получено ${fmt(stored)} ед. данных, излишек продан за ${fmt(cash)}₵`
          : `Утечка чертежей: получено ${fmt(stored)} ед. данных`,
        'success',
      );
    },
  },

  netGrant: {
    id: 'netGrant',
    title: 'Грант Сети',
    polarity: 'good',
    weight: () => 5,
    trigger(s) {
      const amount = Math.round(150 * severityAt(s.day) + 0.05 * positive(s.credits));
      s.credits += amount;
      instant(s, 'netGrant', 'Грант Сети', `Грант Сети: анонимный меценат перевёл ${fmt(amount)}₵`, 'success');
    },
  },

  inflationSpike: {
    id: 'inflationSpike',
    title: 'Скачок инфляции',
    polarity: 'bad',
    weight: (s) => (s.day >= 150 ? 6 : 0),
    trigger(s) {
      addModifier(s, 'inflationSpike', 'Скачок инфляции', 'upkeep', 0.3, 15);
      instant(s, 'inflationSpike', 'Скачок инфляции', 'Скачок инфляции: содержание объектов +30% на 15 дней', 'warning');
    },
  },
};

export const EVENT_ORDER = Object.keys(EVENTS) as EventId[];

/** Выбирает событие с учётом весов, угрозы и запрета на повтор подряд. */
export function rollEvent(s: GameState, rng: Rng): EventId {
  const threat = threatAt(s.day);
  const weighted = EVENT_ORDER.map((id) => {
    const def = EVENTS[id];
    let weight = def.weight(s);
    if (def.polarity === 'good') weight *= 1.2 - 0.6 * threat;
    if (def.polarity === 'bad') weight *= 0.8 + 0.8 * threat;
    if (id === s.lastEventId) weight = 0;
    return { id, weight: Math.max(0, weight) };
  });
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return 'netGrant';
  let roll = rng.next() * total;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0 && item.weight > 0) return item.id;
  }
  return weighted.filter((item) => item.weight > 0).at(-1)?.id ?? 'netGrant';
}

export function triggerEvent(s: GameState, id: EventId, rng: Rng): void {
  EVENTS[id].trigger(s, rng);
  s.lastEventId = id;
  s.stats.events += 1;
  updateRecords(s);
}

/** Можно ли выбрать вариант решения прямо сейчас. */
export function canChoose(s: GameState, optionId: string): boolean {
  const opt = s.pending?.options.find((o) => o.id === optionId);
  if (!opt) return false;
  return s.credits >= opt.cost.credits && s.data >= opt.cost.data;
}

/** Урон от провала обороны: лучшее здание теряет уровень, а если все на 1-м уровне — одно разрушается. */
function raidDamage(s: GameState, rng: Rng): string {
  const text = applyRaidDamage(s, rng);
  // Хранилища могли уменьшиться — запасы не должны их превышать (как при демонтаже).
  const econ = computeEconomy(s);
  s.energy = Math.min(s.energy, econ.energyCap);
  s.data = Math.min(s.data, econ.dataCap);
  return text;
}

function applyRaidDamage(s: GameState, rng: Rng): string {
  let best = -1;
  s.grid.forEach((cell, index) => {
    if (cell.type && cell.level >= 2 && (best < 0 || cell.level > s.grid[best].level)) best = index;
  });
  if (best >= 0) {
    const cell = s.grid[best];
    cell.level -= 1;
    const def = BUILDINGS[cell.type!];
    return `«${def.name}» [${cellLabel(best)}] ${agree(def, ['понижен', 'понижена', 'понижено'])} до ур. ${cell.level}`;
  }
  const built = s.grid.map((cell, index) => (cell.type ? index : -1)).filter((index) => index >= 0);
  if (built.length === 0) return 'разрушать было нечего';
  const target = rng.pick(built);
  const def = BUILDINGS[s.grid[target].type!];
  s.grid[target] = { uid: 0, type: null, level: 0, enabled: true, invested: 0, builtDay: 0 };
  return `«${def.name}» [${cellLabel(target)}] ${agree(def, ['уничтожен', 'уничтожена', 'уничтожено'])}`;
}

/**
 * Применяет выбранный вариант. `auto` — решение принято по таймауту.
 * Вызывающий код гарантирует, что s.pending не null и вариант допустим.
 */
export function resolveDecision(s: GameState, optionId: string, rng: Rng, auto = false): void {
  const pending = s.pending;
  if (!pending) return;
  const ctx = pending.ctx;
  const opt = pending.options.find((o) => o.id === optionId) ?? pending.options.find((o) => o.id === pending.defaultOption)!;
  let outcome = '';
  let tone: LogTone = 'info';

  if (auto) pushLog(s, `Время на решение истекло: «${pending.title}» → «${opt.label}»`, 'warning', 'event');

  s.credits -= opt.cost.credits;
  s.data -= opt.cost.data;

  switch (pending.eventId) {
    case 'hack': {
      if (opt.id === 'protect') {
        outcome = `Наёмники отразили хакерскую атаку. Оплачено ${fmt(ctx.protect)}₵`;
        tone = 'success';
      } else if (opt.id === 'counter') {
        if (rng.chance(ctx.chance)) {
          s.credits += ctx.gain;
          outcome = `Контратака удалась! Со счетов «Чёрного льда» украдено ${fmt(ctx.gain)}₵`;
          tone = 'success';
        } else {
          s.credits -= ctx.failLoss;
          outcome = `Контратака провалилась. Хакеры взломали сеть! Потеряно ${fmt(ctx.failLoss)} кредитов`;
          tone = 'danger';
        }
      } else {
        const dataLoss = Math.min(s.data, ctx.dataLoss);
        s.credits -= ctx.loss;
        s.data -= dataLoss;
        outcome = `Хакеры взломали сеть! Потеряно ${fmt(ctx.loss)} кредитов${dataLoss > 0 ? ` и ${fmt(dataLoss)} ед. данных` : ''}`;
        tone = 'danger';
      }
      break;
    }
    case 'taxAudit': {
      if (opt.id === 'bribe') {
        if (rng.chance(ctx.bribeRisk)) {
          s.credits -= ctx.fine;
          outcome = `Взятка раскрыта! Штраф ${fmt(ctx.fine)}₵ сверх ${fmt(ctx.bribe)}₵ взятки`;
          tone = 'danger';
        } else {
          outcome = `Инспектор принял ${fmt(ctx.bribe)}₵ и закрыл проверку`;
          tone = 'success';
        }
      } else if (opt.id === 'lawyers') {
        if (rng.chance(ctx.lawyersChance)) {
          outcome = 'Юристы развалили дело: налог не начислен';
          tone = 'success';
        } else {
          s.credits -= ctx.penalty;
          outcome = `Суд проигран: налог с пенями ${fmt(ctx.penalty)}₵`;
          tone = 'danger';
        }
      } else {
        s.credits -= ctx.tax;
        outcome = `Налоговая проверка: уплачено ${fmt(ctx.tax)}₵`;
        tone = 'warning';
      }
      break;
    }
    case 'investor': {
      if (opt.id === 'accept') {
        s.credits += ctx.grant;
        addModifier(s, 'investor', 'Доля инвестора', 'creditOutput', -0.15, 40);
        outcome = `Получено ${fmt(ctx.grant)}₵ от «Нейрон-Капитал». Добыча кредитов −15% на 40 дней`;
        tone = 'event';
      } else {
        outcome = 'Предложение инвестора отклонено';
        tone = 'info';
      }
      break;
    }
    case 'blackMarket': {
      if (opt.id === 'sell') {
        const amount = Math.min(Math.floor(s.data), ctx.amount);
        const value = Math.round(amount * ctx.unit);
        s.data -= amount;
        s.credits += value;
        s.stats.dataSold += amount;
        outcome = `Чёрный рынок: продано ${fmt(amount)} ед. данных за ${fmt(value)}₵`;
        tone = 'success';
      } else {
        outcome = 'Сделка на чёрном рынке отклонена';
        tone = 'info';
      }
      break;
    }
    case 'rivalRaid': {
      if (opt.id === 'pay') {
        outcome = `Выкуп ${fmt(ctx.ransom)}₵ уплачен. «Кровавый код» отступил`;
        tone = 'warning';
      } else if (rng.chance(ctx.chance)) {
        outcome = 'Оборона выдержала! Налётчики «Кровавого кода» отброшены';
        tone = 'success';
      } else {
        const damage = raidDamage(s, rng);
        s.credits -= ctx.failLoss;
        outcome = `Рейд прорвал оборону: ${damage}, похищено ${fmt(ctx.failLoss)}₵`;
        tone = 'danger';
      }
      break;
    }
    default:
      outcome = pending.title;
  }

  pushLog(s, outcome, tone, 'event');
  pushEventRecord(s, pending.eventId, pending.title, outcome, tone);
  s.pending = null;
  // Возвращаем скорость, если игрок сам её не менял (пауза или другая скорость — его выбор).
  if (pending.resumeSpeed > 1 && s.speed === 1) s.speed = pending.resumeSpeed as GameState['speed'];
  updateRecords(s);
}
