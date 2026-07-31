'use strict';

var fs = require('fs');
var path = require('path');
var paths = require('./paths');

/**
 * Дерево файлов проекта для карты. Ходим синхронно, но с жёсткими
 * ограничителями (глубина, количество), чтобы не захлебнуться на
 * гигантских папках.
 */

var MAX_DEPTH = 8;
var MAX_ENTRIES = 4000;

function buildTree(root) {
  var counter = { n: 0, truncated: false };
  var rootName = path.basename(path.resolve(root)) || root;
  var node = walk(path.resolve(root), rootName, 0, counter, '');
  if (node) node.truncated = counter.truncated;
  return node;
}

function walk(abs, name, depth, counter, rel) {
  var st;
  try {
    st = fs.statSync(abs);
  } catch (e) {
    return null;
  }
  if (st.isFile()) {
    counter.n++;
    return {
      name: name,
      path: rel,
      type: 'file',
      size: st.size,
      mtimeMs: Math.round(st.mtimeMs)
    };
  }
  if (!st.isDirectory()) return null;

  var node = {
    name: name,
    path: rel,
    type: 'dir',
    mtimeMs: Math.round(st.mtimeMs),
    children: []
  };
  if (depth >= MAX_DEPTH || counter.n >= MAX_ENTRIES) {
    counter.truncated = true;
    return node;
  }
  var items;
  try {
    items = fs.readdirSync(abs);
  } catch (e) {
    return node;
  }
  items.sort(function (a, b) { return a.localeCompare(b, 'ru'); });
  for (var i = 0; i < items.length; i++) {
    if (counter.n >= MAX_ENTRIES) {
      counter.truncated = true;
      break;
    }
    var childRel = rel ? rel + '/' + items[i] : items[i];
    if (paths.isIgnored(childRel)) continue;
    var child = walk(path.join(abs, items[i]), items[i], depth + 1, counter, childRel);
    if (child) node.children.push(child);
  }
  // папки — вперёд, файлы — после, и те и те по алфавиту
  node.children.sort(function (a, b) {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'ru');
  });
  return node;
}

module.exports = { buildTree: buildTree, MAX_DEPTH: MAX_DEPTH, MAX_ENTRIES: MAX_ENTRIES };
