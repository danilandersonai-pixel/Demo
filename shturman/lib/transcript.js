'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var paths = require('./paths');

/**
 * Работа с транскриптами Claude Code: поиск каталога проекта в
 * ~/.claude/projects, разбор JSONL-записей в нормализованные события и
 * «хвост» активного файла (чтение только дописанных байтов).
 */

function claudeProjectsRoot() {
  var override = process.env.SHTURMAN_CLAUDE_DIR;
  if (override) return path.join(override, 'projects');
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Найти каталог транскриптов для проекта.
 * 1) кодируем путь (Д-4); 2) fallback — сканируем все каталоги и сверяем
 * поле cwd в первых строках JSONL. Возвращает абсолютный путь или null.
 */
function findTranscriptDir(projectPath, rootDir) {
  var root = rootDir || claudeProjectsRoot();
  var abs = path.resolve(projectPath);
  var real = abs;
  try { real = fs.realpathSync(abs); } catch (e) { /* оставим как есть */ }

  // Совпадает ли cwd (с учётом симлинков: Claude Code пишет реальный путь)
  function cwdMatches(cwd) {
    if (!cwd) return false;
    var c = path.resolve(cwd);
    return c === abs || c === real;
  }

  // Кодирование имени может совпасть у разных проектов (все не-ASCII → «-»),
  // поэтому прямое попадание сверяем по cwd внутри JSONL.
  var tryDirs = [paths.encodeProjectDir(abs)];
  if (real !== abs) tryDirs.push(paths.encodeProjectDir(real));
  for (var d = 0; d < tryDirs.length; d++) {
    var direct = path.join(root, tryDirs[d]);
    var jf;
    try {
      if (!fs.statSync(direct).isDirectory()) continue;
      jf = fs.readdirSync(direct).filter(function (f) { return f.slice(-6) === '.jsonl'; });
    } catch (e) { continue; }
    if (jf.length === 0) return direct; // пустой каталог — принимаем на веру
    for (var k = 0; k < jf.length; k++) {
      if (cwdMatches(peekCwd(path.join(direct, jf[k])))) return direct;
    }
    // каталог есть, но cwd чужой — коллизия кодирования, ищем дальше
  }

  var dirs;
  try {
    dirs = fs.readdirSync(root);
  } catch (e) {
    return null;
  }
  for (var i = 0; i < dirs.length; i++) {
    var candidate = path.join(root, dirs[i]);
    var files;
    try {
      files = fs.readdirSync(candidate).filter(function (f) { return f.slice(-6) === '.jsonl'; });
    } catch (e) { continue; }
    for (var j = 0; j < files.length; j++) {
      if (cwdMatches(peekCwd(path.join(candidate, files[j])))) return candidate;
    }
  }
  return null;
}

/** Достать поле cwd из первых строк JSONL-файла (макс. 64 КБ). */
function peekCwd(file) {
  var text;
  try {
    var fd = fs.openSync(file, 'r');
    var buf = Buffer.alloc(65536);
    var n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    text = buf.slice(0, n).toString('utf8');
  } catch (e) {
    return null;
  }
  var lines = text.split('\n');
  for (var i = 0; i < lines.length && i < 20; i++) {
    if (!lines[i]) continue;
    try {
      var o = JSON.parse(lines[i]);
      if (o && o.cwd) return o.cwd;
    } catch (e) { /* оборванная строка — пропускаем */ }
  }
  return null;
}

/** Список сессий проекта: [{id, file, mtimeMs, size}] по убыванию свежести. */
function listSessions(dir) {
  var out = [];
  var files;
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    return out;
  }
  for (var i = 0; i < files.length; i++) {
    if (files[i].slice(-6) !== '.jsonl') continue;
    var full = path.join(dir, files[i]);
    try {
      var st = fs.statSync(full);
      out.push({
        id: files[i].slice(0, -6),
        file: full,
        mtimeMs: st.mtimeMs,
        size: st.size
      });
    } catch (e) { /* файл исчез между readdir и stat */ }
  }
  out.sort(function (a, b) { return b.mtimeMs - a.mtimeMs; });
  return out;
}

/* ------------------------------------------------------------------ */
/* Разбор записей                                                      */
/* ------------------------------------------------------------------ */

/** Одна строка JSONL → объект или null (мусор/обрыв). */
function parseLine(line) {
  var t = String(line || '').trim();
  if (!t) return null;
  try {
    var o = JSON.parse(t);
    return (o && typeof o === 'object') ? o : null;
  } catch (e) {
    return null;
  }
}

/**
 * Запись транскрипта → массив нормализованных событий.
 * ctx.toolNames — Map id→имя инструмента (для привязки результатов);
 * заводится вызывающей стороной и живёт всю сессию.
 *
 * Событие: { kind, ts, ...поля по виду, raw — усечённый оригинал }.
 * Виды: user-prompt | assistant-text | tool-use | tool-result | usage | meta
 */
