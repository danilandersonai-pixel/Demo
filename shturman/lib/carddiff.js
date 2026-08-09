'use strict';

/**
 * Компактный дифф для карточки в ленте.
 *
 * У инструмента Edit в аргументах лежат old_string и new_string — по ним
 * lib/textdiff.js умеет строить настоящий построчный дифф. До сих пор он
 * включался только в подробностях события (и то через рабочую копию git).
 * Здесь тот же движок готовит маленький дифф прямо для карточки: правка
 * видна в ленте сразу, как в эталонных панелях (см. разбор opcode).
 *
 * Правила экономии — те же, что у wire.js: по проводу едет то, что
 * рисуется. Карточка показывает не больше CARD_LINES строк; остальное
 * человек открывает в подробностях. Слишком большие фрагменты не диффуем
 * вовсе — честно отдаём только счётчики.
 */

var textdiff = require('./textdiff');

var CARD_LINES = 24;      // максимум строк диффа в одной карточке
var CONTEXT = 2;          // строк контекста вокруг правки
var MAX_CHARS = 200000;   // выше этого даже не разбираем на строки

// Пары «было/стало» из аргументов инструмента. Edit несёт одну пару,
// MultiEdit — массив, у Write пары нет (файл создаётся целиком).
function pairsOf(args) {
  if (!args || typeof args !== 'object') return [];
  if (typeof args.old_string === 'string' || typeof args.new_string === 'string') {
    return [{ oldText: args.old_string || '', newText: args.new_string || '' }];
  }
  if (Array.isArray(args.edits)) {
    return args.edits.filter(Boolean).map(function (e) {
      return { oldText: e.old_string || '', newText: e.new_string || '' };
    });
  }
  return [];
}

// Обрезает список кусков до бюджета строк. Возвращает {hunks, more}:
// more — сколько строк правок осталось за кадром.
function capHunks(hunks, budget) {
  var out = [];
  var used = 0;
  var more = 0;
  for (var i = 0; i < hunks.length; i++) {
    var h = hunks[i];
    var lines = h.lines || [];
    if (used >= budget) {
      more += countChanged(lines);
      continue;
    }
    if (used + lines.length <= budget) {
      out.push(h);
      used += lines.length;
      continue;
    }
    var take = lines.slice(0, budget - used);
    more += countChanged(lines.slice(budget - used));
    out.push({ oldStart: h.oldStart, newStart: h.newStart, context: h.context, lines: take });
    used = budget;
  }
  return { hunks: out, more: more };
}

function countChanged(lines) {
  var n = 0;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'ctx') n++;
  }
  return n;
}

/**
 * Дифф для события ленты. Возвращает объект той же формы, что и
 * git-parse.parseDiff (плюс поле more), или null, когда диффа не будет:
 * не та карточка, нечего сравнивать или фрагмент слишком большой.
 */
function forEvent(ev) {
  if (!ev || ev.kind !== 'tool' || ev.action !== 'edit') return null;
  var pairs = pairsOf(ev.args);
  if (!pairs.length) return null;

  var total = 0;
  for (var i = 0; i < pairs.length; i++) {
    total += pairs[i].oldText.length + pairs[i].newText.length;
    if (total > MAX_CHARS) return null;   // счётчики уже есть в ev.stats
  }

  var hunks = [];
  var added = 0;
  var removed = 0;
  for (var j = 0; j < pairs.length; j++) {
    var d = textdiff.buildFileDiff(ev.file || '', pairs[j].oldText, pairs[j].newText,
      { context: CONTEXT });
    hunks = hunks.concat(d.hunks);
    added += d.added;
    removed += d.removed;
  }
  if (!hunks.length) return null;

  var capped = capHunks(hunks, CARD_LINES);
  return {
    path: ev.file || '',
    hunks: capped.hunks,
    added: added,
    removed: removed,
    binary: false,
    reconstructed: true,
    more: capped.more
  };
}

module.exports = {
  CARD_LINES: CARD_LINES,
  CONTEXT: CONTEXT,
  MAX_CHARS: MAX_CHARS,
  pairsOf: pairsOf,
  capHunks: capHunks,
  forEvent: forEvent
};
