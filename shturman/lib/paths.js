'use strict';

// Кроссплатформенная работа с путями.
// Единственное место, где мы позволяем себе знать про разделители ОС;
// весь остальной код оперирует «posix-подобными» относительными путями.

var path = require('path');
var os = require('os');

// Внутреннее представление пути в событиях и на клиенте — всегда со слешем
// вперёд, независимо от ОС. Иначе один и тот же файл на Windows и Linux
// выглядел бы по-разному и не склеивался бы при дедупликации.
function toPosix(p) {
  if (!p) return '';
  return String(p).split(path.sep).join('/').replace(/\\/g, '/');
}

// Путь файла относительно корня проекта, в posix-виде.
// Возвращает null, если файл лежит ВНЕ проекта — это важная проверка
// безопасности: по ней сервер отказывается отдавать содержимое.
function relativeToProject(projectRoot, filePath) {
  if (!projectRoot || !filePath) return null;
  var abs = path.resolve(filePath);
  var root = path.resolve(projectRoot);
  var rel = path.relative(root, abs);
  if (rel === '') return '.';
  if (rel.indexOf('..') === 0 || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

// Лежит ли путь внутри проекта (учитывая символические выкрутасы вида ../).
function isInsideProject(projectRoot, filePath) {
  return relativeToProject(projectRoot, filePath) !== null;
}

// Claude Code кодирует путь проекта в имя каталога транскриптов, заменяя
// всё небуквенно-цифровое на дефис: /home/user/Demo -> -home-user-Demo,
// C:\Users\ok\proj -> C--Users-ok-proj.
function encodeProjectDir(projectPath) {
  return path.resolve(projectPath).replace(/[^a-zA-Z0-9]/g, '-');
}

// Домашний каталог Claude Code. CLAUDE_CONFIG_DIR умеет переопределять его,
// уважаем эту переменную — иначе на нестандартных установках не найдём ничего.
function claudeHome() {
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  return path.join(os.homedir(), '.claude');
}

function claudeProjectsDir() {
  return path.join(claudeHome(), 'projects');
}

// Человеческое имя файла (последний сегмент) без привязки к ОС.
function baseName(p) {
  var parts = toPosix(p).split('/');
  return parts[parts.length - 1] || toPosix(p);
}

// Расширение в нижнем регистре, без точки. 'Makefile' -> ''.
function extOf(p) {
  var name = baseName(p);
  var dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

// Каталог, в котором лежит файл (posix-вид). Для файла в корне — ''.
function dirOf(p) {
  var posix = toPosix(p);
  var idx = posix.lastIndexOf('/');
  return idx === -1 ? '' : posix.slice(0, idx);
}

module.exports = {
  toPosix: toPosix,
  relativeToProject: relativeToProject,
  isInsideProject: isInsideProject,
  encodeProjectDir: encodeProjectDir,
  claudeHome: claudeHome,
  claudeProjectsDir: claudeProjectsDir,
  baseName: baseName,
  extOf: extOf,
  dirOf: dirOf
};
