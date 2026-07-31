'use strict';

var test = require('node:test');
var assert = require('node:assert');
var humanize = require('../lib/humanize');

/* ---------- describeBashCommand ---------- */

test('bash: npm test — «проверяет, работает ли код»', function () {
  var d = humanize.describeBashCommand('npm test');
  assert.ok(d.text.indexOf('тест') !== -1);
  assert.strictEqual(d.cat, 'run');
});

test('bash: npm install — про скачивание библиотек', function () {
  var d = humanize.describeBashCommand('npm install express');
  assert.ok(d.text.indexOf('библиотек') !== -1);
});

test('bash: git commit / push / status — по-разному и по-русски', function () {
  assert.ok(humanize.describeBashCommand('git commit -m "x"').text.indexOf('снимок') !== -1);
  assert.ok(humanize.describeBashCommand('git push -u origin main').text.indexOf('сервер') !== -1);
  var st = humanize.describeBashCommand('git status');
  assert.ok(st.text.indexOf('только читает') !== -1);
  assert.strictEqual(st.cat, 'git');
});

test('bash: rm помечается предупреждением', function () {
  var d = humanize.describeBashCommand('rm -rf build');
  assert.ok(d.text.indexOf('⚠') !== -1);
  assert.ok(d.text.indexOf('удаляет') !== -1);
});

test('bash: ls/cat — «читает, ничего не меняет»', function () {
  var d = humanize.describeBashCommand('ls -la src');
  assert.ok(d.text.indexOf('ничего не меняет') !== -1);
  assert.strictEqual(d.cat, 'read');
});

test('bash: node script.js — «запустил программу»', function () {
  var d = humanize.describeBashCommand('node server.js --port 4517');
  assert.ok(d.text.indexOf('запустил программу') !== -1);
});

test('bash: незнакомая команда — общая формулировка с самой командой', function () {
  var d = humanize.describeBashCommand('terraform apply');
  assert.ok(d.text.indexOf('terraform apply') !== -1);
});

test('bash: длинная команда обрезается', function () {
  var longCmd = 'echo ' + new Array(300).join('x');
  var d = humanize.describeBashCommand(longCmd);
  assert.ok(d.text.length < 200);
});

/* ---------- humanizeToolUse ---------- */

test('Read: «читает файл» с путём относительно проекта', function () {
  var card = humanize.humanizeToolUse('Read', { file_path: '/proj/src/index.js' }, '/proj');
  assert.strictEqual(card.icon, '📖');
  assert.ok(card.title.indexOf('src/index.js') !== -1);
  assert.strictEqual(card.category, 'read');
});

test('Edit и Write различаются: правка vs целиком', function () {
  var edit = humanize.humanizeToolUse('Edit', { file_path: '/proj/a.js' }, '/proj');
  var write = humanize.humanizeToolUse('Write', { file_path: '/proj/b.js' }, '/proj');
  assert.ok(edit.title.indexOf('правит') !== -1);
  assert.ok(write.title.indexOf('целиком') !== -1);
  assert.strictEqual(edit.category, 'edit');
});

test('Grep: показывает, что ищем', function () {
  var card = humanize.humanizeToolUse('Grep', { pattern: 'createServer' }, '/proj');
  assert.ok(card.title.indexOf('createServer') !== -1);
  assert.strictEqual(card.category, 'search');
});

test('mcp__-инструменты: «внешний сервис» с читабельным именем', function () {
  var card = humanize.humanizeToolUse('mcp__github__list_issues', {}, '/proj');
  assert.ok(card.title.indexOf('внешний сервис') !== -1);
  assert.ok(card.title.indexOf('github') !== -1);
  assert.strictEqual(card.title.indexOf('mcp__'), -1, 'сырое имя спрятано');
});

test('AskUserQuestion — сигнал «посмотрите в Claude Code»', function () {
  var card = humanize.humanizeToolUse('AskUserQuestion', {}, '/proj');
  assert.strictEqual(card.category, 'signal');
});

test('незнакомый инструмент не роняет перевод', function () {
  var card = humanize.humanizeToolUse('BrandNewTool2027', {}, '/proj');
  assert.ok(card.title.indexOf('BrandNewTool2027') !== -1);
});

/* ---------- humanizeEvent ---------- */

test('user-prompt: «Вы отправили запрос» с первой строкой', function () {
  var card = humanize.humanizeEvent({ kind: 'user-prompt', text: 'Почини тесты\nи ещё что-нибудь' }, '/proj');
  assert.ok(card.title.indexOf('Почини тесты') !== -1);
  assert.strictEqual(card.title.indexOf('ещё что-нибудь'), -1, 'только первая строка');
});

test('tool-result с ошибкой — предупреждение', function () {
  var card = humanize.humanizeEvent({ kind: 'tool-result', tool: 'Bash', isError: true }, '/proj');
  assert.strictEqual(card.icon, '⚠️');
  assert.strictEqual(card.category, 'signal');
});

test('file-change: один файл и много файлов', function () {
  var one = humanize.humanizeEvent({ kind: 'file-change', files: ['a.js'] }, '/proj');
  assert.ok(one.title.indexOf('a.js') !== -1);
  var many = humanize.humanizeEvent({ kind: 'file-change', files: ['a', 'b', 'c', 'd', 'e'] }, '/proj');
  assert.ok(many.title.indexOf('5') !== -1);
  assert.ok(many.title.indexOf('…') !== -1);
});

test('claude-idle: end-turn и quiet звучат по-разному', function () {
  var end = humanize.humanizeEvent({ kind: 'claude-idle', reason: 'end-turn' }, '/proj');
  var quiet = humanize.humanizeEvent({ kind: 'claude-idle', reason: 'quiet', quietMs: 120000 }, '/proj');
  assert.ok(end.title.indexOf('ждёт вас') !== -1);
  assert.ok(quiet.title.indexOf('молчит') !== -1);
  assert.ok(quiet.title.indexOf('120') !== -1, 'секунды тишины показаны');
});

test('usage не попадает в ленту (null)', function () {
  assert.strictEqual(humanize.humanizeEvent({ kind: 'usage', usage: {} }, '/proj'), null);
});

test('assistant-text: реплика Клода с кавычками', function () {
  var card = humanize.humanizeEvent({ kind: 'assistant-text', text: 'Готово, тесты зелёные' }, '/proj');
  assert.ok(card.title.indexOf('Готово, тесты зелёные') !== -1);
  assert.strictEqual(card.category, 'talk');
});
