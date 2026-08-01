// Проверки дизайн-системы: то, что глазами не увидишь, а разъезжается
// незаметно. Три группы, все три требует задание 3:
//
//   1. токены объявлены в обеих темах и не пропали;
//   2. в компонентах и раскладке нет ни одного хардкод-цвета;
//   3. все строки интерфейса приходят из общего словаря.
//
// Проверяем исходники, а не браузер: эти правила должны ломать сборку сразу,
// а не через один живой прогон.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const tokens = read('tokens.css');
const components = read('components.css');
const styles = read('styles.css');
const appJs = read('app.js');
const copyJs = read('copy.js');
const iconsJs = read('icons.js');
const html = read('index.html');

// ─── 1. Токены ────────────────────────────────────────────────────────────

/** Имена переменных, объявленных внутри одного блока `{ … }`. */
function declaredIn(css, selector) {
  const at = css.indexOf(selector);
  if (at === -1) return null;
  const open = css.indexOf('{', at);
  let depth = 0, end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = css.slice(open + 1, end);
  return new Set((body.match(/--[\w-]+(?=\s*:)/g) || []));
}

test('палитра объявлена в обеих темах одинаковым набором имён', () => {
  const src = strip(tokens);
  const dark = declaredIn(src, ':root[data-theme="dark"]');
  const light = declaredIn(src, ':root[data-theme="light"]');
  const auto = declaredIn(src, ':root:not([data-theme="dark"])');

  assert.ok(dark && light && auto, 'должны быть блоки тёмной, светлой и системной темы');
  assert.deepStrictEqual([...light].sort(), [...dark].sort(),
    'светлая тема должна объявлять ровно те же токены, что и тёмная');
  assert.deepStrictEqual([...auto].sort(), [...dark].sort(),
    'системная светлая тема не должна отставать от ручной');
});

test('базовая палитра — шесть названных цветов и их тона', () => {
  const base = ['--c-bg', '--c-panel', '--c-ink', '--c-brass', '--c-sea', '--c-coral'];
  const dark = declaredIn(strip(tokens), ':root[data-theme="dark"]');
  base.forEach((name) => assert.ok(dark.has(name), 'нет цвета ' + name));
});

