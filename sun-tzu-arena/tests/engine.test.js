// Тесты движка: матрица выплат, шум, детерминизм, изоляция стратегий.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payoff, playMatch, PAYOFFS, C, D } from '../engine/game.js';
import { mulberry32, combineSeed } from '../engine/rng.js';
import alwaysCooperate from '../strategies/always-cooperate.js';
import alwaysDefect from '../strategies/always-defect.js';
import titForTat from '../strategies/tit-for-tat.js';

test('матрица выплат: взаимная кооперация даёт R=3 обоим', () => {
  assert.equal(payoff(C, C), 3);
  assert.equal(PAYOFFS.R, 3);
});

test('матрица выплат: взаимное предательство даёт P=1 обоим', () => {
  assert.equal(payoff(D, D), 1);
  assert.equal(PAYOFFS.P, 1);
});

test('матрица выплат: предатель против доверчивого получает T=5, жертва S=0', () => {
  assert.equal(payoff(D, C), 5);
  assert.equal(payoff(C, D), 0);
  assert.equal(PAYOFFS.T, 5);
  assert.equal(PAYOFFS.S, 0);
});

test('матч без шума: Пацифист против Агрессора — 0.0 против 5.0 за раунд', () => {
  const res = playMatch(alwaysCooperate, alwaysDefect, { rounds: 200, noise: 0, seed: 1 });
  assert.equal(res.avgA, 0);
  assert.equal(res.avgB, 5);
  assert.equal(res.scoreA, 0);
  assert.equal(res.scoreB, 1000);
  assert.ok(res.movesA.every((m) => m === C));
  assert.ok(res.movesB.every((m) => m === D));
});

test('матч длится 200 раундов по умолчанию', () => {
  const res = playMatch(alwaysCooperate, alwaysCooperate, { noise: 0, seed: 1 });
  assert.equal(res.rounds, 200);
  assert.equal(res.movesA.length, 200);
  assert.equal(res.movesB.length, 200);
});

test('без шума ходы не искажаются', () => {
  const res = playMatch(alwaysCooperate, alwaysCooperate, { rounds: 500, noise: 0, seed: 7 });
  assert.equal(res.coopA, 1);
  assert.equal(res.coopB, 1);
});

test('частота шума 5% в статистическом допуске (два Пацифиста: каждое D — искажение)', () => {
  let flipped = 0;
  let total = 0;
  for (let s = 0; s < 100; s++) {
    const res = playMatch(alwaysCooperate, alwaysCooperate, { rounds: 200, noise: 0.05, seed: s });
    for (const m of res.movesA) if (m === D) flipped++;
    for (const m of res.movesB) if (m === D) flipped++;
    total += 400;
  }
  const rate = flipped / total;
  assert.ok(rate > 0.04 && rate < 0.06, `частота искажений ${rate} вне [0.04, 0.06]`);
});

test('детерминизм матча: один сид — идентичные ходы и счёт', () => {
  const a = playMatch(titForTat, alwaysDefect, { rounds: 200, noise: 0.05, seed: 123 });
  const b = playMatch(titForTat, alwaysDefect, { rounds: 200, noise: 0.05, seed: 123 });
  assert.deepEqual(a.movesA, b.movesA);
  assert.deepEqual(a.movesB, b.movesB);
  assert.equal(a.scoreA, b.scoreA);
  assert.equal(a.scoreB, b.scoreB);
});

test('разные сиды матча дают разные последовательности шума', () => {
  const a = playMatch(alwaysCooperate, alwaysCooperate, { rounds: 200, noise: 0.05, seed: 1 });
  const b = playMatch(alwaysCooperate, alwaysCooperate, { rounds: 200, noise: 0.05, seed: 2 });
  assert.notDeepEqual(a.movesA, b.movesA);
});

test('изоляция: мутация переданных историй не влияет на движок', () => {
  const vandal = {
    id: 'vandal',
    create() {
      return {
        move(mine, theirs) {
          // Пытаемся испортить историю, которую нам передали.
          mine.push(D, D, D);
          theirs.length = 0;
          return C;
        },
      };
    },
  };
  const res = playMatch(vandal, titForTat, { rounds: 50, noise: 0, seed: 1 });
  // Вандал всегда играет C; Зеркало должно видеть настоящую историю и кооперировать.
  assert.equal(res.movesA.length, 50);
  assert.ok(res.movesA.every((m) => m === C));
  assert.ok(res.movesB.every((m) => m === C));
  assert.equal(res.avgA, 3);
});

test('недопустимый ход стратегии — ошибка движка, а не молчаливая подмена', () => {
  const broken = {
    id: 'broken',
    create() {
      return { move: () => 'X' };
    },
  };
  assert.throws(
    () => playMatch(broken, titForTat, { rounds: 5, noise: 0, seed: 1 }),
    /недопустимый ход/
  );
});

test('mulberry32: один сид — одна последовательность, значения в [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const c = mulberry32(43);
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  const seqC = Array.from({ length: 10 }, () => c());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});

test('combineSeed: некоммутативен и детерминирован', () => {
  assert.equal(combineSeed(1, 2), combineSeed(1, 2));
  assert.notEqual(combineSeed(1, 2), combineSeed(2, 1));
});
