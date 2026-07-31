'use strict';

var fs = require('fs');
var path = require('path');

/**
 * Кликабельные ярлыки запуска: Штурман.bat (Windows) и Штурман.command
 * (macOS/Linux). Двойной клик — сервер поднимается для папки, где лежит
 * ярлык. Создаются ТОЛЬКО по явной команде пользователя
 * (`shturman ярлыки`), сами по себе в наблюдаемый проект не попадают.
 */

/** Содержимое .bat: %~dp0 — папка самого ярлыка (работает и с пробелами). */
function batContent(serverPath) {
  return [
    '@echo off',
    'rem «Штурман» — панель-наставник для Claude Code',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    'node "' + serverPath + '" --project "%cd%"',
    'pause'
  ].join('\r\n') + '\r\n';
}

/** Содержимое .command: dirname $0 — папка ярлыка. */
function commandContent(serverPath) {
  return [
    '#!/bin/sh',
    '# «Штурман» — панель-наставник для Claude Code',
    'cd "$(dirname "$0")"',
    'exec node "' + serverPath + '" --project "$(pwd)"'
  ].join('\n') + '\n';
}

/**
 * Записать оба ярлыка в каталог dir. Возвращает список созданных путей.
 * serverPath по умолчанию — server.js этого пакета.
 */
function writeShortcuts(dir, serverPath) {
  var srv = path.resolve(serverPath || path.join(__dirname, '..', 'server.js'));
  var created = [];

  var bat = path.join(dir, 'Штурман.bat');
  fs.writeFileSync(bat, batContent(srv));
  created.push(bat);

  var cmd = path.join(dir, 'Штурман.command');
  fs.writeFileSync(cmd, commandContent(srv));
  try {
    fs.chmodSync(cmd, 493); // 0o755 — двойной клик должен исполнять
  } catch (e) { /* Windows-ФС без chmod — не страшно */ }
  created.push(cmd);

  return created;
}

module.exports = {
  batContent: batContent,
  commandContent: commandContent,
  writeShortcuts: writeShortcuts
};
