// Движение и отзывчивость — то, чего не видно в исходниках.
//
//   node server.js --port 4517 --quiet --no-open &
//   node tests/manual/design-motion.js [url]
//
// Проверяем три обещания из DESIGN.md:
//   1. при «поменьше движения» ничего не двигается, но состояние читается;
//   2. анимируются только transform и opacity — иначе телефон роняет кадры;
//   3. длинная лента не подвешивает страницу и не мешает потоку событий.

const { launch, sleep, killAll } = require('./cdp');
const URL = process.argv[2] || 'http://127.0.0.1:4517/';

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✔ ' : '  ✖ ') + name + (detail ? '\n      ' + detail : ''));
}

// Что вообще анимируется на странице: свойства всех правил во всех стилях.
const ANIMATED = `(() => {
  var props = {};
  function note(p, where) {
    p.split(',').map(function (x) { return x.trim(); }).forEach(function (x) {
      if (!x || x === 'none') return;
      var name = x.split(' ')[0];
      if (!name || name === 'all') name = x;
      (props[name] = props[name] || []).push(where);
    });
  }
  Array.prototype.forEach.call(document.styleSheets, function (sheet) {
    var rules;
    try { rules = sheet.cssRules; } catch (e) { return; }
    (function walk(list) {
      Array.prototype.forEach.call(list, function (rule) {
        if (rule.cssRules && !rule.style) return walk(rule.cssRules);
        if (!rule.style) return;
        var t = rule.style.transitionProperty;
        if (t) note(t, rule.selectorText || '@');
      });
    })(rules);
  });
  // Ключевые кадры: какие свойства меняются внутри @keyframes.
  var frames = {};
  Array.prototype.forEach.call(document.styleSheets, function (sheet) {
    var rules;
    try { rules = sheet.cssRules; } catch (e) { return; }
    Array.prototype.forEach.call(rules, function (rule) {
      if (rule.type !== CSSRule.KEYFRAMES_RULE) return;
      var set = {};
      Array.prototype.forEach.call(rule.cssRules, function (kf) {
        for (var i = 0; i < kf.style.length; i++) set[kf.style[i]] = 1;
      });
      frames[rule.name] = Object.keys(set);
    });
  });
  return { transitions: Object.keys(props), keyframes: frames };
})()`;

