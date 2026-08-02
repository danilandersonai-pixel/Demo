// Запуск в один клик: замок, ярлыки под три ОС, список проектов,
// стоп-сигналы. Всё проверяется на любой машине — ярлыки не ставятся, а
// собираются чистыми функциями, и тест смотрит на их содержимое.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const lock = require('../lib/lock');
const desktop = require('../lib/desktop');
const projects = require('../lib/projects');
const risk = require('../lib/risk');
const config = require('../lib/config');

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-' + prefix + '-'));
}

// ─── замок: один экземпляр ────────────────────────────────────────────────

test('замок: пустая папка — замка нет', () => {
  const dir = tmpdir('lock');
  assert.strictEqual(lock.read(dir), null);
  assert.strictEqual(lock.readAlive(dir), null);
});

test('замок: поставили и прочитали', () => {
  const dir = tmpdir('lock');
  const written = lock.acquire({ port: 4517, url: 'http://127.0.0.1:4517/', project: '/tmp/p' }, dir);
  assert.ok(written, 'замок должен записаться');
  const read = lock.read(dir);
  assert.strictEqual(read.pid, process.pid);
  assert.strictEqual(read.port, 4517);
  assert.strictEqual(read.url, 'http://127.0.0.1:4517/');
  assert.ok(fs.existsSync(path.join(dir, lock.FILE_NAME)));
});

test('замок: свой процесс считается живым', () => {
  const dir = tmpdir('lock');
  lock.acquire({ port: 1, url: 'u' }, dir);
  const alive = lock.readAlive(dir);
  assert.ok(alive, 'свой же замок должен читаться');
  assert.strictEqual(alive.pid, process.pid);
});

test('замок от мёртвого процесса убирается сам', () => {
  const dir = tmpdir('lock');
  // pid, которого заведомо нет: ядро не выдаёт такие номера.
  fs.writeFileSync(path.join(dir, lock.FILE_NAME),
    JSON.stringify({ pid: 999999, port: 4517, url: 'http://127.0.0.1:4517/' }));
  assert.strictEqual(lock.readAlive(dir), null, 'мёртвый замок не должен считаться живым');
  assert.strictEqual(fs.existsSync(path.join(dir, lock.FILE_NAME)), false, 'и должен быть убран');
});

test('замок: испорченный файл не роняет запуск', () => {
  const dir = tmpdir('lock');
  fs.writeFileSync(path.join(dir, lock.FILE_NAME), 'это не json');
  assert.strictEqual(lock.read(dir), null);
  assert.doesNotThrow(() => lock.readAlive(dir));
});

test('замок: чужой живой замок не снимается', () => {
  const dir = tmpdir('lock');
  // Живой процесс, который точно не мы, — процесс 1 есть всегда.
  fs.writeFileSync(path.join(dir, lock.FILE_NAME), JSON.stringify({ pid: 1, port: 1, url: 'u' }));
  assert.strictEqual(lock.release(dir), false, 'чужой замок трогать нельзя');
  assert.ok(fs.existsSync(path.join(dir, lock.FILE_NAME)));
});

test('замок: alive умеет отвечать на ерунду', () => {
  assert.strictEqual(lock.alive(0), false);
  assert.strictEqual(lock.alive(null), false);
  assert.strictEqual(lock.alive('семь'), false);
  assert.strictEqual(lock.alive(process.pid), true);
});

// ─── ярлыки: Windows ──────────────────────────────────────────────────────

test('Windows: обёртка прячет окно и умеет принять папку', () => {
  const vbs = desktop.windowsVbs({ root: 'C:\\Sh', node: 'C:\\Program Files\\node.exe' });
  assert.match(vbs, /CreateObject\("WScript\.Shell"\)/);
  assert.match(vbs, /sh\.Run cmd, 0, False/, 'состояние окна 0 — скрыто');
  assert.match(vbs, /--pick/);
  assert.match(vbs, /WScript\.Arguments\(0\)/, 'папка приходит первым аргументом');
  assert.match(vbs, /C:\\Sh\\server\.js/, 'путь в виде Windows');
  assert.ok(vbs.indexOf('\r\n') !== -1, 'у Windows свои переводы строк');
});

