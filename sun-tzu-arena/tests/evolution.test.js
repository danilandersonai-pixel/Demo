// Тесты репликаторной динамики: рост выше среднего, сумма долей, вымирание.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replicatorStep } from '../sim/evolution.js';
import { mulberry32 } from '../engine/rng.js';

test('репликатор: точная арифметика на матрице Пацифист/Агрессор', () => {
  // M[i][j] — средний счёт i против j: C/C=3, C/D=0, D/C=5, D/D=1.
  const M = [
    [3, 0],
    [5, 1],
  ];
  const { next, fitness, mean } = replicatorStep([0.5, 0.5], M);
  assert.equal(fitness[0], 1.5);
  assert.equal(fitness[1], 3);
  assert.equal(mean, 2.25);
  assert.ok(Math.abs(next[0] - 1 / 3) < 1e-12);
  assert.ok(Math.abs(next[1] - 2 / 3) < 1e-12);
});

test('репликатор: доля растёт тогда и только тогда, когда фитнес выше среднего', () => {
  const M = [
    [3, 2, 1],
    [4, 1, 2],
    [2, 3, 3],
  ];
  const shares = [0.2, 0.3, 0.5];
  const { next, fitness, mean } = replicatorStep(shares, M);
  for (let i = 0; i < 3; i++) {
    if (fitness[i] > mean) assert.ok(next[i] > shares[i], `стратегия ${i} должна расти`);
    if (fitness[i] < mean) assert.ok(next[i] < shares[i], `стратегия ${i} должна падать`);
  }
});

test('репликатор: сумма долей равна 1 на протяжении 50 шагов', () => {
  const rng = mulberry32(99);
  const n = 6;
  const M = Array.from({ length: n }, () => Array.from({ length: n }, () => rng() * 5));
  let shares = new Array(n).fill(1 / n);
  for (let step = 0; step < 50; step++) {
    shares = replicatorStep(shares, M).next;
    const sum = shares.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `шаг ${step}: сумма ${sum}`);
  }
});

test('вымирание: доля ниже 0.5% обнуляется, остальное нормируется к 1', () => {
  const M = [
    [1, 1],
    [1, 1],
  ];
  const { next, extinct } = replicatorStep([0.996, 0.004], M);
  assert.deepEqual(extinct, [1]);
  assert.equal(next[1], 0);
  assert.equal(next[0], 1);
});

test('вымершие не воскресают: доля 0 остаётся 0, фитнес — null', () => {
  const M = [
    [3, 2, 0],
    [2, 3, 0],
    [0, 0, 0],
  ];
  const { next, fitness } = replicatorStep([0.6, 0.4, 0], M);
  assert.equal(next[2], 0);
  assert.equal(fitness[2], null);
  assert.ok(Math.abs(next[0] + next[1] - 1) < 1e-12);
});
