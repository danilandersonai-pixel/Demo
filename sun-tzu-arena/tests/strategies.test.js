// Поведенческие тесты всех десяти стратегий основной лиги (минимум по одному).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playMatch, C, D } from '../engine/game.js';
import { mulberry32 } from '../engine/rng.js';
import { constRng } from './helpers.js';
import alwaysCooperate from '../strategies/always-cooperate.js';
import alwaysDefect from '../strategies/always-defect.js';
import random from '../strategies/random.js';
import titForTat from '../strategies/tit-for-tat.js';
import grimTrigger from '../strategies/grim-trigger.js';
import pavlov from '../strategies/pavlov.js';
import scout from '../strategies/scout.js';
import diplomat from '../strategies/diplomat.js';
import feint from '../strategies/feint.js';
import patience from '../strategies/patience.js';
import { STRATEGIES } from '../strategies/index.js';

test('реестр: минимум 10 стратегий, у каждой id, имя, цвет, досье и create()', () => {
  assert.ok(STRATEGIES.length >= 10);
  for (const s of STRATEGIES) {
    assert.ok(s.id && s.name && s.color && s.epithet, s.id);
    assert.ok(s.dossier && s.dossier.quote && s.dossier.principle, s.id);
    assert.ok(Array.isArray(s.dossier.strengths) && s.dossier.strengths.length > 0, s.id);
    assert.ok(Array.isArray(s.dossier.weaknesses) && s.dossier.weaknesses.length > 0, s.id);
    assert.ok(s.dossier.targets, s.id);
    assert.equal(typeof s.create, 'function', s.id);
  }
});

test('Пацифист кооперирует всегда', () => {
  const p = alwaysCooperate.create(constRng(0.5));
  assert.equal(p.move([], []), C);
  assert.equal(p.move([C, C], [D, D]), C);
});

test('Агрессор предаёт всегда', () => {
  const p = alwaysDefect.create(constRng(0.5));
  assert.equal(p.move([], []), D);
  assert.equal(p.move([D, D], [C, C]), D);
});

test('Хаос детерминирован при заданном ГПСЧ и держит ~50/50', () => {
  const p1 = random.create(mulberry32(5));
  const p2 = random.create(mulberry32(5));
  const seq1 = Array.from({ length: 50 }, () => p1.move([], []));
  const seq2 = Array.from({ length: 50 }, () => p2.move([], []));
  assert.deepEqual(seq1, seq2);
  const p3 = random.create(mulberry32(6));
  let coop = 0;
  const total = 2000;
  for (let i = 0; i < total; i++) if (p3.move([], []) === C) coop++;
  assert.ok(coop / total > 0.45 && coop / total < 0.55, `доля C: ${coop / total}`);
});

test('Зеркало: первый ход C, дальше повторяет последний ход оппонента', () => {
  const p = titForTat.create();
  assert.equal(p.move([], []), C);
  assert.equal(p.move([C], [D]), D);
  assert.equal(p.move([C, D], [D, C]), C);
  assert.equal(p.move([C, D, C], [D, C, D]), D);
});

test('Мститель не прощает: после первого D воюет вечно, даже если оппонент вернулся к C', () => {
  const p = grimTrigger.create();
  assert.equal(p.move([], []), C);
  assert.equal(p.move([C], [C]), C);
  assert.equal(p.move([C, C], [C, D]), D); // спровоцирован
  assert.equal(p.move([C, C, D], [C, D, C]), D); // оппонент кается — поздно
  assert.equal(p.move([C, C, D, D], [C, D, C, C]), D);
});

test('Прагматик: win-stay / lose-shift по всем четырём исходам', () => {
  const p = pavlov.create();
  assert.equal(p.move([], []), C); // старт
  assert.equal(p.move([C], [C]), C); // R — победа, повторяю C
  assert.equal(p.move([C], [D]), D); // S — поражение, меняю на D
  assert.equal(p.move([D], [C]), D); // T — победа, повторяю D
  assert.equal(p.move([D], [D]), C); // P — поражение, меняю на C
});

test('Лазутчик: разведфаза — Зеркало с пробными ударами в раундах 5 и 8', () => {
  const p = scout.create();
  assert.equal(p.move([], []), C);
  assert.equal(p.move([C], [C]), C);
  const five = [C, C, C, C, C];
  assert.equal(p.move(five, five), D); // проба (раунд 5)
  const eight = [C, C, C, C, C, D, C, C];
  assert.equal(p.move(eight, [C, C, C, C, C, C, D, C]), D); // проба (раунд 8)
});