test('Windows: ярлык создаётся PowerShell и получает иконку', () => {
  const cmd = desktop.windowsShortcutCommand({
    desktop: 'C:\\Users\\ok\\Desktop', vbs: 'C:\\Sh\\install\\launch.vbs',
    root: 'C:\\Sh', icon: 'C:\\Sh\\public\\icons\\shturman.ico'
  });
  assert.strictEqual(cmd.file, 'powershell');
  const script = cmd.args.join(' ');
  assert.match(script, /CreateShortcut/);
  assert.match(script, /wscript\.exe/, 'цель ярлыка — wscript, а не node');
  assert.match(script, /IconLocation/);
  assert.match(script, /shturman\.ico/);
  assert.match(cmd.target, /Штурман\.lnk$/);
});

test('Windows: пункт меню ставится и снимается в реестре пользователя', () => {
  const add = desktop.windowsMenuCommands({ vbs: 'C:\\Sh\\l.vbs', icon: 'C:\\Sh\\i.ico' }, false);
  const del = desktop.windowsMenuCommands({ vbs: '', icon: '' }, true);
  assert.ok(add.length >= 4, 'папка и фон папки — два разных ключа');
  assert.ok(add.every((c) => c.file === 'reg'));
  assert.ok(add.some((c) => c.args.join(' ').indexOf('Открыть Штурман здесь') !== -1));
  assert.ok(add.every((c) => c.args[1].indexOf('HKCU\\') === 0), 'только ветка пользователя');
  assert.ok(del.every((c) => c.args[0] === 'delete'), 'обратная операция обязана быть');
});

// ─── ярлыки: macOS ────────────────────────────────────────────────────────

test('macOS: ярлык — это .app, значит окна терминала не будет', () => {
  const items = desktop.plan({ platform: 'darwin', root: '/Apps/Sh', home: '/Users/ok', node: '/usr/local/bin/node' });
  const paths = items.map((i) => i.path);
  assert.ok(paths.some((p) => /Штурман\.app\/Contents\/Info\.plist$/.test(p)));
  assert.ok(paths.some((p) => /Штурман\.app\/Contents\/MacOS\/shturman$/.test(p)));
  assert.ok(paths.some((p) => /shturman\.icns$/.test(p)), 'иконка бандла');
  const exe = items.find((i) => /MacOS\/shturman$/.test(i.path));
  assert.strictEqual(exe.mode, 0o755, 'исполняемый бит обязателен');
  assert.match(exe.content, /nohup/, 'процесс должен пережить закрытие');
});

test('macOS: Info.plist умеет принимать папку перетаскиванием', () => {
  const plist = desktop.macPlist();
  assert.match(plist, /<key>CFBundleExecutable<\/key><string>shturman<\/string>/);
  assert.match(plist, /public\.folder/);
  assert.match(plist, /CFBundleIconFile/);
});

test('macOS: автозапуск — LaunchAgent с RunAtLoad', () => {
  const plist = desktop.macLaunchAgent({ root: '/Apps/Sh', node: '/usr/local/bin/node' });
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /--pick/);
  assert.match(plist, /--no-open/, 'при входе в систему браузер открывать незачем');
});

test('macOS: Quick Action объявляет себя пунктом меню Finder', () => {
  const wf = desktop.macQuickAction({ launcher: '/Apps/Sh/launch', uuid: ['A', 'B', 'C'] });
  assert.match(wf, /com\.apple\.Automator\.servicesMenu/);
  assert.match(wf, /fileSystemObject\.folder/);
  assert.match(wf, /RunShellScriptAction/);
});

// ─── ярлыки: Linux ────────────────────────────────────────────────────────

test('Linux: .desktop без терминала и с иконкой', () => {
  const entry = desktop.desktopEntry({ launcher: '/opt/sh/launch.sh', icon: '/opt/sh/icon.png' });
  assert.match(entry, /^\[Desktop Entry\]/);
  assert.match(entry, /Terminal=false/, 'окна терминала быть не должно');
  assert.match(entry, /Icon=\/opt\/sh\/icon\.png/);
  assert.match(entry, /MimeType=inode\/directory/, 'папку можно бросить на ярлык');
});

