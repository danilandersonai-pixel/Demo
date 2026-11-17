#!/usr/bin/env node
/**
 * Neon Velocity II — end-to-end check (Playwright + Chromium).
 *
 * USAGE
 *   npm run build && npm run preview            # terminal 1 → http://localhost:4173
 *   npm run e2e                                 # terminal 2
 *   node scripts/e2e.mjs [url] [options]
 *
 *   url                 default http://localhost:4173/?debug. A production build exposes the debug API
 *                       (window.__NV__) only with «debug» in the query or the hash; the dev server
 *                       (npm run dev → http://localhost:5173/) has it without flags.
 *   --only=a,b          run only these scenarios: desktop, phone, progress, shop, panels, edge, fuzz
 *   --seeds=1,2,3,4     seeds of the transition fuzzer (odd → 1280×800 mouse, even → 390×844 touch)
 *   --steps=150         fuzzer steps per seed
 *   --shots=DIR         save a screenshot there when a scenario fails
 *   --headed            show the browser
 *
 * Needs the `playwright` package and its Chromium (npm i -D playwright && npx playwright install chromium);
 * a global install under /opt/node22 is picked up as a fallback.
 *
 * The game is driven ONLY through its UI (keys, mouse, touch, window size) and through window.__NV__
 * (src/debug.ts): the sim state is read, the pilot is replaced with the game's own autopilot or a
 * «kamikaze» that steers into the nearest obstacle, and three Simulation methods are wrapped to COUNT
 * calls (startRun, abandon) — the wrappers change nothing.
 *
 * WHAT IS CHECKED (every line of the output is PASS / FAIL; the exit code is 1 on any FAIL)
 *   desktop  1280×800: menu renders · start by Enter · autopilot reaches level 3 · one rAF loop
 *            (ticks ≈ 128/s, frames ≈ display rate) · pause / resume by key, button, blur, hidden tab ·
 *            0 ticks while paused · resize and rotation mid-run · forced death → Game Over ·
 *            the save (gamesPlayed, leaderboard, crystals) · reload keeps it
 *   phone    390×844 touch: the same flow with taps and finger steering
 *   progress seeded highscore: NEW RECORD! banner · «Заново» / «В меню» from pause recorded exactly once ·
 *            the next run starts with the new highscore · an empty run is not recorded · reload mid-run
 *   shop     buys a ship, a theme and an upgrade; the live theme changes; no purchase without crystals
 *   panels   every panel opens and closes with Esc, the close button and a click on the backdrop
 *   edge     double click on «Играть» · double tap on «В меню» · corrupted save · storage that throws ·
 *            two tabs with one save
 *   fuzz     seeded random walk over keys, taps, resizes, visibility changes and forced deaths; after
 *            every step: screen and sim mode agree, at most one non-inert dialog, wallet ≥ 0,
 *            gamesPlayed grows exactly once per finished or abandoned non-empty run
 *   …and no console errors, page errors, failed requests or native alert / confirm / prompt anywhere.
 *
 * Timing checks repeat a measurement before they fail; on a machine that cannot hold the display rate
 * the absolute FPS check is reported as SKIP, the «one loop» checks still run.
 */

const SAVE_KEY = 'neon-velocity-2/save/v1';
const TICK_RATE = 128;
const TICKS_PER_LEVEL = 1920;
const STARTING_CRYSTALS = 150;

// ─── Командная строка ───────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = {};
for (const a of argv) {
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq < 0) flags[a.slice(2)] = 'true';
  else flags[a.slice(2, eq)] = a.slice(eq + 1);
}
const URL_ARG = argv.find((a) => !a.startsWith('--')) ?? 'http://localhost:4173/?debug';
const ONLY = flags.only ? new Set(flags.only.split(',').map((s) => s.trim())) : null;
const FUZZ_SEEDS = (flags.seeds ?? '1,2,3,4').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
const FUZZ_STEPS = Math.max(1, Number(flags.steps ?? 150) || 150);
const SHOTS = flags.shots ?? null;

if (flags.help) {
  console.log('usage: node scripts/e2e.mjs [url] [--only=desktop,phone,progress,shop,panels,edge,fuzz] [--seeds=1,2,3,4] [--steps=150] [--shots=DIR] [--headed]');
  process.exit(0);
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    try {
      return await import('/opt/node22/lib/node_modules/playwright/index.mjs');
    } catch {
      console.error('FAIL  playwright is not installed: npm i -D playwright && npx playwright install chromium');
      process.exit(2);
    }
  }
}

const { chromium } = await loadPlaywright();

// ─── Отчёт ──────────────────────────────────────────────────────────────────

const report = { pass: 0, fail: 0, skip: 0, failed: [] };

