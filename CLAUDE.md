# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Что это

Премиальный **статический** сайт-приглашение на свадьбу «Егор & Диана»
(26.08.2026, Санкт-Петербург). Чистые HTML/CSS/JS — **без сборки, без npm,
без бэкенда**. Весь сайт лежит в каталоге `yegor-diana-wedding/` и публикуется
в корне GitHub Pages.

> Историческая справка: репозиторий начинался как анализ продакшен-версии
> сайта на WordPress (`https://yegor.diana.yarover.ru`). Тот анализ сохранён в
> `yegor-diana-wedding/CLAUDE.md` как **референс** — текущий код к WordPress
> отношения не имеет, это самостоятельный статический ребилд.

Помимо сайта в репозитории живёт локальная инфраструктура Claude Code —
каталог `.claude/` (скилл `repo-map` и allowlist разрешений). Это отдельный
слой: правки сайта его не касаются и наоборот.

## Структура

```
.
├── CLAUDE.md                       — этот файл (актуальное руководство)
├── .github/workflows/deploy-pages.yml  — деплой на GitHub Pages
├── .claude/                        — инфраструктура Claude Code (не часть сайта)
│   ├── settings.json               — allowlist read-only команд и MCP-вызовов
│   └── skills/repo-map/            — скилл «карта репозиториев»
│       ├── SKILL.md                — инструкция (frontmatter + сценарий)
│       ├── README.md               — как пользоваться и ставить
│       ├── install.sh              — однострочный установщик в другие репы
│       ├── reference/collect.md    — как собирать данные (репы, ветки, PR)
│       ├── reference/render.md     — как рендерить вывод
│       └── assets/template.html    — HTML-шаблон карты
└── yegor-diana-wedding/            — САМ САЙТ (публикуется в корень Pages)
    ├── index.html                  — вся разметка, одна страница (~670 строк)
    ├── favicon.svg                 — монограмма «Е&Д»
    ├── README.md                   — превью, настройка RSVP, заметки по ассетам
    ├── CLAUDE.md                   — референс-анализ исходного WP-сайта (НЕ трогать как код)
    └── assets/
        ├── css/styles.css          — дизайн-система, секции, анимации (~1990 строк)
        └── js/main.js              — вся клиентская логика, один IIFE (~720 строк)
```

## Команды

Сборки/тестов нет. Рабочий цикл:

```bash
# Локальное превью
cd yegor-diana-wedding && python3 -m http.server   # → http://localhost:8000

# Проверка JS перед коммитом (обязательно)
node --check yegor-diana-wedding/assets/js/main.js
```

Никакого линтера/форматтера в репозитории нет — `node --check` это весь
доступный автоматический контроль, остальное проверяется глазами в браузере.

## Деплой и ветки

`.github/workflows/deploy-pages.yml` публикует папку `yegor-diana-wedding/`
в корень GitHub Pages. Триггер — push **только** в ветку
`claude/website-analysis-claude-md-kd3foj` (плюс ручной `workflow_dispatch`).

⚠️ Ветка по умолчанию у origin — `claude/create-claude-md-s7amj`, и она **не
совпадает** с деплойной. Мерж в default-ветку сам по себе Pages не обновляет:
чтобы выкатить изменения, нужен push в `claude/website-analysis-claude-md-kd3foj`
либо ручной запуск workflow. Превью ветки/PR без Pages — через githack
(raw.githack.com на `index.html`).

Репозиторий используется как песочница: в origin висит два десятка
несвязанных веток (`claude/pixel-rpg-…`, `claude/telegram-finance-bot-…` и
т.п.). Ориентируйся только на свою рабочую ветку и на деплойную.

## Архитектура

**`index.html`** — единственная страница. Порядок оверлеев по `z-index`:
прелоадер (120) → интро-видео (100) → scroll-progress (95) → навигация (90).
Секции с якорями по порядку: `#hero`, `#countdown`, `#gallery`, `#story`,
`#program`, `#location`, `#details`, `#rsvp`, `#flowers`. В меню навигации
выведены не все — только `#story`, `#program`, `#location`, `#details`,
`#rsvp`, `#flowers`.

**`assets/js/main.js`** — один IIFE (`'use strict'`), ES5-стиль (`var`,
`Array.prototype.slice.call`), без зависимостей. Над IIFE — единственная
глобальная константа `RSVP_ENDPOINT` (строка 6). Внутри, первым делом, —
`var reduceMotion` (флаг `prefers-reduced-motion`), от него ветвятся все
анимации. Файл разбит комментарными блоками:

| Блок | Что делает |
| --- | --- |
| `0a` | Имена Hero: разбивка на span'ы + стаггер-проявление |
| `0`  | Прелоадер (скрывается по `load`) |
| `1`  | Интро-видео: Play / Skip / `ended` → fade |
| `2`  | Навигация: фон, мобильное меню, плавный скролл, активный пункт, scroll-progress |
| `3`  | Scroll-reveal через IntersectionObserver (`.reveal` + `.anim-draw`) |
| `4`  | Parallax hero/галереи через rAF |
| `5`  | Обратный отсчёт до 26.08.2026 10:00 + count-up |
| `6`  | «Добавить в календарь»: `.ics` через Blob |
| `7`  | Лайтбокс: галерея + Love Story (←/→/Esc, фокус-ловушка, aria) |
| `8`  | Форма RSVP: валидация, honeypot, Formspree или демо-режим |

