'use strict';

// «Пульс сессии»: сводка по тому, что произошло с момента запуска Штурмана.
// Чистый аккумулятор: события внутрь, цифры наружу.

var humanize = require('./humanize');

function createStats(options) {
  var opts = options || {};
  var now = opts.now || Date.now;
  var startedAt = opts.startedAt || now();

  var filesTouched = new Set();
  var filesRead = new Set();
  var commands = 0;
  var errors = 0;
  var edits = 0;
  var reads = 0;
  var searches = 0;
  var prompts = 0;
  var answers = 0;
  var lastActivityAt = 0;
  var recentFiles = [];        // «мини-карта внимания»: куда Клод смотрит
  var RECENT_LIMIT = 12;

  function noteRecent(file, action) {
    if (!file) return;
    var idx = recentFiles.findIndex(function (r) { return r.file === file; });
    if (idx !== -1) recentFiles.splice(idx, 1);
    recentFiles.unshift({ file: file, action: action, ts: now() });
    if (recentFiles.length > RECENT_LIMIT) recentFiles.length = RECENT_LIMIT;
  }

  return {
    add: function (ev) {
      if (!ev) return;
      if (ev.ts) lastActivityAt = Math.max(lastActivityAt, ev.ts);

      if (ev.kind === 'user') prompts++;
      if (ev.kind === 'assistant' && ev.action === 'say') answers++;

      if (ev.kind === 'tool') {
        if (ev.action === 'run') commands++;
        if (ev.action === 'edit' || ev.action === 'write') {
          edits++;
          if (ev.file) { filesTouched.add(ev.file); noteRecent(ev.file, 'edit'); }
        }
        if (ev.action === 'read') {
          reads++;
          if (ev.file) { filesRead.add(ev.file); noteRecent(ev.file, 'read'); }
        }
        if (ev.action === 'search') searches++;
      }

      if (ev.kind === 'result' && ev.ok === false) errors++;

      // Изменения на диске тоже считаем «затронутыми файлами»: даже если
      // Клод правил файл не своим инструментом, а командой.
      if (ev.kind === 'file' && ev.file && ev.action !== 'removed') {
        filesTouched.add(ev.file);
      }
    },

    snapshot: function (extra) {
      var t = now();
      var durationMs = t - startedAt;
      var e = extra || {};
      return {
        startedAt: startedAt,
        durationMs: durationMs,
        durationText: humanize.formatDuration(durationMs),
        filesTouched: filesTouched.size,
        filesRead: filesRead.size,
        commands: commands,
        errors: errors,
        edits: edits,
        reads: reads,
        searches: searches,
        prompts: prompts,
        answers: answers,
        lastActivityAt: lastActivityAt,
        quietMs: lastActivityAt ? t - lastActivityAt : 0,
        recentFiles: recentFiles.slice(),
        tokens: e.tokens || null,
        // Текстовая сводка одной строкой — её же используем в дайджесте.
        summaryText: buildSummary({
          durationMs: durationMs,
          filesTouched: filesTouched.size,
          commands: commands,
          errors: errors
        })
      };
    },

    reset: function () {
      filesTouched.clear();
      filesRead.clear();
      recentFiles.length = 0;
      commands = 0; errors = 0; edits = 0; reads = 0; searches = 0;
      prompts = 0; answers = 0; lastActivityAt = 0;
      startedAt = now();
    }
  };
}

function buildSummary(s) {
  var parts = [];
  parts.push('за ' + humanize.formatDuration(s.durationMs));
  parts.push('затронуто ' + humanize.withPlural(s.filesTouched, 'файл', 'файла', 'файлов'));
  parts.push('выполнено ' + humanize.withPlural(s.commands, 'команда', 'команды', 'команд'));
  if (s.errors > 0) {
    parts.push('замечено ' + humanize.withPlural(s.errors, 'ошибка', 'ошибки', 'ошибок'));
  } else {
    parts.push('ошибок не замечено');
  }
  var text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

module.exports = { createStats: createStats, buildSummary: buildSummary };
