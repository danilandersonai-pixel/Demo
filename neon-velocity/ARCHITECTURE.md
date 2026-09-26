# Neon Velocity: Rhythm & Dodge — архитектура

Неоновая аркада на рекорд. React 19 + TypeScript + Tailwind CSS 4 + Framer Motion +
Lucide React, игровой цикл и отрисовка — HTML5 Canvas 2D. Сборка — Vite 8.
Прогресс хранится в `localStorage`.

## 1. Общая схема

```
┌──────────────────────────── App.tsx (экраны, клавиши, прогресс) ─────────────────────────┐
│  useProgress() ── SaveData ⇄ localStorage                                                │
│                                                                                          │
│  <GameCanvas>  (z-0, весь экран, всегда смонтирован)                                     │
│     requestAnimationFrame-цикл:                                                          │
│       input.getState() → engine.setInput() → engine.update(dt)                           │
│       engine.drainEvents() → audio.handleEvent() + hudStore.pushBanner() + колбэки App   │
│       renderer.render(engine.state)                                                      │
│       hudStore.setSnapshot(engine.getHud())   (≤ 30 раз/с)                               │
│  <Hud>          (z-10, читает hudStore через useSyncExternalStore)                       │
│  <DeathFlash>   (z-20, взрыв-вспышка Framer Motion поверх холста)                        │
│  <MainMenu> / <PauseOverlay> / <GameOverOverlay>   (z-30, AnimatePresence)               │
│  <Shop> / <Leaderboard> / <SettingsPanel> / <HowToPlay>   (z-40, модальные панели)       │
│  <ScreenFx>     (z-50, сканлайны + виньетка, pointer-events: none)                       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

Экран один: холст живёт всегда (в меню — фоновая демо-сцена `attract`), всё остальное —
React-слои поверх него. Экран приложения (`Screen`): `menu → playing ⇄ paused → gameover`.

## 2. Файлы и владельцы

Контракты (уже написаны, **не менять** — если контракт мешает, обойти у себя и сообщить):

| Файл | Что внутри |
| --- | --- |
| `src/game/types.ts` | Все общие типы: сущности, `GameState`, `GameEvent`, `RunResult`, `HudSnapshot`, `SaveData` |
| `src/game/config.ts` | Баланс `GAME`, кривая сложности, пресеты `THEMES` / `SKINS` / `UPGRADES` / `OBSTACLES` |
| `src/game/math.ts` | clamp/lerp/damp/rand/weightedPick, цвета `rgba` / `mixColor` / `lighten` |
| `src/game/viewport.ts` | Раскладка экрана и перевод координат |
| `src/game/shipGeometry.ts` | Контуры корпусов кораблей (общие для Canvas и SVG) |
| `src/game/hudStore.ts` | Внешний стор HUD и баннеров + хуки `useHudSnapshot`, `useBanners` |
| `src/game/uiSound.ts` | Развязка UI и звука: `playUiSound()` / `setUiSoundHandler()` |
| `src/state/storage.ts`, `progress.ts`, `useProgress.ts` | Сохранение, чистые функции магазина и рекордов, React-хук |
| `src/components/ui/*` | UI-примитивы: `NeonButton`, `IconButton`, `Panel`, `Overlay`, `CrystalCount`, `Kbd`, `format.ts`, `themeCss.ts` |
| `src/index.css` | Tailwind 4, шрифты, токены цветов, утилиты свечения |

Модули реализации (у каждого файла один владелец; заглушки `// STUB` заменить целиком):

| Владелец | Файлы |
| --- | --- |
| **engine** | `src/game/engine.ts`, `src/game/spawner.ts`, `src/game/collision.ts`, `src/game/particles.ts` (+ любые новые `src/game/engine-*.ts`) |
| **renderer** | `src/game/renderer.ts` (+ любые новые `src/game/render/*.ts`) |
| **audio-input** | `src/game/audio.ts`, `src/game/input.ts` (+ любые новые `src/game/audio-*.ts`) |
| **shell** | `src/App.tsx`, `src/components/GameCanvas.tsx`, `src/components/Hud.tsx`, `src/components/PauseOverlay.tsx`, `src/components/GameOverOverlay.tsx`, `src/components/DeathFlash.tsx`, `src/components/ScreenFx.tsx` (+ любые новые `src/components/hud/*`) |
| **menus** | `src/components/MainMenu.tsx`, `src/components/Shop.tsx`, `src/components/Leaderboard.tsx`, `src/components/SettingsPanel.tsx`, `src/components/HowToPlay.tsx`, `src/components/ShipPreview.tsx`, `src/components/ThemePreview.tsx` (+ любые новые `src/components/menu/*`) |

Экспортируемые сигнатуры заглушек — это контракт: имена, параметры и типы менять нельзя
(добавлять новые публичные методы можно, если их никто, кроме владельца, не обязан звать).

## 3. Координаты и экран

- Холст на весь экран, размер `cssW × cssH`, физический — `× dpr` (dpr ≤ 2).
- Игровое поле — центральная колонка `fieldX … fieldX + fieldW`. Мир внутри поля:
  ширина всегда `WORLD_W = 480`, высота `worldH = cssH / scale`.
- Переход мир → экран: `screenX = fieldX + x * scale`, `screenY = y * scale`.
- Скорости в конфиге заданы для высоты мира 800; движок умножает их на
  `heightFactor(viewport) = worldH / 800`, чтобы время падения было одинаковым на любом экране.
- Игрок стоит на `y = worldH - GAME.player.yFromBottom`, двигается только по X в пределах
  `[edgePadding, WORLD_W - edgePadding]`.

## 4. Движок (`engine`)

`GameEngine` — чистая логика без DOM и без отрисовки. Один экземпляр живёт всё время,
режимы переключаются методами.

**Режимы (`state.mode`)**
- `attract` — фон для меню: сетка прокручивается со скоростью `GAME.speed.attract`, изредка
  пролетают декоративные препятствия и сферы, корабль на автопилоте плавно покачивается.
  Никаких столкновений, очков и событий, кроме `beat`.
- `playing` — забег. Первые `GAME.startGrace` сек препятствий нет; в начале событие
  `runStart`, по окончании паузы — `go`.
- `dying` — смертельное столкновение: взрыв (100+ частиц, кольца-волны), `shake = 1`,
  вспышка, `timeScale = GAME.death.slowMo`. Через `GAME.death.duration` **реальных** секунд —
  режим `over` и событие `gameOver` с `RunResult`.
- `over` — после взрыва: фон и частицы доживают, новые объекты не появляются, корабля нет.

**Время и шаг.** `update(dt)`: обрезать dt до `GAME.maxFrameDt`, умножить на `timeScale`,
дробить на подшаги ≤ `GAME.fixedStep` (от туннелирования на высокой скорости).
`state.time` растёт всегда, `runTime` — только в `playing`.

**Уровни скорости.** `level = levelForTime(runTime)` — новый уровень каждые 15 сек.
На повышении: `speedMult = speedMultForLevel(level)`, `bpm = bpmForLevel(level)`,
`levelUpPulse = 1`, тряска `GAME.shake.levelUp`, вспышка, событие `levelUp`.
Цвет сетки меняется в рендере по `level`. С уровня `GAME.zigzag.startLevel` новые
препятствия (и часть сфер) получают `zigzag` с вероятностью `zigzagChance(level)`:
`x = baseX + amp * sin(2π * freq * age + phase)`, амплитуда ограничена краями поля.

**Ритм.** Внутренние «часы» долей по `bpm`. На каждой доле — событие
`beat { index, bpm, level, lateBy }`, где `lateBy` — насколько граница доли была пересечена
раньше конца кадра (сек), чтобы звук мог сдвинуть удар точно в сетку. Спавн привязан к долям:
на доле генератор решает, что выпустить (паттерн), так что препятствия идут в такт музыке.
`beatPhase` 0..1 — для пульсации сетки и сфер.

**Генерация (spawner).** Паттерны, из которых генератор выбирает с весами, зависящими от
уровня: одиночный куб/пила; пара с проходом; «дождь» из 3 мелких кубов лесенкой; лазерная
стена с проходом (`laserGapForLevel`) со 2-го уровня; цепочки сфер 3–6 штук по синусоиде
или дуге. Обязательная честность:
- всегда есть проход шириной ≥ 3.2 диаметра корабля; лазер не спавнится в одной
  «полосе» по Y с другими препятствиями, которые перекрывают его проход;
- между рядами препятствий по Y есть зазор, за который корабль успевает перелететь
  через поле при текущей скорости;
- сферы не спавнятся внутри препятствий и рядом с ними (цепочка идёт по свободному коридору);
- частота спавна растёт с уровнем, но не «на каждой доле всегда».
Веса и размеры — из `OBSTACLES`, скорость падения `GAME.speed.base * preset.speedFactor`.

**Столкновения (collision).**
- Куб: повёрнутый квадрат (OBB) с половиной стороны `size * GAME.hitbox.cube` против круга игрока.
- Пила: круг `size * GAME.hitbox.saw`.
- Лазер: полоса толщиной `2 * size`; попадание, если игрок пересекает полосу по Y и хотя бы
  частично вне прохода `[x − gapW/2, x + gapW/2]` (с учётом `GAME.hitbox.laser` у радиуса игрока).
- При столкновении: если `invuln > 0` — игнор; если `shieldCharges > 0` — щит: заряд −1,
  `invuln = GAME.shield.invuln`, препятствие взрывается частицами, `hitFlash = 1`,
  тряска `GAME.shield`, событие `shieldBreak`, комбо сбрасывается (`comboBreak` reason `hit`);
  иначе — смерть (`death` → режим `dying`).

**Уклонения.** Когда препятствие пересекает линию игрока: `passed = true`, `+dodge` очков.
Если минимальный зазор между хитбоксами за время пролёта был < `GAME.nearMissDistance` —
«почти задел»: `+nearMiss` очков, всплывашка `NEAR MISS`, искры, лёгкая тряска, событие `nearMiss`.

**Сферы и комбо.**
- Подбор: круг игрока пересекает круг сферы. `chain += 1`, `multiplier = multiplierForChain(chain)`;
  при росте множителя — событие `comboUp`. Очки `crystal`/`rareCrystal` × множитель,
  валюта `currency`/`rareCurrency` × `crystalYield(upgrades)`. Частицы-пиксели (20–40 шт.) цвета
  сферы + кольцо, всплывашка `+N`. Событие `collect`.
- Пропуск: сфера ушла ниже игрока (y > player.y + радиус + 30), не собранная → `chain = 0`,
  `multiplier = 1`, событие `comboBreak` reason `miss` (только если было `chain > 0`).
- Редкая сфера с шансом `rareChance(upgrades)`.
- Магнит (`magnetRadius(skin, upgrades)` > 0): сферы в радиусе ускоряются к кораблю,
  сила растёт к центру (`GAME.magnet.strength`), `magnetized = true` для отрисовки поля.

**Очки.** Всё начисляется как `базовые × multiplier × (1 + skin.perks.scoreBonus)`:
выживание `perSecond × level` в секунду, уклонения, near miss, сферы.
Как только `score > highscore` и `highscore > 0` — один раз за забег `newRecord = true` и
событие `newRecord` (HUD показывает вспышку «NEW RECORD!»).

**Шлейф.** Если `skin.perks.trail` — каждый подшаг из сопел (`SHIP_GEOMETRY[shape].engines`)
вылетают частицы цвета `theme.colors.trail`. У всех кораблей есть короткий выхлоп двигателя.

**Частицы (particles).** Пул переиспользуемых объектов, лимит `GAME.particles.max`
(при переполнении — перезаписывать самые старые). В `state.particles` — только живые.
Физика: `v *= exp(−drag·dt)`, `vy += gravity·dt`, `size += grow·dt`, `life −= dt`.

**Тряска и вспышка.** `state.shake` — «травма» 0..1, прибавляется событиями (с ограничением 1),
затухает со скоростью `GAME.shake.decay`. `flash` затухает ~0.25 сек.

**HUD и итог.** `getHud()` — снимок для интерфейса (`fps = 0`, его заполняет GameCanvas).
`getRunResult()` — итог после `gameOver`. `RunResult.newRecord` = `state.newRecord`.

## 5. Рендер (`renderer`)

Canvas 2D, 60 FPS, никакого React. Слои кадра:
1. Фон `theme.colors.bg`, небо градиентом `skyTop → skyBottom`, звёзды/пыль.
2. Ретро-солнце у горизонта (≈ 38 % высоты): градиент `sunTop → sunBottom`, горизонтальные
   прорези-полосы, мягкое свечение; силуэт неоновых гор по горизонту.
3. **Перспективная сетка** на «полу» под горизонтом: линии сходятся к точке схода, поперечные
   линии «едут» на зрителя по `state.scroll`. Цвет — `grid[(level − 1) % n]` с плавным
   переходом ~1 с после смены уровня; яркость пульсирует по `beatPhase`; при `levelUpPulse`
   — яркая волна. В attract-режиме — тот же фон.
4. Границы поля: неоновые рельсы по краям колонки, если поле уже экрана.
5. Мир (трансформ `fieldX + shake`, `scale`): сферы (пульсирующие ромбы-кристаллы с ядром и
   ореолом, редкие — крупнее и другого цвета, линия поля при `magnetized`), препятствия:
   - куб — каркасный неоновый квадрат по реальному `rotation` с внутренним «3D»-квадратом и
     рёбрами (контур = хитбокс);
   - пила — диск с зубьями, вращается, внутреннее кольцо и отверстия;
   - лазер — луч во всю ширину поля с яркой сердцевиной и ореолом, эмиттеры по краям,
     проход подсвечен; лёгкое мерцание;
   корабль (контур из `SHIP_GEOMETRY`, крен по `tilt`, ядро, огонь из сопел; кольцо щита при
   `shieldCharges > 0`; мерцание при `invuln`; вспышка при `hitFlash`), частицы, всплывающий текст.
6. Полноэкранная вспышка `flash` цветом `flashColor`, лёгкая виньетка.

Неон без тормозов: не использовать `shadowBlur` в циклах по частицам/объектам. Свечение —
двойным штрихом (широкий полупрозрачный + тонкий яркий) и `globalCompositeOperation = 'lighter'`;
ореолы — из кэша офскрин-спрайтов радиального градиента по цвету. Градиенты неба/солнца
кэшировать до смены размера или темы. Тряска: смещение `shake² × GAME.shake.maxOffset`
(только если `options.shake`), со случайным направлением каждый кадр.
Шрифт текста на холсте — `"Orbitron", "JetBrains Mono Variable", monospace`; до загрузки шрифтов
вызвать `document.fonts.load(...)` для Orbitron 700/900.

## 6. Звук и ввод (`audio-input`)

**AudioEngine** — Web Audio API, всё синтезируется на лету, без файлов.
- `unlock()` создаёт/возобновляет `AudioContext` (только из жеста пользователя).
  Цепочка: голоса → шины music/sfx (громкость из настроек) → компрессор → выход.
- Музыка — синтвейв, собирается на `beat`-событиях (только при `setMusicActive(true)`):
  бочка на каждую долю, клэп на 2 и 4, хэты восьмыми (вторую восьмую запланировать через
  полдоли), бас-арпеджио восьмыми по прогрессии Am–F–C–G (по такту = 4 доли), пэд-аккорды со
  «сайдчейном» от бочки; с 3-го уровня добавляется лид-арпеджио, с 5-го — плотнее хэты.
  Время удара: `ctx.currentTime + LATENCY − lateBy` (LATENCY ≈ 0.05 с) — ровная сетка без дрожания.
- Эффекты: `collect` (яркий блип, тон растёт с `chain`), редкая — искрящееся арпеджио,
  `comboUp` (восходящий аккорд), `comboBreak` (нисходящий свип), `nearMiss` (свист шума),
  `shieldBreak` (звон + удар), `levelUp` (райзер + удар), `newRecord` (фанфара),
  `death` (взрыв: шум с падающим фильтром + саб-удар), `runStart`/`go` (сигналы старта).
- `ui(sound)`: hover (тихий тик), click, back, buy (монетное арпеджио), equip, error (гудок),
  toggle. Модуль при загрузке регистрирует `setUiSoundHandler((s) => audio.ui(s))`.
- `setPaused(true)` — плавно заглушить все звучащие голоса; `setSettings` — громкости и
  выключение звука. Без `unlock()` все методы безопасно ничего не делают.
- Лимит одновременных голосов, чтобы не перегружать поток при частых событиях.

**InputController.**
- Клавиатура (window): ←/→ и A/D → `axis`. Обе нажаты — последняя нажатая. На `blur` окна —
  сброс. `preventDefault` для стрелок только когда ввод включён и фокус не в поле ввода.
- Указатель (target — холст): мышь управляет при движении (без клика), палец — при касании и
  ведении. `pointerX` — мировой X через `toWorldX(clientX)`. Касание отпущено или мышь ушла с холста →
  `pointerX` сохраняет последнее значение (корабль доезжает до него и останавливается).
- Любое нажатие клавиши управления переводит `lastSource` в `keyboard`, движение указателя —
  в `pointer`. Движок: `pointer` → плавное следование к `pointerX` (`GAME.player.pointerFollow`,
  предел `pointerMaxSpeed`), `keyboard` → ускорение/трение.
- `setEnabled(false)` — нейтральное состояние и никаких `preventDefault`.

## 7. Оболочка (`shell`)

**App.tsx.** `useProgress()`; `loadout = getLoadout(save)` (мемо по надетым id, улучшениям, рекорду);
`applyThemeCss(theme)` при смене темы; `audio.setSettings(...)` при смене настроек.
Состояния: `screen`, `panel: MenuPanel | null`, `runId`, последний `RunResult` и `RecordOutcome`.
- «Играть»/«Ещё раз»: `audio.unlock()`, закрыть панель, `runId + 1`, `screen = 'playing'`.
- `onGameOver(result)`: `actions.recordRun(result)` → сохранить outcome → `screen = 'gameover'`.
- Пауза: `Esc`/`P` в забеге, кнопка в HUD, потеря фокуса/скрытие вкладки. Продолжить — `Esc`/`P`/кнопка.
- Клавиши: меню — `Enter`/`Space` играть (если панель закрыта), `Esc` закрывает панель;
  пауза — `R` рестарт, `M` меню; game over — `Enter`/`Space`/`R` ещё раз, `Esc` меню.
- `<MotionConfig reducedMotion="user">`; слои по схеме из раздела 1; `AnimatePresence` для экранов.
- Никаких `alert` / `confirm` / `prompt`.

**GameCanvas.tsx.** Холст на весь экран; владеет `GameEngine`, `Renderer`, `InputController`
(создаются один раз, корректно переживают двойной mount в StrictMode: цикл rAF и слушатели
снимаются в cleanup). `ResizeObserver` → `computeViewport` → `renderer.resize` + `engine.resize`.
Пропсы читаются в цикле через ref'ы (без перезапуска цикла). Смена `runId` → `engine.startRun(loadout)`,
`input.reset()`, `audio.setMusicActive(true)`, `hudStore.clearBanners()`. `screen === 'menu'` →
`engine.enterAttract()` + `setMusicActive(false)`; в меню смена loadout → `engine.setLoadout`.
`paused` → не вызывать `update`, но рисовать; `audio.setPaused`. Ввод включён только в `playing`.
События: всё → `audio.handleEvent`; `runStart` → баннер READY; `go` → GO!; `levelUp` → `LEVEL N` /
`SPEED ×1.28`; `newRecord` → `NEW RECORD!`; `shieldBreak` → `SHIELD DOWN`; `comboBreak` при потере
x2+ → `COMBO BREAK`; `death` → `DeathFlash` в экранной точке корабля; `gameOver` → `setMusicActive(false)`,
`onGameOver(result)`. FPS — скользящее среднее, в снимок HUD. Скрытие вкладки / blur в забеге →
`onRequestPause()`.

**Hud.tsx** (видим в `playing`/`paused`). Сверху: SCORE (крупно, моноширинно, ведущие нули
приглушены), COMBO `xN` c полоской прогресса до следующего множителя (пружинный «поп» при росте,
красная дрожь при сбросе), BEST — абсолютный рекорд (жёлтый и с пометкой, когда побит).
Ниже: уровень `LV N · SPEED ×1.28` с полоской до следующего уровня, кристаллы за забег,
иконки заряда щита, кнопка паузы (единственный интерактивный элемент, остальное `pointer-events-none`).
Баннеры из `useBanners()` по центру через `AnimatePresence`: «NEW RECORD!» — большая неоновая
вспышка с мерцанием. Первый забег (`!save.seenTutorial`) — подсказка управления на несколько секунд.
FPS в углу, если включён в настройках. Мобильная раскладка компактнее.

**PauseOverlay / GameOverOverlay** — `<Overlay blur>` (размытие заднего плана) + неоновая карточка,
плавное появление. Размытие пересчитывается, пока под ним или на экране что-то меняется, поэтому
на паузе рендер отдаёт один замороженный кадр, под Game Over холст замирает через `OVER_LIVE` сек,
а CSS-анимации этих экранов конечны. Панели меню (`layer={40}`) фон не размывают, только затемняют:
под ними живёт демо-сцена.
Pause: «PAUSE», продолжить / заново / в меню, быстрый переключатель звука, подсказки клавиш.
Game Over: «GAME OVER» с глитчем, счёт с анимированным набором, бейдж «NEW RECORD!» (или
«ПЕРВЫЙ РЕКОРД» при `previousHighscore === 0`), место в топ-5, статистика (уровень и скорость,
лучшее комбо, сферы, заработанные кристаллы, время, near miss), кошелёк, кнопки «Ещё раз»,
«Магазин», «Рекорды», «Меню».

**DeathFlash** — при смерти: белая вспышка экрана, 2–3 расходящихся неоновых кольца и
осколки из точки взрыва (Framer Motion), сам снимается. **ScreenFx** — сканлайны и виньетка.

## 8. Меню (`menus`)

- **MainMenu** — логотип «NEON VELOCITY» (Orbitron 900, неоновое свечение, мерцание/глитч) и
  «RHYTHM & DODGE»; кнопка «Играть» (главная, `Enter`); «Магазин», «Рекорды», «Настройки»,
  «Как играть»; плашки рекорда и кошелька; текущее снаряжение (корабль + тема); кнопка звука;
  предупреждение, если `storageOk === false`. Каскадное появление элементов.
- **Shop** — вкладки «Корабли» / «Темы» / «Улучшения». Карточка: превью (`ShipPreview` —
  SVG из `SHIP_GEOMETRY` в цветах темы; `ThemePreview` — мини-сцена: небо, солнце, сетка),
  название, описание, перки-иконки, цена. Состояния: купить (не хватает — показать, сколько
  ещё нужно, кнопка неактивна) / надеть / надето. Улучшения — уровни-сегменты `n / max`, цена
  следующего уровня, «MAX». Покупка — взрыв частиц из кнопки (Framer Motion) + звук `buy`.
  Кошелёк в шапке с анимацией изменения.
- **Leaderboard** — топ-5: место (1 — корона), счёт, уровень скорости (`LV 5 · ×1.56`), дата и
  время, лучшее комбо, корабль. Подсветка последнего забега (`highlightId`). Пустое состояние.
  Внизу — общая статистика (игр сыграно, всего кристаллов, общее время).
- **SettingsPanel** — звук вкл/выкл, громкость музыки и эффектов (слайдеры), тряска экрана,
  счётчик FPS, сброс прогресса с подтверждением прямо в панели (два шага).
- **HowToPlay** — управление (клавиатура / мышь / тач), цель, препятствия (мини-иконки куба,
  пилы, лазера), сферы и комбо, уровни скорости каждые 15 с, перки кораблей.

## 9. Правила кода

- TypeScript strict, без `any`, без `// TODO`, заглушек и «упрощённых версий». Код законченный.
- Комментарии по-русски, коротко и по делу (зачем, а не что).
- Тексты интерфейса — по-русски; аркадные надписи (SCORE, COMBO, BEST, NEW RECORD!, GAME OVER,
  PAUSE, LEVEL, GO!) — латиницей.
- Стили — Tailwind-классы и токены из `index.css` (`bg-void`, `text-neon-pink`, `text-glow-cyan`,
  `box-glow-pink`, `glass`, `font-display` …). Произвольные значения вида `bg-[#05050a]` допустимы.
  Не редактировать `index.css` — дополнительные стили кладите в свой `.css` рядом с компонентом.
- Анимации интерфейса — Framer Motion; `prefers-reduced-motion` уважается (MotionConfig).
- Горячий цикл без аллокаций там, где их легко избежать; никаких `setState` в каждом кадре.
- Доступность: `aria-label` у иконок-кнопок, видимый фокус, диалоги с `role="dialog"`.
- Проверка перед сдачей: `npm run typecheck` без ошибок.

## 10. Чек-лист требований

1. Canvas-поле; треугольный светящийся корабль внизу; управление ←/→ и мышь/тач с плавным следованием.
2. Сверху вниз на большой скорости: кубы, лазерные линии, циркулярные пилы.
3. Сбор светящихся энергетических сфер: очки и комбо-множитель.
4. Каждые 15 с: скорость ↑, цвет сетки меняется, препятствия идут зигзагом.
5. HUD: Score, Combo Multiplier (x1, x2, x3…; сброс при столкновении или пропуске сферы), Highscore.
6. «NEW RECORD!» вспыхивает в момент, когда счёт обгоняет рекорд.
7. Топ-5 с датой и уровнем скорости.
8. Магазин за кристаллы: скины «Неоновый шлейф», «Щит-призрак» (1 ошибка за игру), «Магнит».
9. Темы: «Neon Cyberpunk», «Retrowave Gold», «Toxic Acid» (+ «Arctic Pulse»).
10. Частицы при сборе и взрыве, с физикой затухания.
11. Тряска экрана при столкновении и при новом уровне скорости.
12. Экраны Game Over и Pause с backdrop-blur и анимацией Framer Motion.
13. requestAnimationFrame, плавные 60 FPS.
14. Прогресс, кристаллы, рекорды — автоматически в localStorage и обратно.
15. Стиль: фон `#05050a`, сетка перспективы, неоновое свечение, маджента/бирюза/жёлтый,
    крупный моноширинный шрифт `font-mono tracking-widest`.
