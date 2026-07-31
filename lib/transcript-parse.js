'use strict';

// Разбор JSONL-транскрипта Claude Code.
// Модуль ЧИСТЫЙ: ничего не читает с диска, только превращает строки/объекты
// в нормализованные события. Всё, что связано с файлами, — в transcript.js.
//
// Формат разведан на живой сессии (см. DECISIONS.md, этап 0):
//   assistant — один блок контента на строку (text | thinking | tool_use)
//   user      — либо реплика человека (message.content — строка),
//               либо результат инструмента (блок tool_result + toolUseResult)

var paths = require('./paths');

// ---------------------------------------------------------------------------
// Низкий уровень: строка -> объект
// ---------------------------------------------------------------------------

// Безопасный разбор одной строки JSONL. Битая строка — не повод падать:
// транскрипт пишется параллельно с чтением, последняя строка бывает обрезана.
function parseLine(line) {
  if (typeof line !== 'string') return null;
  var trimmed = line.trim();
  if (!trimmed) return null;
  try {
    var obj = JSON.parse(trimmed);
    return obj && typeof obj === 'object' ? obj : null;
  } catch (e) {
    return null;
  }
}

// Разбор куска файла. Возвращает {records, rest}: rest — недописанный хвост
// последней строки, его нужно приклеить к следующему куску.
function parseChunk(chunk) {
  var text = String(chunk || '');
  var endsClean = text.length === 0 || text[text.length - 1] === '\n';
  var lines = text.split('\n');
  var rest = '';
  if (!endsClean) rest = lines.pop();
  var records = [];
  for (var i = 0; i < lines.length; i++) {
    var rec = parseLine(lines[i]);
    if (rec) records.push(rec);
  }
  return { records: records, rest: rest };
}

// ---------------------------------------------------------------------------
// Время
// ---------------------------------------------------------------------------

function tsOf(record) {
  if (!record) return 0;
  var t = record.timestamp;
  if (!t) return 0;
  var ms = Date.parse(t);
  return isNaN(ms) ? 0 : ms;
}

// ---------------------------------------------------------------------------
// Извлечение смысла из вызова инструмента
// ---------------------------------------------------------------------------

// У каждого инструмента свой «главный аргумент». Таблица говорит, какое поле
// входа считать путём файла — так новый инструмент добавляется одной строкой.
var FILE_ARG = {
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
  NotebookRead: 'notebook_path'
};

// Действие, к которому сводится инструмент. Лента группируется именно по нему.
var TOOL_ACTION = {
  Read: 'read',
  NotebookRead: 'read',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Bash: 'run',
  BashOutput: 'run',
  KillShell: 'run',
  Glob: 'search',
  Grep: 'search',
  WebSearch: 'web',
  WebFetch: 'web',
  Task: 'agent',
  Agent: 'agent',
  TodoWrite: 'plan',
  Skill: 'skill',
  SlashCommand: 'skill',
  ExitPlanMode: 'plan',
  EnterPlanMode: 'plan'
};

function actionForTool(name) {
  if (!name) return 'tool';
  if (TOOL_ACTION[name]) return TOOL_ACTION[name];
  if (name.indexOf('mcp__') === 0) return 'mcp';
  return 'tool';
}

// Считаем строки в тексте: пустая строка — это ноль строк, а не одна.
function countLines(text) {
  if (text === undefined || text === null || text === '') return 0;
  var s = String(text);
  var n = s.split('\n').length;
  // Хвостовой перевод строки не создаёт новой строки.
  if (s[s.length - 1] === '\n') n -= 1;
  return n;
}

// Приблизительная статистика правки по old_string/new_string.
// Это грубая оценка (мы не делаем настоящий LCS-дифф), и именно так она
// подписана в интерфейсе.
function editStats(input) {
  if (!input) return null;
  if (typeof input.old_string === 'string' || typeof input.new_string === 'string') {
    return {
      added: countLines(input.new_string),
      removed: countLines(input.old_string),
      approx: true
    };
  }
  if (Array.isArray(input.edits)) {
    var added = 0;
    var removed = 0;
    input.edits.forEach(function (e) {
      added += countLines(e && e.new_string);
      removed += countLines(e && e.old_string);
    });
    return { added: added, removed: removed, approx: true };
  }
  if (typeof input.content === 'string') {
    return { added: countLines(input.content), removed: 0, approx: false };
  }
  return null;
}

