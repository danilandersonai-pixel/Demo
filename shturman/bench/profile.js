'use strict';

/**
 * Атрибуция тормозов: кто именно съедает главный поток.
 *
 * PerformanceObserver говорит «задача заняла 140 мс», но не говорит, чья
 * она. Здесь каждая подозреваемая операция замеряется отдельно, прямо на
 * живой странице с настоящим объёмом данных, — и становится видно, куда
 * уходит время. Это и есть список виновных для PERF.md.
 *
 *   node bench/profile.js [--quick]
 */

var path = require('path');
var { spawn } = require('child_process');

var fixture = require('./fixture');
var M = require('./measure');
var { launch, sleep, killAll } = require('../tests/manual/cdp');

var ROOT = path.resolve(__dirname, '..');
var argv = process.argv.slice(2);
var QUICK = argv.indexOf('--quick') !== -1;
var val = function (f, d) { var i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };
var PORT = Number(val('--port', 4541));
var CDP = Number(val('--cdp', 9590));

var SIZE = QUICK
  ? { files: 1000, events: 2000, bigDiffLines: 2000, bigFileKb: 400 }
  : { files: 5000, events: 10000, bigDiffLines: 4000, bigFileKb: 900 };

function say(s) { process.stdout.write(s + '\n'); }
function row(name, ms, note) {
  say('  ' + String(ms).padStart(8) + ' мс   ' + name + (note ? '\n              ' + note : ''));
}

/**
 * Замер одной операции: прогоняем N раз и берём медиану — одиночный замер
 * ловит случайную паузу сборщика мусора и врёт в разы.
 */
function timed(expr, runs) {
  return `(function () {
    var times = [];
    for (var r = 0; r < ${runs || 5}; r++) {
      var t = performance.now();
      ${expr}
      times.push(performance.now() - t);
    }
    times.sort(function (a, b) { return a - b; });
    return Math.round(times[Math.floor(times.length / 2)] * 100) / 100;
  })()`;
}

