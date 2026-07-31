'use strict';

var fs = require('fs');
var path = require('path');
var paths = require('./paths');
var debounce = require('./debounce');

/**
 * Рекурсивный вотчер файловой системы без обязательных зависимостей.
 *
 * Если рядом установлен chokidar — используем его (он аккуратнее на macOS).
 * Иначе — свой обходной механизм: fs.watch (нерекурсивный — он работает
 * на всех ОС и версиях Node ≥ 18) на каждый каталог; новые каталоги
 * подхватываются на лету, удалённые — забываются.
 *
 * События идут через дебаунс: onChanges([{file, kind}]) не чаще, чем раз
 * в waitMs тишины.
 */

var MAX_WATCHED_DIRS = 2000;

function createWatcher(root, onChanges, opts) {
  opts = opts || {};
  var waitMs = opts.debounceMs || 300;
  var rootAbs = path.resolve(root);
  var d = debounce.createDebouncer(waitMs, function (items) {
    // схлопываем дубли по файлу, последнее событие побеждает
    var byFile = {};
    for (var i = 0; i < items.length; i++) byFile[items[i].file] = items[i];
    var unique = Object.keys(byFile).map(function (k) { return byFile[k]; });
    onChanges(unique);
  });

  var chokidar = null;
  if (!opts.forceFallback) {
    try { chokidar = require('chokidar'); } catch (e) { /* нет и не надо */ }
  }

  if (chokidar) {
    var ch = chokidar.watch(rootAbs, {
      ignored: function (p) { return paths.isIgnored(path.relative(rootAbs, p)); },
      ignoreInitial: true,
      persistent: true
    });
    ch.on('all', function (event, p) {
      var rel = paths.relToProject(rootAbs, p);
      d.push({ file: rel, kind: event });
    });
    return {
      engine: 'chokidar',
      stop: function () { ch.close(); d.cancel(); }
    };
  }

  /* --------- собственный обход --------- */
  var watchers = {};   // absDir → FSWatcher
  var stopped = false;

  function watchDir(absDir) {
    if (stopped || watchers[absDir]) return;
    if (Object.keys(watchers).length >= MAX_WATCHED_DIRS) return;
    var rel = path.relative(rootAbs, absDir);
    if (rel && paths.isIgnored(rel)) return;
    var w;
    try {
      w = fs.watch(absDir, function (eventType, fileName) {
        handleRawEvent(absDir, fileName);
      });
    } catch (e) {
      return; // каталог исчез или нет прав — переживём
    }
    w.on('error', function () { unwatchDir(absDir); });
    if (w.unref) w.unref();
    watchers[absDir] = w;

    // и все подкаталоги
    var items;
    try {
      items = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (var i = 0; i < items.length; i++) {
      if (items[i].isDirectory()) {
        watchDir(path.join(absDir, items[i].name));
      }
    }
  }

  function unwatchDir(absDir) {
    var w = watchers[absDir];
    if (w) {
      try { w.close(); } catch (e) { /* ок */ }
      delete watchers[absDir];
    }
    // дочерние тоже
    var prefix = absDir + path.sep;
    Object.keys(watchers).forEach(function (dir) {
      if (dir.indexOf(prefix) === 0) {
        try { watchers[dir].close(); } catch (e) { /* ок */ }
        delete watchers[dir];
      }
    });
  }

  function handleRawEvent(absDir, fileName) {
    if (stopped) return;
    if (!fileName) fileName = '';
    var absTarget = path.join(absDir, fileName);
    var rel = path.relative(rootAbs, absTarget);
    if (paths.isIgnored(rel)) return;

    var kind = 'change';
    try {
      var st = fs.statSync(absTarget);
      if (st.isDirectory()) {
        // появился новый каталог — начинаем следить и за ним
        watchDir(absTarget);
        kind = 'addDir';
      }
    } catch (e) {
      kind = 'unlink';
      if (watchers[absTarget]) unwatchDir(absTarget);
    }
    d.push({ file: paths.toDisplay(rel), kind: kind });
  }

  watchDir(rootAbs);

  return {
    engine: 'builtin',
    watchedDirs: function () { return Object.keys(watchers).length; },
    stop: function () {
      stopped = true;
      Object.keys(watchers).forEach(function (dir) {
        try { watchers[dir].close(); } catch (e) { /* ок */ }
      });
      watchers = {};
      d.cancel();
    }
  };
}

module.exports = { createWatcher: createWatcher };
