'use strict';

// Детектор «Клод остановился и ждёт человека» — ключевая функция панели.
// Чистая машина состояний: время подаётся снаружи, поэтому её можно
// протестировать без ожидания в реальном времени.
//
// Правила (DECISIONS.md, решение 6):
//   • состояние 'working' — недавно были записи;
//   • переход в 'waiting' — тишина дольше idleMs И последнее, что сделал
//     Клод, это текст (договорил), а не начатый инструмент;
//   • переход в 'ended'   — тишина дольше idleMs * endedFactor;
//   • сигнал шлётся ОДИН раз на переход, обратный переход снимает флаг молча.

var DEFAULT_IDLE_MS = 45000;
var ENDED_FACTOR = 3;

function createDetector(options) {
  var opts = options || {};
  var idleMs = opts.idleMs || DEFAULT_IDLE_MS;
  var endedFactor = opts.endedFactor || ENDED_FACTOR;

  var state = 'idle-unknown';   // до первой активности состояние неизвестно
  var lastActivityAt = 0;
  var lastKind = null;          // 'assistant-text' | 'tool' | 'result' | 'user' | 'other'
  var pendingTools = 0;
  var notifiedAt = 0;

  // Классифицируем активность: важно отличать «Клод договорил» от
  // «Клод в середине инструмента».
  function kindOf(ev) {
    if (!ev) return 'other';
    if (ev.kind === 'assistant' && ev.action === 'say') return 'assistant-text';
    if (ev.kind === 'assistant') return 'assistant-think';
    if (ev.kind === 'tool') return 'tool';
    if (ev.kind === 'result') return 'result';
    if (ev.kind === 'user') return 'user';
    return 'other';
  }

  return {
    /**
     * Сообщить о новой активности. Возвращает событие перехода или null.
     */
    activity: function (ev, now) {
      var t = now === undefined ? Date.now() : now;
      var kind = kindOf(ev);

      // Считаем незакрытые вызовы инструментов: пока их больше нуля,
      // Клод точно работает, а не ждёт.
      if (kind === 'tool') pendingTools++;
      if (kind === 'result' && pendingTools > 0) pendingTools--;

      lastActivityAt = t;
      lastKind = kind;

      if (state === 'waiting' || state === 'ended') {
        state = 'working';
        notifiedAt = 0;
        return { type: 'resumed', at: t };
      }
      state = 'working';
      return null;
    },

    /**
     * Тик времени. Возвращает событие перехода или null.
     */
    tick: function (now) {
      var t = now === undefined ? Date.now() : now;
      if (!lastActivityAt) return null;
      var quiet = t - lastActivityAt;

      if (state === 'working') {
        if (quiet < idleMs) return null;
        // Оборванный вызов инструмента — это не «ждёт ответа», это зависшая
        // команда. Тоже сигналим, но другим текстом.
        var stuck = pendingTools > 0;
        state = 'waiting';
        notifiedAt = t;
        return {
          type: 'waiting',
          at: t,
          quietMs: quiet,
          stuck: stuck,
          lastKind: lastKind
        };
      }

      if (state === 'waiting' && quiet >= idleMs * endedFactor) {
        state = 'ended';
        return { type: 'ended', at: t, quietMs: quiet };
      }

      return null;
    },

    /** Явный сигнал извне: пришёл Stop-хук. */
    stopHook: function (now) {
      var t = now === undefined ? Date.now() : now;
      if (state === 'waiting' || state === 'ended') return null;
      state = 'waiting';
      notifiedAt = t;
      return { type: 'waiting', at: t, quietMs: t - lastActivityAt, hook: true, lastKind: lastKind };
    },

    state: function () { return state; },
    quietMs: function (now) {
      var t = now === undefined ? Date.now() : now;
      return lastActivityAt ? t - lastActivityAt : 0;
    },
    lastActivityAt: function () { return lastActivityAt; },
    pendingTools: function () { return pendingTools; },
    notifiedAt: function () { return notifiedAt; },
    setIdleMs: function (ms) {
      var n = Number(ms);
      if (isFinite(n) && n >= 5000 && n <= 3600000) idleMs = n;
      return idleMs;
    },
    idleMs: function () { return idleMs; },
    reset: function () {
      state = 'idle-unknown';
      lastActivityAt = 0;
      lastKind = null;
      pendingTools = 0;
      notifiedAt = 0;
    }
  };
}

module.exports = {
  createDetector: createDetector,
  DEFAULT_IDLE_MS: DEFAULT_IDLE_MS,
  ENDED_FACTOR: ENDED_FACTOR
};
