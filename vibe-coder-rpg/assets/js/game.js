/* ============================================================
   ВАЙБ-КОДЕР: ЛЕГЕНДА ПРОДАКШЕНА
   Мобильная пиксельная RPG. Чистый JS, без зависимостей.
   ============================================================ */
(() => {
'use strict';

// ============================================================
// 1. КОНСТАНТЫ И УТИЛИТЫ
// ============================================================
const TILE = 16;
const SAVE_KEY = 'vibe-coder-rpg-save-v1';
const SOLID_TILES = new Set(['#', '~', 'W', 'R', 'D', 'S', 'G', 'r']);
const DX = { up: 0, down: 0, left: -1, right: 1 };
const DY = { up: -1, down: 1, left: 0, right: 0 };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const cv = $('screen');
const ctx = cv.getContext('2d');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b + 1));
const chance = (p) => Math.random() < p;
const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? Math.min(ms, 120) : ms));

// Детерминированный шум для декора тайлов
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

// ============================================================
// 2. ЗВУК (WebAudio, крошечные чиптюн-эффекты)
// ============================================================
let AC = null;
let muted = false;

function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* без звука */ } }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}

function tone(freq, dur, type = 'square', vol = 0.06, delay = 0) {
  const ac = audio();
  if (!ac || muted) return;
  const t0 = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ac.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const SFX = {
  blip: () => tone(880, 0.05, 'square', 0.04),
  confirm: () => { tone(660, 0.07); tone(990, 0.09, 'square', 0.05, 0.06); },
  hit: () => tone(160, 0.14, 'sawtooth', 0.08),
  hurt: () => tone(110, 0.2, 'sawtooth', 0.09),
  heal: () => { tone(520, 0.09, 'sine', 0.07); tone(780, 0.12, 'sine', 0.07, 0.08); },
  item: () => { tone(700, 0.08, 'triangle', 0.07); tone(1050, 0.1, 'triangle', 0.07, 0.07); },
  levelup: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'square', 0.06, i * 0.09)),
  battle: () => { tone(220, 0.12, 'sawtooth', 0.07); tone(185, 0.16, 'sawtooth', 0.07, 0.1); },
  victory: () => [659, 659, 659, 880].forEach((f, i) => tone(f, 0.11, 'square', 0.06, i * 0.11)),
  defeat: () => [330, 262, 220, 165].forEach((f, i) => tone(f, 0.18, 'triangle', 0.07, i * 0.15)),
};

// ============================================================
// 3. ПРЕДМЕТЫ, СКИЛЛЫ, ВРАГИ
// ============================================================
const ITEMS = {
  coffee:  { name: 'Кофе',             desc: '+30 HP',                  price: 12 },
  scoffee: { name: 'Двойной эспрессо', desc: '+70 HP',                  price: 28 },
  energy:  { name: 'Энергетик',        desc: '+10 фокуса',              price: 16 },
  pizza:   { name: 'Пицца',            desc: 'Полное восстановление',   price: 60 },
  duck:    { name: 'Уточка-дебаггер',  desc: 'Сбежать из боя (не с боссов)', price: 20 },
};

const SKILLS = [
  { id: 'prompt',   name: 'Промпт',        fp: 0,  lvl: 1, kind: 'atk',  mult: 1.0, desc: 'обычная атака' },
  { id: 'refactor', name: 'Рефактор',      fp: 3,  lvl: 2, kind: 'heal', mult: 0.45, desc: 'лечит 45% HP' },
  { id: 'debug',    name: 'Дебаг',         fp: 4,  lvl: 3, kind: 'atk',  mult: 1.6, stun: 0.5, desc: 'урон ×1.6, шанс стана' },
  { id: 'vibewave', name: 'Вайб-волна',    fp: 7,  lvl: 5, kind: 'atk',  mult: 2.4, desc: 'урон ×2.4' },
  { id: 'rewrite',  name: 'Полный рерайт', fp: 10, lvl: 7, kind: 'atk',  mult: 3.5, desc: 'урон ×3.5' },
];

const ENEMIES = {
  bug:       { name: 'Мелкий Баг',            hp: 14,  atk: 5,  def: 0, xp: 10,  coins: 6,   spr: 'bug',
               taunts: ['«Воспроизводится только в проде!»', '«Меня закрыли как won’t fix. Я вернулся.»'] },
  nullp:     { name: 'Нулл-Пойнтер',          hp: 20,  atk: 7,  def: 1, xp: 16,  coins: 10,  spr: 'nullp',
               taunts: ['«undefined is not a function!»', '«Я — ничто. И я иду за тобой.»'] },
  spaghetti: { name: 'Спагетти-Монстр',       hp: 30,  atk: 8,  def: 1, xp: 24,  coins: 14,  spr: 'spag',
               taunts: ['«Разберись в моей логике, если посмеешь!»', '«Меня писали в пятницу вечером!»'] },
  leak:      { name: 'Утечка Памяти',         hp: 24,  atk: 6,  def: 2, xp: 20,  coins: 12,  spr: 'leak', drain: true,
               taunts: ['«Я расту с каждой минутой аптайма…»'] },
  procr:     { name: 'Прокрастинация',        hp: 26,  atk: 6,  def: 1, xp: 18,  coins: 10,  spr: 'procr', lazy: 0.35,
               taunts: ['«Может, начнём бой… завтра?»', '«Сначала посмотри ещё один туториал.»'] },
  reaper:    { name: 'Дедлайн-Жнец',          hp: 38,  atk: 10, def: 2, xp: 34,  coins: 22,  spr: 'reaper',
               taunts: ['«Релиз был вчера.»', '«Тик-так, вайб-кодер.»'] },
  conflict:  { name: 'Великий Мерж-Конфликт', hp: 78,  atk: 10, def: 2, xp: 70,  coins: 60,  spr: 'conflict', boss: true,
               taunts: ['«<<<<<<< HEAD! Никто не пройдёт! >>>>>>>»'] },
  demon:     { name: 'Демон Легаси',          hp: 165, atk: 13, def: 3, xp: 200, coins: 150, spr: 'demon', boss: true, phases: true,
               taunts: ['«Я — 800 000 строк без единого теста! МЕНЯ НЕЛЬЗЯ ТРОГАТЬ!»'] },
};

// ============================================================
// 4. КАРТЫ МИРА
// ============================================================
// Легенда: . земля  , декор  - тропа  = мост  # стена/дерево  ~ вода
//          R крыша  W стена дома  D дверь  S сервер  G ворота  r валун
const MAPS = {
  village: {
    name: 'Деревня Гит-Хилл',
    theme: 'field',
    rows: [
      '############################',
      '#############GG#############',
      '##..#........--........#..##',
      '#..RRRR......--......RRRR..#',
      '#..WWDW..,...--...,..WDWW..#',
      '#............--............#',
      '#..,..------------------,..#',
      '#......-......--......-....#',
      '#.RRRR.-......--......-.,..#',
      '#.WWDW.-......--.RRRR.-....#',
      '#......-......--.WDWW.-....#',
      '#.,....-......--......------',
      '#......---------------..,..#',
      '#..#..........--.......#...#',
      '#....,..r.....--...,.......#',
      '#.....#.......--......#.,..#',
      '##############--############',
      '##############--############',
    ],
    teleports: [
      { x: 27, y: 11, to: 'forest', tx: 1, ty: 11 },
      { x: 14, y: 17, to: 'swamp', tx: 14, ty: 1 },
      { x: 15, y: 17, to: 'swamp', tx: 15, ty: 1 },
      { x: 13, y: 1, to: 'tower', tx: 9, ty: 23, needFlag: 'gateOpen' },
      { x: 14, y: 1, to: 'tower', tx: 10, ty: 23, needFlag: 'gateOpen' },
    ],
  },

  forest: {
    name: 'Лес Легаси',
    theme: 'field',
    encounters: { rate: 0.1, list: [['bug', 5], ['nullp', 3], ['spaghetti', 2]] },
    rows: [
      '################--################',
      '##..##..##.#....--....#.##..##..##',
      '#....#....##....--....##....#....#',
      '#.##....##......--......##....##.#',
      '#....##....##...--...##....##....#',
      '#.##......##....--..,...##..RRRR.#',
      '#....##.,.......--.......#..WWDW.#',
      '#.##......##....--....##.........#',
      '#......##......,--,......##...##.#',
      '#.##........##..--..##...........#',
      '#...............--...............#',
      '-----------------.....##....##...#',
      '#.##....##......##..##......##...#',
      '#....##.....##..........##.......#',
      '#.##....##.....##..##.......##...#',
      '#....##....##..........##....##..#',
      '#.##..............##.............#',
      '#......,...##..........##...,....#',
      '#.##....##......##..##.......##..#',
      '#....##......##..........##......#',
      '#.##....##..........##.......##..#',
      '##################################',
    ],
    teleports: [
      { x: 0, y: 11, to: 'village', tx: 26, ty: 11 },
      { x: 16, y: 0, to: 'cave', tx: 12, ty: 13 },
      { x: 17, y: 0, to: 'cave', tx: 13, ty: 13 },
    ],
  },

  cave: {
    name: 'Пещера Конфликтов',
    theme: 'cave',
    encounters: { rate: 0.13, list: [['nullp', 4], ['leak', 4], ['spaghetti', 2]] },
    rows: [
      '##########################',
      '##......................##',
      '##..##...##...##...##...##',
      '##..##...##...##...##...##',
      '##......................##',
      '##......................##',
      '##..##...##...##...##...##',
      '##..##...##...##...##...##',
      '##......................##',
      '##......................##',
      '##..##...##...##...##...##',
      '##..##...##...##...##...##',
      '##......................##',
      '##......................##',
      '############..############',
      '############..############',
    ],
    teleports: [
      { x: 12, y: 15, to: 'forest', tx: 16, ty: 1 },
      { x: 13, y: 15, to: 'forest', tx: 17, ty: 1 },
    ],
  },

  swamp: {
    name: 'Болото Дедлайнов',
    theme: 'swamp',
    encounters: { rate: 0.13, list: [['procr', 5], ['leak', 2], ['reaper', 3]] },
    rows: [
      '##############--############',
      '#.............--...........#',
      '#..~~~........--......~~~..#',
      '#.~~~~~.......--.....~~~~~.#',
      '#..~~~........--......~~~..#',
      '#.............--...........#',
      '#......~~~....--....~~.....#',
      '#.....~~~~~...--...~~~~....#',
      '#......~~~....--....~~.....#',
      '#..............=...........#',
      '#...~~~~~~~~~~~=~~~~~~~~...#',
      '#...~~~~~~~~~~~=~~~~~~~~...#',
      '#...~~~~~......=......~~...#',
      '#...~~~~~..............~...#',
      '#...~~~~~....,....,.....~..#',
      '#....~~~................~..#',
      '#..........................#',
      '############################',
    ],
    teleports: [
      { x: 14, y: 0, to: 'village', tx: 14, ty: 15 },
      { x: 15, y: 0, to: 'village', tx: 15, ty: 15 },
    ],
  },

  tower: {
    name: 'Башня Продакшена',
    theme: 'tower',
    encounters: { rate: 0.15, list: [['spaghetti', 3], ['reaper', 4], ['nullp', 3]] },
    boost: { hp: 1.6, atk: 1.35, xp: 1.6, coins: 1.5 },
    rows: [
      '####################',
      '##................##',
      '##................##',
      '##.....SS..SS.....##',
      '##................##',
      '##.SS..........SS.##',
      '##................##',
      '####....####....####',
      '##................##',
      '##..SS........SS..##',
      '##................##',
      '####....####....####',
      '##................##',
      '##..SS........SS..##',
      '##................##',
      '####....####....####',
      '##................##',
      '##..SS........SS..##',
      '##................##',
      '####....####....####',
      '##................##',
      '##....SS....SS....##',
      '##................##',
      '##................##',
      '#########..#########',
      '#########..#########',
    ],
    teleports: [
      { x: 9, y: 25, to: 'village', tx: 13, ty: 2 },
      { x: 10, y: 25, to: 'village', tx: 14, ty: 2 },
    ],
  },
};

