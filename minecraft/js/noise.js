/* Кубокрафт — шум Перлина (2D/3D), генератор случайных чисел и хеши с сидом.
   Всё детерминировано: один и тот же сид всегда даёт один и тот же мир. */
(function (KC) {
  'use strict';

  // Быстрый 32-битный ГПСЧ (mulberry32): возвращает функцию → [0, 1)
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Хеш целых координат → [0, 1). Нужен для деревьев, руды, цветов.
  function hash2(x, z, s) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function hash3(x, y, z, s) {
    return hash2(x ^ Math.imul(y | 0, 912367), z, s);
  }

  function Noise(seed) {
    var rnd = mulberry32(seed | 0);
    var p = new Uint8Array(256);
    var i, j, t;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {
      j = Math.floor(rnd() * (i + 1));
      t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function grad2(h, x, y) {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  }

  function grad3(h, x, y, z) {
    var hh = h & 15;
    var u = hh < 8 ? x : y;
    var v = hh < 4 ? y : (hh === 12 || hh === 14 ? x : z);
    return ((hh & 1) ? -u : u) + ((hh & 2) ? -v : v);
  }

  Noise.prototype.n2 = function (x, y) {
    var X = Math.floor(x), Y = Math.floor(y);
    x -= X; y -= Y; X &= 255; Y &= 255;
    var p = this.perm, u = fade(x), v = fade(y);
    var a = p[X] + Y, b = p[X + 1] + Y;
    return lerp(
      lerp(grad2(p[a], x, y), grad2(p[b], x - 1, y), u),
      lerp(grad2(p[a + 1], x, y - 1), grad2(p[b + 1], x - 1, y - 1), u),
      v
    );
  };

  Noise.prototype.n3 = function (x, y, z) {
    var X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z; X &= 255; Y &= 255; Z &= 255;
    var p = this.perm, u = fade(x), v = fade(y), w = fade(z);
    var A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    var B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lerp(
      lerp(
        lerp(grad3(p[AA], x, y, z), grad3(p[BA], x - 1, y, z), u),
        lerp(grad3(p[AB], x, y - 1, z), grad3(p[BB], x - 1, y - 1, z), u),
        v
      ),
      lerp(
        lerp(grad3(p[AA + 1], x, y, z - 1), grad3(p[BA + 1], x - 1, y, z - 1), u),
        lerp(grad3(p[AB + 1], x, y - 1, z - 1), grad3(p[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  };

  // Фрактальный шум: несколько октав с удвоением частоты
  Noise.prototype.fbm2 = function (x, y, octaves) {
    var sum = 0, amp = 1, norm = 0;
    for (var i = 0; i < octaves; i++) {
      sum += this.n2(x, y) * amp;
      norm += amp;
      amp *= 0.5; x *= 2.03; y *= 2.03;
    }
    return sum / norm;
  };

  KC.mulberry32 = mulberry32;
  KC.hash2 = hash2;
  KC.hash3 = hash3;
  KC.Noise = Noise;
})(window.KC = window.KC || {});
