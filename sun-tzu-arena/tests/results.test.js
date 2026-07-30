// Тесты уровня прогона: детерминизм симуляции, байт-в-байт воспроизводимость
// эталонных results/<seed>.json и валидация структуры ARENA_DATA в viz/replay.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { simulate, serializeResult } from '../sim/simulate.js';
import { STRATEGIES } from '../strategies/index.js';
import alwaysCooperate from '../strategies/always-cooperate.js';
import alwaysDefect from '../strategies/always-defect.js';

const resultPath = (name) => fileURLToPath(new URL(`../results/${name}`, import.meta.url));
const REPLAY_PATH = fileURLToPath(new URL('../viz/replay.js', import.meta.url));
const CANONICAL_SEEDS = [7, 42, 2026];

test('детерминизм: два прогона с одним сидом идентичны байт-в-байт', () => {
  const a = serializeResult(simulate({ seed: 5, generations: 5, rounds: 50 }));
  const b = serializeResult(simulate({ seed: 5, generations: 5, rounds: 50 }));
  assert.equal(a, b);
});

test('разные сиды дают разные результаты', () => {
  const a = serializeResult(simulate({ seed: 1, generations: 3, rounds: 50 }));
  const b = serializeResult(simulate({ seed: 2, generations: 3, rounds: 50 }));
  assert.notEqual(a, b);
});

test('сумма долей равна 1 (с точностью округления) в каждом поколении', () => {
  const result = simulate({ seed: 9, generations: 8, rounds: 40 });
  for (const gen of result.generations) {
    const sumBefore = gen.sharesBefore.reduce((x, y) => x + y, 0);
    const sumAfter = gen.sharesAfter.reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(sumBefore - 1) < 1e-4, `поколение ${gen.gen}: до ${sumBefore}`);
    assert.ok(Math.abs(sumAfter - 1) < 1e-4, `поколение ${gen.gen}: после ${sumAfter}`);
  }
});

test('вымирание в полном прогоне: вымершая доля остаётся нулевой до конца', () => {
  const result = simulate({ seed: 3, generations: 20, rounds: 60 });
  const everExtinct = new Set();
  for (const gen of result.generations) {
    for (const i of gen.extinct) everExtinct.add(i);
    for (const i of everExtinct) {
      assert.equal(gen.sharesAfter[i] <= 0, true, `поколение ${gen.gen}: стратегия ${i} воскресла`);
    }
  }
  assert.ok(everExtinct.size > 0, 'за 20 поколений хоть кто-то должен вымереть');
});

test('дуэль Агрессор против Пацифиста заканчивается полным истреблением', () => {
  const result = simulate({
    seed: 1,
    generations: 30,
    rounds: 50,
    noise: 0,
    strategies: [alwaysCooperate, alwaysDefect],
  });
  assert.equal(result.outcome.condition, 'extermination');
  assert.equal(result.outcome.winnerId, 'always-defect');
  assert.equal(result.outcome.aliveAtEnd, 1);
  assert.ok(result.outcome.conditionGen >= 1);
});

for (const seed of CANONICAL_SEEDS) {
  test(`эталонный прогон seed ${seed} воспроизводим байт-в-байт`, () => {
    const onDisk = fs.readFileSync(resultPath(`${seed}.json`), 'utf8');
    const fresh = serializeResult(simulate({ seed, generations: 30, rounds: 200, noise: 0.05 }));
    assert.equal(fresh, onDisk);
  });
}

test('эталонные прогоны 7/42/2026 попарно различаются', () => {
  const texts = CANONICAL_SEEDS.map((s) => fs.readFileSync(resultPath(`${s}.json`), 'utf8'));
  assert.notEqual(texts[0], texts[1]);
  assert.notEqual(texts[1], texts[2]);
  assert.notEqual(texts[0], texts[2]);
});

// ── Валидация ARENA_DATA (структура, на которую опирается viz/arena.html) ──

function loadArenaData() {
  const src = fs.readFileSync(REPLAY_PATH, 'utf8');
  const marker = 'window.ARENA_DATA = ';
  const at = src.indexOf(marker);
  assert.ok(at >= 0, 'replay.js должен присваивать window.ARENA_DATA');
  const json = src.slice(at + marker.length).trim().replace(/;$/, '');
  return JSON.parse(json);
}