(async () => {
  // ─── 1. Поменьше движения ────────────────────────────────────────────
  const q = await launch({ cdpPort: 9461, width: 1400, height: 900 });
  q.waitFor = async (e, t = 15000) => {
    const d = Date.now() + t;
    for (;;) { if (await q.eval(e)) return true; if (Date.now() > d) return false; await sleep(200); }
  };
  await q.metrics(1400, 900, false);
  await q.media({ 'prefers-reduced-motion': 'reduce' });
  await q.goto(URL, 4000);
  await q.waitFor(`document.querySelectorAll('.ev').length > 0`, 20000);
  await sleep(2200);

  const quiet = await q.json(`(()=>{
    var boot = document.getElementById('boot');
    var rose = document.getElementById('rose');
    var sweep = getComputedStyle(document.querySelector('.dial__sweep'));
    return {
      bootHidden: boot.hidden,
      booting: document.body.classList.contains('is-booting'),
      sweepAnim: sweep.animationName,
      sweepDur: sweep.animationDuration,
      dur: getComputedStyle(document.documentElement).getPropertyValue('--dur-mid').trim(),
      state: rose.dataset.state,
      word: document.getElementById('roseState').textContent
    }})()`);
  check('Поменьше движения: запуск приборов не проигрывается',
    quiet.bootHidden && !quiet.booting, `экран скрыт, класс снят`);
  check('Поменьше движения: картушка не вращается',
    quiet.sweepAnim === 'none' || parseFloat(quiet.sweepDur) < 0.01,
    `анимация «${quiet.sweepAnim}», длительность ${quiet.sweepDur}`);
  check('Поменьше движения: переходы схлопнуты', quiet.dur === '.001ms', '--dur-mid = ' + quiet.dur);

  // Состояние всё равно различимо: слово, заливка и цвет остаются.
  const states = await q.json(`(()=>{
    var rose = document.getElementById('rose');
    var out = {};
    ['working','waiting','ended','offline'].forEach(function (s) {
      rose.dataset.state = s;
      var disc = getComputedStyle(document.querySelector('.dial__disc'));
      var ring = getComputedStyle(document.querySelector('.dial__ring'));
      var sweep = getComputedStyle(document.querySelector('.dial__sweep'));
      var halo = getComputedStyle(document.querySelector('.dial__halo'));
      out[s] = { fill: disc.fill, stroke: ring.stroke, dash: ring.strokeDasharray,
                 arc: sweep.stroke, halo: halo.stroke + '/' + halo.opacity };
    });
    return out;
  })()`);
  const distinct = new Set(Object.values(states)
    .map((s) => [s.fill, s.stroke, s.dash, s.arc, s.halo].join('|')));
  check('Поменьше движения: четыре состояния всё равно различаются',
    distinct.size === 4,
    Object.keys(states).map((k) => k + ': заливка ' + states[k].fill +
      ', кольцо ' + states[k].stroke + ', дуга ' + states[k].arc).join('\n      '));

  await q.close();

  // ─── 2. Что анимируется ──────────────────────────────────────────────
  const b = await launch({ cdpPort: 9462, width: 1400, height: 900 });
  b.waitFor = q.waitFor;
  b.waitFor = async (e, t = 15000) => {
    const d = Date.now() + t;
    for (;;) { if (await b.eval(e)) return true; if (Date.now() > d) return false; await sleep(200); }
  };
  await b.metrics(1400, 900, false);
  await b.goto(URL, 4000);
  await b.waitFor(`document.querySelectorAll('.ev').length > 0`, 20000);
  await sleep(1800);
  await b.eval(`var w=document.querySelector('.tour--welcome .btn'); if(w) w.click()`);
  await sleep(400);

  const anim = await b.json(ANIMATED);
  const CHEAP = ['transform', 'opacity', 'background', 'background-color', 'color',
    'border-color', 'box-shadow', 'stroke', 'fill', 'visibility'];
  const costly = anim.transitions.filter((p) => CHEAP.indexOf(p) === -1);
  check('Переходы только по дешёвым свойствам', costly.length === 0,
    costly.length ? 'дорогие: ' + costly.join(', ') : anim.transitions.join(', '));

  const kfBad = Object.keys(anim.keyframes).filter((name) =>
    anim.keyframes[name].some((p) => ['transform', 'opacity', 'visibility'].indexOf(p) === -1));
  check('Ключевые кадры двигают только transform и opacity', kfBad.length === 0,
    Object.keys(anim.keyframes).map((n) => n + ' → ' + anim.keyframes[n].join('+')).join('; '));

  // ─── 3. Длинная лента ────────────────────────────────────────────────
  const perf = JSON.parse(await b.eval(`(async () => {
    // Пока идёт прокрутка, поток обязан продолжать приходить: отрисовка не
    // имеет права занимать поток событий.
    var stream = new EventSource('/api/stream');
    var got = 0, duringLoop = 0, opened = 0;
    stream.onopen = function () { opened = 1; };
    ['snapshot', 'pulse', 'event', 'git', 'state', 'fs'].forEach(function (name) {
      stream.addEventListener(name, function () { got++; });
    });

    // Ждём, пока поток установится: иначе замер поймает не работу
    // отрисовки, а рукопожатие соединения.
    for (var w = 0; w < 40 && !opened; w++) await new Promise(function (r) { setTimeout(r, 100); });
    var before = got;

    // Пульс приходит по событиям, а не по расписанию, поэтому «сколько
    // сообщений успело прийти» — плохая мера. Меряем то, от чего зависит их
    // приём: остаётся ли живым поток выполнения. Тикалка на 50 мс должна
    // отработать почти все свои тики, пока идёт прокрутка.
    var ticks = 0;
    var beat = setInterval(function () { ticks++; }, 50);

    var box = document.getElementById('feedScroll');
    var worst = 0, frames = 0;
    var start = performance.now();
    for (var i = 0; i < 150; i++) {
      var a = performance.now();
      box.scrollTop = (i % 2 ? 0.15 : 0.85) * box.scrollHeight;
      await new Promise(function (r) { requestAnimationFrame(r); });
      var dt = performance.now() - a;
      if (dt > worst) worst = dt;
      frames++;
    }
    duringLoop = got - before;
    var total = performance.now() - start;
    clearInterval(beat);
    var wanted = Math.floor(total / 50);
    await new Promise(function (r) { setTimeout(r, 2600); });
    stream.close();
    return JSON.stringify({
      rows: document.querySelectorAll('.ev').length,
      buffered: (document.getElementById('feedTop').style.height || '0px'),
      worst: Math.round(worst), avg: Math.round(total / frames),
      pulses: got, duringLoop: duringLoop, loopMs: Math.round(total),
      ticks: ticks, expected: wanted, ready: stream.readyState, opened: opened
    });
  })()`));

  const events = await b.eval(`(window.__count = document.querySelectorAll('.ev').length)`);
  check('Лента: в разметке живёт только видимое окно', perf.rows < 60,
    perf.rows + ' карточек в DOM, распорка сверху ' + perf.buffered);
  // Порог с запасом: на загруженной машине (а замер часто идёт рядом с
  // другими прогонами) один кадр может задержаться, и ловить это как
  // регресс — значит получать ложные тревоги.
  check('Лента: прокрутка не роняет кадр', perf.worst < 150,
    'худший кадр ' + perf.worst + ' мс, средний ' + perf.avg + ' мс');
  check('Отрисовка не глушит поток выполнения',
    perf.opened && perf.ticks >= perf.expected * 0.8,
    'тикалка отработала ' + perf.ticks + ' раз из ' + perf.expected + ' за ' +
    perf.loopMs + ' мс прокрутки; сообщений по потоку за замер: ' + perf.pulses +
    ' (пульс приходит по событиям, а не по расписанию)');

  const heavy = await b.json(`({dom: document.querySelectorAll('*').length,
      total: document.querySelectorAll('.ev').length,
      tree: document.querySelectorAll('.node').length})`);
  // Основную массу узлов даёт дерево проекта, а не лента: важно, что лента
  // не растёт вместе с числом событий.
  check('Документ не разрастается вместе с лентой', heavy.dom < 3000,
    heavy.dom + ' узлов всего, из них дерево проекта ' + heavy.tree +
    ', лента ' + heavy.total + ' (событий в буфере больше)');

  await b.close();
  killAll();

  const bad = checks.filter((c) => !c.ok);
  console.log('\nИтого: ' + (checks.length - bad.length) + '/' + checks.length +
    ', проблем: ' + bad.length + '\n');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('СБОЙ:', e.message); killAll(); process.exit(1); });