test('Лазутчик эксплуатирует безответного и хранит мир с ответчиком', () => {
  const mine = [C, C, C, C, C, D, C, C, D, C, C, C];
  // Оппонент-«пацифист»: кооперировал всегда, на пробы не ответил.
  const naive = new Array(12).fill(C);
  assert.equal(scout.create().move(mine, naive), D);
  // Оппонент-«зеркало»: наказал обе пробы (D в раундах 6 и 9).
  const mirror = [C, C, C, C, C, C, D, C, C, D, C, C];
  assert.equal(scout.create().move(mine, mirror), C);
});

test('Дипломат: наказывает ровно одним ударом и сразу предлагает мир', () => {
  const p = diplomat.create(constRng(0.99)); // великодушие отключено
  assert.equal(p.move([], []), C);
  assert.equal(p.move([C], [C]), C);
  assert.equal(p.move([C, C], [C, D]), D); // единственный ответный удар
  assert.equal(p.move([C, C, D], [C, D, D]), C); // оливковая ветвь, несмотря на их D
});

test('Дипломат великодушен: при щедром ГПСЧ прощает чужое D без удара', () => {
  const p = diplomat.create(constRng(0.0)); // всегда прощает
  assert.equal(p.move([], []), C);
  assert.equal(p.move([C], [D]), C);
});

test('Дипломат-контрит: свой искажённый шумом ход искупает кооперацией и сносит возмездие', () => {
  const p = diplomat.create(constRng(0.99));
  assert.equal(p.move([], []), C); // задумал C…
  // …но шум превратил его в D (в истории — фактический ход D).
  assert.equal(p.move([D], [C]), C); // стыдно: кооперирую
  assert.equal(p.move([D, C], [C, D]), C); // их возмездие сношу молча, не караю
});

test('Притворщик против Пацифиста: маска 15 раундов, проба, затем эксплуатация', () => {
  const res = playMatch(feint, alwaysCooperate, { rounds: 60, noise: 0, seed: 1 });
  for (let r = 0; r < 15; r++) assert.equal(res.movesA[r], C, `раунд ${r} — маска`);
  assert.equal(res.movesA[15], D, 'раунд 15 — проба');
  for (let r = 16; r < 19; r++) assert.equal(res.movesA[r], C, `раунд ${r} — наблюдение`);
  for (let r = 19; r < 60; r++) assert.equal(res.movesA[r], D, `раунд ${r} — эксплуатация`);
});

test('Притворщик против Зеркала: после возмездия играет честно и мир восстанавливается', () => {
  const res = playMatch(feint, titForTat, { rounds: 60, noise: 0, seed: 1 });
  assert.equal(res.movesB[16], D, 'Зеркало наказало пробу');
  for (let r = 20; r < 60; r++) {
    assert.equal(res.movesA[r], C, `раунд ${r}: Притворщик-гражданин`);
    assert.equal(res.movesB[r], C, `раунд ${r}: Зеркало в мире`);
  }
});

test('Полководец: фаза разведки (до 40) — чистое Зеркало', () => {
  const p = patience.create();
  assert.equal(p.move([], []), C);
  const mine10 = new Array(10).fill(C);
  const theirs10 = [...new Array(9).fill(C), D];
  assert.equal(p.move(mine10, theirs10), D); // зеркалит удар
});

test('Полководец: в кампании (40–139) прощает одиночные D, карает серии', () => {
  const single = patience.create();
  const mine = new Array(50).fill(C);
  const isolated = [...new Array(49).fill(C), D];
  assert.equal(single.move(mine, isolated), C, 'одиночный сбой прощён');
  const streaky = patience.create();
  const series = [...new Array(48).fill(C), D, D];
  assert.equal(streaky.move(mine, series), D, 'серия из двух D наказана');
});

test('Полководец: в осаде (140+) отвечает на любое D двумя ударами', () => {
  const p = patience.create();
  const mine = new Array(150).fill(C);
  const theirs = [...new Array(149).fill(C), D];
  assert.equal(p.move(mine, theirs), D, 'первый удар возмездия');
  const mine2 = [...mine, D];
  const theirs2 = [...theirs, C];
  assert.equal(p.move(mine2, theirs2), D, 'второй удар возмездия');
  const mine3 = [...mine2, D];
  const theirs3 = [...theirs2, C];
  assert.equal(p.move(mine3, theirs3), C, 'кара исчерпана — мир');
});

test('санитарная проверка: каждая стратегия доигрывает матч с каждой без ошибок', () => {
  for (const a of STRATEGIES) {
    for (const b of STRATEGIES) {
      const res = playMatch(a, b, { rounds: 30, noise: 0.05, seed: 11 });
      assert.equal(res.movesA.length, 30, `${a.id} vs ${b.id}`);
    }
  }
});
