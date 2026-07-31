'use strict';

// Общие мелочи для тестов: чтение фикстур и поддельные таймеры.

var fs = require('fs');
var path = require('path');

var FIXTURES = path.join(__dirname, 'fixtures');

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function fixturePath(name) {
  return path.join(FIXTURES, name);
}

// Разбирает JSONL-фикстуру в массив объектов.
function records(name) {
  var tp = require('../lib/transcript-parse');
  return fixture(name).split('\n')
    .map(tp.parseLine)
    .filter(Boolean);
}

/**
 * Управляемые таймеры: время двигаем руками, реального ожидания нет.
 * Именно поэтому дебаунс и детектор остановки принимают таймеры/время
 * параметром — иначе тесты пришлось бы «спать».
 */
function fakeTimers() {
  var now = 0;
  var seq = 0;
  var pending = new Map();

  return {
    now: function () { return now; },
    setTimeout: function (fn, delay) {
      seq++;
      pending.set(seq, { fn: fn, at: now + (delay || 0) });
      return seq;
    },
    clearTimeout: function (id) { pending.delete(id); },
    // Двигает время вперёд и выполняет всё, чему пришёл срок.
    advance: function (ms) {
      var target = now + ms;
      var guard = 0;
      while (guard++ < 10000) {
        var due = null;
        var dueId = null;
        pending.forEach(function (t, id) {
          if (t.at <= target && (due === null || t.at < due.at)) { due = t; dueId = id; }
        });
        if (!due) break;
        pending.delete(dueId);
        now = due.at;
        due.fn();
      }
      now = target;
    },
    pendingCount: function () { return pending.size; }
  };
}

module.exports = {
  FIXTURES: FIXTURES,
  fixture: fixture,
  fixturePath: fixturePath,
  records: records,
  fakeTimers: fakeTimers
};
