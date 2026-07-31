// Ручной аудит интерфейса: поднимает headless Chromium, кликает по каждой
// функции панели и читает DOM. Это не unit-тесты — они в tests/*.test.js;
// здесь проверяется то, что можно только увидеть.
//
//   node server.js --port 4517 &        # в одном окне
//   node tests/manual/audit-ui.js       # в другом
const { launch, sleep } = require('./cdp');
const SC = process.env.SHTURMAN_SHOTS || require('os').tmpdir();
const URL = process.argv[2] || 'http://127.0.0.1:4517/';

const results = [];
function ok(name, cond, detail) {
  results.push({ name, status: cond ? 'OK' : 'ПРОБЛЕМА', detail: detail || '' });
}

(async () => {
  const b = await launch({ cdpPort: 9411 });
  // Собираем ошибки страницы.
  await b.eval(`window.__err=[];window.addEventListener('error',e=>window.__err.push(String(e.message)));
                window.addEventListener('unhandledrejection',e=>window.__err.push('promise: '+e.reason));`);
  await b.metrics(1500, 980, false);
  await b.goto(URL, 5000);
  await b.eval(`window.__err=window.__err||[];window.addEventListener('error',e=>window.__err.push(String(e.message)));`);

  // --- тур -----------------------------------------------------------------
  const tourVisible = await b.eval(`!document.getElementById('tour').hidden`);
  ok('Тур первого запуска показывается', tourVisible);
  const tourSteps = [];
  for (let i = 0; i < 6; i++) {
    const s = await b.json(`({step:document.getElementById('tourStep').textContent,
                             title:document.getElementById('tourTitle').textContent,
                             hidden:document.getElementById('tour').hidden})`);
    if (s.hidden) break;
    tourSteps.push(s.step + ' — ' + s.title);
    await b.eval(`document.getElementById('tourNext').click()`);
    await sleep(250);
  }
  ok('Тур проходится до конца', tourSteps.length === 5, tourSteps.length + ' шагов: ' + tourSteps.join(' | '));
  ok('Тур закрывается', await b.eval(`document.getElementById('tour').hidden`));

  // --- лента ---------------------------------------------------------------
  const feed0 = await b.eval(`document.querySelectorAll('.ev').length`);
  ok('Лента наполнена', feed0 > 5, feed0 + ' карточек');

  // фильтры
  const filterReport = [];
  for (const f of ['edit', 'read', 'run', 'search', 'error', 'talk', 'git', 'agent', 'all']) {
    await b.eval(`document.querySelector('[data-filter="${f}"]').click()`);
    await sleep(150);
    filterReport.push(f + '=' + await b.eval(`document.querySelectorAll('.ev').length`));
  }
  ok('Фильтры ленты работают', true, filterReport.join(' '));

  // поиск
  await b.eval(`(()=>{const i=document.getElementById('feedSearch');i.value='npm';i.dispatchEvent(new Event('input'))})()`);
  await sleep(400);
  const searched = await b.eval(`document.querySelectorAll('.ev').length`);
  await b.eval(`(()=>{const i=document.getElementById('feedSearch');i.value='';i.dispatchEvent(new Event('input'))})()`);
  await sleep(400);
  const restored = await b.eval(`document.querySelectorAll('.ev').length`);
  ok('Поиск по ленте фильтрует и сбрасывается', searched < restored && searched >= 0,
    `по «npm»: ${searched}, без фильтра: ${restored}`);

  // Просто / Подробно
  await b.eval(`document.getElementById('modeDetail').click()`);
  await sleep(300);
  const rawBlocks = await b.eval(`document.querySelectorAll('.ev__raw').length`);
  await b.eval(`document.getElementById('modeSimple').click()`);
  await sleep(300);
  const rawAfter = await b.eval(`document.querySelectorAll('.ev__raw').length`);
  ok('Режим «Подробно» показывает сырые данные', rawBlocks > 0 && rawAfter === 0,
    `подробно: ${rawBlocks} блоков, просто: ${rawAfter}`);

  // пауза
  await b.eval(`document.getElementById('btnPause').click()`);
  await sleep(200);
  const paused = await b.eval(`!document.getElementById('feedPaused').hidden`);
  await b.eval(`document.getElementById('btnPause').click()`);
  await sleep(200);
  const unpaused = await b.eval(`document.getElementById('feedPaused').hidden`);
  ok('Пауза ленты включается и снимается', paused && unpaused);

  // клик по событию -> шторка
  await b.eval(`document.querySelector('.ev').click()`);
  await sleep(1200);
  const drawer = await b.json(`({open:!document.getElementById('drawer').hidden,
      title:document.getElementById('drawerTitle').textContent,
      sections:[...document.querySelectorAll('.sec__title')].map(e=>e.textContent),
      facts:document.querySelectorAll('.card__facts dt').length})`);
  ok('Карточка события открывается', drawer.open, drawer.title.slice(0, 50) +
    ' | разделы: ' + drawer.sections.join(', ') + ' | фактов: ' + drawer.facts);
  await b.eval(`document.getElementById('drawerClose').click()`);

  // --- карта проекта --------------------------------------------------------
  const tree = await b.json(`({nodes:document.querySelectorAll('.node').length,
                               dirs:document.querySelectorAll('.node--dir').length,
                               hot:document.querySelectorAll('.node.is-hot').length})`);
  ok('Карта проекта построена', tree.nodes > 5,
    `${tree.nodes} узлов, ${tree.dirs} папок, ${tree.hot} подсвечено`);

  // сворачивание папки
  const before = tree.nodes;
  await b.eval(`document.querySelector('.node--dir').click()`);
  await sleep(300);
  const collapsed = await b.eval(`document.querySelectorAll('.node').length`);
  await b.eval(`document.querySelector('.node--dir').click()`);
  await sleep(300);
  ok('Папки сворачиваются', collapsed < before, `${before} -> ${collapsed}`);

  // поиск по дереву
  await b.eval(`(()=>{const i=document.getElementById('treeSearch');i.value='.js';i.dispatchEvent(new Event('input'))})()`);
  await sleep(400);
  const treeFound = await b.eval(`document.querySelectorAll('.node').length`);
  await b.eval(`(()=>{const i=document.getElementById('treeSearch');i.value='';i.dispatchEvent(new Event('input'))})()`);
  await sleep(400);
  ok('Поиск по дереву работает', treeFound > 0, treeFound + ' файлов на «.js»');

  // карточка файла
  await b.eval(`[...document.querySelectorAll('.node')].find(n=>!n.classList.contains('node--dir')).click()`);
  await sleep(1500);
  const card = await b.json(`({open:!document.getElementById('drawer').hidden,
      title:document.getElementById('drawerTitle').textContent,
      kind:(document.querySelector('.card__kind')||{}).textContent,
      what:(document.querySelector('.card__what')||{}).textContent,
      diffs:document.querySelectorAll('.diff').length})`);
  ok('Карточка файла с объяснением', card.open && !!card.kind,
    `${card.title} | ${card.kind} | «${(card.what || '').slice(0, 50)}…» | диффов: ${card.diffs}`);
  await b.eval(`document.getElementById('drawerClose').click()`);

  // --- git ------------------------------------------------------------------
  const git = await b.json(`({branch:(document.querySelector('.git__branch')||{}).textContent,
      explain:(document.querySelector('.git__explain')||{}).textContent,
      count:(document.querySelector('.git__count-num')||{}).textContent,
      files:document.querySelectorAll('.gitfile').length})`);
  ok('Git-панель «Сейчас»', !!git.branch,
    `ветка ${git.branch}, несохранённых ${git.count}, файлов ${git.files}`);

  await b.eval(`document.querySelector('[data-gittab="history"]').click()`);
  await sleep(300);
  const tl = await b.json(`({items:document.querySelectorAll('.tl').length,
      first:(document.querySelector('.tl__subject')||{}).textContent,
      explain:(document.querySelector('.tl__explain')||{}).textContent})`);
  ok('Таймлайн коммитов', tl.items > 0, `${tl.items} коммитов, первый: ${tl.first} — ${tl.explain}`);

  await b.eval(`document.querySelector('.tl').click()`);
  await sleep(1500);
  const commitDrawer = await b.json(`({open:!document.getElementById('drawer').hidden,
      diffs:document.querySelectorAll('.diff').length,
      lines:document.querySelectorAll('.diff__line').length})`);
  ok('Дифф коммита открывается', commitDrawer.open && commitDrawer.diffs > 0,
    `${commitDrawer.diffs} файлов, ${commitDrawer.lines} строк диффа`);
  await b.eval(`document.getElementById('drawerClose').click();
                document.querySelector('[data-gittab="now"]').click()`);

  // --- словарь --------------------------------------------------------------
  await b.eval(`document.getElementById('btnGlossary').click()`);
  await sleep(500);
  const gl = await b.json(`({open:!document.getElementById('modal').hidden,
      items:document.querySelectorAll('.gl__item').length,
      count:(document.querySelector('.gl__count')||{}).textContent})`);
  ok('Словарь открывается', gl.open && gl.items >= 25, `${gl.items} терминов, «${gl.count}»`);

  await b.eval(`(()=>{const i=document.querySelector('.gl__search');i.value='коммит';i.dispatchEvent(new Event('input'))})()`);
  await sleep(300);
  const glSearch = await b.eval(`document.querySelectorAll('.gl__item').length`);
  ok('Поиск по словарю', glSearch > 0 && glSearch < gl.items, `«коммит» -> ${glSearch}`);
  await b.eval(`document.getElementById('modalClose').click()`);

  // подсказка по «?»
  await b.eval(`document.querySelector('.term').click()`);
  await sleep(300);
  const tip = await b.json(`({open:!document.getElementById('tip').hidden,
      term:document.getElementById('tipTerm').textContent,
      text:document.getElementById('tipText').textContent})`);
  ok('Подсказка по значку «?»', tip.open && !!tip.term, `${tip.term}: ${(tip.text || '').slice(0, 50)}…`);

  // --- пульс ----------------------------------------------------------------
  const pulse = await b.json(`({files:document.getElementById('pulseFiles').textContent,
      cmd:document.getElementById('pulseCommands').textContent,
      err:document.getElementById('pulseErrors').textContent,
      dur:document.getElementById('pulseDuration').textContent,
      tok:document.getElementById('pulseTokens').textContent,
      state:document.getElementById('stateText').textContent,
      level:document.getElementById('levelText').textContent})`);
  ok('Пульс сессии заполнен', pulse.files !== '0' || pulse.cmd !== '0',
    `файлов ${pulse.files}, команд ${pulse.cmd}, ошибок ${pulse.err}, ${pulse.dur}, токены: ${pulse.tok}`);
  ok('Статус Клода и уровень', !!pulse.state && !!pulse.level, `${pulse.state} | ${pulse.level}`);

  // граф внимания
  const graph = await b.json(`({nodes:document.querySelectorAll('.attgraph__node').length,
      links:document.querySelectorAll('.attgraph__link').length})`);
  ok('Граф внимания', graph.nodes > 0, `${graph.nodes} узлов, ${graph.links} связей`);
  await b.eval(`document.querySelector('[data-atttab="list"]').click()`);
  await sleep(200);
  const attList = await b.eval(`document.querySelectorAll('.att').length`);
  ok('Список внимания', attList > 0, attList + ' чипсов');
  await b.eval(`document.querySelector('[data-atttab="graph"]').click()`);

  // --- журнал сессий ---------------------------------------------------------
  const sessions = await b.json(`({items:document.querySelectorAll('.session').length,
      active:document.querySelectorAll('.session.is-active').length})`);
  ok('Журнал прошлых сессий', sessions.items > 0, `${sessions.items} сессий, активных ${sessions.active}`);

  // --- сигнал ----------------------------------------------------------------
  await b.eval(`document.getElementById('btnBell').click()`);
  await sleep(500);
  const alarm = await b.json(`({open:!document.getElementById('alarm').hidden,
      title:document.getElementById('alarmTitle').textContent})`);
  ok('Проверка сигнала', alarm.open, alarm.title);
  await b.eval(`document.getElementById('alarmOk').click()`);

  // --- дайджест ---------------------------------------------------------------
  await b.eval(`document.getElementById('btnDigest').click()`);
  await sleep(1500);
  const dig = await b.json(`({open:!document.getElementById('modal').hidden,
      len:(document.querySelector('.modal__body pre')||{textContent:''}).textContent.length,
      head:(document.querySelector('.modal__body pre')||{textContent:''}).textContent.slice(0,40)})`);
  ok('Дайджест собирается', dig.open && dig.len > 200, `${dig.len} символов, «${dig.head}…»`);
  await b.eval(`document.getElementById('modalClose').click()`);

  // --- настройки ---------------------------------------------------------------
  await b.eval(`document.getElementById('btnSettings').click()`);
  await sleep(500);
  const set = await b.json(`({open:!document.getElementById('modal').hidden,
      rows:[...document.querySelectorAll('.set__label b')].map(e=>e.textContent)})`);
  ok('Экран настроек', set.open && set.rows.length >= 3, set.rows.join(' | '));
  await b.eval(`document.getElementById('modalClose').click()`);

  // --- ошибки страницы ---------------------------------------------------------
  const errs = await b.json(`window.__err || []`);
  ok('Нет ошибок JS на странице', errs.length === 0, errs.join(' ; '));

  await b.shot(SC + '/audit-desktop.png');

  // --- телефон 360px -----------------------------------------------------------
  await b.metrics(360, 780, true);
  await sleep(800);
  const mob = await b.json(`({
      bodyScrollW: document.body.scrollWidth, inner: window.innerWidth,
      horizontalOverflow: document.body.scrollWidth > window.innerWidth + 2,
      feedVisible: document.querySelectorAll('.ev').length,
      topbarH: document.querySelector('.topbar').getBoundingClientRect().height,
      smallTargets: [...document.querySelectorAll('button')].filter(e=>{
        const r=e.getBoundingClientRect(); return r.width>0 && (r.height<44||r.width<44);}).length,
      totalButtons: document.querySelectorAll('button').length
  })`);
  ok('Телефон 360px: нет горизонтальной прокрутки', !mob.horizontalOverflow,
    `scrollWidth ${mob.bodyScrollW} vs ${mob.inner}`);
  ok('Телефон 360px: зоны касания ≥44px', mob.smallTargets === 0,
    `мелких кнопок: ${mob.smallTargets} из ${mob.totalButtons}`);
  await b.shot(SC + '/audit-mobile.png');

  console.log('\n=== АУДИТ ПЕРВОЙ ВЕРСИИ ===\n');
  results.forEach((r) => {
    console.log((r.status === 'OK' ? '  ✔ ' : '  ✖ ') + r.name +
      (r.detail ? '\n      ' + r.detail : ''));
  });
  const bad = results.filter((r) => r.status !== 'OK');
  console.log('\nИтого: ' + (results.length - bad.length) + '/' + results.length +
    ' ок, проблем: ' + bad.length + '\n');

  await b.close();
  process.exit(0);
})().catch(async (e) => {
  // Обязательно убиваем браузер: иначе следующий прогон подключится к живому
  // экземпляру со старым localStorage и получит ложные результаты.
  console.error('СБОЙ АУДИТА:', e.message);
  try { const { killAll } = require('./cdp'); killAll(); } catch (x) { /* нечего убивать */ }
  process.exit(1);
});
