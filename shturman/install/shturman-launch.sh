#!/bin/sh
# Штурман — запуск без окна терминала. Файл создан установщиком.
LOG="$HOME/.shturman.log"
cd '/home/user/Demo/shturman' || exit 1
# Папку можно передать первым аргументом — так работает пункт
# «Открыть Штурман здесь» в меню правой кнопки.
if [ -n "$1" ]; then
  nohup '/opt/node22/bin/node' '/home/user/Demo/shturman/server.js' --pick --project "$1" >>"$LOG" 2>&1 &
else
  nohup '/opt/node22/bin/node' '/home/user/Demo/shturman/server.js' --pick >>"$LOG" 2>&1 &
fi
exit 0
