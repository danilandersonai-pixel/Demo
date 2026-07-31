'use strict';

// Тесты кроссплатформенной работы с путями и списка игнорируемого.
// Часть проверок зависит от разделителя текущей ОС — они помечены и
// выполняются только там, где имеют смысл.

var test = require('node:test');
var assert = require('node:assert');
var path = require('node:path');
var paths = require('../lib/paths');
var ignore = require('../lib/ignore');

var isWin = process.platform === 'win32';

test('toPosix приводит разделители к прямому слешу', function () {
  assert.strictEqual(paths.toPosix('a/b/c.js'), 'a/b/c.js');
  assert.strictEqual(paths.toPosix('a\\b\\c.js'), 'a/b/c.js', 'путь Windows');
  assert.strictEqual(paths.toPosix('C:\\Users\\Оля\\proj\\src\\app.js'),
    'C:/Users/Оля/proj/src/app.js');
  assert.strictEqual(paths.toPosix(''), '');
  assert.strictEqual(paths.toPosix(null), '');
});

test('baseName берёт последний сегмент при любом разделителе', function () {
  assert.strictEqual(paths.baseName('a/b/c.js'), 'c.js');
  assert.strictEqual(paths.baseName('a\\b\\c.js'), 'c.js');
  assert.strictEqual(paths.baseName('одиночный.txt'), 'одиночный.txt');
  assert.strictEqual(paths.baseName('C:\\проект\\файл с пробелом.md'), 'файл с пробелом.md');
});

test('extOf возвращает расширение в нижнем регистре без точки', function () {
  assert.strictEqual(paths.extOf('a/b/App.JS'), 'js');
  assert.strictEqual(paths.extOf('styles.min.css'), 'css');
  assert.strictEqual(paths.extOf('Makefile'), '', 'файл без расширения');
  assert.strictEqual(paths.extOf('.gitignore'), '', 'точка в начале — не расширение');
  assert.strictEqual(paths.extOf('a\\b\\c.TXT'), 'txt');
});

test('dirOf возвращает каталог в posix-виде', function () {
  assert.strictEqual(paths.dirOf('a/b/c.js'), 'a/b');
  assert.strictEqual(paths.dirOf('a\\b\\c.js'), 'a/b');
  assert.strictEqual(paths.dirOf('корень.js'), '');
});

test('relativeToProject: файл внутри проекта', function () {
  var root = path.resolve('/tmp/проект');
  var inside = path.join(root, 'src', 'app.js');
  assert.strictEqual(paths.relativeToProject(root, inside), 'src/app.js');
  assert.strictEqual(paths.relativeToProject(root, root), '.');
});

test('relativeToProject: выход за пределы проекта отвергается', function () {
  var root = path.resolve('/tmp/проект');
  var outside = path.resolve('/tmp/чужое/секрет.txt');
  assert.strictEqual(paths.relativeToProject(root, outside), null);
  assert.strictEqual(paths.relativeToProject(root, path.join(root, '..', 'сосед.txt')), null);
  assert.strictEqual(paths.isInsideProject(root, outside), false);
  assert.strictEqual(paths.isInsideProject(root, path.join(root, 'ok.txt')), true);
});

test('relativeToProject: пустые аргументы', function () {
  assert.strictEqual(paths.relativeToProject(null, 'a'), null);
  assert.strictEqual(paths.relativeToProject('/tmp', null), null);
});

test('encodeProjectDir кодирует путь так же, как Claude Code', function () {
  if (isWin) {
    assert.strictEqual(paths.encodeProjectDir('C:\\Users\\ok\\proj'), 'C--Users-ok-proj');
  } else {
    assert.strictEqual(paths.encodeProjectDir('/home/user/Demo'), '-home-user-Demo');
    assert.strictEqual(paths.encodeProjectDir('/home/user/my.app'), '-home-user-my-app');
  }
  // Правило одно на всех платформах: не буквенно-цифровое → дефис.
  var encoded = paths.encodeProjectDir(path.resolve('a b/c.d'));
  assert.ok(/^[A-Za-z0-9-]+$/.test(encoded), 'в имени только буквы, цифры и дефисы: ' + encoded);
});