**`assets/css/styles.css`** — пронумерованные секции с баннерами
`/* ===== N. … ===== */`: `:root` и база (до 284) → 1 интро-видео → 2 навигация
→ 3 hero → 4 countdown → 5 галерея → 6 программа → 7 детали → 8 RSVP →
9 цветы → 10 футер → 11 прелоадер → 12 флораль-разделители → 13 кнопки
календаря → 14 Love Story → 15 карты → 16 лайтбокс → 17 адаптив новых блоков
→ **18 анимации** → **19 reduced-motion-сбросы** (всегда в конце файла).
Дизайн-система — CSS-переменные в `:root` (винно-бордовый / кремовый / золото,
единый easing `--fast`).

## Анимационная механика (важно при правках)

Это «несущая конструкция» — новые эффекты вешай на неё, не дублируй:

- **`.reveal` + IntersectionObserver** — fade + подъём + blur, стаггер через
  `--reveal-delay` (`(index % 4) * 0.08s`); ставит `.is-visible` и снимает
  наблюдение (`threshold: 0.12`, `rootMargin: 0px 0px -8% 0px`). Модификаторы
  `.reveal--left/--right` дают горизонтальный въезд. Конечное состояние ВСЕГДА
  сохраняет `rotate(var(--tilt,0deg))`.
- **`[data-parallax]`** — пишет `transform` ПРЯМО на узел через rAF (значение
  атрибута — коэффициент, ±0.03…0.06). ⚠️ Не вешай свои transform-анимации
  (Ken Burns, scaleX, пульс) на parallax-узлы — их затрёт. Используй
  внутренние `img`/обёртки/отдельные элементы.
- **`.anim-draw`** — «прорисовка» разделителей (линии `scaleX`, SVG
  `stroke-dashoffset`); наблюдается тем же reveal-обсервером.
- **`.photo-mask`** — обёртка фото: шторка `clip-path` на обёртке + Ken Burns
  `scale` на внутреннем `img`.
- **count-up таймера** — гейтируется флагом `countdownStarted`; ровно один
  `setInterval`. Расчёт остатка — общий `getRemaining()`, не дублировать.
- **`--fast`** — единый easing для всех переходов/анимаций.
- При `reduceMotion` (или отсутствии `IntersectionObserver`) все `.reveal`
  и `.anim-draw` сразу получают `.is-visible`, parallax не запускается,
  `scrollIntoView` переключается на `behavior: 'auto'`.

## Соглашения и ограничения

- Любая новая анимация ОБЯЗАНА быть выключена/мгновенна в
  `@media (prefers-reduced-motion: reduce)` (CSS — секция 19; JS — ветки по
  флагу `reduceMotion`). Это требование, а не пожелание.
- Никаких внешних JS-библиотек и шагов сборки. CSS → `styles.css`,
  JS → `main.js`, разметка → `index.html`. (Исключения — не-JS: шрифты
  Google Fonts с `display=swap` и iframe Яндекс.Карт.)
- Стиль JS — ES5 внутри IIFE: `var`, функции-объявления, без стрелок и
  шаблонных строк. Держись этого при правках, чтобы файл читался однородно.
- Цвета и easing — только из CSS-переменных дизайн-системы; не вводить хардкод
  вне палитры.
- Язык контента — русский, `lang="ru-RU"`, кодировка UTF-8. Сохранять
  доступность (aria) при изменении структуры (особенно имена Hero).
- Интро-видео — оставлять `muted` + `playsinline` (автоплей на мобильных),
  держать оба источника (`.mp4`/`.m4v`) и постер.
- Лайтбокс берёт изображения по селектору `.gallery__card img, .story__photo
  img` и читает `currentSrc||src` — не ломать этот селектор при правках фото.
- Часть ассетов (фото, видео, дресс-код, QR) грузится с живого WP-домена
  `yegor.diana.yarover.ru`. У каждого `<img>` есть
  `onerror="this.classList.add('img-failed')"` → CSS-плейсхолдер; у видео —
  постер. Новые внешние картинки добавлять с тем же хуком.
- Карты — iframe `yandex.ru/map-widget/v1/?text=…&z=16`, `loading="lazy"`,
  без API-ключа. `.ics` содержит время в UTC (`20260826T070000Z`–
  `20260826T200000Z` = 10:00–23:00 МСК).
- **`CLAUDE.md` не редактировать как код** в задачах по сайту: корневой — это
  руководство, вложенный — справочный анализ. Исключение — задача, прямо
  посвящённая документации.

## Настройка RSVP

По умолчанию форма в демо-режиме: `RSVP_ENDPOINT` содержит плейсхолдер
`YOUR_FORM_ID`, и `main.js` по подстроке `YOUR_FORM_ID` уходит в ветку
«показать спасибо, ничего не отправлять». Чтобы включить отправку — вставить
реальный Formspree endpoint в `RSVP_ENDPOINT` (`main.js`, строка 6). Подробно
и про альтернативу с Telegram (и почему она хуже для публичного сайта) — в
`yegor-diana-wedding/README.md`. Honeypot-поле `website` сохранять как
антиспам: если оно заполнено, submit тихо прерывается.

## Скилл `repo-map`

`.claude/skills/repo-map/` — самостоятельный скилл, к сайту отношения не
имеет. Отвечает на «где я сейчас / что у меня в GitHub»: собирает репозитории,
ветки, открытые PR и деревья файлов, выдаёт срез в чат **и** интерактивную
HTML-страницу из `assets/template.html`. Логика разнесена: `SKILL.md` —
сценарий, `reference/collect.md` — сбор данных, `reference/render.md` — вывод.
`install.sh` ставит скилл в другие репозитории. Read-only вызовы, которые ему
нужны (`git status/log/branch/…`, `mcp__github__*`, `list_repos`), уже
разрешены в `.claude/settings.json` — при правках скилла держи этот allowlist
в актуальном состоянии.
