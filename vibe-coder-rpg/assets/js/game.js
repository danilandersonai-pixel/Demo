/* ============================================================
   Вайб-Кодер: Легенда Великого Релиза — движок.
   Один IIFE: спрайты, тайлы, карты, движение, диалоги,
   пошаговые бои, меню, сохранение. Без зависимостей.
   ============================================================ */
(() => {
'use strict';

/* ---------- утилиты ---------- */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const wait = ms => new Promise(r => setTimeout(r, ms));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const TILE = 16, VIEW_W = 240, VIEW_H = 320;
const GROUND_Y = 220; // линия земли на боевом экране
const canvas = $('screen');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

/* ============================================================
   СПРАЙТЫ
   ============================================================ */
const SPR = {};

function artToCanvas(rows, remap) {
  const h = rows.length, w = rows[0].length;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      let ch = row[x] || '.';
      if (remap && remap[ch]) ch = remap[ch];
      const col = PAL[ch];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function flipH(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.translate(src.width, 0); g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

function buildHuman(cfg) {
  const remap = { q: cfg.hair, Q: cfg.hairD, z: cfg.shirt, Z: cfg.shirtD, u: cfg.pants || 'K' };
  const down = artToCanvas(HUMAN_TPL.down, remap);
  const up = artToCanvas(HUMAN_TPL.up, remap);
  const right = artToCanvas(HUMAN_TPL.side, remap);
  return { down, up, right, left: flipH(right) };
}

function buildSprites() {
  for (const k in SPRITES) SPR[k] = artToCanvas(SPRITES[k]);
  SPR.player = buildHuman({ hair: 'h', hairD: 'H', shirt: 'b', shirtD: 'B', pants: 'K' });
}

/* ============================================================
   ТАЙЛЫ
   ============================================================ */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 2654435761;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

const TILE_PAINTERS = {
  '.': (g, px, py, x, y) => {
    g.fillStyle = '#3e8e50'; g.fillRect(px, py, 16, 16);
    for (let i = 0; i < 5; i++) {
      const r = hash2(x * 7 + i, y * 13 + i);
      g.fillStyle = r > 0.5 ? '#4aa25c' : '#357a44';
      g.fillRect(px + ((r * 97) | 0) % 15, py + ((r * 53) | 0) % 15, 1, 1);
    }
  },
  ',': (g, px, py, x, y) => {
    TILE_PAINTERS['.'](g, px, py, x, y);
    // три пучка травы: тёмное основание + светлая верхушка
    for (let i = 0; i < 3; i++) {
      const bx = px + 1 + i * 5 + ((hash2(x + i, y) * 3) | 0);
      const bh = 7 + ((hash2(x, y + i) * 5) | 0);
      g.fillStyle = '#2f6e3e';
      g.fillRect(bx, py + 16 - bh, 2, bh);
      g.fillRect(bx + 2, py + 16 - bh + 2, 1, bh - 2);
      g.fillStyle = '#5fae57';
      g.fillRect(bx, py + 16 - bh, 1, 2);
    }
  },
  'F': (g, px, py, x, y) => {
    TILE_PAINTERS['.'](g, px, py, x, y);
    const kinds = [['#f272c8', '#f6e26b'], ['#f6e26b', '#e88968'], ['#ece7db', '#f6e26b']];
    const [pet, cen] = kinds[(hash2(x, y) * 3) | 0];
    const fx = px + 3 + ((hash2(x, y) * 7) | 0), fy = py + 4 + ((hash2(y, x) * 6) | 0);
    g.fillStyle = pet;
    g.fillRect(fx - 1, fy, 1, 1); g.fillRect(fx + 1, fy, 1, 1);
    g.fillRect(fx, fy - 1, 1, 1); g.fillRect(fx, fy + 1, 1, 1);
    g.fillStyle = cen; g.fillRect(fx, fy, 1, 1);
    g.fillStyle = '#2f7d45'; g.fillRect(fx + 4, fy + 5, 2, 2);
  },
  't': (g, px, py, x, y) => {
    TILE_PAINTERS['.'](g, px, py, x, y);
    g.fillStyle = '#5f3c20'; g.fillRect(px + 6, py + 10, 4, 6);
    g.fillStyle = '#1f5c31';
    g.fillRect(px + 2, py + 3, 12, 9);
    g.fillRect(px + 4, py + 1, 8, 13);
    g.fillStyle = '#2f7d45';
    g.fillRect(px + 4, py + 2, 5, 3);
    g.fillRect(px + 3 + ((hash2(x, y) * 6) | 0), py + 6, 3, 2);
    g.fillStyle = '#174726'; g.fillRect(px + 9, py + 8, 4, 3);
  },
  'w': (g, px, py, x, y) => {
    g.fillStyle = '#2b5f9e'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#4f7de0';
    for (let i = 0; i < 3; i++) {
      const r = hash2(x + i * 3, y + i);
      g.fillRect(px + ((r * 23) | 0) % 11, py + 2 + i * 5, 4 + ((r * 7) | 0) % 3, 1);
    }
    g.fillStyle = '#1e4776'; g.fillRect(px + ((hash2(y, x) * 13) | 0) % 12, py + 9, 3, 1);
  },
  '=': (g, px, py) => {
    g.fillStyle = '#8a5a34'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#6f4526';
    g.fillRect(px, py + 4, 16, 1); g.fillRect(px, py + 9, 16, 1); g.fillRect(px, py + 14, 16, 1);
  },
  'p': (g, px, py, x, y) => {
    g.fillStyle = '#c9a35f'; g.fillRect(px, py, 16, 16);
    for (let i = 0; i < 4; i++) {
      const r = hash2(x * 3 + i, y * 5 - i);
      g.fillStyle = r > 0.5 ? '#b08a4a' : '#d9b877';
      g.fillRect(px + ((r * 89) | 0) % 14, py + ((r * 31) | 0) % 14, 2, 1);
    }
  },
  '#': (g, px, py, x, y) => {
    g.fillStyle = '#6e7488'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#565b70'; g.fillRect(px, py + 12, 16, 4);
    g.fillStyle = '#8a92a8'; g.fillRect(px + 2, py + 2, 6, 3);
    g.fillStyle = '#454a5c'; g.fillRect(px + ((hash2(x, y) * 9) | 0), py + 7, 5, 2);
  },
  'b': (g, px, py, x, y) => {
    g.fillStyle = '#a06a3e'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#7c4e28';
    for (let ry = 0; ry < 4; ry++) {
      g.fillRect(px, py + ry * 4 + 3, 16, 1);
      const off = ry % 2 ? 4 : 0;
      for (let bx = off; bx < 16; bx += 8) g.fillRect(px + bx, py + ry * 4, 1, 3);
    }
    g.fillStyle = '#b87f4e'; g.fillRect(px + 1 + ((hash2(x, y) * 7) | 0) % 7, py + 1, 3, 1);
  },
  'r': (g, px, py, x, y) => {
    g.fillStyle = '#2f9d9d'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#267f7f';
    for (let ry = 0; ry < 4; ry++) {
      g.fillRect(px, py + ry * 4 + 3, 16, 1);
      const off = ry % 2 ? 4 : 0;
      for (let bx = off; bx < 16; bx += 8) g.fillRect(px + bx, py + ry * 4 + 1, 1, 2);
    }
    g.fillStyle = '#54d6d6'; g.fillRect(px + ((hash2(x, y) * 11) | 0) % 12, py, 4, 1);
  },
  'd': (g, px, py, x, y) => {
    TILE_PAINTERS['b'](g, px, py, x, y);
    g.fillStyle = '#5f3c20'; g.fillRect(px + 3, py + 3, 10, 13);
    g.fillStyle = '#7a5230'; g.fillRect(px + 4, py + 4, 8, 11);
    g.fillStyle = '#f2d54d'; g.fillRect(px + 11, py + 9, 1, 2);
  },
  'T': (g, px, py, x, y) => {
    g.fillStyle = '#232637'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#3a3f52'; g.fillRect(px + 1, py + 1, 14, 1); g.fillRect(px + 1, py + 1, 1, 14);
    g.fillStyle = '#101019'; g.fillRect(px + 3, py + 4, 10, 8);
    g.fillStyle = '#7de3a0';
    const n = 2 + ((hash2(x, y) * 3) | 0);
    for (let i = 0; i < n; i++) g.fillRect(px + 4, py + 5 + i * 2, 3 + ((hash2(x + i, y) * 6) | 0), 1);
  },
  'C': (g, px, py, x, y) => {
    g.fillStyle = '#2a2138'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#3a2f52'; g.fillRect(px + 1 + ((hash2(x, y) * 8) | 0) % 8, py + 2, 5, 3);
    g.fillStyle = '#1c1628'; g.fillRect(px + ((hash2(y, x) * 12) | 0) % 10, py + 8, 6, 3);
    g.fillStyle = '#181224'; g.fillRect(px, py + 14, 16, 2);
  },
  'c': (g, px, py, x, y) => {
    g.fillStyle = '#453a5e'; g.fillRect(px, py, 16, 16);
    for (let i = 0; i < 4; i++) {
      const r = hash2(x * 5 + i, y * 3 + i);
      g.fillStyle = r > 0.5 ? '#3a3050' : '#524670';
      g.fillRect(px + ((r * 71) | 0) % 14, py + ((r * 37) | 0) % 14, 2, 1);
    }
  },
  ';': (g, px, py, x, y) => {
    TILE_PAINTERS['c'](g, px, py, x, y);
    g.fillStyle = '#2c2440';
    for (let i = 0; i < 4; i++) {
      const r = hash2(x + i * 2, y - i);
      g.fillRect(px + 1 + ((r * 61) | 0) % 12, py + 1 + ((r * 43) | 0) % 12, 2, 2);
    }
    g.fillStyle = '#6a5c8e'; g.fillRect(px + ((hash2(x, y) * 13) | 0) % 13, py + 5, 1, 1);
  },
  'P': (g, px, py, x, y) => {
    g.fillStyle = '#4a5266'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#3a4152';
    g.fillRect(px, py + 15, 16, 1); g.fillRect(px + 15, py, 1, 16);
    g.fillStyle = '#565f76'; g.fillRect(px, py, 16, 1);
    if (hash2(x, y) > 0.85) { g.fillStyle = '#3a4152'; g.fillRect(px + 5, py + 5, 5, 5); g.fillStyle = '#565f76'; g.fillRect(px + 6, py + 6, 3, 3); }
  },
  'S': (g, px, py, x, y) => {
    g.fillStyle = '#1d2334'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#12172400'; // прозрачный сток, не используется
    g.fillStyle = '#2a3248';
    for (let ry = 0; ry < 4; ry++) g.fillRect(px + 2, py + 2 + ry * 4, 12, 2);
    const leds = ['#49b866', '#54d6d6', '#e04f4f', '#f2d54d'];
    for (let ry = 0; ry < 4; ry++) {
      const r = hash2(x * 3 + ry, y * 7 + ry);
      g.fillStyle = leds[(r * leds.length) | 0];
      g.fillRect(px + 3 + ((r * 17) | 0) % 9, py + 2 + ry * 4, 1, 1);
    }
  },
  '~': (g, px, py, x, y) => {
    g.fillStyle = '#101a2e'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#54d6d6';
    for (let i = 0; i < 3; i++) {
      const r = hash2(x + i, y * 2 + i);
      g.fillRect(px + 2 + i * 5, py + ((r * 29) | 0) % 10, 1, 4 + ((r * 5) | 0));
    }
    g.fillStyle = '#2f9d9d'; g.fillRect(px + ((hash2(y, x) * 11) | 0) % 14, py + 12, 1, 3);
  },
  'f': (g, px, py, x, y) => {
    g.fillStyle = '#8a5a34'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#6f4526';
    g.fillRect(px, py + 7, 16, 1); g.fillRect(px, py + 15, 16, 1);
    g.fillRect(px + (y % 2 ? 4 : 10), py, 1, 7); g.fillRect(px + (y % 2 ? 12 : 6), py + 8, 1, 7);
    g.fillStyle = '#9c6a40'; g.fillRect(px + ((hash2(x, y) * 13) | 0) % 13, py + 2, 3, 1);
  },
  'x': (g, px, py) => { g.fillStyle = '#05060a'; g.fillRect(px, py, 16, 16); },
};

/* ---------- пререндер карт ---------- */
const mapCache = {};
function renderMap(name) {
  if (mapCache[name]) return mapCache[name];
  const m = MAPS[name];
  const w = m.rows[0].length;
  m.rows = m.rows.map(r => (r + m.pad.repeat(w)).slice(0, w)); // нормализация ширины
  const c = document.createElement('canvas');
  c.width = w * TILE; c.height = m.rows.length * TILE;
  const g = c.getContext('2d');
  for (let y = 0; y < m.rows.length; y++)
    for (let x = 0; x < w; x++) {
      const ch = m.rows[y][x];
      (TILE_PAINTERS[ch] || TILE_PAINTERS['.'])(g, x * TILE, y * TILE, x, y);
    }
  mapCache[name] = c;
  return c;
}

const tileAt = (m, x, y) => (m.rows[y] && m.rows[y][x]) || m.pad;
const isSolidTile = (m, x, y) => SOLID_TILES.has(tileAt(m, x, y));

/* ============================================================
   СОСТОЯНИЕ
   ============================================================ */
const SAVE_KEY = 'vibe-coder-save-v1';

function defaultState() {
  return {
    state: 'title',
    map: 'village', px: 4, py: 6, dir: 'down',
    lvl: 1, xp: 0,
    hp: 40, maxhp: 40, en: 20, maxen: 20,
    atk: 7, def: 2,
    coins: 20,
    items: { coffee: 2 },
    flags: {},
    story: 0,
    steps: 0,
    mute: false,
  };
}

window.G = defaultState();

function save() {
  try {
    const { state, ...data } = G;
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) { /* приватный режим — играем без сейвов */ }
}
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
function load() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!data) return false;
    Object.assign(G, defaultState(), data, { state: 'explore' });
    return true;
  } catch (e) { return false; }
}

const pAtk = () => G.atk + (G.items.keyboard ? 3 : 0);
const pDef = () => G.def + (G.items.hoodie ? 2 : 0);
const xpNeed = () => G.lvl * 30;

/* ============================================================
   ЗВУК (WebAudio-бипы)
   ============================================================ */
let AC = null;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
function beep(freq, dur, type = 'square', vol = 0.05, when = 0) {
  if (G.mute) return;
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime + when;
  const o = ac.createOscillator(), gn = ac.createGain();
  o.type = type; o.frequency.value = freq;
  gn.gain.setValueAtTime(vol, t);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gn).connect(ac.destination);
  o.start(t); o.stop(t + dur);
}
function sfx(name) {
  switch (name) {
    case 'talk': beep(620, 0.05, 'square', 0.03); break;
    case 'confirm': beep(520, 0.07); beep(780, 0.09, 'square', 0.05, 0.07); break;
    case 'hit': beep(180, 0.1, 'sawtooth', 0.07); beep(120, 0.12, 'sawtooth', 0.06, 0.05); break;
    case 'hurt': beep(140, 0.18, 'sawtooth', 0.08); break;
    case 'heal': beep(660, 0.08, 'triangle', 0.06); beep(880, 0.12, 'triangle', 0.06, 0.08); break;
    case 'stun': beep(980, 0.05, 'square', 0.05); beep(740, 0.05, 'square', 0.05, 0.06); beep(980, 0.08, 'square', 0.05, 0.12); break;
    case 'fanfare':
      [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.14, 'square', 0.06, i * 0.11));
      break;
    case 'lose': [392, 330, 262, 196].forEach((f, i) => beep(f, 0.2, 'triangle', 0.07, i * 0.18)); break;
    case 'step': beep(240, 0.03, 'triangle', 0.015); break;
    case 'pickup': beep(880, 0.06, 'triangle', 0.05); beep(1320, 0.1, 'triangle', 0.05, 0.06); break;
  }
}

