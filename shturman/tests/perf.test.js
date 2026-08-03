// Тесты производительности.
//
// Смысл: тормоза должны ломать сборку, а не копиться незаметно. Здесь
// проверяется не «быстро ли работает на этой машине» (такой тест зелёный на
// сильной и красный на слабой), а **устройство**: не растёт ли буфер, не
// уходит ли в провод лишнее, склеиваются ли параллельные вызовы, режется ли
// снимок. Замеры времени живут в стенде `npm run bench`, где им и место.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const wire = require('../lib/wire');
const bus = require('../lib/bus');
const config = require('../lib/config');
const git = require('../lib/git');

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shturman-perf-' + prefix + '-'));
}

// ─── что уходит по проводу ────────────────────────────────────────────────

test('сырая запись транскрипта не уходит в браузер', () => {
  const ev = { id: 1, kind: 'tool', title: 'x', raw: { huge: 'я'.repeat(200000) } };
  const out = wire.slim(ev);
  assert.strictEqual(out.raw, undefined, 'поле raw весило до 159 КБ и не читалось клиентом');
  assert.strictEqual(out.title, 'x', 'остальное на месте');
  assert.ok(ev.raw, 'оригинал в буфере не тронут — он нужен для /api/event');
});

test('длинный вывод обрезается и помечается', () => {
  const long = 'a'.repeat(wire.LIMITS.output + 5000);
  const out = wire.slim({ id: 2, kind: 'result', output: long });
  assert.strictEqual(out.output.length, wire.LIMITS.output);
  assert.strictEqual(out.cut.output, long.length, 'клиенту видно, сколько скрыто');
});

test('короткое событие не копируется зря', () => {
  const ev = { id: 3, kind: 'file', file: 'a.js' };
  assert.strictEqual(wire.slim(ev), ev, 'резать нечего — отдаём тот же объект');
});

test('снимок отдаёт последние события, а не всю историю', () => {
  const list = [];
  for (let i = 0; i < 500; i++) list.push({ id: i, kind: 'tool', raw: { big: 'x'.repeat(1000) } });
  const snap = wire.snapshotSlice(list);
  assert.strictEqual(snap.length, wire.SNAPSHOT_EVENTS);
  assert.strictEqual(snap[snap.length - 1].id, 499, 'отдаются именно последние');
  assert.ok(snap.every((e) => e.raw === undefined));
});

test('снимок короткой истории отдаётся целиком', () => {
  const list = [{ id: 1, kind: 'tool' }, { id: 2, kind: 'tool' }];
  assert.strictEqual(wire.snapshotSlice(list).length, 2);
});

test('обрезка уменьшает снимок на порядок', () => {
  const list = [];
  for (let i = 0; i < 500; i++) {
    list.push({ id: i, kind: 'tool', title: 'правка', raw: { patch: 'строка\n'.repeat(4000) } });
  }
  const before = JSON.stringify(list).length;
  const after = JSON.stringify(wire.snapshotSlice(list)).length;
  assert.ok(after * 20 < before,
    'снимок был 3.3 МБ; должен ужаться минимум в двадцать раз, а ужался в ' +
    Math.round(before / after));
});

// ─── буфер событий ────────────────────────────────────────────────────────

test('кольцевой буфер не растёт', () => {
  const b = bus.createBus({ bufferSize: 50 });
  for (let i = 0; i < 5000; i++) b.publish({ kind: 'file', action: 'changed', file: 'f' + i + '.js' });
  assert.strictEqual(b.size(), 50, 'после пяти тысяч событий в буфере ровно потолок');
});

test('в буфере остаются самые свежие события', () => {
  const b = bus.createBus({ bufferSize: 10 });
  for (let i = 0; i < 100; i++) b.publish({ kind: 'file', action: 'changed', file: 'f' + i + '.js' });
  const all = b.all();
  assert.strictEqual(all.length, 10);
  assert.ok(all[all.length - 1].file.indexOf('99') !== -1);
});

test('одно событие достаётся по номеру целиком', () => {
  const b = bus.createBus({ bufferSize: 10 });
  const ev = b.publish({ kind: 'tool', action: 'run', command: 'ls', raw: { keep: 'меня' } });
  const got = b.get(ev.id);
  assert.strictEqual(got.raw.keep, 'меня', 'на сервере событие лежит целым');
  assert.strictEqual(b.get(999999), null);
});

