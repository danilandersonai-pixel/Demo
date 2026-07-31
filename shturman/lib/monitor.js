'use strict';

var fs = require('fs');
var path = require('path');

var paths = require('./paths');
var git = require('./git');
var pulseMod = require('./pulse');
var watcherMod = require('./watcher');
var transcript = require('./transcript');
var humanize = require('./humanize');

/**
 * Монитор одного проекта: вотчер файловой системы, git-опрос, хвост
 * транскриптов Claude Code, пульс с детектором остановки и тепловой след.
 * Сервер может держать несколько мониторов — по одному на наблюдаемую папку
 * (бонус «переключатель проектов»).
 *
 * createMonitor(root, callbacks):
 *   callbacks.onFeed(item)            — карточка для ленты (уже по-русски)
 *   callbacks.onTransient(type, data) — состояние (fs | git | pulse)
 *   callbacks.onBroadcast(type, data) — событие с историей (session | level)
 */
function createMonitor(root, callbacks) {
  var PROJECT = path.resolve(root);
  var onFeed = callbacks.onFeed || function () {};
  var onTransient = callbacks.onTransient || function () {};
  var onBroadcast = callbacks.onBroadcast || function () {};

  var recentFileChanges = {};   // rel → {mtimeMs, kind} — тепловой след карты
  var lastGit = null;
  var lastGitKey = '';
  var prevBranch = null;
  var prevHead = null;
  var timers = [];

  var pulse = pulseMod.createPulse(function (event) {
    pushEvent(event);
  }, {
    // Edit присылает абсолютный путь, вотчер — относительный: приводим к
    // одному виду, чтобы «файлов затронуто» не считало файл дважды
    normalizePath: function (p) {
      return paths.relToProject(PROJECT, path.isAbsolute(p) ? p : path.join(PROJECT, p));
    }
  });

  /** Нормализованное событие → humanize → лента. */
  function pushEvent(event) {
    var card = humanize.humanizeEvent(event, PROJECT);
    if (!card) return; // usage и прочее, что не показываем строкой
    onFeed({
      ts: event.ts || new Date().toISOString(),
      kind: event.kind,
      icon: card.icon,
      title: card.title,
      category: card.category,
      tool: event.tool || null,
      input: event.input || null,
      output: event.output != null ? event.output : null,
      isError: !!event.isError,
      files: event.files || null,
      reason: event.reason || null,
      raw: event.raw || null
    });
  }

  /* --------------------------- Вотчер ФС --------------------------- */

  var watcher = watcherMod.createWatcher(PROJECT, function (changes) {
    var files = changes.map(function (c) { return c.file; }).filter(Boolean);
    if (!files.length) return;
    var now = Date.now();
    changes.forEach(function (c) {
      if (c.file) recentFileChanges[c.file] = { mtimeMs: now, kind: c.kind };
    });
    // след старше 10 минут выбрасываем, чтобы не рос без конца
    Object.keys(recentFileChanges).forEach(function (k) {
      if (now - recentFileChanges[k].mtimeMs > 600000) delete recentFileChanges[k];
    });
    pulse.feedFileChanges(files);
    pushEvent({ kind: 'file-change', ts: new Date().toISOString(), files: files });
    onTransient('fs', { files: files });
  });

  /* --------------------------- Git-опрос --------------------------- */

  function describeGitChange(info) {
    var msgs = [];
    if (info.branch && prevBranch && info.branch !== prevBranch) {
      msgs.push('Переключилась ветка: теперь «' + info.branch + '»');
    }
    var head = info.commits.length ? info.commits[0] : null;
    if (head && prevHead && head.hash !== prevHead) {
      msgs.push('Появился новый коммит: «' + head.subject + '»');
    }
    prevBranch = info.branch;
    prevHead = head ? head.hash : prevHead;
    if (!msgs.length) return null;
    return msgs.join('. ');
  }

  function pollGit() {
    git.collectGitInfo(PROJECT).then(function (info) {
      lastGit = info;
      var key = JSON.stringify([
        info.branch,
        info.status ? info.status.total : -1,
        info.commits.length ? info.commits[0].hash : ''
      ]);
      if (lastGitKey === '') {
        // первый опрос: запоминаем точку отсчёта, чтобы первый же коммит
        // или смена ветки дали карточку в ленте
        prevBranch = info.branch;
        prevHead = info.commits.length ? info.commits[0].hash : null;
      } else if (key !== lastGitKey) {
        var text = describeGitChange(info);
        if (text) pushEvent({ kind: 'git-change', ts: new Date().toISOString(), text: text });
        onTransient('git', publicGit(info));
      }
      lastGitKey = key;
    });
  }

  function publicGit(info) {
    if (!info) return null;
    return {
      available: info.available,
      isRepo: info.isRepo,
      branch: info.branch,
      branchMeaning: info.branchMeaning,
      status: info.status,
      commits: info.commits,
      diffstat: info.diffstat,
      error: info.error
    };
  }

  var gitTimer = setInterval(pollGit, 4000);
  if (gitTimer.unref) gitTimer.unref();
  timers.push(gitTimer);
  pollGit();

  /* ---------------------- Транскрипт (уровень A) -------------------- */

  var transcriptDir = transcript.findTranscriptDir(PROJECT);
  var level = transcriptDir ? 'A' : 'B';
  var tailer = null;

  function startTailer(dir) {
    tailer = transcript.createTailer(dir, {
      onEvents: function (events) {
        for (var i = 0; i < events.length; i++) {
          pulse.feed(events[i]);
          pushEvent(events[i]);
        }
        onTransient('pulse', pulse.snapshot());
      },
      onSwitch: function (sessionId) {
        pulse.resetSession();
        pushEvent({ kind: 'session-switch', ts: new Date().toISOString() });
        onBroadcast('session', { id: sessionId });
      }
    });
    tailer.start();
  }

  if (transcriptDir) {
    startTailer(transcriptDir);
  } else {
    // Каталог транскриптов может появиться позже (человек запустит Claude
    // Code после «Штурмана») — проверяем раз в 10 секунд.
    var findTimer = setInterval(function () {
      var dir = transcript.findTranscriptDir(PROJECT);
      if (!dir) return;
      clearInterval(findTimer);
      transcriptDir = dir;
      level = 'A';
      onBroadcast('level', { level: 'A' });
      startTailer(dir);
    }, 10000);
    if (findTimer.unref) findTimer.unref();
    timers.push(findTimer);
  }

  /* Детектор остановки + периодический пульс */
  var pulseTimer = setInterval(function () {
    pulse.check();
    onTransient('pulse', pulse.snapshot());
  }, 3000);
  if (pulseTimer.unref) pulseTimer.unref();
  timers.push(pulseTimer);

  /** Похожа ли папка на проект (для мягкого сообщения при первом запуске). */
  function looksLikeProject() {
    var markers = ['package.json', '.git', 'README.md', 'readme.md', 'pyproject.toml',
      'Cargo.toml', 'go.mod', 'index.html', 'src'];
    for (var i = 0; i < markers.length; i++) {
      try {
        fs.statSync(path.join(PROJECT, markers[i]));
        return true;
      } catch (e) { /* нет — смотрим дальше */ }
    }
    return false;
  }

  return {
    id: paths.encodeProjectDir(PROJECT),
    root: PROJECT,
    name: path.basename(PROJECT),
    pulse: pulse,
    watcherEngine: watcher.engine,
    looksLikeProject: looksLikeProject,
    publicGit: function () { return publicGit(lastGit); },
    refreshGit: function () {
      return git.collectGitInfo(PROJECT).then(function (info) {
        lastGit = info;
        return publicGit(info);
      });
    },
    lastGitInfo: function () { return lastGit; },
    recent: function () { return recentFileChanges; },
    level: function () { return level; },
    transcriptDir: function () { return transcriptDir; },
    activeSession: function () { return tailer ? tailer.currentSession() : null; },
    stop: function () {
      watcher.stop();
      if (tailer) tailer.stop();
      timers.forEach(function (t) { clearInterval(t); });
    }
  };
}

module.exports = { createMonitor: createMonitor };
