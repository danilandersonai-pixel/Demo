#!/usr/bin/env node
// Закрытый чемпионат претендентов.
//
// Участники: чемпион основной лиги (лучшее среднее финальной доли по трём
// эталонным сидам) + все стратегии из strategies/challengers/. Претенденты
// написаны субагентами вслепую, поэтому перед боем каждый проходит карантин:
// корректный интерфейс и три пробных матча. Не прошедший — дисквалификация.
//
//   node sim/challenge.js            → results/challenge.json + сводка в консоль
//
// Формат: (1) круговая таблица средних очков за раунд (10 сидированных матчей
// на пару), (2) эволюция репликатором на 30 поколений (seed 777).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { playMatch, C, D } from '../engine/game.js';
import { combineSeedAll } from '../engine/rng.js';
import { simulate } from './simulate.js';
import { STRATEGIES } from '../strategies/index.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHALLENGERS_DIR = path.join(ROOT, 'strategies', 'challengers');
const OUT_PATH = path.join(ROOT, 'results', 'challenge.json');
const CANONICAL_SEEDS = [7, 42, 2026];

const round3 = (x) => Math.round(x * 1000) / 1000;

/** Чемпион = лучшее среднее финальной доли по эталонным results/<seed>.json. */
function findChampion() {
  const acc = new Map(STRATEGIES.map((s) => [s.id, 0]));
  for (const seed of CANONICAL_SEEDS) {
    const file = path.join(ROOT, 'results', `${seed}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`Нет ${file}: сначала выполните node sim/run.js --all`);
    }
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    r.strategies.forEach((s, i) => acc.set(s.id, acc.get(s.id) + r.finalShares[i] / CANONICAL_SEEDS.length));
  }
  let best = STRATEGIES[0];
  for (const s of STRATEGIES) {
    if (acc.get(s.id) > acc.get(best.id)) best = s;
  }
  return { champion: best, meanShare: acc.get(best.id) };
}

/**
 * Карантин претендента: интерфейс, уникальность id, пробные матчи и проверка
 * детерминизма (два одинаковых матча обязаны совпасть ход в ход — ловит
 * Math.random/Date и глобальное состояние между матчами). Бросает при
 * нарушении. Оговорка: import модуля исполняет его top-level код до карантина;
 * песочницы без зависимостей нет, поэтому претенденты — доверенный код (D-13).
 */
function quarantine(strat, takenIds) {
  for (const field of ['id', 'name', 'epithet', 'color']) {
    if (typeof strat[field] !== 'string' || !strat[field]) throw new Error(`нет поля ${field}`);
  }
  if (!strat.dossier || typeof strat.dossier.quote !== 'string') throw new Error('нет досье');
  if (typeof strat.create !== 'function') throw new Error('нет create()');
  if (takenIds.has(strat.id)) throw new Error(`id «${strat.id}» уже занят`);
  const probes = [
    { id: 'probe-allc', name: 'allc', create: () => ({ move: () => C }) },
    { id: 'probe-alld', name: 'alld', create: () => ({ move: () => D }) },
    { id: 'probe-tft', name: 'tft', create: () => ({ move: (m, t) => (t.length ? t[t.length - 1] : C) }) },
  ];
  for (const probe of probes) {
    const a = playMatch(strat, probe, { rounds: 200, noise: 0.05, seed: 999 });
    const b = playMatch(strat, probe, { rounds: 200, noise: 0.05, seed: 999 });
    if (a.movesA.join('') !== b.movesA.join('')) {
      throw new Error('недетерминизм: два матча с одним сидом разошлись (Math.random/Date/глобальное состояние?)');
    }
  }
  playMatch(strat, strat, { rounds: 200, noise: 0.05, seed: 998 });
}

async function loadChallengers() {
  if (!fs.existsSync(CHALLENGERS_DIR)) return { accepted: [], rejected: [] };
  const files = fs.readdirSync(CHALLENGERS_DIR).filter((f) => f.endsWith('.js')).sort();
  const accepted = [];
  const rejected = [];
  const takenIds = new Set(STRATEGIES.map((s) => s.id));
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(path.join(CHALLENGERS_DIR, f)).href);
      const strat = mod.default;
      if (!strat) throw new Error('нет default-экспорта');
      quarantine(strat, takenIds);
      takenIds.add(strat.id);
      accepted.push(strat);
    } catch (e) {
      rejected.push({ file: f, reason: e.message });
    }
  }
  return { accepted, rejected };
}

/** Круговая таблица: средний счёт за раунд по matchesPerPair сидированных матчей. */
function roundRobin(participants, { rounds = 200, noise = 0.05, matchesPerPair = 10 } = {}) {
  const n = participants.length;
  const table = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sumA = 0;
      let sumB = 0;
      for (let k = 0; k < matchesPerPair; k++) {
        const res = playMatch(participants[i], participants[j], {
          rounds,
          noise,
          seed: combineSeedAll(0xc0ffee, i, j, k),
        });
        sumA += res.avgA;
        sumB += res.avgB;
      }
      if (i === j) {
        table[i][i] = round3((sumA + sumB) / (2 * matchesPerPair));
      } else {
        table[i][j] = round3(sumA / matchesPerPair);
        table[j][i] = round3(sumB / matchesPerPair);
      }
    }
  }
  return table;
}

async function main() {
  const { champion, meanShare } = findChampion();
  const { accepted, rejected } = await loadChallengers();
  if (accepted.length === 0) {
    console.log('Претендентов нет (strategies/challengers/ пуст) — турнир не проводится.');
    return;
  }
  const participants = [champion, ...accepted];
  console.log(`Чемпион лиги: ${champion.name} (${champion.id}), среднее ${
    (meanShare * 100).toFixed(1)}% по сидам ${CANONICAL_SEEDS.join('/')}`);
  console.log(`Претенденты: ${accepted.map((s) => `${s.name} (${s.id})`).join(', ')}`);
  for (const r of rejected) console.log(`  ДИСКВАЛИФИКАЦИЯ ${r.file}: ${r.reason}`);

  const table = roundRobin(participants);
  console.log('\nКруговая таблица (средние очки за раунд, 10 матчей на пару):');
  const header = ['            '].concat(participants.map((p) => p.id.slice(0, 11).padStart(12))).join('');
  console.log(header);
  const totals = participants.map((_, i) => {
    const row = table[i];
    return row.reduce((a, b) => a + b, 0) / row.length;
  });
  participants.forEach((p, i) => {
    console.log(
      p.id.slice(0, 12).padEnd(12) +
        table[i].map((v) => v.toFixed(2).padStart(12)).join('') +
        `   | среднее ${totals[i].toFixed(3)}`
    );
  });

  const evo = simulate({ seed: 777, generations: 30, rounds: 200, noise: 0.05, strategies: participants });
  console.log('\nЭволюция (seed 777, 30 поколений):');
  participants
    .map((p, i) => ({ p, share: evo.finalShares[i] }))
    .sort((a, b) => b.share - a.share)
    .forEach(({ p, share }) => {
      const died = evo.generations.find((g) => g.extinct.includes(participants.indexOf(p)));
      console.log(
        `  ${(share * 100).toFixed(2).padStart(6)}%  ${p.name} (${p.id})` + (died ? `  † поколение ${died.gen}` : '')
      );
    });
  const w = participants[evo.outcome.winner];
  console.log(`  Итог: ${w.name}, условие: ${evo.outcome.condition}` +
    (evo.outcome.conditionGen ? ` (поколение ${evo.outcome.conditionGen})` : ''));

  const out = {
    meta: { rounds: 200, noise: 0.05, matchesPerPair: 10, evolutionSeed: 777, generations: 30 },
    champion: champion.id,
    participants: participants.map((p) => ({ id: p.id, name: p.name, epithet: p.epithet, color: p.color })),
    rejected,
    roundRobin: table,
    roundRobinMeans: totals.map(round3),
    evolution: {
      finalShares: evo.finalShares,
      outcome: evo.outcome,
      extinctions: evo.generations.flatMap((g) => g.extinct.map((i) => ({ id: participants[i].id, gen: g.gen }))),
      sharesByGen: evo.generations.map((g) => g.sharesAfter),
    },
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n→ ${path.relative(process.cwd(), OUT_PATH)}`);
}

main();