// Точная статистика из structuredPatch, если Claude Code его положил.
function patchStats(result) {
  if (!result || !Array.isArray(result.structuredPatch)) return null;
  var added = 0;
  var removed = 0;
  result.structuredPatch.forEach(function (hunk) {
    (hunk && hunk.lines ? hunk.lines : []).forEach(function (l) {
      if (l[0] === '+') added++;
      else if (l[0] === '-') removed++;
    });
  });
  return { added: added, removed: removed, approx: false };
}

// Главный разбор входа инструмента: что за файл, что за команда, что искали.
function describeToolUse(name, input) {
  var info = { tool: name, action: actionForTool(name), input: input || {} };
  var inp = input || {};

  var fileKey = FILE_ARG[name];
  if (fileKey && typeof inp[fileKey] === 'string') info.file = inp[fileKey];

  if (name === 'Bash') {
    info.command = typeof inp.command === 'string' ? inp.command : '';
    info.description = typeof inp.description === 'string' ? inp.description : '';
    info.background = inp.run_in_background === true;
  }
  if (name === 'Glob' || name === 'Grep') {
    info.pattern = inp.pattern || '';
    info.searchPath = inp.path || inp.glob || '';
  }
  if (name === 'WebFetch') info.url = inp.url || '';
  if (name === 'WebSearch') info.query = inp.query || '';
  if (name === 'Task' || name === 'Agent') {
    info.description = inp.description || '';
    info.agentType = inp.subagent_type || '';
  }
  if (name === 'Skill' || name === 'SlashCommand') {
    info.skill = inp.skill || inp.command || '';
  }
  if (name === 'TodoWrite' && Array.isArray(inp.todos)) {
    info.todoCount = inp.todos.length;
    info.todoDone = inp.todos.filter(function (t) {
      return t && t.status === 'completed';
    }).length;
    info.todoActive = (inp.todos.filter(function (t) {
      return t && t.status === 'in_progress';
    })[0] || {}).content || '';
  }

  var stats = editStats(inp);
  if (stats && (info.action === 'edit' || info.action === 'write')) info.stats = stats;

  return info;
}

// ---------------------------------------------------------------------------
// Извлечение смысла из результата инструмента
// ---------------------------------------------------------------------------

// Из блока tool_result достаём текст независимо от того, строка это или
// массив блоков (Claude Code использует оба варианта).
function resultText(block) {
  if (!block) return '';
  var c = block.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map(function (b) {
      if (typeof b === 'string') return b;
      if (b && typeof b.text === 'string') return b.text;
      return '';
    }).join('\n');
  }
  return '';
}

// Признаки ошибки: явный флаг is_error, ненулевой stderr при пустом stdout,
// или характерный текст. Последнее — эвристика, поэтому она последней.
function looksLikeError(block, toolUseResult) {
  if (block && block.is_error === true) return true;
  if (toolUseResult && typeof toolUseResult === 'object') {
    if (toolUseResult.interrupted === true) return true;
    var hasErr = typeof toolUseResult.stderr === 'string' && toolUseResult.stderr.trim() !== '';
    var noOut = !toolUseResult.stdout || String(toolUseResult.stdout).trim() === '';
    if (hasErr && noOut) return true;
  }
  return false;
}

// Нормализуем результат к общему виду, что бы там ни лежало.
function describeToolResult(block, toolUseResult) {
  var out = {
    ok: !looksLikeError(block, toolUseResult),
    text: resultText(block),
    stdout: '',
    stderr: '',
    interrupted: false
  };
  var r = toolUseResult;
  if (r && typeof r === 'object') {
    if (typeof r.stdout === 'string') out.stdout = r.stdout;
    if (typeof r.stderr === 'string') out.stderr = r.stderr;
    if (r.interrupted === true) out.interrupted = true;
    if (r.file && typeof r.file === 'object') {
      out.fileLines = r.file.numLines || countLines(r.file.content);
      out.filePath = r.file.filePath || r.filePath;
    }
    if (typeof r.filePath === 'string') out.filePath = r.filePath;
    if (typeof r.numFiles === 'number') out.numFiles = r.numFiles;
    if (Array.isArray(r.filenames)) out.numFiles = r.filenames.length;
    var ps = patchStats(r);
    if (ps) out.stats = ps;
  } else if (typeof r === 'string') {
    out.stdout = r;
  }
  if (!out.text) out.text = out.stdout || out.stderr || '';
  return out;
}

