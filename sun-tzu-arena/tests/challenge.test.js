// Тесты чемпионата претендентов и защитных механизмов CLI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { simulate, serializeResult } from '../sim/simulate.js';
import { resultFileName } from '../sim/run.js';
import { spatialFileName } from '../sim/spatial.js';

const resultPath = (name) => fileURLToPath(new URL(`../results/${name}`, import.meta.url));

test('контрольный прогон seed 42 без шума воспроизводим байт-в-байт', () => {
  const onDisk = fs.readFileSync(resultPath('42-noise0.json'), 'utf8');
  const fresh = serializeResult(simulate({ seed: 42, generations: 30, rounds: 200, noise: 0 }));
  assert.equal(fresh, onDisk);
});

test('results/challenge.json: структура турнира претендентов корректна', () => {
  const c = JSON.parse(fs.readFileSync(resultPath('challenge.json'), 'utf8'));
  const n = c.participants.length;
  assert.ok(n >= 2, 'минимум чемпион и один претендент');
  assert.equal(c.participants[0].id, c.champion, 'чемпион идёт первым');
  const ids = new Set(c.participants.map((p) => p.id));
  assert.equal(ids.size, n, 'id участников уникальны');
  assert.equal(c.roundRobin.length, n);
  for (const row of c.roundRobin) {
    assert.equal(row.length, n);
    for (const v of row) assert.ok(v >= 0 && v <= 5, 'счёт за раунд в [0,5]');
  }
  assert.equal(c.evolution.finalShares.length, n);
  const sum = c.evolution.finalShares.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-4, `сумма финальных долей ${sum}`);
  assert.ok(Number.isInteger(c.evolution.outcome.winner) && c.evolution.outcome.winner < n);
});

test('имена файлов: нестандартные параметры не затирают эталонные результаты', () => {
  const defaults = { noise: 0.05, generations: 30, rounds: 200 };
  assert.equal(resultFileName(42, defaults), '42.json');
  assert.equal(resultFileName(42, { ...defaults, noise: 0 }), '42-noise0.json');
  assert.equal(resultFileName(42, { ...defaults, generations: 3 }), '42-gen3.json');
  assert.equal(resultFileName(42, { ...defaults, rounds: 50 }), '42-rounds50.json');
  const spDefaults = { noise: 0.05, epochs: 40, rounds: 200 };
  assert.equal(spatialFileName(42, spDefaults), 'spatial-42.json');
  assert.equal(spatialFileName(42, { ...spDefaults, epochs: 5 }), 'spatial-42-epochs5.json');
  assert.equal(spatialFileName(42, { ...spDefaults, noise: 0 }), 'spatial-42-noise0.json');
});
