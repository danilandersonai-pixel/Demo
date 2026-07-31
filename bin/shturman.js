#!/usr/bin/env node
'use strict';

// Точка входа команды `shturman`.
//
// Отдельный файл, а не сам server.js, по двум причинам: `npm i -g` ставит
// именно bin-скрипт, и здесь удобно проверить версию Node до того, как
// подключатся модули с современным синтаксисом — иначе на старой Node
// человек увидит не понятное сообщение, а стек разбора.

var MIN_MAJOR = 18;
var major = Number(String(process.versions.node).split('.')[0]);

if (!isFinite(major) || major < MIN_MAJOR) {
  process.stderr.write(
    '\n  Штурману нужен Node.js версии ' + MIN_MAJOR + ' или новее.\n' +
    '  Сейчас установлена ' + process.version + '.\n\n' +
    '  Обновите Node.js с https://nodejs.org и запустите снова.\n\n'
  );
  process.exit(2);
}

require('../server.js').main(process.argv.slice(2));