function validateRun(run, label) {
  const n = run.strategies.length;
  assert.ok(n >= 10, `${label}: минимум 10 стратегий`);
  for (const s of run.strategies) {
    for (const field of ['id', 'name', 'epithet', 'color']) {
      assert.equal(typeof s[field], 'string', `${label}: strategies[].${field}`);
    }
    assert.equal(typeof s.dossier, 'object', `${label}: dossier`);
    for (const field of ['quote', 'principle', 'targets']) {
      assert.equal(typeof s.dossier[field], 'string', `${label}: dossier.${field}`);
    }
    assert.ok(Array.isArray(s.dossier.strengths), `${label}: dossier.strengths`);
    assert.ok(Array.isArray(s.dossier.weaknesses), `${label}: dossier.weaknesses`);
  }
  for (const field of ['seed', 'generations', 'rounds', 'noise']) {
    assert.equal(typeof run.meta[field], 'number', `${label}: meta.${field}`);
  }
  assert.equal(run.generations.length, run.meta.generations, `${label}: число поколений`);
  for (const gen of run.generations) {
    assert.equal(typeof gen.gen, 'number', `${label}: gen`);
    for (const field of ['sharesBefore', 'sharesAfter', 'fitness', 'extinct', 'matches']) {
      assert.ok(Array.isArray(gen[field]), `${label} g${gen.gen}: ${field} — массив`);
    }
    assert.equal(gen.sharesBefore.length, n, `${label} g${gen.gen}: длина sharesBefore`);
    assert.equal(gen.sharesAfter.length, n, `${label} g${gen.gen}: длина sharesAfter`);
    assert.equal(gen.fitness.length, n, `${label} g${gen.gen}: длина fitness`);
    assert.equal(typeof gen.meanFitness, 'number', `${label} g${gen.gen}: meanFitness`);
    for (const m of gen.matches) {
      assert.ok(Number.isInteger(m.a) && m.a >= 0 && m.a < n, `${label} g${gen.gen}: match.a`);
      assert.ok(Number.isInteger(m.b) && m.b >= 0 && m.b < n, `${label} g${gen.gen}: match.b`);
      for (const field of ['sa', 'sb', 'ca', 'cb']) {
        assert.equal(typeof m[field], 'number', `${label} g${gen.gen}: match.${field}`);
      }
      assert.ok(m.sa >= 0 && m.sa <= 5 && m.sb >= 0 && m.sb <= 5, `${label}: счёт за раунд в [0,5]`);
      assert.ok(m.ca >= 0 && m.ca <= 1 && m.cb >= 0 && m.cb <= 1, `${label}: частота кооперации в [0,1]`);
    }
  }
  assert.ok(Array.isArray(run.finalShares) && run.finalShares.length === n, `${label}: finalShares`);
  const { outcome } = run;
  assert.ok(Number.isInteger(outcome.winner) && outcome.winner >= 0 && outcome.winner < n, `${label}: outcome.winner`);
  assert.equal(run.strategies[outcome.winner].id, outcome.winnerId, `${label}: winnerId соответствует индексу`);
  assert.ok(['domination', 'extermination', 'plurality'].includes(outcome.condition), `${label}: condition`);
  assert.equal(typeof outcome.winnerShare, 'number', `${label}: winnerShare`);
  assert.equal(typeof outcome.aliveAtEnd, 'number', `${label}: aliveAtEnd`);
}

test('ARENA_DATA: присутствуют все три эталонных сида', () => {
  const data = loadArenaData();
  assert.equal(data.version, 1);
  assert.deepEqual(data.seeds, CANONICAL_SEEDS);
  for (const seed of CANONICAL_SEEDS) {
    assert.ok(data.runs[seed], `нет прогона для сида ${seed}`);
  }
});

test('ARENA_DATA: структура каждого прогона полна и корректна', () => {
  const data = loadArenaData();
  for (const seed of data.seeds) {
    validateRun(data.runs[seed], `seed ${seed}`);
  }
});

test('ARENA_DATA: реестр стратегий реплея совпадает с текущим кодом', () => {
  const data = loadArenaData();
  for (const seed of data.seeds) {
    const ids = data.runs[seed].strategies.map((s) => s.id);
    assert.deepEqual(ids, STRATEGIES.map((s) => s.id), `seed ${seed}`);
  }
});