/* ============================================================
   HUD / уведомления
   ============================================================ */
function updateHUD() {
  $('hud-lvl').textContent = 'LV ' + G.lvl;
  $('hud-coins').textContent = G.coins;
  $('hud-hp').style.transform = `scaleX(${clamp(G.hp / G.maxhp, 0, 1)})`;
  $('hud-en').style.transform = `scaleX(${clamp(G.en / G.maxen, 0, 1)})`;
}

function toast(text, ms = 2600) {
  const d = document.createElement('div');
  d.className = 'dmg-float';
  d.style.cssText = 'left:50%;top:16%;transform:translateX(-50%);font-size:14px;animation-duration:' + (ms / 1000) + 's;max-width:88vw;text-align:center;';
  d.textContent = text;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), ms);
}

function floatText(text, xPct, yPct, cls = '') {
  const r = canvas.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = 'dmg-float ' + cls;
  d.style.left = (r.left + r.width * xPct) + 'px';
  d.style.top = (r.top + r.height * yPct) + 'px';
  d.textContent = text;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 850);
}

/* ============================================================
   ДИАЛОГИ
   ============================================================ */
let advanceFn = null;
let typing = null;

function say(name, text) {
  return new Promise(res => {
    const prev = G.state;
    G.state = 'dialog';
    $('dialog').hidden = false;
    $('dlg-name').textContent = name || '';
    const el = $('dlg-text');
    el.textContent = '';
    let i = 0, done = false;
    const full = String(text);
    if (reduceMotion) { el.textContent = full; done = true; }
    else {
      typing = setInterval(() => {
        i += 2;
        el.textContent = full.slice(0, i);
        if (i % 6 === 0) sfx('talk');
        if (i >= full.length) { clearInterval(typing); typing = null; done = true; }
      }, 18);
    }
    advanceFn = () => {
      if (!done) { if (typing) clearInterval(typing); typing = null; el.textContent = full; done = true; return; }
      advanceFn = null;
      $('dialog').hidden = true;
      G.state = prev === 'battle' ? 'battle' : 'dialog';
      sfx('confirm');
      res();
    };
  });
}