test('Linux: план кладёт ярлык и на рабочий стол, и в меню приложений', () => {
  const items = desktop.plan({ platform: 'linux', root: '/opt/sh', home: '/home/ok', node: '/usr/bin/node' });
  const paths = items.map((i) => i.path);
  assert.ok(paths.some((p) => p.indexOf('/home/ok/.local/share/applications/') === 0));
  assert.ok(paths.some((p) => /Desktop\/shturman\.desktop$/.test(p)));
  assert.ok(items.every((i) => i.type !== 'command'), 'на Linux всё делается файлами');
});

test('Linux: рабочий стол берётся из настроек системы', () => {
  const home = tmpdir('xdg');
  fs.mkdirSync(path.join(home, '.config'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'user-dirs.dirs'),
    'XDG_DESKTOP_DIR="$HOME/Рабочий стол"\n');
  assert.strictEqual(desktop.desktopDir(home, 'linux'), path.join(home, 'Рабочий стол'));
  assert.strictEqual(desktop.desktopDir('/home/x', 'darwin'), '/home/x/Desktop');
});

test('Linux: пункт меню — скрипт Nautilus, и он исполняемый', () => {
  const items = desktop.plan({ platform: 'linux', root: '/opt/sh', home: '/home/ok', contextMenu: true });
  const menu = items.find((i) => i.kind === 'menu');
  assert.ok(menu, 'пункт меню должен быть в плане');
  assert.match(menu.path, /nautilus\/scripts\/Открыть Штурман здесь$/);
  assert.strictEqual(menu.mode, 0o755);
  assert.match(menu.content, /NAUTILUS_SCRIPT_CURRENT_URI/);
});

test('обратная операция снимает ровно то, что ставили', () => {
  const removal = desktop.removalPlan({ platform: 'linux', root: '/opt/sh', home: '/home/ok' }, ['menu']);
  assert.ok(removal.length > 0);
  assert.ok(removal.every((i) => i.kind === 'menu'));
  assert.ok(removal.every((i) => i.type === 'unlink' || i.type === 'command'));
});

test('автозапуск по умолчанию не ставится', () => {
  const items = desktop.plan({ platform: 'linux', root: '/opt/sh', home: '/home/ok' });
  assert.strictEqual(items.filter((i) => i.kind === 'autostart').length, 0);
  const withAuto = desktop.plan({ platform: 'linux', root: '/opt/sh', home: '/home/ok', autostart: true });
  assert.ok(withAuto.some((i) => i.kind === 'autostart' && /autostart\/shturman\.desktop$/.test(i.path)));
});

test('план исполняется и правда кладёт файлы', async () => {
  const home = tmpdir('apply');
  const root = tmpdir('root');
  const items = desktop.plan({ platform: 'linux', root: root, home: home, node: '/usr/bin/node' });
  const results = await desktop.apply(items);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  const entry = path.join(home, '.local', 'share', 'applications', 'shturman.desktop');
  assert.ok(fs.existsSync(entry));
  assert.match(fs.readFileSync(entry, 'utf8'), /Terminal=false/);
  // Повторная установка ничего не ломает.
  const again = await desktop.apply(items);
  assert.ok(again.every((r) => r.ok), 'повторный запуск установщика должен быть безопасен');
});

// ─── список проектов ──────────────────────────────────────────────────────

function fakeProjects() {
  const base = tmpdir('claude');
  const real = tmpdir('proj');
  fs.writeFileSync(path.join(real, 'package.json'), '{}');
  fs.mkdirSync(path.join(real, 'src'));
  fs.writeFileSync(path.join(real, 'src', 'a.js'), 'x');
  fs.mkdirSync(path.join(real, 'node_modules', 'junk'), { recursive: true });
  fs.writeFileSync(path.join(real, 'node_modules', 'junk', 'b.js'), 'x');

  const encoded = require('../lib/paths').encodeProjectDir(real);
  const dir = path.join(base, encoded);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sess.jsonl'),
    JSON.stringify({ type: 'user', sessionId: 's1', cwd: path.join(real, 'src') }) + '\n' +
    JSON.stringify({ type: 'assistant', sessionId: 's1', cwd: real }) + '\n');
  return { base: base, real: real, encoded: encoded, dir: dir };
}

