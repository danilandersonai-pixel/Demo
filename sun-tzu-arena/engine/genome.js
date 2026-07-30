'use strict';

/**
 * Геном стратегии с памятью на два последних раунда.
 *
 * Хромосома — строка из 21 символа 'C' или 'D', три участка подряд:
 *
 *   [0]      первый ход матча (истории ещё нет);
 *   [1..4]   ответ во втором раунде — истории ровно один раунд, состояний 4:
 *            индекс = 2·(мой прошлый ход = D) + (его прошлый ход = D);
 *   [5..20]  ответ во всех последующих раундах — состояний 16:
 *            индекс = 8·(мой ход два назад = D) + 4·(его ход два назад = D)
 *                   + 2·(мой прошлый = D) + (его прошлый = D).
 *
 * Всего 2^21 ≈ 2.1 млн различных стратегий. Пространство выбрано так, что в нём
 * ТОЧНО представимы почти все классики турнира: TitForTat, Pavlov, AlwaysCooperate,
 * AlwaysDefect и любые их смеси. Не представим GrimTrigger — «помню измену вечно»
 * требует неограниченной памяти, и это осознанная граница: эволюция физически
 * не может изобрести вечную месть, зато может изобрести всё остальное.
 *
 * Важно: геном читает ИСПОЛНЕННЫЕ ходы, то есть уже искажённые шумом. Свой
 * собственный сорвавшийся приказ он видит как свой ход — отдельного канала
 * «что я приказывал» у него нет. Это делает его честным участником турнира,
 * а не привилегированным.
 */

var C = 'C';
var D = 'D';

var FIRST_MOVE = 0;
var MEM1_OFFSET = 1;
var MEM1_SIZE = 4;
var MEM2_OFFSET = 5;
var MEM2_SIZE = 16;
var LENGTH = MEM2_OFFSET + MEM2_SIZE; // 21

/** Индекс состояния памяти-1: (мой прошлый, его прошлый). */
function indexMemory1(myPrev, oppPrev) {
  return (myPrev === D ? 2 : 0) | (oppPrev === D ? 1 : 0);
}

/** Индекс состояния памяти-2: (мой −2, его −2, мой −1, его −1). */
function indexMemory2(my2, opp2, my1, opp1) {
  return (
    (my2 === D ? 8 : 0) | (opp2 === D ? 4 : 0) | (my1 === D ? 2 : 0) | (opp1 === D ? 1 : 0)
  );
}

/** Случайный геном из сидированного ГПСЧ. */
function randomGenome(random) {
  var out = '';
  for (var i = 0; i < LENGTH; i++) out += random() < 0.5 ? C : D;
  return out;
}

/** Проверка формы хромосомы. */
function isValid(genome) {
  return typeof genome === 'string' && genome.length === LENGTH && /^[CD]+$/.test(genome);
}

/**
 * Равномерный кроссовер: каждый локус независимо берётся у одного из родителей.
 * Для этой хромосомы он уместнее одноточечного — соседние локусы не связаны
 * между собой ничем, кроме порядка нумерации состояний, поэтому «разрезать
 * в одном месте» значило бы придумать сцепление, которого нет.
 */
function crossover(a, b, random) {
  var out = '';
  for (var i = 0; i < LENGTH; i++) out += random() < 0.5 ? a[i] : b[i];
  return out;
}

/** Точечная мутация: каждый локус переворачивается с вероятностью rate. */
function mutate(genome, random, rate) {
  var out = '';
  for (var i = 0; i < LENGTH; i++) {
    out += random() < rate ? (genome[i] === C ? D : C) : genome[i];
  }
  return out;
}

/** Доля различающихся локусов между двумя хромосомами. */
function distance(a, b) {
  var diff = 0;
  for (var i = 0; i < LENGTH; i++) if (a[i] !== b[i]) diff += 1;
  return diff / LENGTH;
}

/**
 * Превратить хромосому в участника турнира — объект с той же фабрикой
 * `create`, что у рукописных стратегий. Никаких поблажек: тот же интерфейс,
 * та же история, тот же ГПСЧ.
 */