function choice(title, options) {
  return new Promise(res => {
    const prev = G.state;
    G.state = 'dialog';
    $('dialog').hidden = false;
    $('dlg-name').textContent = '';
    $('dlg-text').textContent = title;
    $('dlg-hint').style.visibility = 'hidden';
    const box = $('choices');
    box.innerHTML = '';
    box.hidden = false;
    options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.textContent = opt;
      b.onclick = () => {
        box.hidden = true;
        $('dialog').hidden = true;
        $('dlg-hint').style.visibility = '';
        G.state = prev === 'battle' ? 'battle' : 'dialog';
        sfx('confirm');
        res(i);
      };
      box.appendChild(b);
    });
  });
}

/* ============================================================
   ПРЕДМЕТЫ / ЭКОНОМИКА
   ============================================================ */
const has = id => (G.items[id] || 0) > 0;
const give = (id, n = 1) => { G.items[id] = (G.items[id] || 0) + n; updateHUD(); };
const take = (id, n = 1) => { G.items[id] = Math.max(0, (G.items[id] || 0) - n); if (!G.items[id]) delete G.items[id]; };
const coins = n => { G.coins = Math.max(0, G.coins + n); updateHUD(); };

async function buy(id, price) {
  if (G.coins < price) {
    await say('', `Не хватает монет: нужно ${price} ☕, у тебя ${G.coins} ☕. Побеждай багов — они осыпаются кофе.`);
    return false;
  }
  coins(-price);
  give(id, 1);
  sfx('pickup');
  await say('', `Куплено: ${ITEMS[id].name}!`);
  return true;
}

