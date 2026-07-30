// Реестр стратегий основной лиги.
//
// ВНИМАНИЕ: порядок в массиве — часть формата данных. Матчи в results/*.json
// и replay.js ссылаются на стратегии по индексу, поэтому перестановка или
// вставка в середину требует пересчёта всех результатов.

import alwaysCooperate from './always-cooperate.js';
import alwaysDefect from './always-defect.js';
import random from './random.js';
import titForTat from './tit-for-tat.js';
import grimTrigger from './grim-trigger.js';
import pavlov from './pavlov.js';
import scout from './scout.js';
import diplomat from './diplomat.js';
import feint from './feint.js';
import patience from './patience.js';
// Лига 2.0: выжившие круга 2 чемпионата претендентов (все четверо, порядок —
// по id) и «Безымянный», выведенный генетическим отбором (sim/evolve.js).
import chAlliance from './challengers/ch-alliance.js';
import chFire from './challengers/ch-fire.js';
import chVoid from './challengers/ch-void.js';
import chWater from './challengers/ch-water.js';
import nameless from './evolved/nameless.js';

export const STRATEGIES = [
  alwaysCooperate,
  alwaysDefect,
  random,
  titForTat,
  grimTrigger,
  pavlov,
  scout,
  diplomat,
  feint,
  patience,
  chAlliance,
  chFire,
  chVoid,
  chWater,
  nameless,
];

const ids = new Set(STRATEGIES.map((s) => s.id));
if (ids.size !== STRATEGIES.length) {
  throw new Error('Дубликаты id в реестре стратегий');
}
