/* «Пепел Литаний» — сидированный ГПСЧ (mulberry32).
   Все броски игры идут через этот модуль: воспроизводимость + честный лог. */
'use strict';
var RNG = (function () {
  var state = 88675123;

  function seed(s) {
    state = (s >>> 0) || 0x9e3779b9;
  }
  function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    var t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function d6() { return 1 + Math.floor(next() * 6); }
  function d3() { return 1 + Math.floor(next() * 3); }
  function int(n) { return Math.floor(next() * n); }
  function pick(arr) { return arr[int(arr.length)]; }
  function getState() { return state; }
  function setState(s) { state = (s >>> 0) || 0x9e3779b9; }

  return { seed: seed, next: next, d6: d6, d3: d3, int: int, pick: pick,
           getState: getState, setState: setState };
})();
