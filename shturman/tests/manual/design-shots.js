// Снимки всех экранов панели на двух ширинах — материал для DESIGN-AUDIT.md.
//
//   node server.js --port 4517 --quiet --no-open &
//   SHTURMAN_SHOTS=/tmp/shots node tests/manual/design-shots.js [url]
//
// PNG в репозиторий не кладём: скрипт собирает их заново за полторы минуты.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, sleep, killAll } = require('./cdp');

const OUT = process.env.SHTURMAN_SHOTS || path.join(os.tmpdir(), 'shturman-shots');
const URL = process.argv[2] || 'http://127.0.0.1:4517/';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ cdpPort: 9441, width: 1500, height: 980 });
  b.waitFor = async (expr, t = 8000) => {
    const deadline = Date.now() + t;
    for (;;) {
      if (await b.eval(expr)) return true;
      if (Date.now() > deadline) return false;
      await sleep(200);
    }
  };
  const shot = async (name) => { await b.shot(path.join(OUT, name + '.png')); console.log('  ' + name); };
  const theme = async (t) => {
    await b.eval(`document.documentElement.setAttribute('data-theme','${t}')`);
    await sleep(350);
  };

  await b.metrics(1500, 980, false);
  await b.goto(URL, 5000);
  await b.waitFor(`document.querySelectorAll('.ev').length > 0`, 20000);
  await sleep(1000);

  console.log('компьютер 1500×980:');
  // Первый запуск: приветствие, из него — тур.
  if (await b.eval(`!!document.querySelector('.tour--welcome')`)) await shot('d-01-welcome');
  await b.eval(`var w=document.querySelector('.tour--welcome .btn--primary'); if(w) w.click()`);
  await sleep(500);
  if (await b.eval(`!document.getElementById('tour').hidden`)) await shot('d-01b-tour');
  await b.eval(`var t=document.getElementById('tourSkip'); if(t) t.click()`);
  await sleep(400);

  await theme('dark');
  await shot('d-02-main-dark');
  await theme('light');
  await shot('d-03-main-light');
  await theme('dark');

  await b.eval(`document.getElementById('btnDetail').click()`); await sleep(500);
  await shot('d-04-feed-detailed');
  await b.eval(`document.getElementById('btnDetail').click()`); await sleep(300);

  const open = async (id, name, wait = 700) => {
    await b.eval(`document.getElementById('${id}').click()`);
    await sleep(wait);
    await shot(name);
    await b.eval(`var c=document.getElementById('sheetClose'); if(c) c.click()`);
    await sleep(250);
  };
  await b.eval(`document.querySelector('.ev').click()`); await sleep(900);
  await shot('d-05-sheet-event');
  await b.eval(`document.getElementById('sheetClose').click()`); await sleep(250);
  await open('btnGlossary', 'd-06-glossary');
  await open('btnSettings', 'd-07-settings');
  await open('btnConnect', 'd-08-connect', 1000);

  await b.eval(`document.getElementById('btnBell').click()`); await sleep(500);
  await shot('d-09-waiting');
  await b.eval(`document.getElementById('roseSeen').click()`); await sleep(250);

  // Картушка во всех состояниях — их видно только принудительным прогоном.
  for (const st of ['working', 'waiting', 'ended', 'offline']) {
    await b.eval(`document.getElementById('rose').dataset.state = '${st}'`);
    await sleep(300);
    await shot('d-10-rose-' + st);
  }

  // ─── телефон ─────────────────────────────────────────────────────────
  console.log('телефон 360×740:');
  await b.metrics(360, 740, true);
  await sleep(400);
  await b.eval(`window.dispatchEvent(new Event('resize'))`);
  await sleep(600);

  await shot('m-01-feed-dark');
  await theme('light'); await shot('m-02-feed-light'); await theme('dark');

  for (const tab of ['map', 'git', 'pulse']) {
    await b.eval(`document.querySelector('.tab[data-tab="${tab}"]').click()`);
    await sleep(600);
    await shot('m-03-' + tab);
  }
  await b.eval(`document.querySelector('.tab[data-tab="feed"]').click()`); await sleep(400);

  await open('btnMore', 'm-04-more');
  await b.eval(`document.querySelector('.ev').click()`); await sleep(900);
  await shot('m-05-sheet');
  await b.eval(`document.getElementById('sheetClose').click()`); await sleep(250);

  await b.eval(`document.getElementById('btnBell').click()`); await sleep(500);
  await shot('m-06-waiting');
  await b.eval(`document.getElementById('roseSeen').click()`); await sleep(250);

  await b.eval(`var s=document.getElementById('feedSearch');
                s.value='зззнетничего'; s.dispatchEvent(new Event('input'))`);
  await sleep(700);
  await shot('m-07-empty-search');
  await b.eval(`var s=document.getElementById('feedSearch');
                s.value=''; s.dispatchEvent(new Event('input'))`);
  await sleep(400);

  // ─── телефон: то, что появилось ради запуска кликом ──────────────────
  await open('btnSettings', 'm-08-settings', 900);
  await open('btnGlossary', 'm-09-glossary', 800);
  await open('btnDigest', 'm-10-digest', 1200);

  if (await b.eval(`!!document.querySelector('.termword')`)) {
    await b.eval(`document.querySelector('.termword').click()`);
    await sleep(700);
    await shot('m-11-term');
    await b.eval(`document.getElementById('sheetClose').click()`); await sleep(250);
  }

  await b.eval(`document.querySelector('.tab[data-tab="pulse"]').click()`);
  await sleep(700);
  await shot('m-12-diary-actions');
  await b.eval(`document.querySelector('.tab[data-tab="feed"]').click()`); await sleep(400);

  // Экран выбора проекта: на телефоне он занимает весь экран.
  await b.eval(`document.getElementById('btnMore').click()`); await sleep(700);
  await b.eval(`var r=[...document.querySelectorAll('.row--act')]
                 .find(x=>x.innerText.indexOf('Сменить проект')===0); if(r) r.click()`);
  await sleep(1400);
  await shot('m-13-picker');
  await b.eval(`var c=document.getElementById('pickerClose'); if(c) c.click()`);
  await sleep(400);

  // ─── компьютер: остальные экраны ─────────────────────────────────────
  console.log('компьютер, остальное:');
  await b.metrics(1500, 980, false);
  await sleep(500);
  await b.eval(`window.dispatchEvent(new Event('resize'))`);
  await sleep(700);

  // Шпаргалка и подсветка терминов живут в ленте — снимаем шторку слова.
  if (await b.eval(`!!document.querySelector('.termword')`)) {
    await b.eval(`document.querySelector('.termword').click()`);
    await sleep(700);
    await shot('d-11-term-sheet');
    await b.eval(`document.getElementById('sheetClose').click()`); await sleep(250);
  }
  if (await b.eval(`!!document.querySelector('.cheat__word')`)) {
    await b.eval(`document.querySelector('.cheat__word').click()`);
    await sleep(700);
    await shot('d-12-cheat-sheet');
    await b.eval(`document.getElementById('sheetClose').click()`); await sleep(250);
  }

  // Стоп-сигнал: снимаем, только если он есть в живой ленте. Подсовывать
  // сюда выдуманное событие нельзя — снимок карты состояний должен быть
  // снимком того, что панель действительно показала. Отдельный прогон на
  // подготовленном транскрипте делает tests/manual/shots-risk.js.
  if (await b.eval(`!!document.querySelector('.ev--risk')`)) {
    await b.eval(`document.querySelector('.ev--risk').scrollIntoView({block:'center'})`);
    await sleep(400);
    await shot('d-13-risk-card');
  }

  await open('btnDigest', 'd-15-digest', 1300);

  // Плотность «Компактно».
  await b.eval(`(function(){
    var r=[...document.querySelectorAll('.seg__btn')].find(x=>x.textContent==='Компактно');
    if(r) r.click();
  })()`);
  await b.eval(`document.getElementById('btnSettings').click()`); await sleep(800);
  await b.eval(`(function(){
    var r=[...document.querySelectorAll('.seg__btn')].find(x=>x.textContent==='Компактно');
    if(r) r.click();
  })()`);
  await sleep(500);
  await b.eval(`document.getElementById('sheetClose').click()`); await sleep(500);
  await shot('d-16-density-compact');
  await b.eval(`document.getElementById('btnSettings').click()`); await sleep(700);
  await b.eval(`(function(){
    var r=[...document.querySelectorAll('.seg__btn')].find(x=>x.textContent==='Просторно');
    if(r) r.click();
  })()`);
  await sleep(400);
  await b.eval(`document.getElementById('sheetClose').click()`); await sleep(400);

  // Экран выбора проекта и обзор папок.
  await b.eval(`document.getElementById('btnSettings').click()`); await sleep(800);
  await b.eval(`(function(){
    var rows=[...document.querySelectorAll('.row')];
    var r=rows.find(x=>(x.querySelector('b')||{}).textContent==='Проект');
    if(r) r.querySelector('.btn').click();
  })()`);
  await sleep(1500);
  await shot('d-17-picker');
  if (await b.eval(`!!document.getElementById('pickerBrowse')`)) {
    await b.eval(`document.getElementById('pickerBrowse').click()`);
    await sleep(2000);
    await shot('d-18-browse');
    await b.eval(`var c=document.getElementById('sheetClose'); if(c) c.click()`);
    await sleep(400);
  }
  await b.eval(`var c=document.getElementById('pickerClose'); if(c) c.click()`);
  await sleep(400);

  // Полоса «Клод работает в другой папке» — если сервер её нашёл.
  if (await b.eval(`!document.getElementById('notice').hidden`)) {
    await shot('d-19-elsewhere');
  }

  // Экран прощания: показываем разметкой, чтобы не гасить сервер под съёмкой.
  await b.eval(`(function(){
    var bye=document.getElementById('bye');
    if(bye) bye.hidden=false;
  })()`);
  await sleep(600);
  await shot('d-20-bye');
  await b.eval(`(function(){var b=document.getElementById('bye'); if(b) b.hidden=true;})()`);
  await sleep(300);

  // Отдельные страницы: витрина дизайн-системы и «Штурман не запущен».
  await b.goto(URL.replace(/\/$/, '') + '/design.html', 2500);
  await sleep(900);
  await shot('d-21-design-showcase');
  await b.goto(URL.replace(/\/$/, '') + '/offline.html', 2000);
  await sleep(700);
  await shot('d-22-offline');
  await theme('light'); await shot('d-23-offline-light'); await theme('dark');

  await b.metrics(360, 740, true);
  await sleep(500);
  await b.goto(URL.replace(/\/$/, '') + '/offline.html', 2000);
  await sleep(700);
  await shot('m-14-offline');

  console.log('\nснимки в ' + OUT);
  await b.close();
  killAll();
})().catch((e) => { console.error(e); killAll(); process.exit(1); });