(async function main() {
  say('\n  АТРИБУЦИЯ ТОРМОЗОВ\n  ' + '─'.repeat(66));
  var fx = fixture.build(SIZE);
  say('  стенд: ' + fx.files + ' файлов, ' + fx.events + ' событий');

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
  await sleep(6000);

  var b = await launch({ cdpPort: CDP, width: 1500, height: 950 });
  await b.metrics(1500, 950, false);
  await b.goto('http://127.0.0.1:' + PORT + '/', 0);
  for (var i = 0; i < 200; i++) {
    if (await b.eval(`document.querySelectorAll('.ev').length > 0`).catch(function () { return false; })) break;
    await sleep(100);
  }
  await b.eval(`var w=document.querySelector('.tour--welcome .btn--primary'); if(w) w.click()`);
  await sleep(300);
  await b.eval(`var t=document.getElementById('tourSkip'); if(t) t.click()`);
  await sleep(1500);

  var dom = await b.json(M.DOM);
  say('  узлов в разметке: ' + dom.total + ' (дерево ' + dom.mapNodes + ', лента ' + dom.feedRows + ')\n');

  var results = {};

  // 1. Клик по папке — САМЫЙ ПЕРВЫЙ замер, и это не прихоть порядка.
  //    Ниже есть замеры, которые подменяют innerHTML, а подмена innerHTML
  //    убивает обработчики событий на строках дерева. Если мерить клик
  //    после них, клик просто ничего не делает и «стоит» 0.1 мс — ровно на
  //    эти грабли я и наступил, получив красивую и неверную цифру.
  results.collapseClick = await b.eval(`(function () {
    // Сворачиваем и тут же разворачиваем ОДНУ и ту же папку: разворот
    // возвращает дерево в полный размер, и именно он показывает цену
    // перерисовки. Медиану здесь брать нельзя — свёрнутое дерево меньше,
    // и она замаскировала бы как раз тот клик, который человек и ждёт.
    var dir = document.querySelector('.node--dir');
    if (!dir) return null;
    var worst = 0;
    for (var r = 0; r < 3; r++) {
      var t = performance.now();
      dir.click();                                   // свернуть
      worst = Math.max(worst, performance.now() - t);
      dir = document.querySelector('.node--dir');
      t = performance.now();
      dir.click();                                   // развернуть обратно
      worst = Math.max(worst, performance.now() - t);
      dir = document.querySelector('.node--dir');
    }
    return Math.round(worst * 100) / 100;
  })()`);
  row('клик по папке → renderTree() целиком', results.collapseClick,
    'настоящий вызов, а не оценка: столько человек ждёт после одного клика');


  // 2. Тепловая подсветка — то, что крутится раз в секунду И на каждое
  //    файловое событие. Повторяем ровно её работу.
  results.applyHeat = await b.eval(timed(`
    var now = Date.now();
    Array.prototype.forEach.call(document.querySelectorAll('.node'), function (r) {
      var v = 0.5;
      r.style.setProperty('--heat', v.toFixed(3));
      r.classList.toggle('is-hot', v > 0.45);
    });
  `, 7));
  row('обход дерева ради тепловой подсветки', results.applyHeat,
    'делается раз в секунду и вдобавок на каждое файловое событие');

  // 3. Полная перерисовка дерева — на каждый сворачивающий клик и перезагрузку.
  results.renderTree = await b.eval(timed(`
    var box = document.getElementById('treeBox') || document.querySelector('.tree');
    if (box) { var html = box.innerHTML; box.innerHTML = ''; box.innerHTML = html; }
  `, 5));
  row('перерисовка дерева файлов целиком', results.renderTree,
    'нижняя оценка: перестановка готовой разметки без построения узлов');

  // 4. Фильтрация всех событий — делается на каждое пришедшее событие.
  results.filterAll = await b.eval(timed(`
    var src = [];
    for (var i = 0; i < 1500; i++) src.push({ kind: 'tool', action: 'run', level: 'info', title: 'x' + i });
    src.filter(function (e) { return e.kind !== 'result'; });
  `, 9));
  row('фильтрация буфера событий (1500 шт.)', results.filterAll,
    'выполняется заново на каждое пришедшее событие');

  // 5. Чтение геометрии, вызывающее принудительную раскладку.
  results.layout = await b.eval(timed(`
    var box = document.getElementById('feedScroll');
    if (box) { box.scrollTop = box.scrollTop; var x = box.scrollHeight + box.clientHeight; void x; }
  `, 9));
  row('чтение scrollHeight (принудительная раскладка)', results.layout,
    'на каждое событие делается трижды: renderWindow → scrollToBottom → renderWindow');

  // 6. Стоимость одного кадра ленты.
  results.drawRows = await b.eval(timed(`
    var feed = document.getElementById('feed');
    if (feed) { var html = feed.innerHTML; feed.innerHTML = ''; feed.innerHTML = html; }
  `, 7));
  row('перерисовка видимого окна ленты', results.drawRows);

  // 7. Сколько весит стартовый снимок. Промис надо дождаться ДО
  //    сериализации, иначе в отчёт попадёт пустой объект.
  results.stateBytes = await b.eval(`fetch('/api/state')
    .then(function (r) { return r.text(); }).then(function (t) { return t.length; })`);
  // Читаем поток, пока не соберётся целиком первый кадр «snapshot»: один
  // reader.read() отдаёт случайный кусок сети, и мерить по нему размер
  // снимка — значит мерить размер TCP-пакета.
  var stream = await b.eval(`(function () {
    var t0 = performance.now();
    return fetch('/api/stream?probe=1').then(function (r) {
      var reader = r.body.getReader();
      var text = '', bytes = 0;
      var dec = new TextDecoder();
      return (function pull() {
        return reader.read().then(function (c) {
          if (c.done) return finish();
          bytes += c.value.length;
          text += dec.decode(c.value, { stream: true });
          // Разделитель кадра ищем ТОЛЬКО после заголовка снимка: до него
          // сервер успевает прислать служебный кадр, и его «пустая строка»
          // обрывала замер на четвёртом килобайте.
          var head = text.indexOf('event: snapshot');
          if (head !== -1 && text.indexOf(String.fromCharCode(10,10), head) !== -1) return finish();
          return pull();
        });
      })();
      function finish() {
        reader.cancel();
        return JSON.stringify({ bytes: bytes, ms: Math.round(performance.now() - t0) });
      }
    });
  })()`);
  stream = JSON.parse(stream);
  results.snapshotFirstChunk = stream.bytes;
  say('');
  row('стартовый снимок в потоке, КБ', Math.round(stream.bytes / 1024),
    'собрался за ' + stream.ms + ' мс — это и есть ожидание первой ленты');
  row('размер /api/state, КБ', Math.round(results.stateBytes / 1024));

  say('\n  ' + '─'.repeat(66));
  var ranked = [
    ['обход дерева ради подсветки', results.applyHeat, 'раз в секунду + на каждое файловое событие'],
    ['перерисовка дерева целиком (клик по папке)', results.collapseClick || results.renderTree, 'на каждый клик по папке'],
    ['принудительная раскладка', results.layout, '×3 на каждое событие'],
    ['перерисовка окна ленты', results.drawRows, 'на каждое событие'],
    ['фильтрация буфера', results.filterAll, 'на каждое событие']
  ].sort(function (a, b) { return b[1] - a[1]; });
  say('  ПО ВКЛАДУ В ТОРМОЗА:');
  ranked.forEach(function (r, i) {
    say('  ' + (i + 1) + '. ' + r[0] + ' — ' + r[1] + ' мс, ' + r[2]);
  });
  say('');

  await b.close();
  killAll();
  try { process.kill(-srv.pid); } catch (e) { try { srv.kill(); } catch (e2) { /* мёртв */ } }
  fixture.cleanup(fx);

  var jsonPath = val('--json', null);
  if (jsonPath) require('fs').writeFileSync(jsonPath, JSON.stringify({ dom: dom, results: results }, null, 2));
})().catch(function (e) {
  say('СБОЙ: ' + (e && e.message));
  killAll();
  process.exit(1);
});
