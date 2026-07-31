'use strict';

// Построение дерева файлов проекта.
// Только чтение метаданных (stat) — содержимое файлов здесь не трогаем.

var fs = require('fs');
var path = require('path');
var paths = require('./paths');
var ignore = require('./ignore');
var filetypes = require('./filetypes');

var MAX_DEPTH = 12;
var MAX_ENTRIES = 8000;   // страховка от монорепозитория на 300 тысяч файлов

/**
 * Синхронный обход не годится (подвесит сервер на большом проекте),
 * поэтому обход асинхронный и с явными ограничениями.
 *
 * Возвращает {root, nodes, truncated, counts}.
 * nodes — плоский список, дерево собирает клиент: так проще слать
 * инкрементальные обновления и не пересылать всю структуру целиком.
 */
function scan(projectRoot, options) {
  var opts = options || {};
  var maxDepth = opts.maxDepth || MAX_DEPTH;
  var maxEntries = opts.maxEntries || MAX_ENTRIES;

  var nodes = [];
  var counts = { files: 0, dirs: 0, bytes: 0 };
  var truncated = false;

  function walk(absDir, relDir, depth) {
    if (depth > maxDepth || truncated) return Promise.resolve();
    return fs.promises.readdir(absDir, { withFileTypes: true }).then(function (entries) {
      // Папки вперёд, внутри — по алфавиту: так дерево читается предсказуемо.
      entries.sort(function (a, b) {
        var ad = a.isDirectory() ? 0 : 1;
        var bd = b.isDirectory() ? 0 : 1;
        if (ad !== bd) return ad - bd;
        return a.name.localeCompare(b.name, 'ru');
      });

      var chain = Promise.resolve();
      entries.forEach(function (entry) {
        chain = chain.then(function () {
          if (truncated) return;
          if (nodes.length >= maxEntries) { truncated = true; return; }

          var name = entry.name;
          var rel = relDir ? relDir + '/' + name : name;
          if (ignore.isIgnored(rel)) return;

          var abs = path.join(absDir, name);
          var isDir = entry.isDirectory();

          // Симлинки не разворачиваем: цикл симлинков — классический способ
          // подвесить обход дерева.
          if (entry.isSymbolicLink()) {
            nodes.push({
              path: rel, name: name, dir: relDir, type: 'link',
              size: 0, mtime: 0, depth: depth
            });
            return;
          }

          return fs.promises.stat(abs).then(function (st) {
            if (isDir) {
              counts.dirs++;
              nodes.push({
                path: rel, name: name, dir: relDir, type: 'dir',
                size: 0, mtime: st.mtimeMs, depth: depth
              });
              return walk(abs, rel, depth + 1);
            }
            counts.files++;
            counts.bytes += st.size;
            nodes.push({
              path: rel, name: name, dir: relDir, type: 'file',
              size: st.size, mtime: st.mtimeMs, depth: depth,
              icon: filetypes.iconFor(paths.extOf(name), name.toLowerCase())
            });
          }).catch(function () {
            // Файл исчез между readdir и stat — обычное дело в живом проекте.
          });
        });
      });
      return chain;
    }).catch(function () {
      // Нет прав на каталог — молча пропускаем, это не повод падать.
    });
  }

  return walk(path.resolve(projectRoot), '', 0).then(function () {
    return {
      root: path.resolve(projectRoot),
      nodes: nodes,
      counts: counts,
      truncated: truncated
    };
  });
}

/**
 * Карточка одного файла для правой панели.
 */
function fileCard(projectRoot, relPath) {
  var rel = paths.toPosix(relPath || '');
  var abs = path.resolve(projectRoot, rel);
  // Защита: не выпускаем наружу проекта.
  if (paths.relativeToProject(projectRoot, abs) === null) {
    return Promise.resolve({ error: 'Файл вне проекта — Штурман его не показывает.' });
  }
  return fs.promises.stat(abs).then(function (st) {
    var desc = filetypes.describeFile(rel, st.isDirectory());
    return {
      path: rel,
      name: paths.baseName(rel),
      type: st.isDirectory() ? 'dir' : 'file',
      size: st.size,
      sizeText: filetypes.formatSize(st.size),
      mtime: st.mtimeMs,
      title: desc.title,
      text: desc.text,
      icon: desc.icon,
      exists: true
    };
  }).catch(function () {
    var desc = filetypes.describeFile(rel, false);
    return {
      path: rel,
      name: paths.baseName(rel),
      type: 'file',
      exists: false,
      title: desc.title,
      text: desc.text,
      icon: desc.icon,
      error: 'Файла больше нет на диске.'
    };
  });
}

/**
 * Похожа ли папка на проект? Нужно для «мягкого сообщения» из блока 6.
 * Не запрещаем работу, просто предупреждаем.
 */
function looksLikeProject(projectRoot) {
  var MARKERS = [
    'package.json', '.git', 'pyproject.toml', 'requirements.txt', 'Cargo.toml',
    'go.mod', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json',
    'Makefile', 'CMakeLists.txt', 'index.html', 'CLAUDE.md', '.claude'
  ];
  return fs.promises.readdir(path.resolve(projectRoot)).then(function (names) {
    var set = new Set(names);
    var found = MARKERS.filter(function (m) { return set.has(m); });
    var hasAnyFile = names.some(function (n) { return n[0] !== '.'; });
    return {
      isProject: found.length > 0,
      markers: found,
      empty: names.length === 0,
      hasAnyFile: hasAnyFile,
      reason: found.length > 0
        ? null
        : (names.length === 0
          ? 'Папка пустая. Штурману пока нечего показывать — создайте файлы или запустите Штурман в другой папке.'
          : 'В этой папке нет привычных признаков проекта (package.json, .git и подобных). Штурман будет работать, но карта проекта может оказаться не о том. Проверьте, ту ли папку вы указали флагом --project.')
    };
  }).catch(function (e) {
    return {
      isProject: false,
      markers: [],
      empty: true,
      hasAnyFile: false,
      reason: 'Не удалось прочитать папку: ' + e.message
    };
  });
}

module.exports = {
  scan: scan,
  fileCard: fileCard,
  looksLikeProject: looksLikeProject,
  MAX_DEPTH: MAX_DEPTH,
  MAX_ENTRIES: MAX_ENTRIES
};