function entryToEvents(entry, ctx) {
  ctx = ctx || {};
  if (!ctx.toolNames) ctx.toolNames = {};
  var events = [];
  if (!entry || !entry.type) return events;
  var ts = entry.timestamp || null;

  if (entry.type === 'user' && entry.message) {
    var content = entry.message.content;
    if (typeof content === 'string') {
      if (!looksLikeSystemNoise(content)) {
        events.push({
          kind: 'user-prompt', ts: ts,
          text: clip(content, 2000),
          raw: rawClip(entry)
        });
      }
    } else if (Array.isArray(content)) {
      for (var i = 0; i < content.length; i++) {
        var block = content[i];
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'tool_result') {
          var toolName = ctx.toolNames[block.tool_use_id] || null;
          events.push({
            kind: 'tool-result', ts: ts,
            tool: toolName,
            isError: !!block.is_error,
            output: clip(flattenContent(block.content), 4000),
            raw: rawClip(entry)
          });
        } else if (block.type === 'text' && block.text && !looksLikeSystemNoise(block.text)) {
          events.push({ kind: 'user-prompt', ts: ts, text: clip(block.text, 2000), raw: rawClip(entry) });
        }
      }
    }
    return events;
  }

  if (entry.type === 'assistant' && entry.message) {
    var blocks = Array.isArray(entry.message.content) ? entry.message.content : [];
    for (var j = 0; j < blocks.length; j++) {
      var b = blocks[j];
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && b.text && b.text.trim()) {
        events.push({
          kind: 'assistant-text', ts: ts,
          text: clip(b.text, 3000),
          stopReason: entry.message.stop_reason || null,
          raw: rawClip(entry)
        });
      } else if (b.type === 'tool_use') {
        if (b.id) ctx.toolNames[b.id] = b.name;
        events.push({
          kind: 'tool-use', ts: ts,
          tool: b.name,
          input: safeInput(b.input),
          raw: rawClip(entry)
        });
      }
      // thinking-блоки в ленту не попадают: это внутренняя кухня
    }
    if (entry.message.usage) {
      events.push({
        kind: 'usage', ts: ts,
        usage: pickUsage(entry.message.usage),
        // одно сообщение ассистента бывает разбито на несколько записей с
        // одинаковым usage — msgId нужен пульсу, чтобы не считать дважды
        msgId: entry.message.id || null,
        model: entry.message.model || null,
        stopReason: entry.message.stop_reason || null
      });
    }
    return events;
  }

  if (entry.type === 'summary' && entry.summary) {
    events.push({ kind: 'meta', ts: ts, text: 'Сводка сессии: ' + clip(entry.summary, 500) });
  }
  return events;
}

/** Служебные вставки Claude Code, которые не надо показывать как слова человека. */
function looksLikeSystemNoise(text) {
  var t = String(text);
  return t.indexOf('<system-reminder>') !== -1 ||
    t.indexOf('<command-name>') !== -1 ||
    t.indexOf('<local-command-stdout>') !== -1 ||
    t.indexOf('<task-notification>') !== -1 ||
    t.indexOf('[Request interrupted') === 0;
}

function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    var parts = [];
    for (var i = 0; i < content.length; i++) {
      var c = content[i];
      if (typeof c === 'string') parts.push(c);
      else if (c && c.type === 'text' && c.text) parts.push(c.text);
    }
    return parts.join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content);
}

function safeInput(input) {
  if (!input || typeof input !== 'object') return {};
  var out = {};
  var keys = Object.keys(input);
  for (var i = 0; i < keys.length; i++) {
    var v = input[keys[i]];
    out[keys[i]] = typeof v === 'string' ? clip(v, 1500) : v;
  }
  return out;
}

function pickUsage(u) {
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheCreate: u.cache_creation_input_tokens || 0
  };
}

function clip(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Усечённый оригинал записи для режима «Подробно». */
function rawClip(entry) {
  try {
    var s = JSON.stringify(entry);
    return s.length > 6000 ? s.slice(0, 6000) + '…"' : s;
  } catch (e) {
    return '{}';
  }
}

/** Прочитать и разобрать весь файл сессии (для журнала прошлых сессий). */
function readWholeSession(file, maxEvents) {
  var events = [];
  var ctx = { toolNames: {} };
  var text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return events;
  }
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var entry = parseLine(lines[i]);
    if (!entry) continue;
    var evs = entryToEvents(entry, ctx);
    for (var j = 0; j < evs.length; j++) events.push(evs[j]);
    if (maxEvents && events.length > maxEvents) break;
  }
  return events;
}

/* ------------------------------------------------------------------ */
/* Хвост активного файла                                               */
/* ------------------------------------------------------------------ */