// Нормализация карт: массивы символов одинаковой ширины
for (const m of Object.values(MAPS)) {
  const w = Math.max(...m.rows.map((r) => r.length));
  m.w = w;
  m.h = m.rows.length;
  m.grid = m.rows.map((r) => (r + '#'.repeat(w)).slice(0, w).split(''));
}

// ============================================================
// 5. NPC И ОБЪЕКТЫ
// ============================================================
const PALS = {
  player: { hair: '#2b2340', skin: '#f2c99a', shirt: '#7c4dff', pants: '#28406e', opts: { headphones: '#ff5d8f' } },
  senior: { hair: '#b9b9c9', skin: '#e8b98a', shirt: '#3a5f7d', pants: '#333a4d', opts: { beard: '#b9b9c9', glasses: true } },
  barista:{ hair: '#7a4a21', skin: '#f2c99a', shirt: '#5e4534', pants: '#2f2a26', opts: { apron: '#e8d9b8' } },
  masha:  { hair: '#d9822b', skin: '#f7d7ae', shirt: '#3fa66a', pants: '#4d3b66', opts: { ponytail: true } },
  witch:  { hair: '#4b2d5e', skin: '#e9c39a', shirt: '#5e2d79', pants: '#33203f', opts: { hat: '#8b5cf6' } },
  merge:  { hair: '#4a3c2e', skin: '#dba97e', shirt: '#a34a2a', pants: '#4a3b2d', opts: { helmet: '#ffd166' } },
  spirit: { hair: '#bfe8ff', skin: '#dff4ff', shirt: '#9cc8e8', pants: '#9cc8e8', opts: { ghost: true } },
};

const NPCS = [
  { id: 'senior',  map: 'village', x: 15, y: 5,  pal: 'senior',  name: 'Сеньор Валера' },
  { id: 'barista', map: 'village', x: 21, y: 13, pal: 'barista', name: 'Бариста Гоша' },
  { id: 'masha',   map: 'village', x: 5,  y: 5,  pal: 'masha',   name: 'Джун Маша' },
  { id: 'catHome', map: 'village', x: 4,  y: 6,  pal: 'cat',     name: 'Кот Дебаггер', needFlag: 'catReturned' },
  { id: 'witch',   map: 'forest',  x: 27, y: 7,  pal: 'witch',   name: 'Промпт-Ведьма' },
  { id: 'merge',   map: 'cave',    x: 11, y: 12, pal: 'merge',   name: 'Мерж-Мастер Боря' },
  { id: 'spirit',  map: 'swamp',   x: 15, y: 13, pal: 'spirit',  name: 'Дух Стековерфлоу' },
];

const OBJECTS = [
  { id: 'signVillage', map: 'village', x: 16, y: 13, kind: 'sign', solid: true,
    text: '«Гит-Хилл. Население: 42 разработчика и один кот.\nПродакшен вон там, наверху. Опять лежит.»' },
  { id: 'coffeeV',  map: 'village', x: 3,  y: 14, kind: 'item', item: 'coffee',  qty: 1 },
  { id: 'gateL', map: 'village', x: 13, y: 1, kind: 'gate', solid: false },
  { id: 'gateR', map: 'village', x: 14, y: 1, kind: 'gate', solid: false },
  { id: 'signForest', map: 'forest', x: 3, y: 10, kind: 'sign', solid: true,
    text: '«Лес Легаси. Осторожно: спагетти-код кусается.\nКомментариев нет. Вообще нигде.»' },
  { id: 'mushroom', map: 'forest', x: 31, y: 19, kind: 'mushroom' },
  { id: 'cat',      map: 'forest', x: 6,  y: 17, kind: 'cat', solid: true },
  { id: 'energyF',  map: 'forest', x: 12, y: 20, kind: 'item', item: 'energy', qty: 1 },
  { id: 'scoffeeC', map: 'cave',   x: 22, y: 9,  kind: 'item', item: 'scoffee', qty: 1 },
  { id: 'conflict', map: 'cave',   x: 13, y: 1,  kind: 'boss', enemy: 'conflict', solid: true },
  { id: 'pizzaS',   map: 'swamp',  x: 24, y: 16, kind: 'item', item: 'pizza', qty: 1 },
  { id: 'cooler',   map: 'tower',  x: 9,  y: 10, kind: 'cooler', solid: true },
  { id: 'demon',    map: 'tower',  x: 9,  y: 2,  kind: 'boss', enemy: 'demon', solid: true },
];

// ============================================================
// 6. СОСТОЯНИЕ ИГРЫ
// ============================================================
const G = {
  mode: 'title', // title | explore | dialog | battle | menu | ending
  map: 'village',
  player: null,
  flags: {},
  inv: {},
  steps: 0,
  camX: 0, camY: 0,
  animT: 0,
  battle: null,
  floaters: [],
  shake: 0,
};

function newPlayer() {
  return {
    x: 14, y: 7, px: 14 * TILE, py: 7 * TILE,
    dir: 'down', moving: false, tx: 0, ty: 0, walkT: 0,
    lvl: 1, xp: 0, hp: 32, maxHp: 32, fp: 12, maxFp: 12,
    atk: 7, def: 2, coins: 15,
  };
}

function xpNext(lvl) { return 15 + (lvl - 1) * 25; }
function knownSkills() { return SKILLS.filter((s) => s.lvl <= G.player.lvl); }
function addItem(id, n = 1) { G.inv[id] = (G.inv[id] || 0) + n; }
function hasArtifacts() { return G.flags.crystal && G.flags.mergekey && G.flags.token; }

function grid() { return MAPS[G.map].grid; }
function tileAt(map, x, y) {
  const m = MAPS[map];
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return '#';
  return m.grid[y][x];
}

function objAt(map, x, y) {
  return OBJECTS.find((o) => o.map === map && o.x === x && o.y === y && !G.flags['obj_' + o.id] && objVisible(o));
}
function objVisible(o) {
  if (o.kind === 'gate') return !G.flags.gateOpen;
  return true;
}
function npcAt(map, x, y) {
  return NPCS.find((n) => n.map === map && n.x === x && n.y === y && npcVisible(n));
}
function npcVisible(n) {
  if (n.needFlag && !G.flags[n.needFlag]) return false;
  return true;
}

function isSolidAt(map, x, y) {
  const t = tileAt(map, x, y);
  if (SOLID_TILES.has(t)) {
    if (t === 'G' && G.flags.gateOpen) return false;
    return true;
  }
  const o = objAt(map, x, y);
  if (o && (o.solid || o.kind === 'boss')) return true;
  if (npcAt(map, x, y)) return true;
  return false;
}

// ============================================================
// 7. СОХРАНЕНИЯ
// ============================================================
function saveGame() {
  try {
    const p = G.player;
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1, map: G.map, flags: G.flags, inv: G.inv, steps: G.steps, muted,
      player: { x: p.x, y: p.y, dir: p.dir, lvl: p.lvl, xp: p.xp, hp: p.hp, maxHp: p.maxHp,
                fp: p.fp, maxFp: p.maxFp, atk: p.atk, def: p.def, coins: p.coins },
    }));
    return true;
  } catch (e) { return false; }
}

function loadGame() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!d || d.v !== 1) return false;
    G.map = d.map; G.flags = d.flags || {}; G.inv = d.inv || {}; G.steps = d.steps || 0;
    muted = !!d.muted;
    G.player = Object.assign(newPlayer(), d.player);
    G.player.px = G.player.x * TILE; G.player.py = G.player.y * TILE;
    G.player.moving = false;
    return true;
  } catch (e) { return false; }
}
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }

// ============================================================
// 8. ЭКРАН И ВВОД
// ============================================================
let VW = 320, VH = 180, scale = 3;

function resize() {
  const w = innerWidth, h = innerHeight;
  scale = Math.max(2, Math.floor(Math.min(w, h) / 170));
  VW = Math.ceil(w / scale);
  VH = Math.ceil(h / scale);
  cv.width = VW; cv.height = VH;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', resize);
resize();

const held = { up: false, down: false, left: false, right: false };
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};

addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { held[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (['KeyE', 'Enter', 'Space'].includes(e.code)) {
    e.preventDefault();
    pressA();
  }
  if (e.code === 'Escape' || e.code === 'KeyM') {
    if (G.mode === 'explore') openMenu();
    else if (G.mode === 'menu') closeMenu();
  }
});
addEventListener('keyup', (e) => { if (KEYMAP[e.code]) held[KEYMAP[e.code]] = false; });

function heldDir() {
  for (const d of ['up', 'down', 'left', 'right']) if (held[d]) return d;
  return null;
}