function useItem(id) {
  const it = ITEMS[id];
  if (!it || !it.usable || !has(id)) return false;
  if (it.hp) { G.hp = Math.min(G.maxhp, G.hp + it.hp); }
  if (it.en) { G.en = Math.min(G.maxen, G.en + it.en); }
  take(id, 1);
  sfx('heal');
  updateHUD();
  return true;
}

/* ============================================================
   КАРТА / СУЩНОСТИ
   ============================================================ */
let ents = [];

function buildEnts() {
  ents = NPCS.filter(n => n.map === G.map).map(def => {
    let sprites = null;
    if (def.human) sprites = buildHuman({ hair: def.human.hair, hairD: def.human.hairD, shirt: def.human.shirt, shirtD: def.human.shirtD, pants: def.human.pants });
    return { def, x: def.x, y: def.y, sprites };
  });
}
const entVisible = e => !(e.def.hidden && e.def.hidden()) && !(e.def.pickup && G.flags[e.def.flag]);
const entAt = (x, y) => ents.find(e => e.x === x && e.y === y && entVisible(e) && !e.def.pickup);

const fade = on => new Promise(res => {
  $('fade').classList.toggle('on', on);
  setTimeout(res, reduceMotion ? 60 : 380);
});

async function loadMap(name, x, y, { skipEvent } = {}) {
  await fade(true);
  G.map = name; G.px = x; G.py = y;
  moveAnim = null;
  renderMap(name);
  buildEnts();
  save();
  toast(MAPS[name].name, 1800);
  await fade(false);
  if (!skipEvent && MAP_EVENTS[name]) { await MAP_EVENTS[name](); endDialog(); }
}

function endDialog() {
  if (G.state === 'dialog') G.state = 'explore';
  $('dialog').hidden = true;
  $('choices').hidden = true;
}

/* ============================================================
   ДВИЖЕНИЕ
   ============================================================ */
const input = { up: false, down: false, left: false, right: false };
let moveAnim = null; // {fx,fy,tx,ty,t}
let stepsSinceBattle = 0;

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function tryMove(dir) {
  G.dir = dir;
  const m = MAPS[G.map];
  const [dx, dy] = DIRS[dir];
  const nx = G.px + dx, ny = G.py + dy;
  const portal = m.portals.find(p => p.x === nx && p.y === ny);
  if (isSolidTile(m, nx, ny) || entAt(nx, ny)) {
    if (portal) usePortal(portal); // дверь: портал в сплошном тайле
    return;
  }
  if (nx < 0 || ny < 0 || nx >= m.rows[0].length || ny >= m.rows.length) {
    if (portal) usePortal(portal);
    return;
  }
  moveAnim = { fx: G.px, fy: G.py, t: 0 };
  G.px = nx; G.py = ny;
}

async function usePortal(p) {
  if (G.state !== 'explore') return;
  if (p.needs && !has(p.needs)) {
    G.state = 'dialog';
    await say('', p.deniedMsg || 'Закрыто.');
    endDialog();
    return;
  }
  G.state = 'transit';
  await loadMap(p.to, p.tx, p.ty);
  if (G.state === 'transit') G.state = 'explore';
}

