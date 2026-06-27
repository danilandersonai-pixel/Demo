# 🚀 Деплой на VPS (постоянная работа 24/7)

Пошаговая инструкция. Всё, что в блоках `bash`, — копируй и вставляй в терминал
VPS. Время на всё — ~10 минут.

---

## Шаг 1. Взять VPS

Подойдёт самый дешёвый тариф. **Минимум:** 1 CPU, 1 ГБ RAM, 10 ГБ диска,
ОС **Ubuntu 22.04 или 24.04**.

Провайдеры (любой):
- 🇷🇺 **Timeweb Cloud**, **Aeza**, **RuVDS** — оплата картой РФ, есть РФ-локации.
- 🌍 **Hetzner** (от €4), **Contabo**, **DigitalOcean** — дешёвые, нужна
  зарубежная карта.

После создания у тебя будут: **IP-адрес**, **логин** (обычно `root`) и
**пароль** (или SSH-ключ).

---

## Шаг 2. Подключиться по SSH

С компьютера (Windows — PowerShell, Mac/Linux — терминал):

```bash
ssh root@ТВОЙ_IP
```

Введи пароль (символы не отображаются — это нормально).

---

## Шаг 3. Установить Docker

```bash
curl -fsSL https://get.docker.com | sh
```

Проверка:

```bash
docker --version && docker compose version
```

---

## Шаг 4. Скачать код

Репозиторий приватный, поэтому клонируй с GitHub-токеном или загрузи архивом.

**Вариант А — git (нужен GitHub Personal Access Token):**

```bash
apt-get update && apt-get install -y git
git clone https://ТОКЕН@github.com/danilandersonai-pixel/Demo.git
cd Demo
git checkout claude/telegram-finance-bot-9pur52
cd finance-bot
```

> Токен создаётся на github.com → Settings → Developer settings →
> Personal access tokens → Fine-grained → доступ на чтение этого репозитория.

**Вариант Б — без git:** скачай ZIP репозитория с GitHub (Code → Download ZIP),
распакуй и зайди в папку `finance-bot`.

---

## Шаг 5. Создать файл `.env`

```bash
nano .env
```

Вставь (подставь свои значения), сохрани `Ctrl+O`, `Enter`, выйди `Ctrl+X`:

```env
BOT_TOKEN=сюда_токен_от_BotFather
ALLOWED_USER_IDS=7343945668,855460405
DB_PATH=data/finance.db
RECEIPTS_DIR=data/receipts
CURRENCY=₽
TZ=Europe/Moscow
OCR_LANG=rus+eng
OPENROUTER_API_KEY=сюда_ключ_OpenRouter
OPENROUTER_MODEL=google/gemini-2.5-flash
```

> ⚠️ Токен бота и ключ OpenRouter лучше **перевыпустить** перед заливкой на
> сервер, раз они засветились в переписке: @BotFather → `/revoke`,
> openrouter.ai/keys → новый ключ.

---

## Шаг 6. Запустить

```bash
docker compose up -d --build
```

Готово! Бот работает и будет сам подниматься после перезагрузки сервера
(`restart: unless-stopped`).

Логи в реальном времени:

```bash
docker compose logs -f
```

(выйти из логов — `Ctrl+C`, бот продолжит работать)

---

## Управление

```bash
docker compose ps          # статус
docker compose logs -f     # логи
docker compose restart     # перезапуск
docker compose down        # остановить
docker compose up -d       # запустить снова
```

## Обновление кода

```bash
cd ~/Demo && git pull && cd finance-bot
docker compose up -d --build
```

## Бэкап данных

Вся база и чеки — в папке `finance-bot/data/`. Достаточно её копировать:

```bash
cp -r data ~/finance-backup-$(date +%F)
```

---

## Проверка, что всё живо

```bash
docker compose logs --tail=20
```

Ищи строку `Бот запущен. Разрешённые ID: (...) | AI: вкл`. Если есть — пиши
боту в Telegram, он ответит. Если нет — пришли мне вывод этой команды, разберём.