test('каждая использованная переменная где-то объявлена', () => {
  const declared = new Set((strip(tokens).match(/--[\w-]+(?=\s*:)/g) || []));
  // Локальные переменные компонентов объявляются инлайном из JS.
  const local = new Set(['--heat', '--fresh', '--reveal-delay']);
  const used = new Set();
  [components, styles].forEach((css) => {
    (strip(css).match(/var\(\s*(--[\w-]+)/g) || []).forEach((m) => {
      used.add(m.replace(/var\(\s*/, ''));
    });
  });
  const missing = [...used].filter((v) => !declared.has(v) && !local.has(v));
  assert.deepStrictEqual(missing, [], 'использованы необъявленные токены: ' + missing.join(', '));
});

test('шкалы не разъехались: шесть кеглей, шесть отступов, три скругления', () => {
  const src = strip(tokens);
  ['--t-dial', '--t-read', '--t-title', '--t-body', '--t-note', '--t-fine']
    .forEach((t) => assert.ok(src.includes(t + ':'), 'нет ступени кегля ' + t));
  ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6']
    .forEach((t) => assert.ok(src.includes(t + ':'), 'нет ступени отступа ' + t));
  ['--r-sm', '--r-md', '--r-pill']
    .forEach((t) => assert.ok(src.includes(t + ':'), 'нет скругления ' + t));
  assert.ok(/--t-fine:\s*15px/.test(src.split('@media (max-width: 900px)')[1] || ''),
    'на телефоне служебный текст обязан подрастать до 15px');
});

test('плотность меняет только воздух', () => {
  const src = strip(tokens);
  assert.ok(/--density:\s*1;/.test(src), 'нет плотности по умолчанию');
  assert.ok(/\[data-density="compact"\][^{]*\{\s*--density:/.test(src), 'нет компактного режима');
  // Кегли, зоны касания и толщины не имеют права умножаться на плотность.
  const scaled = src.match(/--(t-\w+|touch|hair):[^;]*var\(--density\)/g) || [];
  assert.deepStrictEqual(scaled, [], 'плотность не должна влиять на ' + scaled.join(', '));
});

test('reduced-motion гасит движение и объявлен в токенах', () => {
  const src = strip(tokens);
  assert.ok(src.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(/animation-duration:\s*\.001ms\s*!important/.test(src));
  assert.ok(/transition-duration:\s*\.001ms\s*!important/.test(src));
});

// ─── 2. Никакого хардкода цвета вне токенов ───────────────────────────────

const COLOR_RE = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\blab\()/g;

for (const [name, css] of [['components.css', components], ['styles.css', styles]]) {
  test('в ' + name + ' нет ни одного цвета значением', () => {
    const found = strip(css).match(COLOR_RE) || [];
    assert.deepStrictEqual(found, [],
      'цвета живут только в tokens.css, а здесь нашлось: ' + found.join(', '));
  });
}

test('в разметке нет инлайновых стилей с цветом', () => {
  const inline = html.match(/style="[^"]*"/g) || [];
  const bad = inline.filter((s) => COLOR_RE.test(s));
  assert.deepStrictEqual(bad, [], 'инлайновые цвета в разметке: ' + bad.join(', '));
});

test('КАПС с разрядкой не вернулся', () => {
  const bad = [components, styles].flatMap((css) =>
    (strip(css).match(/text-transform:\s*uppercase/g) || []));
  assert.deepStrictEqual(bad, [], 'система запрещает подписи капсом (DESIGN.md, раздел 2)');
});

test('у панелей нет рамок: принцип разделения один', () => {
  const src = strip(components);
  const panel = src.slice(src.indexOf('.panel {'), src.indexOf('.panel__head'));
  assert.ok(!/border:/.test(panel) || /border:\s*0/.test(panel),
    'панель разделяется подложкой и воздухом, а не обводкой');
});

// ─── 3. Строки интерфейса — только из словаря ─────────────────────────────

/** Убирает комментарии, оставляя код: комментарии у нас по-русски. */
function code(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      // Простое, но достаточное правило: строк с '//' внутри строковых
      // литералов в этом файле нет, кроме URL — их и оставляем.
      const at = line.indexOf('//');
      if (at === -1) return line;
      if (/https?:$/.test(line.slice(0, at))) return line;
      return line.slice(0, at);
    })
    .join('\n');
}

test('в app.js нет русских строк — вся речь идёт через словарь', () => {
  const src = code(appJs);
  const literals = src.match(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g) || [];
  const russian = literals.filter((s) => /[а-яёА-ЯЁ]/.test(s));
  assert.deepStrictEqual(russian, [],
    'эти строки должны переехать в copy.js: ' + russian.join(' | '));
});

test('в icons.js тоже нет русских строк, кроме таблицы эмодзи', () => {
  const src = code(iconsJs);
  const literals = src.match(/(['"])(?:\\.|(?!\1)[^\\\n])*\1/g) || [];
  const russian = literals.filter((s) => /[а-яёА-ЯЁ]/.test(s));
  assert.deepStrictEqual(russian, [], 'значки не должны нести текст: ' + russian.join(' | '));
});

/** Загружает словарь так же, как это делает браузер. */
function loadCopy() {
  const sandbox = { window: {} };
  // eslint-disable-next-line no-new-func
  new Function('window', copyJs)(sandbox.window);
  return sandbox.window.COPY;
}

test('словарь загружается и разбит по местам интерфейса', () => {
  const C = loadCopy();
  assert.ok(C, 'copy.js должен положить словарь в window.COPY');
  ['app', 'rose', 'tabs', 'head', 'feed', 'map', 'git', 'pulse', 'event', 'file',
    'diff', 'glossary', 'digest', 'connect', 'settings', 'more', 'alarm',
    'archive', 'tour', 'welcome', 'errors', 'common', 'units', 'words']
    .forEach((k) => assert.ok(C[k], 'в словаре нет группы ' + k));
});

/** Достаёт значение по пути «feed.title». */
function at(obj, dotted) {
  return dotted.split('.').reduce((n, k) => (n == null ? n : n[k]), obj);
}

test('каждый ключ, который просит код, есть в словаре', () => {
  const C = loadCopy();
  const used = new Set();
  (code(appJs).match(/\bC\.([A-Za-z][\w.]*)/g) || []).forEach((m) => {
    // Отбрасываем вызов: C.feed.paused(n) → feed.paused
    used.add(m.slice(2).replace(/\.$/, ''));
  });
  assert.ok(used.size > 80, 'ожидали, что кода со словарём много, а нашли ' + used.size);
  const missing = [...used].filter((p) => at(C, p) === undefined);
  assert.deepStrictEqual(missing, [], 'нет в словаре: ' + missing.join(', '));
});

test('каждый data-copy в разметке разрешается в строку', () => {
  const C = loadCopy();
  const paths = (html.match(/data-copy(?:-label|-ph)?="([^"]+)"/g) || [])
    .map((m) => m.replace(/.*="/, '').replace('"', ''));
  assert.ok(paths.length > 25, 'разметка должна брать подписи из словаря');
  const bad = paths.filter((p) => typeof at(C, p) !== 'string' || !at(C, p).trim());
  assert.deepStrictEqual(bad, [], 'пустые подписи на экране: ' + bad.join(', '));
});

test('в словаре не копятся мёртвые формулировки', () => {
  const C = loadCopy();
  const usedInCode = code(appJs).match(/\bC\.([A-Za-z][\w.]*)/g) || [];
  const usedInHtml = html.match(/data-copy(?:-label|-ph)?="([^"]+)"/g) || [];
  const haystack = usedInCode.join(' ') + ' ' + usedInHtml.join(' ');

  const dead = [];
  (function walk(node, prefix) {
    Object.keys(node).forEach((key) => {
      const full = prefix ? prefix + '.' + key : key;
      const value = node[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) return walk(value, full);
      // Группа целиком может использоваться как объект: C.feed.filters[key].
      if (haystack.includes(full) || haystack.includes(prefix)) return;
      dead.push(full);
    });
  })(C, '');
  assert.deepStrictEqual(dead, [], 'этих слов никто не показывает: ' + dead.join(', '));
});

// ─── 4. Фирменный элемент ─────────────────────────────────────────────────

test('картушка описана во всех состояниях', () => {
  const C = loadCopy();
  const states = ['working', 'waiting', 'ended', 'idle', 'offline'];
  states.forEach((s) => assert.ok(C.rose[s], 'у картушки нет слова для состояния ' + s));

  const css = strip(components);
  states.forEach((s) => {
    if (s === 'idle') return;                     // «наготове» рисуется как «тихо»
    assert.ok(css.includes('[data-state="' + s + '"]'),
      'в оформлении нет состояния картушки ' + s);
  });
  // Три канала различения: движение, цвет, форма.
  assert.ok(/roseSweep/.test(css), 'нет обхода круга («работает»)');
  assert.ok(/roseBreath/.test(css), 'нет дыхания («ждёт вас»)');
  assert.ok(/stroke-dasharray/.test(css), 'нет пунктира («нет связи»)');
});

test('разметка картушки на месте и объявлена как живой статус', () => {
  assert.ok(/id="rose"[^>]*role="status"/.test(html.replace(/\s+/g, ' ')),
    'картушка обязана быть role="status" с aria-live');
  ['dial__ring', 'dial__disc', 'dial__sweep', 'dial__halo', 'dial__mark']
    .forEach((c) => assert.ok(html.includes(c), 'в картушке нет слоя ' + c));
});

// ─── 5. Значки ────────────────────────────────────────────────────────────

test('эмодзи ушли из разметки и из кода панели', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  const badHtml = (html.match(/>[^<]+</g) || []).filter((t) => emoji.test(t));
  assert.deepStrictEqual(badHtml, [], 'эмодзи в разметке: ' + badHtml.join(' '));
  const badJs = (code(appJs).match(/(['"])(?:\\.|(?!\1)[^\\\n])*\1/g) || [])
    .filter((s) => emoji.test(s));
  assert.deepStrictEqual(badJs, [], 'эмодзи в коде панели: ' + badJs.join(' '));
});

test('каждый значок, который просит код, нарисован', () => {
  const drawn = new Set();
  const block = iconsJs.slice(iconsJs.indexOf('var PATHS'), iconsJs.indexOf('var FROM_GLYPH'));
  (block.match(/^\s{4}'?([\w-]+)'?:\s*\[/gm) || []).forEach((m) => {
    drawn.add(m.trim().replace(/'/g, '').replace(':', '').replace('[', '').trim());
  });
  assert.ok(drawn.size >= 40, 'значков должно быть много, а нашли ' + drawn.size);

  const asked = new Set();
  (code(appJs).match(/icon\('([\w-]+)'/g) || []).forEach((m) => asked.add(m.slice(6, -1)));
  (html.match(/data-icon="([\w-]+)"/g) || []).forEach((m) => asked.add(m.slice(11, -1)));
  const missing = [...asked].filter((n) => !drawn.has(n));
  assert.deepStrictEqual(missing, [], 'этих значков нет: ' + missing.join(', '));
});

test('таблица «эмодзи сервера → значок» ведёт в нарисованные значки', () => {
  const block = iconsJs.slice(iconsJs.indexOf('var PATHS'), iconsJs.indexOf('var FROM_GLYPH'));
  const drawn = new Set((block.match(/^\s{4}'?([\w-]+)'?:\s*\[/gm) || [])
    .map((m) => m.trim().replace(/'/g, '').replace(':', '').replace('[', '').trim()));

  const table = iconsJs.slice(iconsJs.indexOf('var FROM_GLYPH'), iconsJs.indexOf('function svg'));
  const targets = (table.match(/:\s*'([\w-]+)'/g) || []).map((m) => m.replace(/[:'\s]/g, ''));
  assert.ok(targets.length > 30, 'словарь сервера богаче, чем таблица перевода');
  const missing = targets.filter((n) => !drawn.has(n));
  assert.deepStrictEqual(missing, [], 'перевод ведёт в никуда: ' + missing.join(', '));
});

// ─── 6. Оболочка ──────────────────────────────────────────────────────────

test('service worker кэширует всю новую оболочку', () => {
  const sw = read('sw.js');
  ['/tokens.css', '/components.css', '/styles.css', '/copy.js', '/icons.js', '/app.js']
    .forEach((f) => assert.ok(sw.includes("'" + f + "'"), 'в кэше оболочки нет ' + f));
});

test('офлайн-страница живёт на тех же токенах', () => {
  const off = read('offline.html');
  assert.ok(off.includes('href="/tokens.css"'), 'офлайн-страница должна брать токены');
  const found = strip(off.slice(off.indexOf('<style>'), off.indexOf('</style>'))).match(COLOR_RE) || [];
  assert.deepStrictEqual(found, [], 'на офлайн-странице свои цвета: ' + found.join(', '));
});

test('страница-витрина показывает компоненты и токены', () => {
  const page = read('design.html');
  ['tokens.css', 'components.css', 'rose', 'btn', 'pill', 'badge', 'empty', 'diff']
    .forEach((k) => assert.ok(page.includes(k), 'в витрине нет ' + k));
});