async function onArrive() {
  const m = MAPS[G.map];
  sfx('step');
  G.steps++;
  // подбор предметов
  const pick = ents.find(e => e.def.pickup && e.x === G.px && e.y === G.py && !G.flags[e.def.flag]);
  if (pick) {
    G.flags[pick.def.flag] = true;
    give(pick.def.pickup, 1);
    sfx('pickup');
    floatText('+ ' + ITEMS[pick.def.pickup].name, 0.5, 0.4, 'heal');
  }
  // порталы
  const portal = m.portals.find(p => p.x === G.px && p.y === G.py);
  if (portal) { usePortal(portal); return; }
  // случайные бои
  stepsSinceBattle++;
  if (m.encounters.length && ENCOUNTER_TILES.has(tileAt(m, G.px, G.py))
    && stepsSinceBattle > 5 && Math.random() < 0.13) {
    stepsSinceBattle = 0;
    const id = m.encounters[ri(0, m.encounters.length - 1)];
    await battle(id);
  }
}

function facingTile() {
  const [dx, dy] = DIRS[G.dir];
  return [G.px + dx, G.py + dy];
}

async function interact() {
  const [fx, fy] = facingTile();
  const e = entAt(fx, fy);
  if (!e || !e.def.talk) return;
  G.state = 'dialog';
  try {
    await e.def.talk();
  } finally {
    endDialog();
    updateHUD();
    save();
    if (G.state === 'dialog') G.state = 'explore';
  }
}

async function loseGame() {
  sfx('lose');
  G.state = 'dialog';
  await say('Клод', 'Джун! Ты словил сегфолт… Ничего. Я откатил тебя до последнего стабильного билда. С кем не бывает — у меня вот однажды весь контекст переполнился.');
  G.hp = Math.max(1, Math.round(G.maxhp / 2));
  G.en = G.maxen;
  updateHUD();
  await loadMap('village', 4, 6, { skipEvent: true });
  G.state = 'explore';
}

/* ============================================================
   БОЙ
   ============================================================ */
let B = null;

function bmsg(text) { $('b-log').textContent = text; }
const dmgRoll = (atk, mult, def) => Math.max(1, Math.round(atk * mult - def + ri(-2, 2)));

function battle(enemyId, opts = {}) {
  return new Promise(resolve => {
    const base = ENEMIES[enemyId];
    B = {
      e: { ...base, name: opts.name || base.name },
      ehp: base.hp, emax: base.hp,
      stun: false, shake: 0, blink: 0, bob: 0,
      over: false,
      resolve: r => {
        B = null; $('battle-ui').hidden = true; $('controls').hidden = false; G.state = 'explore';
        // поражение обрабатываем централизованно: откат в деревню
        if (r === 'lose') loseGame().then(() => resolve(r));
        else resolve(r);
      },
    };
    G.state = 'battle';
    $('dialog').hidden = true;
    $('controls').hidden = true; // в бою — только боевые кнопки
    $('battle-ui').hidden = false;
    $('b-ename').textContent = B.e.name;
    updateEnemyBar();
    sfx('hit');
    bmsg(B.e.boss ? `${B.e.name} преграждает путь!` : `Дикий ${B.e.name} атакует!`);
    playerMenu();
  });
}

function updateEnemyBar() {
  $('b-ehp').style.transform = `scaleX(${clamp(B.ehp / B.emax, 0, 1)})`;
}

function battleButtons(list) {
  const menu = $('b-menu');
  menu.innerHTML = '';
  list.forEach(it => {
    const b = document.createElement('button');
    b.innerHTML = it.label + (it.sub ? `<small>${it.sub}</small>` : '');
    b.disabled = !!it.disabled;
    b.onclick = () => { menu.innerHTML = ''; it.act(); };
    menu.appendChild(b);
  });
}

function playerMenu() {
  if (!B) return;
  const btns = [];
  for (const s of SKILLS) {
    if (s.needsClaude && G.story < 2) continue;
    btns.push({
      label: s.name,
      sub: (s.en ? `EN ${s.en} · ` : '') + s.desc,
      disabled: G.en < s.en,
      act: () => playerAttack(s),
    });
  }
  btns.push({
    label: `Кофе ×${G.items.coffee || 0}`, sub: '+35 HP',
    disabled: !has('coffee') || G.hp >= G.maxhp,
    act: () => playerItem('coffee'),
  });
  btns.push({
    label: `Энергетик ×${G.items.energy || 0}`, sub: '+20 EN',
    disabled: !has('energy') || G.en >= G.maxen,
    act: () => playerItem('energy'),
  });
  btns.push({ label: 'Ctrl+C (сбежать)', sub: B.e.boss ? 'от босса не сбежать' : 'шанс 60%', disabled: !!B.e.boss, act: playerFlee });
  battleButtons(btns);
}

async function playerAttack(s) {
  if (!B) return;
  G.en -= s.en; updateHUD();
  const lines = {
    prompt: 'Джун формулирует предельно точный промпт!',
    debug: 'Джун ставит брейкпоинт прямо на враге!',
    refactor: 'Джун проводит безжалостный рефакторинг!',
    vibe: 'Клод: «Отличный запрос!» — и генерирует решение!',
  };
  bmsg(lines[s.id] || 'Атака!');
  await wait(550);
  const dmg = dmgRoll(pAtk(), s.mult, B.e.def);
  B.ehp = Math.max(0, B.ehp - dmg);
  B.shake = reduceMotion ? 0 : 380; B.blink = 380;
  sfx('hit');
  floatText('-' + dmg, 0.5, 0.28, 'hurt');
  updateEnemyBar();
  await wait(520);
  if (B.ehp <= 0) return victory();
  const duckStun = G.items.duck ? 0.6 : (s.stun || 0);
  if (s.stun && Math.random() < duckStun) {
    B.stun = true;
    sfx('stun');
    bmsg(`${B.e.name} оглушён и пропускает ход!`);
    await wait(750);
    return playerMenu();
  }
  enemyTurn();
}

