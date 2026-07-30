// Тесты пространственного режима: тор, правило захвата, детерминизм,
// воспроизводимость файла и spatial-секция ARENA_DATA.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { neighborsOf, adoptStep, runSpatial, GRID } from '../sim/spatial.js';
import { STRATEGIES } from '../strategies/index.js';

const REPLAY_PATH = fileURLToPath(new URL('../viz/replay.js', import.meta.url));
const spatialPath = (seed) => fileURLToPath(new URL(`../results/spatial-${seed}.json`, import.meta.url));

test('тор 20×20: соседи угловой клетки заворачиваются', () => {
  // клетка (0,0): север — (0,19), восток — (1,0), юг — (0,1), запад — (19,0)
  assert.deepEqual(neighborsOf(0, 20), [380, 1, 20, 19]);
  // каждая клетка имеет ровно 4 соседа, все в пределах поля
  for (const i of [0, 19, 200, 399]) {
    const ns = neighborsOf(i, GRID);
    assert.equal(ns.length, 4);
    for (const n of ns) assert.ok(n >= 0 && n < GRID * GRID && n !== i);
  }
});

test('захват: клетка перенимает стратегию лучшего соседа, при равенстве остаётся своей', () => {
  // Тор 2×2: диагональная клетка НЕ сосед, поэтому клетка 3 не видит клетку 0.
  const next = adoptStep([0, 1, 1, 1], [5, 0, 0, 0], 2);
  assert.deepEqual(next, [0, 0, 0, 1]);
  // Равные счета — никто не меняет веру.
  const same = adoptStep([0, 1, 1, 0], [2, 2, 2, 2], 2);
  assert.deepEqual(same, [0, 1, 1, 0]);
});

test('захват: при равных лучших соседях приоритет — север, восток, юг, запад', () => {
  // Тор 3×3, центральная клетка 4: соседи N=1, E=5, S=7, W=3.
  const grid = [9, 1, 9, 3, 0, 2, 9, 4, 9];
  const scores = [0, 5, 0, 5, 0, 5, 0, 5, 0]; // все четыре соседа равно лучше
  const next = adoptStep(grid, scores, 3);
  assert.equal(next[4], 1, 'центр перенимает веру северного соседа');
});

test('пространственный прогон детерминирован и различается между сидами', () => {
  const opts = { epochs: 3, rounds: 20, noise: 0.05, size: 6 };
  const a = runSpatial({ seed: 5, ...opts });
  const b = runSpatial({ seed: 5, ...opts });
  const c = runSpatial({ seed: 6, ...opts });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.grids, c.grids);
});

test('счётчики территорий согласованы с сеткой на каждой эпохе', () => {
  const r = runSpatial({ seed: 9, epochs: 4, rounds: 20, noise: 0.05, size: 8 });
  assert.equal(r.grids.length, 5); // старт + 4 эпохи
  for (let e = 0; e < r.grids.length; e++) {
    assert.equal(r.grids[e].length, 64);
    const sum = r.counts[e].reduce((x, y) => x + y, 0);
    assert.equal(sum, 64, `эпоха ${e}`);
    for (const v of r.grids[e]) assert.ok(v >= 0 && v < STRATEGIES.length);
  }
});

test('эталонный пространственный прогон seed 42 воспроизводим байт-в-байт', () => {
  const onDisk = fs.readFileSync(spatialPath(42), 'utf8');
  const fresh = JSON.stringify(runSpatial({ seed: 42, epochs: 40, rounds: 200, noise: 0.05 })) + '\n';
  assert.equal(fresh, onDisk);
});

test('ARENA_DATA.spatial: сетки всех сидов полны и корректны', () => {
  const src = fs.readFileSync(REPLAY_PATH, 'utf8');
  const marker = 'window.ARENA_DATA = ';
  const data = JSON.parse(src.slice(src.indexOf(marker) + marker.length).trim().replace(/;$/, ''));
  assert.ok(data.spatial, 'нет секции spatial');
  for (const seed of data.seeds) {
    const sp = data.spatial[seed];
    assert.ok(sp, `нет территории для сида ${seed}`);
    assert.equal(sp.meta.size, GRID);
    assert.equal(sp.grids.length, sp.meta.epochs + 1, `сид ${seed}: число сеток`);
    assert.equal(sp.counts.length, sp.meta.epochs + 1, `сид ${seed}: число счётчиков`);
    assert.deepEqual(sp.strategies, STRATEGIES.map((s) => s.id), `сид ${seed}: реестр`);
    const cells = sp.meta.size * sp.meta.size;
    for (const g of sp.grids) {
      assert.equal(g.length, cells);
      for (const v of g) assert.ok(Number.isInteger(v) && v >= 0 && v < sp.strategies.length);
    }
  }
});