test('путь проекта восстанавливается из cwd внутри записей', () => {
  const f = fakeProjects();
  assert.strictEqual(projects.decodePath(f.encoded, f.dir), f.real,
    'поднимаемся от cwd вверх, пока кодировка не совпадёт с именем каталога');
});

test('путь с дефисом в имени тоже восстанавливается', () => {
  const base = tmpdir('claude2');
  const parent = tmpdir('par');
  const real = path.join(parent, 'my-app');
  fs.mkdirSync(real);
  const encoded = require('../lib/paths').encodeProjectDir(real);
  const dir = path.join(base, encoded);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's.jsonl'),
    JSON.stringify({ type: 'user', cwd: real }) + '\n');
  assert.strictEqual(projects.decodePath(encoded, dir), real,
    'угадыванием по дефисам такой путь не восстановить — помогает только cwd');
});

test('список проектов собирается сам и считает файлы', () => {
  const f = fakeProjects();
  const list = projects.list({ dir: f.base });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].path, f.real);
  assert.strictEqual(list[0].sessions, 1);
  assert.strictEqual(list[0].exists, true);
  assert.strictEqual(list[0].files, 2, 'node_modules не считаем');
  assert.ok(list[0].lastSession > 0);
});

test('в список попадают и папки из настроек, где Клод не работал', () => {
  const f = fakeProjects();
  const extra = tmpdir('extra');
  const list = projects.list({ dir: f.base, recent: [{ path: extra, lastOpened: 1 }] });
  assert.strictEqual(list.length, 2);
  const found = list.find((p) => p.path === extra);
  assert.ok(found);
  assert.strictEqual(found.sessions, 0);
});

test('исчезнувшая папка остаётся в списке, но помечена', () => {
  const f = fakeProjects();
  const gone = path.join(os.tmpdir(), 'shturman-нет-такой-папки-' + Date.now());
  const list = projects.list({ dir: f.base, recent: [{ path: gone, lastOpened: 2 }] });
  const item = list.find((p) => p.path === gone);
  assert.ok(item, 'о забытой папке лучше сказать, чем молча выкинуть');
  assert.strictEqual(item.exists, false);
});

test('список отсортирован по свежести', () => {
  const f = fakeProjects();
  const old = tmpdir('old');
  const list = projects.list({ dir: f.base, recent: [{ path: old, lastOpened: 1 }] });
  assert.strictEqual(list[0].path, f.real, 'свежая сессия должна быть первой');
});

test('пустая папка Claude Code — пустой список, а не падение', () => {
  const empty = tmpdir('claude-empty');
  assert.deepStrictEqual(projects.list({ dir: empty }), []);
  assert.deepStrictEqual(projects.list({ dir: path.join(empty, 'нет-такого') }), []);
});

test('счётчик файлов не уходит в бесконечность', () => {
  const dir = tmpdir('many');
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(dir, 'f' + i + '.txt'), 'x');
  const c = projects.countFiles(dir, 5);
  assert.strictEqual(c.files, 5);
  assert.strictEqual(c.truncated, true);
});

// ─── настройки, которые появились вместе с одним кликом ──────────────────

test('конфиг помнит «сразу открывать последний» и плотность', () => {
  const dir = tmpdir('cfg');
  const loaded = config.load(dir);
  assert.strictEqual(loaded.config.openLast, true, 'по умолчанию — сразу в панель');
  assert.strictEqual(loaded.config.density, 'cozy');
  loaded.config.openLast = false;
  loaded.config.density = 'compact';
  config.save(loaded.config, dir);
  const again = config.load(dir).config;
  assert.strictEqual(again.openLast, false);
  assert.strictEqual(again.density, 'compact');
});

test('конфиг отбрасывает мусор в новых полях', () => {
  const dir = tmpdir('cfg2');
  fs.writeFileSync(path.join(dir, '.shturman.json'),
    JSON.stringify({ openLast: 'ага', density: 'огромно' }));
  const cfg = config.load(dir).config;
  assert.strictEqual(cfg.openLast, true, 'строка вместо да/нет — берём умолчание');
  assert.strictEqual(cfg.density, 'cozy');
});