function toStrategy(genome, meta) {
  if (!isValid(genome)) throw new Error('Некорректный геном: ' + genome);
  var m = meta || {};
  return {
    id: m.id || 'genome',
    latin: m.latin || 'Genome',
    name: m.name || 'Геном',
    color: m.color || '#94a3b8',
    glyph: m.glyph || '碼',
    family: m.family || 'evolved',
    tagline: m.tagline || 'Хромосома ' + genome,
    genome: genome,
    dossier: m.dossier,
    create: function () {
      return {
        move: function (h) {
          var n = h.length;
          if (n === 0) return genome[FIRST_MOVE];
          if (n === 1) return genome[MEM1_OFFSET + indexMemory1(h.mine(0), h.opp(0))];
          return genome[
            MEM2_OFFSET + indexMemory2(h.mine(-2), h.opp(-2), h.mine(-1), h.opp(-1))
          ];
        }
      };
    }
  };
}

/** Что сделал бы TitForTat в состоянии памяти-2 с индексом idx. */
function titForTatAt(idx) {
  return idx & 1 ? D : C; // повторяет последний ход оппонента
}

/** Что сделал бы Pavlov: выигрышный исход прошлого раунда — повторяю ход. */
function pavlovAt(idx) {
  var my1 = idx & 2 ? D : C;
  var opp1 = idx & 1 ? D : C;
  var won = opp1 === C; // 3 (оба C) или 5 (я D, он C)
  return won ? my1 : my1 === C ? D : C;
}

/** Доля состояний, в которых геном совпадает с эталонным поведением. */
function similarityTo(genome, fn) {
  var same = 0;
  for (var idx = 0; idx < MEM2_SIZE; idx++) {
    if (genome[MEM2_OFFSET + idx] === fn(idx)) same += 1;
  }
  return same / MEM2_SIZE;
}

/**
 * Разбор хромосомы человеческим языком: на кого похожа и что делает
 * в ключевых положениях. Используется и в отчёте, и в досье выведенной
 * стратегии — досье обязано описывать то, что геном делает на самом деле.
 */
function describe(genome) {
  var at = function (my2, opp2, my1, opp1) {
    return genome[MEM2_OFFSET + indexMemory2(my2, opp2, my1, opp1)];
  };

  var table = [];
  for (var idx = 0; idx < MEM2_SIZE; idx++) {
    table.push({
      state:
        (idx & 8 ? D : C) + (idx & 4 ? D : C) + ' → ' + (idx & 2 ? D : C) + (idx & 1 ? D : C),
      answer: genome[MEM2_OFFSET + idx]
    });
  }

  return {
    genome: genome,
    firstMove: genome[FIRST_MOVE],
    table: table,
    similarity: {
      titForTat: similarityTo(genome, titForTatAt),
      pavlov: similarityTo(genome, pavlovAt),
      alwaysCooperate: similarityTo(genome, function () { return C; }),
      alwaysDefect: similarityTo(genome, function () { return D; })
    },
    traits: {
      nice: genome[FIRST_MOVE] === C,
      keepsPeace: at(C, C, C, C) === C,
      retaliates: at(C, C, C, D) === D,
      forgives: at(C, D, C, C) === C,
      escapesWar: at(D, D, D, D) === C,
      exploitsPushover: at(C, C, D, C) === D,
      repentsOwnSlip: at(C, C, D, C) === C
    }
  };
}

module.exports = {
  C: C,
  D: D,
  LENGTH: LENGTH,
  FIRST_MOVE: FIRST_MOVE,
  MEM1_OFFSET: MEM1_OFFSET,
  MEM1_SIZE: MEM1_SIZE,
  MEM2_OFFSET: MEM2_OFFSET,
  MEM2_SIZE: MEM2_SIZE,
  indexMemory1: indexMemory1,
  indexMemory2: indexMemory2,
  randomGenome: randomGenome,
  isValid: isValid,
  crossover: crossover,
  mutate: mutate,
  distance: distance,
  toStrategy: toStrategy,
  describe: describe,
  similarityTo: similarityTo,
  titForTatAt: titForTatAt,
  pavlovAt: pavlovAt
};