// ---------------------------------------------------------------------------
// Токены
// ---------------------------------------------------------------------------

// usage дублируется между блоками одного ответа модели, поэтому наружу мы
// отдаём и сам usage, и messageId — дедупликация делается в аккумуляторе.
function usageOf(record) {
  if (!record || record.type !== 'assistant') return null;
  var m = record.message;
  if (!m || !m.usage) return null;
  var u = m.usage;
  return {
    messageId: m.id || record.uuid,
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheCreate: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0
  };
}

// Складывает usage, игнорируя повторы одного и того же messageId.
function createTokenAccumulator() {
  var seen = new Set();
  var total = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, messages: 0 };
  return {
    add: function (usage) {
      if (!usage || !usage.messageId) return false;
      if (seen.has(usage.messageId)) return false;
      seen.add(usage.messageId);
      total.input += usage.input;
      total.output += usage.output;
      total.cacheCreate += usage.cacheCreate;
      total.cacheRead += usage.cacheRead;
      total.messages += 1;
      return true;
    },
    total: function () {
      return {
        input: total.input,
        output: total.output,
        cacheCreate: total.cacheCreate,
        cacheRead: total.cacheRead,
        messages: total.messages,
        // «Всего» для показа новичку: то, что реально ушло и пришло.
        // Чтение кеша считаем отдельно и в сумму не тащим — иначе цифра
        // раздувается и пугает.
        billableish: total.input + total.output + total.cacheCreate
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Верхний уровень: запись -> события
// ---------------------------------------------------------------------------

// Записи, которые не несут смысла для панели.
function isNoise(record) {
  if (!record || !record.type) return true;
  if (record.type === 'attachment') return true;
  if (record.type === 'last-prompt') return true;
  if (record.type === 'summary') return true;
  if (record.isMeta === true) return true;
  return false;
}

// Текст реплики человека, если запись — это реплика человека.
function humanPrompt(record) {
  if (!record) return null;
  if (record.type === 'queue-operation') {
    if (record.operation && record.operation !== 'enqueue') return null;
    return typeof record.content === 'string' ? record.content : null;
  }
  if (record.type !== 'user') return null;
  var m = record.message;
  if (!m) return null;
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    var texts = m.content.filter(function (b) {
      return b && b.type === 'text' && typeof b.text === 'string';
    }).map(function (b) { return b.text; });
    if (texts.length) return texts.join('\n');
  }
  return null;
}

// Блоки tool_result в записи пользователя.
function toolResultBlocks(record) {
  if (!record || record.type !== 'user') return [];
  var m = record.message;
  if (!m || !Array.isArray(m.content)) return [];
  return m.content.filter(function (b) {
    return b && b.type === 'tool_result';
  });
}

/**
 * Склейщик вызовов и результатов.
 *
 * Работает потоково: `push(record)` возвращает массив нормализованных событий.
 * Вызов инструмента отдаётся сразу (чтобы лента не отставала), а когда
 * приходит результат — отдаётся отдельное событие-обновление с тем же
 * `toolUseId`, и клиент дополняет уже показанную карточку.
 */
function createParser(options) {
  var opts = options || {};
  var projectRoot = opts.projectRoot || null;
  var pending = new Map();     // tool_use_id -> описание вызова
  var tokens = createTokenAccumulator();
  var lastAssistantText = null;
  var counters = { tools: 0, errors: 0, edits: 0, reads: 0, commands: 0 };

  // Путь приводим к относительному, если он внутри проекта. Файл снаружи
  // оставляем абсолютным — это честнее, чем прятать факт выхода наружу.
  function normFile(f) {
    if (!f) return null;
    if (!projectRoot) return paths.toPosix(f);
    var rel = paths.relativeToProject(projectRoot, f);
    return rel || paths.toPosix(f);
  }

  function base(record, kind, action) {
    return {
      ts: tsOf(record),
      source: 'transcript',
      kind: kind,
      action: action,
      sessionId: record.sessionId || null,
      uuid: record.uuid || null,
      gitBranch: record.gitBranch || null,
      raw: record
    };
  }

  return {
    push: function (record) {
      var events = [];
      if (isNoise(record)) return events;

      // --- реплика человека -------------------------------------------------
      var prompt = humanPrompt(record);
      if (prompt !== null && prompt !== undefined) {
        var ev = base(record, 'user', 'prompt');
        ev.text = prompt;
        events.push(ev);
        return events;
      }

      // --- ответ ассистента --------------------------------------------------
      if (record.type === 'assistant') {
        var usage = usageOf(record);
        var counted = usage ? tokens.add(usage) : false;

        var content = record.message && record.message.content;
        var blocks = Array.isArray(content) ? content : [];

        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i];
          if (!b) continue;

          if (b.type === 'text' && String(b.text || '').trim()) {
            var te = base(record, 'assistant', 'say');
            te.text = String(b.text);
            te.tokens = counted ? usage : null;
            lastAssistantText = te.text;
            events.push(te);
          } else if (b.type === 'thinking') {
            var th = base(record, 'assistant', 'think');
            th.text = String(b.thinking || b.text || '');
            th.tokens = counted ? usage : null;
            events.push(th);
          } else if (b.type === 'tool_use') {
            var info = describeToolUse(b.name, b.input);
            var ue = base(record, 'tool', info.action);
            ue.tool = info.tool;
            ue.toolUseId = b.id || null;
            ue.file = normFile(info.file);
            ue.command = info.command || null;
            ue.description = info.description || null;
            ue.pattern = info.pattern || null;
            ue.searchPath = info.searchPath || null;
            ue.url = info.url || null;
            ue.query = info.query || null;
            ue.agentType = info.agentType || null;
            ue.skill = info.skill || null;
            ue.background = info.background || false;
            ue.stats = info.stats || null;
            ue.todoCount = info.todoCount;
            ue.todoDone = info.todoDone;
            ue.todoActive = info.todoActive;
            ue.args = info.input;
            ue.pendingResult = true;
            ue.tokens = counted ? usage : null;

            counters.tools++;
            if (info.action === 'edit' || info.action === 'write') counters.edits++;
            if (info.action === 'read') counters.reads++;
            if (info.action === 'run') counters.commands++;

            if (b.id) pending.set(b.id, ue);
            events.push(ue);
          }
        }
        return events;
      }

      // --- результаты инструментов -------------------------------------------
      var results = toolResultBlocks(record);
      for (var j = 0; j < results.length; j++) {
        var rb = results[j];
        var desc = describeToolResult(rb, record.toolUseResult);
        var call = rb.tool_use_id ? pending.get(rb.tool_use_id) : null;
        if (rb.tool_use_id) pending.delete(rb.tool_use_id);

        if (!desc.ok) counters.errors++;

        var re = base(record, 'result', desc.ok ? 'ok' : 'error');
        re.toolUseId = rb.tool_use_id || null;
        re.tool = call ? call.tool : null;
        re.file = call ? call.file : normFile(desc.filePath);
        re.command = call ? call.command : null;
        re.ok = desc.ok;
        re.level = desc.ok ? 'info' : 'error';
        re.output = desc.text;
        re.stdout = desc.stdout;
        re.stderr = desc.stderr;
        re.interrupted = desc.interrupted;
        re.fileLines = desc.fileLines;
        re.numFiles = desc.numFiles;
        // Точная статистика из патча бьёт приблизительную из аргументов.
        re.stats = desc.stats || (call ? call.stats : null);
        events.push(re);
      }
      return events;
    },

    tokens: function () { return tokens.total(); },
    counters: function () {
      return {
        tools: counters.tools,
        errors: counters.errors,
        edits: counters.edits,
        reads: counters.reads,
        commands: counters.commands
      };
    },
    pendingCount: function () { return pending.size; },
    lastAssistantText: function () { return lastAssistantText; }
  };
}

module.exports = {
  parseLine: parseLine,
  parseChunk: parseChunk,
  tsOf: tsOf,
  countLines: countLines,
  editStats: editStats,
  patchStats: patchStats,
  actionForTool: actionForTool,
  describeToolUse: describeToolUse,
  describeToolResult: describeToolResult,
  resultText: resultText,
  looksLikeError: looksLikeError,
  usageOf: usageOf,
  createTokenAccumulator: createTokenAccumulator,
  isNoise: isNoise,
  humanPrompt: humanPrompt,
  toolResultBlocks: toolResultBlocks,
  createParser: createParser
};
