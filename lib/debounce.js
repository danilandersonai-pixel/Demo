'use strict';

// Дебаунс. Вынесен отдельным модулем не ради красоты, а потому что вотчер ФС
// шлёт по 3-5 событий на одно сохранение файла, и это единственное место,
// где такое склеивается. Функции принимают таймеры снаружи — так их можно
// протестировать без реального ожидания.

// Классический хвостовой дебаунс: вызов происходит через wait мс после
// ПОСЛЕДНЕГО обращения.
function debounce(fn, wait, timers) {
  var t = timers || { setTimeout: setTimeout, clearTimeout: clearTimeout };
  var handle = null;
  var lastArgs = null;

  function wrapped() {
    lastArgs = Array.prototype.slice.call(arguments);
    if (handle !== null) t.clearTimeout(handle);
    handle = t.setTimeout(function () {
      handle = null;
      var args = lastArgs;
      lastArgs = null;
      fn.apply(null, args);
    }, wait);
  }

  wrapped.cancel = function () {
    if (handle !== null) {
      t.clearTimeout(handle);
      handle = null;
      lastArgs = null;
    }
  };

  wrapped.pending = function () {
    return handle !== null;
  };

  // Немедленно выполнить отложенный вызов, если он есть (нужно при остановке
  // сервера, чтобы не потерять последнее изменение).
  wrapped.flush = function () {
    if (handle !== null) {
      t.clearTimeout(handle);
      handle = null;
      var args = lastArgs;
      lastArgs = null;
      fn.apply(null, args);
    }
  };

  return wrapped;
}

// Дебаунс с группировкой по ключу: у каждого файла свой таймер, но общий
// обработчик. Именно это нужно вотчеру — сохранение a.js не должно
// откладывать доставку события про b.js.
function debounceByKey(fn, wait, timers) {
  var t = timers || { setTimeout: setTimeout, clearTimeout: clearTimeout };
  var handles = new Map();
  var payloads = new Map();

  function wrapped(key) {
    var args = Array.prototype.slice.call(arguments, 1);
    payloads.set(key, args);
    if (handles.has(key)) t.clearTimeout(handles.get(key));
    handles.set(key, t.setTimeout(function () {
      handles.delete(key);
      var saved = payloads.get(key);
      payloads.delete(key);
      fn.apply(null, [key].concat(saved));
    }, wait));
  }

  wrapped.cancel = function (key) {
    if (key === undefined) {
      handles.forEach(function (h) { t.clearTimeout(h); });
      handles.clear();
      payloads.clear();
      return;
    }
    if (handles.has(key)) {
      t.clearTimeout(handles.get(key));
      handles.delete(key);
      payloads.delete(key);
    }
  };

  wrapped.pendingCount = function () {
    return handles.size;
  };

  wrapped.flushAll = function () {
    var keys = Array.from(handles.keys());
    keys.forEach(function (key) {
      t.clearTimeout(handles.get(key));
      handles.delete(key);
      var saved = payloads.get(key);
      payloads.delete(key);
      fn.apply(null, [key].concat(saved));
    });
  };

  return wrapped;
}

// Тротлинг «не чаще, чем раз в wait»: первый вызов проходит сразу,
// последующие в окне — схлопываются в один хвостовой.
function throttle(fn, wait, timers) {
  var t = timers || { setTimeout: setTimeout, clearTimeout: clearTimeout, now: Date.now };
  var now = t.now || Date.now;
  // -Infinity, а не 0: иначе при отсчёте времени от нуля (в тестах и на
  // некоторых поддельных таймерах) первый вызов не проходил бы сразу.
  var last = -Infinity;
  var handle = null;
  var lastArgs = null;

  function wrapped() {
    lastArgs = Array.prototype.slice.call(arguments);
    var elapsed = now() - last;
    if (elapsed >= wait) {
      last = now();
      var args = lastArgs;
      lastArgs = null;
      fn.apply(null, args);
      return;
    }
    if (handle === null) {
      handle = t.setTimeout(function () {
        handle = null;
        last = now();
        var a = lastArgs;
        lastArgs = null;
        if (a) fn.apply(null, a);
      }, wait - elapsed);
    }
  }

  wrapped.cancel = function () {
    if (handle !== null) {
      t.clearTimeout(handle);
      handle = null;
    }
    lastArgs = null;
  };

  return wrapped;
}

module.exports = {
  debounce: debounce,
  debounceByKey: debounceByKey,
  throttle: throttle
};
