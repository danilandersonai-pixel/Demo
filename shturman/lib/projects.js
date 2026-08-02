'use strict';

/**
 * Откуда берётся список проектов.
 *
 * Человек, для которого сделан Штурман, не печатает пути. Зато Claude Code
 * уже хранит папку с записями по каждому проекту, где он работал:
 *
 *     ~/.claude/projects/<путь-с-дефисами-вместо-слэшей>/<сессия>.jsonl
 *
 * Обратно из имени папки путь однозначно не восстановить: дефис мог быть и
 * в самом имени каталога («my-app» → «-home-user-my-app»). Поэтому настоящий
 * путь берём **из самих записей**: в каждой строке транскрипта лежит `cwd`.
 * Поднимаемся от него вверх, пока закодированное имя не совпадёт с папкой —
 * это и есть корень проекта. Угадывание оставлено запасным вариантом.
 */

var fs = require('fs');
var path = require('path');
var paths = require('./paths');
var ignore = require('./ignore');

var MAX_SCAN_LINES = 60;      // больше и не нужно: cwd есть в первых строках
var MAX_FILES = 5000;         // считать файлы до бесконечности незачем

// ---------------------------------------------------------------------------
// Восстановление пути
// ---------------------------------------------------------------------------

/** Все .jsonl каталога, самые свежие первыми. */
function transcripts(dir) {
  var out = [];
  try {
    fs.readdirSync(dir).forEach(function (name) {
      if (!/\.jsonl$/i.test(name)) return;
      var full = path.join(dir, name);
      try {
        var st = fs.statSync(full);
        if (st.isFile()) out.push({ file: full, mtime: st.mtimeMs, size: st.size });
      } catch (e) { /* исчез между readdir и stat */ }
    });
  } catch (e) { /* каталога нет */ }
  return out.sort(function (a, b) { return b.mtime - a.mtime; });
}

/** Первые несколько cwd из транскрипта. */
function cwdsFrom(file) {
  var found = [];
  var text;
  try {
    // Читаем только начало файла: транскрипт бывает на десятки мегабайт.
    var fd = fs.openSync(file, 'r');
    var buf = Buffer.alloc(Math.min(256 * 1024, fs.fstatSync(fd).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch (e) { return found; }

  var lines = text.split('\n');
  for (var i = 0; i < lines.length && i < MAX_SCAN_LINES; i++) {
    if (!lines[i].trim()) continue;
    var rec;
    try { rec = JSON.parse(lines[i]); } catch (e) { continue; }
    if (rec && typeof rec.cwd === 'string' && rec.cwd && found.indexOf(rec.cwd) === -1) {
      found.push(rec.cwd);
    }
  }
  return found;
}

/**
 * Настоящий путь проекта по имени каталога транскриптов.
 * Возвращает строку или null, если восстановить не удалось.
 */
function decodePath(encoded, dir) {
  var files = transcripts(dir);
  for (var f = 0; f < files.length && f < 5; f++) {
    var list = cwdsFrom(files[f].file);
    for (var c = 0; c < list.length; c++) {
      var candidate = list[c];
      // Поднимаемся вверх, пока не совпадёт кодировка каталога.
      for (var up = 0; up < 12 && candidate; up++) {
        if (paths.encodeProjectDir(candidate) === encoded) return candidate;
        var parent = path.dirname(candidate);
        if (parent === candidate) break;
        candidate = parent;
      }
    }
  }
  // Запасной вариант: считаем, что дефисов в именах не было.
  var guess = encoded.replace(/-/g, '/');
  if (guess.charAt(0) !== '/') guess = '/' + guess;
  try { if (fs.statSync(guess).isDirectory()) return guess; } catch (e) { /* мимо */ }
  return null;
}

// ---------------------------------------------------------------------------
// Сколько в проекте файлов
// ---------------------------------------------------------------------------

/** Быстрый счётчик файлов: служебные папки пропускаем, считаем до предела. */
function countFiles(root, limit) {
  var max = limit || MAX_FILES;
  var total = 0;
  var truncated = false;

  function walk(dir, depth) {
    if (truncated || depth > 8) return;
    var entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (var i = 0; i < entries.length; i++) {
      if (truncated) return;
      var e = entries[i];
      if (e.isDirectory()) {
        if (ignore.isIgnoredDirName(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        if (ignore.isIgnoredFileName(e.name)) continue;
        total++;
        if (total >= max) { truncated = true; return; }
      }
    }
  }
  walk(root, 0);
  return { files: total, truncated: truncated };
}

// ---------------------------------------------------------------------------
// Список карточек
// ---------------------------------------------------------------------------

/**
 * Проекты, в которых работал Claude Code, самые свежие первыми.
 * `recent` — пути из настроек: их показываем, даже если записей уже нет.
 */
function list(options) {
  var opts = options || {};
  var base = opts.dir || paths.claudeProjectsDir();
  var seen = new Map();

  var names = [];
  try { names = fs.readdirSync(base); } catch (e) { names = []; }

  names.forEach(function (encoded) {
    var dir = path.join(base, encoded);
    var st;
    try { st = fs.statSync(dir); } catch (e) { return; }
    if (!st.isDirectory()) return;

    var files = transcripts(dir);
    if (!files.length) return;

    var real = decodePath(encoded, dir);
    if (!real) return;

    seen.set(real, {
      path: real,
      name: paths.baseName(real) || real,
      encoded: encoded,
      exists: existsDir(real),
      lastSession: files[0].mtime,
      sessions: files.length,
      transcriptBytes: files.reduce(function (a, f) { return a + f.size; }, 0)
    });
  });

  // Папки, которые человек открывал через «Открыть другую папку»: записей
  // Claude Code в них может не быть вовсе, но забывать их нельзя.
  (opts.recent || []).forEach(function (r) {
    var p = r && (r.path || r);
    if (!p || seen.has(p)) return;
    seen.set(p, {
      path: p,
      name: paths.baseName(p) || p,
      encoded: paths.encodeProjectDir(p),
      exists: existsDir(p),
      lastSession: (r && r.lastOpened) || 0,
      sessions: 0,
      transcriptBytes: 0
    });
  });

  var out = Array.from(seen.values());
  if (opts.withCounts !== false) {
    out.forEach(function (p) {
      if (!p.exists) { p.files = 0; p.filesTruncated = false; return; }
      var c = countFiles(p.path, opts.fileLimit);
      p.files = c.files;
      p.filesTruncated = c.truncated;
    });
  }
  out.sort(function (a, b) { return (b.lastSession || 0) - (a.lastSession || 0); });
  if (opts.limit) out = out.slice(0, opts.limit);
  return out;
}

function existsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

module.exports = {
  transcripts: transcripts,
  cwdsFrom: cwdsFrom,
  decodePath: decodePath,
  countFiles: countFiles,
  existsDir: existsDir,
  list: list
};
