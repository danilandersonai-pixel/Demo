'use strict';

/**
 * Дебаунс с накоплением: события сыплются пачкой, а колбэк вызывается один
 * раз после паузы — со списком всего, что накопилось.
 *
 * const d = createDebouncer(200, function (items) { ... });
 * d.push('a'); d.push('b');  // через 200 мс тишины → колбэк(['a','b'])
 */
function createDebouncer(waitMs, callback) {
  var timer = null;
  var pending = [];

  function flush() {
    timer = null;
    if (pending.length === 0) return;
    var items = pending;
    pending = [];
    callback(items);
  }

  return {
    push: function (item) {
      pending.push(item);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, waitMs);
      if (timer.unref) timer.unref();
    },
    /** Немедленно отдать накопленное (для тестов и остановки). */
    flush: function () {
      if (timer) clearTimeout(timer);
      flush();
    },
    cancel: function () {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = [];
    },
    size: function () {
      return pending.length;
    }
  };
}

module.exports = { createDebouncer: createDebouncer };
