#!/usr/bin/env node
'use strict';

// Генератор PNG-иконок для PWA.
//
// Растеризатора в проекте нет и заводить его ради восьми картинок не стоит,
// поэтому иконка рисуется прямо пикселями: компас — это круги, прямоугольники
// и два треугольника. PNG собирается вручную (zlib есть в Node), внешних
// зависимостей по-прежнему ноль.
//
// Запуск:  node tools/make-icons.js

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var OUT = path.join(__dirname, '..', 'public', 'icons');
var SIZES = [16, 32, 96, 180, 192, 256, 384, 512];

// Цвета совпадают с дизайн-системой панели.
var C = {
  bgTop: [20, 26, 35],
  bgBottom: [10, 14, 20],
  ring: [35, 44, 58],
  ringLit: [125, 211, 252],
  mark: [107, 120, 137],
  needleTop: [125, 211, 252],
  needleBottom: [60, 74, 94],
  hub: [10, 14, 20]
};

// --- рисование -------------------------------------------------------------

function createCanvas(size) {
  return { w: size, h: size, data: new Uint8ClampedArray(size * size * 4) };
}

function blend(cv, x, y, rgb, alpha) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h || alpha <= 0) return;
  var i = (y * cv.w + x) * 4;
  var a = Math.min(1, alpha);
  cv.data[i] = cv.data[i] * (1 - a) + rgb[0] * a;
  cv.data[i + 1] = cv.data[i + 1] * (1 - a) + rgb[1] * a;
  cv.data[i + 2] = cv.data[i + 2] * (1 - a) + rgb[2] * a;
  cv.data[i + 3] = Math.max(cv.data[i + 3], 255 * a);
}

/**
 * Общий рисовальщик: для каждого пикселя считаем «покрытие» фигурой.
 * Сглаживание — усреднением по сетке 3x3 внутри пикселя: медленно, но
 * иконки генерируются один раз, зато края получаются мягкими.
 */
function fill(cv, rgb, coverFn) {
  var S = 3;
  for (var y = 0; y < cv.h; y++) {
    for (var x = 0; x < cv.w; x++) {
      var hits = 0;
      for (var sy = 0; sy < S; sy++) {
        for (var sx = 0; sx < S; sx++) {
          if (coverFn(x + (sx + 0.5) / S, y + (sy + 0.5) / S)) hits++;
        }
      }
      if (hits) blend(cv, x, y, rgb, hits / (S * S));
    }
  }
}

