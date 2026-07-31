'use strict';

// Что не показываем в карте проекта и о чём не сообщаем в ленте.
// Списки намеренно короткие и захардкоженные: цель — убрать шум сборки,
// а не реализовать заново .gitignore.

var paths = require('./paths');

// Каталоги, внутрь которых вообще не заходим.
var IGNORED_DIRS = [
  '.git',
  'node_modules',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  '.next',
  '.nuxt',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.gradle',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.nyc_output',
  'vendor',
  '.terraform',
  '.DS_Store'
];

// Файлы-однодневки: временные, свопы редакторов, логи.
var IGNORED_FILE_PATTERNS = [
  /^\..*\.sw[a-z]$/i,      // vim swap
  /~$/,                     // backup~
  /^\.#/,                   // emacs lock
  /^#.*#$/,                 // emacs autosave
  /\.tmp$/i,
  /\.temp$/i,
  /\.log$/i,
  /^\.DS_Store$/,
  /^Thumbs\.db$/i,
  /^desktop\.ini$/i,
  /\.pyc$/i,
  /\.class$/i,
  /\.o$/i,
  /\.lock$/i               // package-lock и подобные шумят на каждый install
];

var IGNORED_DIR_SET = new Set(IGNORED_DIRS);

// Игнорируем ли каталог по его собственному имени.
function isIgnoredDirName(name) {
  return IGNORED_DIR_SET.has(name);
}

// Игнорируем ли файл по его имени.
function isIgnoredFileName(name) {
  for (var i = 0; i < IGNORED_FILE_PATTERNS.length; i++) {
    if (IGNORED_FILE_PATTERNS[i].test(name)) return true;
  }
  return false;
}

// Главная проверка: относительный (posix) путь внутри проекта.
// Достаточно одного игнорируемого сегмента в середине пути,
// чтобы отбросить всё поддерево.
function isIgnored(relPath) {
  if (!relPath || relPath === '.') return false;
  var parts = paths.toPosix(relPath).split('/').filter(Boolean);
  for (var i = 0; i < parts.length; i++) {
    var seg = parts[i];
    var last = i === parts.length - 1;
    if (isIgnoredDirName(seg)) return true;
    if (last && isIgnoredFileName(seg)) return true;
  }
  return false;
}

module.exports = {
  IGNORED_DIRS: IGNORED_DIRS,
  isIgnored: isIgnored,
  isIgnoredDirName: isIgnoredDirName,
  isIgnoredFileName: isIgnoredFileName
};