/**
 * Tailer следит за каталогом транскриптов: держит самый свежий .jsonl,
 * читает только дописанные байты и отдаёт события через onEvents([...]).
 *
 * Устойчивость (по итогам ревизии):
 * - остаток недописанной строки хранится как Buffer и режется строго по
 *   '\n' — многобайтовый UTF-8-символ на границе чтения не портится;
 * - смещение и контекст хранятся НА КАЖДЫЙ файл: если рядом живут две
 *   активные сессии и «самый свежий» файл прыгает туда-сюда, возврат к
 *   уже виденному файлу продолжает чтение с места остановки — без дублей
 *   и перечитывания; onSwitch зовётся только для впервые увиденного файла.
 */
function createTailer(dir, handlers) {
  var onEvents = handlers.onEvents || function () {};
  var onSwitch = handlers.onSwitch || function () {};
  var pollMs = handlers.pollMs || 1000;
  var MAX_REMAINDER = 16 * 1024 * 1024;

  var current = null;        // {file, id}
  var fileStates = {};       // file → {offset, remainder(Buffer), ctx}
  var stopped = false;
  var lastActivityMs = 0;
  var watcher = null;
  var timer = null;

  function stateFor(file) {
    if (!fileStates[file]) {
      fileStates[file] = { offset: 0, remainder: Buffer.alloc(0), ctx: { toolNames: {} } };
    }
    return fileStates[file];
  }

  function pickNewest() {
    var sessions = listSessions(dir);
    return sessions.length ? sessions[0] : null;
  }

  function switchTo(session) {
    var firstTime = !fileStates[session.file];
    current = session;
    if (firstTime) onSwitch(session.id);
    readAppended();
  }

  function readAppended() {
    if (!current || stopped) return;
    var s = stateFor(current.file);
    var st;
    try {
      st = fs.statSync(current.file);
    } catch (e) {
      return;
    }
    if (st.size < s.offset) {
      // файл усёкся (редко, но бывает при ротации) — начинаем заново
      s.offset = 0;
      s.remainder = Buffer.alloc(0);
    }
    if (st.size === s.offset) return;
    var fd;
    try {
      fd = fs.openSync(current.file, 'r');
    } catch (e) {
      return;
    }
    var toRead = st.size - s.offset;
    var buf = Buffer.alloc(Math.min(toRead, 8 * 1024 * 1024));
    var read = 0;
    try {
      read = fs.readSync(fd, buf, 0, buf.length, s.offset);
    } finally {
      fs.closeSync(fd);
    }
    if (read <= 0) return;
    s.offset += read;

    // Режем по последнему '\n': всё до него — целые строки, остальное —
    // байтовый остаток. UTF-8 никогда не декодируется посреди символа.
    var chunk = Buffer.concat([s.remainder, buf.slice(0, read)]);
    var lastNl = chunk.lastIndexOf(10);
    if (lastNl === -1) {
      s.remainder = chunk.length > MAX_REMAINDER ? Buffer.alloc(0) : chunk;
      return;
    }
    var lines = chunk.slice(0, lastNl).toString('utf8').split('\n');
    s.remainder = chunk.slice(lastNl + 1);
    if (s.remainder.length > MAX_REMAINDER) s.remainder = Buffer.alloc(0);

    var batch = [];
    for (var i = 0; i < lines.length; i++) {
      var entry = parseLine(lines[i]);
      if (!entry) continue;
      var evs = entryToEvents(entry, s.ctx);
      for (var j = 0; j < evs.length; j++) batch.push(evs[j]);
    }
    if (batch.length) {
      lastActivityMs = Date.now();
      onEvents(batch);
    }
  }

  function tick() {
    if (stopped) return;
    var newest = pickNewest();
    if (newest && (!current || newest.file !== current.file)) {
      switchTo(newest);
      return;
    }
    readAppended();
  }

  function start() {
    var newest = pickNewest();
    if (newest) switchTo(newest);
    try {
      watcher = fs.watch(dir, function () { setTimeout(tick, 50); });
      if (watcher.unref) watcher.unref();
    } catch (e) { /* обойдёмся опросом */ }
    timer = setInterval(tick, pollMs);
    if (timer.unref) timer.unref();
  }

  return {
    start: start,
    stop: function () {
      stopped = true;
      if (watcher) try { watcher.close(); } catch (e) { /* ок */ }
      if (timer) clearInterval(timer);
    },
    currentSession: function () { return current ? current.id : null; },
    lastActivityMs: function () { return lastActivityMs; },
    /** для тестов */
    _tick: tick
  };
}

module.exports = {
  claudeProjectsRoot: claudeProjectsRoot,
  findTranscriptDir: findTranscriptDir,
  listSessions: listSessions,
  parseLine: parseLine,
  entryToEvents: entryToEvents,
  readWholeSession: readWholeSession,
  createTailer: createTailer,
  flattenContent: flattenContent,
  looksLikeSystemNoise: looksLikeSystemNoise
};
