'use strict';

var paths = require('./paths');

/**
 * Перевод нормализованных событий на простой русский. Чистые функции —
 * покрыты тестами. Каждое событие получает { icon, title, detail?, category }.
 * category — для фильтров ленты: read | edit | run | search | talk | git |
 * files | signal | other.
 */

/** Опасные/заметные команды — подсказки для новичка. */
function describeBashCommand(cmd) {
  var c = String(cmd || '').trim();
  var first = c.split(/\s+/)[0] || '';
  var short = clip(c, 90);

  if (/^npm (run )?test\b/.test(c) || /^npx? .*test/.test(c) || /^node --test/.test(c)) {
    return { text: 'запустил тесты (' + short + ') — проверяет, работает ли код', cat: 'run' };
  }
  if (/^npm i(nstall)?\b/.test(c) || /^npm ci\b/.test(c)) {
    return { text: 'устанавливает зависимости (' + short + ') — скачивает библиотеки, нужные проекту', cat: 'run' };
  }
  if (/^npm run build\b/.test(c) || /^npx? (vite|webpack|tsc)\b/.test(c)) {
    return { text: 'собирает проект (' + short + ')', cat: 'run' };
  }
  if (/^git commit/.test(c)) {
    return { text: 'делает коммит — сохраняет снимок изменений в истории git', cat: 'git' };
  }
  if (/^git push/.test(c)) {
    return { text: 'отправляет коммиты на сервер (git push) — теперь изменения не только на этом компьютере', cat: 'git' };
  }
  if (/^git (pull|fetch)/.test(c)) {
    return { text: 'забирает свежие изменения с сервера (' + first + ' ' + c.split(/\s+/)[1] + ')', cat: 'git' };
  }
  if (/^git checkout|^git switch/.test(c)) {
    return { text: 'переключает ветку git (' + short + ')', cat: 'git' };
  }
  if (/^git (status|log|diff|branch|show)/.test(c)) {
    return { text: 'смотрит состояние git (' + short + ') — ничего не меняет, только читает', cat: 'git' };
  }
  if (/^git /.test(c)) {
    return { text: 'выполняет команду git: ' + short, cat: 'git' };
  }
  if (/^(ls|dir|pwd|cat|head|tail|find|tree|wc|file|stat)\b/.test(c)) {
    return { text: 'осматривается в файлах (' + short + ') — читает, ничего не меняет', cat: 'read' };
  }
  if (/^(grep|rg|ag)\b/.test(c)) {
    return { text: 'ищет текст в файлах: ' + short, cat: 'search' };
  }
  if (/^mkdir\b/.test(c)) {
    return { text: 'создаёт папку: ' + short, cat: 'files' };
  }
  if (/^(rm|del|rmdir)\b/.test(c)) {
    return { text: '⚠ удаляет файлы: ' + short, cat: 'files' };
  }
  if (/^(mv|cp|copy|move)\b/.test(c)) {
    return { text: 'перемещает или копирует файлы: ' + short, cat: 'files' };
  }
  if (/^(node|python3?|ruby|go run|cargo run)\b/.test(c)) {
    return { text: 'запустил программу: ' + short, cat: 'run' };
  }
  if (/^(curl|wget)\b/.test(c)) {
    return { text: 'обращается к сети: ' + short, cat: 'run' };
  }
  return { text: 'выполняет команду в терминале: ' + short, cat: 'run' };
}