async function playerItem(id) {
  if (!B) return;
  useItem(id);
  bmsg(id === 'coffee' ? 'Джун залпом выпивает кофе. Мир становится чётче!' : 'Джун открывает энергетик. Слышно, как искрится мана!');
  floatText(id === 'coffee' ? '+HP' : '+EN', 0.2, 0.75, 'heal');
  await wait(700);
  enemyTurn();
}

async function playerFlee() {
  if (!B) return;
  bmsg('Джун жмёт Ctrl+C…');
  await wait(600);
  if (Math.random() < 0.6) {
    bmsg('Процесс прерван! Побег удался.');
    sfx('confirm');
    await wait(650);
    return B.resolve('flee');
  }
  bmsg('Процесс завис и не прерывается!');
  await wait(650);
  enemyTurn();
}

async function enemyTurn() {
  if (!B) return;
  if (B.stun) { B.stun = false; return playerMenu(); }
  // Прокрастинация иногда прокрастинирует
  if (B.e.spr === 'sloth' && Math.random() < 0.25) {
    bmsg('Прокрастинация решила атаковать позже. Может, завтра.');
    await wait(750);
    return playerMenu();
  }
  const line = B.e.lines[ri(0, B.e.lines.length - 1)];
  bmsg(line);
  await wait(650);
  const enraged = B.e.boss && B.ehp < B.emax * 0.3;
  const dmg = dmgRoll(B.e.atk * (enraged ? 1.3 : 1), 1, pDef());
  G.hp = Math.max(0, G.hp - dmg);
  sfx('hurt');
  if (!reduceMotion) hurtFlash = 240;
  floatText('-' + dmg, 0.2, 0.75, 'hurt');
  updateHUD();
  bmsg(enraged ? `ЯРОСТЬ! ${B.e.name} наносит ${dmg} урона!` : `${B.e.name} наносит ${dmg} урона!`);
  await wait(720);
  if (G.hp <= 0) {
    bmsg('Джун падает… экран заливает синим…');
    await wait(900);
    return B.resolve('lose');
  }
  playerMenu();
}

async function victory() {
  if (!B) return;
  const e = B.e;
  sfx('fanfare');
  bmsg(`${e.name} повержен! +${e.xp} XP, +${e.coins} ☕`);
  G.xp += e.xp;
  coins(e.coins);
  await wait(1100);
  while (G.xp >= xpNeed()) {
    G.xp -= xpNeed();
    G.lvl++;
    G.maxhp += 8; G.maxen += 4; G.atk += 2; G.def += 1;
    G.hp = G.maxhp; G.en = G.maxen;
    sfx('fanfare');
    updateHUD();
    bmsg(`УРОВЕНЬ ${G.lvl}! Джун чувствует, как растёт сеньорность. HP/EN восстановлены!`);
    await wait(1300);
  }
  save();
  B.resolve('win');
}

/* ============================================================
   МЕНЮ ПАУЗЫ
   ============================================================ */
function openMenu() {
  if (G.state !== 'explore') return;
  G.state = 'menu';
  $('menu').hidden = false;
  $('menu-quest').innerHTML = `<b>ЗАДАЧА:</b> ${QUEST_HINTS[Math.min(G.story, QUEST_HINTS.length - 1)]}`;
  $('menu-stats').innerHTML =
    `<b>Джун</b> — вайб-кодер ур. ${G.lvl}<br>` +
    `HP ${G.hp}/${G.maxhp} · EN ${G.en}/${G.maxen}<br>` +
    `АТК ${pAtk()} · ЗАЩ ${pDef()} · XP ${G.xp}/${xpNeed()}<br>` +
    `Монеты: ${G.coins} ☕ · Локация: ${MAPS[G.map].name}`;
  const box = $('menu-items');
  box.innerHTML = '';
  const keys = Object.keys(G.items);
  if (!keys.length) box.innerHTML = '<div class="item-row"><div class="item-info"><span class="item-desc">Рюкзак пуст. Даже стикеров нет.</span></div></div>';
  for (const id of keys) {
    const it = ITEMS[id]; if (!it) continue;
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `<div class="item-info"><span class="item-name">${it.name} ×${G.items[id]}</span><br><span class="item-desc">${it.desc}</span></div>`;
    if (it.usable) {
      const b = document.createElement('button');
      b.textContent = 'Исп.';
      b.onclick = () => { if (useItem(id)) openMenuRefresh(); };
      row.appendChild(b);
    }
    box.appendChild(row);
  }
  const btns = $('menu-btns');
  btns.innerHTML = '';
  const mk = (label, act) => {
    const b = document.createElement('button');
    b.textContent = label; b.onclick = act; btns.appendChild(b);
  };
  mk('▶ Продолжить', closeMenu);
  mk('💾 Сохранить', () => { save(); sfx('confirm'); toast('Сохранено! git push успешен.'); });
  mk(G.mute ? '🔇 Звук: выкл' : '🔊 Звук: вкл', () => { G.mute = !G.mute; save(); openMenuRefresh(); });
  mk('🏠 В главное меню', () => { save(); closeMenu(); showTitle(); });
}
function openMenuRefresh() { G.state = 'explore'; openMenu(); }
function closeMenu() { $('menu').hidden = true; if (G.state === 'menu') G.state = 'explore'; }

/* ============================================================
   ТИТУЛ / ИНТРО / ФИНАЛ
   ============================================================ */