// Тач-джойстик
document.querySelectorAll('.dpad-btn').forEach((b) => {
  const dir = b.dataset.dir;
  const on = (e) => { e.preventDefault(); held[dir] = true; b.classList.add('held'); audio(); };
  const off = (e) => { e.preventDefault(); held[dir] = false; b.classList.remove('held'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('pointerleave', off);
});
$('btn-a').addEventListener('pointerdown', (e) => { e.preventDefault(); audio(); pressA(); });
$('dialog').addEventListener('pointerdown', (e) => {
  if (e.target.closest('#dlg-choices')) return;
  e.preventDefault();
  pressA();
});

function pressA() {
  if (G.mode === 'dialog') { advanceDialog(); return; }
  if (G.mode === 'explore') interact();
}

// ============================================================
// 9. ПИКСЕЛЬ-АРТ: ТАЙЛЫ
// ============================================================
const THEMES = {
  field: { ground: '#4a9e63', groundDark: '#3f8a55', path: '#cfa768', pathDark: '#b89053',
           wall: '#2a6b42', wallTop: '#1e5232', water: '#2f6d9e', waterLight: '#4a89ba', decor: ['#ff8fb3', '#ffd166', '#fff'] },
  cave:  { ground: '#3a3350', groundDark: '#332c47', path: '#4a4163', pathDark: '#403858',
           wall: '#221c38', wallTop: '#161226', water: '#1f5c66', waterLight: '#2e7a86', decor: ['#6ef3c5', '#8b7ad9'] },
  swamp: { ground: '#57713d', groundDark: '#4b6234', path: '#8a7a4a', pathDark: '#77693e',
           wall: '#3a4a2c', wallTop: '#2c381f', water: '#2e4d46', waterLight: '#3d665c', decor: ['#c9e265', '#8fd9a8'] },
  tower: { ground: '#262045', groundDark: '#211c3c', path: '#332b58', pathDark: '#2c2549',
           wall: '#151226', wallTop: '#0e0b1a', water: '#5e17eb', waterLight: '#8b5cf6', decor: ['#6ef3c5', '#ff5d8f', '#4ac6ff'] },
};

const tileCache = new Map();

function tileSprite(theme, ch, variant) {
  const key = theme + ch + variant;
  if (tileCache.has(key)) return tileCache.get(key);
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d');
  const T = THEMES[theme];
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };

  const groundBase = () => {
    px(0, 0, 16, 16, T.ground);
    for (let i = 0; i < 5; i++) {
      const gx = Math.floor(hash2(variant * 31 + i, i * 7 + 1) * 16);
      const gy = Math.floor(hash2(i * 13 + 2, variant * 17 + i) * 16);
      px(gx, gy, 1, 1, T.groundDark);
    }
  };

  switch (ch) {
    case '.': groundBase(); break;
    case ',': {
      groundBase();
      const col = T.decor[variant % T.decor.length];
      px(4, 5, 2, 2, col); px(10, 9, 2, 2, T.decor[(variant + 1) % T.decor.length]);
      px(5, 4, 1, 1, '#fff');
      break;
    }
    case '-': case '=': {
      px(0, 0, 16, 16, ch === '=' ? '#8a6a3f' : T.path);
      for (let i = 0; i < 4; i++) {
        const gx = Math.floor(hash2(variant + i * 5, i * 3) * 15);
        const gy = Math.floor(hash2(i * 9, variant + i) * 15);
        px(gx, gy, 2, 1, ch === '=' ? '#6f5330' : T.pathDark);
      }
      if (ch === '=') { px(0, 3, 16, 1, '#6f5330'); px(0, 11, 16, 1, '#6f5330'); }
      break;
    }
    case '#': {
      if (theme === 'field' || theme === 'swamp') {
        // дерево
        groundBase();
        const leaf = theme === 'swamp' ? '#3d5226' : T.wall;
        const leafTop = theme === 'swamp' ? '#2e3f1c' : T.wallTop;
        px(6, 10, 4, 5, '#5c4327');
        px(2, 2, 12, 9, leaf);
        px(3, 1, 10, 2, leaf);
        px(4, 3, 4, 3, leafTop);
        px(9, 6, 4, 3, leafTop);
      } else {
        // каменная/серверная стена
        px(0, 0, 16, 16, T.wall);
        px(0, 0, 16, 2, T.wallTop);
        px(0, 8, 16, 1, T.wallTop);
        px(8, 2, 1, 6, T.wallTop);
        px(3, 9, 1, 7, T.wallTop);
        px(12, 9, 1, 7, T.wallTop);
        if (theme === 'tower' && variant % 2) { px(5, 4, 2, 1, '#6ef3c5'); px(10, 12, 2, 1, '#ff5d8f'); }
      }
      break;
    }
    case '~': {
      px(0, 0, 16, 16, T.water);
      const off = variant % 2 ? 3 : 0;
      px(2 + off, 4, 5, 1, T.waterLight);
      px(9 - off, 10, 5, 1, T.waterLight);
      px(5, 13, 3, 1, T.waterLight);
      break;
    }
    case 'R': {
      px(0, 0, 16, 16, '#8f3b52');
      px(0, 0, 16, 2, '#a34e66');
      px(0, 5, 16, 1, '#6e2c3e');
      px(0, 10, 16, 1, '#6e2c3e');
      px(0, 15, 16, 1, '#5c2434');
      break;
    }
    case 'W': {
      px(0, 0, 16, 16, '#d8c9a8');
      px(0, 0, 16, 1, '#b8a988');
      px(0, 7, 16, 1, '#b8a988');
      px(5, 1, 1, 6, '#b8a988');
      px(11, 8, 1, 8, '#b8a988');
      break;
    }
    case 'D': {
      px(0, 0, 16, 16, '#d8c9a8');
      px(2, 2, 12, 14, '#6e4b2a');
      px(3, 3, 10, 13, '#84603c');
      px(11, 9, 2, 2, '#ffd166');
      break;
    }
    case 'S': {
      px(0, 0, 16, 16, '#1c1830');
      px(1, 0, 14, 16, '#2c2549');
      px(3, 2, 10, 3, '#151226');
      px(3, 7, 10, 3, '#151226');
      px(3, 12, 10, 3, '#151226');
      const on = variant % 2;
      px(4, 3, 1, 1, on ? '#6ef3c5' : '#2c5c4c'); px(6, 3, 1, 1, '#ff5d8f');
      px(4, 8, 1, 1, '#ffd166'); px(6, 8, 1, 1, on ? '#4ac6ff' : '#26506a');
      px(4, 13, 1, 1, on ? '#ff5d8f' : '#66293e');
      break;
    }
    case 'G': {
      px(0, 0, 16, 16, '#3a3350');
      px(0, 0, 16, 2, '#ffd166');
      px(0, 14, 16, 2, '#ffd166');
      for (let i = 2; i < 16; i += 4) px(i, 2, 2, 12, '#b8860b');
      break;
    }
    case 'r': {
      groundBase();
      px(4, 6, 8, 7, '#8a8598');
      px(5, 5, 6, 2, '#a5a0b5');
      px(6, 11, 5, 2, '#6e6a80');
      break;
    }
    default: groundBase();
  }
  tileCache.set(key, c);
  return c;
}

// ============================================================
// 10. ПИКСЕЛЬ-АРТ: ПЕРСОНАЖИ
// ============================================================
const humanCache = new Map();

function humanSprite(palId, dir, frame) {
  const key = palId + dir + frame;
  if (humanCache.has(key)) return humanCache.get(key);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  if (palId === 'cat') { drawCat(g, frame); humanCache.set(key, c); return c; }
  const pal = PALS[palId];
  drawHuman(g, pal, dir, frame);
  humanCache.set(key, c);
  return c;
}

function drawHuman(g, pal, dir, frame) {
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const o = pal.opts || {};
  if (o.ghost) g.globalAlpha = 0.85;

  // волосы + голова
  px(4, 1, 8, 4, pal.hair);
  px(5, 0, 6, 1, pal.hair);
  if (dir === 'up') {
    px(4, 5, 8, 3, pal.hair); // затылок
  } else {
    px(4, 5, 8, 3, pal.skin);
    px(4, 4, 1, 2, pal.hair); px(11, 4, 1, 2, pal.hair);
    // глаза
    if (dir === 'down') { px(6, 6, 1, 1, '#1a1426'); px(9, 6, 1, 1, '#1a1426'); }
    if (dir === 'left') px(5, 6, 1, 1, '#1a1426');
    if (dir === 'right') px(10, 6, 1, 1, '#1a1426');
  }
  if (o.glasses && dir !== 'up') { px(5, 6, 3, 1, '#222a44'); px(8, 6, 3, 1, '#222a44'); }
  if (o.beard && dir !== 'up') px(5, 7, 6, 2, o.beard);
  if (o.headphones) {
    px(4, 0, 8, 1, o.headphones);
    px(3, 3, 1, 3, o.headphones); px(12, 3, 1, 3, o.headphones);
  }
  if (o.hat) {
    px(3, 2, 10, 1, '#3a2050');
    px(5, 0, 6, 2, o.hat);
    px(7, -0, 2, 1, '#ffd166');
  }
  if (o.helmet) {
    px(4, 0, 8, 3, o.helmet);
    px(7, 1, 2, 1, '#fff');
  }
  if (o.ponytail) px(dir === 'left' ? 12 : 3, 3, 1, 5, pal.hair);

  // тело
  const bodyY = 8;
  px(4, bodyY, 8, 4, pal.shirt);
  px(3, bodyY, 1, 3, pal.shirt); px(12, bodyY, 1, 3, pal.shirt); // руки
  px(3, bodyY + 3, 1, 1, pal.skin); px(12, bodyY + 3, 1, 1, pal.skin); // кисти
  if (o.apron) px(6, bodyY + 1, 4, 3, o.apron);

  // ноги / низ
  if (o.ghost) {
    px(4, 12, 8, 2, pal.shirt);
    px(4, 14, 2, 1, pal.shirt); px(7, 14, 2, 1, pal.shirt); px(10, 14, 2, 1, pal.shirt);
    g.globalAlpha = 1;
  } else {
    const l1 = frame ? 1 : 0;
    px(5, 12, 2, 3 - l1, pal.pants);
    px(9, 12, 2, 2 + l1, pal.pants);
    px(5, 15 - l1, 2, 1, '#1a1426');
    px(9, 14 + l1, 2, 1, '#1a1426');
  }
}

function drawCat(g, frame) {
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const grey = '#8a8598', dark = '#6e6a80';
  px(4, 6, 8, 6, grey);          // тело
  px(9, 3, 5, 5, grey);          // голова
  px(9, 2, 1, 2, dark); px(13, 2, 1, 2, dark); // уши
  px(10, 5, 1, 1, '#2ee66b'); px(12, 5, 1, 1, '#2ee66b'); // глаза
  px(3, 5, 1, 4, dark);          // хвост
  px(2, 4 + (frame ? 1 : 0), 1, 2, dark);
  px(5, 12, 1, 2, dark); px(7, 12, 1, 2, dark); px(9, 12, 1, 2, dark); px(11, 12, 1, 2, dark);
}

// ============================================================
// 11. ПИКСЕЛЬ-АРТ: ВРАГИ
// ============================================================
const ENEMY_ART = {
  bug: { pal: { a: '#3f8a55', b: '#2ee66b', c: '#1e5232', w: '#fff', r: '#ff5d8f' }, rows: [
    '................',
    '...aa......aa...',
    '....a......a....',
    '....abbbbbba....',
    '...abbbbbbbba...',
    '..abbwbbbbwbba..',
    '.a.bbbbbbbbbb.a.',
    '...bbbrrrrbbb...',
    '.a.bbbbbbbbbb.a.',
    '...abbbbbbbba...',
    '....abbbbbba....',
    '....a......a....',
    '...aa......aa...',
  ] },
  nullp: { pal: { b: '#9cc8e8', w: '#e8f4ff', k: '#1a2a44', r: '#ff5d8f' }, rows: [
    '....bbbbbbbb....',
    '...bwwwwwwwwb...',
    '..bwwkwwwwkwwb..',
    '..bwwwwwwwwwwb..',
    '..bwwrrrrrrwwb..',
    '..bwwrwwwrrwwb..',
    '..bwwrwwrwrwwb..',
    '..bwwrwrwwrwwb..',
    '..bwwrrwwwrwwb..',
    '..bwwrrrrrrwwb..',
    '..bwwwwwwwwwwb..',
    '..bw.bww.wwb.b..',
    '...b..bb..b.....',
  ] },
  spag: { pal: { o: '#ffb24a', d: '#d98a2b', w: '#fff', k: '#1a1426', m: '#a34e2a' }, rows: [
    '..ooo..oo..ooo..',
    '.o...oo..oo...o.',
    'o..ooo..oo..oo.o',
    '.oo...oo...oo...',
    'o..oo....oo...oo',
    '.oo..mm..mm..oo.',
    'o...mwkm mwkm..o',
    '.oo..mm..mm..oo.',
    'o..oo......oo..o',
    '.oo..oooooo..oo.',
    'o..oo......oo..o',
    '.o...oo..oo...o.',
    '..ooo..oo..ooo..',
  ] },
  leak: { pal: { c: '#3dd6b8', d: '#2a9e88', k: '#0e3830', w: '#fff' }, rows: [
    '.....cccccc.....',
    '...cccccccccc...',
    '..cccccccccccc..',
    '.cwkcccccccwkcc.',
    '.cccccccccccccc.',
    '.ccccdddddccccc.',
    '..cccccccccccc..',
    '...ccc..cc..cc..',
    '...cc...cc...c..',
    '...dc...dc...d..',
    '...c....c.......',
    '........c....d..',
    '...d............',
  ] },
  procr: { pal: { g: '#9a8fb8', d: '#7a6f98', k: '#1a1426', w: '#fff', p: '#4ac6ff' }, rows: [
    '....gggggggg....',
    '..gggggggggggg..',
    '.ggggggggggggggg',
    '.ggwkgggggwkgggg',
    '.gggggggggggggg.',
    '.ggggg.dd.ggggg.',
    '.gggggggggggggg.',
    '.gggpppppppggggg',
    '.gggpwwwwwpgggg.',
    '.gggpwwwwwpgggg.',
    '.gggpppppppggg..',
    '..gggggggggggg..',
    '....gggg.ggg....',
  ] },
  reaper: { pal: { k: '#241f3f', d: '#161226', w: '#e8e4f4', r: '#ff5d8f', g: '#ffd166' }, rows: [
    '....kkkkkkkk....',
    '...kkkkkkkkkk..g',
    '..kkkwwwwwwkk..g',
    '..kkwwwwwwwwk..g',
    '..kkwwrwwrwwk.gg',
    '..kkwwwwwwwwkggg',
    '..kkwwwrrwwwk..g',
    '..kkkwwwwwwkk..g',
    '..kkkkkkkkkkk..g',
    '..kkkkkkkkkkkk.g',
    '.kkkkkkkkkkkkk.g',
    '.kk.kkkk.kkkk..g',
    '.k...kk...kk...g',
  ] },
  conflict: { pal: { r: '#e0523e', g: '#3fa66a', y: '#ffd166', k: '#1a1426', w: '#fff' }, rows: [
    'rrr...........gg',
    'rwkr.........gkw',
    'rrrr..........gg',
    '.rrryy.....yyggg',
    '..rrryy...yyggg.',
    '...rrryyyyyggg..',
    '....rryyyyygg...',
    '....yyyyyyyyy...',
    '...yyykkkkyyy...',
    '....yyyyyyyyy...',
    '...rryyyyyyygg..',
    '..rrr..yyy..ggg.',
    '.rrr....y....ggg',
  ] },
  demon: { pal: { h: '#ff5d8f', k: '#241f3f', g: '#3a3350', s: '#0e2818', b: '#2ee66b', c: '#6e6a80' }, rows: [
    '..h..........h..',
    '...h........h...',
    '..kkkkkkkkkkkk..',
    '.kggggggggggggk.',
    '.kgssssssssssgk.',
    '.kgsbssbbssbsgk.',
    '.kgssbssssbssgk.',
    '.kgssssssssssgk.',
    '.kgsbbbbbbbbsgk.',
    '.kgsbssssssbsgk.',
    '.kgssssssssssgk.',
    '.kkkkkkkkkkkkkk.',
    '..c..c....c..c..',
    '.c....c..c....c.',
  ] },
};

const enemyCache = new Map();
function enemySprite(id) {
  if (enemyCache.has(id)) return enemyCache.get(id);
  const art = ENEMY_ART[id];
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  const y0 = Math.floor((16 - art.rows.length) / 2);
  art.rows.forEach((row, y) => {
    for (let x = 0; x < Math.min(16, row.length); x++) {
      const col = art.pal[row[x]];
      if (col) { g.fillStyle = col; g.fillRect(x, y0 + y, 1, 1); }
    }
  });
  enemyCache.set(id, c);
  return c;
}

// ============================================================
// 12. ДИАЛОГОВАЯ СИСТЕМА (async/await)
// ============================================================
const dlgEl = $('dialog'), dlgName = $('dlg-name'), dlgText = $('dlg-text'),
      dlgChoices = $('dlg-choices'), dlgMore = $('dlg-more');

let dlgLines = [], dlgIdx = 0, dlgResolve = null, typing = null, typingFull = '';

function say(who, ...lines) {
  return new Promise((resolve) => {
    dlgLines = lines;
    dlgIdx = 0;
    dlgResolve = resolve;
    dlgEl.classList.remove('hidden');
    dlgChoices.innerHTML = '';
    dlgName.textContent = who || '';
    showLine();
  });
}

function showLine() {
  const text = dlgLines[dlgIdx];
  typingFull = text;
  dlgText.textContent = '';
  dlgMore.style.visibility = 'hidden';
  if (reduceMotion) {
    dlgText.textContent = text;
    dlgMore.style.visibility = 'visible';
    return;
  }
  let i = 0;
  clearInterval(typing);
  typing = setInterval(() => {
    i += 2;
    dlgText.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(typing);
      typing = null;
      dlgMore.style.visibility = 'visible';
    }
  }, 16);
}

