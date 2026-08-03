'use strict';

/**
 * Замеры. Всё, что можно померить числом, меряется здесь — и одинаково
 * до и после правок, иначе сравнение бессмысленно.
 *
 * Принцип: ни одного показателя «на глаз». Кадры считает сама страница,
 * длинные задачи — PerformanceObserver, задержку события — метка в
 * транскрипте, процессор сервера — /proc, память — счётчик кучи вкладки.
 */

var fs = require('fs');

// ─── процессор сервера ──────────────────────────────────────────────────────

var CLK = 100; // тиков в секунду в /proc — стандарт для Linux

/** Суммарное процессорное время процесса в миллисекундах. */
function cpuMs(pid) {
  try {
    var stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    // Имя процесса в скобках может содержать пробелы — режем по последней «)».
    var tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    var utime = Number(tail[11]);
    var stime = Number(tail[12]);
    return (utime + stime) * (1000 / CLK);
  } catch (e) { return null; }
}

/** Память процесса, МБ. */
function rssMb(pid) {
  try {
    var status = fs.readFileSync('/proc/' + pid + '/status', 'utf8');
    var m = /VmRSS:\s+(\d+) kB/.exec(status);
    return m ? Math.round(Number(m[1]) / 1024 * 10) / 10 : null;
  } catch (e) { return null; }
}

/** Доля процессора за окно наблюдения, в процентах одного ядра. */
async function cpuPercent(pid, ms, sleep) {
  var a = cpuMs(pid);
  if (a === null) return null;
  await sleep(ms);
  var b = cpuMs(pid);
  if (b === null) return null;
  return Math.round((b - a) / ms * 1000) / 10;
}

// ─── страница: счётчики, которые ставятся один раз ──────────────────────────

/**
 * Код, который вживляется в страницу. Считает кадры, копит длинные задачи
 * и ловит появление меток стенда в разметке.
 *
 * MutationObserver вместо опроса: он замечает вставку узла в тот же кадр,
 * а опрос раз в 50 мс добавил бы к каждому замеру собственную погрешность
 * в те же 50 мс — сравнимую с тем, что мы измеряем.
 */
var PROBE = `(function () {
  if (window.__bench) return 'уже стоит';
  var B = { frames: 0, long: [], marks: {}, started: performance.now() };
  window.__bench = B;

  (function tick() { B.frames++; requestAnimationFrame(tick); })();

  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        B.long.push({ ms: Math.round(e.duration), at: Math.round(e.startTime) });
        if (B.long.length > 400) B.long.shift();
      });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { B.noLongtask = true; }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    var text = node.textContent || '';
    var i = text.indexOf('BENCHMARK-');
    if (i === -1) return;
    var m = /BENCHMARK-(\\d+)-(\\d+)/.exec(text);
    if (!m) return;
    if (B.marks[m[1]] !== undefined) return;
    B.marks[m[1]] = Date.now() - Number(m[2]);
  }

  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        scan(added[j]);
        if (added[j].querySelectorAll) {
          var kids = added[j].querySelectorAll('*');
          for (var k = 0; k < kids.length; k++) scan(kids[k]);
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  return 'поставлено';
})()`;

/** Сбросить счётчик кадров и начать новое окно наблюдения. */
var RESET = `(function () {
  var B = window.__bench; if (!B) return false;
  B.frames = 0; B.long = []; B.windowStart = performance.now(); return true;
})()`;

/** Снять показания окна наблюдения. */
var READ = `(function () {
  var B = window.__bench; if (!B) return null;
  var secs = (performance.now() - (B.windowStart || B.started)) / 1000;
  var longest = B.long.reduce(function (a, e) { return Math.max(a, e.ms); }, 0);
  var over50 = B.long.filter(function (e) { return e.ms > 50; }).length;
  var total = B.long.reduce(function (a, e) { return a + e.ms; }, 0);
  return {
    fps: Math.round(B.frames / secs * 10) / 10,
    seconds: Math.round(secs * 10) / 10,
    longest: longest,
    over50: over50,
    blockedMs: total,
    tasks: B.long.length
  };
})()`;

/** Задержки «событие записано → показано», по меткам. */
var MARKS = `(function () {
  var B = window.__bench; if (!B) return [];
  return Object.keys(B.marks).map(function (k) { return B.marks[k]; });
})()`;

/** Узлы разметки: всего и по разделам. */
var DOM = `(function () {
  var count = function (sel) {
    var n = document.querySelector(sel);
    return n ? n.getElementsByTagName('*').length : 0;
  };
  return {
    total: document.getElementsByTagName('*').length,
    feed: count('.panel[data-view="feed"]'),
    feedRows: document.querySelectorAll('.ev').length,
    map: count('.panel[data-view="map"]'),
    mapNodes: document.querySelectorAll('.node').length,
    git: count('.panel[data-view="git"]'),
    pulse: count('.panel[data-view="pulse"]')
  };
})()`;

/** Куча вкладки, МБ. */
var HEAP = `(performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null)`;

/** Разложить прокрутку на кадры и померить, не проседает ли она. */
function scrollScript(px, steps) {
  return `(function () {
    var box = document.getElementById('feedScroll');
    if (!box) return Promise.resolve(false);
    var step = ${px} / ${steps};
    return new Promise(function (done) {
      var i = 0;
      (function next() {
        if (i++ >= ${steps}) return done(true);
        box.scrollTop -= step;
        requestAnimationFrame(next);
      })();
    });
  })()`;
}

/** Среднее и максимум по списку, с защитой от пустоты. */
function stat(list) {
  if (!list || !list.length) return { n: 0, avg: null, max: null, p95: null };
  var sorted = list.slice().sort(function (a, b) { return a - b; });
  var sum = sorted.reduce(function (a, b) { return a + b; }, 0);
  return {
    n: sorted.length,
    avg: Math.round(sum / sorted.length),
    max: sorted[sorted.length - 1],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  };
}

module.exports = {
  cpuMs: cpuMs,
  rssMb: rssMb,
  cpuPercent: cpuPercent,
  PROBE: PROBE,
  RESET: RESET,
  READ: READ,
  MARKS: MARKS,
  DOM: DOM,
  HEAP: HEAP,
  scrollScript: scrollScript,
  stat: stat
};