function showTitle() {
  G.state = 'title';
  $('title').hidden = false;
  $('hud').hidden = true;
  $('controls').hidden = true;
  const btns = $('title-btns');
  btns.innerHTML = '';
  const mk = (label, act) => {
    const b = document.createElement('button');
    b.textContent = label; b.onclick = act; btns.appendChild(b);
  };
  if (hasSave()) mk('▶ ПРОДОЛЖИТЬ', () => { audio(); if (load()) startPlay(false); });
  mk('★ НОВАЯ ИГРА', () => { audio(); newGame(); });
}

async function startPlay(isNew) {
  $('title').hidden = true;
  $('hud').hidden = false;
  $('controls').hidden = false;
  updateHUD();
  renderMap(G.map);
  buildEnts();
  G.state = 'explore';
  if (isNew) {
    G.state = 'dialog';
    for (const page of INTRO_PAGES) await say('', page);
    endDialog();
    toast('Задача: ' + QUEST_HINTS[0], 3500);
  }
}

function newGame() {
  const mute = G.mute;
  window.G = Object.assign(defaultState(), { mute });
  G.state = 'explore';
  startPlay(true);
}

function quest(text) { toast('📌 ' + text, 3400); }

let confetti = [];
async function endGame() {
  endDialog();
  await fade(true);
  G.state = 'ending';
  $('battle-ui').hidden = true;
  await fade(false);
  for (const page of ENDING_PAGES) { await say('', page); G.state = 'ending'; }
  if (!reduceMotion) {
    confetti = Array.from({ length: 90 }, () => ({
      x: Math.random() * VIEW_W, y: -Math.random() * VIEW_H,
      v: 20 + Math.random() * 50, c: ['#e88968', '#f2d54d', '#54d6d6', '#a3e14f', '#f272c8'][ri(0, 4)],
      w: ri(2, 4),
    }));
    await wait(3200);
    confetti = [];
  }
  save();
  G.state = 'dialog';
  await say('Клод', 'Прод зелёный, мир спасён… но приключение не обязано кончаться. Гуляй, добивай сайд-квесты — Кодоземье теперь твоё. Вайб с тобой!');
  endDialog();
  quest(QUEST_HINTS[7]);
  G.state = 'explore';
}

/* ============================================================
   ВВОД
   ============================================================ */
function pressA() {
  audio();
  if (advanceFn) { advanceFn(); return; }
  if (G.state === 'explore') interact();
}
function pressB() {
  audio();
  if (G.state === 'explore') openMenu();
  else if (G.state === 'menu') closeMenu();
}

addEventListener('keydown', e => {
  if (e.repeat && ['KeyE', 'Enter', 'Space', 'Escape', 'KeyQ'].includes(e.code)) return;
  switch (e.code) {
    case 'ArrowUp': case 'KeyW': input.up = true; e.preventDefault(); break;
    case 'ArrowDown': case 'KeyS': input.down = true; e.preventDefault(); break;
    case 'ArrowLeft': case 'KeyA': input.left = true; e.preventDefault(); break;
    case 'ArrowRight': case 'KeyD': input.right = true; e.preventDefault(); break;
    case 'KeyE': case 'Enter': case 'Space': pressA(); e.preventDefault(); break;
    case 'Escape': case 'KeyQ': pressB(); break;
  }
});
addEventListener('keyup', e => {
  switch (e.code) {
    case 'ArrowUp': case 'KeyW': input.up = false; break;
    case 'ArrowDown': case 'KeyS': input.down = false; break;
    case 'ArrowLeft': case 'KeyA': input.left = false; break;
    case 'ArrowRight': case 'KeyD': input.right = false; break;
  }
});

for (const pad of document.querySelectorAll('.pad')) {
  const dir = pad.dataset.dir;
  const on = e => { e.preventDefault(); audio(); input[dir] = true; pad.classList.add('held'); };
  const off = e => { e.preventDefault(); input[dir] = false; pad.classList.remove('held'); };
  pad.addEventListener('pointerdown', on);
  pad.addEventListener('pointerup', off);
  pad.addEventListener('pointerleave', off);
  pad.addEventListener('pointercancel', off);
}
$('btn-a').addEventListener('pointerdown', e => { e.preventDefault(); pressA(); });
$('btn-b').addEventListener('pointerdown', e => { e.preventDefault(); pressB(); });
$('dialog').addEventListener('pointerdown', e => { e.preventDefault(); if (advanceFn) advanceFn(); });

addEventListener('beforeunload', () => { if (G.state !== 'title') save(); });

/* ============================================================
   РЕНДЕР
   ============================================================ */
let hurtFlash = 0;
let animT = 0;