function advanceDialog() {
  if (dlgChoices.children.length) return; // ждём выбор
  if (typing) { // дописать мгновенно
    clearInterval(typing);
    typing = null;
    dlgText.textContent = typingFull;
    dlgMore.style.visibility = 'visible';
    return;
  }
  if (!dlgResolve) return;
  SFX.blip();
  dlgIdx++;
  if (dlgIdx < dlgLines.length) showLine();
  else { const r = dlgResolve; dlgResolve = null; r(); }
}

function choice(prompt, labels) {
  return new Promise((resolve) => {
    dlgEl.classList.remove('hidden');
    dlgName.textContent = '';
    dlgText.textContent = prompt;
    dlgMore.style.visibility = 'hidden';
    dlgChoices.innerHTML = '';
    labels.forEach((label, i) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => {
        SFX.confirm();
        dlgChoices.innerHTML = '';
        resolve(i);
      });
      dlgChoices.appendChild(b);
    });
  });
}

function closeDialog() {
  dlgEl.classList.add('hidden');
  dlgChoices.innerHTML = '';
  dlgResolve = null;
}

async function runDialog(fn) {
  if (G.mode !== 'explore') return;
  G.mode = 'dialog';
  try { await fn(); } finally {
    closeDialog();
    if (G.mode === 'dialog') G.mode = 'explore';
    updateHud();
  }
}

