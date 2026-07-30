'use strict';

var fs = require('fs');
var path = require('path');
var registry = require('../strategies');
var payoff = require('../engine/payoff');

var FORMAT_VERSION = 1;

/**
 * Сборка объекта ARENA_DATA — единственного контракта между симуляцией и
 * визуализатором. Всё, что читает `viz/arena.html`, приходит отсюда.
 *
 * Ни одного изменяющегося от запуска к запуску поля (в частности, никаких
 * временных штампов): файл обязан быть побайтово одинаковым при одинаковых
 * входных данных, иначе проверка воспроизводимости из Definition of Done
 * не имела бы смысла.
 *
 * @param {object[]} runs прогоны из sim/simulate.js
 * @param {object} [extra] {spatial, challengers, strategies}
 * @returns {object}
 */
function buildArenaData(runs, extra) {
  var e = extra || {};
  var defs = e.strategies || registry.list;

  return {
    version: FORMAT_VERSION,
    meta: {
      title: 'Арена Сунь-Цзы',
      payoff: { R: payoff.PAYOFF.R, P: payoff.PAYOFF.P, T: payoff.PAYOFF.T, S: payoff.PAYOFF.S },
      rounds: runs[0].rounds,
      generations: runs[0].generations,
      noise: runs[0].noise,
      dominationThreshold: runs[0].dominationThreshold,
      extinctionThreshold: runs[0].extinctionThreshold,
      seeds: runs.map(function (r) {
        return r.seed;
      })
    },
    strategies: registry.meta(defs),
    runs: runs,
    spatial: e.spatial || null,
    challengers: e.challengers || null
  };
}

/** Стабильная сериализация: два пробела отступа, порядок ключей как в объекте. */
function serializeJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * Запись `viz/replay.js`. Данные подаются присваиванием в `window.ARENA_DATA`,
 * а не через fetch: `arena.html` должен открываться двойным щелчком с диска,
 * где XHR к file:// заблокирован политикой источника.
 *
 * @param {string} filePath
 * @param {object} arenaData
 * @returns {number} размер файла в байтах
 */
function writeReplay(filePath, arenaData) {
  var header =
    '/* Автоматически сгенерировано `node sim/run.js`. Правки будут перезаписаны.\n' +
    ' *\n' +
    ' * Данные подаются присваиванием, а не через fetch: viz/arena.html открывается\n' +
    ' * двойным щелчком с диска, где запросы к file:// блокируются браузером.\n' +
    ' */\n';
  var body = 'window.ARENA_DATA = ' + JSON.stringify(arenaData) + ';\n';
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, header + body, 'utf8');
  return Buffer.byteLength(header + body, 'utf8');
}

/** Запись `results/<seed>.json`. */
function writeResult(dir, run) {
  fs.mkdirSync(dir, { recursive: true });
  var file = path.join(dir, run.seed + '.json');
  fs.writeFileSync(file, serializeJson(run), 'utf8');
  return file;
}

module.exports = {
  buildArenaData: buildArenaData,
  writeReplay: writeReplay,
  writeResult: writeResult,
  serializeJson: serializeJson,
  FORMAT_VERSION: FORMAT_VERSION
};