function line(kind, name, detail) {
  console.log(`${kind.padEnd(4)}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Проверки одного сценария: scope('desktop')('menu renders', ok, detail). */
function scope(prefix) {
  const check = (name, ok, detail = '') => {
    const full = `[${prefix}] ${name}`;
    if (ok) {
      report.pass++;
      line('PASS', full, detail);
    } else {
      report.fail++;
      report.failed.push(full);
      line('FAIL', full, detail);
    }
    return Boolean(ok);
  };
  check.skip = (name, detail = '') => {
    report.skip++;
    line('SKIP', `[${prefix}] ${name}`, detail);
  };
  check.prefix = prefix;
  return check;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digits = (text) => String(text ?? '').replace(/\D/g, '');
const fmt = (n, d = 1) => Number(n).toFixed(d);
const json = (v) => JSON.stringify(v);

// ─── Зонд в странице ────────────────────────────────────────────────────────

/**
 * Выполняется в странице до скриптов игры. Ничего не меняет в игре: считает
 * кадры браузера, копит события симуляции и оборачивает startRun / abandon,
 * чтобы знать, сколько забегов началось и сколько брошено непустыми.
 */
function installProbe(saveKey) {
  const tally = { runs: 0, gameOver: 0, death: 0, shieldBreak: 0, ready: 0, go: 0, results: [], newRecord: [], levelUp: [], abandons: [] };
  const e2e = { raf: 0, tally, hooked: null };

  const loop = () => {
    e2e.raf++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  e2e.hook = () => {
    const nv = window.__NV__;
    if (!nv) return false;
    if (e2e.hooked === nv.sim) return true;
    const sim = nv.sim;
    e2e.hooked = sim;
    const startRun = sim.startRun;
    sim.startRun = function (...args) {
      tally.runs++;
      return startRun.apply(sim, args);
    };
    const abandon = sim.abandon;
    sim.abandon = function () {
      const s = sim.state;
      const before = { mode: s.mode, tick: s.tick, score: s.score, collected: s.crystalsCollected };
      const result = abandon.call(sim);
      const live = before.mode === 'ready' || before.mode === 'playing' || before.mode === 'dying';
      if (live) tally.abandons.push({ before, result: result ? { score: result.score, crystals: result.crystals } : null });
      return result;
    };
    return true;
  };

  e2e.pull = () => {
    const nv = window.__NV__;
    if (!nv) return;
    for (const e of nv.takeEvents()) {
      if (e.type === 'gameOver') {
        tally.gameOver++;
        const r = e.result;
        tally.results.push({ score: r.score, crystals: r.crystals, level: r.level, newRecord: r.newRecord, duration: r.duration, tick: e.tick });
      } else if (e.type === 'death') tally.death++;
      else if (e.type === 'shieldBreak') tally.shieldBreak++;
      else if (e.type === 'ready') tally.ready++;
      else if (e.type === 'go') tally.go++;
      else if (e.type === 'newRecord') tally.newRecord.push({ tick: e.tick, score: e.score });
      else if (e.type === 'levelUp') tally.levelUp.push({ tick: e.tick, level: e.level, speedMult: e.speedMult });
    }
  };

  e2e.snap = () => {
    const nv = window.__NV__;
    if (!nv) return null;
    e2e.hook();
    e2e.pull();
    const s = nv.sim.state;
    let save = null;
    let saveError = null;
    try {
      const text = window.localStorage.getItem(saveKey);
      save = text === null ? null : JSON.parse(text);
    } catch (err) {
      saveError = String(err);
    }
    const dialogs = [];
    for (const d of document.querySelectorAll('[role="dialog"]')) {
      if (d.closest('[inert]') || d.getClientRects().length === 0) continue;
      const id = d.getAttribute('aria-labelledby');
      const title = id ? document.getElementById(id) : null;
      dialogs.push(((title ? title.textContent : d.getAttribute('aria-label')) || '').trim().slice(0, 24));
    }
    const cam = nv.camera();
    return {
      screen: nv.screen(),
      mode: s.mode,
      tick: s.tick,
      seed: s.seed,
      level: s.level,
      speedMult: s.speedMult,
      score: s.score,
      collected: s.crystalsCollected,
      highscore: s.highscore,
      newRecord: s.newRecord,
      alive: s.player.alive,
      x: s.player.x,
      shield: s.player.shield,
      counters: nv.counters(),
      raf: e2e.raf,
      now: performance.now(),
      dialogs,
      save,
      saveError,
      tally: JSON.parse(JSON.stringify(tally)),
      vw: window.innerWidth,
      vh: window.innerHeight,
      cam: { cssW: cam.cssW, cssH: cam.cssH, dpr: cam.dpr },
    };
  };

  /** Пилот-самоубийца: ведёт корабль в ближайшее препятствие (у лазера — прочь от прохода). */
  e2e.kamikaze = (state) => {
    let best = null;
    for (const o of state.obstacles) {
      if (o.destroyed || o.resolved || o.arriveTick < state.tick) continue;
      if (!best || o.arriveTick < best.arriveTick) best = o;
    }
    let x = state.player.x;
    if (best) x = best.kind === 'laser' ? (best.x < state.player.x ? 1e4 : -1e4) : best.x;
    return { axis: 0, pointerX: x, source: 'pointer' };
  };

  /** Вкладку «спрятали» / «вернули»: то же событие, что шлёт браузер. */
  e2e.setHidden = (hidden) => {
    if (hidden) {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    } else {
      delete document.hidden;
      delete document.visibilityState;
    }
    document.dispatchEvent(new Event('visibilitychange'));
  };
  e2e.blur = () => window.dispatchEvent(new Event('blur'));

  /** Уменьшенная копия холста игры (сам холст не трогаем): средний цвет и число разных цветов. */
  e2e.canvasStats = () => {
    const src = document.querySelector('canvas');
    if (!src || !src.width || !src.height) return null;
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, 48, 48);
    const data = ctx.getImageData(0, 0, 48, 48).data;
    const seen = new Set();
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      seen.add((data[i] >> 3) | ((data[i + 1] >> 3) << 5) | ((data[i + 2] >> 3) << 10));
    }
    const n = data.length / 4;
    const rect = src.getBoundingClientRect();
    return { mean: [r / n, g / n, b / n], colors: seen.size, width: src.width, height: src.height, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
  };

  /** Видимые кнопки и контролы с координатами центра — для случайных нажатий. */
  e2e.targets = () => {
    const out = [];
    for (const el of document.querySelectorAll('button, [role="tab"], [role="switch"], input')) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 1 || y < 1 || x > window.innerWidth - 1 || y > window.innerHeight - 1) continue;
      out.push({ x, y, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) });
    }
    return out;
  };

  window.__e2e = e2e;
}

// ─── Браузер и страница ─────────────────────────────────────────────────────

const PROFILES = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};

function watchErrors(page, list = []) {
  page.on('console', (m) => {
    if (m.type() === 'error') list.push(`console.error: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => list.push(`pageerror: ${String(e.message).slice(0, 300)}`));
  page.on('dialog', (d) => {
    list.push(`native ${d.type()}(): ${d.message().slice(0, 120)}`);
    d.dismiss().catch(() => {});
  });
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? '';
    // Перезагрузка страницы обрывает свои же запросы — это не ошибка игры.
    if (!/ERR_ABORTED/.test(why)) list.push(`request failed: ${r.url()} ${why}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) list.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return list;
}

async function gameReady(page, timeout = 20_000) {
  try {
    await page.waitForFunction(() => Boolean(window.__NV__ && window.__e2e && window.__e2e.hook() && window.__NV__.screen() === 'menu'), null, {
      timeout,
      polling: 50,
    });
  } catch {
    const has = await page.evaluate(() => Boolean(window.__NV__)).catch(() => false);
    throw new Error(
      has ? 'the game did not reach the main menu' : `window.__NV__ is missing at ${page.url()} — a production build needs «?debug» in the address`,
    );
  }
}

/**
 * Новый контекст (чистое хранилище) и страница с игрой в главном меню.
 * save — объект или строка, которую нужно положить в localStorage до запуска.
 */
async function openGame(browser, profileName, options = {}) {
  const context = options.context ?? (await browser.newContext({ ...PROFILES[profileName], locale: 'ru-RU' }));
  if (!options.context) {
    await context.addInitScript(installProbe, SAVE_KEY);
    if (options.initScript) await context.addInitScript(options.initScript);
  }
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto(URL_ARG, { waitUntil: 'load' });
  if (options.save !== undefined) {
    const text = typeof options.save === 'string' ? options.save : JSON.stringify(options.save);
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [SAVE_KEY, text]);
    await page.reload({ waitUntil: 'load' });
  }
  await gameReady(page);
  return { context, page, errors, touch: Boolean(PROFILES[profileName].hasTouch), profile: profileName };
}

const snap = (page) => page.evaluate(() => window.__e2e.snap());

/** Ждать условие в странице; false вместо исключения. */
async function until(page, predicate, arg, timeout = 5000) {
  try {
    await page.waitForFunction(predicate, arg, { timeout, polling: 40 });
    return true;
  } catch {
    return false;
  }
}

const untilScreen = (page, screen, timeout = 5000) => until(page, (want) => window.__NV__?.screen() === want, screen, timeout);

function makeSave(patch = {}) {
  return {
    version: 1,
    crystals: STARTING_CRYSTALS,
    highscore: 0,
    leaderboard: [],
    ownedSkins: ['core'],
    equippedSkin: 'core',
    ownedThemes: ['cyberpunk'],
    equippedTheme: 'cyberpunk',
    upgrades: { resonator: 0, fieldAmp: 0, lucky: 0 },
    settings: { sound: true, music: 0.7, sfx: 0.8, screenShake: true, showFps: false },
    stats: { gamesPlayed: 0, totalCrystals: 0, totalScore: 0, bestMultiplier: 1, totalTime: 0 },
    seenTutorial: true,
    ...patch,
  };
}

function entry(score, daysAgo = 1) {
  return {
    id: `seed${score}`,
    score,
    level: 1,
    speedMult: 1,
    date: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    maxMultiplier: 2,
    crystals: 3,
    duration: 12,
    skinId: 'core',
  };
}

/** Нажать кнопку так, как это делает игрок на этом устройстве (ждёт, пока кнопка «взведётся»). */
async function press(game, locator, timeout = 5000) {
  if (game.touch) await locator.tap({ timeout });
  else await locator.click({ timeout });
}

const button = (page, name) => page.getByRole('button', { name }).first();

async function autopilot(page, on = true) {
  await page.evaluate((v) => window.__NV__.autopilot(v), on);
}

/** Направить корабль в препятствие и дождаться экрана Game Over. */
async function forceDeath(page, timeout = 40_000) {
  await page.evaluate(() => window.__NV__.setInput(window.__e2e.kamikaze));
  const ok = await untilScreen(page, 'gameover', timeout);
  await page.evaluate(() => window.__NV__.setInput(null));
  return ok;
}

/** Тики, кадры игры и кадры браузера в секунду за окно ms. */
async function measureRates(page, ms) {
  const read = () => page.evaluate(() => ({ c: window.__NV__.counters(), raf: window.__e2e.raf, now: performance.now(), tick: window.__NV__.sim.state.tick }));
  const a = await read();
  await sleep(ms);
  const b = await read();
  const dt = (b.now - a.now) / 1000;
  return {
    ticks: (b.c.ticks - a.c.ticks) / dt,
    frames: (b.c.frames - a.c.frames) / dt,
    display: (b.raf - a.raf) / dt,
    simTicks: b.tick - a.tick,
    dTicks: b.c.ticks - a.c.ticks,
    dFrames: b.c.frames - a.c.frames,
  };
}

/**
 * Один цикл rAF: тики идут в реальном времени (128/с), кадр игры рисуется ровно
 * один раз на кадр браузера. Замер повторяется — соседи по машине шумят.
 */
async function checkOneLoop(page, check, label) {
  const tries = [];
  for (let i = 0; i < 4; i++) {
    const r = await measureRates(page, 3000);
    tries.push(r);
    const ticksOk = Math.abs(r.ticks - TICK_RATE) <= TICK_RATE * 0.04;
    const ratio = r.display > 0 ? r.frames / r.display : 0;
    if (ticksOk && Math.abs(ratio - 1) <= 0.04) break;
  }
  const best = tries.reduce((p, c) => (Math.abs(c.ticks - TICK_RATE) < Math.abs(p.ticks - TICK_RATE) ? c : p));
  const all = tries.map((r) => `${fmt(r.ticks)} t/s, ${fmt(r.frames)} f/s of ${fmt(r.display)} Hz`).join(' | ');
  check(`${label}: ticks ≈ 128/s`, Math.abs(best.ticks - TICK_RATE) <= TICK_RATE * 0.04, all);
  const ratio = best.display > 0 ? best.frames / best.display : 0;
  check(`${label}: exactly one rAF loop (one game frame per display frame)`, Math.abs(ratio - 1) <= 0.04, `game ${fmt(best.frames)} f/s, browser ${fmt(best.display)} Hz`);
  const top = Math.max(...tries.map((r) => r.frames));
  const display = Math.max(...tries.map((r) => r.display));
  if (display < 55) check.skip(`${label}: frames ≈ 60/s`, `this machine gives only ${fmt(display)} Hz to the page; game ${fmt(top)} f/s`);
  else check(`${label}: frames ≈ 60/s`, top >= 55 && top <= display * 1.04, `${fmt(top)} f/s`);
}

function consoleCheck(game, check, name = 'no console errors, page errors, failed requests or native dialogs') {
  check(name, game.errors.length === 0, game.errors.slice(0, 4).join(' ¦ '));
}

async function shot(page, name) {
  if (!SHOTS) return;
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  } catch {
    /* снимок — подсказка, не проверка */
  }
}

/** Все кнопки внутри экрана и без горизонтальной прокрутки. */
async function layoutOk(page, names) {
  return page.evaluate((list) => {
    const problems = [];
    const all = [...document.querySelectorAll('button')].filter((b) => !b.closest('[inert]'));
    for (const name of list) {
      const hit = all.filter((b) => ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).includes(name) && b.getClientRects().length > 0);
      if (hit.length === 0) {
        problems.push(`«${name}» is not rendered`);
        continue;
      }
      const r = hit[0].getBoundingClientRect();
      if (r.left < -0.5 || r.top < -0.5 || r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5) {
        problems.push(`«${name}» is outside the screen (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)})`);
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) problems.push(`horizontal scroll: ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    return problems;
  }, names);
}

// ─── Сценарий: основной поток (1280×800 и 390×844) ──────────────────────────