// ============================================================
// 13. СЮЖЕТ: РЕПЛИКИ NPC
// ============================================================
const TALKS = {
  async senior() {
    const F = G.flags;
    if (!F.metSenior) {
      await say('Сеньор Валера',
        'А, Джун! Ты вовремя. Продакшен упал. Снова. Но в этот раз всё серьёзно.',
        'Демон Легаси вырвался из старого монолита и окопался в Башне Продакшена. CI/CD мёртв, деплой не проходит, дашборды красные, как мой глаз в пятницу.',
        'Ворота башни запечатаны тройной аутентификацией. Нужны три артефакта:',
        '💎 КРИСТАЛЛ ЧИСТОГО ПРОМПТА — у Промпт-Ведьмы в Лесу Легаси, к востоку отсюда.',
        '🔑 КЛЮЧ МЕРЖА — в Пещере Конфликтов, за лесом, на севере.',
        '🎫 ТОКЕН ДОСТУПА — у Духа Стековерфлоу на Болоте Дедлайнов, к югу.',
        'Ты же вайб-кодер. Промптуй смело, коммить часто. Держи кофе на дорогу.');
      addItem('coffee', 2);
      SFX.item();
      F.metSenior = true;
      await say('', '📦 Получено: Кофе ×2', '📜 Новое задание: «Поднять Продакшен» — собери три артефакта.');
      return;
    }
    if (F.win) {
      await say('Сеньор Валера',
        'Продакшен зелёный, алерты молчат... Даже страшно.',
        'Отдыхай, легенда. Завтра новый спринт — я уже завёл тебе 37 тикетов.');
      return;
    }
    if (hasArtifacts() && !F.gateOpen) {
      await say('Сеньор Валера', 'Все три артефакта?! Неси их к воротам на севере деревни. И, Джун... не читай логи Демона вслух.');
    } else if (!hasArtifacts()) {
      const need = [];
      if (!F.crystal) need.push('💎 Кристалл Промпта (лес, восток)');
      if (!F.mergekey) need.push('🔑 Ключ Мержа (пещера, север за лесом)');
      if (!F.token) need.push('🎫 Токен Доступа (болото, юг)');
      await say('Сеньор Валера', 'Осталось добыть:\n' + need.join('\n'));
    } else {
      await say('Сеньор Валера', 'Ворота открыты. Демон Легаси ждёт наверху башни. Иди и отрефактори его.');
    }
    const c = await choice('Подлечиться перед вылазкой? (стендап-медитация, бесплатно)', ['Да, полечи', 'Я в порядке']);
    if (c === 0) {
      G.player.hp = G.player.maxHp;
      G.player.fp = G.player.maxFp;
      SFX.heal();
      await say('Сеньор Валера', '«Вчера я ничего не делал, сегодня ничего не буду, блокеров нет.» ...Чувствуешь? HP и фокус восстановлены.');
    }
  },

  async barista() {
    await say('Бариста Гоша', 'Двойной эспрессо для двойного дедлайна? У меня всё свежее — как ветка после ребейза.');
    while (true) {
      const goods = ['coffee', 'scoffee', 'energy', 'duck', 'pizza'];
      const labels = goods.map((id) => `${ITEMS[id].name} — ${ITEMS[id].price}₿ (${ITEMS[id].desc})`);
      labels.push('Хватит, спасибо');
      const c = await choice(`Байткоины: ${G.player.coins}₿`, labels);
      if (c >= goods.length) break;
      const id = goods[c];
      if (G.player.coins < ITEMS[id].price) {
        await say('Бариста Гоша', 'Байткоинов не хватает. Иди поколоти багов — они неплохо платят.');
        continue;
      }
      G.player.coins -= ITEMS[id].price;
      addItem(id);
      SFX.item();
      updateHud();
    }
    await say('Бариста Гоша', 'Удачного деплоя! Возвращайся, если прод снова ляжет. То есть — до вечера.');
  },

  async masha() {
    const F = G.flags;
    if (F.catReturned) {
      await say('Джун Маша', 'Дебаггер снова лежит на клавиатуре и находит баги задницей. Всё как надо. Спасибо тебе!');
      return;
    }
    if (F.catFound) {
      await say('Джун Маша',
        'ДЕБАГГЕР! Ты нашёл его! Иди сюда, пушистый анализатор кода!',
        'Держи награду — пиццу из холодильника оффиса и немного байткоинов. Ты настоящий сеньор... по духу!');
      addItem('pizza');
      G.player.coins += 30;
      SFX.item();
      F.catReturned = true;
      await say('', '📦 Получено: Пицца, 30₿', '✅ Задание «Кот Дебаггер» выполнено!');
      return;
    }
    if (!F.catQuest) {
      await say('Джун Маша',
        'Беда! Мой кот Дебаггер сбежал в Лес Легаси! Без него ничего не компилируется...',
        'Он серый, зеленоглазый и мурлычет в тон кулерам. Найдёшь его — с меня пицца!');
      F.catQuest = true;
      await say('', '📜 Побочное задание: «Кот Дебаггер» — найди кота в Лесу Легаси.');
    } else {
      await say('Джун Маша', 'Дебаггер всё ещё где-то в лесу... Он любит тихие места подальше от тропы.');
    }
  },

  async catHome() {
    await say('Кот Дебаггер', 'Мррр. (Смотрит на тебя, как на легаси-код. С уважением.)');
  },

  async witch() {
    const F = G.flags;
    if (F.crystal) {
      await say('Промпт-Ведьма', 'Кристалл у тебя. Помни главное заклинание: «сначала контекст, потом просьба, и никогда — КАПСОМ».');
      return;
    }
    if (!F.witchAsked) {
      await say('Промпт-Ведьма',
        'Чую, чую... запах горелого дедлайна. За Кристаллом Чистого Промпта пришёл?',
        'Кристалл я тебе дам — но для ритуала нужен СВЕТЯЩИЙСЯ ГРИБ КОНТЕКСТА. Растёт в юго-восточной чаще, среди самого дремучего легаси.',
        'Принеси гриб — и я сварю тебе зелье идеального промпта. Из него кристалл и выпадет.');
      F.witchAsked = true;
      await say('', '📜 Найди Светящийся Гриб в юго-восточной чаще леса.');
      return;
    }
    if (F.hasMushroom) {
      await say('Промпт-Ведьма',
        'Гриб! Свежий, светится, контекстом пахнет. Смотри и учись:',
        '«Ты — старший котёл. Вари строго по шагам. Если не знаешь рецепт — так и скажи, не выдумывай»...',
        '✨ БУЛЬК! ✨ Готово. Держи — КРИСТАЛЛ ЧИСТОГО ПРОМПТА.',
        'Хороший промпт — половина коммита, дитя моё. Вторая половина — откат, когда всё сломается.');
      F.hasMushroom = false;
      F.crystal = true;
      SFX.levelup();
      await say('', '💎 Получен артефакт: Кристалл Чистого Промпта! (1/3... проверь список у Сеньора)');
    } else {
      await say('Промпт-Ведьма', 'Без гриба ритуала не будет. Юго-восточная чаща, самый тёмный угол. Иди по вайбу.');
    }
  },

  async merge() {
    const F = G.flags;
    if (F.mergekey) {
      await say('Мерж-Мастер Боря', 'Иди с миром, и да будет твой rebase чистым, а force-push — осознанным.');
      return;
    }
    if (F.conflictDown) {
      await say('Мерж-Мастер Боря',
        'Ты... ты разрулил Великий Мерж-Конфликт ВРУЧНУЮ?! Без «accept both changes»?!',
        'Легенда. Вот, держи — КЛЮЧ МЕРЖА. Я хранил его с прошлого спринта. То есть с 2019 года.');
      F.mergekey = true;
      SFX.levelup();
      await say('', '🔑 Получен артефакт: Ключ Мержа!');
      return;
    }
    await say('Мерж-Мастер Боря',
      'Стой, вайб-кодер! Дальше — Великий Мерж-Конфликт. Он сожрал троих мидлов и одного тимлида.',
      'Он там, в северном зале пещеры. Две ветки истории срослись в чудовище: и обе считают себя main.',
      'Победишь его — отдам Ключ Мержа. Проиграешь... ну, будешь четвёртым мидлом.');
  },

  async spirit() {
    const F = G.flags;
    if (F.token) {
      await say('Дух Стековерфлоу', '«Этот вопрос уже был решён.» Иди, отмеченный зелёной галочкой.');
      return;
    }
    await say('Дух Стековерфлоу',
      'Кто тревожит архив закрытых вопросов?..',
      'А-а, за Токеном Доступа явился. Токен получает лишь тот, кто постиг Путь Вайба.',
      'Ответь на три вопроса древних. Ошибёшься — познаешь гнев Дедлайна.');
    let correct = 0;
    const q1 = await choice('Вопрос 1: что делает истинный вайб-кодер, увидев непонятную ошибку?', [
      'Копирует её в поисковик целиком, вместе с путями',
      'Плачет и закрывает ноутбук',
      'Удаляет проект и начинает новый',
    ]);
    if (q1 === 0) correct++;
    const q2 = await choice('Вопрос 2: «Закрыт как дубликат» — это...', [
      'Судьба. Её принимают с достоинством',
      'Ошибка модератора',
      'Комплимент твоей оригинальности',
    ]);
    if (q2 === 0) correct++;
    const q3 = await choice('Вопрос 3: сколько вкладок документации нужно, чтобы поправить одну строку?', [
      '42, и все обязательны',
      'Одна',
      'Документация? Не, не слышал',
    ]);
    if (q3 === 0) correct++;
    if (correct === 3) {
      await say('Дух Стековерфлоу',
        'Три из трёх... Ты читал ответы ПОД принятым ответом. Ты достоин.',
        'Прими ТОКЕН ДОСТУПА. Да не истечёт он в самый неподходящий момент.');
      F.token = true;
      SFX.levelup();
      await say('', '🎫 Получен артефакт: Токен Доступа!');
    } else {
      await say('Дух Стековерфлоу',
        `${correct} из 3. Печально. Древние гневаются...`,
        'УЗРИ ЖЕ ЦЕНУ НЕВЕЖЕСТВА — ДЕДЛАЙН-ЖНЕЦА!');
      const res = await battle('reaper', { boss: true });
      if (res === 'win') {
        await say('Дух Стековерфлоу',
          'Хм. Знаний мало, но вайб... вайб сильный. В нашем деле это главное.',
          'Держи Токен. И почитай документацию. Хоть раз. Пожалуйста.');
        F.token = true;
        SFX.levelup();
        await say('', '🎫 Получен артефакт: Токен Доступа!');
      } else {
        await say('Дух Стековерфлоу', 'Возвращайся, когда наберёшься сил. Вопрос остаётся открытым.');
      }
    }
  },
};

// ============================================================
// 14. ОБЪЕКТЫ: ВЗАИМОДЕЙСТВИЕ
// ============================================================
async function useObject(o) {
  const F = G.flags;
  switch (o.kind) {
    case 'sign':
      await say('Табличка', o.text);
      break;
    case 'item': {
      addItem(o.item, o.qty);
      F['obj_' + o.id] = true;
      SFX.item();
      await say('', `📦 Найдено: ${ITEMS[o.item].name}${o.qty > 1 ? ' ×' + o.qty : ''}!`);
      break;
    }
    case 'mushroom': {
      if (!F.witchAsked) {
        await say('', 'Странный гриб. Светится и как будто что-то подсказывает. Пусть пока растёт.');
      } else {
        F.hasMushroom = true;
        F['obj_' + o.id] = true;
        SFX.item();
        await say('', '🍄 Сорван Светящийся Гриб Контекста! Он тихо шепчет: «уточни требования...». Неси его Ведьме.');
      }
      break;
    }
    case 'cat': {
      if (!F.catQuest) {
        await say('Серый кот', 'Мяу. (Кот смотрит сквозь тебя, как через прозрачный див.)');
      } else {
        F.catFound = true;
        F['obj_' + o.id] = true;
        SFX.confirm();
        await say('Кот Дебаггер', 'Мррря! (Кажется, он только что нашёл баг в тебе. Но согласен вернуться к Маше.)',
          '🐈 Кот Дебаггер отправился домой в деревню.');
      }
      break;
    }
    case 'gate': {
      if (hasArtifacts()) {
        await say('Ворота Продакшена',
          '⚙ СКАНИРОВАНИЕ АРТЕФАКТОВ...',
          '💎 Кристалл Промпта — ОК\n🔑 Ключ Мержа — ОК\n🎫 Токен Доступа — ОК',
          '✅ ДОСТУП РАЗРЕШЁН. ПАЙПЛАЙН «СУДНЫЙ ДЕПЛОЙ» ЗАПУЩЕН.',
          'Ворота с гулом раздвигаются. Сверху доносится недовольный рёв легаси-кода...');
        F.gateOpen = true;
        SFX.levelup();
      } else {
        await say('Ворота Продакшена',
          '⛔ 403 FORBIDDEN.',
          'Требуются: 💎 Кристалл Промпта, 🔑 Ключ Мержа, 🎫 Токен Доступа.',
          'Сеньор Валера в центре деревни подскажет, где их искать.');
      }
      break;
    }
    case 'cooler': {
      G.player.hp = G.player.maxHp;
      G.player.fp = G.player.maxFp;
      SFX.heal();
      await say('Кулер с водичкой',
        'Буль-буль. Легендарный офисный кулер. Возле него до сих пор витают духи смолл-токов.',
        '💧 HP и фокус полностью восстановлены!');
      break;
    }
    case 'boss': {
      if (o.enemy === 'conflict') {
        await say('???', '<<<<<<< HEAD\nЯ ГЛАВНАЯ ВЕТКА!\n=======\nНЕТ, Я ГЛАВНАЯ ВЕТКА!\n>>>>>>> feature/final-final-2',
          'Клубок из двух враждующих историй коммитов поднимается перед тобой!');
        const res = await battle('conflict', { boss: true });
        if (res === 'win') {
          F.conflictDown = true;
          F['obj_' + o.id] = true;
          await say('', '⚔️ Великий Мерж-Конфликт разрешён вручную! Расскажи об этом Мерж-Мастеру.');
        }
      } else if (o.enemy === 'demon') {
        await say('Демон Легаси',
          'КТО ПОСМЕЛ ВОЙТИ В ПРОДАКШЕН БЕЗ РЕВЬЮ?!',
          'Я — код, который никто не смеет трогать! 800 000 строк! Ни одного теста! Комментарии на трёх мёртвых языках!',
          'Джуны писали меня в спешке, мидлы боялись, сеньоры делали вид, что меня нет. Я — ВЕЧЕН!');
        await say('Джун', '...Я тебя не боюсь. Я тебя ОТРЕФАКТОРЮ.');
        const res = await battle('demon', { boss: true });
        if (res === 'win') {
          F['obj_' + o.id] = true;
          await finale();
        }
      }
      break;
    }
  }
}

