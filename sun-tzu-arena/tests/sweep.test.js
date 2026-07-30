// Тесты стенда устойчивости: альтернативная матрица, агрегация, детерминизм.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NOISES, ROUNDS, MATRICES } from '../sim/sweep.js';
import { simulate } from '../sim/simulate.js';
import { payoff, C, D } from '../engine/game.js';
import { STRATEGIES } from '../strategies/index.js';

const SWEEP_PATH = fileURLToPath(new URL('../results/sweep-42.json', import.meta.url));

test('движок принимает произвольную матрицу выплат', () => {
  const gold = MATRICES.goldrush;
  assert.equal(payoff(D, C, gold), 8);
  assert.equal(payoff(C, C, gold), 5);
  assert.equal(payoff(D, D, gold), 1);
  assert.equal(payoff(C, D, gold), 0);
  // дефолтная матрица не изменилась
  assert.equal(payoff(D, C), 5);
});

test('обе матрицы свипа — корректные дилеммы заключённого', () => {
  for (const [name, m] of Object.entries(MATRICES)) {
    assert.ok(m.T > m.R && m.R > m.P && m.P > m.S, `${name}: T>R>P>S`);
    assert.ok(2 * m.R > m.T + m.S, `${name}: 2R > T+S (мир выгоднее размена ударами)`);
  }
});

test('свип на диске: 24 условия, полная сетка осей, корректная агрегация', () => {
  const sweep = JSON.parse(fs.readFileSync(SWEEP_PATH, 'utf8'));
  assert.equal(sweep.conditions.length, NOISES.length * ROUNDS.length * Object.keys(MATRICES).length);
  assert.deepEqual(sweep.strategies, STRATEGIES.map((s) => s.id));
  const seen = new Set();
  for (const c of sweep.conditions) {
    seen.add(`${c.matrix}|${c.noise}|${c.rounds}`);
    assert.ok(NOISES.includes(c.noise) && ROUNDS.includes(c.rounds) && MATRICES[c.matrix]);
    assert.equal(c.finalShares.length, STRATEGIES.length);
    const sum = c.finalShares.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-4, `${c.matrix}/${c.noise}/${c.rounds}: сумма долей ${sum}`);
    // победитель условия действительно держит максимальную долю
    const max = Math.max(...c.finalShares);
    const winnerIdx = sweep.strategies.indexOf(c.winnerId);
    assert.ok(winnerIdx >= 0);
    assert.equal(c.finalShares[winnerIdx], max, `${c.matrix}/${c.noise}/${c.rounds}: winnerId`);
  }
  assert.equal(seen.size, 24, 'условия не дублируются');
});

test('условие свипа воспроизводимо: пересчёт совпадает с сохранённым', () => {
  const sweep = JSON.parse(fs.readFileSync(SWEEP_PATH, 'utf8'));
  const cond = sweep.conditions.find((c) => c.matrix === 'goldrush' && c.noise === 0 && c.rounds === 50);
  assert.ok(cond, 'нет условия goldrush/0/50');
  const res = simulate({
    seed: sweep.meta.seed,
    generations: sweep.meta.generations,
    rounds: 50,
    noise: 0,
    payoffs: MATRICES.goldrush,
  });
  const round6 = (x) => Math.round(x * 1e6) / 1e6;
  assert.deepEqual(res.finalShares.map(round6), cond.finalShares);
  assert.equal(res.outcome.winnerId, cond.winnerId);
});
