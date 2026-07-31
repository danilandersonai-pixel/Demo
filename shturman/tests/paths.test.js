'use strict';

var test = require('node:test');
var assert = require('node:assert');
var path = require('node:path');
var paths = require('../lib/paths');

/* ---------- кодирование пути проекта ---------- */

test('encodeProjectDir: unix-путь', function () {
  assert.strictEqual(paths.encodeProjectDir('/home/user/Demo'), '-home-user-Demo');
});

test('encodeProjectDir: windows-путь с диском и обратными слэшами', function () {
  assert.strictEqual(paths.encodeProjectDir('C:\\Users\\vasya\\my project'), 'C--Users-vasya-my-project');
});

test('encodeProjectDir: точки и подчёркивания тоже заменяются', function () {
  assert.strictEqual(paths.encodeProjectDir('/srv/app_v2.0'), '-srv-app-v2-0');
});

/* ---------- игнор-список ---------- */

test('isIgnored: node_modules и .git на любой глубине', function () {
  assert.strictEqual(paths.isIgnored('node_modules'), true);
  assert.strictEqual(paths.isIgnored('src/node_modules/lodash/index.js'), true);
  assert.strictEqual(paths.isIgnored('.git/HEAD'), true);
});

test('isIgnored: windows-разделители тоже понимаются', function () {
  assert.strictEqual(paths.isIgnored('src\\node_modules\\x'), true);
  assert.strictEqual(paths.isIgnored('src\\app\\main.js'), false);
});

test('isIgnored: обычные файлы не задеты', function () {
  assert.strictEqual(paths.isIgnored('src/index.js'), false);
  assert.strictEqual(paths.isIgnored('README.md'), false);
  // имя лишь ПОХОЖЕ на игнорируемое — не совпадает
  assert.strictEqual(paths.isIgnored('my-node_modules-backup/a.js'), false);
});

/* ---------- защита от выхода за пределы проекта ---------- */

test('safeJoin: путь внутри проекта разрешён', function () {
  var root = path.resolve('/tmp/proj');
  assert.strictEqual(paths.safeJoin(root, 'src/app.js'), path.join(root, 'src', 'app.js'));
  assert.strictEqual(paths.safeJoin(root, '.'), root);
});

test('safeJoin: ../ наружу — null', function () {
  var root = path.resolve('/tmp/proj');
  assert.strictEqual(paths.safeJoin(root, '../secrets.txt'), null);
  assert.strictEqual(paths.safeJoin(root, 'a/../../etc/passwd'), null);
});

test('safeJoin: похожий префикс каталога не обманывает', function () {
  // /tmp/proj-evil начинается с "/tmp/proj", но лежит СНАРУЖИ
  var root = path.resolve('/tmp/proj');
  assert.strictEqual(paths.safeJoin(root, '../proj-evil/x'), null);
});

/* ---------- отображение путей ---------- */

test('toDisplay: обратные слэши превращаются в прямые', function () {
  assert.strictEqual(paths.toDisplay('a\\b\\c.js'), 'a/b/c.js');
});

test('relToProject: файл в проекте — короткий путь, снаружи — как есть', function () {
  var root = path.resolve('/tmp/proj');
  assert.strictEqual(paths.relToProject(root, path.join(root, 'src', 'a.js')), 'src/a.js');
  var outside = paths.relToProject(root, path.resolve('/etc/passwd'));
  assert.ok(outside.indexOf('etc') !== -1);
});