async function finale() {
  G.flags.win = true;
  SFX.victory();
  await say('',
    'Демон Легаси распадается на аккуратные, покрытые тестами модули...',
    '✅ CI: PASSED\n✅ DEPLOY: SUCCESS\n✅ UPTIME: 100%',
    'Дашборды зеленеют. Где-то внизу деревня взрывается радостными уведомлениями.');
  await say('Демон Легаси (шёпотом)',
    '...спасибо. Я так устал быть монолитом...',
    'Теперь я — микросервисы. Прощай, вайб-кодер. Документируй меня... нежно.');
  saveGame();
  showEnding();
}

// ============================================================
// 15. ВЗАИМОДЕЙСТВИЕ В МИРЕ
// ============================================================
function interact() {
  const p = G.player;
  if (p.moving) return;
  const fx = p.x + DX[p.dir], fy = p.y + DY[p.dir];
  const npc = npcAt(G.map, fx, fy);
  if (npc) { runDialog(TALKS[npc.id]); return; }
  const o = objAt(G.map, fx, fy);
  if (o) { runDialog(() => useObject(o)); return; }
  // ворота — тайл 'G'
  if (tileAt(G.map, fx, fy) === 'G') {
    const gate = OBJECTS.find((g2) => g2.kind === 'gate');
    runDialog(() => useObject(gate));
  }
}

function updateExplore(dt) {
  const p = G.player;
  G.animT += dt;
  if (p.moving) {
    const speed = 0.11 * dt; // px за мс
    const txp = p.tx * TILE, typ = p.ty * TILE;
    p.px += Math.sign(txp - p.px) * Math.min(speed, Math.abs(txp - p.px));
    p.py += Math.sign(typ - p.py) * Math.min(speed, Math.abs(typ - p.py));
    p.walkT += dt;
    if (p.px === txp && p.py === typ) {
      p.x = p.tx; p.y = p.ty;
      p.moving = false;
      onArrive();
    }
  }
  if (!p.moving && G.mode === 'explore') {
    const d = heldDir();
    if (d) {
      p.dir = d;
      const nx = p.x + DX[d], ny = p.y + DY[d];
      if (nx >= 0 && ny >= 0 && nx < MAPS[G.map].w && ny < MAPS[G.map].h && !isSolidAt(G.map, nx, ny)) {
        p.tx = nx; p.ty = ny; p.moving = true;
      }
    }
  }
}

function onArrive() {
  const p = G.player;
  const m = MAPS[G.map];

  // подбор предметов «наступанием»
  const o = objAt(G.map, p.x, p.y);
  if (o && (o.kind === 'item' || o.kind === 'mushroom')) runDialog(() => useObject(o));

  // телепорты
  for (const t of m.teleports || []) {
    if (t.x === p.x && t.y === p.y && (!t.needFlag || G.flags[t.needFlag])) {
      G.map = t.to;
      p.x = t.tx; p.y = t.ty;
      p.px = t.tx * TILE; p.py = t.ty * TILE;
      p.moving = false;
      saveGame();
      toastZone(MAPS[t.to].name);
      return;
    }
  }

  // случайные бои
  G.steps++;
  const enc = m.encounters;
  const t = tileAt(G.map, p.x, p.y);
  if (enc && (t === '.' || t === ',') && chance(enc.rate) && G.mode === 'explore') {
    const pool = [];
    enc.list.forEach(([id, w]) => { for (let i = 0; i < w; i++) pool.push(id); });
    const id = pool[irnd(0, pool.length - 1)];
    battle(id);
  }
}

let zoneToast = null;
function toastZone(name) { zoneToast = { name, t: 2200 }; }

// ============================================================
// 16. БОЕВАЯ СИСТЕМА
// ============================================================
const battleUi = $('battle-ui'), battleLog = $('battle-log'), battleMenu = $('battle-menu');

function blog(text) { battleLog.textContent = text; }

function makeEnemy(id) {
  const base = ENEMIES[id];
  const boost = MAPS[G.map].boost || {};
  return {
    id, name: base.name, spr: base.spr,
    hp: Math.round(base.hp * (boost.hp || 1)),
    maxHp: Math.round(base.hp * (boost.hp || 1)),
    atk: Math.round(base.atk * (boost.atk || 1)),
    def: base.def,
    xp: Math.round(base.xp * (boost.xp || 1)),
    coins: Math.round(base.coins * (boost.coins || 1)),
    boss: !!base.boss, phases: !!base.phases, drain: !!base.drain, lazy: base.lazy || 0,
    stunned: false, healed: false, enraged: false,
    taunts: base.taunts || [],
  };
}

function dmgRoll(atk, def, mult = 1) {
  const crit = chance(0.1);
  let d = Math.max(1, Math.round(atk * mult * rnd(0.85, 1.15)) - def);
  if (crit) d = Math.round(d * 1.5);
  return { d, crit };
}

function battleChoice() {
  return new Promise((resolve) => {
    const p = G.player;
    battleMenu.innerHTML = '';
    const mkBtn = (html, fn, disabled) => {
      const b = document.createElement('button');
      b.innerHTML = html;
      b.disabled = !!disabled;
      b.addEventListener('click', () => { SFX.confirm(); fn(); });
      battleMenu.appendChild(b);
      return b;
    };
    const mainMenu = () => {
      battleMenu.innerHTML = '';
      mkBtn('⚡ Промпт<span class="sub">атака</span>', () => resolve({ type: 'skill', skill: SKILLS[0] }));
      mkBtn('✨ Скиллы', showSkills, knownSkills().length < 2);
      mkBtn('🎒 Предметы', showItems);
      mkBtn('☕ Кофе-брейк<span class="sub">+3 фокуса, защита</span>', () => resolve({ type: 'guard' }));
      mkBtn('🏃 Бежать', () => resolve({ type: 'flee' }), G.battle.enemy.boss);
    };
    const showSkills = () => {
      battleMenu.innerHTML = '';
      knownSkills().slice(1).forEach((s) => {
        mkBtn(`${s.name}<span class="sub">${s.fp} фокуса · ${s.desc}</span>`,
          () => resolve({ type: 'skill', skill: s }), p.fp < s.fp);
      });
      mkBtn('← Назад', mainMenu);
    };
    const showItems = () => {
      battleMenu.innerHTML = '';
      const usable = Object.keys(G.inv).filter((id) => G.inv[id] > 0);
      if (!usable.length) mkBtn('Пусто<span class="sub">рюкзак пуст</span>', mainMenu);
      usable.forEach((id) => {
        const dis = id === 'duck' && G.battle.enemy.boss;
        mkBtn(`${ITEMS[id].name} ×${G.inv[id]}<span class="sub">${ITEMS[id].desc}${dis ? ' · не на боссах' : ''}</span>`,
          () => resolve({ type: 'item', item: id }), dis);
      });
      mkBtn('← Назад', mainMenu);
    };
    mainMenu();
  });
}

async function battle(enemyId, opts = {}) {
  if (G.battle) return 'busy';
  const prevMode = G.mode;
  G.mode = 'battle';
  const enemy = makeEnemy(enemyId);
  G.battle = { enemy, guard: false, t: 0 };
  dlgEl.classList.add('hidden'); // бой мог начаться из диалога (боссы) — прячем окно
  battleUi.classList.remove('hidden');
  battleMenu.innerHTML = '';
  SFX.battle();
  G.shake = reduceMotion ? 0 : 300;

  blog(`${enemy.name} преграждает путь!`);
  await wait(900);
  if (enemy.taunts.length) {
    blog(enemy.taunts[irnd(0, enemy.taunts.length - 1)]);
    await wait(1300);
  }

  const p = G.player;
  let outcome = null;

  while (!outcome) {
    // ---- ход игрока ----
    blog('Твой ход. Что делаем?');
    const act = await battleChoice();
    battleMenu.innerHTML = '';
    G.battle.guard = false;

    if (act.type === 'flee') {
      if (chance(0.6)) {
        blog('Ты закрыл ноутбук и убежал. Классика.');
        await wait(900);
        outcome = 'flee';
        break;
      }
      blog('Сбежать не вышло — враг заслонил выход из IDE!');
      await wait(900);
    } else if (act.type === 'guard') {
      p.fp = Math.min(p.maxFp, p.fp + 3);
      G.battle.guard = true;
      SFX.heal();
      blog('☕ Кофе-брейк! +3 фокуса. Урон в этот ход снижен вдвое.');
      updateHud();
      await wait(900);
    } else if (act.type === 'item') {
      await useItemInBattle(act.item);
    } else if (act.type === 'skill') {
      const s = act.skill;
      p.fp -= s.fp;
      if (s.kind === 'heal') {
        const heal = Math.round(p.maxHp * s.mult);
        p.hp = Math.min(p.maxHp, p.hp + heal);
        SFX.heal();
        blog(`✨ Рефактор! Код чище, душа легче: +${heal} HP.`);
      } else {
        const { d, crit } = dmgRoll(p.atk, enemy.def, s.mult);
        enemy.hp = Math.max(0, enemy.hp - d);
        SFX.hit();
        G.battle.hitT = 250;
        addFloater(`-${d}`, crit ? '#ffd166' : '#fff');
        blog(`${s.name}! ${crit ? 'КРИТИЧЕСКИЙ ВАЙБ! ' : ''}Урон: ${d}.`);
        if (s.stun && chance(s.stun) && enemy.hp > 0) {
          enemy.stunned = true;
          await wait(800);
          blog(`${enemy.name} завис на брейкпоинте! Пропустит ход.`);
        }
      }
      updateHud();
      await wait(950);
    }

    if (enemy.hp <= 0) { outcome = 'win'; break; }

    // ---- фазы босса ----
    if (enemy.phases && !enemy.healed && enemy.hp < enemy.maxHp * 0.5) {
      enemy.healed = true;
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + 30);
      blog('Демон Легаси подключает джуна-стажёра! Тот в панике чинит его: +30 HP.');
      await wait(1300);
    }
    if (enemy.phases && !enemy.enraged && enemy.hp < enemy.maxHp * 0.3) {
      enemy.enraged = true;
      enemy.atk += 4;
      blog('Демон Легаси В ЯРОСТИ: «КТО УДАЛИЛ МОЙ ГЛОБАЛЬНЫЙ СТЕЙТ?!» Атака растёт!');
      await wait(1300);
    }

    // ---- ход врага ----
    if (enemy.stunned) {
      enemy.stunned = false;
      blog(`${enemy.name} висит на брейкпоинте и пропускает ход.`);
      await wait(950);
      continue;
    }
    if (enemy.lazy && chance(enemy.lazy)) {
      blog(`${enemy.name} отвлеклась на мемы про котиков. Ход пропущен!`);
      await wait(950);
      continue;
    }
    const { d, crit } = dmgRoll(enemy.atk, p.def, 1);
    let dealt = G.battle.guard ? Math.max(1, Math.round(d / 2)) : d;
    p.hp = Math.max(0, p.hp - dealt);
    SFX.hurt();
    if (!reduceMotion) G.shake = 220;
    blog(`${enemy.name} атакует! ${crit ? 'Крит! ' : ''}Урон: ${dealt}.`);
    if (enemy.drain && chance(0.5)) {
      const drain = Math.min(2, p.fp);
      if (drain > 0) {
        p.fp -= drain;
        await wait(800);
        blog(`Утечка высасывает фокус: -${drain}.`);
      }
    }
    updateHud();
    await wait(950);
    if (p.hp <= 0) { outcome = 'lose'; break; }
  }

  // ---- развязка ----
  if (outcome === 'win') {
    SFX.victory();
    blog(`${enemy.name} повержен!`);
    await wait(1000);
    p.coins += enemy.coins;
    p.xp += enemy.xp;
    blog(`+${enemy.xp} опыта, +${enemy.coins}₿.`);
    updateHud();
    await wait(1000);
    while (p.lvl < 10 && p.xp >= xpNext(p.lvl)) {
      p.xp -= xpNext(p.lvl);
      p.lvl++;
      p.maxHp += 7; p.maxFp += 3; p.atk += 2;
      if (p.lvl % 2 === 0) p.def += 1;
      p.hp = p.maxHp; p.fp = p.maxFp;
      SFX.levelup();
      blog(`🌟 УРОВЕНЬ ${p.lvl}! Характеристики выросли, HP и фокус восстановлены.`);
      updateHud();
      await wait(1200);
      const learned = SKILLS.find((s) => s.lvl === p.lvl);
      if (learned) {
        blog(`✨ Новый скилл: «${learned.name}» — ${learned.desc}!`);
        await wait(1300);
      }
    }
  } else if (outcome === 'lose') {
    SFX.defeat();
    blog('Ты выгорел... Экран гаснет.');
    await wait(1500);
  }

  battleUi.classList.add('hidden');
  G.battle = null;
  G.mode = prevMode === 'battle' ? 'explore' : prevMode;
  if (G.mode === 'battle') G.mode = 'explore';

  if (outcome === 'lose') {
    const p2 = G.player;
    p2.coins = Math.floor(p2.coins / 2);
    p2.hp = p2.maxHp; p2.fp = p2.maxFp;
    G.map = 'village';
    p2.x = 14; p2.y = 7; p2.px = 14 * TILE; p2.py = 7 * TILE; p2.moving = false;
    const wasDialog = G.mode;
    G.mode = 'dialog';
    await say('Сеньор Валера',
      'Очнулся? Ты выгорел прямо в бою. Мы нашли тебя лежащим на клавиатуре — на экране было 400 страниц буквы «ж».',
      'Половина байткоинов ушла на успокоительный раф. В следующий раз бери больше кофе.');
    closeDialog();
    G.mode = 'explore';
    void wasDialog;
  }
  updateHud();
  saveGame();
  return outcome;
}

