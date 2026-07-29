#!/usr/bin/env sh
# Ставит скилл repo-map в текущий репозиторий.
#
# Зачем нужен: в веб-сессиях Claude Code скилл виден только если он лежит
# в самом репозитории, с которым идёт работа. Копировать пять файлов руками
# каждый раз утомительно, поэтому скрипт тянет их напрямую из публичного
# репозитория Demo — подключать его к сессии для этого не требуется.
#
# Запуск из корня нужного репозитория:
#   curl -fsSL https://raw.githubusercontent.com/danilandersonai-pixel/Demo/claude/create-claude-md-s7amj/.claude/skills/repo-map/install.sh | sh
#
# После установки закоммить .claude/ — иначе следующая сессия его не увидит.

set -eu

SRC="https://raw.githubusercontent.com/danilandersonai-pixel/Demo/claude/create-claude-md-s7amj/.claude/skills/repo-map"
DST=".claude/skills/repo-map"

FILES="SKILL.md README.md install.sh reference/collect.md reference/render.md assets/template.html"

mkdir -p "$DST/reference" "$DST/assets"

for f in $FILES; do
  if curl -fsSL "$SRC/$f" -o "$DST/$f"; then
    echo "  ✓ $DST/$f"
  else
    echo "  ✗ не скачался: $f" >&2
    exit 1
  fi
done

chmod +x "$DST/install.sh"

echo ""
echo "Скилл repo-map установлен в $DST"
echo "Осталось закоммитить:"
echo "  git add .claude && git commit -m 'Add repo-map skill' && git push"