test('claudeHome уважает CLAUDE_CONFIG_DIR', function () {
  var saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join('/tmp', 'своя-папка');
  assert.strictEqual(paths.claudeHome(), path.join('/tmp', 'своя-папка'));
  assert.strictEqual(paths.claudeProjectsDir(), path.join('/tmp', 'своя-папка', 'projects'));
  if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = saved;
});

test('ignore: служебные каталоги отбрасываются на любой глубине', function () {
  assert.strictEqual(ignore.isIgnored('node_modules/react/index.js'), true);
  assert.strictEqual(ignore.isIgnored('packages/ui/node_modules/x/y.js'), true,
    'вложенный node_modules тоже');
  assert.strictEqual(ignore.isIgnored('.git/HEAD'), true);
  assert.strictEqual(ignore.isIgnored('dist/bundle.js'), true);
  assert.strictEqual(ignore.isIgnored('src/dist-utils.js'), false,
    'похожее имя — не повод игнорировать');
});

test('ignore: временные файлы и свопы редакторов', function () {
  assert.strictEqual(ignore.isIgnored('src/.app.js.swp'), true);
  assert.strictEqual(ignore.isIgnored('src/app.js~'), true);
  assert.strictEqual(ignore.isIgnored('src/#app.js#'), true);
  assert.strictEqual(ignore.isIgnored('build.log'), true);
  assert.strictEqual(ignore.isIgnored('package-lock.json'), false,
    'lock игнорируем только по расширению .lock');
  assert.strictEqual(ignore.isIgnored('yarn.lock'), true);
});

test('ignore: нормальные файлы проходят', function () {
  ['src/app.js', 'README.md', 'lib/движок.ts', 'a/b/c/d/e.css', 'package.json']
    .forEach(function (p) {
      assert.strictEqual(ignore.isIgnored(p), false, p + ' не должен игнорироваться');
    });
});

test('ignore: корень и пустые значения', function () {
  assert.strictEqual(ignore.isIgnored(''), false);
  assert.strictEqual(ignore.isIgnored('.'), false);
  assert.strictEqual(ignore.isIgnored(null), false);
});

test('ignore: пути Windows тоже разбираются посегментно', function () {
  assert.strictEqual(ignore.isIgnored('src\\node_modules\\x.js'), true);
  assert.strictEqual(ignore.isIgnored('src\\app.js'), false);
});

test('описания файлов узнают тип по имени, расширению и месту', function () {
  var ft = require('../lib/filetypes');

  var pkg = ft.describeFile('package.json', false);
  assert.strictEqual(pkg.title, 'Паспорт проекта');
  assert.match(pkg.text, /зависимост/);

  var test1 = ft.describeFile('tests/game.test.js', false);
  assert.strictEqual(test1.title, 'Файл с тестами');

  var byDir = ft.describeFile('tests/helpers.js', false);
  assert.strictEqual(byDir.title, 'Тесты', 'узнан по каталогу');

  var css = ft.describeFile('assets/css/styles.css', false);
  assert.match(css.text, /Цвета|CSS|отдаются браузеру/);

  var unknown = ft.describeFile('нечто.странное', false);
  assert.match(unknown.title, /\.странное/);
  assert.ok(unknown.text.length > 10, 'даже для неизвестного типа есть внятный текст');

  var dir = ft.describeFile('src', true);
  assert.strictEqual(dir.title, 'Папка');
  assert.match(dir.text, /Исходный код/);
});

test('formatSize печатает размеры по-русски', function () {
  var ft = require('../lib/filetypes');
  assert.strictEqual(ft.formatSize(512), '512 Б');
  assert.strictEqual(ft.formatSize(1536), '1,5 КБ');
  assert.strictEqual(ft.formatSize(5 * 1024 * 1024), '5,0 МБ');
  assert.strictEqual(ft.formatSize(-1), '—');
  assert.strictEqual(ft.formatSize('нечисло'), '—');
});