function drawExplore(dt) {
  const m = MAPS[G.map];
  const mc = mapCache[G.map] || renderMap(G.map);

  // позиция игрока в пикселях (с анимацией шага)
  let pxl = G.px * TILE, pyl = G.py * TILE;
  if (moveAnim) {
    moveAnim.t += dt / 140;
    if (moveAnim.t >= 1) { moveAnim = null; onArrive(); }
    else {
      const t = moveAnim.t;
      pxl = (moveAnim.fx + (G.px - moveAnim.fx) * t) * TILE;
      pyl = (moveAnim.fy + (G.py - moveAnim.fy) * t) * TILE;
    }
  }

  const camX = mc.width <= VIEW_W
    ? -Math.round((VIEW_W - mc.width) / 2)
    : clamp(pxl + 8 - VIEW_W / 2, 0, mc.width - VIEW_W);
  const camY = mc.height <= VIEW_H
    ? -Math.round((VIEW_H - mc.height) / 2)
    : clamp(pyl + 8 - VIEW_H / 2, 0, mc.height - VIEW_H);

  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.drawImage(mc, -Math.round(camX), -Math.round(camY));

  // сущности + игрок, сортировка по Y
  const drawList = [];
  for (const e of ents) {
    if (!entVisible(e)) continue;
    drawList.push({ y: e.y, draw: () => drawEnt(e, camX, camY) });
  }
  drawList.push({ y: moveAnim ? Math.max(G.py, moveAnim.fy) : G.py, draw: () => drawPlayer(pxl, pyl, camX, camY) });
  drawList.sort((a, b) => a.y - b.y);
  for (const d of drawList) d.draw();

  // темнота в пещере
  if (m.dark) {
    const dk = document.createElement('canvas');
    dk.width = VIEW_W; dk.height = VIEW_H;
    const dg = dk.getContext('2d');
    dg.fillStyle = 'rgba(8,4,20,0.62)';
    dg.fillRect(0, 0, VIEW_W, VIEW_H);
    const cx = pxl + 8 - camX, cy = pyl + 8 - camY;
    const grad = dg.createRadialGradient(cx, cy, 12, cx, cy, 70);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    dg.globalCompositeOperation = 'destination-out';
    dg.fillStyle = grad;
    dg.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.drawImage(dk, 0, 0);
  }
  if (m.night) {
    ctx.fillStyle = 'rgba(20,30,70,0.16)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

function drawEnt(e, camX, camY) {
  const bob = (e.def.float && !reduceMotion) ? Math.round(Math.sin(animT / 300) * 2) : 0;
  let spr;
  if (e.sprites) spr = e.sprites[e.def.dir || 'down'];
  else if (e.def.chest) spr = G.flags[e.def.id] ? SPR.chestOpen : SPR.chest;
  else if (e.def.pickup) spr = SPR[e.def.pickup];
  else spr = SPR[e.def.spr];
  if (!spr) return;
  const ox = (spr.width - 16) / 2, oy = spr.height - 16;
  const pbob = (e.def.pickup && !reduceMotion) ? Math.round(Math.sin(animT / 260 + e.x) * 1.5) : 0;
  ctx.drawImage(spr, Math.round(e.x * TILE - ox - camX), Math.round(e.y * TILE - oy - camY + bob + pbob));
}

function drawPlayer(pxl, pyl, camX, camY) {
  const spr = SPR.player[G.dir];
  const step = moveAnim && !reduceMotion ? (Math.floor(moveAnim.t * 4) % 2 ? -1 : 0) : 0;
  ctx.drawImage(spr, Math.round(pxl - camX), Math.round(pyl - camY + step));
}

function drawBattle(dt) {
  const m = MAPS[G.map];
  const grd = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  grd.addColorStop(0, m.theme.sky);
  grd.addColorStop(1, '#0a0c16');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = m.theme.ground;
  ctx.fillRect(0, GROUND_Y, VIEW_W, VIEW_H - GROUND_Y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(VIEW_W / 2, GROUND_Y + 2, 62, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!B) return;
  B.bob += dt;
  if (B.shake > 0) B.shake -= dt;
  if (B.blink > 0) B.blink -= dt;

  const spr = SPR[B.e.spr];
  const scale = spr.width <= 16 ? 7 : spr.width <= 24 ? 6 : 5;
  const w = spr.width * scale, h = spr.height * scale;
  const bobY = reduceMotion ? 0 : Math.round(Math.sin(B.bob / 320) * 3);
  const shX = B.shake > 0 ? ri(-4, 4) : 0;
  const blinkHide = B.blink > 0 && Math.floor(B.blink / 60) % 2 === 0;
  if (!blinkHide) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr, Math.round(VIEW_W / 2 - w / 2 + shX), Math.round(GROUND_Y - h + bobY), w, h);
  }
  if (hurtFlash > 0) {
    hurtFlash -= dt;
    ctx.fillStyle = 'rgba(224,79,79,0.28)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

function drawEnding(dt) {
  ctx.fillStyle = '#0d0f1a';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = '#7de3a0';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ПРОД ЗЕЛЁНЫЙ ✔', VIEW_W / 2, VIEW_H / 2 - 20);
  ctx.font = '10px monospace';
  ctx.fillStyle = '#e88968';
  ctx.fillText('вайб достигнут', VIEW_W / 2, VIEW_H / 2);
  for (const c of confetti) {
    c.y += c.v * dt / 1000;
    if (c.y > VIEW_H) c.y = -4;
    ctx.fillStyle = c.c;
    ctx.fillRect(c.x, c.y, c.w, c.w);
  }
}

let lastT = 0;
function frame(t) {
  const dt = Math.min(50, t - lastT);
  lastT = t;
  animT = t;

  if (G.state === 'explore' && !moveAnim) {
    if (input.up) tryMove('up');
    else if (input.down) tryMove('down');
    else if (input.left) tryMove('left');
    else if (input.right) tryMove('right');
  }

  if (G.state === 'battle') drawBattle(dt);
  else if (G.state === 'ending') drawEnding(dt);
  else if (G.state !== 'title') drawExplore(dt);
  else {
    // фон под титульным экраном
    ctx.fillStyle = '#0d0f1a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  requestAnimationFrame(frame);
}

/* ============================================================
   ЭКСПОРТ ДЛЯ СЮЖЕТА + СТАРТ
   ============================================================ */
window.E = { say, choice, battle, give, take, has, buy, coins, sfx, quest, endGame, useItem, loadMap };

buildSprites();
{ // арт на титульнике — Клод
  const big = document.createElement('canvas');
  big.width = 64; big.height = 64;
  const g = big.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(SPR.claude, 0, 0, 64, 64);
  $('title-art').style.backgroundImage = `url(${big.toDataURL()})`;
}
showTitle();
requestAnimationFrame(frame);

})();
