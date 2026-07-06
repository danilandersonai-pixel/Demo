/* ============================================================
   Вайб-Кодер: Легенда Великого Релиза — движок.
   Один IIFE: спрайты (обводка, анимация ходьбы, аксессуары),
   тайлы (2 фазы анимации), карты, частицы, диалоги с портретами,
   пошаговые бои с задниками, меню, сохранение. Без зависимостей.
   ============================================================ */
(() => {
'use strict';

/* ---------- утилиты ---------- */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const wait = ms => new Promise(r => setTimeout(r, ms));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const TILE = 16;
let VIEW_W = 240, VIEW_H = 320;
let GROUND_Y = 220; // линия земли на боевом экране
const canvas = $('screen');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

/* канвас на весь экран: внутреннее разрешение подгоняется под
   пропорции устройства с целочисленным пиксельным масштабом */
function resizeView() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  const scale = Math.max(2, Math.min(Math.floor(w / 176), Math.floor(h / 176)));
  VIEW_W = Math.ceil(w / scale);
  VIEW_H = Math.ceil(h / scale);
  GROUND_Y = VIEW_H - 100;
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  canvas.style.width = VIEW_W * scale + 'px';
  canvas.style.height = VIEW_H * scale + 'px';
  ctx.imageSmoothingEnabled = false;
  partsFor = null; // пересеять частицы под новый размер
}
addEventListener('resize', resizeView);

/* ============================================================
   СПРАЙТЫ
   ============================================================ */
const SPR = {};       // одиночные спрайты (обведённые)
const SPRF = {};      // отражённые копии
const PORTRAITS = {}; // имя говорящего → канвас портрета

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

/* тёмная обводка вокруг непрозрачных пикселей — читаемость на любом фоне */
function outline(src, color = '#141420') {
  const w = src.width, h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const a = (x, y) => data[(y * w + x) * 4 + 3];
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.fillStyle = color;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (a(x, y)) continue;
      if ((x > 0 && a(x - 1, y)) || (x < w - 1 && a(x + 1, y)) ||
          (y > 0 && a(x, y - 1)) || (y < h - 1 && a(x, y + 1)))
        g.fillRect(x, y, 1, 1);
    }
  return c;
}

/* аксессуар поверх собранного персонажа */
function applyAcc(c, accName, dir) {
  if (!accName) return;
  const acc = ACCESSORIES[accName];
  const rows = acc && acc.rows[dir];
  if (!rows) return;
  const g = c.getContext('2d');
  for (const [ry, str] of rows)
    for (let x = 0; x < str.length; x++) {
      const col = PAL[str[x]];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, ry, 1, 1);
    }
}

/* человечек: 4 направления × 3 кадра (стоя / шаг Л / шаг П) */
function buildHuman(cfg) {
  const remap = { q: cfg.hair, Q: cfg.hairD, z: cfg.shirt, Z: cfg.shirtD, u: cfg.pants || 'K' };
  const out = {};
  for (const dir of ['down', 'up', 'side']) {
    const head = HUMAN_TPL[dir].slice(0, 14);
    const frames = LEG_FRAMES[dir].map(legs => {
      const c = artToCanvas(head.concat(legs), remap);
      applyAcc(c, cfg.acc, dir);
      return outline(c);
    });
    if (dir === 'side') { out.right = frames; out.left = frames.map(flipH); }
    else out[dir] = frames;
  }
  return out;
}

function buildSprites() {
  for (const k in SPRITES) {
    SPR[k] = outline(artToCanvas(SPRITES[k]));
    SPRF[k] = flipH(SPR[k]);
  }
  SPR.player = buildHuman({ hair: 'h', hairD: 'H', shirt: 'b', shirtD: 'B', pants: 'K' });

  // портреты: игрок, Клод, враги, объекты
  PORTRAITS['Джун'] = SPR.player.down[0];
  PORTRAITS['Клод'] = SPR.claude;
  PORTRAITS['Терминал'] = SPR.terminal;
  PORTRAITS['Деплой-Терминал'] = SPR.terminal;
  PORTRAITS['Табличка'] = SPR.sign;
  PORTRAITS['Кот Багси'] = SPR.cat;
  PORTRAITS['КлинАп-9000'] = SPR.robot;
  PORTRAITS['Голова слева'] = SPR.conflict;
  PORTRAITS['Голова справа'] = SPR.conflict;
  for (const id in ENEMIES) PORTRAITS[ENEMIES[id].name] = SPR[ENEMIES[id].spr];
  // персонажи-люди из сюжета
  for (const def of NPCS) {
    if (def.human) {
      def._sprites = buildHuman(def.human);
      PORTRAITS[def.name] = def._sprites.down[0];
    } else if (def.spr && !PORTRAITS[def.name]) {
      PORTRAITS[def.name] = SPR[def.spr];
    }
  }
  // короткие имена, которыми персонажи зовут себя в репликах
  const alias = {
    'Пиксель': 'Дизайнер Пиксель',
    'Ната': 'Жительница Ната',
    'Октавия': 'Сеньора Октавия',
    'Джава': 'Бариста Джава',
    'Грейс': 'Тимлид Грейс',
    'Ада': 'QA Ада',
    'Пип': 'Стажёр Пип',
  };
  for (const short in alias) if (PORTRAITS[alias[short]]) PORTRAITS[short] = PORTRAITS[alias[short]];
}

/* ============================================================
   ТАЙЛЫ (ph — фаза анимации 0/1)
   ============================================================ */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 2654435761;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

