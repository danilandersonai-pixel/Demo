#!/bin/sh
# Штурман — запуск без окна терминала. Файл создан установщиком.
LOG="$HOME/.shturman.log"
PROJECT=""
if [ -n "$1" ]; then PROJECT="--project"; fi
cd '/home/user/Demo/shturman' || exit 1
nohup '/opt/node22/bin/node' '/home/user/Demo/shturman/server.js' --pick $PROJECT "$1" >>"$LOG" 2>&1 &
exit 0