// ─── стоп-сигналы ─────────────────────────────────────────────────────────

test('стоп-сигнал ловит по-настоящему опасные команды', () => {
  const dangerous = [
    'git reset --hard HEAD~1',
    'cd /app && git reset --hard',
    'git clean -fd',
    'rm -rf build',
    'sudo rm -rf /tmp/x',
    'git push --force origin main',
    'chmod -R 777 .',
    'git rebase main',
    'psql -c "DROP TABLE users"'
  ];
  dangerous.forEach((cmd) => {
    const r = risk.checkCommand(cmd);
    assert.ok(r, 'должен подняться сигнал: ' + cmd);
    assert.ok(r.title && r.why, 'у сигнала должны быть и заголовок, и объяснение: ' + cmd);
    assert.ok(r.rollback || r.rollbackNote, 'даже когда откатить нечем, надо сказать об этом: ' + cmd);
  });
});

test('стоп-сигнал молчит на безобидном', () => {
  const safe = [
    'npm test',
    'git commit -m "правки"',
    'git push --force-with-lease origin main',
    'ls -la',
    'node server.js --check',
    'git status'
  ];
  safe.forEach((cmd) => {
    assert.strictEqual(risk.checkCommand(cmd), null, 'ложная тревога на: ' + cmd);
  });
});

test('текст внутри кавычек и heredoc командой не считается', () => {
  // Ровно эти случаи и давали ложные тревоги на живом прогоне.
  const quoted = 'node -e "var cases=[[\'git reset --hard\', true], [\'rm -rf build\', true]]"';
  assert.strictEqual(risk.checkCommand(quoted), null, 'массив примеров — это данные');

  const heredoc = "python3 - <<'PY'\ns = s.replace('git reset --hard')\nPY\nnode --check x.js";
  assert.strictEqual(risk.checkCommand(heredoc), null, 'тело heredoc — это данные');

  const message = 'git commit -m "убрал git reset --hard из инструкции"';
  assert.strictEqual(risk.checkCommand(message), null, 'текст коммита — это данные');

  const grep = 'grep -rn "chmod 777" src';
  assert.strictEqual(risk.checkCommand(grep), null, 'поиск по слову — не действие');
});

test('SQL считается опасным только рядом с клиентом базы', () => {
  assert.ok(risk.checkCommand('psql -c "DROP TABLE users"'));
  assert.ok(risk.checkCommand('cat x.sql | mysql -e "DROP DATABASE app"'));
  assert.strictEqual(risk.checkCommand('node -e "[\'DROP TABLE users;\']"'), null);
  assert.strictEqual(risk.checkCommand('echo DROP TABLE'), null);
});

test('удалённый файл поднимает сигнал с командой возврата', () => {
  const r = risk.check({ kind: 'file', action: 'deleted', file: 'src/app.js' });
  assert.ok(r);
  assert.strictEqual(r.rollback, 'git checkout -- src/app.js');
  const none = risk.check({ kind: 'file', action: 'changed', file: 'src/app.js' });
  assert.strictEqual(none, null, 'изменение файла — обычное дело, не сигнал');
});

test('у каждого файла есть команда возврата для карточки', () => {
  const r = risk.rollbackForFile('public/app.js');
  assert.strictEqual(r.rollback, 'git checkout -- public/app.js');
  assert.ok(r.rollbackNote.length > 20, 'к команде нужно пояснение, иначе она страшнее пользы');
  assert.strictEqual(risk.rollbackForFile(''), null);
});

test('все правила стоп-сигналов оформлены одинаково', () => {
  assert.ok(risk.RULES.length >= 8, 'правил должно быть заметно больше горстки');
  const ids = new Set();
  risk.RULES.forEach((rule) => {
    assert.ok(rule.id && !ids.has(rule.id), 'идентификаторы правил уникальны: ' + rule.id);
    ids.add(rule.id);
    assert.ok(rule.test instanceof RegExp);
    assert.ok(rule.level === 'warn' || rule.level === 'danger');
    assert.ok(rule.title.length > 10, rule.id + ': заголовок слишком короткий');
    assert.ok(rule.why.length > 30, rule.id + ': объяснение слишком короткое');
    assert.ok(rule.rollbackNote, rule.id + ': нужно сказать, что будет после отката');
  });
});

