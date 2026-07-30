'use strict';

/**
 * Подставные соперники для поведенческих тестов.
 *
 * Это не стратегии лиги: они не имеют досье и не участвуют в турнире, их
 * единственная задача — воспроизводимо ставить испытуемого в нужную ситуацию.
 */

/** Соперник, играющий заданную последовательность (по кругу, если короче матча). */
function scripted(moves, id) {
  return {
    id: id || 'scripted',
    latin: 'Scripted',
    name: 'Сценарий',
    create: function () {
      var i = 0;
      return {
        move: function () {
          var m = moves[i % moves.length];
          i += 1;
          return m;
        }
      };
    }
  };
}

/** Соперник, играющий один и тот же ход. */
function constant(move, id) {
  return scripted([move], id || 'const-' + move);
}

/**
 * Соперник, который сотрудничает всегда, кроме перечисленных раундов.
 * Удобен, чтобы проверить реакцию на единичный срыв.
 */
function defectsOn(rounds, id) {
  var set = {};
  rounds.forEach(function (r) {
    set[r] = true;
  });
  return {
    id: id || 'defects-on',
    latin: 'DefectsOn',
    name: 'Срыв по расписанию',
    create: function () {
      var t = 0;
      return {
        move: function () {
          var m = set[t] ? 'D' : 'C';
          t += 1;
          return m;
        }
      };
    }
  };
}

/** Прогон стратегии против подставного соперника без шума. Возвращает ходы. */
function play(defA, defB, rounds, opts) {
  var match = require('../engine/match');
  var o = opts || {};
  var r = match.playMatch(defA, defB, {
    rounds: rounds,
    noise: typeof o.noise === 'number' ? o.noise : 0,
    seed: typeof o.seed === 'number' ? o.seed : 1,
    log: true
  });
  return {
    a: r.log.map(function (x) {
      return x.a;
    }).join(''),
    b: r.log.map(function (x) {
      return x.b;
    }).join(''),
    result: r
  };
}

/** Доля символа в строке ходов. */
function rateOf(str, ch) {
  var n = 0;
  for (var i = 0; i < str.length; i++) if (str[i] === ch) n += 1;
  return str.length ? n / str.length : 0;
}

module.exports = {
  scripted: scripted,
  constant: constant,
  defectsOn: defectsOn,
  play: play,
  rateOf: rateOf
};