// Скруглённый прямоугольник — подложка иконки, с вертикальным градиентом.
function roundedBackground(cv, radius) {
  var w = cv.w;
  var h = cv.h;
  function inside(px, py) {
    if (px < 0 || py < 0 || px > w || py > h) return false;
    var cx = Math.min(Math.max(px, radius), w - radius);
    var cy = Math.min(Math.max(py, radius), h - radius);
    var dx = px - cx;
    var dy = py - cy;
    return dx * dx + dy * dy <= radius * radius;
  }
  for (var y = 0; y < h; y++) {
    var t = y / (h - 1);
    var rgb = [
      C.bgTop[0] + (C.bgBottom[0] - C.bgTop[0]) * t,
      C.bgTop[1] + (C.bgBottom[1] - C.bgTop[1]) * t,
      C.bgTop[2] + (C.bgBottom[2] - C.bgTop[2]) * t
    ];
    for (var x = 0; x < w; x++) {
      var hits = 0;
      for (var sy = 0; sy < 3; sy++) {
        for (var sx = 0; sx < 3; sx++) {
          if (inside(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits++;
        }
      }
      if (hits) blend(cv, x, y, rgb, hits / 9);
    }
  }
}

function ringCover(cx, cy, r, width) {
  var outer = r + width / 2;
  var inner = r - width / 2;
  return function (px, py) {
    var d = Math.hypot(px - cx, py - cy);
    return d <= outer && d >= inner;
  };
}

// Дуга: кольцо, ограниченное углами (в радианах, 0 — вправо, по часовой).
function arcCover(cx, cy, r, width, from, to) {
  var ring = ringCover(cx, cy, r, width);
  return function (px, py) {
    if (!ring(px, py)) return false;
    var a = Math.atan2(py - cy, px - cx);
    if (a < 0) a += Math.PI * 2;
    return from <= to ? (a >= from && a <= to) : (a >= from || a <= to);
  };
}

function discCover(cx, cy, r) {
  return function (px, py) { return Math.hypot(px - cx, py - cy) <= r; };
}

function rectCover(x0, y0, w, h) {
  return function (px, py) { return px >= x0 && px <= x0 + w && py >= y0 && py <= y0 + h; };
}

// Треугольник через барицентрические знаки.
function triCover(ax, ay, bx, by, cx2, cy2) {
  function sign(px, py, x1, y1, x2, y2) {
    return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  }
  return function (px, py) {
    var d1 = sign(px, py, ax, ay, bx, by);
    var d2 = sign(px, py, bx, by, cx2, cy2);
    var d3 = sign(px, py, cx2, cy2, ax, ay);
    var neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    var pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(neg && pos);
  };
}

/**
 * Собственно иконка. Все размеры заданы в долях от стороны, поэтому
 * рисунок одинаково выглядит и на 16, и на 512 пикселях.
 */
function drawIcon(size) {
  var cv = createCanvas(size);
  var u = size / 512;                        // масштаб относительно эталона
  var c = size / 2;

  roundedBackground(cv, 112 * u);

  fill(cv, C.ring, ringCover(c, c, 168 * u, 16 * u));
  // Светлый сегмент кольца — «взгляд» компаса.
  fill(cv, C.ringLit, arcCover(c, c, 168 * u, 16 * u, Math.PI * 1.15, Math.PI * 1.45));

  // Румбы по четырём сторонам.
  var markLen = 34 * u;
  var markThick = 16 * u;
  fill(cv, C.mark, rectCover(c - markThick / 2, 60 * u, markThick, markLen));
  fill(cv, C.mark, rectCover(c - markThick / 2, size - 60 * u - markLen, markThick, markLen));
  fill(cv, C.mark, rectCover(60 * u, c - markThick / 2, markLen, markThick));
  fill(cv, C.mark, rectCover(size - 60 * u - markLen, c - markThick / 2, markLen, markThick));

  // Стрелка: светлая половина — север, тёмная — юг.
  fill(cv, C.needleTop, triCover(c, 118 * u, 316 * u, 300 * u, c, 262 * u));
  fill(cv, C.needleBottom, triCover(c, 394 * u, 196 * u, 212 * u, c, 250 * u));

  // Втулка в центре.
  fill(cv, C.ringLit, discCover(c, c, 26 * u));
  fill(cv, C.hub, discCover(c, c, 20 * u));

  return cv;
}

// --- сборка PNG -------------------------------------------------------------

var CRC_TABLE = (function () {
  var table = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(cv) {
  var raw = Buffer.alloc((cv.w * 4 + 1) * cv.h);
  var p = 0;
  for (var y = 0; y < cv.h; y++) {
    raw[p++] = 0;                            // фильтр строки: без фильтра
    for (var x = 0; x < cv.w; x++) {
      var i = (y * cv.w + x) * 4;
      raw[p++] = cv.data[i];
      raw[p++] = cv.data[i + 1];
      raw[p++] = cv.data[i + 2];
      raw[p++] = cv.data[i + 3];
    }
  }

  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0);
  ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8;                               // бит на канал
  ihdr[9] = 6;                               // цветовой тип: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // сжатие, фильтр, чересстрочность

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- запуск ------------------------------------------------------------------

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  SIZES.forEach(function (size) {
    var file = path.join(OUT, 'icon-' + size + '.png');
    fs.writeFileSync(file, encodePng(drawIcon(size)));
    process.stdout.write('  ' + path.basename(file) + '  ' +
      fs.statSync(file).size + ' Б\n');
  });

  // Иконка «maskable» для Android: рисунок должен пережить обрезку по кругу,
  // поэтому компас уменьшен и вписан в безопасную зону.
  var m = createCanvas(512);
  (function () {
    for (var y = 0; y < 512; y++) {
      for (var x = 0; x < 512; x++) blend(m, x, y, C.bgBottom, 1);
    }
    var small = drawIcon(320);
    var off = 96;
    for (var yy = 0; yy < 320; yy++) {
      for (var xx = 0; xx < 320; xx++) {
        var si = (yy * 320 + xx) * 4;
        if (small.data[si + 3] === 0) continue;
        blend(m, xx + off, yy + off,
          [small.data[si], small.data[si + 1], small.data[si + 2]],
          small.data[si + 3] / 255);
      }
    }
  })();
  var maskFile = path.join(OUT, 'icon-maskable-512.png');
  fs.writeFileSync(maskFile, encodePng(m));
  process.stdout.write('  ' + path.basename(maskFile) + '  ' + fs.statSync(maskFile).size + ' Б\n');
}

if (require.main === module) main();

module.exports = { drawIcon: drawIcon, encodePng: encodePng, crc32: crc32, SIZES: SIZES };
