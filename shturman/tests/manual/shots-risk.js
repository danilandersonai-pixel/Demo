// Снимки стоп-сигналов — на подготовленном транскрипте.
//
//   node tests/manual/shots-risk.js
//
// Опасные команды в живом проекте не запускают ради красивой картинки, а
// рисовать карточку подставным DOM нечестно: снимок должен показывать то,
// что панель действительно вывела. Поэтому скрипт создаёт временный проект
// и настоящий транскрипт Claude Code с записями о таких командах, поднимает
// на нём отдельный сервер и снимает результат. Путь данных — тот же самый:
// разбор JSONL → перевод на человеческий → разбор риска → лента.
//
// Ничего в вашем проекте и в вашем ~/.claude при этом не трогается: и дом,
// и проект — временные каталоги.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { launch, sleep, killAll } = require('./cdp');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.env.SHTURMAN_SHOTS || path.join(os.tmpdir(), 'shturman-shots');
const PORT = Number(process.env.SHTURMAN_PORT || 4519);

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-risk-home-'));
const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-risk-proj-'));

/** Кодировка имени каталога в ~/.claude/projects — как у самого Claude Code. */
function encodeProjectDir(p) {
  return String(p).replace(/[^A-Za-z0-9]/g, '-');
}

function rec(obj) { return JSON.stringify(obj) + '\n'; }

function buildTranscript() {
  fs.mkdirSync(path.join(PROJECT, 'src'), { recursive: true });
  fs.writeFileSync(path.join(PROJECT, 'README.md'), '# Пример проекта\n');
  fs.writeFileSync(path.join(PROJECT, 'src', 'app.js'), 'console.log("привет");\n');
  try {
    execFileSync('git', ['init', '-q'], { cwd: PROJECT });
    execFileSync('git', ['add', '.'], { cwd: PROJECT });
    execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=Пример',
      'commit', '-qm', 'Первый коммит'], { cwd: PROJECT });
  } catch (e) { /* без git панель тоже работает */ }

  const dir = path.join(HOME, '.claude', 'projects', encodeProjectDir(PROJECT));
  fs.mkdirSync(dir, { recursive: true });

  const t0 = Date.now() - 9 * 60 * 1000;
  const at = (min) => new Date(t0 + min * 60 * 1000).toISOString();
  const base = { sessionId: 'shots-risk', cwd: PROJECT, gitBranch: 'main', version: '2.0.0' };

  // Команды подобраны так, чтобы показать все уровни: спокойное действие,
  // предупреждение и опасность — и то, у чего откат есть, и то, у чего нет.
  const tools = [
    ['npm test', 'проверяет, работают ли тесты', 1],
    ['git rebase -i HEAD~3', null, 3],
    ['chmod -R 777 build', null, 4],
    ['rm -rf build', null, 5],
    ['git push --force origin main', null, 6],
    ['git reset --hard HEAD~1', null, 7]
  ];

  let out = rec(Object.assign({}, base, {
    type: 'user', uuid: 'u0', timestamp: at(0),
    message: { role: 'user', content: 'Почисти сборку и откати последний коммит' }
  }));

  tools.forEach(function (t, i) {
    const id = 'tool_' + i;
    out += rec(Object.assign({}, base, {
      type: 'assistant', uuid: 'a' + i, timestamp: at(t[2]),
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: id, name: 'Bash', input: { command: t[0], description: t[1] || '' } }]
      }
    }));
    out += rec(Object.assign({}, base, {
      type: 'user', uuid: 'r' + i, timestamp: at(t[2] + 0.2),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '' }] },
      toolUseResult: { stdout: '', stderr: '', interrupted: false }
    }));
  });

  fs.writeFileSync(path.join(dir, 'shots-risk.jsonl'), out);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  buildTranscript();
  console.log('  временный проект: ' + PROJECT);

  const srv = spawn(process.execPath,
    [path.join(ROOT, 'server.js'), '--project', PROJECT, '--port', String(PORT),
      '--quiet', '--no-open', '--force-new'],
    {
      cwd: ROOT, detached: true, stdio: 'ignore',
      env: Object.assign({}, process.env, { HOME: HOME, CLAUDE_CONFIG_DIR: path.join(HOME, '.claude') })
    });
  srv.unref();
  await sleep(3500);

  const b = await launch({ cdpPort: 9442, width: 1500, height: 980 });
  b.waitFor = async (expr, t = 20000) => {
    const deadline = Date.now() + t;
    for (;;) {
      if (await b.eval(expr)) return true;
      if (Date.now() > deadline) return false;
      await sleep(200);
    }
  };
  const shot = async (name) => { await b.shot(path.join(OUT, name + '.png')); console.log('  ' + name); };

  await b.metrics(1500, 980, false);
  await b.goto('http://127.0.0.1:' + PORT + '/', 5000);
  const ok = await b.waitFor(`document.querySelectorAll('.ev--risk').length > 2`, 25000);
  await b.eval(`var w=document.querySelector('.tour--welcome .btn--primary'); if(w) w.click()`);
  await sleep(400);
  await b.eval(`var t=document.getElementById('tourSkip'); if(t) t.click()`);
  await sleep(400);
  await b.eval(`document.documentElement.setAttribute('data-theme','dark')`);
  await sleep(300);

  if (!ok) {
    console.log('  ⚠ стоп-сигналы не появились — снимать нечего');
  } else {
    const found = await b.json(`[...document.querySelectorAll('.ev--risk .ev__title')].map(e=>e.textContent)`);
    console.log('  сигналов в ленте: ' + found.length);
    found.forEach(function (f) { console.log('    · ' + f); });

    await b.eval(`document.querySelector('.ev--risk').scrollIntoView({block:'center'})`);
    await sleep(400);
    await shot('r-01-risk-feed');
    await b.eval(`document.documentElement.setAttribute('data-theme','light')`);
    await sleep(400);
    await shot('r-02-risk-feed-light');
    await b.eval(`document.documentElement.setAttribute('data-theme','dark')`);
    await sleep(300);

    await b.eval(`document.querySelector('.ev--risk').click()`);
    await sleep(900);
    await shot('r-03-risk-sheet');
    await b.eval(`document.getElementById('sheetClose').click()`);
    await sleep(300);

    await b.metrics(360, 740, true);
    await sleep(500);
    await b.eval(`window.dispatchEvent(new Event('resize'))`);
    await sleep(800);
    await b.eval(`document.querySelector('.ev--risk').scrollIntoView({block:'center'})`);
    await sleep(400);
    await shot('r-04-risk-phone');
    await b.eval(`document.querySelector('.ev--risk').click()`);
    await sleep(900);
    await shot('r-05-risk-phone-sheet');
  }

  await b.close();
  killAll();
  try { process.kill(-srv.pid); } catch (e) { try { srv.kill(); } catch (e2) { /* уже умер */ } }
  console.log('\n  снимки в ' + OUT);
})().catch((e) => { console.error('СБОЙ:', e && e.message); killAll(); process.exit(1); });
