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

## Структура

```
.
├── CLAUDE.md                       — этот файл (актуальное руководство)
├── .github/workflows/deploy-pages.yml  — деплой на GitHub Pages
└── yegor-diana-wedding/            — САМ САЙТ (публикуется в корень Pages)
    ├── index.html                  — вся разметка, одна страница, якорные секции
    ├── favicon.svg                 — монограмма «Е&Д»
    ├── README.md                   — инструкции по превью и настройке RSVP
    ├── CLAUDE.md                   — референс-анализ исходного WP-сайта (НЕ трогать как код)
    └── assets/
        ├── css/styles.css          — дизайн-система, секции, анимации, адаптив
        └── js/main.js              — вся клиентская логика (один IIFE)
```

## Команды

Сборки/тестов нет. Рабочий цикл:

```bash
# Локальное превью
cd yegor-diana-wedding && python3 -m http.server   # → http://localhost:8000

# Проверка JS перед коммитом (обязательно)
node --check yegor-diana-wedding/assets/js/main.js
```

Деплой автоматический: push в ветку `claude/website-analysis-claude-md-kd3foj`
запускает `.github/workflows/deploy-pages.yml`, который публикует папку
`yegor-diana-wedding/` в корень GitHub Pages. Превью PR/ветки без Pages —
через githack (raw.githack.com на `index.html`).

## Архитектура

**`index.html`** — единственная страница. Порядок оверлеев по `z-index`:
прелоадер (120) → интро-видео (100) → scroll-progress (95) → навигация (90).
Секции с якорями: `#hero`, `#countdown`, `#story`, `#program`, `#location`,
`#details`, `#rsvp`, `#flowers`.

**`assets/js/main.js`** — один IIFE, без зависимостей. В начале файла:
`const RSVP_ENDPOINT` (Formspree; пока плейсхолдер `YOUR_FORM_ID` → демо-режим)
и `const reduceMotion` (флаг `prefers-reduced-motion`, на него опираются все
анимационные ветки). Отвечает за: прелоадер, интро-видео (Play/Skip), таймер
обратного отсчёта + count-up, scroll-reveal (IntersectionObserver), parallax
(rAF), навигацию + scroll-progress, генерацию `.ics`, лайтбокс, отправку RSVP,
разбивку имён Hero на span'ы.

**`assets/css/styles.css`** — пронумерованные секции `1…19` (см. баннеры
`/* ===== N. … ===== */`). Дизайн-система — CSS-переменные в `:root` (палитра
винно-бордовый/кремовый/золото, единый easing `--fast`). Секции 18–19 —
добавленные анимации и их reduced-motion-сбросы.

## Анимационная механика (важно при правках)

Это «несущая конструкция» — новые эффекты вешай на неё, не дублируй:

- **`.reveal` + IntersectionObserver** — fade + подъём + blur, стаггер через
  `--reveal-delay`; ставит `.is-visible` и снимает наблюдение. Модификаторы
  `.reveal--left/--right` дают горизонтальный въезд. Конечное состояние ВСЕГДА
  сохраняет `rotate(var(--tilt,0deg))`.
- **`[data-parallax]`** — пишет `transform` ПРЯМО на узел через rAF. ⚠️ Не вешай
  свои transform-анимации (Ken Burns, scaleX, пульс) на parallax-узлы — их
  затрёт. Используй внутренние `img`/обёртки/отдельные элементы.
- **`.anim-draw`** — «прорисовка» разделителей (линии `scaleX`, SVG
  `stroke-dashoffset`); наблюдается тем же reveal-обсервером.
- **`.photo-mask`** — обёртка фото: шторка `clip-path` на обёртке + Ken Burns
  `scale` на внутреннем `img`.
- **count-up таймера** — гейтируется флагом `countdownStarted`; ровно один
  `setInterval`. Расчёт остатка — общий `getRemaining()`, не дублировать.
- **`--fast`** — единый easing для всех переходов/анимаций.

## Соглашения и ограничения

- Любая новая анимация ОБЯЗАНА быть выключена/мгновенна в
  `@media (prefers-reduced-motion: reduce)` (CSS — секция 19; JS — ветки по
  флагу `reduceMotion`). Это требование, а не пожелание.
- Никаких внешних JS-библиотек и шагов сборки. CSS → `styles.css`,
  JS → `main.js`, разметка → `index.html`.
- Цвета и easing — только из CSS-переменных дизайн-системы; не вводить хардкод
  вне палитры.
- Язык контента — русский, `lang="ru-RU"`, кодировка UTF-8. Сохранять
  доступность (aria) при изменении структуры (особенно имена Hero).
- Интро-видео — оставлять `muted` + `playsinline` (автоплей на мобильных),
  держать оба источника (`.mp4`/`.m4v`) и постер.
- Лайтбокс берёт изображения по селектору `.gallery__card img, .story__photo
  img` и читает `currentSrc||src` — не ломать этот селектор при правках фото.
- Часть ассетов (фото, видео, дресс-код, QR) грузится с живого WP-домена; при
  недоступности срабатывают CSS-плейсхолдеры/постер (`onerror` хуки).
- **`CLAUDE.md` не редактировать как код** в задачах по сайту: корневой — это
  руководство, вложенный — справочный анализ.

## Настройка RSVP

По умолчанию форма в демо-режиме (ничего не шлёт). Чтобы включить отправку —
вставить Formspree endpoint в `RSVP_ENDPOINT` (`main.js`, строка ~6). Подробно
и про альтернативу с Telegram — в `yegor-diana-wedding/README.md`. Honeypot-поле
`website` сохранять как антиспам.
