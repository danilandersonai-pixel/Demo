'use strict';

var payoff = require('./payoff');
var C = payoff.COOPERATE;
var D = payoff.DEFECT;

/**
 * История матча глазами одного игрока.
 *
 * Это единственный канал, через который стратегия видит мир. Наружу торчат
 * только методы чтения: массивы ходов не отдаются по ссылке (`moves()` строит
 * копию), запись доступна лишь движку через неперечислимый `__push`.
 * Ни ссылки на оппонента, ни его объекта, ни глобального состояния турнира
 * стратегия не получает — изоляция обеспечена конструкцией, а не соглашением.
 *
 * Совокупные счётчики поддерживаются инкрементально: любая стратегия может
 * спросить «сколько раз он предавал» за O(1), не разворачивая историю.
 */
function createHistory() {
  var mine = [];
  var opp = [];

  // Счётчики совместных исходов: [мой ход][ход оппонента].
  var joint = { CC: 0, CD: 0, DC: 0, DD: 0 };
  // Переходы: что оппонент сделал ПОСЛЕ моего хода X (модель отклика).
  var afterMy = { C: { C: 0, D: 0 }, D: { C: 0, D: 0 } };

  var view = {
    /** Число сыгранных раундов. */
    get length() {
      return mine.length;
    },

    /** Мой ход с индексом i (отрицательный — с конца). undefined вне границ. */
    mine: function (i) {
      var idx = i < 0 ? mine.length + i : i;
      return mine[idx];
    },

    /** Ход оппонента с индексом i (отрицательный — с конца). */
    opp: function (i) {
      var idx = i < 0 ? opp.length + i : i;
      return opp[idx];
    },

    /** Последний мой ход или undefined в первом раунде. */
    lastMine: function () {
      return mine[mine.length - 1];
    },

    /** Последний ход оппонента или undefined в первом раунде. */
    lastOpp: function () {
      return opp[opp.length - 1];
    },

    /** Сколько раз оппонент предавал. O(1). */
    oppDefections: function () {
      return joint.CD + joint.DD;
    },

    /** Сколько раз оппонент сотрудничал. O(1). */
    oppCooperations: function () {
      return joint.CC + joint.DC;
    },

    /** Сколько раз предавал я. O(1). */
    myDefections: function () {
      return joint.DC + joint.DD;
    },

    /** Доля сотрудничества оппонента, 1 при пустой истории. */
    oppCoopRate: function () {
      if (!opp.length) return 1;
      return view.oppCooperations() / opp.length;
    },

    /** Счётчик совместного исхода: count('C', 'D') — я сотрудничал, он предал. */
    count: function (myMove, oppMove) {
      return joint[(myMove === D ? 'D' : 'C') + (oppMove === D ? 'D' : 'C')];
    },

    /**
     * Условная вероятность, что оппонент сотрудничает после моего хода `myMove`.
     * @param {'C'|'D'} myMove
     * @param {number} [prior=1] значение при отсутствии наблюдений
     */
    oppCoopAfter: function (myMove, prior) {
      var slot = afterMy[myMove === D ? 'D' : 'C'];
      var total = slot.C + slot.D;
      if (!total) return typeof prior === 'number' ? prior : 1;
      return slot.C / total;
    },

    /** Число наблюдений отклика на мой ход `myMove`. */
    oppSamplesAfter: function (myMove) {
      var slot = afterMy[myMove === D ? 'D' : 'C'];
      return slot.C + slot.D;
    },

    /**
     * Копия ходов последних n раундов (или всех). Копия, а не ссылка —
     * стратегия не может испортить историю ни себе, ни движку.
     * @param {number} [n]
     * @returns {{mine: string[], opp: string[]}}
     */
    moves: function (n) {
      var from = typeof n === 'number' ? Math.max(0, mine.length - n) : 0;
      return { mine: mine.slice(from), opp: opp.slice(from) };
    }
  };

  // Канал записи для движка: неперечислимый, в JSON и в for..in не попадает.
  Object.defineProperty(view, '__push', {
    enumerable: false,
    writable: false,
    value: function (myMove, oppMove) {
      var prevMine = mine[mine.length - 1];
      if (prevMine !== undefined) {
        afterMy[prevMine === D ? 'D' : 'C'][oppMove === D ? 'D' : 'C'] += 1;
      }
      mine.push(myMove);
      opp.push(oppMove);
      joint[(myMove === D ? 'D' : 'C') + (oppMove === D ? 'D' : 'C')] += 1;
    }
  });

  return view;
}

module.exports = { createHistory: createHistory, C: C, D: D };