// ─── «Клод работает в другой папке» ───────────────────────────────────────

test('чужая свежая сессия замечена и названа своим путём', () => {
  const f = fakeProjects();
  const found = projects.activeElsewhere({ dir: f.base, exclude: '/нет/такого/проекта' });
  assert.ok(found, 'запись только что создана — сессия считается живой');
  assert.strictEqual(found.path, f.real);
  assert.strictEqual(found.name, path.basename(f.real));
  assert.ok(found.at > 0);
});

test('своя же папка чужой не считается', () => {
  const f = fakeProjects();
  assert.strictEqual(projects.activeElsewhere({ dir: f.base, exclude: f.real }), null,
    'иначе панель предлагала бы переключиться на саму себя');
});

test('старая сессия не поднимает предложение переключиться', () => {
  const f = fakeProjects();
  const stale = projects.activeElsewhere({
    dir: f.base, exclude: '/другое', now: Date.now() + 10 * 60 * 1000
  });
  assert.strictEqual(stale, null, 'вчерашняя работа — не повод дёргать человека');
});

test('пустой каталог Claude Code не ломает поиск чужой сессии', () => {
  const empty = tmpdir('elsewhere-empty');
  assert.strictEqual(projects.activeElsewhere({ dir: empty, exclude: '/x' }), null);
  assert.strictEqual(projects.activeElsewhere({
    dir: path.join(empty, 'нет-такого'), exclude: '/x'
  }), null);
});

test('из двух чужих папок выбрана самая свежая', () => {
  const a = fakeProjects();
  const b = fakeProjects();
  // Переносим записи второго проекта в тот же каталог и делаем их свежее.
  const moved = path.join(a.base, b.encoded);
  fs.mkdirSync(moved, { recursive: true });
  fs.copyFileSync(path.join(b.dir, 'sess.jsonl'), path.join(moved, 'sess.jsonl'));
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(moved, 'sess.jsonl'), future, future);

  const found = projects.activeElsewhere({
    dir: a.base, exclude: '/нет/такого', now: Date.now() + 6000
  });
  assert.strictEqual(found.path, b.real, 'предлагать надо ту папку, где работа идёт прямо сейчас');
});

// ─── отдельное окно (режим киоска) ────────────────────────────────────────

test('отдельное окно — сохраняемая настройка, а не только флаг', () => {
  const dir = tmpdir('cfg-app');
  const cfg = config.load(dir).config;
  assert.strictEqual(cfg.appWindow, false, 'по умолчанию обычная вкладка');
  cfg.appWindow = true;
  config.save(cfg, dir);
  assert.strictEqual(config.load(dir).config.appWindow, true);
});

test('настройка отдельного окна включает режим киоска без флага', () => {
  const args = require('../lib/args');
  const plain = args.applyConfig(args.parse([]), { appWindow: true });
  assert.strictEqual(plain.app, true, 'включить киоск можно из панели, не открывая терминал');
  const off = args.applyConfig(args.parse([]), { appWindow: false });
  assert.strictEqual(off.app, false);
  const flag = args.applyConfig(args.parse(['--app']), { appWindow: false });
  assert.strictEqual(flag.app, true, 'флаг сильнее выключенной настройки');
});

// ─── шпаргалка в шапке ────────────────────────────────────────────────────

test('три слова шпаргалки есть в словаре', () => {
  const copySrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'copy.js'), 'utf8');
  const m = /basics:\s*\[([^\]]+)\]/.exec(copySrc);
  assert.ok(m, 'список основ должен жить в словаре интерфейса, а не в app.js');
  const ids = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  assert.strictEqual(ids.length, 3, 'шпаргалка ровно на три слова: больше не читают');
  const glossary = require('../lib/glossary');
  ids.forEach((id) => {
    assert.ok(glossary.get(id), 'в словаре нет термина «' + id + '»');
  });
});