test('история отдаётся кусками для подгрузки прокруткой', () => {
  const b = bus.createBus({ bufferSize: 100 });
  for (let i = 0; i < 100; i++) b.publish({ kind: 'file', action: 'changed', file: 'f' + i + '.js' });
  const last = b.lastId();
  const chunk = b.before(last - 10, 20);
  assert.strictEqual(chunk.length, 20);
  assert.ok(chunk[chunk.length - 1].id < last - 10, 'отдано именно то, что раньше указанного');
  assert.ok(chunk[0].id < chunk[chunk.length - 1].id, 'в порядке от старых к новым');
});

test('подгрузка не отдаёт больше разумного за раз', () => {
  const b = bus.createBus({ bufferSize: 1000 });
  for (let i = 0; i < 1000; i++) b.publish({ kind: 'file', action: 'changed', file: 'f' + i + '.js' });
  assert.ok(b.before(0, 100000).length <= 500, 'потолок куска защищает от запроса «отдай всё»');
});

// ─── кэш git ──────────────────────────────────────────────────────────────

test('снимок git не считается дважды подряд', async () => {
  const dir = tmpdir('git');
  const a = git.snapshotCached(dir);
  const b = git.snapshotCached(dir);
  assert.strictEqual(a, b, 'параллельные вызовы склеиваются в один промис');
  await a;
});

test('повторный снимок берётся из кэша', async () => {
  const dir = tmpdir('git2');
  const first = await git.snapshotCached(dir);
  const second = await git.snapshotCached(dir);
  assert.strictEqual(first, second, 'тот же объект — значит git не запускался заново');
});

test('отпечаток .git меняется вместе с содержимым', () => {
  const dir = tmpdir('git3');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const a = git.gitFingerprint(dir);
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/other\n');
  assert.notStrictEqual(git.gitFingerprint(dir), a);
});

test('пометка «изменилось» заставляет пересчитать', async () => {
  const dir = tmpdir('git4');
  const first = await git.snapshotCached(dir);
  git.markDirty(dir);
  await new Promise((r) => setTimeout(r, git.MIN_INTERVAL_MS + 50));
  const second = await git.snapshotCached(dir);
  assert.notStrictEqual(first, second, 'после правки файла счётчик несохранённого пересчитывается');
});

// ─── профили скорости ─────────────────────────────────────────────────────

test('профиль скорости сохраняется и читается', () => {
  const dir = tmpdir('cfg');
  const cfg = config.load(dir).config;
  assert.strictEqual(cfg.perf.profile, 'auto', 'по умолчанию панель подбирает профиль сама');
  cfg.perf = { profile: 'weak', animations: false, heat: false, feedLimit: 300, frameMs: 1000, bigDiffs: false, highlight: false };
  config.save(cfg, dir);
  const back = config.load(dir).config.perf;
  assert.strictEqual(back.profile, 'weak');
  assert.strictEqual(back.feedLimit, 300);
  assert.strictEqual(back.frameMs, 1000);
});

test('чужие значения профиля заменяются умолчаниями', () => {
  const bad = config.merge({ perf: { profile: 'сверхбыстро', feedLimit: 999999, frameMs: -5, animations: 'да' } });
  assert.strictEqual(bad.perf.profile, 'auto');
  assert.strictEqual(bad.perf.feedLimit, 1500);
  assert.strictEqual(bad.perf.frameMs, 0);
  assert.strictEqual(bad.perf.animations, true);
});

test('все три профиля дают полный набор настроек', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const m = /var PERF_PROFILES = \{([\s\S]*?)\n  \};/.exec(src);
  assert.ok(m, 'профили должны лежать одним объявлением, а не рассыпаться по коду');
  ['smooth', 'thrifty', 'weak'].forEach((name) => {
    const line = new RegExp(name + ':\\s*\\{([^}]*)\\}').exec(m[1]);
    assert.ok(line, 'нет профиля ' + name);
    ['animations', 'heat', 'feedLimit', 'frameMs', 'bigDiffs', 'highlight'].forEach((key) => {
      assert.ok(line[1].indexOf(key) !== -1,
        'в профиле ' + name + ' не задано «' + key + '» — значит он унаследует чужое значение');
    });
  });
});

