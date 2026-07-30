'use strict';

/**
 * Сидируемый ГПСЧ и вспомогательные функции для детерминированных прогонов.
 *
 * Весь недетерминизм проекта проходит здесь. Math.random() не используется
 * нигде — ни в движке, ни в стратегиях, ни в симуляции.
 */

/**
 * mulberry32 — 32-битный ГПСЧ, ~2^32 состояний, отличное распределение
 * для наших задач (бросок монеты и шум).
 *
 * @param {number} seed целое, приводится к uint32
 * @returns {function(): number} значения в [0, 1)
 */
function mulberry32(seed) {
  var a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Детерминированное смешивание произвольного числа целых в один uint32-сид.
 * Основа — FNV-1a по байтам, затем лавина (finalizer из murmur3).
 *
 * Нужен, чтобы сид каждого матча выводился из (seed, поколение, i, j), а не
 * зависел от порядка перебора пар: результат матча не меняется от того,
 * сколько матчей отыграно до него.
 *
 * @param {...number} parts целые числа
 * @returns {number} uint32
 */
function hashSeed() {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i] | 0;
    for (var b = 0; b < 4; b++) {
      h = (h ^ ((v >>> (b * 8)) & 0xff)) >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 2246822507) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 3266489909) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h >>> 0;
}

/** Множители десятичных разрядов таблицей, а не Math.pow — только целая арифметика. */
var FACTORS = [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000];

/**
 * Округление до фиксированного числа знаков — чтобы JSON-выгрузка была
 * байт-в-байт одинаковой и не тащила хвосты двоичной арифметики.
 * @param {number} value
 * @param {number} [digits=6]
 * @returns {number}
 */
function round(value, digits) {
  var d = typeof digits === 'number' ? digits : 6;
  var factor = FACTORS[d];
  var scaled = Math.round(value * factor) / factor;
  // -0 ломает побайтовое сравнение JSON, нормализуем.
  return scaled === 0 ? 0 : scaled;
}

module.exports = {
  mulberry32: mulberry32,
  hashSeed: hashSeed,
  round: round
};
