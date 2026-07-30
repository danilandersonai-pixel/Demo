#!/usr/bin/env node
// Замер времени полного прогона всех режимов Арены.
//
//   node sim/bench.js
//
// Печатает таблицу; числа фиксируются в AUDIT.md. Все прогоны — с теми же
// параметрами, что и канонические артефакты.

import { simulate } from './simulate.js';
import { runSpatial } from './spatial.js';
import { evolve } from './evolve.js';
import { runSweep } from './sweep.js';
import { STRATEGIES } from '../strategies/index.js';

function bench(label, fn) {
  const t0 = process.hrtime.bigint();
  const out = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${label.padEnd(46)} ${ms.toFixed(0).padStart(7)} мс`);
  return { ms, out };
}

console.log(`Бенчмарк Арены (лига: ${STRATEGIES.length} стратегий)\n`);
let total = 0;
total += bench('Эволюция лиги, 1 сид (30 покол. × 200 раундов)', () =>
  simulate({ seed: 42, generations: 30, rounds: 200, noise: 0.05 })
).ms;
total += bench('Эталонные прогоны, 3 сида', () => {
  for (const s of [7, 42, 2026]) simulate({ seed: s, generations: 30, rounds: 200, noise: 0.05 });
}).ms;
total += bench('Территория 20×20, 1 сид (40 эпох × 200 раундов)', () =>
  runSpatial({ seed: 42, epochs: 40, rounds: 200, noise: 0.05 })
).ms;
total += bench('Генетика (популяция 64, 150 поколений)', () => evolve({ seed: 42 })).ms;
total += bench('Свип 24 условия (шум × длина × матрица)', () => runSweep(42)).ms;
console.log(`\nИтого: ${(total / 1000).toFixed(1)} с`);
