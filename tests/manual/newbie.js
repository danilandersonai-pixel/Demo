// Путь новичка целиком, с секундомером: установил → кликнул → выбрал
// проект → увидел ленту. Ни одного шага в терминале быть не должно.
//
//   node tests/manual/newbie.js
//
// Скрипт делает всё за человека ровно так, как это сделал бы он мышкой:
// запускает установщик, читает созданный ярлык и выполняет ровно ту
// команду, которая в нём записана, потом открывает браузер по адресу из
// замка. Ничего «своего» он не запускает — иначе проверка была бы
// самообманом.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { launch, sleep, killAll } = require('./cdp');

const ROOT = path.resolve(__dirname, '..', '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-newbie-'));

// Дом чистый — ни настроек, ни замка, ни ярлыков, — но записи Claude Code
// берём настоящие: иначе экран выбора будет пустым и проверять станет
// нечего. Штурман читает их из CLAUDE_CONFIG_DIR.
const ENV = Object.assign({}, process.env, {
  HOME: HOME,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
});

const steps = [];
function step(name, ms, detail) {
  steps.push({ name, ms, detail: detail || '' });
  console.log('  ' + String(Math.round(ms)).padStart(6) + ' мс  ' + name +
    (detail ? '\n              ' + detail : ''));
}

function run(file, args, opts) {
  return new Promise((resolve) => {
    execFile(file, args, Object.assign({
      cwd: ROOT, timeout: 120000,
      env: ENV
    }, opts || {}), (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function readLock() {
  try { return JSON.parse(fs.readFileSync(path.join(HOME, '.shturman.lock'), 'utf8')); }
  catch (e) { return null; }
}

(async () => {
  console.log('\n  ПУТЬ НОВИЧКА');
  console.log('  Чистый дом: ' + HOME);
  console.log('  ' + '─'.repeat(64));

  fs.mkdirSync(path.join(HOME, 'Desktop'), { recursive: true });

  // ─── 1. Установка ────────────────────────────────────────────────────
  let t = Date.now();
  const install = await run('sh', [path.join(ROOT, 'Установить Штурман.command'), '--yes']);
  const installMs = Date.now() - t;
  const ok = /ГОТОВО/.test(install.stdout);
  step('Установка двойным кликом', installMs,
    ok ? 'установщик сказал «ГОТОВО. Ярлык «Штурман» на рабочем столе»' :
      'установщик не отчитался: ' + install.stdout.slice(-200));

  const shortcut = path.join(HOME, 'Desktop', 'shturman.desktop');
  const haveShortcut = fs.existsSync(shortcut);
  const entry = haveShortcut ? fs.readFileSync(shortcut, 'utf8') : '';
  step('Ярлык на рабочем столе', 0,
    haveShortcut ? shortcut + (/Terminal=false/.test(entry) ? ' · без окна терминала' : ' · ⚠ терминал')
      : '⚠ ярлыка нет');

  // ─── 2. Клик по ярлыку ───────────────────────────────────────────────
  const exec = (/^Exec=(.+)$/m.exec(entry) || [])[1] || '';
  const command = exec.replace(/\s*%[fFuU]\s*$/, '').replace(/^'|'$/g, '');
  t = Date.now();
  const child = spawn('sh', [command], {
    cwd: ROOT, detached: true, stdio: 'ignore',
    env: ENV
  });
  child.unref();

  let lock = null;
  for (let i = 0; i < 200 && !lock; i++) { await sleep(100); lock = readLock(); }
  const startMs = Date.now() - t;
  if (!lock) {
    step('Панель поднялась', startMs, '⚠ замок не появился, смотрите ' + path.join(HOME, '.shturman.log'));
    killAll();
    process.exit(1);
  }
  step('Панель поднялась после клика', startMs, lock.url + ' (порт подобран сам)');

  // ─── 3. Второй клик не поднимает второй сервер ───────────────────────
  t = Date.now();
  const second = await run('sh', [command]);
  const secondMs = Date.now() - t;
  const lock2 = readLock();
  step('Второй клик по ярлыку', secondMs,
    lock2 && lock2.pid === lock.pid ? 'тот же сервер (pid ' + lock.pid + '), новой копии нет'
      : '⚠ поднялся второй сервер');

  // ─── 4. Панель в браузере ────────────────────────────────────────────
  const b = await launch({ cdpPort: 9531, width: 1400, height: 950 });
  b.waitFor = async (e, ms = 20000) => {
    const d = Date.now() + ms;
    for (;;) { if (await b.eval(e)) return true; if (Date.now() > d) return false; await sleep(150); }
  };
  await b.metrics(1400, 950, false);

  t = Date.now();
  await b.goto(lock.url, 1500);
  const gotPicker = await b.waitFor(`!document.getElementById('picker').hidden`, 20000);
  step('Экран выбора проекта', Date.now() - t,
    gotPicker ? await b.eval(`document.querySelectorAll('.pcard').length`) + ' карточек, путь печатать не нужно'
      : '⚠ экран выбора не появился');

  t = Date.now();
  if (gotPicker) {
    await b.eval(`document.querySelector('.pcard').click()`);
    await b.waitFor(`document.getElementById('picker').hidden`, 15000);
  }
  // Ждём не первую карточку, а обжитую ленту: транскрипт читается пару секунд.
  const gotFeed = await b.waitFor(`document.querySelectorAll('.ev').length > 3`, 30000);
  step('Лента с событиями', Date.now() - t,
    gotFeed ? await b.eval(`document.querySelectorAll('.ev').length`) + ' карточек в окне'
      : '⚠ лента пустая');

  // ─── 5. Выключение из панели ─────────────────────────────────────────
  t = Date.now();
  await b.eval(`document.getElementById('btnSettings').click()`);
  await b.waitFor(`[...document.querySelectorAll('.row__label b')].some(x=>x.textContent==='Выключить Штурман')`, 8000);
  await b.eval(`[...document.querySelectorAll('.row')]
    .find(r=>(r.querySelector('b')||{}).textContent==='Выключить Штурман')
    .querySelector('.btn').click()`);
  await sleep(300);
  await b.eval(`[...document.querySelectorAll('.row')]
    .find(r=>(r.querySelector('b')||{}).textContent==='Выключить Штурман')
    .querySelector('.btn').click()`);
  const byeShown = await b.waitFor(`!document.getElementById('bye').hidden`, 8000);
  await sleep(1200);
  const gone = readLock() === null;
  step('Выключение кнопкой в панели', Date.now() - t,
    (byeShown ? 'показано прощание' : '⚠ прощания нет') + ', ' +
    (gone ? 'замок снят' : '⚠ замок остался'));

  await b.close();
  killAll();

  // ─── итог ────────────────────────────────────────────────────────────
  console.log('  ' + '─'.repeat(64));
  const total = steps.reduce((a, s) => a + s.ms, 0);
  console.log('  Весь путь: ' + (total / 1000).toFixed(1) + ' с');
  const bad = steps.filter((s) => s.detail.indexOf('⚠') !== -1);
  console.log('  Шагов в терминале: 0 — установка и запуск сделаны кликом.');
  console.log(bad.length ? '  ✖ проблем: ' + bad.length : '  ✔ путь пройден целиком');
  console.log('');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('СБОЙ:', e && e.message); killAll(); process.exit(1); });