/** Инструмент + вход → русская строка. projectRoot нужен для коротких путей. */
function humanizeToolUse(tool, input, projectRoot) {
  input = input || {};
  var file = input.file_path || input.path || input.notebook_path || '';
  var rel = file ? paths.relToProject(projectRoot || '', file) : '';

  switch (tool) {
    case 'Read':
      return ev('📖', 'Клод читает ' + (rel || 'файл') + ' — изучает, что там написано', 'read');
    case 'Edit':
    case 'MultiEdit':
      return ev('📝', 'Клод правит ' + (rel || 'файл') + ' — меняет часть содержимого', 'edit');
    case 'Write':
      return ev('📄', 'Клод пишет файл ' + (rel || '') + ' целиком (создаёт или заменяет)', 'edit');
    case 'NotebookEdit':
      return ev('📓', 'Клод правит блокнот ' + (rel || ''), 'edit');
    case 'Bash': {
      var d = describeBashCommand(input.command);
      var icon = d.cat === 'git' ? '🌿' : d.cat === 'read' ? '👀' : d.cat === 'search' ? '🔎' : d.cat === 'files' ? '🗂' : '🔧';
      return ev(icon, 'Клод ' + d.text, d.cat);
    }
    case 'Grep':
      return ev('🔎', 'Клод ищет в коде: «' + clip(input.pattern || '', 60) + '»', 'search');
    case 'Glob':
      return ev('🔎', 'Клод ищет файлы по маске: ' + clip(input.pattern || '', 60), 'search');
    case 'Task':
    case 'Agent':
      return ev('🤖', 'Клод отправил помощника-агента: ' + clip(input.description || input.prompt || '', 80), 'run');
    case 'TodoWrite':
      return ev('🗒', 'Клод обновил свой список задач — планирует работу', 'other');
    case 'WebFetch':
      return ev('🌐', 'Клод открывает страницу: ' + clip(input.url || '', 80), 'read');
    case 'WebSearch':
      return ev('🌐', 'Клод ищет в интернете: «' + clip(input.query || '', 60) + '»', 'search');
    case 'AskUserQuestion':
      return ev('❓', 'Клод задаёт вам вопрос — посмотрите в окно Claude Code!', 'signal');
    case 'ExitPlanMode':
    case 'EnterPlanMode':
      return ev('🧭', 'Клод работает с планом — согласует, что делать дальше', 'talk');
    case 'Skill':
      return ev('🧩', 'Клод подключил навык: ' + clip(input.skill || '', 40), 'run');
  }
  if (/^mcp__/.test(String(tool))) {
    var pretty = String(tool).replace(/^mcp__/, '').replace(/__/g, ' → ');
    return ev('🔌', 'Клод вызвал внешний сервис: ' + pretty, 'run');
  }
  return ev('⚙️', 'Клод использует инструмент ' + tool, 'other');
}

/** Главная точка: нормализованное событие → карточка для ленты. */
function humanizeEvent(event, projectRoot) {
  switch (event.kind) {
    case 'user-prompt':
      return ev('🧑', 'Вы отправили Клоду запрос: «' + clip(firstLine(event.text), 100) + '»', 'talk');
    case 'assistant-text':
      return ev('💬', 'Клод отвечает: «' + clip(firstLine(event.text), 120) + '»', 'talk');
    case 'tool-use':
      return humanizeToolUse(event.tool, event.input, projectRoot);
    case 'tool-result':
      if (event.isError) {
        return ev('⚠️', 'Инструмент ' + (event.tool || '') + ' вернул ошибку — Клод это видит и, скорее всего, попробует иначе', 'signal');
      }
      return ev('✅', 'Инструмент ' + (event.tool || '') + ' отработал', 'other');
    case 'file-change': {
      var n = event.files ? event.files.length : 0;
      if (n === 1) {
        return ev('📁', 'Изменён файл ' + event.files[0], 'files');
      }
      return ev('📁', 'Изменено файлов: ' + n + ' (' + clip((event.files || []).slice(0, 3).join(', '), 120) + (n > 3 ? '…' : '') + ')', 'files');
    }
    case 'git-change':
      return ev('🌿', event.text || 'Что-то изменилось в git', 'git');
    case 'claude-idle':
      if (event.reason === 'end-turn') {
        return ev('🔔', 'Клод закончил и ждёт вас — посмотрите его ответ в Claude Code', 'signal');
      }
      return ev('🕰', 'Клод давно молчит (' + Math.round((event.quietMs || 0) / 1000) + ' с) — возможно, ждёт подтверждения или что-то зависло', 'signal');
    case 'claude-active':
      return ev('▶️', 'Клод снова работает', 'signal');
    case 'session-switch':
      return ev('🔄', 'Началась новая сессия Claude Code — панель переключилась на неё', 'signal');
    case 'meta':
      return ev('ℹ️', event.text || '', 'other');
    case 'usage':
      return null; // токены не показываем строкой в ленте — они идут в «Пульс»
  }
  return ev('•', 'Событие: ' + event.kind, 'other');
}

function ev(icon, title, category) {
  return { icon: icon, title: title, category: category };
}

function firstLine(s) {
  return String(s || '').split('\n')[0];
}

function clip(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

module.exports = {
  humanizeEvent: humanizeEvent,
  humanizeToolUse: humanizeToolUse,
  describeBashCommand: describeBashCommand
};