async function scenarioMain(browser, profile) {
  const check = scope(profile);
  const game = await openGame(browser, profile);
  const { page } = game;
  const size = PROFILES[profile].viewport;
  try {
    // Меню.
    let s = await snap(page);
    check('menu renders: screen «menu» over the live attract scene', s.screen === 'menu' && s.mode === 'attract', `screen ${s.screen}, sim ${s.mode}`);
    const title = await page.evaluate(() => ({ h1: document.querySelector('h1')?.textContent ?? '', lang: document.documentElement.lang, bg: getComputedStyle(document.body).backgroundColor }));
    check('menu renders: logo, lang="ru"', /neon\s*velocity/i.test(title.h1) && /^ru/.test(title.lang), json({ lang: title.lang, bg: title.bg }));
    // Меню въезжает снизу: раскладку смотрим, когда анимация появления закончилась.
    await sleep(900);
    const problems = await layoutOk(page, ['Играть', 'Магазин', 'Рекорды', 'Настройки', 'Как играть']);
    check('menu renders: every button on screen, no horizontal scroll', problems.length === 0, problems.join('; '));
    const cv = await page.evaluate(() => window.__e2e.canvasStats());
    check(
      'menu renders: the canvas fills the window and is painted',
      Boolean(cv) && Math.abs(cv.rect.w - size.width) <= 1 && Math.abs(cv.rect.h - size.height) <= 1 && cv.colors >= 12,
      cv ? `${cv.rect.w}×${cv.rect.h} css, ${cv.width}×${cv.height} px, ${cv.colors} colours` : 'no canvas',
    );
    const s2 = await snap(page);
    check('menu renders: the attract scene is alive', s2.counters.ticks > s.counters.ticks && s2.counters.frames > s.counters.frames, `ticks ${s.counters.ticks} → ${s2.counters.ticks}`);
    check('menu renders: a fresh save is written', s2.save && s2.save.crystals === STARTING_CRYSTALS && s2.save.stats.gamesPlayed === 0, json(s2.save && { crystals: s2.save.crystals, games: s2.save.stats.gamesPlayed }));
    if (game.touch) {
      const hints = await page.evaluate(() => [...document.querySelectorAll('kbd')].filter((k) => k.getClientRects().length > 0 && !k.closest('[inert]')).length);
      check('menu renders: no keyboard hints on a touch screen', hints === 0, `${hints} visible <kbd>`);
    }

    // Старт.
    if (game.touch) await press(game, button(page, /Играть/));
    else await page.keyboard.press('Enter');
    const started = await untilScreen(page, 'playing', 3000);
    s = await snap(page);
    check(`start by ${game.touch ? 'tap on «Играть»' : 'Enter'}: the run begins with READY`, started && s.mode === 'ready' && s.tick < 0 && s.tally.runs === 1, `screen ${s.screen}, sim ${s.mode}, tick ${s.tick}, runs ${s.tally.runs}`);
    check('start: HUD with the pause button, no dialog', (await button(page, 'Пауза').isVisible()) && s.dialogs.length === 0, json(s.dialogs));
    const ready = await page.getByRole('status').filter({ hasText: 'READY' }).first().isVisible().catch(() => false);
    check('start: READY banner', ready);

    if (game.touch) await touchSteering(game, check);

    await autopilot(page, true);
    const go = await until(page, () => window.__NV__.sim.state.mode === 'playing' && window.__NV__.sim.state.tick >= 0, null, 5000);
    check('start: GO after the count-in bar', go);

    // Один цикл и уровень 3.
    await checkOneLoop(page, check, 'in a run');
    const reached = await until(page, () => window.__NV__.sim.state.level >= 3 || window.__NV__.screen() !== 'playing', null, 60_000);
    s = await snap(page);
    const ups = s.tally.levelUp.map((u) => `L${u.level}@${u.tick}`).join(' ');
    check('autopilot reaches level 3', reached && s.level >= 3 && s.screen === 'playing' && s.alive, `level ${s.level}, tick ${s.tick}, score ${s.score}, speed ×${fmt(s.speedMult, 2)}, screen ${s.screen}`);
    check(
      'a level lasts 15 s: levelUp at ticks 1920 and 3840, speed grows',
      s.tally.levelUp.length >= 2 && s.tally.levelUp[0].tick === TICKS_PER_LEVEL && s.tally.levelUp[1].tick === 2 * TICKS_PER_LEVEL && s.speedMult > 1,
      ups,
    );
    if (s.screen !== 'playing') throw new Error(`the autopilot run ended early: screen ${s.screen}, tick ${s.tick}`);

    // Пауза и продолжение.
    await pauseChecks(game, check);

    // Размер окна и поворот посреди забега.
    await resizeChecks(game, check, profile === 'phone' ? [[844, 390], [390, 844]] : [[800, 600], [390, 844], [844, 390], [1600, 900], [1280, 800]]);

    // Гибель.
    const before = await snap(page);
    await page.evaluate(() => window.__NV__.setInput(window.__e2e.kamikaze));
    const dying = await until(page, () => window.__NV__.sim.state.mode === 'dying', null, 40_000);
    if (dying) {
      // Пока корабль взрывается, паузы нет.
      if (game.touch) await page.evaluate(() => window.__e2e.blur());
      else await page.keyboard.press('Escape');
      const mid = await snap(page);
      check('no pause while the ship is exploding', mid.screen !== 'paused', `screen ${mid.screen}, sim ${mid.mode}`);
    }
    const over = await untilScreen(page, 'gameover', 20_000);
    const overAt = Date.now();
    // Экран Game Over ещё не «взведён»: клавиша забега его не закрывает.
    await page.keyboard.press('Enter');
    const early = await snap(page);
    const lag = Date.now() - overAt;
    if (lag < 500) check('Game Over ignores a key pressed in its first 650 ms', early.screen === 'gameover' && early.tally.runs === before.tally.runs, `screen ${early.screen} ${lag} ms later`);
    else check.skip('Game Over ignores a key pressed in its first 650 ms', `the machine answered only after ${lag} ms`);
    await page.evaluate(() => window.__NV__.setInput(null));
    s = await snap(page);
    check('forced death → Game Over', over && s.screen === 'gameover' && s.mode === 'over' && s.tally.gameOver === 1 && s.tally.death === 1, `screen ${s.screen}, sim ${s.mode}, deaths ${s.tally.death}, gameOver events ${s.tally.gameOver}`);
    check('Game Over is the only dialog', s.dialogs.length === 1 && /GAME OVER/.test(s.dialogs[0]), json(s.dialogs));
    const result = s.tally.results[0];
    if (!result) throw new Error('no gameOver event — cannot check the save');

    // Сохранение.
    const save = s.save;
    check('save: gamesPlayed = 1', save?.stats?.gamesPlayed === 1, `gamesPlayed ${save?.stats?.gamesPlayed}`);
    const top = save?.leaderboard?.[0];
    check(
      'save: a leaderboard entry with the score, the speed level and the date',
      save?.leaderboard?.length === 1 && top.score === result.score && top.level === result.level && top.level >= 3 && Math.abs(Date.now() - Date.parse(top.date)) < 120_000,
      json(top),
    );
    check('save: more crystals in the wallet', save?.crystals === STARTING_CRYSTALS + result.crystals && result.crystals > 0, `${STARTING_CRYSTALS} + ${result.crystals} → ${save?.crystals}`);
    check('save: highscore = the score', save?.highscore === result.score && result.score > 0, `${save?.highscore} vs ${result.score}`);
    check('no NEW RECORD! in the very first run (there was no record to beat)', s.tally.newRecord.length === 0 && result.newRecord === false, json(s.tally.newRecord));

    await sleep(2200);
    const card = await page.getByRole('dialog').first().innerText().catch(() => '');
    check('Game Over card shows the final score', digits(card).includes(String(result.score)), `score ${result.score}`);
    check('Game Over card: «ПЕРВЫЙ РЕКОРД» for the first result', /ПЕРВЫЙ РЕКОРД/i.test(card), card.replace(/\s+/g, ' ').slice(0, 80));
    const overProblems = await layoutOk(page, ['Ещё раз', 'Магазин', 'Рекорды', 'Меню']);
    check('Game Over card: every button on screen', overProblems.length === 0, overProblems.join('; '));
    const f1 = (await snap(page)).counters;
    await sleep(500);
    const f2 = (await snap(page)).counters;
    check('the scene under Game Over is frozen (backdrop blur is not recomputed)', f2.frames === f1.frames && f2.ticks === f1.ticks, `frames ${f1.frames} → ${f2.frames}, ticks ${f1.ticks} → ${f2.ticks}`);

    // Перезагрузка.
    await page.reload({ waitUntil: 'load' });
    await gameReady(page);
    const after = await snap(page);
    check('reload keeps the save byte for byte', json(after.save) === json(save), json(after.save?.stats));
    const menuText = await page.evaluate(() => document.body.innerText);
    check('reload: the menu shows the record', digits(menuText).includes(String(result.score)), `record ${result.score}`);
    await press(game, button(page, /Рекорды/));
    const board = await page.getByRole('dialog').first().innerText({ timeout: 3000 }).catch(() => '');
    check('reload: the leaderboard lists the run', digits(board).includes(String(result.score)), board.replace(/\s+/g, ' ').slice(0, 90));
    await page.keyboard.press('Escape');

    // «Ещё раз» с экрана Game Over стартует ровно один забег.
    await until(page, () => document.querySelectorAll('[role="dialog"]').length === 0, null, 2000);
    await press(game, button(page, /Играть/));
    await untilScreen(page, 'playing', 3000);
    await autopilot(page, true);
    await until(page, () => window.__NV__.sim.state.score > 0, null, 15_000);
    const second = await snap(page);
    check('the next run starts from the saved record', second.highscore === result.score, `sim highscore ${second.highscore}, saved ${result.score}`);
    await forceDeath(page);
    await press(game, button(page, /Ещё раз/), 5000);
    await untilScreen(page, 'playing', 3000);
    s = await snap(page);
    check('«Ещё раз» starts one new run and the finished one is recorded once', s.screen === 'playing' && s.mode === 'ready' && s.tally.runs === 2 && s.save.stats.gamesPlayed === 2, `runs ${s.tally.runs}, gamesPlayed ${s.save.stats.gamesPlayed}`);

    consoleCheck(game, check);
  } catch (err) {
    check('scenario finished', false, String(err?.message ?? err).split('\n')[0]);
    await shot(page, `fail-${profile}`);
  } finally {
    await game.context.close();
  }
}

