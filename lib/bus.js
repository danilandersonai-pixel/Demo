'use strict';

// Шина событий: единственное место, через которое всё попадает в браузер.
// Здесь же живут кольцевой буфер и дедупликация «транскрипт vs файловая
// система» (см. DECISIONS.md, решение 5).

var events = require('events');
var humanize = require('./humanize');

var BUFFER_SIZE = 500;
var DEDUP_WINDOW_MS = 2500;

function createBus(options) {
  var opts = options || {};
  var size = opts.bufferSize || BUFFER_SIZE;
  var dedupWindow = opts.dedupWindow === undefined ? DEDUP_WINDOW_MS : opts.dedupWindow;
  var now = opts.now || Date.now;

  var emitter = new events.EventEmitter();
  emitter.setMaxListeners(0);

  var buffer = [];
  var nextId = 1;
  // Когда транскрипт сообщил о правке файла — чтобы поглотить эхо от вотчера.
  var recentFileTouch = new Map();   // file -> ts

  // Клиент дополняет уже показанную карточку результатом, поэтому события
  // 'result' держим отдельно и по id вызова.
  function publish(ev) {
    if (!ev || typeof ev !== 'object') return null;

    var ts = ev.ts || now();
    var out = Object.assign({}, ev);
    out.ts = ts;

    // --- дедупликация ------------------------------------------------------
    if (out.kind === 'tool' && out.file && (out.action === 'edit' || out.action === 'write')) {
      recentFileTouch.set(out.file, ts);
    }
    if (out.kind === 'file' && out.file && dedupWindow > 0) {
      var touched = recentFileTouch.get(out.file);
      if (touched !== undefined && Math.abs(ts - touched) <= dedupWindow) {
        // Эхо правки Клода. В ленту не пускаем, но карту проекта обновляем:
        // клиент слушает отдельный канал 'fs-silent'.
        emitter.emit('silent', Object.assign({ id: 0, silent: true }, out));
        return null;
      }
    }

    out.id = nextId++;
    var human = humanize.humanize(out);
    out.icon = human.icon;
    out.title = human.title;
    out.hint = human.hint;
    out.level = out.level || human.level;

    buffer.push(out);
    if (buffer.length > size) buffer.splice(0, buffer.length - size);

    emitter.emit('event', out);
    return out;
  }

  // Периодическая уборка карты «недавно тронутых»: без неё она растёт вечно.
  function sweep() {
    var cutoff = now() - dedupWindow * 4;
    recentFileTouch.forEach(function (ts, file) {
      if (ts < cutoff) recentFileTouch.delete(file);
    });
  }

  return {
    events: emitter,
    publish: publish,
    sweep: sweep,

    // Служебное сообщение от самого Штурмана.
    say: function (title, hint, level) {
      return publish({
        kind: 'system',
        action: 'note',
        source: 'shturman',
        title: title,
        hint: hint || '',
        level: level || 'info'
      });
    },

    // Снимок для нового подключения (или досылка после разрыва).
    since: function (lastId) {
      var from = Number(lastId) || 0;
      if (!from) return buffer.slice();
      return buffer.filter(function (e) { return e.id > from; });
    },

    all: function () { return buffer.slice(); },
    lastId: function () { return nextId - 1; },
    size: function () { return buffer.length; },
    clear: function () { buffer.length = 0; }
  };
}

module.exports = {
  createBus: createBus,
  BUFFER_SIZE: BUFFER_SIZE,
  DEDUP_WINDOW_MS: DEDUP_WINDOW_MS
};
