'use strict';

// Кликабельные ярлыки запуска.
//
// Новичок не должен помнить команды и открывать терминал: он кладёт в папку
// проекта файл и щёлкает по нему дважды. Содержимое ярлыков — обычный текст,
// поэтому генерация чистая и тестируемая.
//
// Ярлыки создаются ТОЛЬКО по явной команде `shturman --install-shortcuts`.
// Сам по себе Штурман в чужую папку не пишет — обещание из первой версии
// действует (DECISIONS.md, решение 23).

var fs = require('fs');
var path = require('path');

var WINDOWS_NAME = 'Штурман.bat';
var UNIX_NAME = 'Штурман.command';

/**
 * Содержимое .bat для Windows.
 *
 * chcp 65001 — переключение консоли в UTF-8, иначе русский текст в окне
 * превращается в кракозябры. Перевод строк CRLF: cmd.exe не понимает LF
 * в некоторых сборках Windows.
 */
function windowsScript(options) {
  var opts = options || {};
  var serverPath = opts.serverPath || 'server.js';
  var extra = (opts.args || []).join(' ');

  var lines = [
    '@echo off',
    'chcp 65001 >nul',
    'title Штурман — панель-наставник',
    'cd /d "%~dp0"',
    '',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo.',
    '  echo   Не найден Node.js — без него Штурман не запустится.',
    '  echo   Скачайте его с https://nodejs.org и установите, потом',
    '  echo   запустите этот файл ещё раз.',
    '  echo.',
    '  pause',
    '  exit /b 1',
    ')',
    '',
    'echo.',
    'echo   Запускаю Штурман. Панель откроется в браузере сама.',
    'echo   Чтобы остановить — закройте это окно или нажмите Ctrl+C.',
    'echo.',
    '',
    'node "' + toWindowsPath(serverPath) + '" --project "%CD%" --open' + (extra ? ' ' + extra : ''),
    '',
    'if errorlevel 1 (',
    '  echo.',
    '  echo   Штурман завершился с ошибкой. Текст выше подскажет причину.',
    '  pause',
    ')'
  ];
  return lines.join('\r\n') + '\r\n';
}

/**
 * Содержимое .command для macOS и Linux.
 *
 * Расширение .command выбрано ради macOS: Finder запускает такие файлы
 * двойным кликом. В Linux то же самое делают файловые менеджеры, если у
 * файла стоит бит исполнения — его мы и ставим при создании.
 */
function unixScript(options) {
  var opts = options || {};
  var serverPath = opts.serverPath || 'server.js';
  var extra = (opts.args || []).join(' ');

  var lines = [
    '#!/usr/bin/env bash',
    '# Штурман — панель-наставник для Claude Code.',
    '# Двойной клик по этому файлу поднимает панель в текущей папке.',
    '',
    'cd "$(dirname "$0")" || exit 1',
    '',
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo',
    '  echo "  Не найден Node.js — без него Штурман не запустится."',
    '  echo "  Скачайте его с https://nodejs.org и установите,"',
    '  echo "  потом запустите этот файл ещё раз."',
    '  echo',
    '  read -r -p "  Нажмите Enter, чтобы закрыть окно…"',
    '  exit 1',
    'fi',
    '',
    'echo',
    'echo "  Запускаю Штурман. Панель откроется в браузере сама."',
    'echo "  Чтобы остановить — закройте это окно или нажмите Ctrl+C."',
    'echo',
    '',
    'node "' + serverPath + '" --project "$PWD" --open' + (extra ? ' ' + extra : ''),
    'code=$?',
    '',
    'if [ $code -ne 0 ]; then',
    '  echo',
    '  echo "  Штурман завершился с ошибкой. Текст выше подскажет причину."',
    '  read -r -p "  Нажмите Enter, чтобы закрыть окно…"',
    'fi'
  ];
  return lines.join('\n') + '\n';
}

// В .bat пути пишутся с обратными слешами, иначе cmd.exe спотыкается.
function toWindowsPath(p) {
  return String(p).split('/').join('\\');
}

/**
 * Какие ярлыки создавать на этой ОС.
 * По умолчанию — оба: проект могут положить в общую папку, синхронизировать
 * между Windows и Mac, и тогда пригодятся оба файла.
 */
function plan(targetDir, options) {
  var opts = options || {};
  var serverPath = opts.serverPath || path.join(__dirname, '..', 'server.js');
  var only = opts.only;                   // 'windows' | 'unix' | undefined

  var items = [];
  if (only !== 'unix') {
    items.push({
      name: WINDOWS_NAME,
      file: path.join(targetDir, WINDOWS_NAME),
      content: windowsScript({ serverPath: serverPath, args: opts.args }),
      mode: null,
      os: 'Windows'
    });
  }
  if (only !== 'windows') {
    items.push({
      name: UNIX_NAME,
      file: path.join(targetDir, UNIX_NAME),
      content: unixScript({ serverPath: serverPath, args: opts.args }),
      mode: 0o755,                         // без бита исполнения двойной клик не сработает
      os: 'macOS и Linux'
    });
  }
  return items;
}

/**
 * Создать ярлыки. Существующие файлы не перезаписываем без спроса:
 * вдруг человек их правил под себя.
 */
function install(targetDir, options) {
  var opts = options || {};
  var items = plan(targetDir, opts);
  var results = [];

  items.forEach(function (item) {
    var exists = false;
    try {
      fs.statSync(item.file);
      exists = true;
    } catch (e) { /* нет файла — это и хорошо */ }

    if (exists && !opts.force) {
      results.push({ name: item.name, status: 'skipped', file: item.file,
        reason: 'файл уже есть — не перезаписываю. Нужно обновить? Удалите его и повторите.' });
      return;
    }
    try {
      fs.writeFileSync(item.file, item.content, 'utf8');
      if (item.mode !== null) {
        try { fs.chmodSync(item.file, item.mode); } catch (e) { /* Windows такого не умеет */ }
      }
      results.push({ name: item.name, status: 'created', file: item.file, os: item.os });
    } catch (e) {
      results.push({ name: item.name, status: 'failed', file: item.file, reason: e.message });
    }
  });

  return results;
}

module.exports = {
  WINDOWS_NAME: WINDOWS_NAME,
  UNIX_NAME: UNIX_NAME,
  windowsScript: windowsScript,
  unixScript: unixScript,
  toWindowsPath: toWindowsPath,
  plan: plan,
  install: install
};