/** Палец на экране ведёт корабль; после подъёма второго пальца первый продолжает управлять. */
async function touchSteering(game, check) {
  const { page } = game;
  let cdp;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch {
    check.skip('finger steering', 'needs Chromium (CDP touch events)');
    return;
  }
  const size = page.viewportSize();
  const y = Math.round(size.height * 0.7);
  const point = (x, id = 0) => ({ x: Math.round(x), y, id, radiusX: 4, radiusY: 4, force: 1 });
  const shipX = () => page.evaluate(() => window.__NV__.sim.state.player.x);
  const x0 = await shipX();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(size.width * 0.86)] });
  await sleep(450);
  const right = await shipX();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(size.width * 0.14)] });
  await sleep(600);
  const left = await shipX();
  check('finger steering: the ship follows the finger right and left', right > x0 + 5 && left < x0 - 5, `x ${fmt(x0)} → ${fmt(right)} → ${fmt(left)}`);
  // Второй палец коснулся и ушёл — первый по-прежнему ведёт.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(size.width * 0.14), point(size.width * 0.9, 1)] });
  await sleep(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point(size.width * 0.14)] });
  await sleep(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(size.width * 0.5)] });
  await sleep(500);
  const mid = await shipX();
  check('multitouch: the first finger still steers after the second one lifts', Math.abs(mid - 50) < 12 && mid > left + 5, `x ${fmt(left)} → ${fmt(mid)}`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach().catch(() => {});
}

async function pauseChecks(game, check) {
  const { page } = game;
  const frozen = async (label) => {
    const a = await snap(page);
    await sleep(1000);
    const b = await snap(page);
    check(`${label}: 0 ticks while paused`, a.screen === 'paused' && b.counters.ticks === a.counters.ticks && b.tick === a.tick, `screen ${a.screen}, ticks ${a.counters.ticks} → ${b.counters.ticks}, sim tick ${a.tick} → ${b.tick}`);
    return b;
  };
  const resumed = async (label, pausedSnap) => {
    const ok = await untilScreen(page, 'playing', 3000);
    await sleep(500);
    const c = await snap(page);
    const gained = c.tick - pausedSnap.tick;
    // Полсекунды после паузы — около 64 тиков; «догонять» простой нельзя.
    check(`${label}: ticks restart and do not catch up the pause`, ok && gained > 20 && gained < 140 && c.alive, `+${gained} ticks in the first 0.5 s, alive ${c.alive}`);
  };

  // Клавиша (на телефоне — кнопка HUD).
  if (game.touch) await press(game, button(page, 'Пауза'));
  else await page.keyboard.press('Escape');
  await untilScreen(page, 'paused', 3000);
  let p = await frozen(game.touch ? 'pause by the HUD button' : 'pause by Esc');
  check('pause: one dialog «PAUSE», the HUD under it is inert', p.dialogs.length === 1 && /PAUSE|ПАУЗА/i.test(p.dialogs[0]), json(p.dialogs));
  const problems = await layoutOk(page, ['Продолжить', 'Заново', 'В меню']);
  check('pause card: every button on screen', problems.length === 0, problems.join('; '));
  if (game.touch) await press(game, button(page, /Продолжить/));
  else await page.keyboard.press('KeyP');
  await resumed(game.touch ? 'resume by «Продолжить»' : 'resume by P', p);

  if (!game.touch) {
    await press(game, button(page, 'Пауза'));
    await untilScreen(page, 'paused', 3000);
    p = await frozen('pause by the HUD button');
    await press(game, button(page, /Продолжить/));
    await resumed('resume by «Продолжить»', p);
  }

  // Окно потеряло фокус.
  await page.evaluate(() => window.__e2e.blur());
  const blurred = await untilScreen(page, 'paused', 2000);
  check('losing focus pauses the run', blurred);
  p = await snap(page);
  await page.keyboard.press('Escape');
  await resumed('resume by Esc after blur', p);

  // Вкладку спрятали и вернули.
  await page.evaluate(() => window.__e2e.setHidden(true));
  const hidden = await untilScreen(page, 'paused', 2000);
  await page.evaluate(() => window.__e2e.setHidden(false));
  await sleep(300);
  p = await snap(page);
  check('a hidden tab pauses the run and stays paused when shown again', hidden && p.screen === 'paused', `screen ${p.screen}`);
  await press(game, button(page, /Продолжить/));
  await resumed('resume after a hidden tab', p);
}

async function resizeChecks(game, check, sizes) {
  const { page } = game;
  const start = await snap(page);
  const seen = [];
  let alive = true;
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(450);
    const a = await snap(page);
    await sleep(350);
    const b = await snap(page);
    const cv = await page.evaluate(() => window.__e2e.canvasStats());
    const ok =
      b.screen === 'playing' && b.mode === 'playing' && b.alive && b.seed === start.seed && b.tick > a.tick && b.cam.cssW === w && b.cam.cssH === h &&
      Boolean(cv) && Math.abs(cv.rect.w - w) <= 1 && Math.abs(cv.rect.h - h) <= 1 && cv.width === Math.round(w * b.cam.dpr) && cv.colors >= 12;
    seen.push(`${w}×${h}:${ok ? 'ok' : `screen ${b.screen}/${b.mode} cam ${b.cam.cssW}×${b.cam.cssH} canvas ${cv ? `${cv.width}px ${cv.colors}c` : 'none'}`}`);
    alive = alive && ok;
  }
  const end = await snap(page);
  check('resize and rotation mid-run keep the run alive (same run, camera and canvas follow)', alive && end.tally.runs === start.tally.runs && end.score >= start.score, seen.join(', '));
  const pauseVisible = await button(page, 'Пауза').isVisible();
  check('after the resizes the HUD is still there', pauseVisible);
}

// ─── Сценарий: рекорд и брошенные забеги ────────────────────────────────────

async function scenarioProgress(browser) {
  const check = scope('progress');
  const SEEDED = 400;
  const seeded = makeSave({ crystals: 1000, highscore: SEEDED, leaderboard: [entry(SEEDED)], stats: { gamesPlayed: 3, totalCrystals: 40, totalScore: 900, bestMultiplier: 2, totalTime: 60 } });
  const game = await openGame(browser, 'desktop', { save: seeded });
  const { page } = game;
  try {
    let s = await snap(page);
    check('a seeded save is loaded', s.save.highscore === SEEDED && s.save.stats.gamesPlayed === 3 && s.save.crystals === 1000, json(s.save.stats));

    // NEW RECORD! в момент, когда счёт обгоняет рекорд.
    await press(game, button(page, /Играть/));
    await untilScreen(page, 'playing', 3000);
    await autopilot(page, true);
    s = await snap(page);
    check('the run starts with the seeded highscore', s.highscore === SEEDED && s.newRecord === false, `sim highscore ${s.highscore}`);
    const banner = page.getByRole('status').filter({ hasText: 'NEW RECORD!' }).first();
    const flagged = await until(page, () => window.__NV__.sim.state.newRecord === true, null, 30_000);
    const shown = flagged && (await banner.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false));
    const shownAt = Date.now();
    s = await snap(page);
    const rec = s.tally.newRecord[0];
    check('NEW RECORD! banner flashes when the score passes the seeded highscore', Boolean(shown) && s.tally.newRecord.length === 1 && rec.score > SEEDED, `event ${json(rec)}, banner ${shown}`);
    const gone = await banner.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false);
    const held = Date.now() - shownAt;
    check('NEW RECORD! does not hide the road for longer than ~2 s', gone && held <= 3200, `${held} ms on screen`);
    await sleep(1500);
    s = await snap(page);
    check('NEW RECORD! fires once per run', s.tally.newRecord.length === 1, `${s.tally.newRecord.length} events`);

    // «Заново» из паузы: итог записан один раз, новый забег — с новым рекордом.
    await page.keyboard.press('Escape');
    await untilScreen(page, 'paused', 3000);
    const paused = await snap(page);
    await page.keyboard.press('KeyR');
    await until(page, () => window.__NV__.sim.state.mode === 'ready', null, 3000);
    s = await snap(page);
    const banked = s.save.highscore;
    check('«Заново» from pause is recorded exactly once', s.save.stats.gamesPlayed === 4 && s.tally.abandons.length === 1 && s.save.leaderboard.some((e) => e.score === banked), `gamesPlayed ${s.save.stats.gamesPlayed}, abandons ${s.tally.abandons.length}`);
    check('the abandoned score is the new highscore', banked === Math.floor(paused.score) && banked > SEEDED, `saved ${banked}, score at pause ${paused.score}`);
    check('the abandoned crystals reach the wallet', s.save.crystals === 1000 + s.tally.abandons[0].result.crystals && s.save.crystals > 1000, `wallet ${s.save.crystals}`);
    check('the next run starts with the new highscore', s.screen === 'playing' && s.tick < 0 && s.highscore === banked && s.score === 0, `sim highscore ${s.highscore}, saved ${banked}, tick ${s.tick}`);
    await sleep(900);
    const hud = await page.evaluate(() => document.body.innerText);
    check('HUD BEST shows the new highscore', digits(hud).includes(String(banked)), `expected ${banked}`);
    s = await snap(page);
    check('…and is not recorded a second time', s.save.stats.gamesPlayed === 4, `gamesPlayed ${s.save.stats.gamesPlayed}`);

    // Пустой забег (пауза на READY → меню) не сохраняется.
    await page.keyboard.press('KeyP');
    await untilScreen(page, 'paused', 3000);
    const emptyTick = (await snap(page)).tick;
    await page.keyboard.press('KeyM');
    await untilScreen(page, 'menu', 3000);
    s = await snap(page);
    if (emptyTick <= 0) check('an empty run (pause on READY → menu) is not recorded', s.save.stats.gamesPlayed === 4 && s.mode === 'attract', `gamesPlayed ${s.save.stats.gamesPlayed}`);
    else check.skip('an empty run is not recorded', `the pause landed after GO (tick ${emptyTick})`);
    const base = s.save.stats.gamesPlayed;

    // «В меню» из паузы.
    await sleep(700);
    await page.keyboard.press('Space');
    await untilScreen(page, 'playing', 3000);
    await autopilot(page, true);
    await until(page, () => window.__NV__.sim.state.score > 0 && window.__NV__.sim.state.crystalsCollected > 2, null, 20_000);
    await press(game, button(page, 'Пауза'));
    await untilScreen(page, 'paused', 3000);
    const beforeMenu = await snap(page);
    await press(game, button(page, /В меню/));
    await untilScreen(page, 'menu', 3000);
    await sleep(900);
    s = await snap(page);
    check('«В меню» from pause is recorded exactly once', s.save.stats.gamesPlayed === base + 1 && s.mode === 'attract' && s.dialogs.length === 0, `gamesPlayed ${base} → ${s.save.stats.gamesPlayed}`);
    check('…with its crystals and score', s.save.crystals > beforeMenu.save.crystals && s.save.stats.totalScore === beforeMenu.save.stats.totalScore + Math.floor(beforeMenu.score), `wallet ${beforeMenu.save.crystals} → ${s.save.crystals}`);

    // Перезагрузка посреди забега.
    await page.keyboard.press('Enter');
    await untilScreen(page, 'playing', 3000);
    await autopilot(page, true);
    await until(page, () => window.__NV__.sim.state.score > 0 && window.__NV__.sim.state.crystalsCollected > 2, null, 20_000);
    const beforeReload = await snap(page);
    await page.reload({ waitUntil: 'load' });
    await gameReady(page);
    s = await snap(page);
    check('reload mid-run: the run is recorded exactly once, the game is back in the menu', s.save.stats.gamesPlayed === base + 2 && s.save.crystals > beforeReload.save.crystals && s.screen === 'menu', `gamesPlayed ${base + 1} → ${s.save.stats.gamesPlayed}, wallet ${beforeReload.save.crystals} → ${s.save.crystals}`);

    // Гибель с побитым рекордом: карточка Game Over пишет NEW RECORD!.
    const record = s.save.highscore;
    await press(game, button(page, /Играть/));
    await untilScreen(page, 'playing', 3000);
    await autopilot(page, true);
    const beaten = await until(page, (best) => window.__NV__.sim.state.score > best + 50, record, 90_000);
    const died = beaten && (await forceDeath(page));
    await sleep(1800);
    s = await snap(page);
    const card = await page.getByRole('dialog').first().innerText().catch(() => '');
    check('Game Over after beating the record says NEW RECORD!', Boolean(died) && /NEW RECORD!/.test(card) && s.save.highscore > record && s.save.leaderboard[0].score === s.save.highscore, `record ${record} → ${s.save.highscore}`);
    check('the leaderboard keeps at most five entries, best first', s.save.leaderboard.length <= 5 && s.save.leaderboard.every((e, i, a) => i === 0 || a[i - 1].score >= e.score), json(s.save.leaderboard.map((e) => e.score)));

    // Хоткеи Game Over: L открывает рекорды поверх, Esc закрывает только панель, S ведёт в магазин.
    await sleep(700);
    await page.keyboard.press('KeyL');
    await until(page, () => window.__e2e.snap().dialogs.some((d) => /Рекорды/.test(d)), null, 2000);
    s = await snap(page);
    check('Game Over → L: the leaderboard is the only live dialog, Game Over under it is inert', s.screen === 'gameover' && s.dialogs.length === 1 && /Рекорды/.test(s.dialogs[0]), json(s.dialogs));
    await page.keyboard.press('Escape');
    await sleep(600);
    s = await snap(page);
    check('Esc closes the panel only — Game Over stays', s.screen === 'gameover' && s.dialogs.length === 1 && /GAME OVER/.test(s.dialogs[0]), `screen ${s.screen}, ${json(s.dialogs)}`);
    await page.keyboard.press('KeyS');
    await until(page, () => window.__e2e.snap().dialogs.some((d) => /Магазин/.test(d)), null, 2000);
    s = await snap(page);
    check('Game Over → S: the shop over the menu', s.screen === 'menu' && s.mode === 'attract' && s.dialogs.length === 1 && /Магазин/.test(s.dialogs[0]), `screen ${s.screen}, ${json(s.dialogs)}`);

    consoleCheck(game, check);
  } catch (err) {
    check('scenario finished', false, String(err?.message ?? err).split('\n')[0]);
    await shot(page, 'fail-progress');
  } finally {
    await game.context.close();
  }
}

