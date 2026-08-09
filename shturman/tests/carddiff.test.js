'use strict';

// Мини-дифф карточки (lib/carddiff.js) и обрезка аргументов на проводе.

const test = require('node:test');
const assert = require('node:assert');

const carddiff = require('../lib/carddiff');
const wire = require('../lib/wire');
const busLib = require('../lib/bus');

function editEvent(oldText, newText) {
  return {
    kind: 'tool',
    action: 'edit',
    tool: 'Edit',
    file: 'src/a.js',
    args: { file_path: 'src/a.js', old_string: oldText, new_string: newText }
  };
}

test('carddiff: правка получает дифф с кусками и счётчиками', () => {
  const d = carddiff.forEvent(editEvent('a\nb\nc', 'a\nB\nc'));
  assert.ok(d, 'дифф построен');
  assert.strictEqual(d.added, 1);
  assert.strictEqual(d.removed, 1);
  assert.strictEqual(d.reconstructed, true);
  assert.ok(d.hunks.length >= 1);
  assert.strictEqual(d.more, 0);
});

test('carddiff: не-правка и правка без пар — без диффа', () => {
  assert.strictEqual(carddiff.forEvent({ kind: 'tool', action: 'run', args: {} }), null);
  assert.strictEqual(carddiff.forEvent({ kind: 'tool', action: 'edit', args: {} }), null);
  assert.strictEqual(carddiff.forEvent({ kind: 'result' }), null);
});

test('carddiff: MultiEdit складывает правки в один дифф', () => {
  const ev = {
    kind: 'tool', action: 'edit', tool: 'MultiEdit', file: 'x.js',
    args: {
      edits: [
        { old_string: 'one', new_string: 'ONE' },
        { old_string: 'two', new_string: 'TWO' }
      ]
    }
  };
  const d = carddiff.forEvent(ev);
  assert.ok(d);
  assert.strictEqual(d.added, 2);
  assert.strictEqual(d.removed, 2);
  assert.ok(d.hunks.length >= 2, 'по куску на каждую правку');
});

test('carddiff: большой дифф обрезан бюджетом карточки', () => {
  const oldLines = [];
  const newLines = [];
  for (let i = 0; i < 120; i++) {
    oldLines.push('line ' + i);
    newLines.push('LINE ' + i);
  }
  const d = carddiff.forEvent(editEvent(oldLines.join('\n'), newLines.join('\n')));
  assert.ok(d);
  let shipped = 0;
  d.hunks.forEach((h) => { shipped += h.lines.length; });
  assert.ok(shipped <= carddiff.CARD_LINES, 'строк не больше бюджета: ' + shipped);
  assert.ok(d.more > 0, 'остаток честно посчитан');
});

test('carddiff: огромный фрагмент не диффуется вовсе', () => {
  const big = 'x'.repeat(carddiff.MAX_CHARS + 1);
  assert.strictEqual(carddiff.forEvent(editEvent(big, 'y')), null);
});

test('wire: длинные строки в args обрезаются, короткие args не трогаются', () => {
  const long = 'z'.repeat(wire.ARGS_STRING_LIMIT + 500);
  const ev = { id: 1, kind: 'tool', action: 'edit', args: { old_string: long, new_string: 'ok' } };
  const out = wire.slim(ev);
  assert.notStrictEqual(out, ev, 'событие скопировано');
  assert.strictEqual(out.args.old_string.length, wire.ARGS_STRING_LIMIT);
  assert.strictEqual(out.args.new_string, 'ok');
  assert.strictEqual(out.argsCut, true);
  assert.strictEqual(ev.args.old_string.length, long.length, 'оригинал цел');

  const small = { id: 2, kind: 'tool', args: { file_path: 'a.js' } };
  assert.strictEqual(wire.slim(small), small, 'резать нечего — тот же объект');
});

test('wire: пары внутри args.edits тоже обрезаются', () => {
  const long = 'q'.repeat(wire.ARGS_STRING_LIMIT * 2);
  const ev = {
    id: 3, kind: 'tool', action: 'edit',
    args: { edits: [{ old_string: long, new_string: 'n' }, { old_string: 'o', new_string: long }] }
  };
  const out = wire.slim(ev);
  assert.strictEqual(out.args.edits[0].old_string.length, wire.ARGS_STRING_LIMIT);
  assert.strictEqual(out.args.edits[1].new_string.length, wire.ARGS_STRING_LIMIT);
  assert.strictEqual(out.args.edits[0].new_string, 'n');
  assert.strictEqual(out.argsCut, true);
});

test('bus: правка публикуется с готовым диффом для карточки', () => {
  const bus = busLib.createBus({ dedupWindow: 0 });
  const out = bus.publish(editEvent('a\nb', 'a\nc'));
  assert.ok(out.diff, 'дифф приложен');
  assert.strictEqual(out.diff.added, 1);
  const run = bus.publish({ kind: 'tool', action: 'run', command: 'ls', args: { command: 'ls' } });
  assert.strictEqual(run.diff, undefined, 'команде дифф не положен');
});