async function useItemInBattle(id) {
  const p = G.player;
  G.inv[id]--;
  if (id === 'coffee') { p.hp = Math.min(p.maxHp, p.hp + 30); SFX.heal(); blog('☕ Кофе! +30 HP. Руки перестали дрожать. Почти.'); }
  else if (id === 'scoffee') { p.hp = Math.min(p.maxHp, p.hp + 70); SFX.heal(); blog('☕☕ Двойной эспрессо! +70 HP. Ты слышишь цвета.'); }
  else if (id === 'energy') { p.fp = Math.min(p.maxFp, p.fp + 10); SFX.heal(); blog('⚡ Энергетик! +10 фокуса. Дедлайн уже не кажется страшным.'); }
  else if (id === 'pizza') { p.hp = p.maxHp; p.fp = p.maxFp; SFX.heal(); blog('🍕 Пицца! Полное восстановление. Вкус победы и пепперони.'); }
  else if (id === 'duck') {
    SFX.confirm();
    blog('🦆 Ты объясняешь проблему уточке. Враг слушает, задумывается о жизни... Ты уходишь по-английски.');
    await wait(1400);
    G.battle.enemy.hp = -1; // маркер: бой заканчивается без награды
    G.battle.duckOut = true;
  }
  updateHud();
  await wait(950);
  // Уточка: помечаем как бегство
  if (G.battle && G.battle.duckOut) {
    G.battle.enemy.hp = 0;
    G.battle.enemy.xp = 0;
    G.battle.enemy.coins = 0;
  }
}

function addFloater(text, color) {
  G.floaters.push({ text, color, t: 900, y: 0 });
}

// ============================================================
// 17. МЕНЮ ПАУЗЫ
// ============================================================
const menuUi = $('menu-ui');

function openMenu() {
  if (G.mode !== 'explore') return;
  G.mode = 'menu';
  renderMenu();
  menuUi.classList.remove('hidden');
}
function closeMenu() {
  menuUi.classList.add('hidden');
  if (G.mode === 'menu') G.mode = 'explore';
}

function renderMenu() {
  const p = G.player, F = G.flags;
  $('menu-stats').innerHTML =
    `<b>Джун, вайб-кодер ${p.lvl} ур.</b> · опыт ${p.xp}/${xpNext(p.lvl)}<br>` +
    `❤ HP ${p.hp}/${p.maxHp} &nbsp; ✦ Фокус ${p.fp}/${p.maxFp}<br>` +
    `⚔ Атака ${p.atk} &nbsp; 🛡 Защита ${p.def} &nbsp; ₿ ${p.coins}<br>` +
    `📍 ${MAPS[G.map].name} · шагов: ${G.steps}<br>` +
    `Скиллы: ${knownSkills().map((s) => s.name).join(', ')}`;

  const quests = [];
  const q = (done, active, text) => quests.push(`<div class="${done ? 'q-done' : active ? 'q-active' : ''}">${done ? '✅' : active ? '▶' : '·'} ${text}</div>`);
  if (F.metSenior) {
    q(F.win, true, 'Поднять Продакшен: победить Демона Легаси в Башне.');
    q(F.crystal, F.witchAsked, '💎 Кристалл Промпта — Промпт-Ведьма в Лесу Легаси' + (F.witchAsked && !F.crystal ? ' (нужен гриб из юго-восточной чащи)' : ''));
    q(F.mergekey, true, '🔑 Ключ Мержа — победи Мерж-Конфликт в Пещере');
    q(F.token, true, '🎫 Токен Доступа — Дух Стековерфлоу на Болоте');
  } else {
    q(false, true, 'Поговорить с Сеньором Валерой в центре деревни.');
  }
  if (F.catQuest) q(F.catReturned, true, '🐈 Найти кота Дебаггера в Лесу Легаси');
  $('menu-quests').innerHTML = quests.join('');

  const itemsEl = $('menu-items');
  itemsEl.innerHTML = '';
  const ids = Object.keys(G.inv).filter((id) => G.inv[id] > 0);
  if (!ids.length) itemsEl.innerHTML = '<div class="item-row"><span>Рюкзак пуст. Бариста Гоша ждёт.</span></div>';
  ids.forEach((id) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    const canUse = id !== 'duck';
    row.innerHTML = `<span>${ITEMS[id].name} ×${G.inv[id]}<br><span class="i-desc">${ITEMS[id].desc}</span></span>`;
    const b = document.createElement('button');
    b.textContent = 'Использовать';
    b.disabled = !canUse;
    b.addEventListener('click', () => {
      const p2 = G.player;
      G.inv[id]--;
      if (id === 'coffee') p2.hp = Math.min(p2.maxHp, p2.hp + 30);
      if (id === 'scoffee') p2.hp = Math.min(p2.maxHp, p2.hp + 70);
      if (id === 'energy') p2.fp = Math.min(p2.maxFp, p2.fp + 10);
      if (id === 'pizza') { p2.hp = p2.maxHp; p2.fp = p2.maxFp; }
      SFX.heal();
      updateHud();
      renderMenu();
    });
    row.appendChild(b);
    itemsEl.appendChild(row);
  });

  $('btn-sound').textContent = muted ? '🔇 Звук: выкл' : '🔊 Звук: вкл';
}

$('btn-close-menu').addEventListener('click', closeMenu);
$('btn-menu').addEventListener('click', () => { audio(); if (G.mode === 'explore') openMenu(); else if (G.mode === 'menu') closeMenu(); });
$('btn-save').addEventListener('click', () => { SFX.confirm(); $('btn-save').textContent = saveGame() ? '💾 Сохранено!' : '💾 Ошибка'; setTimeout(() => { $('btn-save').textContent = '💾 Сохранить'; }, 1200); });
$('btn-load').addEventListener('click', () => { if (loadGame()) { SFX.confirm(); closeMenu(); updateHud(); } });
$('btn-sound').addEventListener('click', () => { muted = !muted; renderMenu(); if (!muted) SFX.confirm(); });
$('btn-title').addEventListener('click', () => { saveGame(); location.reload(); });

// ============================================================
// 18. HUD И ЭКРАНЫ
// ============================================================
function updateHud() {
  const p = G.player;
  if (!p) return;
  $('hud-lvl').textContent = `УР ${p.lvl}`;
  $('hud-hp').textContent = `❤ ${p.hp}/${p.maxHp}`;
  $('hud-fp').textContent = `✦ ${p.fp}/${p.maxFp}`;
  $('hud-coins').textContent = `₿ ${p.coins}`;
}

function showEnding() {
  const p = G.player;
  $('ending-stats').innerHTML =
    `Уровень героя: <b>${p.lvl}</b><br>` +
    `Шагов по Кодоземью: <b>${G.steps}</b><br>` +
    `Байткоинов в кармане: <b>${p.coins}₿</b><br><br>` +
    `Продакшен стоит. Легаси отрефакторено.<br>Вайб — восстановлен. 🌈`;
  $('ending-ui').classList.remove('hidden');
  G.mode = 'ending';
}
$('btn-ending-continue').addEventListener('click', () => {
  $('ending-ui').classList.add('hidden');
  G.mode = 'explore';
});

async function startNewGame() {
  G.player = newPlayer();
  G.flags = {};
  G.inv = { coffee: 2, duck: 1 };
  G.steps = 0;
  G.map = 'village';
  startPlay();
  G.mode = 'dialog';
  await say('',
    'КОДОЗЕМЬЕ. Мир, где программы давно никто не пишет руками — их выращивают вайбом, промптами и верой в лучшее.',
    'Ты — ДЖУН, начинающий вайб-кодер из деревни Гит-Хилл. Ты не знаешь, как работает код. Зато ты знаешь, ЧТО ЕМУ СКАЗАТЬ.',
    'Сегодня на рассвете упал Продакшен. Земля дрожит, дашборды кровоточат красным, а из Башни доносится рык древнего Легаси...',
    'Найди Сеньора Валеру в центре деревни. И да пребудет с тобой вайб.');
  closeDialog();
  G.mode = 'explore';
  saveGame();
}