// ─── Сценарий: магазин ──────────────────────────────────────────────────────

async function scenarioShop(browser) {
  const check = scope('shop');
  const game = await openGame(browser, 'desktop', { save: makeSave({ crystals: 900 }) });
  const { page } = game;
  const css = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--theme-a').trim());
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  try {
    const themeBefore = await css();
    const canvasBefore = await page.evaluate(() => window.__e2e.canvasStats());
    await sleep(600);
    const canvasDrift = await page.evaluate(() => window.__e2e.canvasStats());

    await press(game, button(page, /Магазин/));
    const dialog = page.getByRole('dialog').first();
    await dialog.waitFor({ state: 'visible', timeout: 3000 });
    let s = await snap(page);
    check('the shop opens as the only dialog, the menu is inert', s.dialogs.length === 1 && /Магазин/.test(s.dialogs[0]) && s.screen === 'menu', json(s.dialogs));

    // Корабль.
    await press(game, button(page, /^Купить: Неоновый шлейф/));
    await sleep(400);
    s = await snap(page);
    check('buys a ship: owned, equipped, 300 crystals spent', s.save.ownedSkins.includes('trail') && s.save.equippedSkin === 'trail' && s.save.crystals === 600, `wallet ${s.save.crystals}, skin ${s.save.equippedSkin}`);

    // Тема.
    await press(game, page.getByRole('tab', { name: /Темы/ }).first());
    await press(game, button(page, /^Купить: Retrowave Gold/));
    await sleep(900);
    s = await snap(page);
    const themeAfter = await css();
    check('buys a theme: owned, equipped, 400 crystals spent', s.save.ownedThemes.length === 2 && s.save.equippedTheme !== 'cyberpunk' && s.save.crystals === 200, `wallet ${s.save.crystals}, theme ${s.save.equippedTheme}`);
    check('the live theme changes: interface accent', themeAfter !== themeBefore && themeAfter !== '', `--theme-a ${themeBefore} → ${themeAfter}`);
    const canvasAfter = await page.evaluate(() => window.__e2e.canvasStats());
    const drift = distance(canvasBefore.mean, canvasDrift.mean);
    const change = distance(canvasBefore.mean, canvasAfter.mean);
    check('the live theme changes: the scene on the canvas is repainted at once', change > Math.max(6, drift * 3), `mean colour moved by ${fmt(change)} (the same scene drifts by ${fmt(drift)})`);

    // Улучшение.
    await press(game, page.getByRole('tab', { name: /Улучшения/ }).first());
    await press(game, button(page, /^Улучшить: Призма удачи/));
    await sleep(400);
    s = await snap(page);
    check('buys an upgrade: level 1, 150 crystals spent', s.save.upgrades.lucky === 1 && s.save.crystals === 50, `wallet ${s.save.crystals}, upgrades ${json(s.save.upgrades)}`);
    const walletText = await dialog.innerText();
    check('the shop wallet shows what is left', /(^|\D)50(\D|$)/.test(walletText.replace(/\s+/g, ' ')), 'expected 50');

    // Не хватает кристаллов — покупки нет.
    await press(game, page.getByRole('tab', { name: /Корабли/ }).first());
    const locked = button(page, /^Магнит: не хватает/);
    const lockedThere = await locked.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false);
    if (lockedThere) {
      // Кнопка помечена aria-disabled, но остаётся нажимаемой — жмём по координатам, как игрок.
      const box = await locked.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await sleep(300);
    s = await snap(page);
    check('no purchase without crystals', lockedThere && s.save.crystals === 50 && !s.save.ownedSkins.includes('magnet') && s.save.equippedSkin === 'trail', `wallet ${s.save.crystals}, owned ${json(s.save.ownedSkins)}`);

    // Надеть прежний корабль и вернуть.
    await press(game, button(page, /^Надеть: Неоновое ядро/));
    await sleep(300);
    s = await snap(page);
    check('equips an owned ship for free', s.save.equippedSkin === 'core' && s.save.crystals === 50, `skin ${s.save.equippedSkin}`);

    await page.keyboard.press('Escape');
    await until(page, () => window.__e2e.snap().dialogs.length === 0, null, 2000);
    s = await snap(page);
    check('Esc closes the shop, the game stays in the menu', s.dialogs.length === 0 && s.screen === 'menu' && s.tally.runs === 0, `screen ${s.screen}, runs ${s.tally.runs}`);

    // Покупки переживают перезагрузку и действуют в забеге.
    const saved = s.save;
    await page.reload({ waitUntil: 'load' });
    await gameReady(page);
    s = await snap(page);
    check('purchases survive a reload', json(s.save) === json(saved) && (await css()) === themeAfter, `theme ${s.save.equippedTheme}, --theme-a ${await css()}`);
    await page.keyboard.press('Enter');
    await untilScreen(page, 'playing', 3000);
    await sleep(500);
    check('the bought theme is live in a run', (await css()) === themeAfter);

    consoleCheck(game, check);
  } catch (err) {
    check('scenario finished', false, String(err?.message ?? err).split('\n')[0]);
    await shot(page, 'fail-shop');
  } finally {
    await game.context.close();
  }
}

// ─── Сценарий: панели ───────────────────────────────────────────────────────