const TILE_PAINTERS = {
  '.': (g, px, py, x, y) => {
    g.fillStyle = '#3e8e50'; g.fillRect(px, py, 16, 16);
    for (let i = 0; i < 6; i++) {
      const r = hash2(x * 7 + i, y * 13 + i);
      g.fillStyle = r > 0.66 ? '#4aa25c' : r > 0.33 ? '#357a44' : '#46985a';
      g.fillRect(px + ((r * 97) | 0) % 15, py + ((r * 53) | 0) % 15, 1, 1);
    }
    if (hash2(x * 3, y * 5) > 0.9) { // редкие травинки
      g.fillStyle = '#2f6e3e';
      const bx = px + ((hash2(y, x) * 13) | 0) % 13;
      g.fillRect(bx, py + 10, 1, 3); g.fillRect(bx + 2, py + 11, 1, 2);
    }
  },
  ',': (g, px, py, x, y) => {
    TILE_PAINTERS['.'](g, px, py, x, y);
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
    g.fillStyle = '#2f7d45'; g.fillRect(fx, fy + 2, 1, 4);
    g.fillStyle = pet;
    g.fillRect(fx - 1, fy, 1, 1); g.fillRect(fx + 1, fy, 1, 1);
    g.fillRect(fx, fy - 1, 1, 1); g.fillRect(fx, fy + 1, 1, 1);
    g.fillStyle = cen; g.fillRect(fx, fy, 1, 1);
    g.fillStyle = '#2f7d45'; g.fillRect(fx + 4, fy + 5, 2, 2);
  },
  'g': (g, px, py, x, y) => { // камешки
    TILE_PAINTERS['.'](g, px, py, x, y);
    for (let i = 0; i < 3; i++) {
      const r = hash2(x + i * 3, y - i);
      const gx = px + 2 + ((r * 41) | 0) % 11, gy = py + 3 + ((r * 29) | 0) % 10;
      g.fillStyle = '#8a92a8'; g.fillRect(gx, gy, 3, 2);
      g.fillStyle = '#b9becf'; g.fillRect(gx, gy, 2, 1);
      g.fillStyle = '#5a6278'; g.fillRect(gx + 1, gy + 1, 2, 1);
    }
  },
  'm': (g, px, py, x, y) => { // гриб
    TILE_PAINTERS['.'](g, px, py, x, y);
    g.fillStyle = '#ece7db'; g.fillRect(px + 6, py + 9, 3, 4);
    g.fillStyle = '#e04f4f'; g.fillRect(px + 4, py + 6, 8, 3); g.fillRect(px + 5, py + 5, 6, 1);
    g.fillStyle = '#ffffff';
    g.fillRect(px + 6, py + 6, 1, 1); g.fillRect(px + 9, py + 7, 1, 1);
    g.fillStyle = '#a83030'; g.fillRect(px + 4, py + 8, 8, 1);
  },
  'e': (g, px, py, x, y) => { // забор
    TILE_PAINTERS['.'](g, px, py, x, y);
    g.fillStyle = '#8a5a34';
    g.fillRect(px + 2, py + 4, 2, 10); g.fillRect(px + 12, py + 4, 2, 10);
    g.fillRect(px, py + 6, 16, 2); g.fillRect(px, py + 10, 16, 2);
    g.fillStyle = '#5f3c20';
    g.fillRect(px + 2, py + 13, 2, 1); g.fillRect(px + 12, py + 13, 2, 1);
    g.fillStyle = '#b87f4e';
    g.fillRect(px + 2, py + 4, 2, 1); g.fillRect(px + 12, py + 4, 2, 1);
  },
  't': (g, px, py, x, y) => {
    TILE_PAINTERS['.'](g, px, py, x, y);
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(px + 3, py + 13, 10, 2); // тень кроны
    g.fillStyle = '#5f3c20'; g.fillRect(px + 6, py + 10, 4, 6);
    g.fillStyle = '#4a2e16'; g.fillRect(px + 6, py + 10, 1, 6);
    g.fillStyle = '#1f5c31';
    g.fillRect(px + 2, py + 3, 12, 9);
    g.fillRect(px + 4, py + 1, 8, 13);
    g.fillStyle = '#2f7d45';
    g.fillRect(px + 4, py + 2, 5, 3);
    g.fillRect(px + 3 + ((hash2(x, y) * 6) | 0), py + 6, 3, 2);
    g.fillStyle = '#174726'; g.fillRect(px + 9, py + 8, 4, 3);
    g.fillStyle = '#3f9a58'; g.fillRect(px + 5, py + 1, 2, 1); // блик
  },
  'w': (g, px, py, x, y, ph) => {
    g.fillStyle = '#2b5f9e'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#4f7de0';
    for (let i = 0; i < 3; i++) {
      const r = hash2(x + i * 3, y + i);
      const wx = (((r * 23) | 0) % 11) + (ph ? 3 : 0);
      g.fillRect(px + (wx % 11), py + 2 + i * 5, 4 + ((r * 7) | 0) % 3, 1);
    }
    g.fillStyle = '#7ea4ec';
    g.fillRect(px + ((hash2(y, x) * 13) | 0) % 12 + (ph ? 2 : 0), py + 6, 2, 1);
    g.fillStyle = '#1e4776'; g.fillRect(px + ((hash2(y, x) * 13) | 0) % 12, py + 9 + (ph ? 1 : 0), 3, 1);
  },
  '=': (g, px, py) => {
    g.fillStyle = '#8a5a34'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#6f4526';
    g.fillRect(px, py + 4, 16, 1); g.fillRect(px, py + 9, 16, 1); g.fillRect(px, py + 14, 16, 1);
    g.fillStyle = '#b87f4e'; g.fillRect(px, py, 16, 1);
  },
  'p': (g, px, py, x, y) => {
    g.fillStyle = '#c9a35f'; g.fillRect(px, py, 16, 16);
    for (let i = 0; i < 5; i++) {
      const r = hash2(x * 3 + i, y * 5 - i);
      g.fillStyle = r > 0.5 ? '#b08a4a' : '#d9b877';
      g.fillRect(px + ((r * 89) | 0) % 14, py + ((r * 31) | 0) % 14, 2, 1);
    }
    if (hash2(x, y * 7) > 0.88) { g.fillStyle = '#a37f42'; g.fillRect(px + 5, py + 8, 3, 2); }
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
  'W': (g, px, py, x, y, ph) => { // стена с тёплым окном
    TILE_PAINTERS['b'](g, px, py, x, y);
    g.fillStyle = '#5f3c20'; g.fillRect(px + 3, py + 3, 10, 9);
    g.fillStyle = ph ? '#f6e26b' : '#f2d54d'; g.fillRect(px + 4, py + 4, 8, 7);
    g.fillStyle = '#c7852f';
    g.fillRect(px + 7, py + 4, 1, 7); g.fillRect(px + 4, py + 7, 8, 1);
    g.fillStyle = '#fff3b0'; g.fillRect(px + 5, py + 5, 2, 1);
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
    g.fillStyle = '#8a5f38'; g.fillRect(px + 5, py + 5, 2, 4);
    g.fillStyle = '#f2d54d'; g.fillRect(px + 11, py + 9, 1, 2);
  },
  'T': (g, px, py, x, y, ph) => {
    g.fillStyle = '#232637'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#3a3f52'; g.fillRect(px + 1, py + 1, 14, 1); g.fillRect(px + 1, py + 1, 1, 14);
    g.fillStyle = '#101019'; g.fillRect(px + 3, py + 4, 10, 8);
    g.fillStyle = '#7de3a0';
    const n = 2 + ((hash2(x, y) * 3) | 0);
    for (let i = 0; i < n; i++)
      g.fillRect(px + 4 + (ph && i === n - 1 ? 2 : 0), py + 5 + i * 2, 3 + ((hash2(x + i, y + ph) * 6) | 0), 1);
    if (ph) { g.fillStyle = '#aef2c4'; g.fillRect(px + 4, py + 5 + n * 2, 2, 1); } // курсор мигает
  },
  'C': (g, px, py, x, y) => {
    g.fillStyle = '#2a2138'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#3a2f52'; g.fillRect(px + 1 + ((hash2(x, y) * 8) | 0) % 8, py + 2, 5, 3);
    g.fillStyle = '#1c1628'; g.fillRect(px + ((hash2(y, x) * 12) | 0) % 10, py + 8, 6, 3);
    g.fillStyle = '#181224'; g.fillRect(px, py + 14, 16, 2);
    g.fillStyle = '#4a3d68'; g.fillRect(px + ((hash2(x + 9, y) * 11) | 0) % 12, py + 5, 2, 1);
  },
  'c': (g, px, py, x, y) => {
    g.fillStyle = '#453a5e'; g.fillRect(px, py, 16, 16);
    for (let i = 0; i < 5; i++) {
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
  'K': (g, px, py, x, y, ph) => { // светящийся кристалл
    TILE_PAINTERS['c'](g, px, py, x, y);
    const glow = ph ? '#8af0f0' : '#54d6d6';
    g.fillStyle = ph ? 'rgba(84,214,214,.18)' : 'rgba(84,214,214,.10)';
    g.fillRect(px + 1, py + 1, 14, 14);
    g.fillStyle = '#2f9d9d';
    g.fillRect(px + 5, py + 5, 4, 9); g.fillRect(px + 9, py + 8, 3, 6);
    g.fillStyle = glow;
    g.fillRect(px + 5, py + 3, 3, 8); g.fillRect(px + 9, py + 6, 2, 5);
    g.fillStyle = '#d8ffff'; g.fillRect(px + 6, py + 4, 1, 3);
  },
  'u': (g, px, py, x, y) => { // сталагмит
    TILE_PAINTERS['c'](g, px, py, x, y);
    g.fillStyle = '#3a3050';
    g.fillRect(px + 6, py + 4, 4, 10); g.fillRect(px + 4, py + 10, 8, 4);
    g.fillStyle = '#524670'; g.fillRect(px + 7, py + 3, 2, 2); g.fillRect(px + 6, py + 5, 1, 6);
    g.fillStyle = '#2c2440'; g.fillRect(px + 9, py + 6, 1, 8);
  },
  'P': (g, px, py, x, y) => {
    g.fillStyle = '#4a5266'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#3a4152';
    g.fillRect(px, py + 15, 16, 1); g.fillRect(px + 15, py, 1, 16);
    g.fillStyle = '#565f76'; g.fillRect(px, py, 16, 1);
    if (hash2(x, y) > 0.85) { g.fillStyle = '#3a4152'; g.fillRect(px + 5, py + 5, 5, 5); g.fillStyle = '#565f76'; g.fillRect(px + 6, py + 6, 3, 3); }
    if (hash2(x * 5, y) > 0.9) { g.fillStyle = '#7de3a0'; g.fillRect(px + 3, py + 11, 2, 1); } // мох в трещине
  },
  'L': (g, px, py, x, y, ph) => { // фонарь
    TILE_PAINTERS['P'](g, px, py, x, y);
    g.fillStyle = '#232637'; g.fillRect(px + 7, py + 4, 2, 11);
    g.fillStyle = '#3a3f52'; g.fillRect(px + 5, py + 14, 6, 2);
    g.fillStyle = ph ? '#fff3b0' : '#f6e26b';
    g.fillRect(px + 5, py + 1, 6, 4);
    g.fillStyle = 'rgba(246,226,107,.16)'; g.fillRect(px + 2, py, 12, 8);
    g.fillStyle = '#232637'; g.fillRect(px + 5, py, 6, 1);
  },
  'S': (g, px, py, x, y, ph) => {
    g.fillStyle = '#1d2334'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#2a3248';
    for (let ry = 0; ry < 4; ry++) g.fillRect(px + 2, py + 2 + ry * 4, 12, 2);
    g.fillStyle = '#12172a'; g.fillRect(px, py + 15, 16, 1);
    const leds = ['#49b866', '#54d6d6', '#e04f4f', '#f2d54d'];
    for (let ry = 0; ry < 4; ry++) {
      const r = hash2(x * 3 + ry, y * 7 + ry);
      g.fillStyle = leds[((r * leds.length) | 0) + (ph ? 1 : 0) & 3];
      g.fillRect(px + 3 + ((r * 17) | 0) % 9, py + 2 + ry * 4, 1, 1);
    }
  },
  '~': (g, px, py, x, y, ph) => {
    g.fillStyle = '#101a2e'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#54d6d6';
    for (let i = 0; i < 3; i++) {
      const r = hash2(x + i, y * 2 + i);
      const oy = (((r * 29) | 0) % 10 + (ph ? 4 : 0)) % 12;
      g.fillRect(px + 2 + i * 5, py + oy, 1, 4 + ((r * 5) | 0));
    }
    g.fillStyle = '#2f9d9d'; g.fillRect(px + ((hash2(y, x) * 11) | 0) % 14, py + (ph ? 9 : 12), 1, 3);
    g.fillStyle = '#8af0f0'; g.fillRect(px + 7, py + (ph ? 2 : 6), 1, 1);
  },
  'f': (g, px, py, x, y) => {
    g.fillStyle = '#8a5a34'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#6f4526';
    g.fillRect(px, py + 7, 16, 1); g.fillRect(px, py + 15, 16, 1);
    g.fillRect(px + (y % 2 ? 4 : 10), py, 1, 7); g.fillRect(px + (y % 2 ? 12 : 6), py + 8, 1, 7);
    g.fillStyle = '#9c6a40'; g.fillRect(px + ((hash2(x, y) * 13) | 0) % 13, py + 2, 3, 1);
  },
  'q': (g, px, py, x, y) => { // ковровая дорожка
    g.fillStyle = '#8a2635'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#a83345';
    for (let i = 0; i < 4; i++) {
      const r = hash2(x * 3 + i, y * 5 + i);
      g.fillRect(px + ((r * 59) | 0) % 14, py + ((r * 37) | 0) % 14, 2, 1);
    }
    g.fillStyle = '#f2d54d';
    g.fillRect(px, py, 1, 16); g.fillRect(px + 15, py, 1, 16);
    g.fillStyle = '#6e1c28';
    g.fillRect(px + 1, py, 1, 16); g.fillRect(px + 14, py, 1, 16);
    if ((x + y) % 3 === 0) { g.fillStyle = '#f2d54d'; g.fillRect(px + 7, py + 7, 2, 2); }
  },
  'B': (g, px, py, x, y) => { // стена со знаменем релиза
    TILE_PAINTERS['b'](g, px, py, x, y);
    g.fillStyle = '#c05f3f'; g.fillRect(px + 4, py, 8, 12);
    g.fillStyle = '#e88968'; g.fillRect(px + 5, py, 6, 11);
    g.fillStyle = '#f2d54d';
    g.fillRect(px + 7, py + 3, 2, 2); g.fillRect(px + 6, py + 6, 4, 1);
    g.fillStyle = '#c05f3f';
    g.fillRect(px + 5, py + 11, 2, 1); g.fillRect(px + 9, py + 11, 2, 1);
  },
  'h': (g, px, py, x, y) => { // книжный шкаф
    g.fillStyle = '#5f3c20'; g.fillRect(px, py, 16, 16);
    g.fillStyle = '#8a5a34'; g.fillRect(px, py, 16, 2);
    const spines = ['#e04f4f', '#4f7de0', '#49b866', '#f2d54d', '#a86fe0', '#e88968'];
    for (let shelf = 0; shelf < 3; shelf++) {
      const sy = py + 3 + shelf * 4;
      g.fillStyle = '#3d2617'; g.fillRect(px + 1, sy + 3, 14, 1);
      for (let bx = 0; bx < 6; bx++) {
        const r = hash2(x * 7 + bx + shelf * 13, y * 3 + shelf);
        if (r < 0.15) continue; // пустое место
        g.fillStyle = spines[(r * spines.length) | 0];
        g.fillRect(px + 2 + bx * 2, sy + (r > 0.8 ? 1 : 0), 2, 3 - (r > 0.8 ? 1 : 0));
      }
    }
    g.fillStyle = '#2a1a0c'; g.fillRect(px, py + 15, 16, 1);
  },
  'x': (g, px, py) => { g.fillStyle = '#05060a'; g.fillRect(px, py, 16, 16); },
};

/* краевые переходы: тени стен, берега воды, трава на тропах */
const EDGE_WALLS = new Set(['C', 'S', 'b', 'W', 'B', 'T', 'x', 'r', 'd', 'h', '#']);
const EDGE_GRASS = new Set(['.', ',', 'F', 'g', 'm', 'e']);
function paintEdges(g, rows, w, h) {
  const at = (x, y) => (rows[y] && rows[y][x]) || ' ';
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = at(x, y), up = at(x, y - 1);
      const px = x * TILE, py = y * TILE;
      if (ch === 'w') { // берега
        if (up !== 'w' && up !== '=') {
          g.fillStyle = '#7ea4ec'; g.fillRect(px, py, 16, 2);
          g.fillStyle = '#a8c6f4'; g.fillRect(px, py, 16, 1);
        }
        if (at(x, y + 1) !== 'w' && at(x, y + 1) !== '=') { g.fillStyle = '#1e4776'; g.fillRect(px, py + 14, 16, 2); }
        if (at(x - 1, y) !== 'w') { g.fillStyle = '#7ea4ec'; g.fillRect(px, py, 1, 16); }
        if (at(x + 1, y) !== 'w') { g.fillStyle = '#1e4776'; g.fillRect(px + 15, py, 1, 16); }
        continue;
      }
      // тень от стены сверху на любую проходимую поверхность
      if (EDGE_WALLS.has(up) && !EDGE_WALLS.has(ch) && ch !== 'w') {
        g.fillStyle = 'rgba(0,0,0,0.26)'; g.fillRect(px, py, 16, 3);
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(px, py + 3, 16, 2);
      }
      // трава заползает на тропу
      if (ch === 'p' && EDGE_GRASS.has(up)) {
        g.fillStyle = '#3e8e50';
        for (let i = 0; i < 5; i++) {
          const r = hash2(x * 11 + i, y * 5);
          if (r > 0.35) g.fillRect(px + 1 + i * 3, py, 2, 1 + (r > 0.7 ? 1 : 0));
        }
      }
    }
}

/* ---------- пререндер карт (2 фазы анимации) ---------- */
const mapCache = {};
function renderMap(name, ph = 0) {
  const key = name + ph;
  if (mapCache[key]) return mapCache[key];
  const m = MAPS[name];
  const w = m.rows[0].length;
  m.rows = m.rows.map(r => (r + m.pad.repeat(w)).slice(0, w)); // нормализация ширины
  const c = document.createElement('canvas');
  c.width = w * TILE; c.height = m.rows.length * TILE;
  const g = c.getContext('2d');
  for (let y = 0; y < m.rows.length; y++)
    for (let x = 0; x < w; x++) {
      const ch = m.rows[y][x];
      (TILE_PAINTERS[ch] || TILE_PAINTERS['.'])(g, x * TILE, y * TILE, x, y, ph);
    }
  paintEdges(g, m.rows, w, m.rows.length);
  mapCache[key] = c;
  return c;
}

const tileAt = (m, x, y) => (m.rows[y] && m.rows[y][x]) || m.pad;
const isSolidTile = (m, x, y) => SOLID_TILES.has(tileAt(m, x, y));

/* бесшовный фон из тайла-границы — заполняет экран за пределами карты */
const padPatterns = {};
function padPattern(name) {
  if (padPatterns[name]) return padPatterns[name];
  const m = MAPS[name];
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  (TILE_PAINTERS[m.pad] || TILE_PAINTERS['.'])(c.getContext('2d'), 0, 0, 0, 0, 0);
  padPatterns[name] = ctx.createPattern(c, 'repeat');
  return padPatterns[name];
}

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
  if (window.Music) Music.resume();
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
  $('hud-hp-t').textContent = `HP ${G.hp}/${G.maxhp}`;
  $('hud-en-t').textContent = `EN ${G.en}/${G.maxen}`;
}

function drawFace(cnv, spr, size) {
  const g = cnv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cnv.width, cnv.height);
  if (!spr) return;
  const s = Math.min(cnv.width / spr.width, cnv.height / spr.height);
  const w = Math.floor(spr.width * s), h = Math.floor(spr.height * s);
  g.drawImage(spr, ((cnv.width - w) / 2) | 0, ((cnv.height - h) / 2) | 0, w, h);
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
   ДИАЛОГИ (с портретами)
   ============================================================ */
let advanceFn = null;
let typing = null;

const NAME_COLORS = {
  'Клод': '#e88968', 'Джун': '#6f9dff',
  'Сеньора Октавия': '#c9a2f2', 'Октавия': '#c9a2f2',
  'Дизайнер Пиксель': '#f272c8', 'Пиксель': '#f272c8',
  'Бариста Джава': '#d9a06c', 'Гит-Страж': '#f0913f',
  'Старик Легаси': '#b9b3a4', 'Записка': '#b9b3a4',
  'Тимлид Грейс': '#ff7b7b', 'QA Ада': '#f2d54d',
  'Стажёр Пип': '#a3e14f', 'Жительница Ната': '#49b866', 'Ната': '#49b866',
  'Кот Багси': '#f0913f', 'КлинАп-9000': '#9aa2b5',
  'Дедлайн-Дракон': '#ff6b6b', 'Мерж-Конфликт': '#a86fe0',
  'Спагетти-Монстр': '#f6e26b', 'Голова слева': '#a86fe0', 'Голова справа': '#a86fe0',
  'Терминал': '#7de3a0', 'Деплой-Терминал': '#7de3a0', 'Табличка': '#b9b3a4',
};

function say(name, text) {
  return new Promise(res => {
    const prev = G.state;
    G.state = 'dialog';
    $('dialog').hidden = false;
    $('dlg-name').textContent = name || '';
    $('dlg-name').style.color = NAME_COLORS[name] || 'var(--accent)';
    const face = PORTRAITS[name];
    $('dlg-portrait').hidden = !face;
    if (face) drawFace($('dlg-face'), face, 32);
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
    $('dlg-portrait').hidden = true;
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
   КАРТА / СУЩНОСТИ / ЧАСТИЦЫ
   ============================================================ */
let ents = [];

function buildEnts() {
  ents = NPCS.filter(n => n.map === G.map).map(def => {
    let sprites = def._sprites || null;
    return { def, x: def.x, y: def.y, sprites, walkT: 0, par: 0, flip: false, patrolT: 800 + Math.random() * 1200 };
  });
}
const entVisible = e => !(e.def.hidden && e.def.hidden()) && !(e.def.pickup && G.flags[e.def.flag]);
const entAt = (x, y) => ents.find(e => e.x === x && e.y === y && entVisible(e) && !e.def.pickup);

/* прогулки живности (кот, робот) */
function updatePatrols(dt) {
  if (G.state !== 'explore') return;
  const m = MAPS[G.map];
  for (const e of ents) {
    if (!e.def.patrol || !entVisible(e)) continue;
    if (e.walkT > 0) e.walkT -= dt;
    e.patrolT -= dt;
    if (e.patrolT > 0) continue;
    e.patrolT = 1200 + Math.random() * 1600;
    const tx = e.x === e.def.x ? e.def.x + e.def.patrol : e.def.x;
    if (isSolidTile(m, tx, e.y) || entAt(tx, e.y) || (G.px === tx && G.py === e.y)) continue;
    e.flip = tx < e.x;
    e.dir = tx < e.x ? 'left' : 'right';
    e.x = tx;
    e.walkT = 300;
    e.par ^= 1;
  }
}

/* атмосферные частицы */
const AMBIENT = {
  petals: { n: 14, mk: () => ({ c: Math.random() < 0.5 ? '#f272c8' : '#ece7db', vy: 12 + Math.random() * 10, sway: 14, s: 2 }) },
  leaves: { n: 16, mk: () => ({ c: Math.random() < 0.5 ? '#5fae57' : '#2f7d45', vy: 18 + Math.random() * 14, sway: 20, s: 2 }) },
  dust:   { n: 18, mk: () => ({ c: Math.random() < 0.5 ? '#6a5c8e' : '#8a7cb0', vy: -6 - Math.random() * 6, sway: 6, s: 1 }) },
  data:   { n: 16, mk: () => ({ c: Math.random() < 0.5 ? '#54d6d6' : '#7de3a0', vy: -26 - Math.random() * 20, sway: 2, s: 1, tall: 3 }) },
  embers: { n: 16, mk: () => ({ c: Math.random() < 0.5 ? '#f0913f' : '#e88968', vy: -14 - Math.random() * 12, sway: 10, s: 2 }) },
};
let parts = [], partsFor = null;

function ensureParts() {
  const kind = MAPS[G.map].ambient;
  if (partsFor === kind) return;
  partsFor = kind;
  parts = [];
  if (!kind || reduceMotion) return;
  const cfg = AMBIENT[kind];
  for (let i = 0; i < cfg.n; i++) {
    const p = cfg.mk();
    p.x = Math.random() * VIEW_W;
    p.y = Math.random() * VIEW_H;
    p.ph = Math.random() * 6.28;
    parts.push(p);
  }
}

function drawParts(dt, t) {
  ensureParts();
  for (const p of parts) {
    p.y += p.vy * dt / 1000;
    p.x += Math.sin(t / 900 + p.ph) * p.sway * dt / 1000;
    if (p.vy > 0 && p.y > VIEW_H + 4) { p.y = -4; p.x = Math.random() * VIEW_W; }
    if (p.vy < 0 && p.y < -4) { p.y = VIEW_H + 4; p.x = Math.random() * VIEW_W; }
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = p.c;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.tall || p.s);
    ctx.globalAlpha = 1;
  }
}

const fade = on => new Promise(res => {
  $('fade').classList.toggle('on', on);
  setTimeout(res, reduceMotion ? 60 : 380);
});

async function loadMap(name, x, y, { skipEvent } = {}) {
  await fade(true);
  G.map = name; G.px = x; G.py = y;
  moveAnim = null;
  renderMap(name, 0); renderMap(name, 1);
  buildEnts();
  save();
  Music.play(MAPS[name].music || 'calm');
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
let moveAnim = null; // {fx,fy,t}
let stepsSinceBattle = 0;
let stepPar = 0; // чередование кадров шага

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
  stepPar ^= 1;
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
      introT: reduceMotion ? 0 : 550,
      glitchT: reduceMotion ? 0 : 380,
      pAtkT: 0, eAtkT: 0,
      fx: [],
      resolve: r => {
        B = null; $('battle-ui').hidden = true; $('controls').hidden = false; G.state = 'explore';
        Music.play(MAPS[G.map].music || 'calm');
        // поражение обрабатываем централизованно: откат в деревню
        if (r === 'lose') loseGame().then(() => resolve(r));
        else resolve(r);
      },
    };
    Music.play(base.boss ? 'boss' : 'battle');
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
  $('b-ehp-t').textContent = `${B.ehp}/${B.emax}`;
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

function addFx(type, dur, data) {
  if (!B || reduceMotion) return;
  B.fx.push({ type, t: 0, dur, data: data || {} });
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
  B.pAtkT = reduceMotion ? 0 : 420;
  addFx(s.id, 520);
  await wait(550);
  if (!B) return;
  const crit = Math.random() < 0.12;
  const dmg = Math.round(dmgRoll(pAtk(), s.mult, B.e.def) * (crit ? 1.6 : 1));
  B.ehp = Math.max(0, B.ehp - dmg);
  B.shake = reduceMotion ? 0 : (crit ? 520 : 380); B.blink = 380;
  addFx('burst', crit ? 620 : 420, { big: crit });
  sfx('hit');
  if (crit) { sfx('stun'); floatText('КРИТ! -' + dmg, 0.5, 0.24, 'hurt'); bmsg('КРИТИЧЕСКИЙ ВАЙБ! ×1.6 урона!'); }
  else floatText('-' + dmg, 0.5, 0.28, 'hurt');
  updateEnemyBar();
  await wait(520);
  if (!B) return;
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
  if (!B) return;
  B.eAtkT = reduceMotion ? 0 : 420;
  addFx('slash', 420);
  await wait(260);
  if (!B) return;
  const enraged = B.e.boss && B.ehp < B.emax * 0.3;
  const dmg = dmgRoll(B.e.atk * (enraged ? 1.3 : 1), 1, pDef());
  G.hp = Math.max(0, G.hp - dmg);
  sfx('hurt');
  if (!reduceMotion) hurtFlash = 240;
  floatText('-' + dmg, 0.2, 0.75, 'hurt');
  updateHUD();
  bmsg(enraged ? `ЯРОСТЬ! ${B.e.name} наносит ${dmg} урона!` : `${B.e.name} наносит ${dmg} урона!`);
  await wait(720);
  if (!B) return;
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
function sideQuests() {
  const rows = [];
  rows.push(G.flags.beansGiven
    ? '✓ Зёрна для Баристы Джавы — выполнено'
    : `⏳ Зёрна для Баристы Джавы — собрано ${G.items.bean || 0}/3 (Поля Фронтенда)`);
  rows.push(G.flags.docsDelivered
    ? '✓ Древняя Документация — доставлена Грейс'
    : G.flags.docsTaken
      ? '⏳ Древняя Документация — отнеси её Тимлиду Грейс в Продакшен'
      : '⏳ Древняя Документация — навести Старика Легаси в лесу');
  rows.push(G.flags.chest_hut
    ? '✓ Тайна Хижины Легаси — раскрыта'
    : '⏳ Тайна Хижины Легаси — что старик прячет за дверью хижины?');
  return rows.map(r => `<div class="sq${r[0] === '✓' ? ' sq-done' : ''}">${r}</div>`).join('');
}

function openMenu() {
  if (G.state !== 'explore') return;
  G.state = 'menu';
  $('menu').hidden = false;
  const oldMap = $('menu-map-wrap');
  if (oldMap) oldMap.remove();
  $('menu-quest').innerHTML =
    `<b>ЗАДАЧА:</b> ${QUEST_HINTS[Math.min(G.story, QUEST_HINTS.length - 1)]}` +
    `<div class="sq-title">ПОБОЧНЫЕ КВЕСТЫ</div>` + sideQuests();
  // мини-карта локации
  const mc = renderMap(G.map, 0);
  $('menu-stats').innerHTML =
    `<canvas id="menu-face" width="16" height="16"></canvas><div>` +
    `<b>Джун</b> — вайб-кодер ур. ${G.lvl}<br>` +
    `HP ${G.hp}/${G.maxhp} · EN ${G.en}/${G.maxen}<br>` +
    `АТК ${pAtk()} · ЗАЩ ${pDef()} · XP ${G.xp}/${xpNeed()}<br>` +
    `Монеты: ${G.coins} ☕ · ${MAPS[G.map].name}</div>`;
  drawFace($('menu-face'), SPR.player.down[0], 16);
  const mapWrap = document.createElement('div');
  mapWrap.id = 'menu-map-wrap';
  const mm = document.createElement('canvas');
  mm.id = 'menu-map';
  mm.width = mc.width; mm.height = mc.height;
  mapWrap.appendChild(mm);
  $('menu-stats').after(mapWrap);
  const mg = mm.getContext('2d');
  mg.imageSmoothingEnabled = false;
  mg.drawImage(mc, 0, 0);
  mg.fillStyle = 'rgba(13,15,26,0.35)';
  mg.fillRect(0, 0, mm.width, mm.height);
  for (const p of MAPS[G.map].portals) { // выходы
    mg.fillStyle = '#54d6d6';
    mg.fillRect(p.x * TILE + 4, p.y * TILE + 4, 8, 8);
  }
  for (const e of ents) { // персонажи
    if (!entVisible(e) || e.def.pickup) continue;
    mg.fillStyle = e.def.chest ? '#f2d54d' : '#a3e14f';
    mg.fillRect(e.x * TILE + 5, e.y * TILE + 5, 6, 6);
  }
  mg.fillStyle = '#ffffff'; // игрок
  mg.fillRect(G.px * TILE + 3, G.py * TILE + 3, 10, 10);
  mg.fillStyle = '#e04f4f';
  mg.fillRect(G.px * TILE + 5, G.py * TILE + 5, 6, 6);
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
function makeTitleArt() {
  const c = document.createElement('canvas');
  c.width = 150; c.height = 100;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  // небо со звёздами
  const grd = g.createLinearGradient(0, 0, 0, 100);
  grd.addColorStop(0, '#131a30'); grd.addColorStop(0.7, '#2a2148'); grd.addColorStop(1, '#33122a');
  g.fillStyle = grd; g.fillRect(0, 0, 150, 100);
  g.fillStyle = '#ece7db';
  for (let i = 0; i < 40; i++) {
    const r = hash2(i * 7, i * 13);
    g.globalAlpha = 0.3 + r * 0.7;
    g.fillRect((r * 1499 | 0) % 150, ((r * 733) | 0) % 62, 1, 1);
  }
  g.globalAlpha = 1;
  // луна-курсор
  g.fillStyle = '#7de3a0'; g.fillRect(126, 10, 8, 12);
  g.fillStyle = 'rgba(125,227,160,.25)'; g.fillRect(123, 7, 14, 18);
  // земля
  g.fillStyle = '#1d3326'; g.fillRect(0, 78, 150, 22);
  g.fillStyle = '#2f6e3e'; g.fillRect(0, 78, 150, 3);
  // дракон нависает справа
  g.drawImage(SPR.dragon, 88, 26, 56, 56);
  // герой и Клод слева
  g.drawImage(SPR.player.down[0], 26, 62, 24, 24);
  g.drawImage(SPR.claude, 50, 48, 20, 20);
  // терминал
  g.drawImage(SPR.terminal, 6, 62, 20, 20);
  return c.toDataURL();
}

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
  Music.play('title');
}

async function startPlay(isNew) {
  $('title').hidden = true;
  $('hud').hidden = false;
  $('controls').hidden = false;
  updateHUD();
  drawFace($('hud-face'), SPR.player.down[0], 16);
  renderMap(G.map, 0); renderMap(G.map, 1);
  buildEnts();
  partsFor = null;
  Music.play(MAPS[G.map].music || 'calm');
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
  Music.play('title');
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
  Music.play(MAPS[G.map].music || 'calm');
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

function shadow(cx, cy, rx = 6, ry = 2.5) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawExplore(dt, t) {
  const m = MAPS[G.map];
  const phase = reduceMotion ? 0 : ((t / 600) | 0) % 2;
  const mc = renderMap(G.map, phase);

  // позиция игрока в пикселях (с анимацией шага)
  let pxl = G.px * TILE, pyl = G.py * TILE;
  if (moveAnim) {
    moveAnim.t += dt / 140;
    if (moveAnim.t >= 1) { moveAnim = null; onArrive(); }
    else {
      const k = moveAnim.t;
      pxl = (moveAnim.fx + (G.px - moveAnim.fx) * k) * TILE;
      pyl = (moveAnim.fy + (G.py - moveAnim.fy) * k) * TILE;
    }
  }

  const camX = mc.width <= VIEW_W
    ? -Math.round((VIEW_W - mc.width) / 2)
    : clamp(pxl + 8 - VIEW_W / 2, 0, mc.width - VIEW_W);
  const camY = mc.height <= VIEW_H
    ? -Math.round((VIEW_H - mc.height) / 2)
    : clamp(pyl + 8 - VIEW_H / 2, 0, mc.height - VIEW_H);

  // за краем карты — затемнённый узор из тайла-границы (лес, скалы, стены)
  ctx.save();
  ctx.translate(-Math.round(camX), -Math.round(camY));
  ctx.fillStyle = padPattern(G.map);
  ctx.fillRect(Math.round(camX), Math.round(camY), VIEW_W + TILE, VIEW_H + TILE);
  ctx.restore();
  ctx.fillStyle = 'rgba(5,6,10,0.45)';
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

  drawParts(dt, t);
}

function drawEnt(e, camX, camY) {
  const bob = (e.def.float && !reduceMotion) ? Math.round(Math.sin(animT / 300) * 2) : 0;
  let spr;
  if (e.sprites) {
    const frame = e.walkT > 0 ? 1 + e.par : 0;
    spr = e.sprites[e.dir || e.def.dir || 'down'][frame];
  } else if (e.def.chest) spr = G.flags[e.def.id] ? SPR.chestOpen : SPR.chest;
  else if (e.def.pickup) spr = SPR[e.def.pickup];
  else spr = (e.flip ? SPRF : SPR)[e.def.spr];
  if (!spr) return;
  const ox = (spr.width - 16) / 2, oy = spr.height - 16;
  const pbob = (e.def.pickup && !reduceMotion) ? Math.round(Math.sin(animT / 260 + e.x) * 1.5) : 0;
  const sx = Math.round(e.x * TILE - ox - camX), sy = Math.round(e.y * TILE - oy - camY + bob + pbob);
  if (!e.def.pickup) shadow(e.x * TILE + 8 - camX, e.y * TILE + 15 - camY, e.def.big ? 11 : 6);
  ctx.drawImage(spr, sx, sy);
}

function drawPlayer(pxl, pyl, camX, camY) {
  const frame = moveAnim ? 1 + stepPar : 0;
  const spr = SPR.player[G.dir][frame];
  shadow(pxl + 8 - camX, pyl + 15 - camY);
  ctx.drawImage(spr, Math.round(pxl - camX), Math.round(pyl - camY));
}

/* ---------- боевой экран ---------- */

function drawBattleScenery(mapId, theme) {
  // звёзды для ночных сцен
  if (mapId === 'city' || mapId === 'cave' || mapId === 'tower') {
    ctx.fillStyle = '#ece7db';
    for (let i = 0; i < 24; i++) {
      const r = hash2(i * 11, i * 3);
      ctx.globalAlpha = 0.25 + r * 0.5;
      ctx.fillRect((r * 2399 | 0) % VIEW_W, ((r * 977) | 0) % 90, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  if (mapId === 'village' || mapId === 'fields') {
    // холмы и дальние деревья
    ctx.fillStyle = '#274a33';
    ctx.beginPath();
    ctx.ellipse(VIEW_W * 0.17, GROUND_Y + 6, VIEW_W * 0.5, 40, 0, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(VIEW_W * 0.85, GROUND_Y + 10, VIEW_W * 0.55, 52, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#1d3326';
    for (let x = 4, i = 0; x < VIEW_W; x += 36, i++) {
      const ox = (hash2(i, 3) * 14 | 0);
      const h = 22 + (hash2(i, 7) * 14 | 0);
      ctx.beginPath();
      ctx.moveTo(x + ox, GROUND_Y); ctx.lineTo(x + ox + 11, GROUND_Y - h); ctx.lineTo(x + ox + 22, GROUND_Y);
      ctx.fill();
    }
  } else if (mapId === 'forest') {
    ctx.fillStyle = '#101f16';
    for (let x = -6; x < VIEW_W; x += 46) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y); ctx.lineTo(x + 23, GROUND_Y - 92); ctx.lineTo(x + 46, GROUND_Y);
      ctx.fill();
    }
    ctx.fillStyle = '#1a3323';
    for (let x = -20; x < VIEW_W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y); ctx.lineTo(x + 20, GROUND_Y - 56); ctx.lineTo(x + 40, GROUND_Y);
      ctx.fill();
    }
  } else if (mapId === 'cave') {
    ctx.fillStyle = '#241c38';
    for (let x = 0, i = 0; x < VIEW_W; x += 32, i++) {
      const ox = (hash2(i, 1) * 10 | 0);
      const h = 26 + (hash2(i, 5) * 30 | 0);
      ctx.beginPath();
      ctx.moveTo(x + ox, 0); ctx.lineTo(x + ox + 13, h); ctx.lineTo(x + ox + 26, 0);
      ctx.fill();
    }
    for (let i = 0; i < 5; i++) { // мерцающие кристаллы
      const r = hash2(i * 9, 2);
      ctx.fillStyle = i % 2 ? '#54d6d6' : '#8af0f0';
      ctx.fillRect((r * 999 | 0) % VIEW_W, GROUND_Y - 12 - ((r * 61) | 0) % 40, 2, 4);
    }
  } else if (mapId === 'city') {
    for (let x = 0, i = 0; x < VIEW_W; x += 42, i++) {
      const w = 34, h = 60 + ((hash2(i, 8) * 50) | 0);
      ctx.fillStyle = '#0e1424';
      ctx.fillRect(x, GROUND_Y - h, w, h);
      ctx.fillStyle = '#f2d54d';
      for (let wy = 0; wy < h - 10; wy += 10)
        for (let wx = 4; wx < w - 4; wx += 8)
          if (hash2(i * 13 + wx, wy) > 0.55) {
            ctx.globalAlpha = 0.7;
            ctx.fillRect(x + wx, GROUND_Y - h + 6 + wy, 3, 4);
          }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#54d6d6'; ctx.fillRect(60, GROUND_Y - 130, 1, 22); ctx.fillRect(59, GROUND_Y - 131, 3, 2);
  } else if (mapId === 'tower') {
    ctx.fillStyle = '#2a0f22';
    ctx.fillRect(0, 0, 26, GROUND_Y); ctx.fillRect(VIEW_W - 26, 0, 26, GROUND_Y);
    ctx.fillStyle = '#3a1830';
    ctx.fillRect(26, 0, 6, GROUND_Y); ctx.fillRect(VIEW_W - 32, 0, 6, GROUND_Y);
    // знамя
    ctx.fillStyle = '#c05f3f'; ctx.fillRect(VIEW_W / 2 - 16, 0, 32, 44);
    ctx.fillStyle = '#e88968'; ctx.fillRect(VIEW_W / 2 - 12, 0, 24, 40);
    ctx.fillStyle = '#f2d54d'; ctx.fillRect(VIEW_W / 2 - 4, 14, 8, 8);
  }
}

function drawBattle(dt) {
  const m = MAPS[G.map];
  const grd = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  grd.addColorStop(0, m.theme.sky);
  grd.addColorStop(1, '#0a0c16');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawBattleScenery(G.map, m.theme);
  ctx.fillStyle = m.theme.ground;
  ctx.fillRect(0, GROUND_Y, VIEW_W, VIEW_H - GROUND_Y);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, GROUND_Y, VIEW_W, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(VIEW_W / 2, GROUND_Y + 2, 62, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!B) return;
  B.bob += dt;
  if (B.shake > 0) B.shake -= dt;
  if (B.blink > 0) B.blink -= dt;
  if (B.introT > 0) B.introT -= dt;
  if (B.pAtkT > 0) B.pAtkT -= dt;
  if (B.eAtkT > 0) B.eAtkT -= dt;

  // враг: дыхание (лёгкое сжатие по вертикали) + выпад к герою
  const spr = SPR[B.e.spr];
  let scale = spr.width <= 16 ? 7 : spr.width <= 24 ? 6 : 5;
  // не выше сцены: ужимаем масштаб под низкие/широкие экраны
  while (scale > 2 && spr.height * scale > GROUND_Y - 30) scale--;
  const w = spr.width * scale;
  const breathe = reduceMotion ? 0 : Math.sin(B.bob / 420) * 0.022;
  const h = Math.round(spr.height * scale * (1 + breathe));
  const bobY = reduceMotion ? 0 : Math.round(Math.sin(B.bob / 320) * 3);
  const shX = B.shake > 0 ? ri(-4, 4) : 0;
  const introX = B.introT > 0 ? Math.round((B.introT / 550) * 110) : 0;
  let lungeX = 0, lungeY = 0;
  if (B.eAtkT > 0) {
    const q = Math.sin((1 - B.eAtkT / 420) * Math.PI);
    lungeX = Math.round(-q * 30); lungeY = Math.round(q * 16);
  }
  const ex = Math.round(VIEW_W / 2 + shX + introX + lungeX);
  const eyTop = Math.round(GROUND_Y - h + bobY + lungeY);
  B.eCx = ex; B.eCy = eyTop + h / 2; // центр врага для эффектов
  const blinkHide = B.blink > 0 && Math.floor(B.blink / 60) % 2 === 0;
  if (!blinkHide) {
    ctx.imageSmoothingEnabled = false;
    if (B.introT > 0) ctx.globalAlpha = 1 - B.introT / 550;
    ctx.drawImage(spr, ex - w / 2, eyTop, w, h);
    ctx.globalAlpha = 1;
  }

  // герой (вид со спины) с выпадом при атаке
  const hero = SPR.player.up[0];
  const lunge = B.pAtkT > 0 ? Math.round(Math.sin((1 - B.pAtkT / 420) * Math.PI) * 26) : 0;
  const hx = 24 + lunge, hy = GROUND_Y - 42;
  B.hCx = hx + 28; B.hCy = hy + 28;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(hx + 28, hy + 58, 24, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(hero, hx, hy, 56, 56);

  drawBattleFx(dt);

  if (hurtFlash > 0) {
    hurtFlash -= dt;
    ctx.fillStyle = 'rgba(224,79,79,0.28)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // глитч-переход в начале боя
  if (B.glitchT > 0) {
    B.glitchT -= dt;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const gy = ri(0, VIEW_H);
      ctx.fillStyle = i % 3 === 0 ? 'rgba(84,214,214,0.5)' : 'rgba(5,6,10,0.75)';
      ctx.fillRect(0, gy, VIEW_W, ri(2, 8));
    }
  }
}

/* спецэффекты навыков и ударов */
function drawBattleFx(dt) {
  if (!B || !B.fx.length) return;
  const ex = B.eCx, ey = B.eCy, hx = B.hCx, hy = B.hCy;
  for (const f of B.fx) {
    f.t += dt;
    const p = clamp(f.t / f.dur, 0, 1);
    ctx.save();
    if (f.type === 'prompt') { // символы кода летят во врага
      ctx.font = 'bold 11px monospace';
      const glyphs = ['>', '{', '}', ';'];
      for (let i = 0; i < 4; i++) {
        const q = clamp(p * 1.3 - i * 0.08, 0, 1);
        const gx = hx + (ex - hx) * q, gy = hy + (ey - hy) * q - Math.sin(q * Math.PI) * 34;
        ctx.globalAlpha = 1 - q * 0.4;
        ctx.fillStyle = '#54d6d6';
        ctx.fillText(glyphs[i], gx + i * 5, gy);
      }
    } else if (f.type === 'debug') { // сходящийся прицел
      ctx.globalAlpha = 0.4 + p * 0.6;
      ctx.strokeStyle = '#e04f4f';
      ctx.lineWidth = 2;
      const r = (1 - p) * 58 + 12;
      ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex - r - 7, ey); ctx.lineTo(ex - r + 7, ey);
      ctx.moveTo(ex + r - 7, ey); ctx.lineTo(ex + r + 7, ey);
      ctx.moveTo(ex, ey - r - 7); ctx.lineTo(ex, ey - r + 7);
      ctx.moveTo(ex, ey + r - 7); ctx.lineTo(ex, ey + r + 7);
      ctx.stroke();
    } else if (f.type === 'refactor') { // зелёная волна чистоты
      ctx.globalAlpha = Math.sin(p * Math.PI) * 0.8;
      ctx.fillStyle = '#49b866';
      const sweep = -70 + p * 150;
      for (let i = 0; i < 6; i++)
        ctx.fillRect(ex - 60 + ((i * 23 + sweep) % 130), ey - 55 + i * 18, 14, 4);
    } else if (f.type === 'vibe') { // Клод прилетает и бьёт лучом
      const cx = hx + 14, cy = hy - 44 + Math.sin(p * 6) * 3;
      if (p > 0.25) {
        const beamA = Math.sin(clamp((p - 0.25) / 0.75, 0, 1) * Math.PI);
        ctx.globalAlpha = beamA * 0.85;
        const grad = ctx.createLinearGradient(cx, cy, ex, ey);
        grad.addColorStop(0, '#e88968'); grad.addColorStop(1, '#f6e26b');
        ctx.strokeStyle = grad; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(cx + 8, cy + 8); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx + 8, cy + 8); ctx.lineTo(ex, ey); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(SPR.claude, cx - 16, cy - 16, 32, 32);
    } else if (f.type === 'burst') { // звёздный разлёт при попадании
      const R = (f.data.big ? 46 : 30) * p;
      ctx.globalAlpha = 1 - p;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + 0.4;
        ctx.fillStyle = i % 2 ? '#f6e26b' : '#ffffff';
        const sz = f.data.big ? 4 : 3;
        ctx.fillRect(ex + Math.cos(a) * R - sz / 2, ey + Math.sin(a) * R - sz / 2, sz, sz);
      }
    } else if (f.type === 'slash') { // вражеские когти по герою
      ctx.globalAlpha = Math.sin(p * Math.PI);
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const off = (p * 26) - 13 + i * 9;
        ctx.beginPath();
        ctx.moveTo(hx - 22 + off, hy - 26);
        ctx.lineTo(hx + 2 + off, hy + 22);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  B.fx = B.fx.filter(f => f.t < f.dur);
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
  updatePatrols(dt);

  if (G.state === 'battle') drawBattle(dt);
  else if (G.state === 'ending') drawEnding(dt);
  else if (G.state !== 'title') drawExplore(dt, t);
  else {
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
$('title-art').style.backgroundImage = `url(${makeTitleArt()})`;
resizeView();
showTitle();
requestAnimationFrame(frame);

})();
