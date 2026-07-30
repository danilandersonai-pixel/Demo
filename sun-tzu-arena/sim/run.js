#!/usr/bin/env node
// CLI Арены Сунь-Цзы.
//
//   node sim/run.js --seed 42 [--generations 30] [--noise 0.05] [--rounds 200]
//   node sim/run.js --all          — все три эталонных сида (7, 42, 2026)
//
// Пишет results/<seed>.json (при нестандартном шуме — <seed>-noise<v>.json,
// см. DECISIONS D-09) и перегенерирует viz/replay.js из эталонных файлов.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulate, serializeResult } from './simulate.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RESULTS_DIR = path.join(ROOT, 'results');
const REPLAY_PATH = path.join(ROOT, 'viz', 'replay.js');

export const CANONICAL_SEEDS = [7, 42, 2026];
const DEFAULT_NOISE = 0.05;

function parseArgs(argv) {
  const opts = { generations: 30, noise: DEFAULT_NOISE, rounds: 200, all: false, seed: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') {
      opts.all = true;
    } else if (a === '--seed' || a === '--generations' || a === '--noise' || a === '--rounds') {
      const raw = argv[++i];
      const num = Number(raw);
      if (raw === undefined || Number.isNaN(num)) {
        throw new Error(`Флагу ${a} нужно числовое значение, получено: ${raw}`);
      }
      opts[a.slice(2)] = num;
    } else {
      throw new Error(`Неизвестный аргумент: ${a} (доступны --seed, --generations, --noise, --rounds, --all)`);
    }
  }
  if (!opts.all && opts.seed == null) {
    throw new Error('Укажите --seed <число> или --all');
  }
  return opts;
}

export function resultFileName(seed, noise) {
  return noise === DEFAULT_NOISE ? `${seed}.json` : `${seed}-noise${noise}.json`;
}

/** Перегенерация viz/replay.js из имеющихся эталонных results/<seed>.json. */
export function rebuildReplay() {
  const runs = {};
  const seeds = [];
  const spatial = {};
  for (const seed of CANONICAL_SEEDS) {
    const file = path.join(RESULTS_DIR, `${seed}.json`);
    if (fs.existsSync(file)) {
      runs[seed] = JSON.parse(fs.readFileSync(file, 'utf8'));
      seeds.push(seed);
    }
    const spatialFile = path.join(RESULTS_DIR, `spatial-${seed}.json`);
    if (fs.existsSync(spatialFile)) {
      spatial[seed] = JSON.parse(fs.readFileSync(spatialFile, 'utf8'));
    }
  }
  const data = { version: 1, seeds, runs, spatial };
  const js =
    '// Автосгенерировано sim/run.js — не редактировать вручную.\n' +
    '// Данные реплеев для viz/arena.html (файл открывается с диска, без fetch).\n' +
    'window.ARENA_DATA = ' +
    JSON.stringify(data) +
    ';\n';
  fs.writeFileSync(REPLAY_PATH, js);
  return seeds;
}

function printSummary(result) {
  const { meta, strategies, outcome, finalShares } = result;
  const order = strategies
    .map((s, i) => ({ name: s.name, id: s.id, share: finalShares[i] }))
    .sort((a, b) => b.share - a.share);
  console.log(`\n— seed ${meta.seed} (noise ${meta.noise}, ${meta.generations} поколений) —`);
  for (const row of order) {
    const bar = '█'.repeat(Math.round(row.share * 40));
    const pct = (row.share * 100).toFixed(2).padStart(6);
    console.log(`  ${pct}%  ${bar.padEnd(24)} ${row.name} (${row.id})`);
  }
  const condRu = {
    domination: `доминация > 60 % (поколение ${outcome.conditionGen})`,
    extermination: `вымирание остальных (поколение ${outcome.conditionGen})`,
    plurality: 'победа по доле после всех поколений',
  };
  const winnerName = strategies[outcome.winner].name;
  console.log(`  Победитель: ${winnerName} — ${condRu[outcome.condition]}`);
}

function runOne(seed, opts) {
  const result = simulate({
    seed,
    generations: opts.generations,
    rounds: opts.rounds,
    noise: opts.noise,
  });
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, resultFileName(seed, opts.noise));
  fs.writeFileSync(file, serializeResult(result));
  printSummary(result);
  console.log(`  → ${path.relative(process.cwd(), file)}`);
  return result;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const seeds = opts.all ? CANONICAL_SEEDS : [opts.seed];
  for (const seed of seeds) runOne(seed, opts);
  const included = rebuildReplay();
  console.log(`\nviz/replay.js обновлён (сиды: ${included.join(', ') || 'нет'})`);
}

// Запускаемся только при прямом вызове (node sim/run.js …), не при импорте.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