async function scenarioPanels(browser, profile) {
  const check = scope(`panels ${profile}`);
  const game = await openGame(browser, profile, { save: makeSave({ highscore: 900, leaderboard: [entry(900)], stats: { gamesPlayed: 1, totalCrystals: 3, totalScore: 900, bestMultiplier: 2, totalTime: 12 } }) });
  const { page } = game;
  const noDialog = () => until(page, () => document.querySelectorAll('[role="dialog"]').length === 0, null, 2500);
  try {
    const panels = [
      ['Магазин', /Магазин/],
      ['Рекорды', /Рекорды/],
      ['Настройки', /Настройки/],
      ['Как играть', /Как играть/],
    ];
    for (const [name, pattern] of panels) {
      const opener = page.getByRole('navigation').getByRole('button', { name: pattern }).first();
      const notes = [];

      // Esc.
      await press(game, opener);
      await page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 3000 });
      await sleep(450);
      let s = await snap(page);
      const menuInert = await page.evaluate(() => {
        const play = [...document.querySelectorAll('button')].find((b) => /Играть/.test(b.textContent || ''));
        return Boolean(play && play.closest('[inert]'));
      });
      if (!(s.dialogs.length === 1 && pattern.test(s.dialogs[0]))) notes.push(`opened: dialogs ${json(s.dialogs)}`);
      if (!menuInert) notes.push('the menu under the panel is not inert');
      const fits = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        const r = d.getBoundingClientRect();
        return r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
      });
      if (!fits) notes.push('the panel does not fit the screen');
      await page.keyboard.press('Escape');
      if (!(await noDialog())) notes.push('Esc did not close it');
      s = await snap(page);
      if (s.screen !== 'menu' || s.mode !== 'attract' || s.tally.runs !== 0) notes.push(`after Esc: screen ${s.screen}, runs ${s.tally.runs}`);

      // Кнопка «Закрыть».
      await press(game, opener);
      await page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 3000 });
      await press(game, page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).first());
      if (!(await noDialog())) notes.push('«Закрыть» did not close it');

      // Клик по подложке.
      await press(game, opener);
      await page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 3000 });
      await sleep(350);
      if (game.touch) await page.touchscreen.tap(4, 4);
      else await page.mouse.click(4, 4);
      if (!(await noDialog())) notes.push('a click on the backdrop did not close it');
      s = await snap(page);
      if (s.screen !== 'menu' || s.tally.runs !== 0) notes.push(`after closing: screen ${s.screen}, runs ${s.tally.runs}`);

      check(`«${name}» opens as the only dialog and closes with Esc, the close button and the backdrop`, notes.length === 0, notes.join('; '));
    }

    // Enter при открытой панели забег не запускает.
    await press(game, page.getByRole('navigation').getByRole('button', { name: /Как играть/ }).first());
    await page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 3000 });
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await sleep(400);
    let s = await snap(page);
    check('Enter / Space do not start a run while a panel is open', s.screen === 'menu' && s.tally.runs === 0 && s.dialogs.length === 1, `screen ${s.screen}, runs ${s.tally.runs}`);
    await page.keyboard.press('Escape');
    await noDialog();

    // Сброс прогресса: подтверждение в панели, без confirm().
    await press(game, page.getByRole('navigation').getByRole('button', { name: /Настройки/ }).first());
    await page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 3000 });
    const reset = page.getByRole('dialog').getByRole('button', { name: /^Сбросить/ }).first();
    await reset.scrollIntoViewIfNeeded();
    await press(game, reset);
    s = await snap(page);
    check('reset asks for confirmation inside the panel (nothing is erased yet)', s.save.highscore === 900 && s.dialogs.length === 1, `highscore ${s.save.highscore}`);
    const yes = page.getByRole('dialog').getByRole('button', { name: /Да, сбросить/ }).first();
    await yes.waitFor({ state: 'visible', timeout: 3000 });
    await sleep(500);
    await press(game, yes);
    await sleep(400);
    s = await snap(page);
    check('confirmed reset clears progress and keeps the settings', s.save.highscore === 0 && s.save.leaderboard.length === 0 && s.save.stats.gamesPlayed === 0 && s.save.crystals === STARTING_CRYSTALS && s.save.settings.sound === true, json({ hs: s.save.highscore, games: s.save.stats.gamesPlayed, wallet: s.save.crystals }));
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.keyboard.press('Escape');
    await noDialog();

    consoleCheck(game, check);
  } catch (err) {
    check('scenario finished', false, String(err?.message ?? err).split('\n')[0]);
    await shot(page, `fail-panels-${profile}`);
  } finally {
    await game.context.close();
  }
}

// ─── Сценарий: края ─────────────────────────────────────────────────────────

async function scenarioEdge(browser) {
  const check = scope('edge');

  // Двойной клик по «Играть» — один забег.
  {
    const game = await openGame(browser, 'desktop');
    const { page } = game;
    try {
      const play = button(page, /Играть/);
      await play.hover();
      await sleep(900);
      const box = await play.boundingBox();
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(900);
      let s = await snap(page);
      check('double click on «Играть» starts exactly one run', s.screen === 'playing' && s.tally.runs === 1 && s.save.stats.gamesPlayed === 0, `runs ${s.tally.runs}, screen ${s.screen}`);

      // Зажатый Enter (автоповтор) в меню → один забег, без паузы и рестартов.
      await page.keyboard.press('Escape');
      await untilScreen(page, 'paused', 2000);
      await page.keyboard.press('KeyM');
      await untilScreen(page, 'menu', 2000);
      const runs = (await snap(page)).tally.runs;
      await page.keyboard.down('Enter');
      for (let i = 0; i < 25; i++) {
        await page.keyboard.down('Enter');
        await sleep(30);
      }
      await page.keyboard.up('Enter');
      await sleep(300);
      s = await snap(page);
      check('Enter held down (auto-repeat) starts one run and nothing else', s.screen === 'playing' && s.tally.runs === runs + 1 && s.dialogs.length === 0, `runs ${runs} → ${s.tally.runs}, screen ${s.screen}`);

      // Enter после клика мышью по кнопке звука запускает забег, а не переключает звук.
      await page.keyboard.press('Escape');
      await untilScreen(page, 'paused', 2000);
      await page.keyboard.press('KeyM');
      await untilScreen(page, 'menu', 2000);
      const sound = button(page, /Выключить звук|Включить звук/);
      await press(game, sound);
      await sleep(200);
      const off = (await snap(page)).save.settings.sound;
      await page.keyboard.press('Enter');
      await untilScreen(page, 'playing', 2000);
      s = await snap(page);
      check('Enter after a mouse click on the sound button starts the run and leaves the sound alone', off === false && s.screen === 'playing' && s.save.settings.sound === false, `sound ${off} → ${s.save.settings.sound}, screen ${s.screen}`);
      consoleCheck(game, check, 'double click / held keys: no errors');
    } catch (err) {
      check('double click scenario finished', false, String(err?.message ?? err).split('\n')[0]);
    } finally {
      await game.context.close();
    }
  }

  // Двойной тап «В меню» не открывает панель под пальцем.
  {
    const game = await openGame(browser, 'phone');
    const { page } = game;
    try {
      await press(game, button(page, /Играть/));
      await untilScreen(page, 'playing', 3000);
      await sleep(300);
      await press(game, button(page, 'Пауза'));
      await untilScreen(page, 'paused', 3000);
      const toMenu = button(page, /В меню/);
      await toMenu.waitFor({ state: 'visible' });
      await sleep(500);
      const box = await toMenu.boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.touchscreen.tap(x, y);
      await sleep(70);
      await page.touchscreen.tap(x, y);
      await sleep(250);
      await page.touchscreen.tap(x, y);
      await sleep(1000);
      const s = await snap(page);
      check('double tap on «В меню» lands in the menu and opens nothing', s.screen === 'menu' && s.mode === 'attract' && s.dialogs.length === 0 && s.tally.runs === 1, `screen ${s.screen}, dialogs ${json(s.dialogs)}, runs ${s.tally.runs}`);
      consoleCheck(game, check, 'double tap: no errors');
    } catch (err) {
      check('double tap scenario finished', false, String(err?.message ?? err).split('\n')[0]);
    } finally {
      await game.context.close();
    }
  }

  // Повреждённое сохранение.
  const broken = [
    ['not JSON', '{"version":1,"crystals":12'],
    ['wrong types', json({ version: 1, crystals: 'много', highscore: -5, leaderboard: [{ score: 'x' }, null, 7, { score: 120, date: 'вчера' }], ownedSkins: 'все', equippedSkin: 'nope', ownedThemes: [42], equippedTheme: {}, upgrades: { lucky: 99, resonator: -3 }, settings: null, stats: [], seenTutorial: 'да' })],
    ['negative and huge numbers', json({ version: 1, crystals: -500, highscore: 1e308, leaderboard: Array.from({ length: 40 }, (_, i) => entry(1000 - i)), upgrades: { lucky: 2.7 }, settings: { music: 9, sfx: -1 }, stats: { gamesPlayed: -4 } })],
    ['a JSON string instead of an object', '"null"'],
  ];
  for (const [name, text] of broken) {
    const game = await openGame(browser, 'desktop', { save: text }).catch((err) => ({ failed: err }));
    if (game.failed) {
      check(`corrupted save (${name}): the game starts`, false, String(game.failed.message).split('\n')[0]);
      continue;
    }
    const { page } = game;
    try {
      let s = await snap(page);
      const sane = s.save && Number.isInteger(s.save.crystals) && s.save.crystals >= 0 && Array.isArray(s.save.leaderboard) && s.save.leaderboard.length <= 5 && s.save.equippedSkin && s.save.stats.gamesPlayed >= 0;
      check(`corrupted save (${name}): the game starts with a sane save`, s.screen === 'menu' && Boolean(sane), json(s.save && { crystals: s.save.crystals, hs: s.save.highscore, board: s.save.leaderboard.length, skin: s.save.equippedSkin, up: s.save.upgrades }));
      const games = s.save.stats.gamesPlayed;
      await page.keyboard.press('Enter');
      await untilScreen(page, 'playing', 3000);
      await autopilot(page, true);
      await until(page, () => window.__NV__.sim.state.score > 0, null, 15_000);
      const died = await forceDeath(page);
      s = await snap(page);
      check(`corrupted save (${name}): a run can be played and is recorded`, died && s.save.stats.gamesPlayed === games + 1 && s.save.crystals >= 0, `gamesPlayed ${games} → ${s.save.stats.gamesPlayed}`);
      consoleCheck(game, check, `corrupted save (${name}): no errors`);
    } catch (err) {
      check(`corrupted save (${name}): scenario finished`, false, String(err?.message ?? err).split('\n')[0]);
    } finally {
      await game.context.close();
    }
  }

  // localStorage бросает исключения.
  {
    const throwing = () => {
      const deny = () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      };
      Storage.prototype.getItem = deny;
      Storage.prototype.setItem = deny;
      Storage.prototype.removeItem = deny;
    };
    const game = await openGame(browser, 'desktop', { initScript: throwing }).catch((err) => ({ failed: err }));
    if (game.failed) check('storage that throws: the game starts', false, String(game.failed.message).split('\n')[0]);
    else {
      const { page } = game;
      try {
        const warning = await page.getByText(/Сохранение недоступно/).first().isVisible().catch(() => false);
        check('storage that throws: the game starts and warns that progress will not survive', warning);
        await page.keyboard.press('Enter');
        await untilScreen(page, 'playing', 3000);
        await autopilot(page, true);
        await until(page, () => window.__NV__.sim.state.score > 0, null, 15_000);
        const died = await forceDeath(page);
        await sleep(1500);
        const card = await page.getByRole('dialog').first().innerText().catch(() => '');
        check('storage that throws: a run plays to Game Over, the session keeps the result', died && /GAME OVER/.test(card), card.replace(/\s+/g, ' ').slice(0, 60));
        await sleep(300);
        await page.keyboard.press('Escape');
        await untilScreen(page, 'menu', 3000);
        const shown = await page.evaluate(() => document.body.innerText);
        const s = await snap(page);
        const score = s.tally.results[0]?.score ?? -1;
        check('storage that throws: the menu shows the record of this session', digits(shown).includes(String(score)), `score ${score}`);
        consoleCheck(game, check, 'storage that throws: no errors');
      } catch (err) {
        check('storage that throws: scenario finished', false, String(err?.message ?? err).split('\n')[0]);
      } finally {
        await game.context.close();
      }
    }
  }

  // Две вкладки с одним сохранением.
  {
    const a = await openGame(browser, 'desktop', { save: makeSave({ crystals: 500 }) });
    try {
      const b = await openGame(browser, 'desktop', { context: a.context });
      // Вкладка A покупает улучшение и доигрывает забег.
      await press(a, button(a.page, /Магазин/));
      await press(a, a.page.getByRole('tab', { name: /Улучшения/ }).first());
      await press(a, button(a.page, /^Улучшить: Призма удачи/));
      await a.page.keyboard.press('Escape');
      await until(a.page, () => document.querySelectorAll('[role="dialog"]').length === 0, null, 2000);
      await a.page.keyboard.press('Enter');
      await untilScreen(a.page, 'playing', 3000);
      await autopilot(a.page, true);
      await until(a.page, () => window.__NV__.sim.state.score > 0 && window.__NV__.sim.state.crystalsCollected > 2, null, 20_000);
      await forceDeath(a.page);
      const sa = await snap(a.page);
      await sleep(300);
      // Вкладка B всё это время стояла в меню: она видит чужие изменения…
      const shownB = await b.page.evaluate(() => document.body.innerText);
      check('two tabs: the idle tab shows the other tab\'s record at once', digits(shownB).includes(String(sa.save.highscore)), `record ${sa.save.highscore}`);
      // …и её забег не затирает их.
      await b.page.keyboard.press('Enter');
      await untilScreen(b.page, 'playing', 3000);
      await autopilot(b.page, true);
      await until(b.page, () => window.__NV__.sim.state.score > 0 && window.__NV__.sim.state.crystalsCollected > 2, null, 20_000);
      await forceDeath(b.page);
      const sb = await snap(b.page);
      const rb = sb.tally.results[0];
      check(
        'two tabs: a run in the second tab keeps the first tab\'s purchase, run and crystals',
        sb.save.stats.gamesPlayed === 2 && sb.save.upgrades.lucky === 1 && sb.save.leaderboard.length === 2 && sb.save.crystals === sa.save.crystals + (rb?.crystals ?? NaN) && sb.save.highscore === Math.max(sa.save.highscore, rb?.score ?? 0),
        json({ games: sb.save.stats.gamesPlayed, lucky: sb.save.upgrades.lucky, board: sb.save.leaderboard.map((e) => e.score), wallet: sb.save.crystals, walletA: sa.save.crystals }),
      );
      await sleep(300);
      const sa2 = await snap(a.page);
      const shownA = await a.page.getByRole('dialog').first().innerText().catch(() => '');
      check('two tabs: the first tab (on Game Over) follows the shared wallet', digits(shownA).includes(String(sb.save.crystals)) && sa2.screen === 'gameover', `wallet ${sb.save.crystals}`);
      check('two tabs: no errors', a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].slice(0, 3).join(' ¦ '));
    } catch (err) {
      check('two tabs: scenario finished', false, String(err?.message ?? err).split('\n')[0]);
    } finally {
      await a.context.close();
    }
  }
}