test('«Слабое устройство» экономит, но ничего не выключает из функций', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const weak = /weak:\s*\{([^}]*)\}/.exec(src)[1];
  assert.ok(/animations: false/.test(weak));
  assert.ok(/heat: false/.test(weak));
  // Разделы, фильтры и словарь не должны зависеть от профиля вовсе:
  // ускорение вырезанием возможностей — это обход задачи, а не решение.
  assert.ok(!/tabs|filters|glossary/.test(weak),
    'профиль не имеет права отключать разделы и функции');
});

// ─── виртуализация ────────────────────────────────────────────────────────

test('дерево файлов виртуализировано распорками', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(/id="treeTop"/.test(html) && /id="treeRows"/.test(html) && /id="treeBottom"/.test(html),
    'без распорок дерево на 5000 файлов давало 36 352 узла разметки');
});

test('лента и дерево рисуют окно, а не весь список', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(/function renderWindow\(\)/.test(src), 'окно ленты');
  assert.ok(/function renderTreeWindow\(/.test(src), 'окно дерева');
  assert.ok(/OVERSCAN/.test(src) && /TREE_OVERSCAN/.test(src), 'запас по краям окна');
});

test('события выливаются кадром, а не по одному', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(/function scheduleFeedFlush\(\)/.test(src));
  assert.ok(/requestAnimationFrame\(flushFeed\)/.test(src),
    'отрисовка должна проходить через кадр, иначе шторм даст двадцать перерисовок в секунду');
  assert.ok(/document\.hidden/.test(src), 'скрытая вкладка не рисует');
});

test('тепловая подсветка обходит только отрисованные строки', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const fn = /function applyHeat\(\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.ok(/treeRows\.children/.test(fn),
    'обход всех .node стоил 30 мс на каждое файловое событие');
  assert.ok(!/querySelectorAll\('\.node'\)/.test(fn));
});

// ─── стенд ────────────────────────────────────────────────────────────────

test('стенд собирается и содержит обещанное', () => {
  const fixture = require('../bench/fixture');
  const home = tmpdir('bench-home');
  const project = tmpdir('bench-proj');
  const fx = fixture.build({ files: 60, events: 120, bigDiffLines: 100, bigFileKb: 10, home, project });
  assert.ok(fx.files >= 60);
  assert.strictEqual(fx.events, 120);
  assert.ok(fx.transcriptBytes > 1000);
  // Каталоги, которые обязаны игнорироваться, — на месте: без них стенд не
  // проверяет игнор-листы вотчера.
  assert.ok(fs.existsSync(path.join(project, 'node_modules')));
  assert.ok(fs.existsSync(path.join(project, '.git')));
  fixture.cleanup(fx);
});

test('стенд детерминирован: два прогона дают одинаковые данные', () => {
  const fixture = require('../bench/fixture');
  const make = () => {
    const home = tmpdir('det-home');
    const project = tmpdir('det-proj');
    const fx = fixture.build({ files: 40, events: 60, bigDiffLines: 50, bigFileKb: 5, home, project });
    const body = fs.readFileSync(fx.transcript, 'utf8')
      .replace(/"timestamp":"[^"]+"/g, '')      // время, понятно, разное
      .replace(new RegExp(project, 'g'), 'PROJ');
    fixture.cleanup(fx);
    return body;
  };
  assert.strictEqual(make(), make(),
    'без одинаковых данных сравнивать «до» и «после» нельзя');
});

test('бюджеты объявлены и проверяются прогоном стенда', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bench', 'run.js'), 'utf8');
  const m = /function checkBudgets\(o\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(m, 'сверка с бюджетами должна жить в самом прогоне');
  ['первый экран', 'самая долгая задача', 'задержка события', 'карточек ленты',
    'процессор сервера', 'рост кучи'].forEach((name) => {
    assert.ok(m[0].indexOf(name) !== -1, 'нет бюджета: ' + name);
  });
  assert.ok(/process\.exitCode = bad\.length \? 1 : 0/.test(src),
    'превышенный бюджет обязан ронять прогон, иначе тормоза копятся незаметно');
});
