'use strict';

// Построчный дифф без git.
//
// Нужен на уровне B (транскрипты есть, git нет) и для файлов вне контроля
// версий: у инструмента Edit в транскрипте лежат old_string и new_string,
// и по ним можно показать нормальный дифф вместо строчки «недоступно».
//
// Алгоритм — классический LCS на матрице длин. Он квадратичный по памяти,
// поэтому есть предохранитель: на очень больших фрагментах мы честно
// отступаем и показываем «было целиком / стало целиком».

var MAX_LINES = 1200;     // выше этого LCS не строим

function splitLines(text) {
  if (text === undefined || text === null || text === '') return [];
  var s = String(text);
  if (s[s.length - 1] === '\n') s = s.slice(0, -1);
  return s.split('\n');
}

/**
 * Таблица длин наибольшей общей подпоследовательности.
 * Возвращает двумерный массив (a.length+1) x (b.length+1).
 */
function lcsTable(a, b) {
  var table = new Array(a.length + 1);
  for (var i = 0; i <= a.length; i++) {
    table[i] = new Int32Array(b.length + 1);
  }
  for (var x = a.length - 1; x >= 0; x--) {
    for (var y = b.length - 1; y >= 0; y--) {
      table[x][y] = a[x] === b[y]
        ? table[x + 1][y + 1] + 1
        : Math.max(table[x + 1][y], table[x][y + 1]);
    }
  }
  return table;
}

/**
 * Список строк вида {type:'add'|'del'|'ctx', text, oldLine, newLine}.
 */
function diffLines(oldText, newText) {
  var a = splitLines(oldText);
  var b = splitLines(newText);

  // Слишком большой фрагмент: не строим матрицу, показываем как замену.
  if (a.length + b.length > MAX_LINES) {
    return a.map(function (t, i) { return { type: 'del', text: t, oldLine: i + 1 }; })
      .concat(b.map(function (t, i) { return { type: 'add', text: t, newLine: i + 1 }; }));
  }

  var table = lcsTable(a, b);
  var out = [];
  var i = 0;
  var j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++; j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ type: 'del', text: a[i], oldLine: i + 1 });
      i++;
    } else {
      out.push({ type: 'add', text: b[j], newLine: j + 1 });
      j++;
    }
  }
  while (i < a.length) { out.push({ type: 'del', text: a[i], oldLine: i + 1 }); i++; }
  while (j < b.length) { out.push({ type: 'add', text: b[j], newLine: j + 1 }); j++; }
  return out;
}

/**
 * Группирует строки в куски вокруг изменений, оставляя `context` строк
 * контекста с каждой стороны. Форма совпадает с тем, что отдаёт
 * git-parse.parseDiff, — клиент рисует их одинаково.
 */
function toHunks(lines, context) {
  var ctx = context === undefined ? 3 : context;
  var interesting = [];
  lines.forEach(function (l, idx) {
    if (l.type !== 'ctx') interesting.push(idx);
  });
  if (!interesting.length) return [];

  // Склеиваем близкие изменения в один кусок.
  var ranges = [];
  interesting.forEach(function (idx) {
    var from = Math.max(0, idx - ctx);
    var to = Math.min(lines.length - 1, idx + ctx);
    var last = ranges[ranges.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else ranges.push({ from: from, to: to });
  });

  return ranges.map(function (r) {
    var slice = lines.slice(r.from, r.to + 1);
    var firstOld = 0;
    var firstNew = 0;
    for (var k = 0; k < slice.length; k++) {
      if (!firstOld && slice[k].oldLine) firstOld = slice[k].oldLine;
      if (!firstNew && slice[k].newLine) firstNew = slice[k].newLine;
      if (firstOld && firstNew) break;
    }
    return {
      oldStart: firstOld || 1,
      newStart: firstNew || 1,
      context: '',
      lines: slice.map(function (l) { return { type: l.type, text: l.text }; })
    };
  });
}

/**
 * Готовый «файл диффа» в том же виде, что и у git-parse.parseDiff,
 * чтобы клиенту было всё равно, откуда дифф взялся.
 */
function buildFileDiff(pathStr, oldText, newText, options) {
  var opts = options || {};
  var lines = diffLines(oldText, newText);
  var hunks = toHunks(lines, opts.context);
  var added = 0;
  var removed = 0;
  lines.forEach(function (l) {
    if (l.type === 'add') added++;
    else if (l.type === 'del') removed++;
  });
  return {
    path: pathStr || '',
    hunks: hunks,
    added: added,
    removed: removed,
    binary: false,
    reconstructed: true    // клиент подписывает такой дифф как восстановленный
  };
}

module.exports = {
  splitLines: splitLines,
  diffLines: diffLines,
  toHunks: toHunks,
  buildFileDiff: buildFileDiff,
  MAX_LINES: MAX_LINES
};
