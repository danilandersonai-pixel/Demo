'use strict';

/**
 * Прогон стенда: собирает нагрузку, поднимает сервер, водит браузер и
 * печатает отчёт.
 *
 *   npm run bench                  # полный прогон
 *   npm run bench -- --quick       # облегчённый: 2000 событий, 1000 файлов
 *   npm run bench -- --json out.json
 *   npm run bench -- --keep        # не удалять стенд (для ручного тыка)
 *
 * Порядок замеров важен: сначала холодный старт (его нельзя померить
 * дважды на одной вкладке), потом покой, потом шторм, потом прокрутка,
 * потом долгое наблюдение за памятью. Перемешаешь — получишь цифры,
 * загрязнённые предыдущим шагом.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var { spawn } = require('child_process');

var fixture = require('./fixture');
var M = require('./measure');
var { launch, sleep, killAll } = require('../tests/manual/cdp');

var ROOT = path.resolve(__dirname, '..');
var argv = process.argv.slice(2);
var has = function (f) { return argv.indexOf(f) !== -1; };
var valOf = function (f, d) { var i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };

var QUICK = has('--quick');
var PORT = Number(valOf('--port', 4531));
var CDP = Number(valOf('--cdp', 9580));
var STORM_SECONDS = Number(valOf('--storm', QUICK ? 10 : 20));
var SOAK_SECONDS = Number(valOf('--soak', QUICK ? 30 : 120));
var RATE = Number(valOf('--rate', 20));   // событий в секунду

var SIZE = QUICK
  ? { files: 1000, events: 2000, bigDiffLines: 2000, bigFileKb: 400 }
  : { files: 5000, events: 10000, bigDiffLines: 4000, bigFileKb: 900 };

var out = { at: new Date().toISOString(), quick: QUICK, size: SIZE, steps: {} };

function say(s) { process.stdout.write(s + '\n'); }
function head(s) { say('\n  ' + s + '\n  ' + '─'.repeat(66)); }
function row(name, value) { say('  ' + name.padEnd(42) + String(value)); }

async function main() {
  head('СТЕНД');
  var t0 = Date.now();
  var fx = fixture.build(SIZE);
  out.fixture = {
    files: fx.files, events: fx.events,
    transcriptMb: Math.round(fx.transcriptBytes / 1048576 * 10) / 10,
    buildMs: Date.now() - t0
  };
  row('файлов в проекте', fx.files);
  row('событий в транскрипте', fx.events);
  row('размер транскрипта', out.fixture.transcriptMb + ' МБ');
  row('собран за', (out.fixture.buildMs / 1000).toFixed(1) + ' с');
  row('папка стенда', fx.project);

  // ─── сервер ───────────────────────────────────────────────────────────
  head('СТАРТ СЕРВЕРА');
  var startedAt = Date.now();
  var srv = spawn(process.execPath,
    [path.join(ROOT, 'server.js'), '--project', fx.project, '--port', String(PORT),
      '--quiet', '--no-open', '--force-new'],
    {
      cwd: ROOT, detached: true, stdio: 'ignore',
      env: Object.assign({}, process.env, {
        HOME: fx.home, CLAUDE_CONFIG_DIR: path.join(fx.home, '.claude')
      })
    });
  srv.unref();

  var up = false;
  for (var i = 0; i < 120 && !up; i++) {
    await sleep(250);
    up = await ping(PORT);
  }
  if (!up) throw new Error('сервер не поднялся за 30 с');
  out.steps.serverBootMs = Date.now() - startedAt;
  row('сервер отвечает через', out.steps.serverBootMs + ' мс');

  // Дать вотчеру и хвостовику дочитать стартовую историю.
  await sleep(4000);
  out.steps.serverRssAfterBootMb = M.rssMb(srv.pid);
  row('память сервера после старта', out.steps.serverRssAfterBootMb + ' МБ');

  head('ПОКОЙ: НАГРУЗКА СЕРВЕРА БЕЗ КЛИЕНТА');
  out.steps.cpuIdleNoClient = await M.cpuPercent(srv.pid, 8000, sleep);
  row('процессор сервера, покой, без панели', out.steps.cpuIdleNoClient + ' %');

  // ─── браузер ──────────────────────────────────────────────────────────
  head('ХОЛОДНЫЙ СТАРТ ПАНЕЛИ');
  var b = await launch({ cdpPort: CDP, width: 1500, height: 950 });
  b.waitFor = async function (expr, t) {
    var d = Date.now() + (t || 30000);
    for (;;) {
      var v = false;
      try { v = await b.eval(expr); } catch (e) { /* страница ещё грузится */ }
      if (v) return true;
      if (Date.now() > d) return false;
      await sleep(50);
    }
  };
  await b.metrics(1500, 950, false);

  var navAt = Date.now();
  await b.goto('http://127.0.0.1:' + PORT + '/', 0);
  var gotShell = await b.waitFor(`!!document.getElementById('head')`, 30000);
  out.steps.firstScreenMs = gotShell ? Date.now() - navAt : null;
  var gotFeed = await b.waitFor(`document.querySelectorAll('.ev').length > 0`, 45000);
  out.steps.firstFeedMs = gotFeed ? Date.now() - navAt : null;
  row('до первого экрана', out.steps.firstScreenMs + ' мс');
  row('до первой отрисованной ленты', out.steps.firstFeedMs + ' мс');

  await b.eval(M.PROBE);
  // Убираем приветствие и тур: они не часть замера.
  await b.eval(`var w=document.querySelector('.tour--welcome .btn--primary'); if(w) w.click()`);
  await sleep(300);
  await b.eval(`var t=document.getElementById('tourSkip'); if(t) t.click()`);
  await sleep(1200);

  out.steps.domAfterLoad = await b.json(M.DOM);
  out.steps.heapAfterLoadMb = await b.eval(M.HEAP);
  row('узлов DOM всего', out.steps.domAfterLoad.total);
  row('  из них карточек ленты', out.steps.domAfterLoad.feedRows);
  row('  из них узлов дерева файлов', out.steps.domAfterLoad.mapNodes);
  row('куча вкладки', out.steps.heapAfterLoadMb + ' МБ');

  // ─── покой с открытой панелью ────────────────────────────────────────
  head('ПОКОЙ С ОТКРЫТОЙ ПАНЕЛЬЮ');
  await b.eval(M.RESET);
  var cpuIdle = M.cpuPercent(srv.pid, 8000, sleep);
  await sleep(8200);
  out.steps.idle = await b.json(M.READ);
  out.steps.cpuIdleWithClient = await cpuIdle;
  row('кадров в секунду в покое', out.steps.idle.fps);
  row('самая долгая задача, покой', out.steps.idle.longest + ' мс');
  row('процессор сервера, панель открыта', out.steps.cpuIdleWithClient + ' %');

  // ─── шторм ───────────────────────────────────────────────────────────
  head('ШТОРМ: ' + RATE + ' СОБЫТИЙ В СЕКУНДУ, ' + STORM_SECONDS + ' С');
  await b.eval(M.RESET);
  var cpuStorm = M.cpuPercent(srv.pid, STORM_SECONDS * 1000, sleep);
  var seq = 0;
  var stormStart = Date.now();
  while (Date.now() - stormStart < STORM_SECONDS * 1000) {
    // Каждое пятое событие — с меткой: по ним считается задержка.
    if (seq % 5 === 0) fixture.appendMarked(fx, seq);
    else fixture.appendNoise(fx, seq);
    seq++;
    await sleep(Math.max(0, Math.round(1000 / RATE)));
  }
  out.steps.stormEvents = seq;
  await sleep(2500);           // дать долететь хвосту
  out.steps.storm = await b.json(M.READ);
  out.steps.cpuStorm = await cpuStorm;
  var lat = await b.json(M.MARKS);
  out.steps.latency = M.stat(lat);
  out.steps.domAfterStorm = await b.json(M.DOM);
  out.steps.heapAfterStormMb = await b.eval(M.HEAP);
  row('кадров в секунду под штормом', out.steps.storm.fps);
  row('самая долгая задача', out.steps.storm.longest + ' мс');
  row('задач дольше 50 мс', out.steps.storm.over50);
  row('главный поток занят', out.steps.storm.blockedMs + ' мс за ' + out.steps.storm.seconds + ' с');
  row('задержка события: среднее', out.steps.latency.avg + ' мс');
  row('задержка события: 95-я доля', out.steps.latency.p95 + ' мс');
  row('задержка события: максимум', out.steps.latency.max + ' мс');
  row('меток долетело', out.steps.latency.n + ' из ' + Math.ceil(seq / 5));
  row('узлов DOM после шторма', out.steps.domAfterStorm.total);
  row('  карточек ленты', out.steps.domAfterStorm.feedRows);
  row('процессор сервера под штормом', out.steps.cpuStorm + ' %');

  // ─── прокрутка ───────────────────────────────────────────────────────
  head('ПРОКРУТКА ЛЕНТЫ');
  await b.eval(M.RESET);
  await b.eval(M.scrollScript(20000, 180));
  await sleep(300);
  out.steps.scroll = await b.json(M.READ);
  out.steps.domAfterScroll = await b.json(M.DOM);
  row('кадров в секунду при прокрутке', out.steps.scroll.fps);
  row('самая долгая задача', out.steps.scroll.longest + ' мс');
  row('задач дольше 50 мс', out.steps.scroll.over50);
  row('карточек в разметке после прокрутки', out.steps.domAfterScroll.feedRows);

  // ─── вкладки ─────────────────────────────────────────────────────────
  head('ПЕРЕКЛЮЧЕНИЕ РАЗДЕЛОВ');
  var tabs = {};
  for (var t of ['map', 'git', 'pulse', 'feed']) {
    var at = Date.now();
    await b.eval(`(function(){var el=[...document.querySelectorAll('.tab')].find(x=>x.dataset.tab==='${t}');
      if(el) el.click(); else document.body.dataset.view='${t}';})()`);
    await sleep(700);
    tabs[t] = { ms: Date.now() - at - 700, dom: await b.json(M.DOM) };
  }
  out.steps.tabs = tabs;
  Object.keys(tabs).forEach(function (k) {
    row('раздел ' + k + ': узлов', tabs[k].dom.total);
  });

  // ─── долгое наблюдение ───────────────────────────────────────────────
  head('ДОЛГОЕ НАБЛЮДЕНИЕ: ' + SOAK_SECONDS + ' С ПОТОКА');
  var heapBefore = await b.eval(M.HEAP);
  var soakStart = Date.now();
  var soakSeq = 100000;
  while (Date.now() - soakStart < SOAK_SECONDS * 1000) {
    fixture.appendNoise(fx, soakSeq++);
    await sleep(Math.max(0, Math.round(1000 / RATE)));
  }
  await sleep(2000);
  await b.eval(`(window.gc && window.gc())`).catch(function () {});
  var heapAfter = await b.eval(M.HEAP);
  out.steps.soak = {
    seconds: SOAK_SECONDS, events: soakSeq - 100000,
    heapBeforeMb: heapBefore, heapAfterMb: heapAfter,
    growthMb: heapAfter !== null && heapBefore !== null
      ? Math.round((heapAfter - heapBefore) * 10) / 10 : null,
    perHourMb: heapAfter !== null && heapBefore !== null
      ? Math.round((heapAfter - heapBefore) * (3600 / SOAK_SECONDS) * 10) / 10 : null,
    serverRssMb: M.rssMb(srv.pid),
    dom: await b.json(M.DOM)
  };
  row('куча до / после', heapBefore + ' → ' + heapAfter + ' МБ');
  row('рост кучи', out.steps.soak.growthMb + ' МБ за ' + SOAK_SECONDS + ' с');
  row('в пересчёте на час', out.steps.soak.perHourMb + ' МБ');
  row('память сервера', out.steps.soak.serverRssMb + ' МБ');
  row('карточек ленты в разметке', out.steps.soak.dom.feedRows);

  // ─── итог ────────────────────────────────────────────────────────────
  out.budgets = checkBudgets(out);
  head('СВЕРКА С БЮДЖЕТАМИ');
  out.budgets.forEach(function (b2) {
    say('  ' + (b2.ok ? '✔' : '✖') + ' ' + b2.name.padEnd(44) +
      String(b2.value).padStart(8) + '   бюджет ' + b2.budget);
  });
  var bad = out.budgets.filter(function (x) { return !x.ok; });
  say('');
  say('  ' + (bad.length ? '✖ нарушено бюджетов: ' + bad.length : '✔ все бюджеты выполнены'));

  await b.close();
  killAll();
  try { process.kill(-srv.pid); } catch (e) { try { srv.kill(); } catch (e2) { /* уже мёртв */ } }

  var jsonPath = valOf('--json', null);
  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
    say('  замеры: ' + jsonPath);
  }
  if (!has('--keep')) fixture.cleanup(fx);
  else say('  стенд оставлен: ' + fx.project);

  process.exitCode = bad.length ? 1 : 0;
}

