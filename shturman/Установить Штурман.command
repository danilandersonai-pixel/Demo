#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────
#  Штурман — установка. Дважды щёлкните по этому файлу.
#  Он найдёт Node.js, положит ярлык на рабочий стол и всё объяснит.
# ─────────────────────────────────────────────────────────────────────────

cd "$(dirname "$0")" || exit 1

echo ""
echo "  Штурман — установка"
echo "  ==================="
echo ""

# --- ищем Node.js ---------------------------------------------------------
NODE=""
if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  for candidate in \
      /usr/local/bin/node \
      /opt/homebrew/bin/node \
      /usr/bin/node \
      "$HOME/.nvm/versions/node"/*/bin/node \
      "$HOME/.volta/bin/node"; do
    [ -x "$candidate" ] && NODE="$candidate" && break
  done
fi

open_download_page() {
  URL="https://nodejs.org/ru/download"
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  else echo "  Откройте в браузере: $URL"
  fi
}

if [ -z "$NODE" ]; then
  echo "  На этом компьютере не хватает одной программы — Node.js."
  echo "  Это бесплатная и безопасная штука, на которой работает Штурман."
  echo ""
  echo "  Сейчас откроется страница загрузки. Скачайте версию с пометкой LTS,"
  echo "  установите её обычным способом и запустите этот файл ещё раз."
  echo ""
  open_download_page
  echo "  Окно можно закрыть."
  echo ""
  exit 0
fi

# --- версия должна быть 18-й или новее ------------------------------------
MAJOR="$("$NODE" -p "process.versions.node.split('.')[0]" 2>/dev/null)"
case "$MAJOR" in
  ''|*[!0-9]*) MAJOR=0 ;;
esac
if [ "$MAJOR" -lt 18 ]; then
  echo "  Node.js на компьютере старой версии ($("$NODE" -v))."
  echo "  Штурману нужна 18-я или новее."
  echo ""
  echo "  Сейчас откроется страница загрузки — поставьте свежую версию"
  echo "  и запустите этот файл ещё раз."
  echo ""
  open_download_page
  echo "  Окно можно закрыть."
  echo ""
  exit 0
fi

# --- собственно установка -------------------------------------------------
"$NODE" "install/install.js" "$@"
STATUS=$?

echo "  Это окно можно закрыть."
echo ""
exit $STATUS
