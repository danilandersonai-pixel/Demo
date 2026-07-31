'use strict';

// Дайджест «Что мы сегодня сделали» — экспорт итогов сессии в markdown.
// Чистая функция: события + сводка на входе, текст на выходе.

var humanize = require('./humanize');

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function formatTime(ts) {
  var d = new Date(ts);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function formatDate(ts) {
  var d = new Date(ts);
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
}

/**
 * Собирает markdown-дневник по событиям сессии.
 * options: {projectName, stats, git, tokens, level}
 */
function build(events, options) {
  var opts = options || {};
  var list = (events || []).filter(Boolean);
  var stats = opts.stats || {};
  var git = opts.git || null;

  var lines = [];
  var startTs = list.length ? list[0].ts : Date.now();

  lines.push('# Что мы сегодня сделали');
  lines.push('');
  lines.push('**Проект:** ' + (opts.projectName || 'без имени'));
  lines.push('**Дата:** ' + formatDate(startTs));
  if (stats.durationText) lines.push('**Длительность наблюдения:** ' + stats.durationText);
  if (git && git.branch) lines.push('**Ветка:** `' + git.branch + '`');
  lines.push('');

  // --- Коротко ---------------------------------------------------------------
  lines.push('## Коротко');
  lines.push('');
  if (stats.summaryText) lines.push(stats.summaryText);
  else lines.push('Данных о сессии не набралось.');
  lines.push('');

  // --- Что просили -----------------------------------------------------------
  var prompts = list.filter(function (e) { return e.kind === 'user'; });
  if (prompts.length) {
    lines.push('## Что я просил у Клода');
    lines.push('');
    prompts.forEach(function (p) {
      lines.push('- **' + formatTime(p.ts) + '** — ' + humanize.shorten(p.text, 220));
    });
    lines.push('');
  }

  // --- Изменённые файлы -------------------------------------------------------
  var edited = new Map();
  list.forEach(function (e) {
    if (e.kind !== 'tool') return;
    if (e.action !== 'edit' && e.action !== 'write') return;
    if (!e.file) return;
    var prev = edited.get(e.file) || { count: 0, added: 0, removed: 0, created: false };
    prev.count++;
    if (e.action === 'write') prev.created = true;
    if (e.stats) {
      prev.added += e.stats.added || 0;
      prev.removed += e.stats.removed || 0;
    }
    edited.set(e.file, prev);
  });
  if (edited.size) {
    lines.push('## Какие файлы изменились');
    lines.push('');
    Array.from(edited.entries())
      .sort(function (a, b) { return b[1].count - a[1].count; })
      .forEach(function (pair) {
        var f = pair[0];
        var v = pair[1];
        var bits = [];
        if (v.created) bits.push('создан');
        if (v.added || v.removed) bits.push('+' + v.added + ' −' + v.removed);
        bits.push(humanize.withPlural(v.count, 'правка', 'правки', 'правок'));
        lines.push('- `' + f + '` — ' + bits.join(', '));
      });
    lines.push('');
  }

  // --- Команды ----------------------------------------------------------------
  var commands = list.filter(function (e) { return e.kind === 'tool' && e.action === 'run'; });
  if (commands.length) {
    lines.push('## Какие команды выполнялись');
    lines.push('');
    // Одинаковые команды сворачиваем: «npm test ×4» читается лучше списка из
    // четырёх одинаковых строк.
    var byCmd = new Map();
    commands.forEach(function (c) {
      var key = String(c.command || '').trim();
      if (!key) return;
      var prev = byCmd.get(key) || { count: 0, why: humanize.explainCommand(key) };
      prev.count++;
      byCmd.set(key, prev);
    });
    Array.from(byCmd.entries()).forEach(function (pair) {
      var suffix = pair[1].count > 1 ? ' ×' + pair[1].count : '';
      var why = pair[1].why ? ' — ' + pair[1].why : '';
      lines.push('- `' + humanize.shorten(pair[0], 100) + '`' + suffix + why);
    });
    lines.push('');
  }

  // --- Ошибки ------------------------------------------------------------------
  var errors = list.filter(function (e) { return e.kind === 'result' && e.ok === false; });
  if (errors.length) {
    lines.push('## Что пошло не так');
    lines.push('');
    lines.push('Ошибка по ходу работы — это нормально: Клод обычно пробует другой способ. ' +
      'Вот что встретилось:');
    lines.push('');
    errors.slice(0, 15).forEach(function (e) {
      var what = e.command ? '`' + humanize.shorten(e.command, 70) + '`' : (e.file ? '`' + e.file + '`' : 'инструмент');
      lines.push('- **' + formatTime(e.ts) + '** ' + what + ' — ' +
        humanize.shorten(e.stderr || e.output, 160));
    });
    if (errors.length > 15) lines.push('- …и ещё ' + (errors.length - 15));
    lines.push('');
  }

  // --- Git ---------------------------------------------------------------------
  if (git && git.available) {
    lines.push('## Состояние проекта в git');
    lines.push('');
    lines.push('- Ветка: `' + git.branch + '` — ' + (git.branchExplain || ''));
    if (git.summary) lines.push('- ' + git.summary.explain);
    if (git.commits && git.commits.length) {
      lines.push('- Последние сохранения:');
      git.commits.slice(0, 5).forEach(function (c) {
        lines.push('  - `' + c.short + '` ' + c.subject);
      });
    }
    lines.push('');
  }

  // --- Новые слова -------------------------------------------------------------
  var terms = collectTerms(list);
  if (terms.length) {
    lines.push('## Слова, которые сегодня встретились');
    lines.push('');
    terms.forEach(function (t) {
      lines.push('- **' + t.term + '** — ' + t.text);
    });
    lines.push('');
  }

  // --- Токены ------------------------------------------------------------------
  if (opts.tokens && opts.tokens.messages) {
    lines.push('## Расход токенов (приблизительно)');
    lines.push('');
    lines.push('Оценка по транскрипту; с фактическим счётом может расходиться.');
    lines.push('');
    lines.push('- Отправлено: ' + fmtNum(opts.tokens.input + opts.tokens.cacheCreate));
    lines.push('- Получено: ' + fmtNum(opts.tokens.output));
    lines.push('- Прочитано из кеша: ' + fmtNum(opts.tokens.cacheRead));
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('_Составлено Штурманом — панелью-наставником для Claude Code._');
  lines.push('');

  return lines.join('\n');
}

// Термины из словаря, которые реально всплыли в этой сессии, — чтобы
// дневник учил, а не просто перечислял.
function collectTerms(list) {
  var glossary = require('./glossary');
  var hay = list.map(function (e) {
    return [e.title, e.command, e.file, e.text].filter(Boolean).join(' ');
  }).join(' ').toLowerCase();

  var picked = [];
  glossary.all().forEach(function (t) {
    if (picked.length >= 8) return;
    var needles = [t.term.toLowerCase()].concat((t.aliases || []).map(function (a) {
      return String(a).toLowerCase();
    }));
    var hit = needles.some(function (n) { return n.length > 2 && hay.indexOf(n) !== -1; });
    if (hit) picked.push(t);
  });
  return picked;
}

function fmtNum(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Имя файла для скачивания: «shturman-digest-2026-07-31.md».
function suggestFilename(ts) {
  var d = new Date(ts || Date.now());
  return 'shturman-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.md';
}

module.exports = {
  build: build,
  suggestFilename: suggestFilename,
  formatTime: formatTime,
  formatDate: formatDate,
  collectTerms: collectTerms
};