function startPlay() {
  $('title-ui').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('btn-menu').classList.remove('hidden');
  $('touch-ui').classList.remove('hidden');
  G.mode = 'explore';
  updateHud();
  toastZone(MAPS[G.map].name);
}

$('btn-new').addEventListener('click', () => { audio(); SFX.confirm(); startNewGame(); });
$('btn-continue').addEventListener('click', () => {
  audio();
  if (loadGame()) { SFX.confirm(); startPlay(); }
});
if (hasSave()) $('btn-continue').classList.remove('hidden');

// ============================================================
// 19. РЕНДЕР
// ============================================================
function render(dt) {
  ctx.fillStyle = '#0d0b1e';
  ctx.fillRect(0, 0, VW, VH);
  if (G.mode === 'title') { renderTitleBg(); return; }
  if (!G.player) return;
  if (G.mode === 'battle' && G.battle) { renderBattle(dt); return; }
  renderWorld(dt);
}

function renderWorld(dt) {
  const m = MAPS[G.map];
  const p = G.player;
  const mw = m.w * TILE, mh = m.h * TILE;
  let shx = 0, shy = 0;
  if (G.shake > 0) { G.shake -= dt; shx = irnd(-2, 2); shy = irnd(-2, 2); }

  G.camX = clamp(p.px + 8 - VW / 2, 0, Math.max(0, mw - VW));
  G.camY = clamp(p.py + 8 - VH / 2, 0, Math.max(0, mh - VH));
  if (mw < VW) G.camX = (mw - VW) / 2;
  if (mh < VH) G.camY = (mh - VH) / 2;
  const cx = Math.round(G.camX) - shx, cy = Math.round(G.camY) - shy;

  const waterPhase = Math.floor(G.animT / 600) % 2;
  const x0 = Math.max(0, Math.floor(cx / TILE)), x1 = Math.min(m.w - 1, Math.ceil((cx + VW) / TILE));
  const y0 = Math.max(0, Math.floor(cy / TILE)), y1 = Math.min(m.h - 1, Math.ceil((cy + VH) / TILE));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ch = m.grid[y][x];
      let variant = Math.floor(hash2(x, y) * 4);
      if (ch === '~' || ch === 'S') variant = (variant + waterPhase) % 4;
      let drawCh = ch;
      if (ch === 'G' && G.flags.gateOpen) drawCh = '-';
      ctx.drawImage(tileSprite(m.theme, drawCh, variant), x * TILE - cx, y * TILE - cy);
    }
  }

  // объекты
  for (const o of OBJECTS) {
    if (o.map !== G.map || G.flags['obj_' + o.id] || !objVisible(o)) continue;
    const ox = o.x * TILE - cx, oy = o.y * TILE - cy;
    if (ox < -TILE || oy < -TILE || ox > VW || oy > VH) continue;
    drawObject(o, ox, oy);
  }

  // сущности по глубине
  const ents = [];
  for (const n of NPCS) {
    if (n.map !== G.map || !npcVisible(n)) continue;
    ents.push({ py: n.y * TILE, draw: () => {
      const bob = n.pal === 'spirit' && !reduceMotion ? Math.round(Math.sin(G.animT / 300) * 2) : 0;
      ctx.drawImage(humanSprite(n.pal, 'down', 0), n.x * TILE - cx, n.y * TILE - cy - 1 + bob);
    } });
  }
  const pframe = p.moving ? (Math.floor(p.walkT / 130) % 2) : 0;
  ents.push({ py: p.py, draw: () => {
    const flip = p.dir === 'left';
    const spr = humanSprite('player', p.dir === 'left' || p.dir === 'right' ? (flip ? 'left' : 'right') : p.dir, pframe);
    ctx.drawImage(spr, Math.round(p.px) - cx, Math.round(p.py) - cy - 1);
  } });
  ents.sort((a, b) => a.py - b.py).forEach((e) => e.draw());

  // название зоны
  if (zoneToast) {
    zoneToast.t -= dt;
    if (zoneToast.t <= 0) zoneToast = null;
    else {
      ctx.font = 'bold 10px monospace';
      const tw = ctx.measureText(zoneToast.name).width;
      ctx.fillStyle = 'rgba(13,11,30,0.85)';
      ctx.fillRect(VW / 2 - tw / 2 - 6, 8, tw + 12, 16);
      ctx.fillStyle = '#ffd166';
      ctx.fillText(zoneToast.name, VW / 2 - tw / 2, 19);
    }
  }
}

function drawObject(o, ox, oy) {
  const pulse = reduceMotion ? 0 : Math.sin(G.animT / 250);
  switch (o.kind) {
    case 'item': case 'mushroom': {
      const glow = o.kind === 'mushroom' ? '#6ef3c5' : '#ffd166';
      ctx.fillStyle = glow;
      const s = 3 + (pulse > 0 ? 1 : 0);
      ctx.fillRect(ox + 8 - s / 2, oy + 8 - s / 2, s, s);
      ctx.fillRect(ox + 7, oy + 3, 2, 2);
      ctx.fillRect(ox + 7, oy + 11, 2, 2);
      ctx.fillRect(ox + 3, oy + 7, 2, 2);
      ctx.fillRect(ox + 11, oy + 7, 2, 2);
      break;
    }
    case 'sign': {
      ctx.fillStyle = '#5c4327';
      ctx.fillRect(ox + 7, oy + 8, 2, 7);
      ctx.fillStyle = '#8a6a3f';
      ctx.fillRect(ox + 2, oy + 2, 12, 7);
      ctx.fillStyle = '#5c4327';
      ctx.fillRect(ox + 4, oy + 4, 8, 1);
      ctx.fillRect(ox + 4, oy + 6, 6, 1);
      break;
    }
    case 'cat': {
      ctx.drawImage(humanSprite('cat', 'down', Math.floor(G.animT / 500) % 2), ox, oy);
      break;
    }
    case 'cooler': {
      ctx.fillStyle = '#d8e4f0';
      ctx.fillRect(ox + 4, oy + 6, 8, 9);
      ctx.fillStyle = '#4ac6ff';
      ctx.fillRect(ox + 5, oy + 1, 6, 6);
      ctx.fillStyle = '#8bd9ff';
      ctx.fillRect(ox + 6, oy + 2, 2, 3);
      break;
    }
    case 'boss': {
      const spr = enemySprite(o.enemy);
      ctx.drawImage(spr, 0, 0, 16, 16, ox - 8, oy - 16 + (pulse > 0 ? 1 : 0), 32, 32);
      break;
    }
    case 'gate': break; // рисуется тайлом 'G'
  }
}

function renderBattle(dt) {
  const b = G.battle;
  b.t += dt;
  const m = MAPS[G.map];
  const T = THEMES[m.theme];

  // фон: полосы по теме зоны
  ctx.fillStyle = T.wallTop; ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = T.wall; ctx.fillRect(0, VH * 0.55, VW, VH);
  ctx.fillStyle = T.ground; ctx.fillRect(0, VH * 0.72, VW, VH);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 12; i++) {
    ctx.fillRect((i * 53 + 20) % VW, (i * 37 + 10) % Math.floor(VH * 0.5), 2, 2);
  }

  let shx = 0;
  if (G.shake > 0) { G.shake -= dt; shx = irnd(-3, 3); }

  // враг
  const e = b.enemy;
  const spr = enemySprite(e.spr);
  const eScale = Math.max(4, Math.floor(Math.min(VW, VH) / 40));
  const ew = 16 * eScale;
  const bob = reduceMotion ? 0 : Math.round(Math.sin(b.t / 350) * 3);
  const ex = Math.round(VW / 2 - ew / 2) + shx;
  const ey = Math.round(VH * 0.42 - ew / 2) + bob;
  if (b.hitT > 0) {
    b.hitT -= dt;
    if (Math.floor(b.hitT / 50) % 2) ctx.globalAlpha = 0.3;
  }
  ctx.drawImage(spr, 0, 0, 16, 16, ex, ey, ew, ew);
  ctx.globalAlpha = 1;

  // тень
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(ex + ew * 0.15, Math.round(VH * 0.42 + ew / 2) + 2, ew * 0.7, 4);

  // плашка врага (ниже HUD, высота которого зависит от экрана)
  const labelTop = Math.round(($('hud').offsetHeight + 14) / scale) + 4;
  ctx.font = 'bold 9px monospace';
  const label = e.name;
  const lw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(13,11,30,0.85)';
  ctx.fillRect(VW / 2 - lw / 2 - 6, labelTop, lw + 12, 24);
  ctx.fillStyle = e.boss ? '#ff5d8f' : '#f4f1ff';
  ctx.fillText(label, VW / 2 - lw / 2, labelTop + 9);
  // HP-бар врага
  const bw = Math.max(60, lw);
  ctx.fillStyle = '#3a3350';
  ctx.fillRect(VW / 2 - bw / 2, labelTop + 13, bw, 6);
  ctx.fillStyle = e.hp / e.maxHp > 0.3 ? '#2ee66b' : '#ff5d8f';
  ctx.fillRect(VW / 2 - bw / 2, labelTop + 13, Math.max(0, bw * e.hp / e.maxHp), 6);

  // всплывающий урон
  for (const f of G.floaters) {
    f.t -= dt; f.y -= dt * 0.03;
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = f.color;
    ctx.globalAlpha = clamp(f.t / 900, 0, 1);
    ctx.fillText(f.text, VW / 2 + 30, VH * 0.35 + f.y);
    ctx.globalAlpha = 1;
  }
  G.floaters = G.floaters.filter((f) => f.t > 0);
}

function renderTitleBg() {
  // глитч-сетка
  const t = performance.now();
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(hash2(i, 7) * VW);
    const y = (Math.floor(hash2(3, i) * VH) + (reduceMotion ? 0 : t / 80 + i * 13)) % VH;
    const cols = ['#7c4dff', '#6ef3c5', '#ff5d8f', '#ffd166'];
    ctx.fillStyle = cols[i % 4];
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;
}

// ============================================================
// 20. ГЛАВНЫЙ ЦИКЛ
// ============================================================
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(50, now - lastT);
  lastT = now;
  if (G.mode === 'explore' || G.mode === 'dialog') updateExplore(G.mode === 'explore' ? dt : 0);
  if (G.mode === 'dialog' && G.player && G.player.moving) {
    // доехать до тайла даже если диалог открылся в пути
    updateExplore(dt);
  }
  render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Отладочный доступ (используется смоук-тестом)
window.VC = { G, MAPS, NPCS, OBJECTS, ENEMIES, isSolidAt, tileAt, battle, saveGame, loadGame, startNewGame, say, closeDialog };

})();
