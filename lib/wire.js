'use strict';

/**
 * Что уходит по проводу.
 *
 * Событие внутри сервера и событие на экране — не одно и то же. В памяти
 * лежит всё, включая исходную запись транскрипта; браузеру из этого нужна
 * малая часть. Замер показал, во что обходится разница: одно событие с
 * длинным диффом весило **159 КБ**, а стартовый снимок из пятисот таких —
 * **3.3 МБ**, которые панель качала и разбирала перед первым кадром.
 *
 * Причём поле `raw` не читал никто: клиент собирает «подробности» из
 * разобранных полей. Триста мегабайт трафика за сессию уходили в никуда.
 *
 * Правило: по проводу — то, что рисуется. Всё остальное лежит на сервере и
 * отдаётся по запросу через `/api/event`.
 */

// Пределы подобраны по тому, что панель реально показывает: вывод команды
// она и так режет по 20 000 знаков, дальше человек всё равно не читает.
var LIMITS = {
  output: 20000,
  stdout: 20000,
  stderr: 8000,
  text: 12000,
  hint: 2000
};

// Поля, которых на экране нет вовсе.
var DROP = ['raw'];

/**
 * Копия события для отправки: без сырой записи, с обрезанными длинными
 * текстами. Оригинал не трогаем — он остаётся в буфере целым.
 *
 * @param {object} ev
 * @returns {object} копия; если что-то обрезано, есть поле `cut`
 */
function slim(ev) {
  if (!ev || typeof ev !== 'object') return ev;

  var out = null;
  var cut = null;

  for (var key in ev) {
    if (!Object.prototype.hasOwnProperty.call(ev, key)) continue;
    if (DROP.indexOf(key) !== -1) { out = out || shallow(ev); delete out[key]; continue; }

    var limit = LIMITS[key];
    if (!limit) continue;
    var value = ev[key];
    if (typeof value !== 'string' || value.length <= limit) continue;

    out = out || shallow(ev);
    out[key] = value.slice(0, limit);
    cut = cut || {};
    cut[key] = value.length;
  }

  if (!out) return ev;                 // резать было нечего — отдаём как есть
  if (cut) out.cut = cut;              // клиенту: «есть что показать целиком»
  return out;
}

function shallow(ev) {
  var copy = {};
  for (var k in ev) if (Object.prototype.hasOwnProperty.call(ev, k)) copy[k] = ev[k];
  return copy;
}

/** То же для списка. */
function slimAll(list) {
  if (!Array.isArray(list)) return list;
  var out = new Array(list.length);
  for (var i = 0; i < list.length; i++) out[i] = slim(list[i]);
  return out;
}

/**
 * Сколько последних событий отдавать при открытии панели.
 *
 * Раньше отдавались все пятьсот из буфера — и панель ждала, пока они
 * приедут и разберутся. Двухсот хватает, чтобы человек увидел контекст
 * работы; остальное подтягивается прокруткой через `/api/events`.
 */
var SNAPSHOT_EVENTS = 200;

function snapshotSlice(list, limit) {
  var n = limit || SNAPSHOT_EVENTS;
  if (!Array.isArray(list) || list.length <= n) return slimAll(list);
  return slimAll(list.slice(list.length - n));
}

module.exports = {
  LIMITS: LIMITS,
  DROP: DROP,
  SNAPSHOT_EVENTS: SNAPSHOT_EVENTS,
  slim: slim,
  slimAll: slimAll,
  snapshotSlice: snapshotSlice
};