/**
 * Бюджеты. Числа — из этапа 0 задания; обоснование отклонений в DECISIONS.md.
 * Проверка живёт здесь, а не в тестах, чтобы прогон стенда сам говорил
 * «влезли / не влезли», без чтения таблиц.
 */
function checkBudgets(o) {
  var s = o.steps;
  var list = [
    ['первый экран', s.firstScreenMs, 1500, '< 1500 мс'],
    ['первая лента', s.firstFeedMs, 3000, '< 3000 мс'],
    ['самая долгая задача под штормом', s.storm && s.storm.longest, 50, '≤ 50 мс'],
    ['задержка события, 95-я доля', s.latency && s.latency.p95, 200, '< 200 мс'],
    ['карточек ленты в разметке', s.domAfterStorm && s.domAfterStorm.feedRows, 300, '< 300'],
    ['процессор сервера в покое', s.cpuIdleWithClient, 2, '< 2 %'],
    ['рост кучи в час', s.soak && s.soak.perHourMb, 50, '< 50 МБ'],
    ['кадров в секунду под штормом', s.storm && s.storm.fps, 50, '≥ 50', true],
    ['кадров в секунду при прокрутке', s.scroll && s.scroll.fps, 50, '≥ 50', true]
  ];
  return list.map(function (r) {
    var value = r[1];
    var ok = value === null || value === undefined ? false
      : (r[4] ? value >= r[2] : value <= r[2]);
    return { name: r[0], value: value, limit: r[2], budget: r[3], ok: ok };
  });
}

function ping(port) {
  return new Promise(function (resolve) {
    var req = require('http').get({ host: '127.0.0.1', port: port, path: '/api/state' },
      function (res) { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', function () { resolve(false); });
    req.setTimeout(1500, function () { req.destroy(); resolve(false); });
  });
}

main().catch(function (e) {
  say('\n  СБОЙ СТЕНДА: ' + (e && e.message));
  killAll();
  process.exit(1);
});
