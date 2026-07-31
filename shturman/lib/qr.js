'use strict';

// Генератор QR-кода. Свой, без зависимостей.
//
// Задание разрешало взять пакет `qrcode`, но «скачал папку — запустил, без
// npm install и без интернета» — это заявленное свойство Штурмана, и менять
// его на одну картинку не стоит (DECISIONS.md, решение 25).
//
// Объём умеренный, потому что задача узкая: закодировать короткий URL.
// Поддержан режим byte, уровень коррекции M, версии 1-10 (до 154 байт при M —
// с запасом на «http://192.168.100.100:65535/?t=<32 hex>» = 56 символов).
// Правильность проверена побитовым сравнением с пакетом qrcode
// (tests/qr.test.js, вектор зафиксирован в фикстуре).

// ---------------------------------------------------------------------------
// Арифметика Галуа GF(256) — нужна для кодов Рида-Соломона
// ---------------------------------------------------------------------------

var EXP = new Uint8Array(512);
var LOG = new Uint8Array(256);
(function initTables() {
  var x = 1;
  for (var i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;          // порождающий многочлен QR
  }
  for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

// Многочлен-генератор степени `degree` для кодов Рида-Соломона.
function rsGenerator(degree) {
  var poly = [1];
  for (var d = 0; d < degree; d++) {
    var next = new Array(poly.length + 1).fill(0);
    for (var i = 0; i < poly.length; i++) {
      next[i] ^= poly[i];
      next[i + 1] ^= gfMul(poly[i], EXP[d]);
    }
    poly = next;
  }
  return poly;
}

// Байты коррекции ошибок для блока данных.
function rsEncode(data, ecLen) {
  var gen = rsGenerator(ecLen);
  var res = new Array(ecLen).fill(0);
  for (var i = 0; i < data.length; i++) {
    var factor = data[i] ^ res[0];
    res.shift();
    res.push(0);
    if (factor !== 0) {
      for (var j = 0; j < gen.length - 1; j++) {
        res[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// Таблицы версий (только уровень коррекции M — его хватает и он компактен)
// ---------------------------------------------------------------------------

// [версия] = {totalCodewords, ecPerBlock, group1Blocks, group1Words,
//             group2Blocks, group2Words}
var VERSIONS_M = {
  1: { total: 26, ec: 10, g1: 1, w1: 16, g2: 0, w2: 0 },
  2: { total: 44, ec: 16, g1: 1, w1: 28, g2: 0, w2: 0 },
  3: { total: 70, ec: 26, g1: 1, w1: 44, g2: 0, w2: 0 },
  4: { total: 100, ec: 18, g1: 2, w1: 32, g2: 0, w2: 0 },
  5: { total: 134, ec: 24, g1: 2, w1: 43, g2: 0, w2: 0 },
  6: { total: 172, ec: 16, g1: 4, w1: 27, g2: 0, w2: 0 },
  7: { total: 196, ec: 18, g1: 4, w1: 31, g2: 0, w2: 0 },
  8: { total: 242, ec: 22, g1: 2, w1: 38, g2: 2, w2: 39 },
  9: { total: 292, ec: 22, g1: 3, w1: 36, g2: 2, w2: 37 },
  10: { total: 346, ec: 26, g1: 4, w1: 43, g2: 1, w2: 44 }
};

// Позиции центров выравнивающих узоров по версиям.
var ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
};

function capacityBytes(version) {
  var v = VERSIONS_M[version];
  if (!v) return 0;
  var dataWords = v.g1 * v.w1 + v.g2 * v.w2;
  // 4 бита режима + счётчик длины (8 бит для версий 1-9, 16 для 10+)
  var lenBits = version < 10 ? 8 : 16;
  return dataWords - Math.ceil((4 + lenBits) / 8);
}

function pickVersion(byteLength) {
  for (var v = 1; v <= 10; v++) {
    if (byteLength <= capacityBytes(v)) return v;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Сборка потока данных
// ---------------------------------------------------------------------------

function toBytes(text) {
  return Array.from(Buffer.from(String(text), 'utf8'));
}

function buildDataCodewords(bytes, version) {
  var v = VERSIONS_M[version];
  var dataWords = v.g1 * v.w1 + v.g2 * v.w2;
  var bits = [];

  function push(value, length) {
    for (var i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  }

  push(0b0100, 4);                                   // режим: байты
  push(bytes.length, version < 10 ? 8 : 16);         // длина
  bytes.forEach(function (b) { push(b, 8); });

  // Терминатор: до четырёх нулей, но не больше, чем осталось места.
  var capacityBits = dataWords * 8;
  var terminator = Math.min(4, capacityBits - bits.length);
  for (var t = 0; t < terminator; t++) bits.push(0);
  // Добиваем до целого байта.
  while (bits.length % 8 !== 0) bits.push(0);

  var words = [];
  for (var i = 0; i < bits.length; i += 8) {
    var byte = 0;
    for (var j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    words.push(byte);
  }
  // Добивка чередующимися байтами по стандарту.
  var pad = [0xec, 0x11];
  var k = 0;
  while (words.length < dataWords) words.push(pad[k++ % 2]);
  return words;
}

// Разбиение на блоки, коррекция ошибок и чередование — как требует стандарт.
function interleave(dataWords, version) {
  var v = VERSIONS_M[version];
  var blocks = [];
  var offset = 0;

  for (var i = 0; i < v.g1; i++) {
    blocks.push(dataWords.slice(offset, offset + v.w1));
    offset += v.w1;
  }
  for (var j = 0; j < v.g2; j++) {
    blocks.push(dataWords.slice(offset, offset + v.w2));
    offset += v.w2;
  }

  var ecBlocks = blocks.map(function (b) { return rsEncode(b, v.ec); });

  var out = [];
  var maxData = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
  for (var c = 0; c < maxData; c++) {
    blocks.forEach(function (b) { if (c < b.length) out.push(b[c]); });
  }
  for (var e = 0; e < v.ec; e++) {
    ecBlocks.forEach(function (b) { out.push(b[e]); });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Раскладка модулей
// ---------------------------------------------------------------------------

function createMatrix(size) {
  var m = [];
  for (var i = 0; i < size; i++) m.push(new Array(size).fill(null));
  return m;
}

function placeFinder(m, row, col) {
  for (var r = -1; r <= 7; r++) {
    for (var c = -1; c <= 7; c++) {
      var rr = row + r;
      var cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      var inner = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      m[rr][cc] = inner ? 1 : 0;
    }
  }
}

function placeAlignment(m, version) {
  var positions = ALIGNMENT[version] || [];
  var size = m.length;
  positions.forEach(function (r) {
    positions.forEach(function (c) {
      // Пропускаем углы, где уже стоят поисковые узоры.
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) return;
      for (var dr = -2; dr <= 2; dr++) {
        for (var dc = -2; dc <= 2; dc++) {
          var dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          m[r + dr][c + dc] = dark ? 1 : 0;
        }
      }
    });
  });
}

function placeTiming(m) {
  var size = m.length;
  for (var i = 8; i < size - 8; i++) {
    var v = i % 2 === 0 ? 1 : 0;
    if (m[6][i] === null) m[6][i] = v;
    if (m[i][6] === null) m[i][6] = v;
  }
}

// Места под служебную информацию резервируем нулями, чтобы данные их обошли.
function reserveFormat(m) {
  var size = m.length;
  for (var i = 0; i < 9; i++) {
    if (m[8][i] === null) m[8][i] = 0;
    if (m[i][8] === null) m[i][8] = 0;
  }
  // Вторая копия: 8 столбцов справа в строке 8 и 7 строк снизу в столбце 8.
  for (var j = 0; j < 8; j++) {
    if (m[8][size - 1 - j] === null) m[8][size - 1 - j] = 0;
  }
  for (var k = 0; k < 7; k++) {
    if (m[size - 1 - k][8] === null) m[size - 1 - k][8] = 0;
  }
  m[size - 8][8] = 1;                    // всегда тёмный модуль
}

function reserveVersion(m, version) {
  if (version < 7) return;
  var size = m.length;
  for (var i = 0; i < 6; i++) {
    for (var j = 0; j < 3; j++) {
      if (m[i][size - 11 + j] === null) m[i][size - 11 + j] = 0;
      if (m[size - 11 + j][i] === null) m[size - 11 + j][i] = 0;
    }
  }
}

// Данные укладываются змейкой снизу вверх колонками по две.
function placeData(m, words) {
  var size = m.length;
  var bitIndex = 0;
  var total = words.length * 8;

  function nextBit() {
    if (bitIndex >= total) return 0;
    var byte = words[bitIndex >> 3];
    var bit = (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit;
  }

  var up = true;
  for (var col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;                 // колонку тайминга пропускаем
    for (var step = 0; step < size; step++) {
      var row = up ? size - 1 - step : step;
      for (var c = 0; c < 2; c++) {
        var cc = col - c;
        if (m[row][cc] !== null) continue;
        m[row][cc] = nextBit();
      }
    }
    up = !up;
  }
}

// Восемь стандартных масок.
var MASKS = [
  function (r, c) { return (r + c) % 2 === 0; },
  function (r) { return r % 2 === 0; },
  function (r, c) { return c % 3 === 0; },
  function (r, c) { return (r + c) % 3 === 0; },
  function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
  function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
  function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
  function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
];

// Какие модули служебные — их маска не трогает.
function functionMask(size, version) {
  var f = createMatrix(size);
  placeFinder(f, 0, 0);
  placeFinder(f, 0, size - 7);
  placeFinder(f, size - 7, 0);
  placeAlignment(f, version);
  placeTiming(f);
  reserveFormat(f);
  reserveVersion(f, version);
  return f.map(function (row) { return row.map(function (v) { return v !== null; }); });
}

function applyMask(m, maskIndex, reserved) {
  var fn = MASKS[maskIndex];
  var out = m.map(function (row) { return row.slice(); });
  for (var r = 0; r < m.length; r++) {
    for (var c = 0; c < m.length; c++) {
      if (reserved[r][c]) continue;
      if (fn(r, c)) out[r][c] = out[r][c] ^ 1;
    }
  }
  return out;
}

// Строка формата: уровень коррекции + маска, с кодом BCH и маскированием.
function formatBits(maskIndex) {
  var ecBits = 0b00;                      // уровень M
  var data = (ecBits << 3) | maskIndex;
  var rem = data;
  for (var i = 0; i < 10; i++) {
    rem = (rem << 1) ^ (((rem >> 9) & 1) * 0b10100110111);
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

function placeFormat(m, maskIndex) {
  var size = m.length;
  var bits = formatBits(maskIndex);
  for (var i = 0; i < 15; i++) {
    // Старший бит идёт первым: позиция i получает бит (14 - i).
    var bit = (bits >> (14 - i)) & 1;
    // Первая копия — вокруг левого верхнего поискового узора.
    if (i < 6) m[8][i] = bit;
    else if (i === 6) m[8][7] = bit;
    else if (i === 7) m[8][8] = bit;
    else if (i === 8) m[7][8] = bit;
    else m[14 - i][8] = bit;
    // Вторая копия — разнесена по двум другим углам и делится 7 + 8, а не
    // 8 + 7: ячейку (size-8, 8) занимает обязательный тёмный модуль.
    if (i < 7) m[size - 1 - i][8] = bit;
    else m[8][size - 8 + (i - 7)] = bit;
  }
  m[size - 8][8] = 1;                     // обязательный тёмный модуль
}

function versionBits(version) {
  var rem = version;
  for (var i = 0; i < 12; i++) {
    rem = (rem << 1) ^ (((rem >> 11) & 1) * 0b1111100100101);
  }
  return (version << 12) | rem;
}

function placeVersion(m, version) {
  if (version < 7) return;
  var size = m.length;
  var bits = versionBits(version);
  for (var i = 0; i < 18; i++) {
    var bit = (bits >> i) & 1;
    var r = Math.floor(i / 3);
    var c = i % 3;
    m[r][size - 11 + c] = bit;
    m[size - 11 + c][r] = bit;
  }
}

// Штраф за «плохо читаемый» узор — по нему выбирается лучшая маска.
function penalty(m) {
  var size = m.length;
  var score = 0;

  // Правило 1: пять и более одинаковых модулей подряд.
  function runs(get) {
    for (var i = 0; i < size; i++) {
      var run = 1;
      for (var j = 1; j < size; j++) {
        if (get(i, j) === get(i, j - 1)) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }
  runs(function (i, j) { return m[i][j]; });
  runs(function (i, j) { return m[j][i]; });

  // Правило 2: блоки 2x2 одного цвета.
  for (var r = 0; r < size - 1; r++) {
    for (var c = 0; c < size - 1; c++) {
      var v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  // Правило 3: узор, похожий на поисковый (1:1:3:1:1 с полем).
  var p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  var p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  function matchAt(get, i, j, pat) {
    for (var k = 0; k < pat.length; k++) if (get(i, j + k) !== pat[k]) return false;
    return true;
  }
  for (var a = 0; a < size; a++) {
    for (var b = 0; b + 11 <= size; b++) {
      if (matchAt(function (i, j) { return m[i][j]; }, a, b, p1)) score += 40;
      if (matchAt(function (i, j) { return m[i][j]; }, a, b, p2)) score += 40;
      if (matchAt(function (i, j) { return m[j][i]; }, a, b, p1)) score += 40;
      if (matchAt(function (i, j) { return m[j][i]; }, a, b, p2)) score += 40;
    }
  }

  // Правило 4: перекос доли тёмных модулей от половины, шагами по 5 %.
  // Округление вверх, а не вниз: так считает стандарт, и от этого зависит,
  // какая маска победит (проверено сравнением с эталонной библиотекой).
  var dark = 0;
  m.forEach(function (row) { row.forEach(function (v) { if (v) dark++; }); });
  var k = Math.abs(Math.ceil(((dark * 100) / (size * size)) / 5) - 10);
  score += k * 10;

  return score;
}

/**
 * Матрица QR-кода для текста. Возвращает {size, modules, version},
 * modules — массив массивов 0/1.
 */
function encode(text) {
  var bytes = toBytes(text);
  var version = pickVersion(bytes.length);
  if (!version) {
    throw new Error('Слишком длинный текст для QR-кода: ' + bytes.length +
      ' байт, максимум ' + capacityBytes(10));
  }
  var size = 17 + version * 4;
  var words = interleave(buildDataCodewords(bytes, version), version);

  var base = createMatrix(size);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, size - 7);
  placeFinder(base, size - 7, 0);
  placeAlignment(base, version);
  placeTiming(base);
  reserveFormat(base);
  reserveVersion(base, version);
  placeData(base, words);

  var reserved = functionMask(size, version);

  // Перебираем все восемь масок и берём ту, где штраф меньше.
  var best = null;
  for (var i = 0; i < 8; i++) {
    var candidate = applyMask(base, i, reserved);
    placeFormat(candidate, i);
    placeVersion(candidate, version);
    var score = penalty(candidate);
    if (!best || score < best.score) best = { score: score, mask: i, modules: candidate };
  }

  return { size: size, version: version, mask: best.mask, modules: best.modules };
}

// ---------------------------------------------------------------------------
// Отрисовка
// ---------------------------------------------------------------------------

/**
 * QR в терминал. Один символ на два модуля по вертикали (полублоки) —
 * иначе код не влезает в окно и получается вытянутым.
 */
function toAscii(text, options) {
  var opts = options || {};
  var qr = encode(text);
  var quiet = opts.quiet === undefined ? 2 : opts.quiet;
  var size = qr.size + quiet * 2;

  function dark(r, c) {
    var rr = r - quiet;
    var cc = c - quiet;
    if (rr < 0 || cc < 0 || rr >= qr.size || cc >= qr.size) return false;
    return qr.modules[rr][cc] === 1;
  }

  var lines = [];
  for (var r = 0; r < size; r += 2) {
    var line = '';
    for (var c = 0; c < size; c++) {
      var top = dark(r, c);
      var bottom = r + 1 < size ? dark(r + 1, c) : false;
      // Тёмный модуль = закрашенный полублок. Инверсия не нужна: терминал
      // тёмный, и сканеры одинаково читают оба варианта, но так привычнее.
      if (top && bottom) line += '█';
      else if (top) line += '▀';
      else if (bottom) line += '▄';
      else line += ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * QR в SVG. Одним путём, а не тысячей прямоугольников — так разметка
 * получается компактной и её не стыдно вставить прямо в страницу.
 */
function toSvg(text, options) {
  var opts = options || {};
  var qr = encode(text);
  var quiet = opts.quiet === undefined ? 4 : opts.quiet;
  var total = qr.size + quiet * 2;
  var scale = opts.scale || 1;
  var px = total * scale;

  var path = [];
  for (var r = 0; r < qr.size; r++) {
    for (var c = 0; c < qr.size; c++) {
      if (qr.modules[r][c] === 1) {
        path.push('M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z');
      }
    }
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
    '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges" role="img" ' +
    'aria-label="QR-код со ссылкой на панель">' +
    '<rect width="' + total + '" height="' + total + '" fill="' + (opts.light || '#ffffff') + '"/>' +
    '<path d="' + path.join('') + '" fill="' + (opts.dark || '#000000') + '"/>' +
    '</svg>';
}

module.exports = {
  encode: encode,
  toAscii: toAscii,
  toSvg: toSvg,
  capacityBytes: capacityBytes,
  pickVersion: pickVersion,
  VERSIONS_M: VERSIONS_M
};