// ─── Сценарий: случайные переходы ───────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AGREE = {
  menu: ['attract'],
  playing: ['ready', 'playing', 'dying'],
  paused: ['ready', 'playing'],
  gameover: ['over'],
};

const FUZZ_SIZES = {
  desktop: [[1280, 800], [1024, 768], [800, 600], [1600, 900], [640, 480], [844, 390], [390, 844]],
  phone: [[390, 844], [844, 390], [360, 640], [640, 360], [320, 568], [414, 896]],
};

const FUZZ_KEYS = ['Enter', 'Space', 'Escape', 'Escape', 'KeyP', 'KeyR', 'KeyM', 'KeyS', 'KeyL', 'Tab', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'];
const HOLD_KEYS = ['Enter', 'Space', 'Escape', 'KeyR', 'KeyP', 'ArrowLeft', 'ArrowRight'];

async function scenarioFuzz(browser, seed) {
  const profile = seed % 2 === 0 ? 'phone' : 'desktop';
  const check = scope(`fuzz seed=${seed} ${profile}`);
  const game = await openGame(browser, profile);
  const { page } = game;
  const rnd = mulberry32(seed * 7919 + 17);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const point = async (x, y, twice = false) => {
    if (game.touch) {
      await page.touchscreen.tap(x, y);
      if (twice) {
        await sleep(60);
        await page.touchscreen.tap(x, y);
      }
    } else if (twice) await page.mouse.dblclick(x, y);
    else await page.mouse.click(x, y);
  };

  const history = [];
  const broken = {};
  const flag = (invariant, step, detail) => {
    if (!broken[invariant]) broken[invariant] = `step ${step}: ${detail} ¦ last actions: ${history.slice(-7).join(' → ')}`;
  };
  const seen = { screens: new Set(), finished: 0, abandoned: 0, empty: 0, runs: 0, panels: 0 };
  let held = null;
  let base = null;

  try {
    await autopilot(page, true);
    base = await snap(page);

    for (let step = 1; step <= FUZZ_STEPS; step++) {
      // ── действие ──
      const roll = rnd() * 100;
      let action;
      if (roll < 24) {
        const key = pick(FUZZ_KEYS);
        action = `key ${key}`;
        await page.keyboard.press(key);
      } else if (roll < 30) {
        const key = pick(HOLD_KEYS);
        action = `hold ${key}`;
        if (held) await page.keyboard.up(held);
        held = key;
        await page.keyboard.down(key);
        const repeats = between(2, 8);
        for (let i = 0; i < repeats; i++) {
          await page.keyboard.down(key);
          await sleep(25);
        }
      } else if (roll < 34) {
        action = `release ${held ?? '—'}`;
        if (held) await page.keyboard.up(held);
        held = null;
      } else if (roll < 58) {
        const targets = (await page.evaluate(() => window.__e2e.targets())).filter((t) => !/Да, сбросить/.test(t.label));
        if (targets.length > 0) {
          const t = pick(targets);
          const twice = rnd() < 0.2;
          action = `${twice ? 'double ' : ''}${game.touch ? 'tap' : 'click'} «${t.label.replace(/\s+/g, ' ')}»`;
          await point(t.x, t.y, twice);
        } else action = 'no buttons';
      } else if (roll < 64) {
        const size = page.viewportSize();
        const x = between(2, size.width - 3);
        const y = between(2, size.height - 3);
        action = `${game.touch ? 'tap' : 'click'} at ${x},${y}`;
        await point(x, y);
      } else if (roll < 72) {
        const [w, h] = pick(FUZZ_SIZES[profile]);
        action = `resize ${w}×${h}`;
        await page.setViewportSize({ width: w, height: h });
      } else if (roll < 77) {
        action = 'hide tab, show tab';
        await page.evaluate(() => window.__e2e.setHidden(true));
        await sleep(between(20, 250));
        await page.evaluate(() => window.__e2e.setHidden(false));
      } else if (roll < 80) {
        action = 'window blur';
        await page.evaluate(() => window.__e2e.blur());
      } else if (roll < 88) {
        action = 'pilot: kamikaze';
        await page.evaluate(() => window.__NV__.setInput(window.__e2e.kamikaze));
        await sleep(between(300, 1500));
      } else if (roll < 93) {
        action = 'pilot: autopilot';
        await autopilot(page, true);
      } else if (roll < 95) {
        action = 'pilot: player';
        await page.evaluate(() => window.__NV__.setInput(null));
      } else {
        const ms = rnd() < 0.3 ? between(900, 2200) : between(40, 600);
        action = `wait ${ms}`;
        await sleep(ms);
      }
      history.push(action);
      if (rnd() < 0.5) await sleep(between(0, 140));

      // ── инварианты ──
      let s = await snap(page);
      const transient = (x) => !(AGREE[x.screen] ?? []).includes(x.mode) || x.dialogs.length > 1;
      // Смена экрана — один коммит React, уходящая панель доигрывает анимацию: даём переходу улечься.
      for (let i = 0; i < 10 && transient(s); i++) {
        await sleep(70);
        s = await snap(page);
      }
      seen.screens.add(s.screen);
      if (s.dialogs.length === 1 && s.screen === 'menu') seen.panels++;
      if (!(AGREE[s.screen] ?? []).includes(s.mode)) flag('agree', step, `screen «${s.screen}» with sim mode «${s.mode}»`);
      if (s.dialogs.length > 1) flag('dialogs', step, `${s.dialogs.length} live dialogs: ${json(s.dialogs)}`);
      if (!s.save || !Number.isInteger(s.save.crystals) || s.save.crystals < 0) flag('wallet', step, `wallet ${s.save?.crystals} ${s.saveError ?? ''}`);

      const nonEmpty = s.tally.abandons.filter((a) => a.before.tick > 0 && (a.before.score > 0 || a.before.collected > 0));
      const mismatch = s.tally.abandons.find((a) => (a.before.tick > 0 && (a.before.score > 0 || a.before.collected > 0)) !== (a.result !== null));
      if (mismatch) flag('games', step, `abandon() returned ${json(mismatch.result)} for a run at ${json(mismatch.before)}`);
      const expected = base.save.stats.gamesPlayed + s.tally.gameOver + nonEmpty.length;
      if (s.save && s.save.stats.gamesPlayed !== expected) {
        flag('games', step, `gamesPlayed ${s.save.stats.gamesPlayed}, expected ${expected} (${s.tally.gameOver} finished + ${nonEmpty.length} abandoned non-empty of ${s.tally.abandons.length}; ${s.tally.runs} runs started)`);
      }
      if (s.save) {
        const recorded = [...s.tally.results.map((r) => r), ...nonEmpty.map((a) => a.result).filter(Boolean)];
        const score = recorded.reduce((n, r) => n + r.score, 0);
        const crystals = recorded.reduce((n, r) => n + r.crystals, 0);
        if (s.save.stats.totalScore !== base.save.stats.totalScore + score || s.save.stats.totalCrystals !== base.save.stats.totalCrystals + crystals) {
          flag('totals', step, `totalScore ${s.save.stats.totalScore} (expected ${score}), totalCrystals ${s.save.stats.totalCrystals} (expected ${crystals})`);
        }
        const best = recorded.reduce((n, r) => Math.max(n, r.score), base.save.highscore);
        const board = s.save.leaderboard;
        if (s.save.highscore !== best || board.length > 5 || board.some((e, i) => i > 0 && board[i - 1].score < e.score) || (board[0]?.score ?? 0) > s.save.highscore) {
          flag('totals', step, `highscore ${s.save.highscore} (expected ${best}), leaderboard ${json(board.map((e) => e.score))}`);
        }
        if (s.save.crystals > base.save.crystals + crystals) flag('wallet', step, `wallet ${s.save.crystals} is more than ever earned (${base.save.crystals} + ${crystals})`);
        // Идущий забег стартовал с рекордом из сохранения.
        if (['ready', 'playing', 'dying'].includes(s.mode) && s.highscore !== s.save.highscore) flag('record', step, `the run started with highscore ${s.highscore}, the save says ${s.save.highscore}`);
      }
      if (s.screen === 'paused') {
        await sleep(90);
        const again = await snap(page);
        if (again.screen === 'paused' && again.counters.ticks !== s.counters.ticks) flag('paused', step, `ticks ${s.counters.ticks} → ${again.counters.ticks} while paused`);
      }
      seen.finished = s.tally.gameOver;
      seen.abandoned = nonEmpty.length;
      seen.empty = s.tally.abandons.length - nonEmpty.length;
      seen.runs = s.tally.runs;
      if (game.errors.length > 0) flag('errors', step, game.errors[0]);
    }
    if (held) await page.keyboard.up(held);

    const walk = `${FUZZ_STEPS} steps: ${seen.runs} runs started, ${seen.finished} finished, ${seen.abandoned} abandoned, ${seen.empty} empty; screens ${[...seen.screens].join('/')}`;
    check('screen and sim mode agree after every step', !broken.agree, broken.agree ?? walk);
    check('at most one non-inert dialog after every step', !broken.dialogs, broken.dialogs ?? `${seen.panels} steps ended on a menu panel`);
    check('wallet ≥ 0 and never more than earned', !broken.wallet, broken.wallet ?? '');
    check('gamesPlayed grows exactly once per finished or abandoned non-empty run', !broken.games, broken.games ?? `${seen.finished} finished + ${seen.abandoned} abandoned, ${seen.empty} empty runs not recorded`);
    check('totals, highscore and leaderboard match the recorded runs', !broken.totals, broken.totals ?? '');
    check('every run starts with the saved highscore', !broken.record, broken.record ?? '');
    check('0 ticks whenever the game is paused', !broken.paused, broken.paused ?? '');
    check('the walk reached every screen', ['menu', 'playing', 'paused', 'gameover'].every((x) => seen.screens.has(x)) && seen.finished > 0 && seen.abandoned > 0, walk);

    // После всего этого — по-прежнему один цикл и рабочая игра.
    await page.evaluate(() => window.__e2e.setHidden(false));
    await page.setViewportSize(PROFILES[profile].viewport);
    await page.reload({ waitUntil: 'load' });
    await gameReady(page);
    const reloaded = await snap(page);
    check('the save survives a reload after the walk', reloaded.save.stats.gamesPlayed >= base.save.stats.gamesPlayed + seen.finished + seen.abandoned && reloaded.screen === 'menu', `gamesPlayed ${reloaded.save.stats.gamesPlayed}`);
    check('no console errors, page errors, failed requests or native dialogs', !broken.errors && game.errors.length === 0, broken.errors ?? game.errors.slice(0, 3).join(' ¦ '));
  } catch (err) {
    check('scenario finished', false, `${String(err?.message ?? err).split('\n')[0]} ¦ last actions: ${history.slice(-7).join(' → ')}`);
    await shot(page, `fail-fuzz-${seed}`);
  } finally {
    await game.context.close();
  }
}

/** После случайной прогулки (без перезагрузки) цикл по-прежнему один. */
async function scenarioFuzzLoop(browser) {
  const check = scope('fuzz loop');
  const game = await openGame(browser, 'desktop');
  const { page } = game;
  const rnd = mulberry32(4242);
  try {
    await autopilot(page, true);
    // Быстрая чехарда экранов: старт, пауза, заново, меню, размер окна, скрытая вкладка.
    for (let i = 0; i < 40; i++) {
      const s = await snap(page);
      if (s.screen === 'menu') await page.keyboard.press('Enter');
      else if (s.screen === 'playing') await page.keyboard.press(rnd() < 0.5 ? 'Escape' : 'KeyP');
      else if (s.screen === 'paused') await page.keyboard.press(rnd() < 0.4 ? 'KeyR' : rnd() < 0.5 ? 'KeyM' : 'Escape');
      else await page.keyboard.press('Escape');
      if (rnd() < 0.3) await page.setViewportSize(rnd() < 0.5 ? { width: 900, height: 700 } : { width: 1280, height: 800 });
      if (rnd() < 0.2) {
        await page.evaluate(() => window.__e2e.setHidden(true));
        await page.evaluate(() => window.__e2e.setHidden(false));
      }
      await sleep(30 + Math.floor(rnd() * 120));
    }
    await page.setViewportSize(PROFILES.desktop.viewport);
    await sleep(800);
    let s = await snap(page);
    if (s.screen === 'gameover') {
      await page.keyboard.press('Enter');
    } else if (s.screen === 'paused') await page.keyboard.press('Escape');
    else if (s.screen === 'menu') await page.keyboard.press('Enter');
    await untilScreen(page, 'playing', 3000);
    await until(page, () => window.__NV__.sim.state.mode === 'playing', null, 5000);
    await checkOneLoop(page, check, 'after 40 fast transitions');
    s = await snap(page);
    check('after 40 fast transitions the run is alive', s.screen === 'playing' && s.alive, `screen ${s.screen}, sim ${s.mode}`);
    consoleCheck(game, check);
  } catch (err) {
    check('scenario finished', false, String(err?.message ?? err).split('\n')[0]);
  } finally {
    await game.context.close();
  }
}

// ─── Запуск ─────────────────────────────────────────────────────────────────

const wants = (name) => !ONLY || ONLY.has(name);
const startedAt = Date.now();
console.log(`Neon Velocity II e2e → ${URL_ARG}`);

let browser;
try {
  browser = await chromium.launch({ headless: flags.headed !== 'true' });
} catch (err) {
  console.error(`FAIL  cannot launch Chromium: ${String(err?.message ?? err).split('\n')[0]}`);
  process.exit(2);
}

const watchdog = setTimeout(() => {
  console.error('FAIL  [e2e] the whole check did not finish in 20 minutes');
  process.exit(1);
}, 20 * 60_000);

const scenarios = [
  ['desktop', () => scenarioMain(browser, 'desktop')],
  ['phone', () => scenarioMain(browser, 'phone')],
  ['progress', () => scenarioProgress(browser)],
  ['shop', () => scenarioShop(browser)],
  ['panels', async () => {
    await scenarioPanels(browser, 'desktop');
    await scenarioPanels(browser, 'phone');
  }],
  ['edge', () => scenarioEdge(browser)],
  ['fuzz', async () => {
    for (const seed of FUZZ_SEEDS) await scenarioFuzz(browser, seed);
    await scenarioFuzzLoop(browser);
  }],
];

for (const [name, run] of scenarios) {
  if (!wants(name)) continue;
  try {
    await run();
  } catch (err) {
    // Сюда попадает только то, что не дошло до своей проверки: игра не открылась, упал браузер.
    scope(name)('scenario started', false, String(err?.message ?? err).split('\n')[0]);
  }
}

clearTimeout(watchdog);
await browser.close().catch(() => {});

const seconds = Math.round((Date.now() - startedAt) / 1000);
console.log('');
console.log(`${report.fail === 0 ? 'PASS' : 'FAIL'}  ${report.pass} passed, ${report.fail} failed, ${report.skip} skipped in ${seconds} s`);
for (const name of report.failed) console.log(`      ✗ ${name}`);
process.exit(report.fail === 0 ? 0 : 1);
