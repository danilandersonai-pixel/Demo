'use strict';

/**
 * «Пульс сессии»: копит статистику по событиям и следит, не остановился ли
 * Клод (Д-6). Детектор двухступенчатый:
 *  - end-turn: последняя запись ассистента завершила ход (stop_reason
 *    end_turn / текст без инструментов) и после неё ENDTURN_MS тишины;
 *  - quiet: вообще нет событий транскрипта дольше QUIET_MS при живой сессии.
 * emit(event) вызывается на переходах состояния — сервер шлёт их в SSE.
 */

var ENDTURN_MS = 5000;
var QUIET_MS = 90000;

function createPulse(emit, opts) {
  opts = opts || {};
  var endTurnMs = opts.endTurnMs || ENDTURN_MS;
  var quietMs = opts.quietMs || QUIET_MS;
  var now = opts.now || function () { return Date.now(); };
  // приведение путей к единому виду, чтобы Edit (абсолютный путь) и вотчер
  // (относительный) не считали один файл дважды
  var normalize = opts.normalizePath || function (p) { return p; };

  var state = {
    sessionStartMs: null,
    lastEventMs: null,
    filesTouched: {},          // rel → true (правки Клода + вотчер)
    commandsRun: 0,
    toolCalls: 0,
    errorsSeen: 0,
    promptsSent: 0,
    tokens: { output: 0, lastInput: 0, lastCacheRead: 0, lastCacheCreate: 0, model: null },
    lastUsageMsgId: null,      // одно сообщение = несколько записей с тем же usage
    lastAssistantStop: null,   // stop_reason последней usage-записи
    idle: false,               // сейчас считаем Клода остановившимся?
    idleReason: null
  };

  /** Транскриптное событие → учёт статистики. */
  function feed(event) {
    var t = now();
    // Берём время из самой записи транскрипта: тогда длительность сессии и
    // затишье честные даже после перезапуска «Штурмана» (реплей истории).
    var evT = event.ts ? Date.parse(event.ts) : NaN;
    if (!isFinite(evT) || evT > t) evT = t;
    if (state.sessionStartMs === null) state.sessionStartMs = evT;
    if (state.lastEventMs === null || evT > state.lastEventMs) state.lastEventMs = evT;

    switch (event.kind) {
      case 'user-prompt':
        state.promptsSent++;
        // новый запрос человека: прежний end_turn больше не значит «ждёт» —
        // иначе через 5 секунд раздумий Клода придёт ложный сигнал
        state.lastAssistantStop = null;
        break;
      case 'tool-use':
        state.toolCalls++;
        if (event.tool === 'Bash') state.commandsRun++;
        var input = event.input || {};
        var f = input.file_path || input.path || input.notebook_path;
        if (f && (event.tool === 'Edit' || event.tool === 'MultiEdit' ||
                  event.tool === 'Write' || event.tool === 'NotebookEdit')) {
          state.filesTouched[normalize(f)] = true;
        }
        break;
      case 'tool-result':
        if (event.isError) state.errorsSeen++;
        break;
      case 'usage':
        if (event.usage) {
          // записи одного сообщения несут один и тот же usage — считаем раз
          var sameMsg = event.msgId && event.msgId === state.lastUsageMsgId;
          if (!sameMsg) state.tokens.output += event.usage.output || 0;
          if (event.msgId) state.lastUsageMsgId = event.msgId;
          state.tokens.lastInput = event.usage.input || 0;
          state.tokens.lastCacheRead = event.usage.cacheRead || 0;
          state.tokens.lastCacheCreate = event.usage.cacheCreate || 0;
        }
        if (event.model) state.tokens.model = event.model;
        state.lastAssistantStop = event.stopReason || null;
        break;
    }

    if (state.idle) {
      state.idle = false;
      state.idleReason = null;
      emit({ kind: 'claude-active', ts: new Date(t).toISOString() });
    }
  }

  /** Периодическая проверка затишья; зовётся сервером раз в пару секунд. */
  function check() {
    if (state.lastEventMs === null) return; // сессии ещё нет
    if (state.idle) return;                 // уже сигналили — ждём активности
    var t = now();
    var quiet = t - state.lastEventMs;

    if (state.lastAssistantStop === 'end_turn' && quiet >= endTurnMs) {
      state.idle = true;
      state.idleReason = 'end-turn';
      emit({ kind: 'claude-idle', reason: 'end-turn', quietMs: quiet, ts: new Date(t).toISOString() });
      return;
    }
    if (quiet >= quietMs) {
      state.idle = true;
      state.idleReason = 'quiet';
      emit({ kind: 'claude-idle', reason: 'quiet', quietMs: quiet, ts: new Date(t).toISOString() });
    }
  }

  /** Файловые изменения от вотчера тоже считаются «затронутыми файлами». */
  function feedFileChanges(files) {
    for (var i = 0; i < files.length; i++) state.filesTouched[normalize(files[i])] = true;
  }

  function snapshot() {
    var t = now();
    // для давно замолчавшей сессии длительность меряем до последнего события,
    // а не до «сейчас» — иначе вчерашняя сессия «длится» всю ночь
    var endMs = t;
    if (state.lastEventMs !== null && t - state.lastEventMs > quietMs) {
      endMs = state.lastEventMs;
    }
    return {
      sessionStartMs: state.sessionStartMs,
      durationMs: state.sessionStartMs ? Math.max(0, endMs - state.sessionStartMs) : 0,
      quietMs: state.lastEventMs ? t - state.lastEventMs : null,
      filesTouched: Object.keys(state.filesTouched).length,
      commandsRun: state.commandsRun,
      toolCalls: state.toolCalls,
      errorsSeen: state.errorsSeen,
      promptsSent: state.promptsSent,
      tokens: {
        // Д-10: суммируем только output; input показываем последний
        // (текущий размер контекста), всё — с пометкой «приблизительно».
        approxOutput: state.tokens.output,
        approxContext: state.tokens.lastInput + state.tokens.lastCacheRead + state.tokens.lastCacheCreate,
        model: state.tokens.model
      },
      idle: state.idle,
      idleReason: state.idleReason
    };
  }

  function resetSession() {
    state.sessionStartMs = null;
    state.lastEventMs = null;
    state.filesTouched = {};
    state.commandsRun = 0;
    state.toolCalls = 0;
    state.errorsSeen = 0;
    state.promptsSent = 0;
    state.tokens = { output: 0, lastInput: 0, lastCacheRead: 0, lastCacheCreate: 0, model: null };
    state.lastUsageMsgId = null;
    state.lastAssistantStop = null;
    state.idle = false;
    state.idleReason = null;
  }

  return {
    feed: feed,
    feedFileChanges: feedFileChanges,
    check: check,
    snapshot: snapshot,
    resetSession: resetSession,
    _state: state
  };
}

module.exports = { createPulse: createPulse, ENDTURN_MS: ENDTURN_MS, QUIET_MS: QUIET_MS };
