#!/usr/bin/env node
// Генератор viz/league.js — браузерного порта движка и стратегий лиги.
//
// Зачем: инспектор дуэлей и режим «Сыграй сам» должны пересимулировать матчи
// прямо в браузере (страница открывается с диска, ES-модули под file://
// запрещены CORS). Вместо дублирования логики бандл собирается из ТЕХ ЖЕ
// исходников: у модулей срезаются import/export, каждый файл заворачивается
// в IIFE. После сборки — обязательная проверка паритета: каждая стратегия
// играет сидированный матч в Node и в бандле (node:vm), ходы обязаны
// совпасть байт-в-байт, иначе сборка падает.
//
//   node sim/bundle.js   → viz/league.js

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { playMatch } from '../engine/game.js';
import { STRATEGIES } from '../strategies/index.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_PATH = path.join(ROOT, 'viz', 'league.js');

/** Срезает import-строки и ключевое слово export у деклараций. */
function stripModuleSyntax(src) {
  return src
    .replace(/^import[^;]*;\s*$/gm, '')
    .replace(/^export function /gm, 'function ')
    .replace(/^export const /gm, 'const ');
}

/** Файл стратегии → IIFE c регистрацией в window.ARENA_LEAGUE. */
function wrapStrategy(src, file) {
  const stripped = src.replace(/^import[^;]*;\s*$/gm, '');
  const at = stripped.indexOf('export default');
  if (at < 0) throw new Error(`${file}: нет export default`);
  const lastBrace = stripped.lastIndexOf('};');
  if (lastBrace < at) throw new Error(`${file}: не найден конец export default`);
  const body =
    stripped.slice(0, at) +
    'window.ARENA_LEAGUE.register(' +
    stripped.slice(at + 'export default'.length, lastBrace + 1) +
    ');' +
    stripped.slice(lastBrace + 2);
  // C/D добавляем, только если модуль не объявляет их сам (иначе — коллизия).
  const declares = (name) =>
    new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`).test(stripped) ||
    new RegExp(`\\b(?:const|let|var)\\s+[^;]*,\\s*${name}\\s*=`).test(stripped);
  let prelude = '';
  if (!declares('C')) prelude += "  const C = 'C';\n";
  if (!declares('D')) prelude += "  const D = 'D';\n";
  return `(function () {\n${prelude}${body}\n})();\n`;
}

/** Путь к исходнику каждой стратегии реестра (по id). */
async function leagueFiles() {
  const dirs = ['strategies', 'strategies/challengers', 'strategies/evolved'];
  const byId = new Map();
  for (const dir of dirs) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
      const file = path.join(abs, f);
      const mod = await import(pathToFileURL(file).href);
      if (mod.default && mod.default.id) byId.set(mod.default.id, file);
    }
  }
  return STRATEGIES.map((s) => {
    const file = byId.get(s.id);
    if (!file) throw new Error(`Не найден исходник стратегии «${s.id}»`);
    return { id: s.id, file };
  });
}

export async function buildBundle() {
  const rngSrc = stripModuleSyntax(fs.readFileSync(path.join(ROOT, 'engine', 'rng.js'), 'utf8'));
  const gameSrc = stripModuleSyntax(fs.readFileSync(path.join(ROOT, 'engine', 'game.js'), 'utf8'));
  const files = await leagueFiles();

  let out = '// Автосгенерировано sim/bundle.js — не редактировать вручную.\n';
  out += '// Браузерный порт движка и стратегий лиги (для инспектора дуэлей\n';
  out += '// и режима «Сыграй сам»). Паритет с Node проверен при сборке.\n';
  out += 'window.ARENA_LEAGUE = {\n';
  out += '  list: [],\n  byId: {},\n';
  out += '  register(s) { this.list.push(s); this.byId[s.id] = s; },\n';
  out += '};\n';
  out += 'window.ARENA_ENGINE = (function () {\n';
  out += rngSrc + '\n' + gameSrc + '\n';
  out += '  return { mulberry32, combineSeed, combineSeedAll, C, D, PAYOFFS, payoff, playMatch };\n';
  out += '})();\n\n';
  for (const { file } of files) {
    out += wrapStrategy(fs.readFileSync(file, 'utf8'), path.relative(ROOT, file)) + '\n';
  }
  return out;
}

/** Паритет: каждая стратегия бандла играет тот же матч, что и Node-версия. */
export function verifyBundle(bundleSrc) {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(bundleSrc, sandbox, { filename: 'league.js' });
  const { ARENA_LEAGUE, ARENA_ENGINE } = sandbox.window;
  if (!ARENA_LEAGUE || ARENA_LEAGUE.list.length !== STRATEGIES.length) {
    throw new Error(`Бандл зарегистрировал ${ARENA_LEAGUE ? ARENA_LEAGUE.list.length : 0} стратегий из ${STRATEGIES.length}`);
  }
  const tft = STRATEGIES.find((s) => s.id === 'tit-for-tat');
  for (const nodeStrat of STRATEGIES) {
    const browserStrat = ARENA_LEAGUE.byId[nodeStrat.id];
    if (!browserStrat) throw new Error(`В бандле нет «${nodeStrat.id}»`);
    const seed = 424242;
    const native = playMatch(nodeStrat, tft, { rounds: 120, noise: 0.05, seed });
    const ported = ARENA_ENGINE.playMatch(browserStrat, ARENA_LEAGUE.byId['tit-for-tat'], {
      rounds: 120,
      noise: 0.05,
      seed,
    });
    if (native.movesA.join('') !== ported.movesA.join('') || native.movesB.join('') !== ported.movesB.join('')) {
      throw new Error(`Паритет нарушен: «${nodeStrat.id}» играет в бандле иначе, чем в Node`);
    }
  }
  return true;
}

async function main() {
  const bundle = await buildBundle();
  verifyBundle(bundle);
  fs.writeFileSync(OUT_PATH, bundle);
  console.log(`viz/league.js собран: ${STRATEGIES.length} стратегий, паритет с Node подтверждён`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
