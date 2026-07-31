'use strict';

var path = require('path');

/**
 * Всё про пути: кодирование каталога проекта в имя папки транскриптов,
 * фильтр «мусорных» каталогов и защита от выхода за пределы проекта.
 */

/**
 * Claude Code хранит транскрипты в ~/.claude/projects/<имя>, где имя — это
 * абсолютный путь проекта, в котором всё, кроме букв и цифр, заменено на "-".
 * Примеры: /home/user/Demo → -home-user-Demo, C:\Users\x → C--Users-x.
 */
function encodeProjectDir(absPath) {
  return String(absPath).replace(/[^A-Za-z0-9]/g, '-');
}

/** Каталоги, внутрь которых вотчер и дерево не заглядывают. */
var IGNORED_DIRS = [
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  'coverage', '.cache', '.next', '.nuxt', '.turbo', '.parcel-cache',
  '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.DS_Store',
  'target', 'vendor', '.pytest_cache', '.mypy_cache'
];

/**
 * Игнорируется ли относительный путь (в любом стиле разделителей).
 * Проверяем каждый сегмент пути по списку.
 */
function isIgnored(relPath) {
  if (!relPath) return false;
  var segments = String(relPath).split(/[\\/]+/);
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    if (IGNORED_DIRS.indexOf(seg) !== -1) return true;
    if (seg === '.DS_Store' || seg === 'Thumbs.db') return true;
  }
  return false;
}

/** Единый вид пути для интерфейса: прямые слэши на любой ОС. */
function toDisplay(p) {
  return String(p).split(path.sep).join('/').replace(/\\/g, '/');
}

/**
 * Безопасное соединение: возвращает абсолютный путь внутри root
 * или null, если запрошенный путь пытается выйти наружу (../ и т.п.).
 */
function safeJoin(root, rel) {
  var rootAbs = path.resolve(root);
  var joined = path.resolve(rootAbs, String(rel || '.'));
  if (joined === rootAbs) return joined;
  if (joined.indexOf(rootAbs + path.sep) === 0) return joined;
  return null;
}

/** Относительный путь файла от корня проекта — для показа человеку. */
function relToProject(projectRoot, absFile) {
  if (!absFile) return '';
  var rel = path.relative(projectRoot, absFile);
  if (!rel) return '.';
  if (rel === '..' || rel.indexOf('..' + path.sep) === 0) {
    // Файл вне проекта — показываем как есть, но по-человечески.
    return toDisplay(absFile);
  }
  return toDisplay(rel);
}

module.exports = {
  encodeProjectDir: encodeProjectDir,
  isIgnored: isIgnored,
  toDisplay: toDisplay,
  safeJoin: safeJoin,
  relToProject: relToProject,
  IGNORED_DIRS: IGNORED_DIRS
};
