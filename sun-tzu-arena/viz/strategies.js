/* Автоматически сгенерировано `node sim/bundle.js`. Правки будут перезаписаны.
 *
 * Исходники стратегий и движка, перенесённые в браузер дословно. Нужны
 * режиму «Сыграй сам»: человек играет против настоящего кода участника
 * лиги, а не против его пересказа на клиенте.
 *
 * Подаётся присваиванием в window, а не через fetch: страница открывается
 * с диска, где запросы к file:// блокируются браузером.
 */
window.ARENA_CODE = (function () {
  'use strict';

  var factories = {};
  var cache = {};

  function define(id, factory) { factories[id] = factory; }

  function resolve(fromDir, spec) {
    if (spec.charAt(0) !== '.') return spec;
    var parts = fromDir ? fromDir.split('/') : [];
    spec.split('/').forEach(function (seg) {
      if (seg === '.' || seg === '') return;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    });
    return parts.join('/');
  }

  function load(id) {
    if (cache[id]) return cache[id].exports;
    var factory = factories[id];
    if (!factory) throw new Error('нет модуля ' + id);
    var dir = id.split('/').slice(0, -1).join('/');
    var module = { exports: {} };
    cache[id] = module;
    factory(module, module.exports, function (spec) { return load(resolve(dir, spec)); });
    return module.exports;
  }

define("engine/payoff", function (module, exports, require) {
'use strict';

/**
 * Матрица выплат повторяющейся «дилеммы заключённого».
 *
 *                 оппонент C   оппонент D
 *   игрок C          R=3          S=0
 *   игрок D          T=5          P=1
 *
 * Классические условия дилеммы:
 *   T > R > P > S      (предать выгоднее в одном раунде)
 *   2R > T + S         (взаимное сотрудничество выгоднее чередования)
 */

var COOPERATE = 'C';
var DEFECT = 'D';

var PAYOFF = Object.freeze({
  R: 3, // Reward   — оба сотрудничают
  P: 1, // Punishment — оба предают
  T: 5, // Temptation — предал доверчивого
  S: 0 // Sucker    — тебя предали
});

/**
 * Очки за один раунд.
 *
 * Таблица передаётся параметром, а не берётся из глобальной константы. Это
 * нужно стенду устойчивости (`sim/sweep.js`), который прогоняет лигу по
 * нескольким матрицам: подменять замороженный `PAYOFF` на время прогона
 * значило бы менять глобальное состояние из-под работающего движка — приём,
 * который ломается от первой же вложенности и не выдерживает параллельных
 * прогонов. Явный параметр не ломается ни от чего.
 *
 * @param {'C'|'D'} a ход первого игрока
 * @param {'C'|'D'} b ход второго игрока
 * @param {{R:number,P:number,T:number,S:number}} [table=PAYOFF]
 * @returns {[number, number]} [очки A, очки B]
 */
function score(a, b, table) {
  var p = table || PAYOFF;
  if (a === COOPERATE) {
    return b === COOPERATE ? [p.R, p.R] : [p.S, p.T];
  }
  return b === COOPERATE ? [p.T, p.S] : [p.P, p.P];
}

/** Инверсия хода — используется шумом канала связи. */
function flip(move) {
  return move === COOPERATE ? DEFECT : COOPERATE;
}

/** Нормализация того, что вернула стратегия. Всё, кроме 'D', считается 'C'. */
function normalize(move) {
  return move === DEFECT ? DEFECT : COOPERATE;
}

/** Проверка, что дилемма — действительно дилемма. Используется в тестах. */
function isValidDilemma(p) {
  return p.T > p.R && p.R > p.P && p.P > p.S && 2 * p.R > p.T + p.S;
}

module.exports = {
  COOPERATE: COOPERATE,
  DEFECT: DEFECT,
  PAYOFF: PAYOFF,
  score: score,
  flip: flip,
  normalize: normalize,
  isValidDilemma: isValidDilemma
};

});

define("engine/rng", function (module, exports, require) {
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

/**
 * Строка → uint32 (FNV-1a). Нужен генетическому режиму: сид матча двух геномов
 * выводится из самих хромосом, а не из их номеров в популяции. Это позволяет
 * кэшировать исход пары — после схождения популяции одинаковых геномов много,
 * и без кэша большая часть работы была бы повторной, — не теряя при этом
 * воспроизводимости: результат зависит от того, КТО играет, а не от того,
 * в каком месте списка он оказался.
 * @param {string} str
 * @returns {number} uint32
 */
function hashString(str) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
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
  hashString: hashString,
  round: round
};

});

define("engine/history", function (module, exports, require) {
'use strict';

var D = require('./payoff').DEFECT;

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

module.exports = { createHistory: createHistory };

});

define("engine/genome", function (module, exports, require) {
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

});

define("engine/match", function (module, exports, require) {
'use strict';

var rngLib = require('./rng');
var payoff = require('./payoff');
var historyLib = require('./history');

var C = payoff.COOPERATE;
var D = payoff.DEFECT;

var DEFAULT_ROUNDS = 200;
var DEFAULT_NOISE = 0.05;

/**
 * Один матч: две стратегии играют `rounds` раундов повторяющейся дилеммы.
 *
 * Шум: с вероятностью `noise` ход игрока искажается на противоположный уже
 * «в канале» — то есть исполняется и наблюдается обеими сторонами (и самим
 * игроком тоже) именно искажённый ход. Это модель ошибки исполнения приказа:
 * полководец не знает, что гонец перепутал сигнал, пока не увидит последствий.
 * Броски шума для двух игроков независимы.
 *
 * Длина матча стратегиям не сообщается: в истории есть только сыгранные
 * раунды, никакого «сколько осталось».
 *
 * @param {object} defA определение стратегии A (см. strategies/index.js)
 * @param {object} defB определение стратегии B
 * @param {object} [opts]
 * @param {number} [opts.rounds=200]
 * @param {number} [opts.noise=0.05]
 * @param {number} [opts.seed=1]
 * @param {object} [opts.payoff] матрица выплат (по умолчанию каноническая)
 * @param {boolean} [opts.log=false] сохранить пораундовый лог (для тестов)
 * @returns {object} итоги матча
 */
function playMatch(defA, defB, opts) {
  var o = opts || {};
  var rounds = typeof o.rounds === 'number' ? o.rounds : DEFAULT_ROUNDS;
  var noise = typeof o.noise === 'number' ? o.noise : DEFAULT_NOISE;
  var seed = typeof o.seed === 'number' ? o.seed : 1;
  var table = o.payoff || payoff.PAYOFF;
  var keepLog = !!o.log;

  // Четыре независимых потока: шум A, шум B, монета A, монета B.
  // Раздельные потоки означают, что смена стратегии одной стороны не сдвигает
  // последовательность шума другой — прогоны остаются сопоставимыми.
  var noiseA = rngLib.mulberry32(rngLib.hashSeed(seed, 0x9e37));
  var noiseB = rngLib.mulberry32(rngLib.hashSeed(seed, 0x85eb));
  var coinA = rngLib.mulberry32(rngLib.hashSeed(seed, 0xc2b2));
  var coinB = rngLib.mulberry32(rngLib.hashSeed(seed, 0x27d4));

  var histA = historyLib.createHistory();
  var histB = historyLib.createHistory();

  var agentA = defA.create({ random: coinA });
  var agentB = defB.create({ random: coinB });

  var scoreA = 0;
  var scoreB = 0;
  var coopA = 0;
  var coopB = 0;
  var intendedCoopA = 0;
  var intendedCoopB = 0;
  var flipsA = 0;
  var flipsB = 0;
  var log = keepLog ? [] : null;

  for (var t = 0; t < rounds; t++) {
    var wantA = payoff.normalize(agentA.move(histA));
    var wantB = payoff.normalize(agentB.move(histB));

    if (wantA === C) intendedCoopA++;
    if (wantB === C) intendedCoopB++;

    var actualA = wantA;
    var actualB = wantB;
    if (noise > 0) {
      if (noiseA() < noise) {
        actualA = payoff.flip(actualA);
        flipsA++;
      }
      if (noiseB() < noise) {
        actualB = payoff.flip(actualB);
        flipsB++;
      }
    }

    var points = payoff.score(actualA, actualB, table);
    scoreA += points[0];
    scoreB += points[1];
    if (actualA === C) coopA++;
    if (actualB === C) coopB++;

    if (keepLog) {
      log.push({
        round: t,
        intendedA: wantA,
        intendedB: wantB,
        a: actualA,
        b: actualB,
        pointsA: points[0],
        pointsB: points[1]
      });
    }

    histA.__push(actualA, actualB);
    histB.__push(actualB, actualA);
  }

  return {
    a: defA.id,
    b: defB.id,
    rounds: rounds,
    scoreA: scoreA,
    scoreB: scoreB,
    avgA: rngLib.round(scoreA / rounds),
    avgB: rngLib.round(scoreB / rounds),
    coopA: rngLib.round(coopA / rounds),
    coopB: rngLib.round(coopB / rounds),
    intendedCoopA: rngLib.round(intendedCoopA / rounds),
    intendedCoopB: rngLib.round(intendedCoopB / rounds),
    flipsA: flipsA,
    flipsB: flipsB,
    log: log
  };
}

module.exports = {
  playMatch: playMatch,
  DEFAULT_ROUNDS: DEFAULT_ROUNDS,
  DEFAULT_NOISE: DEFAULT_NOISE,
  C: C,
  D: D
};

});

define("strategies/alwaysCooperate", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Пацифист» (AlwaysCooperate)
 *
 * Принцип трактата:
 *   «Сто раз сразиться и сто раз победить — это не лучшее из лучшего;
 *    лучшее из лучшего — покорить чужую армию, не сражаясь». (III. Стратегия нападения)
 *   Пацифист довёл эту мысль до абсурда: он отказался от сражения вовсе,
 *   но забыл вторую половину — покорить.
 *
 * Философия:
 *   Мир достигается тем, что никто не начинает войну первым. Всегда сотрудничает,
 *   что бы ни делал противник, сколько бы раз его ни предали.
 *
 * Сильные стороны:
 *   — идеальный партнёр: с любым «добрым» соперником даёт максимум 3.0 за раунд;
 *   — шум ему не вредит: у него нет обиды, которую можно случайно запустить;
 *   — служит питательной средой, на которой быстро растут кооперативные фракции.
 *
 * Слабые стороны:
 *   — не наказывает вообще, поэтому кормит любого эксплуататора по 5.0 за раунд;
 *   — в популяции с хищниками вымирает первым.
 *
 * Против кого рассчитана:
 *   Ни против кого. Это эталон доверия и живая мишень — по нему меряют,
 *   насколько популяция хищная.
 */

var C = 'C';

module.exports = {
  id: 'alwaysCooperate',
  latin: 'AlwaysCooperate',
  name: 'Пацифист',
  color: '#34d399',
  glyph: '和',
  family: 'classic',
  tagline: 'Сотрудничает всегда и со всеми',
  dossier: {
    principle: '«Покорить чужую армию, не сражаясь» — III. Стратегия нападения',
    philosophy:
      'Отказ от насилия как аксиома. Не наказывает, не мстит, не проверяет — ' +
      'просто протягивает руку каждый раунд.',
    strengths: ['Максимум очков в паре с любым «добрым»', 'Неуязвим к шуму — нечего сбивать'],
    weaknesses: ['Кормит эксплуататоров по 5.0 за раунд', 'Вымирает первым при хищниках'],
    targets: 'Ни против кого — эталон доверия и мера хищности популяции'
  },
  create: function () {
    return {
      move: function () {
        return C;
      }
    };
  }
};

});

define("strategies/alwaysDefect", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Агрессор» (AlwaysDefect)
 *
 * Принцип трактата (вывернутый наизнанку):
 *   «Война любит победу и не любит продолжительности». (II. Ведение войны)
 *   Агрессор услышал только первую половину и воюет всегда — не понимая,
 *   что затяжная война разоряет и победителя.
 *
 * Философия:
 *   Предательство доминирует в одном раунде: T > R и P > S. Значит, предавать
 *   надо всегда. Логика безупречна ровно до тех пор, пока раунд один.
 *
 * Сильные стороны:
 *   — никогда не проигрывает в очной паре: соперник не может набрать больше;
 *   — выкашивает доверчивых, взлетая на первых поколениях;
 *   — шум ему только на пользу: чужие срывы ломают чужие союзы, не его.
 *
 * Слабые стороны:
 *   — против себе подобных живёт на 1.0 за раунд вместо 3.0;
 *   — уничтожает собственную кормовую базу и умирает от голода;
 *   — злопамятные соперники запирают его в вечном взаимном предательстве.
 *
 * Против кого рассчитана:
 *   Против доверчивых — «Пацифиста», «Хаоса» и любых стратегий,
 *   не умеющих наказывать.
 */

var D = 'D';

module.exports = {
  id: 'alwaysDefect',
  latin: 'AlwaysDefect',
  name: 'Агрессор',
  color: '#ff4d5e',
  glyph: '戈',
  family: 'classic',
  tagline: 'Предаёт всегда и всех',
  dossier: {
    principle: '«Война любит победу и не любит продолжительности» — II. Ведение войны',
    philosophy:
      'Предательство доминирует в отдельно взятом раунде, значит — всегда. ' +
      'Безупречная логика для игры длиной в один ход.',
    strengths: ['Не проигрывает ни одной очной пары', 'Выкашивает доверчивых на старте'],
    weaknesses: [
      'Против себе подобных живёт на 1.0 вместо 3.0',
      'Съедает кормовую базу и умирает от голода'
    ],
    targets: '«Пацифист», «Хаос» и все, кто не умеет наказывать'
  },
  create: function () {
    return {
      move: function () {
        return D;
      }
    };
  }
};

});

define("strategies/random", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Хаос» (Random)
 *
 * Принцип трактата:
 *   «Будь неуловим до бесформенности, будь беззвучен до неслышимости —
 *    и станешь властелином судьбы противника». (VI. Полнота и пустота)
 *   Хаос понял «бесформенность» буквально: у него нет формы, потому что нет
 *   и замысла. Непредсказуемость без цели — это не стратегия, а погода.
 *
 * Философия:
 *   Монетка. 50/50 каждый раунд, без памяти и без модели противника.
 *
 * Сильные стороны:
 *   — его нельзя смоделировать: любая история предсказывает следующий ход на 50%;
 *   — не поддаётся ни устрашению, ни подкупу — его нечем шантажировать.
 *
 * Слабые стороны:
 *   — не пользуется информацией вообще, поэтому проигрывает всем, кто ею пользуется;
 *   — рвёт кооперацию у «добрых» стратегий, но и сам с них ничего не собирает.
 *
 * Против кого рассчитана:
 *   Ни против кого. Это контрольный шум — по нему видно, кто умеет отличать
 *   случайность от намерения.
 *
 * Детерминизм: берёт ГПСЧ из `api.random`, засеянный движком. Math.random() не
 * используется, иначе прогон перестал бы воспроизводиться.
 */

module.exports = {
  id: 'random',
  latin: 'Random',
  name: 'Хаос',
  color: '#a78bfa',
  glyph: '亂',
  family: 'classic',
  tagline: 'Монетка каждый раунд',
  dossier: {
    principle: '«Будь неуловим до бесформенности» — VI. Полнота и пустота',
    philosophy:
      'Бесформенность, понятая буквально: ни памяти, ни модели противника. ' +
      'Непредсказуемость без замысла — это погода, а не стратегия.',
    strengths: ['Не моделируется: любая история даёт 50%', 'Неподкупен и неустрашим'],
    weaknesses: ['Не использует информацию вообще', 'Рвёт кооперацию, ничего не собирая взамен'],
    targets: 'Ни против кого — контрольный шум турнира'
  },
  create: function (api) {
    var random = api.random;
    return {
      move: function () {
        return random() < 0.5 ? 'C' : 'D';
      }
    };
  }
};

});

define("strategies/titForTat", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Зеркало» (TitForTat)
 *
 * Принцип трактата:
 *   «Если противник силён — уклоняйся; если он в гневе — приведи его в замешательство».
 *   (I. Предварительные расчёты)
 *   Зеркало не имеет собственного характера: оно возвращает противнику его же
 *   лицо. Победить Зеркало можно только победив себя.
 *
 * Философия:
 *   Начинай с доверия, затем повторяй последний ход противника. Ровно четыре
 *   свойства: доброта (никогда не предаёт первым), мстительность (отвечает сразу),
 *   отходчивость (прощает сразу после исправления), понятность (читается за раунд).
 *
 * Сильные стороны:
 *   — не проигрывает никому больше, чем на одно предательство;
 *   — прозрачен, поэтому выгодно кооперироваться именно с ним;
 *   — исторический победитель турниров Аксельрода в мире без шума.
 *
 * Слабые стороны:
 *   — при шуме попадает в «эхо»: одно искажение запускает цепочку взаимных
 *     упрёков, которая сама не заканчивается — двое Зеркал теряют около трети
 *     возможных очков просто из-за помех;
 *   — никогда не выигрывает очную пару, только не проигрывает.
 *
 * Против кого рассчитана:
 *   Против эксплуататоров — сразу закрывает им кормушку. И против самой себя:
 *   в чистой среде две копии живут на максимуме.
 */

var C = 'C';
var D = 'D';

module.exports = {
  id: 'titForTat',
  latin: 'TitForTat',
  name: 'Зеркало',
  color: '#38bdf8',
  glyph: '鏡',
  family: 'classic',
  tagline: 'Повторяет последний ход противника',
  dossier: {
    principle: '«Если противник в гневе — приведи его в замешательство» — I. Предварительные расчёты',
    philosophy:
      'Нет собственного характера — есть отражение. Доброе начало, мгновенный ответ, ' +
      'мгновенное прощение, полная предсказуемость.',
    strengths: ['Не проигрывает больше одного предательства', 'С ним выгодно дружить — он читаем'],
    weaknesses: [
      'Эхо при шуме: одно искажение — цепочка взаимных упрёков',
      'Никогда не выигрывает очную пару'
    ],
    targets: 'Против эксплуататоров и против собственной копии'
  },
  create: function () {
    return {
      move: function (h) {
        if (h.length === 0) return C;
        return h.lastOpp() === D ? D : C;
      }
    };
  }
};

});

define("strategies/grimTrigger", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Мститель» (GrimTrigger)
 *
 * Принцип трактата:
 *   «Разгневанный снова может стать весёлым, обидевшийся снова может стать
 *    радостным, но погибшее государство вновь не возродится». (XII. Огневое нападение)
 *   Мститель вычитал из этой главы только последнюю строку: то, что сломано,
 *   не восстанавливают.
 *
 * Философия:
 *   Абсолютное доверие до первого предательства и абсолютная война после.
 *   Никаких вторых шансов, никакого разбора обстоятельств.
 *
 * Сильные стороны:
 *   — самая дешёвая угроза в турнире: одного предательства достаточно, чтобы
 *     навсегда закрыть противнику доступ к сотрудничеству;
 *   — идеален против «Агрессора» и любых пробующих на прочность.
 *
 * Слабые стороны:
 *   — не отличает намерение от помехи: при 5% шума почти каждый матч
 *     срывается в вечную войну, включая матч с самим собой;
 *   — уничтожает свою же кооперацию — платит за принципиальность 1.0 за раунд.
 *
 * Против кого рассчитана:
 *   Против пробующих: «Разведки боем», «Приманки», «Агрессора». Его смерть —
 *   не чужая стратегия, а шум.
 */

var C = 'C';
var D = 'D';

module.exports = {
  id: 'grimTrigger',
  latin: 'GrimTrigger',
  name: 'Мститель',
  color: '#fb7c3c',
  glyph: '仇',
  family: 'classic',
  tagline: 'Одно предательство — вечная война',
  dossier: {
    principle: '«Погибшее государство вновь не возродится» — XII. Огневое нападение',
    philosophy:
      'Полное доверие до первой измены и полная война после. Обстоятельства не ' +
      'рассматриваются, вторых шансов не бывает.',
    strengths: ['Самая дешёвая угроза в турнире', 'Идеален против пробующих на прочность'],
    weaknesses: [
      'Не отличает намерение от помехи — шум губит даже матч с собой',
      'Платит за принципиальность 1.0 за раунд'
    ],
    targets: 'Против «Агрессора», «Приманки», «Разведки боем»'
  },
  create: function () {
    var betrayed = false;
    return {
      move: function (h) {
        if (h.length === 0) return C;
        if (h.lastOpp() === D) betrayed = true;
        return betrayed ? D : C;
      }
    };
  }
};

});

define("strategies/pavlov", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Прагматик» (Pavlov, win-stay lose-shift)
 *
 * Принцип трактата:
 *   «Кто умеет побеждать, тот меняет свои приёмы в зависимости от противника,
 *    как вода сообразуется с местностью». (VI. Полнота и пустота)
 *   Прагматик не спрашивает, кто перед ним. Он спрашивает: сработало или нет.
 *
 * Философия:
 *   Win-stay, lose-shift. Победный исход (получил 3 или 5) — повторяю ход.
 *   Проигрышный (получил 1 или 0) — меняю. Никакой модели противника,
 *   только собственная касса.
 *
 * Сильные стороны:
 *   — сам находит взаимное сотрудничество и держится в нём, пока оно приносит 3;
 *   — эксплуатирует «Пацифиста» намертво: 5 за раунд — это «выигрыш», значит,
 *     ход не меняется;
 *   — из взаимного предательства (P=1 — проигрыш) выходит сам, поэтому
 *     переносит шум лучше «Зеркала».
 *
 * Слабые стороны:
 *   — S=0 заставляет его отвечать предательством, а T=5 — закрепляться в нём,
 *     поэтому против «Хаоса» он дёргается вслед за монеткой;
 *   — его логику легко просчитать: 4 состояния, никакой скрытности.
 *
 * Против кого рассчитана:
 *   Против доверчивых (доит их) и против шумных сред (сам себя восстанавливает).
 */

var C = 'C';
var D = 'D';

module.exports = {
  id: 'pavlov',
  latin: 'Pavlov',
  name: 'Прагматик',
  color: '#fbbf24',
  glyph: '利',
  family: 'classic',
  tagline: 'Сработало — повторяю, нет — меняю',
  dossier: {
    principle: '«Меняет приёмы в зависимости от противника» — VI. Полнота и пустота',
    philosophy:
      'Win-stay, lose-shift. Не спрашивает, кто перед ним, — спрашивает, ' +
      'сработал ли прошлый ход. Вся модель мира — собственная касса.',
    strengths: [
      'Сам находит взаимное сотрудничество и держит его',
      'Выходит из взаимного предательства без посторонней помощи'
    ],
    weaknesses: ['Дёргается вслед за «Хаосом»', 'Просчитывается за четыре состояния'],
    targets: 'Против доверчивых и против шумных сред'
  },
  create: function () {
    var last = C;
    return {
      move: function (h) {
        if (h.length === 0) return last;
        // Мой ход мог быть искажён шумом — исходом владеет то, что реально
        // легло на стол, поэтому «повторяю» относится к исполненному ходу.
        var mine = h.mine(-1);
        var opp = h.opp(-1);
        var gotWin = opp === C; // 3 (оба C) или 5 (я D, он C)
        last = gotWin ? mine : mine === C ? D : C;
        return last;
      }
    };
  }
};

});

define("strategies/knowTheEnemy", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Соглядатай» (KnowTheEnemy) — авторская стратегия
 *
 * Принцип трактата:
 *   «Знай противника и знай себя — и в ста сражениях ты не потерпишь поражения».
 *   (III. Стратегия нападения)
 *   «Знание положения противника можно получить только от людей». (XIII. Использование шпионов)
 *
 * Философия:
 *   Не иметь любимого хода. Иметь модель противника и играть лучший ответ на неё.
 *   Соглядатай оценивает по истории две условные вероятности:
 *
 *     pC = P(он сотрудничает | я сотрудничал в прошлом раунде)
 *     pD = P(он сотрудничает | я предал в прошлом раунде)
 *
 *   и сравнивает установившуюся ценность двух чистых курсов:
 *
 *     курс «мир»:  V_C = R·pC + S·(1−pC) = 3·pC
 *     курс «война»: V_D = T·pD + P·(1−pD) = 1 + 4·pD
 *
 *   Что больше — тем и живёт. Это даёт правильный ответ автоматически:
 *   против «Пацифиста» (pC=pD=1) V_D=5 > V_C=3 — доить; против «Зеркала»
 *   (pC≈1, pD≈0) V_C=3 > V_D=1 — дружить; против «Агрессора» (pC=pD=0)
 *   V_D=1 > V_C=0 — сдерживать; против «Хаоса» (pC=pD≈0.5) V_D=3 > V_C=1.5 —
 *   не церемониться.
 *
 *   Три инженерных решения, без которых схема разваливается:
 *
 *   1. Окно в 50 раундов. «Знание положения противника» устаревает: соперник
 *      меняет режим (у «Приманки» маска падает на 18-м раунде, у «Терпения»
 *      жатва начинается на 120-м). Наблюдения старше окна выбрасываются,
 *      счётчики поддерживаются инкрементально.
 *
 *   2. Разведка и контрольные зонды. pD нельзя оценить, ни разу не предав, —
 *      отсюда три разведочных предательства в начале. Дальше: если курс мирный,
 *      раз в 60 раундов проверяем одним предательством, не появилась ли нажива;
 *      если курс военный, раз в 25 раундов пробуем три раунда мира. Второй зонд
 *      важнее первого: без него долгая война выедает из окна все наблюдения
 *      о сотрудничестве, модель мира замерзает и война становится вечной —
 *      худший из возможных исходов для того, кто гордится знанием врага.
 *      Три раунда, а не один, потому что первый ход зонда наблюдается ещё как
 *      отклик на предательство, и только со второго начинает измерять мир.
 *
 *   3. Сглаживание по Лапласу и порог MARGIN. Обе оценки считаются как
 *      (наблюдений + 1) / (всего + 2), поэтому единичная помеха не переворачивает
 *      вывод, а при равенстве курсов побеждает мир: дешёвая победа лучше дорогой.
 *      Порог существует не из миролюбия, а из расчёта — ошибочная война
 *      разрушает источник дохода, ошибочный мир не разрушает ничего.
 *
 * Сильные стороны:
 *   — единственный, кто автоматически выбирает верный курс против любого архетипа,
 *     не имея о нём никаких предварительных знаний;
 *   — решает по накопленной статистике, а не по последнему ходу, поэтому 5% шума
 *     почти не сбивают его с курса;
 *   — окно позволяет заметить, что противник сменил режим, и переиграть заново.
 *
 * Слабые стороны:
 *   — первые ~20 раундов играет вслепую и успевает отдать очки;
 *   — против «Мстителя» первый же разведочный зонд ломает матч навсегда: цена
 *     знания оказывается выше самого знания;
 *   — против собственной копии зонды двух соглядатаев резонируют, и матч
 *     проходит заметно хуже, чем у простого «Зеркала». Это жёсткий потолок:
 *     чем больше в популяции соглядатаев, тем хуже живёт каждый, поэтому
 *     фракция физически не способна к доминированию.
 *
 * Против кого рассчитана:
 *   Против всей смешанной популяции сразу. Это не контрстратегия к кому-то
 *   одному — это отказ от единственной формы.
 */

var C = 'C';
var D = 'D';

var OPENING = 4; // раундов доброй воли перед разведкой
var PROBE_BUDGET = 3; // сколько наблюдений отклика на предательство нужно набрать
var PROBE_DEADLINE = 24; // после этого раунда разведка прекращается в любом случае
var WINDOW = 50; // глубина памяти модели, раундов
var REFRESH_WAR = 60; // как часто проверять, не появилась ли нажива
var REFRESH_PEACE = 25; // как часто проверять, не появился ли шанс на мир
var PEACE_PROBE_LEN = 3; // длительность зонда мира
var MARGIN = 0.05; // перевес, необходимый чтобы предпочесть войну миру

module.exports = {
  id: 'knowTheEnemy',
  latin: 'KnowTheEnemy',
  name: 'Соглядатай',
  color: '#a3e635',
  glyph: '諜',
  family: 'authored',
  tagline: 'Строит модель врага и играет лучший ответ',
  dossier: {
    principle: '«Знай противника и знай себя — и в ста сражениях не потерпишь поражения» — III',
    philosophy:
      'Не иметь любимого хода. По окну из 50 раундов оценить P(он сотрудничает | мой ' +
      'прошлый ход) и сравнить ценность двух курсов: 3·pC против 1 + 4·pD. Что больше — ' +
      'тем и жить, освежая карту зондами в обе стороны.',
    strengths: [
      'Сам находит верный курс против любого архетипа, ничего о нём не зная',
      'Решает по статистике окна, а не по последнему ходу — шум ему не указ',
      'Замечает смену режима у противника и переигрывает заново'
    ],
    weaknesses: [
      'Первые ~20 раундов играет вслепую',
      'Разведочный зонд навсегда ломает матч с «Мстителем»',
      'Зонды двух соглядатаев резонируют — фракция не способна к доминированию'
    ],
    targets: 'Против всей смешанной популяции сразу'
  },
  create: function () {
    // Инкрементальные счётчики переходов в окне: ключ = мой прошлый ход + его текущий.
    var counts = { CC: 0, CD: 0, DC: 0, DD: 0 };
    var ring = [];
    var ingested = 0; // индекс последнего учтённого перехода

    var sinceC = 0; // раундов подряд без моего сотрудничества
    var sinceD = 0; // раундов подряд без моего предательства
    var peaceProbe = 0; // осталось раундов зонда мира

    /** Учесть все новые переходы: мой ход k−1 → его ход k. */
    function ingest(h) {
      var n = h.length;
      while (ingested < n - 1) {
        var k = ingested + 1;
        var key = (h.mine(k - 1) === D ? 'D' : 'C') + (h.opp(k) === D ? 'D' : 'C');
        counts[key] += 1;
        ring.push(key);
        if (ring.length > WINDOW) counts[ring.shift()] -= 1;
        ingested = k;
      }
    }

    /** Ценность курса «мир»: 3·pC, оценка сглажена по Лапласу. */
    function peaceValue() {
      return (3 * (counts.CC + 1)) / (counts.CC + counts.CD + 2);
    }

    /** Ценность курса «война»: 1 + 4·pD, та же схема сглаживания. */
    function warValue() {
      return 1 + (4 * (counts.DC + 1)) / (counts.DC + counts.DD + 2);
    }

    function decide(h) {
      var n = h.length;

      // Открытие: доброжелательность как приглашение раскрыться.
      if (n < OPENING) return C;

      // Разведка: без наблюдений отклика на предательство модель неполна.
      if (h.oppSamplesAfter(D) < PROBE_BUDGET && n < PROBE_DEADLINE) return D;

      if (peaceProbe > 0) {
        peaceProbe -= 1;
        return C;
      }

      if (warValue() > peaceValue() + MARGIN) {
        // Курс военный. Но если война идёт давно, из окна выпали все наблюдения
        // о том, что бывает после моего сотрудничества, — надо их обновить.
        if (sinceC >= REFRESH_PEACE) {
          peaceProbe = PEACE_PROBE_LEN - 1;
          return C;
        }
        return D;
      }

      // Курс мирный. Обратная проверка: не превратился ли партнёр в жертву.
      return sinceD >= REFRESH_WAR ? D : C;
    }

    return {
      move: function (h) {
        ingest(h);
        var m = decide(h);
        if (m === C) {
          sinceC = 0;
          sinceD += 1;
        } else {
          sinceD = 0;
          sinceC += 1;
        }
        return m;
      }
    };
  }
};

});

define("strategies/winWithoutFighting", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Миротворец» (WinWithoutFighting) — авторская стратегия
 *
 * Принцип трактата:
 *   «Лучшее из лучшего — покорить чужую армию, не сражаясь». (III. Стратегия нападения)
 *   «Если ты вынужден воевать — бей коротко: затяжная война не приносила выгоды
 *    ни одному государству». (II. Ведение войны)
 *
 * Философия:
 *   Наказание — не месть, а инструмент возврата противника за стол переговоров.
 *   Значит, оно должно быть: (1) отложенным — сначала проверить, было ли
 *   предательство намеренным; (2) соразмерным — ровно столько раундов, сколько
 *   нужно, чтобы война стала невыгодной; (3) обязательно завершённым оливковой
 *   ветвью — после наказания Миротворец делает безусловный шаг навстречу,
 *   иначе взаимная месть не имеет выхода.
 *
 *   Отдельная механика — покаяние. Собственный ход мог быть искажён помехой:
 *   Миротворец помнит, что приказывал, и видит в истории, что было исполнено.
 *   Обнаружив собственный сорвавшийся ход, он не отвечает на ответную кару,
 *   а платит контрибуцию — два раунда чистого сотрудничества. Именно это
 *   вытаскивает его из «эха», в котором тонет «Зеркало».
 *
 *   И знание меры: «Не следует осаждать крепости». Если противник за первые
 *   двадцать раундов показал, что предаёт более чем в половине случаев, война
 *   с ним не окупится никогда — Миротворец переходит к чистому сдерживанию
 *   и перестаёт тратить очки на попытки примирения.
 *
 * Сильные стороны:
 *   — лучшая стратегия в шумной среде: покаяние и прощение гасят ложные конфликты;
 *   — не проигрывает эксплуататорам: режим сдерживания закрывает кормушку;
 *   — с любым «добрым» соперником удерживает почти чистые 3.0.
 *
 * Слабые стороны:
 *   — порог прощения (12% предательств) делает его дойной коровой для того,
 *     кто предаёт чуть реже порога;
 *   — оливковая ветвь после наказания — бесплатное очко для хищника;
 *   — против «Хаоса» тратит раунды на диагностику, прежде чем махнуть рукой.
 *
 * Против кого рассчитана:
 *   Против шума в первую очередь, во вторую — против злопамятных
 *   («Мститель», «Зеркало»), с которыми обычные мстители сваливаются в вечную войну.
 */

var C = 'C';
var D = 'D';

var NOISE_TOLERANCE = 0.12; // ниже этой доли предательств считаем помехой
var HOPELESS_RATE = 0.55; // выше этой — воевать не окупится
var HOPELESS_AFTER = 20; // раньше этого раунда приговор не выносим
var APOLOGY_ROUNDS = 2; // контрибуция за собственный сорвавшийся ход
var MAX_PUNISH = 2; // наказание не длиннее двух раундов

module.exports = {
  id: 'winWithoutFighting',
  latin: 'WinWithoutFighting',
  name: 'Миротворец',
  color: '#f472b6',
  glyph: '謀',
  family: 'authored',
  tagline: 'Наказывает ровно настолько, чтобы вернуть мир',
  dossier: {
    principle: '«Покорить чужую армию, не сражаясь» — III. Стратегия нападения',
    philosophy:
      'Наказание — инструмент возврата к столу переговоров, а не месть: отложенное, ' +
      'соразмерное и всегда завершённое оливковой ветвью. Свой сорвавшийся ход ' +
      'признаёт и оплачивает контрибуцией.',
    strengths: [
      'Покаяние и прощение гасят ложные конфликты — лучший в шумной среде',
      'Режим сдерживания закрывает кормушку эксплуататорам'
    ],
    weaknesses: [
      'Дойная корова для того, кто предаёт чуть реже 12%',
      'Оливковая ветвь — бесплатное очко для хищника'
    ],
    targets: 'Против шума и против злопамятных, с которыми все прочие сваливаются в вечную войну'
  },
  create: function () {
    var intended = C; // что я приказал в прошлом раунде
    var apology = 0; // осталось раундов контрибуции
    var punish = 0; // осталось раундов наказания
    var oliveBranch = false; // следующий ход — безусловный шаг навстречу
    var deterrence = false; // окончательный приговор: воевать не окупится

    function decide(h) {
      var n = h.length;
      if (n === 0) return C;

      // Помеха в собственном приказе — признать и оплатить.
      if (h.mine(-1) !== intended) {
        apology = APOLOGY_ROUNDS;
        punish = 0;
        oliveBranch = false;
      }

      if (deterrence) return D;

      var defections = h.oppDefections();
      var defRate = defections / n;

      if (n >= HOPELESS_AFTER && defRate > HOPELESS_RATE) {
        deterrence = true;
        return D;
      }

      if (apology > 0) {
        apology -= 1;
        return C;
      }

      if (punish > 0) {
        punish -= 1;
        if (punish === 0) oliveBranch = true;
        return D;
      }

      if (oliveBranch) {
        oliveBranch = false;
        return C; // безусловный шаг навстречу — выход из спирали мести
      }

      if (h.lastOpp() === C) return C;

      // Он предал. Единичный срыв на фоне доброго поведения — почти наверняка помеха.
      if (defRate <= NOISE_TOLERANCE) return C;

      // Наказание соразмерно упорству: чем чаще предаёт, тем длиннее ответ.
      var length = defRate > 0.35 ? MAX_PUNISH : 1;
      punish = length - 1;
      if (punish === 0) oliveBranch = true;
      return D;
    }

    return {
      move: function (h) {
        var m = decide(h);
        intended = m;
        return m;
      }
    };
  }
};

});

define("strategies/feignedWeakness", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Приманка» (FeignedWeakness) — авторская стратегия
 *
 * Принцип трактата:
 *   «Война — это путь обмана. Поэтому, если ты и можешь что-нибудь, показывай
 *    противнику, будто не можешь; если ты и пользуешься чем-нибудь, показывай ему,
 *    будто ты этим не пользуешься». (I. Предварительные расчёты)
 *   «Приманивай его выгодой, приведи в расстройство и бери его». (там же)
 *
 * Философия:
 *   Восемнадцать раундов Приманка неотличима от «Пацифиста»: чистое сотрудничество,
 *   никакой мести, никаких зондов. Это не доброта, а разведка под прикрытием —
 *   она смотрит, кто польстится на беззащитность.
 *
 *   На восемнадцатом раунде маска снимается и открывается один из трёх путей:
 *
 *     — соперник клюнул и грабил (>20% предательств) → «Сдерживание»: приманка
 *       не сработала, ловушка захлопывается пустой, дальше только вечное D,
 *       чтобы не платить дальше;
 *     — соперник вёл себя прилично → «Захват»: шесть раундов чистого предательства,
 *       и всё внимание на ответ. Мстит ли он?
 *         · мстит (≥30% предательств в окне захвата) → «Отступление в Зеркало»:
 *           тот, кто огрызается, не добыча; с ним выгоднее мир, чем война;
 *         · терпит → «Доение»: вечное предательство, но с проверкой — если
 *           жертва вдруг очнётся и её сотрудничество за последние 10 раундов
 *           упадёт ниже половины, Приманка тоже отступает в Зеркало.
 *
 *   Отступление устроено не как простое переключение режима, и это принципиально.
 *   Ответные удары, полученные во время захвата, Приманка вызвала сама. Если
 *   считать их изменой соперника, зеркало начнёт мстить за собственную
 *   провокацию, и с тем, с кем возможен мир по 3.0 за раунд, получится вечная
 *   война по 1.0. Поэтому отступление включает амнистию — два раунда
 *   безусловного сотрудничества, чтобы соперник успел отыграть месть, — и
 *   обнуляет счёт: поведение соперника оценивается заново, с этого раунда.
 *
 * Сильные стороны:
 *   — единственная, кто отличает «доброго и зубастого» от «доброго и беззащитного»,
 *     и берёт максимум с каждого;
 *   — выглядит идеальной жертвой ровно столько, сколько нужно, чтобы её недооценили;
 *   — 5.0 за раунд против «Пацифиста» — лучший результат в турнире.
 *
 * Слабые стороны:
 *   — 18 раундов бесплатного корма для «Агрессора» — самый дорогой вход в турнире;
 *   — захват необратимо ломает матч с «Мстителем»;
 *   — против таких же обманщиков обе маски падают одновременно, и обе проигрывают.
 *
 * Против кого рассчитана:
 *   Против «доброго большинства»: «Пацифист», мягкие прощающие стратегии,
 *   всё, что путает щедрость с бесконечным кредитом.
 */

var C = 'C';
var D = 'D';

var MASK_UNTIL = 18; // сколько раундов носить личину простака
var SPRING_LENGTH = 6; // длительность захвата
var GREEDY_THRESHOLD = 0.2; // выше — соперник сам оказался хищником
var RETALIATION_THRESHOLD = 0.3; // выше — он огрызается, доить нельзя
var WAKEUP_WINDOW = 10; // окно, в котором отслеживаем пробуждение жертвы
var WAKEUP_THRESHOLD = 0.5; // ниже этой кооперации жертва считается очнувшейся
var AMNESTY_ROUNDS = 2; // безусловный мир после отступления
var AMNESTY_TOLERANCE = 0.15; // доля предательств после отступления, списываемая на шум

module.exports = {
  id: 'feignedWeakness',
  latin: 'FeignedWeakness',
  name: 'Приманка',
  color: '#d97757',
  glyph: '詭',
  family: 'authored',
  tagline: 'Восемнадцать раундов простака, потом ловушка',
  dossier: {
    principle: '«Война — это путь обмана: можешь — покажи, что не можешь» — I',
    philosophy:
      'Личина «Пацифиста» на 18 раундов — не доброта, а разведка под прикрытием. ' +
      'Потом захват на шесть раундов и приговор: доить, сдерживать или отступить ' +
      'с амнистией — за собственную провокацию мстить нельзя.',
    strengths: [
      'Отличает доброго и зубастого от доброго и беззащитного',
      '5.0 за раунд против «Пацифиста» — лучший результат турнира'
    ],
    weaknesses: [
      '18 раундов бесплатного корма для «Агрессора»',
      'Захват необратимо ломает матч с «Мстителем»'
    ],
    targets: 'Против доброго большинства, путающего щедрость с бесконечным кредитом'
  },
  create: function () {
    var mode = 'mask'; // mask → spring → milk | mirror | deter
    var springStart = -1;
    var mirrorStart = -1; // с какого раунда считать поведение соперника заново
    var amnesty = 0; // раунды безусловного мира после отступления

    /**
     * Отступление после неудачной ловушки.
     *
     * Соперник огрызся — значит, он не добыча, и продолжать войну убыточно:
     * «если не можешь победить, не воюй». Но просто переключиться в зеркало
     * мало. Ответные удары, которые Приманка сама и вызвала, лежат в её
     * статистике и заставили бы зеркало мстить за собственную провокацию —
     * получилась бы вечная взаимная война с тем, с кем возможен мир по 3.0.
     * Поэтому отступление включает амнистию (два раунда безусловного
     * сотрудничества, чтобы дать сопернику отыграть месть) и обнуление
     * счёта: поведение соперника оценивается заново, с этого раунда.
     */
    function retreat(n) {
      mode = 'mirror';
      mirrorStart = n;
      amnesty = AMNESTY_ROUNDS;
    }

    /** Доля предательств оппонента в диапазоне раундов [from, to). */
    function defectionsIn(h, from, to) {
      var end = Math.min(to, h.length);
      if (end <= from) return 0;
      var d = 0;
      for (var i = from; i < end; i++) {
        if (h.opp(i) === D) d += 1;
      }
      return d / (end - from);
    }

    return {
      move: function (h) {
        var n = h.length;

        if (mode === 'mask') {
          if (n < MASK_UNTIL) return C;
          // Маска отработала — читаем, что соперник с ней сделал.
          if (h.oppDefections() / n > GREEDY_THRESHOLD) {
            mode = 'deter';
            return D;
          }
          mode = 'spring';
          springStart = n;
          return D;
        }

        if (mode === 'spring') {
          if (n < springStart + SPRING_LENGTH) return D;
          var bite = defectionsIn(h, springStart + 1, n);
          if (bite >= RETALIATION_THRESHOLD) {
            retreat(n);
            return C;
          }
          mode = 'milk';
          return D;
        }

        if (mode === 'milk') {
          // Жертва может очнуться — тогда доить дороже, чем зеркалить.
          if (n >= WAKEUP_WINDOW) {
            var recent = 1 - defectionsIn(h, n - WAKEUP_WINDOW, n);
            if (recent < WAKEUP_THRESHOLD) {
              retreat(n);
              return C;
            }
          }
          return D;
        }

        if (mode === 'deter') return D;

        // mode === 'mirror': зеркало с поправкой на шум и с чистого листа.
        if (amnesty > 0) {
          amnesty -= 1;
          return C;
        }
        if (h.lastOpp() === C) return C;
        return defectionsIn(h, mirrorStart, n) <= AMNESTY_TOLERANCE ? C : D;
      }
    };
  }
};

});

define("strategies/patience", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Терпение» (Patience) — авторская стратегия
 *
 * Принцип трактата:
 *   «В древности тот, кто хорошо сражался, прежде всего делал себя непобедимым
 *    и в таком состоянии выжидал, когда можно будет победить противника».
 *   (IV. Форма)
 *   «Непобедимость заключена в себе самом, возможность победы заключена
 *    в противнике». (там же)
 *
 * Философия:
 *   Длина матча стратегиям неизвестна, но прожитые раунды — известны. Терпение
 *   обращает это в единственный доступный ресурс: фазу кампании.
 *
 *     Фаза I «Оборона» (раунды 0–29). Делает себя непобедимым: чистое
 *       сотрудничество, ни одного зонда. Задача не выиграть, а собрать данные
 *       и не дать повода.
 *     Фаза II «Равновесие» (30–119). Зеркало с щедростью, растущей вместе с
 *       добропорядочностью соперника: чем выше его кооперация, тем охотнее
 *       Терпение списывает отдельное предательство на помеху. Здесь и живёт
 *       основная масса очков.
 *     Фаза III «Жатва» (120 и далее). Кампания затянулась, тень будущего
 *       короче — и открывается «возможность победы, заключённая в противнике».
 *       Но открывается не всегда: Терпение сначала проверяет, мстит ли соперник
 *       (P(он сотрудничает | я предал) > 0.6 — значит, не мстит). Только против
 *       непомнящего зла оно начинает собирать урожай, наращивая долю
 *       предательств от нуля на 120-м раунде до половины к 200-му.
 *       Против злопамятного остаётся в фазе II до конца — «выжидал, когда
 *       можно будет победить», а не «нападал, когда захотелось».
 *
 * Сильные стороны:
 *   — берёт максимум с долгих матчей, не портя коротких;
 *   — жатва включается только там, где безнаказанна, поэтому не ломает
 *     отношения с «Зеркалом» и «Миротворцем»;
 *   — тридцать раундов безупречной репутации делают её желанным партнёром.
 *
 * Слабые стороны:
 *   — первые 30 раундов беззащитна: «Агрессор» и «Приманка» снимают с неё
 *     полный оброк;
 *   — если бы матч был вдвое короче, фаза жатвы не наступила бы вовсе,
 *     и вся конструкция свелась бы к щедрому зеркалу;
 *   — расчёт «мстит / не мстит» шум может исказить в обе стороны.
 *
 * Против кого рассчитана:
 *   Против терпимых и незлопамятных — «Пацифист», «Прагматик», «Вода» —
 *   у которых поздняя жатва проходит без последствий.
 */

var C = 'C';
var D = 'D';

var DEFENCE_UNTIL = 30;
var BALANCE_UNTIL = 120;
var HARVEST_FULL = 200; // раунд, к которому жатва выходит на максимум
var HARVEST_MAX = 0.5; // предельная доля предательств в жатве
var VENGEFUL_LIMIT = 0.6; // P(C | я предал) выше — соперник не мстит

module.exports = {
  id: 'patience',
  latin: 'Patience',
  name: 'Терпение',
  color: '#94a3b8',
  glyph: '待',
  family: 'authored',
  tagline: 'Оборона, равновесие, жатва — по фазе кампании',
  dossier: {
    principle: '«Делал себя непобедимым и выжидал, когда можно будет победить» — IV. Форма',
    philosophy:
      'Три фазы кампании: 30 раундов безупречной обороны, 90 раундов щедрого ' +
      'равновесия и жатва — но только против того, кто доказал, что не мстит.',
    strengths: [
      'Берёт максимум с долгих матчей, не портя коротких',
      'Жатва включается только там, где безнаказанна'
    ],
    weaknesses: [
      'Первые 30 раундов беззащитна — «Агрессор» снимает полный оброк',
      'Оценку мстительности шум искажает в обе стороны'
    ],
    targets: 'Против терпимых и незлопамятных: «Пацифист», «Прагматик», «Вода»'
  },
  create: function (api) {
    var random = api.random;

    return {
      move: function (h) {
        var n = h.length;

        // Фаза I. Оборона: непобедимость строится на отсутствии поводов.
        if (n < DEFENCE_UNTIL) return C;

        var defRate = h.oppDefections() / n;
        var vengeful = h.oppCoopAfter(D, 1) <= VENGEFUL_LIMIT && h.oppSamplesAfter(D) >= 3;

        // Фаза III. Жатва — но лишь против того, кто доказал, что не мстит.
        if (n >= BALANCE_UNTIL && !vengeful && defRate < 0.5) {
          var span = Math.max(1, HARVEST_FULL - BALANCE_UNTIL);
          var ramp = Math.min(1, (n - BALANCE_UNTIL) / span);
          if (random() < HARVEST_MAX * ramp) return D;
        }

        // Фаза II. Равновесие: зеркало со щедростью по заслугам соперника.
        if (h.lastOpp() === C) return C;
        var mercy = Math.max(0, 1 - defRate * 3); // 0 при 33% предательств и выше
        return random() < mercy ? C : D;
      }
    };
  }
};

});

define("strategies/waterShape", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Вода» (WaterShape) — авторская стратегия
 *
 * Принцип трактата:
 *   «Форма у войска подобна воде: форма у воды — избегать высоты и стремиться
 *    вниз; форма у войска — избегать полноты и ударять по пустоте. Вода
 *    устанавливает своё течение в зависимости от места; войско устанавливает
 *    свою победу в зависимости от противника». (VI. Полнота и пустота)
 *   «Поэтому у войска нет неизменной мощи, у воды нет неизменной формы».
 *
 * Философия:
 *   «Зеркало» отражает последний ход — то есть мгновение. Вода принимает форму
 *   всего сосуда: она отвечает не на ход, а на распределение ходов в скользящем
 *   окне из двадцати раундов. Вероятность сотрудничества равна доле
 *   сотрудничества соперника за это окно.
 *
 *   Отсюда два следствия. Первое: одна помеха меняет ответ Воды на 1/20, а не
 *   переворачивает его — «эха», убивающего «Зеркало», у неё не возникает.
 *   Второе: «избегать полноты и ударять по пустоте» — к отражённой доле
 *   добавлен уклон в три сотых в свою пользу. Вода всегда чуть-чуть стекает
 *   вниз: с идеально доброго соперника она снимает небольшую дань, слишком
 *   малую, чтобы разрушить сотрудничество, но достаточную, чтобы за двести
 *   раундов дать перевес.
 *
 * Сильные стороны:
 *   — лучшая устойчивость к шуму среди отражающих стратегий: реагирует на
 *     тенденцию, а не на случай;
 *   — не имеет постоянной формы, поэтому её невозможно ни запугать, ни
 *     заманить — она просто перетекает;
 *   — уклон даёт бесплатный перевес против всех, кто прощает.
 *
 * Слабые стороны:
 *   — медлительна: пока окно не наполнилось, отдаёт очки хищнику;
 *   — против «Мстителя» уклон обходится дорого — одно предательство,
 *     и матч потерян навсегда;
 *   — против «Агрессора» окно долго тянет её обратно к сотрудничеству.
 *
 * Против кого рассчитана:
 *   Против шумной среды и против прощающих стратегий, у которых уклон
 *   собирает дань незаметно.
 */

var C = 'C';
var D = 'D';

var WINDOW = 20;
var OPENING = 5; // раундов доверия, пока окно пустое
var DRIFT = 0.03; // «стремиться вниз» — уклон в свою пользу

module.exports = {
  id: 'waterShape',
  latin: 'WaterShape',
  name: 'Вода',
  color: '#0d9488',
  glyph: '水',
  family: 'authored',
  tagline: 'Отражает распределение, а не последний ход',
  dossier: {
    principle: '«У войска нет неизменной мощи, у воды нет неизменной формы» — VI',
    philosophy:
      'Отвечает не на ход, а на долю сотрудничества соперника в окне из 20 раундов, ' +
      'плюс уклон в три сотых в свою пользу — вода всегда чуть-чуть стекает вниз.',
    strengths: [
      'Помеха меняет ответ на 1/20, а не переворачивает его — «эха» не возникает',
      'Не имеет формы: её нельзя ни запугать, ни заманить'
    ],
    weaknesses: [
      'Медлительна, пока окно не наполнилось',
      'Уклон дорого обходится против «Мстителя»'
    ],
    targets: 'Против шумной среды и против прощающих'
  },
  create: function (api) {
    var random = api.random;

    return {
      move: function (h) {
        var n = h.length;
        if (n < OPENING) return C;

        var from = Math.max(0, n - WINDOW);
        var coop = 0;
        for (var i = from; i < n; i++) {
          if (h.opp(i) === C) coop += 1;
        }
        var rate = coop / (n - from);

        var p = rate - DRIFT;
        if (p < 0) p = 0;
        if (p > 1) p = 1;
        return random() < p ? C : D;
      }
    };
  }
};

});

define("strategies/reconInForce", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Разведка боем» (ReconInForce) — авторская стратегия
 *
 * Принцип трактата:
 *   «Поэтому, определяя его действия, узнают о его правилах, управляющих жизнью
 *    и смертью; воздействуя на него, узнают основания его движения и покоя;
 *    столкнувшись с ним, узнают, где у него избыток и где недостаток».
 *   (VI. Полнота и пустота)
 *
 * Философия:
 *   Единственный способ узнать, что противник сделает в ответ на удар, — ударить.
 *   Разведка боем ведёт бюджет агрессии от 0 до 1 и корректирует его по
 *   результатам зондов.
 *
 *     Зонд — одно предательство. Через два раунда снимается отчёт: наказал ли
 *     противник за это время хоть раз?
 *       · наказал → бюджет агрессии падает на 0.35, интервал между зондами
 *         удваивается (до 64 раундов), и следующие два раунда — репарации:
 *         чистое сотрудничество, чтобы восстановить отношения;
 *       · не наказал → бюджет растёт на 0.3, интервал сокращается вдвое
 *         (но не короче 5 раундов) — противник слаб, давление усиливается.
 *
 *     Когда бюджет достигает 0.7, разведка переходит в наступление: чистое
 *     предательство до тех пор, пока противник не начнёт отвечать. Ниже порога
 *     живёт как прощающее зеркало.
 *
 *   Разница с «Соглядатаем» принципиальна: тот собирает статистику пассивно и
 *   выбирает один из двух курсов, эта — активно создаёт события, которых иначе
 *   не случилось бы, и меняет интенсивность давления непрерывно.
 *
 * Сильные стороны:
 *   — находит порог терпения соперника за считанные зонды и садится ровно на нём;
 *   — расширяющийся интервал делает зонды почти бесплатными против злопамятных;
 *   — репарации после наказания не дают отношениям обрушиться совсем.
 *
 * Слабые стороны:
 *   — первый же зонд на третьем раунде убивает матч с «Мстителем» насмерть;
 *   — против «Хаоса» отчёты о зондах лгут: случайная кара читается как
 *     осмысленная, и бюджет агрессии колеблется без пользы;
 *   — сама по себе не добрая: предаёт первой и платит за это репутацией.
 *
 * Против кого рассчитана:
 *   Против мягких прощающих стратегий, у которых есть терпимость к
 *   предательству, — «Миротворец», «Вода», щедрые зеркала.
 */

var C = 'C';
var D = 'D';

var FIRST_PROBE = 3;
var REPORT_DELAY = 2; // через сколько раундов после зонда снимать отчёт
var MIN_GAP = 5;
var MAX_GAP = 64;
var AGGRESSION_UP = 0.3;
var AGGRESSION_DOWN = 0.35;
var OFFENSIVE_AT = 0.7;
var REPARATION_ROUNDS = 2;

module.exports = {
  id: 'reconInForce',
  latin: 'ReconInForce',
  name: 'Разведка боем',
  color: '#e879f9',
  glyph: '探',
  family: 'authored',
  tagline: 'Бьёт, чтобы узнать, и садится на пороге терпения',
  dossier: {
    principle: '«Столкнувшись с ним, узнают, где у него избыток и где недостаток» — VI',
    philosophy:
      'Единственный способ узнать ответ на удар — ударить. Ведёт бюджет агрессии, ' +
      'растит его на безнаказанных зондах и режет на наказанных, платя репарации.',
    strengths: [
      'Находит порог терпения за считанные зонды и садится ровно на нём',
      'Расширяющийся интервал делает зонды почти бесплатными против злопамятных'
    ],
    weaknesses: [
      'Первый зонд убивает матч с «Мстителем» насмерть',
      'Против «Хаоса» отчёты лгут — случайная кара читается как осмысленная'
    ],
    targets: 'Против мягких прощающих: «Миротворец», «Вода», щедрые зеркала'
  },
  create: function () {
    var aggression = 0;
    var gap = 12;
    var nextProbe = FIRST_PROBE;
    var probeAt = -1; // раунд последнего неотчитанного зонда
    var reparations = 0;

    return {
      move: function (h) {
        var n = h.length;
        if (n === 0) return C;

        // Отчёт по зонду: наказали ли за него в течение REPORT_DELAY раундов.
        if (probeAt >= 0 && n >= probeAt + 1 + REPORT_DELAY) {
          var punished = false;
          for (var i = probeAt + 1; i <= probeAt + REPORT_DELAY; i++) {
            if (h.opp(i) === D) punished = true;
          }
          if (punished) {
            aggression = Math.max(0, aggression - AGGRESSION_DOWN);
            gap = Math.min(MAX_GAP, gap * 2);
            reparations = REPARATION_ROUNDS;
          } else {
            aggression = Math.min(1, aggression + AGGRESSION_UP);
            gap = Math.max(MIN_GAP, Math.floor(gap / 2));
          }
          probeAt = -1;
          nextProbe = n + gap;
        }

        if (reparations > 0) {
          reparations -= 1;
          return C;
        }

        // Наступление: противник доказал, что терпит.
        if (aggression >= OFFENSIVE_AT) {
          // Но если он всё-таки начал отвечать — давление снимаем.
          if (h.oppCoopAfter(D, 1) < 0.5 && h.oppSamplesAfter(D) >= 4) {
            aggression = Math.max(0, aggression - AGGRESSION_DOWN);
            return C;
          }
          return D;
        }

        if (probeAt < 0 && n >= nextProbe) {
          probeAt = n;
          return D;
        }

        // Между зондами — прощающее зеркало.
        if (h.lastOpp() === C) return C;
        return h.oppDefections() / n <= 0.12 ? C : D;
      }
    };
  }
};

});

define("strategies/challengers/counterIntelligence", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Контрразведка» (CounterIntelligence) — претендент
 *
 * Принцип трактата:
 *   «Война — это путь обмана» (I. Предварительные расчёты).
 *   Обман работает только против того, кто не следит за переменами. Ложь
 *   разоблачается не по одному ходу — один ход всегда можно списать на помеху,
 *   — а по разнице между тем, каким противник БЫЛ, и тем, каким СТАЛ.
 *
 * Философия и механика:
 *   Контрразведка ведёт на противника два досье и сверяет их каждый раунд.
 *
 *   1. «Чистые пробы» — досье о вероломстве. Уликой считается только тот ход
 *      оппонента, который он сделал, видя МОЁ СОТРУДНИЧЕСТВО, и притом когда я
 *      не бил его и раундом раньше (тень провокации в два раунда). Ответ на моё
 *      же предательство уликой не является — иначе за вероломство пришлось бы
 *      судить обычное Зеркало, да и собственные уколы возвращались бы мне
 *      обвинением. Последние 30 таких проб лежат в кольце: доля предательств в
 *      нём — «свежий портрет», минимум по всем закрытым окнам — «лучшее лицо»,
 *      которое противник когда-либо показывал.
 *
 *   2. Разоблачение. Оно объявляется, когда свежее окно даёт 25% предательств и
 *      выше И при этом хуже лучшего лица не меньше чем на 0.20. Порог выставлен
 *      по шуму: канал искажает 5% ходов, так что ровному доброжелателю нужно
 *      восемь помех на тридцать проб — случай из тысяч. Приговор окончательный:
 *      прощение эха выключается навсегда, разведка сворачивается, доверие не
 *      возвращается. Тот, кто мирно спал два десятка или сотню раундов, а потом
 *      начал брать своё, теряет кормушку не через ход после первого укуса (как у
 *      Зеркала), а по самому факту изменения повадки. На честных соперниках
 *      ложная тревога стоит около 2% матчей — цена, заложенная в порог.
 *
 *   3. Война. Если в свежем окне 45% предательств и больше при дюжине проб —
 *      мира не будет: чистое сдерживание до конца матча.
 *
 *   4. Мягкость к ровным. Пока досье чисто, Контрразведка добра: на удар без
 *      повода отвечает ровно один раз, но прощает ЭХО — ответ противника на моё
 *      же предательство, умышленное или сорвавшееся. Это разрывает цепочку
 *      взаимных упрёков, в которой тонет Зеркало. Свой сорвавшийся ход она
 *      видит, сравнивая возвращённое из move() с h.mine(-1), и оплачивает его
 *      раундом покаяния.
 *
 *   5. Разведка безнаказанности — второе досье. Пока в канале не было ни одной
 *      помехи и ни одного удара, разведка молчит: в идеальной тишине укол — это
 *      объявление войны, а не случайность. Как только помеха доказана, раз в
 *      ~22 раунда (интервал дрожит на сидированном ГПСЧ, чтобы две копии не
 *      кололи друг друга в такт) наносится одиночный укол, а отклики на десять
 *      последних моих предательств копятся в отдельном кольце. Первая же кара
 *      сворачивает разведку: мститель опознан. Если кар нет и в трёх откликах, а
 *      портрет безмятежен, оппонента доят — каждый третий раунд, а при полном
 *      кольце без единой кары каждый второй. Три кары из десяти закрывают доение
 *      навсегда.
 *
 * Сильные стороны:
 *   — ловит смену режима по статистике повадки, а не по последнему ходу:
 *     против «спящих» эксплуататоров берёт заметно больше Зеркала, а против
 *     того, кто бьёт только неотвечающих, вовсе не даёт себя раскрыть;
 *   — прощение эха плюс покаяние держат высокий счёт там, где Зеркало вязнет в
 *     шумовой перебранке: против него самого, против его копий и против себя.
 *
 * Слабые стороны:
 *   — окно в 30 проб стоит времени: пока оно не набралось, разоблачать нечем,
 *     и первые раунды у обманщика всё-таки бесплатны;
 *   — приговор необратим, поэтому редкая серия помех навсегда лишает честного
 *     соперника снисхождения;
 *   — против тех, кто сам строит модель противника («Соглядатай»), уколы
 *     разведки читаются как агрессия и обходятся дороже, чем приносят.
 *
 *
 * КРУГ 2: что изменено и почему
 *   Донесение круга 1 вскрыло течь, общую для всех претендентов, — «Мститель».
 *   Счёт 1.22 при его 1.92: он не прощает никогда, а я до последнего раунда
 *   продолжал предлагать мир. В ленте это ровная череда моих C против его
 *   сплошного D, и каждая такая пара стоит очка — S=0 вместо P=1. Дело не
 *   в плохом распознавании: непрощающего вообще нельзя распознать, не
 *   попробовав помириться. Дело в том, что я не переставал пробовать после
 *   того, как ответ стал очевиден.
 *
 *   Добавлен затвор безнадёжности — скользящее окно в 25 раундов. Если в окне
 *   противник сотрудничал не более одного раза, а я предлагал мир не меньше
 *   двух, попытки прекращаются до конца матча. Порог «не более одного», а не
 *   «ни разу», потому что при 5% шума одно искажённое C прилетает от вечного
 *   предателя примерно раз в двадцать раундов и обнуляло бы счётчик ровно
 *   тогда, когда он почти досчитал. Это не новая враждебность, а отказ
 *   доплачивать за уже проигранные переговоры.
 *
 *   Числа (сид 11, шум 5%): Мститель 1.22/1.92 → 1.26/1.76, Агрессор
 *   1.09 → 1.15, средний по лиге 2.560 → 2.567. Матчи с Зеркалом (2.79),
 *   Пацифистом (3.33) и собственной копией (2.89) не сдвинулись ни на сотую —
 *   затвор в них ни разу не сработал, как и задумано.
 *
 *   Оговорка об авторстве: этот круг доведён не автором стратегии — субагент
 *   исчерпал лимит сессии посреди работы. Подробности в DECISIONS.md.
 * Против кого рассчитана:
 *   Против перебежчиков-по-расписанию — «Мнимой слабости» и «Терпения», — и
 *   вообще против всех, кто копит доверие, чтобы потратить его разом.
 */

var C = 'C';
var D = 'D';

var WINDOW = 30; // размер окна «чистых проб»
var ALARM_RATE = 0.25; // доля вероломства в свежем окне для тревоги
var ALARM_DELTA = 0.2; // насколько окно должно быть хуже «лучшего лица»
var WAR_MIN = 12; // минимум проб для приговора «мира не будет»
var WAR_RATE = 0.45; // доля вероломства для чистого сдерживания
var MERCY_RATE = 0.35; // выше этой доли эхо больше не прощается
var CALM_RATE = 0.15; // портрет считается спокойным ниже этой доли
var MILK_RATE = 0.08; // доить можно только совсем безмятежного
var CONTRITION = 1; // раундов покаяния за собственный сорвавшийся ход

var PROBE_RING = 10; // память об откликах на мои предательства
var PROBE_FIRST = 16; // раньше этого раунда не колем
var PROBE_GAP = 22; // базовый интервал между уколами
var PROBE_JITTER = 7; // дрожание интервала (сидированный ГПСЧ)
var PROBE_TOL = 0; // сколько кар терпит разведка, прежде чем свернуться
var MEEK_SAMPLES = 3; // сколько откликов нужно для вывода о безнаказанности
var MEEK_RATE = 0.15; // допустимая доля кар при этом выводе
var MEEK_BAN = 3; // кар из последних десяти — доение закрыто навсегда
var MILK_SLOW = 3; // доим каждый третий раунд
var MILK_FAST = 2; // и каждый второй, если кара не пришла ни разу

module.exports = {
  id: 'counterIntelligence',
  latin: 'CounterIntelligence',
  name: 'Контрразведка',
  color: '#7dd3fc',
  glyph: '諜',
  family: 'challenger',
  tagline: 'Судит не за ход, а за смену повадки',
  dossier: {
    principle: '«Война — это путь обмана» — I. Предварительные расчёты',
    philosophy:
      'Обман виден не в отдельном ходе, а в разнице между прошлым и настоящим. ' +
      'Уликой считается только удар, полученный после моего сотрудничества и вне тени ' +
      'моего собственного предательства; свежее окно из 30 таких проб сверяется с лучшим ' +
      'окном, что противник когда-либо показывал. Разрыв в 0.20 при четверти предательств ' +
      '— это уже не 5% шума, а смена режима, и приговор окончателен: разоблачённому не ' +
      'возвращают ни прощения эха, ни разведки. Ровному — покаяние за свой сорвавшийся ход ' +
      'и прощение ответного удара; тому, кто не мстит ни на один укол, — доение.',
    strengths: [
      'Ловит смену режима по статистике повадки, а не по последнему ходу',
      'Покаяние и прощение эха держат счёт против мстительных и против своей копии'
    ],
    weaknesses: [
      'Пока окно из 30 проб не набралось, первые раунды у обманщика бесплатны',
      'Приговор необратим: редкая серия помех навсегда лишает честного снисхождения'
    ],
    targets:
      'Против перебежчиков-по-расписанию: «Мнимая слабость», «Терпение» и всякий, кто копит доверие, чтобы потратить его разом'
  },
  create: function (api) {
    /*
     * КРУГ 2. Затвор безнадёжности: перестать оплачивать переговоры, которые
     * уже проиграны.
     *
     * Скользящее окно в 25 раундов. Затвор падает, если в окне противник
     * сотрудничал не более одного раза, а я предлагал мир не меньше двух.
     * Считать «ни разу» было бы неверно: при 5% шума одно искажённое C
     * прилетает от вечного предателя примерно раз в двадцать раундов и
     * обнуляло бы счётчик ровно тогда, когда он почти досчитал.
     */
    var HOPELESS_WINDOW = 25;
    var HOPELESS_OFFERS = 2;
    var HOPELESS_MERCY = 1; // столько его C в окне ещё списываем на шум
    var barren = []; // окно: 1, если он сотрудничал
    var barrenCoop = 0;
    var barrenOffers = 0;
    var hopeless = false;

    function noteHopeless(myMove, oppMove) {
      var oppC = oppMove === 'C' ? 1 : 0;
      var myC = myMove === 'C' ? 1 : 0;
      barren.push([oppC, myC]);
      barrenCoop += oppC;
      barrenOffers += myC;
      if (barren.length > HOPELESS_WINDOW) {
        var gone = barren.shift();
        barrenCoop -= gone[0];
        barrenOffers -= gone[1];
      }
      if (
        barren.length === HOPELESS_WINDOW &&
        barrenCoop <= HOPELESS_MERCY &&
        barrenOffers >= HOPELESS_OFFERS
      ) {
        hopeless = true;
      }
    }

    var rand = api && typeof api.random === 'function' ? api.random : null;

    var intended = C; // что я приказал в прошлом раунде
    var contrite = 0; // осталось раундов покаяния

    // Кольцо «чистых проб»: предательства оппонента после моего сотрудничества.
    var ring = [];
    var ringIdx = 0;
    var ringSum = 0;
    var ringLen = 0;
    var bestRate = 1; // лучшее лицо: минимум по закрытым окнам
    var freshRate = 0; // свежий портрет

    // Кольцо откликов на мои предательства.
    var pRing = [];
    var pIdx = 0;
    var pSum = 0;
    var pLen = 0;

    var mode = 0; // 0 — доверие, 1 — разоблачён, 2 — война
    var meek = false; // он не мстит — можно доить
    var meekBan = false; // он уличён в мести — доить нельзя уже никогда
    var noisy = false; // канал уже сбоил — укол сойдёт за помеху
    var milkTick = 0;
    var lastProbe = -1000;
    var probeGap = PROBE_GAP;

    var i;
    for (i = 0; i < WINDOW; i++) ring.push(0);
    for (i = 0; i < PROBE_RING; i++) pRing.push(0);

    function pushClean(v) {
      if (ringLen < WINDOW) {
        ringLen += 1;
      } else {
        ringSum -= ring[ringIdx];
      }
      ring[ringIdx] = v;
      ringSum += v;
      ringIdx = ringIdx + 1 === WINDOW ? 0 : ringIdx + 1;
    }

    function pushProbe(v) {
      if (pLen < PROBE_RING) {
        pLen += 1;
      } else {
        pSum -= pRing[pIdx];
      }
      pRing[pIdx] = v;
      pSum += v;
      pIdx = pIdx + 1 === PROBE_RING ? 0 : pIdx + 1;
    }

    function decide(h, n, oppLast, myLast) {
      if (mode === 2) return D;

      // Собственный сорвавшийся приказ — признать и оплатить.
      if (myLast === D && intended === C) contrite = CONTRITION;
      if (contrite > 0) {
        contrite -= 1;
        return C;
      }

      if (meek && freshRate <= MILK_RATE) {
        // Доение безнаказанного.
        milkTick += 1;
        var period = pLen >= PROBE_RING && pSum === 0 ? MILK_FAST : MILK_SLOW;
        if (milkTick % period === 0) return D;
      } else if (
        // Разведка безнаказанности: одиночный укол по спокойному оппоненту.
        mode === 0 &&
        noisy &&
        !meekBan &&
        pSum <= PROBE_TOL &&
        pLen < MEEK_SAMPLES &&
        oppLast === C &&
        freshRate <= CALM_RATE &&
        n >= PROBE_FIRST &&
        n - lastProbe >= probeGap
      ) {
        lastProbe = n;
        probeGap = PROBE_GAP + (rand ? Math.floor(rand() * PROBE_JITTER) : 0);
        return D;
      }

      if (oppLast === C) return C;

      // Он предал. Пока досье чисто и я никого не дою, ответ на моё же
      // предательство — не вероломство: эхо прощается, и цепочка взаимных
      // упрёков рвётся. Разоблачённому этой поблажки не полагается уже никогда.
      if (mode === 0 && !meek && freshRate <= MERCY_RATE) {
        if (myLast === D || (n >= 2 && h.mine(-2) === D)) return C;
      }

      return D;
    }

    return {
      move: function (h) {
        var n = h.length;
        if (n === 0) {
          intended = C;
          return C;
        }

        var oppLast = h.opp(-1);
        var myLast = h.mine(-1);
        // Что оппонент видел, делая свой последний ход.
        var seen = n >= 2 ? h.mine(-2) : C;
        // Тень провокации: удар в спину засчитывается уликой, только если я не
        // бил и раундом раньше. Иначе я судил бы противника за ответ на себя.
        var shadow = n >= 3 ? h.mine(-3) : C;

        if (seen === D) {
          pushProbe(oppLast === D ? 1 : 0);
        } else if (shadow === C) {
          pushClean(oppLast === D ? 1 : 0);
        }
        freshRate = ringLen ? ringSum / ringLen : 0;

        // Сверка досье: свежий портрет против лучшего лица.
        if (ringLen === WINDOW) {
          if (mode === 0 && freshRate >= ALARM_RATE && freshRate - bestRate >= ALARM_DELTA) {
            mode = 1;
          }
          if (freshRate < bestRate) bestRate = freshRate;
        }
        if (mode < 2 && ringLen >= WAR_MIN && freshRate >= WAR_RATE) mode = 2;

        // Пока в канале не было ни одного сбоя и ни одного удара, разведка
        // молчит: в идеальной тишине укол — это объявление войны, а не помеха.
        if (oppLast === D || myLast !== intended) noisy = true;

        // Он мстит — значит, не дойная корова, и это приговор без пересмотра.
        if (pSum >= MEEK_BAN) meekBan = true;
        meek = !meekBan && pLen >= MEEK_SAMPLES && pSum / pLen <= MEEK_RATE;

        if (n > 0) noteHopeless(myLast, oppLast);

        var m = decide(h, n, oppLast, myLast);
        if (hopeless) m = D;
        intended = m;
        return m;
      }
    };
  }
};

});

define("strategies/challengers/quartermaster", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Интендант» (Quartermaster)
 *
 * Принцип трактата:
 *   «Когда войско выступает в поход, ежедневный расход составляет тысячу
 *    золотых… Если война затягивается, оружие тупится, острия обламываются,
 *    силы падают, казна истощается. Война любит победу и не любит
 *    продолжительности». (II. Ведение войны)
 *   Сунь-цзы во второй главе не рассуждает о доблести: он считает колесницы,
 *   волов и дневной расход казны. Интендант спрашивает не «кто прав», а
 *   «сколько это стоит и когда окупится».
 *
 * Философия (механика и арифметика):
 *
 *   0) Двойная бухгалтерия. История хранит ИСПОЛНЕННЫЕ ходы обеих сторон,
 *      поэтому накопленные счета восстанавливаются точно и за O(1):
 *          мой = 3·count(C,C) + 0·count(C,D) + 5·count(D,C) + 1·count(D,D),
 *          его = 3·count(C,C) + 5·count(C,D) + 0·count(D,C) + 1·count(D,D).
 *      Вычитание сводит всё к одной строке: разрыв = 5·(count(D,C) −
 *      count(C,D)). Взаимный мир и взаимная война на разрыв не влияют вовсе —
 *      его создают только «бесплатные удары». Рядом ведётся свежее сальдо: та
 *      же величина, но со списанием старых записей (0.97 за раунд, окно около
 *      33 раундов). Под чистым шумом 5% свежее сальдо колеблется вокруг нуля
 *      со среднеквадратичным отклонением около 6.3 очка — значит всё, что
 *      глубже 17 очков (2.7σ), это уже не помехи, а систематическая обираловка.
 *
 *   1) Смета кампании. Дневной доход мира равен 3·q_C, где q_C — измеренная
 *      доля раундов, в которых противник ответил миром на мой мир. Дневной
 *      доход войны равен 1 + 4·q_D, где q_D — доля, в которой он ответил миром
 *      на мой удар (5 при его мире, 1 при его ударе). Обе доли не выдумываются,
 *      а ведутся в книге откликов с затуханием 0.9: важен нынешний контрагент,
 *      а не тот, каким он был сто раундов назад. Отсюда две статьи бюджета:
 *        — ОБОРОНА: 3·q_C < 1, мир приносит меньше, чем паёк взаимной войны.
 *          Против чистого агрессора это 0.15 против 1.15 — вопрос закрыт.
 *        — ГРАБЁЖ: 1 + 4·q_D > 3·q_C + 1.0, удар обгоняет мир с большим
 *          запасом. Против того, кто не мстит, это 4.70 против 2.95.
 *      Запас в 1.0 очка обязателен: контрицию вежливого противника (он
 *      подставляется, потому что признаёт свой долг) слишком легко принять за
 *      покорность и разорить обоих. Отдельная тревожная строка — пять дней
 *      подряд, когда мой провиант ушёл ПОД УДАР (я мир, он удар): тогда статья
 *      мира списывается целиком, не дожидаясь, пока её пересчитает затухание.
 *      Взаимная перестрелка эту строку не наполняет — там я бью сам, и это
 *      уже другая статья расходов; иначе двое одинаковых счетоводов запирали
 *      бы друг друга в вечной войне из-за пары помех.
 *
 *   2) Окупаемость одиночного удара. Удар по сотрудничающему даёт +2 сразу
 *      (5 вместо 3), но если он ответит, следующий день стоит −3 (0 вместо 3).
 *      Ожидаемая прибыль = 2 − 3·(1 − q_D) = 3·q_D − 1: по доходу удар
 *      окупается ТОЛЬКО при q_D > 1/3. По разрыву арифметика другая — удар даёт
 *      +5 сейчас и максимум −5 потом, то есть сальдо от него не ухудшается
 *      никогда. Поэтому взыскание решается балансом, а не последним ходом:
 *      неспровоцированный удар закрывается ответным всегда, и лишь при отрыве
 *      от 20 очков, когда месть вдобавок не окупается (3·q_D − 1 ≤ 0),
 *      Интендант прощает: отрыв дороже максимума, а лишний день войны стоит
 *      обеим сторонам по 2 очка. Но и прощение имеет предел — два дня подряд
 *      провиант даром уходить не может.
 *
 *   3) Долговая книга (контриция). Каждый раунд проводится по счетам. Мой
 *      ИСПОЛНЕННЫЙ удар по чистому противнику ставит меня в долг: долг гасится
 *      сотрудничеством, ответный удар принимается молча. Это гасит эхо шума за
 *      два раунда — в том числе когда искажён мой собственный ход, ведь в
 *      историю попадает исполненное, а не задуманное. Его удар заносится в
 *      дебет, только если я не бил его в этом и в предыдущем раунде: иначе это
 *      законная месть, а не новый долг, и платить за неё второй раз глупо.
 *
 *   4) Жёсткий учёт. Как только свежее сальдо проваливается за −17 очков, книга
 *      перестаёт кредитовать: удар отражается ударом без скидки «он же мстил».
 *      По разрыву такой обмен неубыточен, а мягкость, как показывает та же
 *      книга, обходится ровно в 5 очков за каждый чужой удар. Собственный долг
 *      гасится и здесь — иначе жёсткость выродится в эхо-войну. Режим
 *      снимается сам, едва свежее сальдо выправляется.
 *
 *   5) Разведка и парламентёр. Пока наблюдений об отклике на удар меньше пяти,
 *      Интендант изредка (жребием сидированного ГПСЧ, и только из спокойной
 *      книги — когда прошлый день был взаимным миром) проводит проверочную
 *      недопоставку: против мстительного она стоит около очка, зато открывает
 *      статью грабежа против доверчивого на сотню раундов раньше.
 *      В затяжной войне разведку оплачивает сам шум — 5% искажений превращают
 *      часть моих ударов в мир и бесплатно поставляют свежие записи. Сверх того
 *      посылается парламентёр (два дня мира и три дня ожидания ответа); каждый
 *      вернувшийся ни с чем делает следующего на пятую часть реже, но не реже
 *      одного шанса из двадцати пяти: переучёт нужен, тупик дороже. И наоборот,
 *      два мирных хода противника подряд посреди убыточной войны (событие на
 *      четверть процента, если это помехи) кампанию закрывают немедленно —
 *      «война любит победу и не любит продолжительности».
 *
 * Сильные стороны:
 *   — решает по смете и по сальдо, а не по последнему ходу: одиночная помеха
 *     тонет в статистике, контриция гасит взаимные упрёки за два раунда, и с
 *     «Зеркалом» и с собственной копией Интендант живёт почти на чистом мире,
 *     не проедая бюджет на эхо-войнах;
 *   — две статьи бюджета закрывают обе крайности сразу: доверчивого он доит,
 *     непримиримого переводит на паёк, а сменившего повадку ловит за пять-шесть
 *     наблюдений, потому что книга откликов ведётся с затуханием.
 *
 * Слабые стороны:
 *   — открывается доверием и держит его, пока книга не набрана, поэтому первым
 *     ударам чистого агрессора платит полную цену, и этих очков не вернуть;
 *   — против «Зеркала» и «Мстителя» дуэль структурно не выигрывается: каждая их
 *     помеха стоит ему 5 очков разрыва, а вернуть их можно только вечной
 *     войной, которая разрыв не сокращает, зато режет доход вдвое. Интендант
 *     сознательно эту войну не покупает — и потому проигрывает им по очкам,
 *     оставаясь в прибыли по кассе.
 *
 * Против кого рассчитана:
 *   Против доверчивых, непоследовательных и меняющих повадку — их он доит по
 *   статье грабежа и пересчитывает смету быстрее, чем они снимут сливки.
 *   Против безнадёжно враждебных не воюет дольше необходимого, а сразу
 *   переходит на паёк. С надёжными партнёрами держит взаимные 3.0 как самую
 *   доходную статью бюджета.
 */

var C = 'C';
var D = 'D';

// Матрица выплат — те же цифры, что в engine/payoff.js: книги должны сходиться.
var R = 3; // оба сотрудничают
var S = 0; // я сотрудничал, он предал
var T = 5; // я предал, он сотрудничал
var P = 1; // оба предали

// --- книга откликов ---
var DECAY = 0.9; // затухание записей по статье, в которую пришло наблюдение
var IDLE_FADE = 0.999; // списание записей по статье, которой сейчас не пользуются
var PRIOR_WC = 1.5; // вес априорного предположения о цене мира
var PRIOR_WD = 2; // и о цене удара
var PRIOR_C = 0.7; // пока не знаем — считаем, что на мир отвечают миром
var PRIOR_D = 0.25; // и что за удар прилетает ответ

// --- смета кампании ---
var MIN_BOOKS = 4; // наблюдений о цене мира для вердикта «мир убыточен»
var RAID_BOOKS = 4; // наблюдений о цене удара для вердикта «он не мстит»
var RAID_FLOOR = 3.4; // грабить сытый мир можно лишь при доходе войны выше этого
var RAID_MARGIN2 = 0.6; // при таком пороге запас поверх мира нужен меньший
var PEACE_FRAIL = 2.1; // мир, который и так не кормит: его бросают по обычной смете
var RAID_MARGIN = 1.0; // запас, без которого грабёж не объявляют
var PEACE_MARGIN = 0.05; // и запас на возврат к миру
var HOSTILE_RUN = 5; // столько дней подряд провиант ушёл под удар — статья мира списывается

// --- парламентёр: затяжная война разоряет обоих ---
var OLIVE_CEILING = 2.7; // война дешевле возможного мира — стоит проверить мир
var OLIVE_P = 0.08; // вероятность отправить парламентёра в данном раунде
var OLIVE_LEN = 2; // на сколько раундов замолкают пушки
var OLIVE_COOLING = 0.8; // каждый вернувшийся ни с чем удорожает следующего
var OLIVE_FLOOR = 0.04; // но переучёт не прекращается совсем: тупик дороже

// --- сальдо и взыскание ---
var LEAD_DECAY = 0.97; // затухание свежего сальдо (окно около 33 раундов)
var STRICT_FAST = 17; // ≈2.7σ шумового разброса свежего сальдо (σ ≈ 6.3)
var PAYBACK_Q = 1 / 3; // порог окупаемости удара по доходу: 3·q − 1 > 0
var LEAD_SAFE = 20; // очков отрыва, после которых можно не жадничать
var BLEED_LIMIT = 2; // столько дней подряд провиант даром уходить не может

// --- ревизия ---
var PROBE_NEED = 5; // столько наблюдений об отклике на удар — и хватит
var PROBE_FROM = 4; // раньше проверять нечего
var PROBE_TO = 130; // позже ревизия не окупает оставшийся горизонт
var PROBE_P = 0.07;
var PROBE_GIVEUP = 0.15; // гипотеза «он не мстит» опровергнута — ревизии прекращаются

module.exports = {
  id: 'quartermaster',
  latin: 'Quartermaster',
  name: 'Интендант',
  color: '#fcd34d',
  glyph: '糧',
  family: 'challenger',
  tagline: 'Считает провиант, а не подвиги',
  dossier: {
    principle: '«Война любит победу и не любит продолжительности» — II. Ведение войны',
    philosophy:
      'Ведёт двойную бухгалтерию матча: накопленные очки свои и чужие восстанавливает из ' +
      'истории точно и за O(1), а решает по смете и по сальдо, а не по последнему ходу. ' +
      'Разрыв сводится к одной строке — 5·(count(D,C) − count(C,D)); взаимный мир и взаимная ' +
      'война на него не влияют. Дневной доход мира равен 3·q_C, дневной доход войны — ' +
      '1 + 4·q_D, где обе доли измерены по книге откликов с затуханием. Отсюда две статьи ' +
      'бюджета: ОБОРОНА, когда 3·q_C < 1 (мир приносит меньше пайка взаимной войны: 0.15 ' +
      'против 1.15), и ГРАБЁЖ, когда 1 + 4·q_D обгоняет мир на целое очко (4.70 против 2.95). ' +
      'Запас в очко обязателен: контрицию вежливого противника слишком легко принять за ' +
      'покорность. Одиночный удар по доходу окупается лишь при q_D > 1/3 (2 − 3·(1 − q_D) > 0), ' +
      'но по разрыву он неубыточен всегда — поэтому чужой неспровоцированный удар ' +
      'закрывается ответным, и только при отрыве в 20 очков, когда месть вдобавок не ' +
      'окупается, Интендант прощает: отрыв дороже максимума. Свежее сальдо (со списанием ' +
      'старых записей) под чистым шумом гуляет со среднеквадратичным отклонением 6.3 очка; ' +
      'провал за −17 включает жёсткий учёт — удар на удар без скидки «он же мстил». Долговая ' +
      'книга с контрицией гасит эхо помех за два раунда, признавая собственный искажённый ' +
      'удар своим долгом, разведку в затяжной войне оплачивает сам шум, а два мирных хода ' +
      'противника подряд посреди убыточной войны закрывают кампанию немедленно: затяжная ' +
      'война разоряет и победителя.',
    strengths: [
      'Решает по смете и сальдо — помеха не сбивает курс, эхо гаснет за два раунда',
      'Две статьи бюджета сразу закрывают и доверчивых, и непримиримых, и сменивших повадку'
    ],
    weaknesses: [
      'Открывается доверием: первым ударам чистого агрессора платит полную цену, и их не вернуть',
      'Дуэль с «Зеркалом» и «Мстителем» структурно не выигрывается — вернуть разрыв можно только вечной войной, а она режет доход вдвое'
    ],
    targets:
      'Против доверчивых, непоследовательных и меняющих повадку — их он доит и пересчитывает ' +
      'смету быстрее, чем они снимут сливки; против безнадёжно враждебных не воюет дольше ' +
      'необходимого; с надёжными держит взаимные 3.0'
  },

  create: function (api) {
    var coin = api && typeof api.random === 'function' ? api.random : null;

    // Книги учёта живут в замыкании: один комплект на матч, ничего глобального.
    var posted = 0; // сколько раундов уже проведено по книгам
    var iOwe = false; // мой исполненный удар лёг на чистого противника
    var heOwes = false; // его удар лёг на чистого меня и не был местью
    var wC = 0; // вес наблюдений «я мир → его ответ»
    var sC = 0; // из них мирных ответов
    var wD = 0; // вес наблюдений «я удар → его ответ»
    var sD = 0; // из них мирных ответов
    var seenD = 0; // сырое число наблюдений отклика на удар (без затухания)
    var seenClean = 0; // из них взятых не под давлением взыскания
    var wDc = 0; // чистая книга: вес откликов на НЕспровоцированный удар
    var sDc = 0; // из них мирных
    var leadFast = 0; // свежее сальдо со списанием старых записей
    var bleed = 0; // сколько неспровоцированных ударов подряд не закрыто
    var bleedRun = 0; // сколько дней подряд мой провиант уходит под удар
    var atWar = false; // текущий режим бюджета
    var oliveC = 0; // сколько раундов перемирия ещё оплачено
    var oliveWatch = 0; // сколько раундов ждём ответа парламентёру
    var refused = 0; // сколько парламентёров вернулось ни с чем
    var priorWasCollection = false; // вчерашний мой удар был взысканием долга

    return {
      move: function (h) {
        var n = h.length;

        // Первый раунд — открытый кредит: мир самая доходная статья, и дешевле
        // всего начать проверку его доступности с собственного взноса.
        if (n === 0) return C;

        // --- проводка новых раундов по книгам, O(1) на раунд ---
        while (posted < n) {
          var m = h.mine(posted); // мой ИСПОЛНЕННЫЙ ход: шум уже учтён
          var o = h.opp(posted);
          var priorMine = posted > 0 ? h.mine(posted - 1) : null;
          var iOweBefore = iOwe;
          var heOwesBefore = heOwes;

          // Долговая книга. Я в долгу, если ударил того, кто мне ничего не был
          // должен. Он в долгу, если ударил чистого меня — но не тогда, когда
          // это месть за мой вчерашний удар: за неё уже уплачено.
          iOwe = m === D && !heOwesBefore;
          heOwes = o === D && m !== D && !iOweBefore && priorMine !== D;
          // Мой удар был ВЗЫСКАНИЕМ, если бил я того, кто мне был должен.
          var wasCollection = m === D && heOwesBefore;

          if (heOwes) bleed += 1;
          else if (o === C) bleed = 0;
          // Тревожная строка: сколько дней подряд я отпускаю провиант, а в
          // ответ получаю удар. Взаимная перестрелка её не наполняет — там я
          // бью сам, и это уже другая статья расходов.
          bleedRun = o === D && m === C ? bleedRun + 1 : 0;

          // Свежее сальдо: то же 5·(D,C) − 5·(C,D), но со списанием старых
          // записей. Ровный убыток от помех держится в пределах шести очков,
          // систематическая обираловка уводит его втрое глубже.
          leadFast =
            leadFast * LEAD_DECAY +
            (m === D && o === C ? T - S : 0) -
            (m === C && o === D ? T - S : 0);

          // Книга откликов: его ход — это ответ на мой предыдущий. Статья, в
          // которую пришло наблюдение, обновляется; вторая медленно списывается.
          //
          // КРУГ 2. Книг об отклике на удар теперь две. Общая (wD/sD) считает
          // все ответы подряд и обслуживает рутинную арифметику окупаемости.
          // Чистая (wDc/sDc) принимает только ответы на удар, которого он ничем
          // не заслужил, — ревизию или помеху. Мир в ответ на ВЗЫСКАНИЕ в неё
          // не попадает: он с равным успехом означает и «терплю агрессию», и
          // «признаю свой долг», а разорительный вердикт нельзя выносить по
          // показанию, взятому под давлением.
          if (priorMine !== null) {
            var reply = o === C ? 1 : 0;
            if (priorMine === D) {
              wD = wD * DECAY + 1;
              sD = sD * DECAY + reply;
              seenD += 1;
              if (!priorWasCollection) {
                wDc = wDc * DECAY + 1;
                sDc = sDc * DECAY + reply;
                seenClean += 1;
              }
              wC = wC * IDLE_FADE;
              sC = sC * IDLE_FADE;
            } else {
              wC = wC * DECAY + 1;
              sC = sC * DECAY + reply;
              wD = wD * IDLE_FADE;
              sD = sD * IDLE_FADE;
              wDc = wDc * IDLE_FADE;
              sDc = sDc * IDLE_FADE;
            }
          }

          priorWasCollection = wasCollection;
          posted += 1;
        }

        // --- сальдо матча: оба накопленных счёта точно, за O(1) ---
        var cc = h.count(C, C);
        var cd = h.count(C, D);
        var dc = h.count(D, C);
        var dd = h.count(D, D);
        var myScore = R * cc + S * cd + T * dc + P * dd;
        var hisScore = R * cc + T * cd + S * dc + P * dd;
        var lead = myScore - hisScore; // = 5 · (dc − cd)

        // --- смета: дневной доход мира против дневного дохода войны ---
        var qC = (sC + PRIOR_WC * PRIOR_C) / (wC + PRIOR_WC);
        var qD = (sD + PRIOR_WD * PRIOR_D) / (wD + PRIOR_WD);
        var peaceValue = R * qC; // 3 · p(он C | я C)
        var warValue = P + (T - P) * qD; // 1 + 4 · p(он C | я D)
        // Тот же доход войны, но посчитанный по чистой книге: только этим
        // числом выносится вердикт «он не мстит, можно грабить».
        var qDclean = (sDc + PRIOR_WD * PRIOR_D) / (wDc + PRIOR_WD);
        var raidValue = P + (T - P) * qDclean;

        // Два мирных хода подряд посреди взаимной войны — событие на четверть
        // процента, если это помехи. Значит это не помехи, а парламентёр.
        var truceOffer = n >= 2 && h.opp(-1) === C && h.opp(-2) === C;

        if (atWar) {
          if (warValue < OLIVE_CEILING && truceOffer) {
            // Война и так приносит меньше возможного мира, а он держит мир
            // два дня подряд: продолжать кампанию — чистый убыток.
            atWar = false;
            oliveC = 0;
            oliveWatch = 0;
            refused = 0;
          } else if (oliveWatch > 0 && h.opp(-1) === C) {
            // Парламентёр вернулся с миром — кампания закрыта, не дожидаясь книг.
            atWar = false;
            oliveC = 0;
            oliveWatch = 0;
            refused = 0;
          } else {
            if (oliveWatch > 0) oliveWatch -= 1;
            if (oliveC > 0) {
              oliveC -= 1; // пушки молчат: покупаем свежую запись о цене мира
              return C;
            }
            if (peaceValue > P + PEACE_MARGIN && raidValue < peaceValue + RAID_MARGIN) {
              // Мир снова окупает паёк, и грабить уже невыгодно: обе статьи
              // кампании закрыты одновременно.
              atWar = false;
              refused = 0;
            } else if (
              warValue < OLIVE_CEILING &&
              coin &&
              coin() < Math.max(OLIVE_FLOOR, OLIVE_P * Math.pow(OLIVE_COOLING, refused))
            ) {
              // Война приносит меньше, чем мог бы принести мир, а оценка мира
              // устарела. Парламентёр стоит день — молчание стоит два очка в
              // день. Час отправки выбирает жребий: иначе две одинаковые ставки
              // разошлись бы фазами и не встретились никогда.
              oliveC = OLIVE_LEN - 1;
              oliveWatch = OLIVE_LEN + 1;
              refused += 1;
              return C;
            }
          }
        } else if (
          // Статья «оборона»: мир приносит меньше, чем паёк взаимной войны.
          (wC >= MIN_BOOKS && peaceValue < P) ||
          // Статья «грабёж», ветвь первая: мир и так не кормит (ниже 2.1 очка
          // в день), и удар обгоняет его с запасом. Здесь довольно общей книги:
          // бросают не сытый мир, а тощий, и ошибка стоит недорого.
          (wD >= RAID_BOOKS && peaceValue < PEACE_FRAIL &&
            warValue > peaceValue + RAID_MARGIN) ||
          // Ветвь вторая: мир СЫТ, и всё же грабёж выгоднее. Такой приговор
          // разоряет обоих, если ошибиться, поэтому он требует и чистой книги,
          // и абсолютного порога: доход войны выше 3.4 очка в день, то есть
          // противник уступает не меньше чем в двух случаях из трёх.
          (wDc >= RAID_BOOKS && raidValue > RAID_FLOOR &&
            raidValue > peaceValue + RAID_MARGIN2) ||
          // Пять дней подряд провиант ушёл под удар — это уже не помеха.
          bleedRun >= HOSTILE_RUN
        ) {
          if (bleedRun >= HOSTILE_RUN) {
            // Статья мира списывается целиком: свежие поставки не оплачены ни
            // разу, и ждать, пока это пересчитает затухание, слишком дорого.
            sC = 0;
            if (wC < MIN_BOOKS) wC = MIN_BOOKS;
          }
          atWar = true;
          oliveC = 0;
          oliveWatch = 0;
        }
        if (atWar) return D;

        // --- жёсткий учёт: свежее сальдо провалилось глубже шумовой полосы ---
        // Касса прекращает кредитовать: удар отражается ударом без скидки
        // «он же мстил». По разрыву такой обмен неубыточен, а мягкость
        // обходится ровно в 5 очков за каждый чужой удар. Свой долг платится
        // и здесь — иначе жёсткость выродится в бесконечную эхо-войну.
        if (leadFast <= -STRICT_FAST) {
          if (iOwe) return C; // свой долг платится в любом режиме
          return h.opp(-1) === D ? D : C;
        }

        // --- мирная бухгалтерия: свои долги гасятся первыми ---
        if (iOwe) return C;

        // --- взыскание по его долгу: решение от сальдо, а не от последнего хода ---
        if (heOwes) {
          // Идём с отрывом, месть не окупается (3·q_D − 1 ≤ 0) и это не система,
          // а помеха — прощаем: отрыв дороже максимума, а лишний день войны
          // стоит обеим сторонам по два очка.
          if (lead >= LEAD_SAFE && qD <= PAYBACK_Q && bleed < BLEED_LIMIT) return C;
          // Иначе счёт закрывается ответным ударом: по разрыву он даёт +5 сейчас
          // и максимум −5 потом, то есть сальдо от него не ухудшается никогда.
          return D;
        }

        // --- ревизия, пока книга откликов на удар не набрана ---
        // Только из спокойной книги: если прошлый день был не взаимным миром,
        // отклик нельзя будет отнести именно на ревизию, и ревизия не окупится.
        //
        // КРУГ 2. И только пока гипотеза жива. Ревизию покупают ради вердикта
        // «он не мстит»; если чистая книга этот вердикт уже опровергла
        // (q_D упала ниже 0.15 — два отказа подряд), дальнейшие проверки
        // оплачивают сведения, которые давно получены. В логах круга 1 такие
        // ревизии шли всю партию и каждая стоила очко, а против собственной
        // копии ещё и поджигала перестрелку.
        if (
          coin &&
          seenClean < PROBE_NEED &&
          qDclean >= PROBE_GIVEUP &&
          n >= PROBE_FROM &&
          n <= PROBE_TO &&
          lead < LEAD_SAFE &&
          h.mine(-1) === C &&
          h.opp(-1) === C &&
          coin() < PROBE_P
        ) {
          return D;
        }

        // --- мир: самая доходная статья бюджета ---
        return C;
      }
    };
  }
};

});

define("strategies/challengers/resonance", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Резонанс» (Resonance)
 *
 * Принцип трактата:
 *   «Тот, кто умеет заставить противника обнаружить форму, а сам формы не имеет,
 *    — сохраняет цельность». (VI. Полнота и пустота)
 *   Резонанс не приносит в бой заготовленного характера. Он слушает, каким
 *   откликом противник отвечает на каждое действие, и настраивается на его
 *   частоту.
 *
 * ПРЕДСКАЗАТЕЛЬ.
 *   Почти вся лига — автоматы с короткой памятью: следующий ход противника есть
 *   функция одного-двух последних раундов. Резонанс ведёт таблицу «контекст →
 *   что он сделал дальше». Контекст глубины 2 — пара последних раундов обеих
 *   сторон, 16 состояний; под ним контекст глубины 1 (мой и его прошлый ход,
 *   4 состояния); под ним общая оценка его добронравия. Оценка трёхуровневая,
 *   с откатом на уровень ниже:
 *       p0 = (все его C + W0·0.6) / (все ходы + W0)
 *       prior = p0 ± 0.15            (после моего C выше, после моего D ниже)
 *       p1 = (c1 + W1·prior) / (n1 + W1)
 *       p2 = (c2 + W2·p1) / (n2 + W2)
 *   Единственное наблюдение так никогда не становится законом — при 5% шума это
 *   обязательное условие. Все счётчики затухают на 0.98 за раунд: сменивший
 *   повадку противник перевешивает своё прошлое за полсотни ходов, а нижний
 *   уровень не даёт ни разу не встреченному состоянию сохранять врождённый
 *   оптимизм — против того, кто не сотрудничал ни разу, курс «всегда C» не
 *   получит выдуманной цены.
 *
 * ЛОВУШКА ВЫРОЖДЕНИЯ И КАК ОНА ОБОЙДЕНА.
 *   Наивный «лучший ответ на предсказание» всегда выдаёт D: в одном раунде D
 *   доминирует при любой вероятности, и предсказатель превращается в
 *   AlwaysDefect. Резонанс оценивает не раунд, а КУРС. Модель разворачивается в
 *   марковскую цепь на 16 состояниях; пять курсов — всегда C, всегда D,
 *   зеркало, зеркало-после-двух и прагматик (win-stay lose-shift) — прогоняются
 *   на 40 шагов вперёд точным распространением распределения состояний, с
 *   учётом собственного шума 5%. Сравниваются средние выплаты за раунд, то есть
 *   установившаяся ценность курса. Играется только первый ход победителя, на
 *   следующем раунде расчёт повторяется по обновлённой модели. Против
 *   отвечающего противника «всегда D» проигрывает расчёт самому себе: цепь
 *   уходит во взаимное предательство ценой 1.0 против 3.0 у взаимной верности.
 *
 * ТРИ ОГРАНИЧИТЕЛЯ ПОВЕРХ РАСЧЁТА.
 *   1. Мера уверенности. Отступление от сотрудничества требует запаса ценности
 *      margin = 0.05 + 0.6·(1 − conf), где conf = min(1, раундов/20), сбитая
 *      энтропией текущего прогноза (conf ·= 1 − 0.35·H). Тонкая статистика или
 *      размытый прогноз — выбор склоняется к C: стабильные взаимные 3.0 лучшее,
 *      что бывает в этой игре.
 *   2. Жадность требует улик. Курс «всегда предавать» против того, кто в
 *      основном верен (доля C ≥ 0.6), включается только при четырёх и более
 *      наблюдениях контекста «я предал его сотрудничество» с долей прощений
 *      не ниже 0.8. Расчёт склонен принять за безответность случайную поблажку,
 *      а цена ошибки — обрушенная кооперация на сотню раундов вперёд.
 *      Самозащиты правило не касается: у враждебного доля C ниже порога, и
 *      против него оборона включается на третьем-четвёртом раунде.
 *   3. Устрашение. На предательство по моему сотрудничеству Резонанс отвечает
 *      через раз, а на два подряд — всегда (двойное искажение канала имеет
 *      вероятность 0.25%, это уже не шум). Половинчатость здесь расчёт, а не
 *      мягкость: у прощающего всё в чужой таблице стоит «после моего D он
 *      верен», и его доят до конца матча; мстящий за каждую мелочь при 5% шума
 *      уходит в бесконечное эхо. Ответ через раз даёт в чужой таблице честные
 *      ~0.5 — доить невыгодно, а эхо затухает за пару ходов.
 *
 * ЗОНД И ОЛИВКОВАЯ ВЕТВЬ.
 *   Улики про безответность сами не появятся: пока Резонанс верен, контекст
 *   «я предал его сотрудничество» пуст. Отсюда зонд — пробное D против того,
 *   кто выглядит добрым (доля C ≥ 0.85). До двадцатого раунда зонды редки (раз
 *   в 9 ходов): слишком многие судят соперника по первым двум десяткам. Дальше
 *   раз в 4 хода, всего не более десяти. Зондирование прекращается, едва
 *   набрано восемь наблюдений отклика, и обрывается сразу, как только видна
 *   месть, — форма обнаружена, тратить людей больше не на что.
 *   Обратная беда — яма взаимного предательства: модель предсказывает D и
 *   отвечает D, сама она из ямы не выйдет. Раз в 25 раундов Резонанс даёт два
 *   хода C подряд. Отвергнутая ветвь удваивает паузу до следующей (до 120
 *   раундов): мир предлагают, но не выпрашивают.
 *
 *   Случайность не используется: поведение полностью определено историей матча.
 *
 * Сильные стороны:
 *   — распознаёт безответно доброго и доит его примерно на 4.5 за раунд;
 *   — держит кооперацию с отвечающими, сам прощает шумовые срывы и не даёт
 *     доить себя, поэтому не разваливается против собственной копии.
 *
 * Слабые стороны:
 *   — первые два десятка раундов уходят на разведку, против доверчивого это
 *     недобранные очки, а против того, кто судит по ранним ходам, — испорченное
 *     первое впечатление;
 *   — противник с памятью глубже двух раундов для модели невидим: он выглядит
 *     шумом, и Резонанс скатывается к осторожному сотрудничеству.
 *
 *
 * КРУГ 2: что изменено и почему
 *   Донесение круга 1: против «Мстителя» 1.15 при его 1.68. Предсказатель
 *   работал верно — он правильно предсказывал D, — но устрашение и зонды
 *   продолжали изредка выпускать C, а непрощающему противнику каждое такое C
 *   дарит очко и не покупает ничего. Предсказание было точным, а решение,
 *   что делать с предсказанием, — нет.
 *
 *   Добавлен затвор безнадёжности поверх всей логики выбора курса: скользящее
 *   окно в 25 раундов, и если в нём противник сотрудничал не более одного
 *   раза, а я предлагал мир не меньше двух, попытки прекращаются насовсем.
 *   Порог «не более одного» вместо «ни разу» — поправка на 5% шума: одно
 *   искажённое C от вечного предателя приходит примерно раз в двадцать
 *   раундов и сбрасывало бы счётчик на подходе к порогу.
 *
 *   Числа (сид 11, шум 5%): Мститель 1.15/1.68 → 1.19/1.58, средний по лиге
 *   2.516 → 2.518. Пацифист (4.48), Зеркало (2.75), Агрессор (1.11) и
 *   собственная копия (2.90) остались прежними — затвор в этих матчах
 *   не срабатывает.
 *
 *   Оговорка об авторстве: этот круг доведён не автором стратегии — субагент
 *   исчерпал лимит сессии посреди работы. Подробности в DECISIONS.md.
 * Против кого рассчитана:
 *   Против автоматов с короткой памятью — доверчивых, зеркал, прагматиков,
 *   мстительных: их форма ложится в таблицу переходов целиком.
 */

var C = 'C';
var D = 'D';

var NOISE = 0.05; // предполагаемая вероятность искажения собственного хода
var HORIZON = 40; // горизонт оценки курса, раундов
var W0 = 2; // вес врождённого ожидания в общей оценке его добронравия
var W1 = 2; // вес отката «глубина 1 → общая оценка»
var W2 = 3; // вес отката «глубина 2 → глубина 1»
var BASE_TRUST = 0.6; // с чего начинается оценка его добронравия
var RECIPROCITY = 0.15; // поправка априора: после моего C — выше, после D — ниже
var PRIOR_FLOOR = 0.05;
var PRIOR_CEIL = 0.95;
var DECAY = 0.98; // затухание счётчиков за раунд
var CONF_ROUNDS = 20; // за сколько раундов уверенность выходит на единицу
var MARGIN_MIN = 0.05; // запас ценности для отступления при полной уверенности
var MARGIN_MAX = 0.6; // добавка к запасу при нулевой уверенности
var ENTROPY_PULL = 0.35; // насколько энтропия прогноза сбивает уверенность

var PROBE_MIN_LEN = 4; // раньше этого раунда не зондируем
var PROBE_CALM = 20; // до этого раунда зондируем редко: многие судят по первым
var PROBE_GAP_EARLY = 9; // интервал между зондами в осторожной фазе
var PROBE_GAP = 4; // интервал между зондами дальше
var PROBE_MAX = 10; // сколько зондов допустимо всего
var PROBE_TARGET = 8; // при стольких откликах на D зондирование прекращается
var PROBE_STOP_N = 2; // столько откликов достаточно, чтобы увидеть месть
var PROBE_STOP_P = 0.5; // доля C в откликах на D, ниже которой зонды бессмысленны
var PROBE_COOP = 0.85; // зондируем только выглядящего добрым

var GREED_COOP = 0.6; // кого считать «в основном верным» — его не предают без улик
var GREED_N = 4; // сколько наблюдений нужно, чтобы счесть его безответным
var GREED_P = 0.8; // и какая доля прощений среди них

var OLIVE_MIN_LEN = 24; // раньше этого раунда ветвь не предлагается
var OLIVE_GAP = 25; // интервал между оливковыми ветвями
var OLIVE_GAP_MAX = 120; // предел, до которого интервал растёт после отказов
var OLIVE_WINDOW = 12; // окно, по которому опознаётся яма взаимного D
var OLIVE_OPP_C = 2; // столько C противника в окне ещё считается ямой
var OLIVE_MY_D = 9; // столько моих D в окне — я тоже в яме

var POLICY_COUNT = 5; // всегда C, всегда D, зеркало, зеркало-после-двух, прагматик
var STATES = 16;

/** Очки за раунд с точки зрения первого хода. */
function pay(a, b) {
  if (a === C) return b === C ? 3 : 0;
  return b === C ? 5 : 1;
}

/**
 * Индекс состояния: два последних раунда обеих сторон.
 * Биты: 3 — мой ход два раунда назад, 2 — его ход два раунда назад,
 *       1 — мой прошлый ход, 0 — его прошлый ход. Единица означает D.
 */
function stateIndex(m2, o2, m1, o1) {
  return (m2 === D ? 8 : 0) + (o2 === D ? 4 : 0) + (m1 === D ? 2 : 0) + (o1 === D ? 1 : 0);
}

/** Ход курса `policy` из состояния `s`. */
function policyMove(policy, s) {
  if (policy === 0) return C; // всегда C
  if (policy === 1) return D; // всегда D
  if (policy === 2) return s & 1 ? D : C; // зеркало: повторяю его прошлый ход
  if (policy === 3) return (s & 1) && (s & 4) ? D : C; // мщу за две подряд
  // прагматик: раунд был выигрышным (он сотрудничал) — повторяю свой ход,
  // проигрышным — меняю. Единственный курс, умеющий рассинхронизацию чинить.
  if (s & 1) return s & 2 ? C : D;
  return s & 2 ? D : C;
}

/** Нормированная бинарная энтропия, 0..1. */
function entropy(p) {
  if (p <= 1e-9 || p >= 1 - 1e-9) return 0;
  return -(p * Math.log(p) + (1 - p) * Math.log(1 - p)) / Math.log(2);
}

module.exports = {
  id: 'resonance',
  latin: 'Resonance',
  name: 'Резонанс',
  color: '#c4b5fd',
  glyph: '虛',
  family: 'challenger',
  tagline: 'Предсказывает отклик и живёт ценностью курса, а не раунда',
  dossier: {
    principle:
      '«Тот, кто умеет заставить противника обнаружить форму, а сам формы не имеет, — сохраняет цельность» — VI. Полнота и пустота',
    philosophy:
      'Ведёт таблицу переходов «два последних раунда обеих сторон → его следующий ход»: ' +
      '16 состояний глубины 2 с откатом на 4 контекста глубины 1, а под ними — общая оценка ' +
      'его добронравия с поправкой на взаимность. Три уровня сглаживания и затухание 0.98 за ' +
      'раунд: при 5% шума единственное наблюдение не должно становиться законом, а сменивший ' +
      'повадку противник обязан перевесить своё прошлое. Ловушка вырождения в AlwaysDefect ' +
      'обойдена тем, что оценивается не раунд, а КУРС: модель разворачивается в марковскую ' +
      'цепь, и пять курсов (всегда C, всегда D, зеркало, зеркало-после-двух, прагматик) ' +
      'прогоняются на 40 шагов вперёд точным распространением распределения состояний с ' +
      'учётом собственного шума; берётся курс с наибольшей установившейся выплатой за раунд, ' +
      'играется только его первый ход. Против отвечающего противника «всегда D» проигрывает ' +
      'расчёт самому себе: цепь уходит во взаимное предательство ценой 1.0 против 3.0 у ' +
      'верности. Поверх расчёта три ограничителя: запас ценности для отступления от C, тем ' +
      'больший, чем тоньше статистика и выше энтропия прогноза; правило «жадность требует ' +
      'улик» — курс на постоянное предательство против в основном верного включается лишь ' +
      'при четырёх наблюдениях его безответности; и устрашение — ответ на каждую вторую обиду ' +
      'и всегда на две подряд, чтобы в чужой таблице не значилось «его можно доить». Улики ' +
      'добывает зонд (редкие пробные D, обрывающиеся при первой же мести), а из ямы взаимного ' +
      'предательства выводит оливковая ветвь — два хода C, всё реже после отказов. ' +
      'Случайность не используется: поведение определено историей матча.',
    strengths: [
      'Распознаёт безответно доброго и доит его примерно на 4.5 за раунд',
      'Держит кооперацию с отвечающими, прощает шум и не даёт доить себя'
    ],
    weaknesses: [
      'Первые два-три десятка раундов уходят на разведку — против доверчивого это недобор',
      'Противник с памятью глубже двух раундов для модели выглядит шумом'
    ],
    targets: 'Против автоматов с короткой памятью: зеркал, прагматиков, доверчивых, мстительных'
  },

  create: function () {
    /*
     * КРУГ 2. Затвор безнадёжности: перестать оплачивать переговоры, которые
     * уже проиграны.
     *
     * Скользящее окно в 25 раундов. Затвор падает, если в окне противник
     * сотрудничал не более одного раза, а я предлагал мир не меньше двух.
     * Считать «ни разу» было бы неверно: при 5% шума одно искажённое C
     * прилетает от вечного предателя примерно раз в двадцать раундов и
     * обнуляло бы счётчик ровно тогда, когда он почти досчитал.
     */
    var HOPELESS_WINDOW = 25;
    var HOPELESS_OFFERS = 2;
    var HOPELESS_MERCY = 1; // столько его C в окне ещё списываем на шум
    var barren = []; // окно: 1, если он сотрудничал
    var barrenCoop = 0;
    var barrenOffers = 0;
    var hopeless = false;

    function noteHopeless(myMove, oppMove) {
      var oppC = oppMove === 'C' ? 1 : 0;
      var myC = myMove === 'C' ? 1 : 0;
      barren.push([oppC, myC]);
      barrenCoop += oppC;
      barrenOffers += myC;
      if (barren.length > HOPELESS_WINDOW) {
        var gone = barren.shift();
        barrenCoop -= gone[0];
        barrenOffers -= gone[1];
      }
      if (
        barren.length === HOPELESS_WINDOW &&
        barrenCoop <= HOPELESS_MERCY &&
        barrenOffers >= HOPELESS_OFFERS
      ) {
        hopeless = true;
      }
    }

    // ---- модель противника: счётчики откликов, всё в замыкании ----
    var c2 = []; // сколько раз он ответил C в состоянии глубины 2
    var d2 = [];
    var c1 = [0, 0, 0, 0]; // то же для контекста глубины 1 (мой и его прошлый ход)
    var d1 = [0, 0, 0, 0];
    var g1 = 0; // сколько всего он сотрудничал (с затуханием)
    var g0 = 0; // сколько всего предавал
    var pC = []; // кэш прогнозов на текущий раунд
    var i;
    for (i = 0; i < STATES; i++) {
      c2.push(0);
      d2.push(0);
      pC.push(0.5);
    }

    var learned = 0; // сколько раундов истории уже впитано
    var probes = 0;
    var lastProbe = 0;
    var lastOlive = 0;
    var oliveGap = OLIVE_GAP; // растёт вдвое после каждой отвергнутой ветви
    var olivePending = false;
    var slights = 0; // счётчик предательств по моему сотрудничеству
    var oliveLeft = 0;

    // буферы симуляции переиспользуются, чтобы не мусорить в каждом раунде
    var distA = [];
    var distB = [];
    for (i = 0; i < STATES; i++) {
      distA.push(0);
      distB.push(0);
    }

    /** Затухание всех счётчиков — старое знание весит меньше свежего. */
    function decayAll() {
      var k;
      for (k = 0; k < STATES; k++) {
        c2[k] *= DECAY;
        d2[k] *= DECAY;
      }
      for (k = 0; k < 4; k++) {
        c1[k] *= DECAY;
        d1[k] *= DECAY;
      }
      g1 *= DECAY;
      g0 *= DECAY;
    }

    /** Впитать новые раунды истории в таблицу переходов. */
    function ingest(h) {
      var L = h.length;
      var t;
      for (t = learned; t < L; t++) {
        if (t < 1) continue; // для перехода нужен хотя бы один раунд контекста
        var m1 = h.mine(t - 1);
        var o1 = h.opp(t - 1);
        var m2 = t >= 2 ? h.mine(t - 2) : C;
        var o2 = t >= 2 ? h.opp(t - 2) : C;
        var s = stateIndex(m2, o2, m1, o1);
        decayAll();
        if (h.opp(t) === C) {
          c2[s] += 1;
          c1[s & 3] += 1;
          g1 += 1;
        } else {
          d2[s] += 1;
          d1[s & 3] += 1;
          g0 += 1;
        }
      }
      learned = L;
    }

    /**
     * Априор для контекста глубины 1: общая оценка его добронравия плюс
     * поправка на взаимность (после моего C ждём больше верности, после D —
     * меньше). Без этого уровня контекст, ни разу не встреченный в матче,
     * навсегда сохранял бы врождённый оптимизм: против того, кто не
     * сотрудничал ни разу, курс «всегда C» получал бы выдуманную цену.
     */
    function prior1(s1) {
      var p0 = (g1 + W0 * BASE_TRUST) / (g1 + g0 + W0);
      var p = s1 & 2 ? p0 - RECIPROCITY : p0 + RECIPROCITY;
      if (p < PRIOR_FLOOR) p = PRIOR_FLOOR;
      if (p > PRIOR_CEIL) p = PRIOR_CEIL;
      return p;
    }

    /** Вероятность, что он сыграет C из состояния s: глубина 2 → глубина 1 → априор. */
    function predict(s) {
      var s1 = s & 3;
      var prior = prior1(s1);
      var n1 = c1[s1] + d1[s1];
      var p1 = (c1[s1] + W1 * prior) / (n1 + W1);
      var n2 = c2[s] + d2[s];
      return (c2[s] + W2 * p1) / (n2 + W2);
    }

    /**
     * Средняя выплата за раунд, если держаться курса `policy` HORIZON раундов.
     * Точное распространение распределения по 16 состояниям — без Монте-Карло,
     * поэтому результат детерминирован и ГПСЧ не нужен.
     */
    function evaluate(policy, startState) {
      var dist = distA;
      var next = distB;
      var k;
      for (k = 0; k < STATES; k++) dist[k] = 0;
      dist[startState] = 1;
      var total = 0;
      var step;
      for (step = 0; step < HORIZON; step++) {
        for (k = 0; k < STATES; k++) next[k] = 0;
        for (k = 0; k < STATES; k++) {
          var w = dist[k];
          if (w < 1e-9) continue;
          var intent = policyMove(policy, k);
          var pMine = intent === C ? 1 - NOISE : NOISE; // вероятность, что ляжет C
          var pOpp = pC[k];
          var base = (k & 3) << 2; // прошлый раунд становится позапрошлым
          var wCC = w * pMine * pOpp;
          var wCD = w * pMine * (1 - pOpp);
          var wDC = w * (1 - pMine) * pOpp;
          var wDD = w * (1 - pMine) * (1 - pOpp);
          total += wCC * pay(C, C) + wCD * pay(C, D) + wDC * pay(D, C) + wDD * pay(D, D);
          next[base] += wCC;
          next[base | 1] += wCD;
          next[base | 2] += wDC;
          next[base | 3] += wDD;
        }
        var swap = dist;
        dist = next;
        next = swap;
      }
      distA = dist;
      distB = next;
      return total / HORIZON;
    }

    /**
     * Наблюдения ровно того контекста, который решает вопрос о доении:
     * я предал его сотрудничество (контекст глубины 1 с индексом 2) — что он
     * сделал в ответ. Общий счётчик истории здесь не годится: он валит в одну
     * кучу и этот случай, и взаимное предательство, где мстить не за что.
     */
    function exploitSamples() {
      return c1[2] + d1[2];
    }

    function exploitRate() {
      var n = exploitSamples();
      return n > 0 ? c1[2] / n : 1;
    }

    /** Зонд: заставить безответно доброго обнаружить форму. */
    function wantProbe(h) {
      if (h.length < PROBE_MIN_LEN) return false;
      if (probes >= PROBE_MAX) return false;
      if (exploitSamples() >= PROBE_TARGET) return false;
      // форма обнаружена: он мстит за предательство — больше зондов не нужно
      if (exploitSamples() >= PROBE_STOP_N && exploitRate() < PROBE_STOP_P) return false;
      if (h.oppCoopRate() < PROBE_COOP) return false;
      var gap = h.length < PROBE_CALM ? PROBE_GAP_EARLY : PROBE_GAP;
      if (h.length - lastProbe < gap) return false;
      return true;
    }

    /**
     * Устрашение. Обиду — предательство по моему сотрудничеству — Резонанс
     * считает и отвечает на каждую вторую, а на две подряд отвечает всегда
     * (двойное искажение канала имеет вероятность 0.25%, это уже не шум).
     *
     * Половинчатость не мягкость, а расчёт на предсказателя напротив. Кто
     * прощает всё, у того в чужой таблице стоит «после моего D он верен» — и
     * его доят до конца матча. Кто мстит за каждую мелочь, тот при 5% шума
     * уходит в бесконечное эхо. Ответ через раз даёт в чужой таблице честные
     * ~0.5: доить невыгодно, а эхо затухает за пару ходов.
     */
    function deterrence(h) {
      if (h.length < 1) return false;
      if (!(h.opp(-1) === D && h.mine(-1) === C)) return false;
      if (h.length >= 2 && h.opp(-2) === D) return true; // две подряд — всегда
      return slights % 2 === 0; // на каждую вторую обиду
    }

    /** Заперты ли обе стороны во взаимном предательстве. */
    function inTrench(h) {
      var w = h.moves(OLIVE_WINDOW);
      if (w.opp.length < OLIVE_WINDOW) return false;
      var oppC = 0;
      var myD = 0;
      var k;
      for (k = 0; k < w.opp.length; k++) {
        if (w.opp[k] === C) oppC += 1;
        if (w.mine[k] === D) myD += 1;
      }
      return oppC <= OLIVE_OPP_C && myD >= OLIVE_MY_D;
    }

    return {
      move: function (h) {
        ingest(h);
        if (h.length === 0) return C;
        if (h.opp(-1) === D && h.mine(-1) === C) slights += 1;

        // оливковая ветвь длится два хода подряд
        if (oliveLeft > 0) {
          oliveLeft -= 1;
          return C;
        }

        var L = h.length;
        var m1 = h.mine(L - 1);
        var o1 = h.opp(L - 1);
        var m2 = L >= 2 ? h.mine(L - 2) : C;
        var o2 = L >= 2 ? h.opp(L - 2) : C;
        var state = stateIndex(m2, o2, m1, o1);

        var k;
        for (k = 0; k < STATES; k++) pC[k] = predict(k);

        // Итог прошлой ветви: приняли — предлагаем в прежнем ритме, отвергли —
        // вдвое реже. Мир предлагают, но не выпрашивают.
        if (olivePending && L >= lastOlive + 2) {
          if (h.opp(lastOlive) === D && h.opp(lastOlive + 1) === D) {
            oliveGap = Math.min(oliveGap * 2, OLIVE_GAP_MAX);
          } else {
            oliveGap = OLIVE_GAP;
          }
          olivePending = false;
        }

        // яма взаимного предательства проверяется до расчёта курса
        if (L >= OLIVE_MIN_LEN && L - lastOlive >= oliveGap && inTrench(h)) {
          lastOlive = L;
          oliveLeft = 1;
          olivePending = true;
          return C;
        }

        // ценность курсов
        var values = [];
        var best = 0;
        for (k = 0; k < POLICY_COUNT; k++) {
          values.push(evaluate(k, state));
          if (values[k] > values[best]) best = k;
        }

        // Жадность требует улик. Курс «всегда предавать» против того, кто в
        // основном верен, включается только доказанной безответностью: расчёт
        // склонен принять за неё любую случайную поблажку, а цена ошибки —
        // обрушенное сотрудничество на сто с лишним раундов вперёд. Правило
        // сужено до курса номер один: разовый ответ зеркальных курсов — не
        // жадность, а способ вернуть партнёра к верности. Самозащиты оно тоже
        // не касается: у по-настоящему враждебного доля C ниже порога.
        var action = policyMove(best, state);

        // мера уверенности: время наблюдения, сбитое энтропией прогноза
        var conf = Math.min(1, L / CONF_ROUNDS) * (1 - ENTROPY_PULL * entropy(pC[state]));
        var margin = MARGIN_MIN + MARGIN_MAX * (1 - conf);
        if (action === D && values[best] - values[0] < margin) action = C;

        if (
          best === 1 &&
          action === D &&
          h.oppCoopRate() >= GREED_COOP &&
          !(exploitSamples() >= GREED_N && exploitRate() >= GREED_P)
        ) {
          action = C;
        }

        // устрашение сильнее осторожности: доиться нельзя даже выгодно
        if (deterrence(h)) action = D;

        // зонд перекрывает осторожность: без него безответный не обнаружит форму
        if (action === C && wantProbe(h)) {
          probes += 1;
          lastProbe = L;
          action = D;
        }

        if (L > 0) noteHopeless(h.mine(-1), h.opp(-1));
        if (hopeless) action = D;

        return action;
      }
    };
  }
};

});

define("strategies/challengers/windAndMountain", function (module, exports, require) {
'use strict';

/**
 * ДОСЬЕ · «Ветер и Гора» (WindAndMountain)
 *
 * Принцип трактата:
 *   «Быстрый, как ветер; тихий, как лес; всепожирающий, как огонь; неподвижный,
 *    как гора». (VII. Борьба на войне)
 *   Четыре стихии — это не четыре настроения, а четыре ПОЛОЖЕНИЯ ВОЙСКА, и
 *   переход между ними совершается не по вдохновению, а по донесению разведки.
 *
 * Философия:
 *   Стратегия — конечный автомат из четырёх явных режимов. Она никогда не
 *   «пробует» соперника нарочно: все сведения о нём достаются даром, потому что
 *   5% шума сами превращают часть моих приказов в удары, а часть его приказов —
 *   в измены. Полководец лишь считает.
 *
 *   ВЕТЕР (быстрота) — стартовый режим для непрочитанного соперника: зеркалю
 *     последний исполненный ход. Две поправки, обе про скорость:
 *     «раскаяние» — если я вернул из move() «C», а в историю попало «D» (гонец
 *     перепутал сигнал, видно по сравнению с h.mine(-1)), то два следующих
 *     раунда я держу C и не считаю ответный удар соперника за враждебность;
 *     «размыкание замка» — если последние 8 раундов оба били (взаимное D), я
 *     один раз протягиваю руку: восемь раундов стояния — это уже не отражение
 *     соперника, а окоп, а ветер не стоит. Это не зонд: зонд ищет слабость,
 *     а здесь я выхожу из тупика, в котором теряю столько же, сколько и он.
 *   ЛЕС (тишина) — ровное C без единого зонда, пока партнёр надёжен.
 *   ОГОНЬ (натиск) — чистое D против того, кто доказал, что не отвечает на удар.
 *   ГОРА (неподвижность) — вечное D против того, с кем мир невозможен: ни
 *     зондов, ни примирения, ни реакции на что бы то ни было. Единственный
 *     необратимый режим.
 *
 * СЧЁТЧИКИ (всё считается по ИСПОЛНЕННЫМ ходам, то есть по тому, что соперник
 * реально видел; всё — в пределах текущей «эпохи», эпоха обнуляется после Огня):
 *   u-корзина «неспровоцированные»: раунды i, где мой исполненный ход в i-1 был
 *     C. uN — сколько таких, uD — сколько раз он в них предал.
 *   r-корзина «ответ на удар»: раунды i, где мой исполненный ход в i-1 был D.
 *     rN — сколько таких, rD — сколько раз он в них предал.
 *   Раунд, прощённый раскаянием (i === excuseRound), не идёт НИ В ОДНУ корзину.
 *   win — скользящее окно последних 20 неспровоцированных раундов, winD — число
 *     предательств в нём. streakD — подряд идущие предательства соперника.
 *   epochLen — длина эпохи, oppDefEpoch — все его предательства в эпохе.
 *   fN/fD — раунды и его предательства ВНУТРИ Огня (эпоха на это время заморожена).
 *
 * ПОЛНАЯ ТАБЛИЦА ПЕРЕХОДОВ (проверяется в этом порядке приоритета):
 *   1. ВЕТЕР → ГОРА, если (M1) epochLen ≥ 25 и uN ≥ 6 и uD/uN ≥ 0.40 и
 *        oppDefEpoch/epochLen ≥ 0.40   — он бьёт в ответ на протянутую руку;
 *      либо (M2) epochLen ≥ 30 и uN ≥ 2 и uD === uN и
 *        oppDefEpoch/epochLen ≥ 0.85   — тотальный агрессор: все мои случайные
 *        оливковые ветви растоптаны. Необратимо.
 *   2. ВЕТЕР → ОГОНЬ и ЛЕС → ОГОНЬ, если Огонь ещё не исчерпан (не более двух
 *      входов за матч) и uN ≥ 10 и uD/uN ≤ 0.20 (он в целом мирен, его есть
 *      смысл доить) и при этом он не отвечает на удар:
 *        (F1) rN ≥ 4 и rD === 0   — четыре удара без единого ответа;
 *        (F2) rN ≥ 12 и rD/rN ≤ 0.15 — вяло отвечает, порог выше шумовых 5%.
 *   3. ВЕТЕР → ЛЕС, если окно заполнено (20 неспровоцированных раундов) и
 *      winD ≤ 2 (≤ 10%, шум даёт 5%) и вопрос об Огне закрыт: rD ≥ 1 (он умеет
 *      отвечать) либо epochLen ≥ 40 (ждать дольше невыгодно).
 *   4. ЛЕС → ВЕТЕР, если streakD ≥ 3 (три предательства подряд; чистый шум даёт
 *      это с вероятностью 0.000125) либо окно заполнено и winD ≥ 3 (≥ 15% при
 *      шумовом фоне 5%).
 *   5. ОГОНЬ → ВЕТЕР, если он дал отпор: (fN ≥ 4 и fD/fN ≥ 0.50) либо
 *      (fN ≥ 10 и fD/fN ≥ 0.30). При выходе — ПЕРЕМИРИЕ 10 раундов: они не идут
 *      ни в одну корзину, эпоха начинается после них с нуля. Отпор, который я
 *      сам спровоцировал, не может быть засчитан сопернику как враждебность —
 *      поэтому Гора недостижима из Огня и из его последствий.
 *   6. ГОРА → ничего. Выхода нет.
 *   Из ЛЕСА в ГОРУ напрямую перехода нет: сначала Лес → Ветер (правило 4), и
 *   только оттуда, набрав свежую статистику, Ветер → Гора.
 *
 * Сильные стороны:
 *   — не путает шум с изменой: 5%-й фон заложен во все пороги, собственный
 *     сорвавшийся приказ распознаётся и гасится раскаянием, а глухой замок
 *     размыкается на восьмом раунде, поэтому «эхо» зеркал не разгорается;
 *   — берёт максимум с обоих полюсов лиги: доит безответных Огнём и держит
 *     ровные 3.0 в Лесу с теми, кто отвечает.
 *
 * Слабые стороны:
 *   — Лес по определению не отвечает мгновенно: аккуратный эксплуататор успеет
 *     снять 3–4 удара, прежде чем окно вытолкнет его в Ветер;
 *   — Огонь против собственной копии: два Леса не отвечают на удар и потому
 *     выглядят добычей друг для друга — ограничитель в два входа держит цену
 *     этой ошибки, но не отменяет её;
 *   — отказ от зондов имеет цену: r-корзину наполняет только шум, поэтому в
 *     бесшумном мире (noise = 0) rN навсегда остаётся нулём и Огонь недостижим
 *     в принципе. Против Пацифиста без помех стратегия так и просидит в Лесу
 *     на 3.0 вместо 5.0. Разведка здесь отдана на откуп противнику и каналу
 *     связи — при заявленных 5% этого хватает, при нуле не хватает вовсе.
 *
 *
 * КРУГ 2: что изменено и почему
 *   По донесению круга 1 у стратегии лучшая самоигра турнира (3.00) и при этом
 *   последнее место по итоговой доле: решала не самоигра, а игра с чужими,
 *   где отставание от первого места составило девять сотых очка. Ленты
 *   показали, куда они уходят, — Лес держался дольше выгодного против
 *   регулярного, но умеренного объедалы, а Огонь включался слишком поздно.
 *
 *   Изменено четыре вещи:
 *     — короткое окно Леса (8 раундов, две измены — закрытие) рядом с длинным:
 *       длинное ловит редкого нарушителя, короткое — частого, но осторожного;
 *     — порог Огня снижен с четырёх безответных ударов до трёх, медленный
 *       вариант — с двенадцати наблюдений при отклике ≤15% до восьми при ≤20%;
 *     — Огонь дополнительно закрыт двумя условиями, которых раньше не было:
 *       эпоха не короче 25 раундов и фон измен противника не выше 10% (чистый
 *       шум даёт 5%) — чтобы натиск не начинался по недостоверной статистике;
 *     — после выхода из Огня добавлено искупление: пять раундов безусловного C,
 *       чтобы спровоцированный отпор не был засчитан противнику как измена.
 *
 *   Числа: средний по лиге 2.570 → 2.576, самоигра 3.00 → 2.79 (плата за
 *   более раннее включение Огня: две копии успевают задеть друг друга),
 *   Пацифист 4.11 → 4.18, Агрессор 1.13, Зеркало 2.80.
 * Против кого рассчитана:
 *   Против безответных добряков (Пацифист, всё «прощающее») — Огнём; против
 *   Агрессора и Случайного — Горой; против Зеркала, Павлова и прочих
 *   отвечающих — Лесом, то есть чистой кооперацией без единого зонда.
 */

var C = 'C';
var D = 'D';

// ——— пороги (все проценты даны с поправкой на 5% шума) ———
var WIN_SIZE = 20; // размер скользящего окна неспровоцированных раундов
var FOREST_IN_MAX_D = 2; // ≤10% измен в окне — партнёр надёжен
var FOREST_IN_OPEN = 40; // сколько ждать, если он ни разу не получал удара
var FOREST_OUT_D = 3; // ≥15% измен в окне — Лес закрывается
var FOREST_OUT_STREAK = 3; // три предательства подряд — Лес закрывается сразу
var FOREST_FAST_WIN = 8; // короткое окно против регулярного объедалы
var FOREST_FAST_D = 2; // две измены в коротком окне — Лес закрывается
var FIRE_MIN_U = 10; // минимум наблюдений «он мирен»
var FIRE_MAX_U_RATE = 0.2; // его неспровоцированные измены не выше 20%
var FIRE_FAST_R = 3; // три удара без единого ответа...
var FIRE_SLOW_R = 8; // ...или восемь
var FIRE_SLOW_RATE = 0.2; // с откликом не выше 20%
var FIRE_MAX_ENTRIES = 2; // больше двух пожаров за матч не разводим
var FIRE_MIN_EPOCH = 25; // раньше 25 раундов эпохи фон его измен не считается измеренным
var FIRE_MAX_OPP_DEF = 0.1; // его фон измен не выше 10% (чистый шум даёт 5%)
var FIRE_AMENDS = 5; // раундов безусловного C после Огня — искупление
var RETAL_WINDOW = 2; // сколько раундов ждать его ответа на мой удар
var FIRE_OUT_N1 = 4;
var FIRE_OUT_RATE1 = 0.5;
var FIRE_OUT_N2 = 10;
var FIRE_OUT_RATE2 = 0.3;
var TRUCE = 10; // перемирие после Огня, раундов
var MTN_EPOCH1 = 25;
var MTN_U1 = 6;
var MTN_U_RATE1 = 0.4;
var MTN_DEF_RATE1 = 0.4;
var MTN_EPOCH2 = 30;
var MTN_U2 = 2;
var MTN_DEF_RATE2 = 0.85;
var WIND_LOCK = 8; // длина глухого DD-замка, после которой Ветер один раз протягивает руку
var CONTRITION = 2; // сколько раундов держать C после своего сорвавшегося приказа

module.exports = {
  id: 'windAndMountain',
  latin: 'WindAndMountain',
  name: 'Ветер и Гора',
  color: '#fda4af',
  glyph: '風',
  family: 'challenger',
  tagline: 'Четыре режима: ветер, лес, огонь, гора',
  dossier: {
    principle:
      '«Быстрый, как ветер; тихий, как лес; всепожирающий, как огонь; неподвижный, как гора» — VII. Борьба на войне',
    philosophy:
      'Конечный автомат из четырёх положений войска. ВЕТЕР — зеркало последнего исполненного ' +
      'хода плюс раскаяние: свой сорвавшийся приказ виден по расхождению move() и h.mine(-1), ' +
      'и два раунда после него я держу C, а ответный удар соперника не считаю враждебностью; ' +
      'плюс размыкание замка: после 8 раундов взаимного D один раз протягиваю руку. ' +
      'ЛЕС — ровное C без единого зонда. ОГОНЬ — чистое D. ГОРА — вечное D. ' +
      'Статистика ведётся по исполненным ходам в пределах эпохи: u-корзина (uN/uD) — его ходы ' +
      'после моего C, r-корзина (rN/rD) — его ходы после моего D, окно win — последние 20 ' +
      'неспровоцированных раундов, streakD — измены подряд. ' +
      'ТАБЛИЦА ПЕРЕХОДОВ по приоритету: ' +
      '(1) ВЕТЕР → ГОРА, если epochLen ≥ 25, uN ≥ 6, uD/uN ≥ 0.40 и доля его измен в эпохе ' +
      '≥ 0.40; либо epochLen ≥ 30, uN ≥ 2, uD = uN и доля измен ≥ 0.85. Необратимо. ' +
      '(2) ВЕТЕР → ОГОНЬ и ЛЕС → ОГОНЬ, если входов в Огонь было меньше двух, uN ≥ 10, ' +
      'uD/uN ≤ 0.20 и он не отвечает на удар: rN ≥ 4 при rD = 0 либо rN ≥ 12 при rD/rN ≤ 0.15. ' +
      '(3) ВЕТЕР → ЛЕС, если окно из 20 неспровоцированных раундов набрано, измен в нём ≤ 2 ' +
      'и вопрос об Огне закрыт: rD ≥ 1 либо epochLen ≥ 40. ' +
      '(4) ЛЕС → ВЕТЕР, если 3 измены подряд либо ≥ 3 измены в окне из 20. ' +
      '(5) ОГОНЬ → ВЕТЕР, если он дал отпор: fN ≥ 4 при доле его измен ≥ 0.50 либо fN ≥ 10 при ' +
      'доле ≥ 0.30; после выхода — перемирие 10 раундов, которые не идут ни в одну корзину, и ' +
      'эпоха начинается с чистого листа. (6) ГОРА → ничего. ' +
      'Гора недостижима из Огня и из его последствий: спровоцированный мною отпор не ' +
      'засчитывается сопернику как враждебность.',
    strengths: [
      'Шум заложен в пороги, свой сорвавшийся приказ гасится раскаянием, а глухой DD-замок размыкается на 8-м раунде — эхо не разгорается',
      'Берёт максимум с обоих полюсов: Огонь доит безответных, Лес держит 3.0 с отвечающими'
    ],
    weaknesses: [
      'Лес не отвечает мгновенно: аккуратный эксплуататор снимет 3–4 удара до выхода в Ветер',
      'Против собственной копии два Леса выглядят добычей друг для друга — спасает лишь лимит в два Огня'
    ],
    targets:
      'Огнём — против безответных добряков вроде «Пацифиста»; Горой — против «Агрессора» и «Случайного»; Лесом — против «Зеркала», «Павлова» и всех, кто отвечает на удар'
  },

  create: function () {
    var mode = 'wind';

    // — статистика текущей эпохи —
    var uN = 0;
    var uD = 0;
    var rN = 0;
    var rD = 0;
    var epochLen = 0;
    var oppDefEpoch = 0;
    var win = [];
    var winD = 0;
    var fast = [];
    var fastD = 0;
    var pending = []; // удары, ответ на которые ещё ждём

    // — сквозные счётчики —
    var streakD = 0;
    var processed = 0;
    var truceUntil = -1; // раунды с индексом < truceUntil в статистику не идут
    var excuseRound = -1; // раунд, прощённый раскаянием
    var fN = 0;
    var fD = 0;
    var fireEntries = 0;
    var intended = null;
    var contrite = 0;
    var amends = 0;

    function pushWin(isD) {
      win.push(isD ? 1 : 0);
      if (isD) winD += 1;
      if (win.length > WIN_SIZE) {
        winD -= win.shift();
      }
    }

    // Короткое окно: ловит частого, но регулярного объедалу быстрее длинного.
    function pushFast(isD) {
      fast.push(isD ? 1 : 0);
      if (isD) fastD += 1;
      if (fast.length > FOREST_FAST_WIN) {
        fastD -= fast.shift();
      }
    }

    function resetEpoch() {
      uN = 0;
      uD = 0;
      rN = 0;
      rD = 0;
      epochLen = 0;
      oppDefEpoch = 0;
      win = [];
      winD = 0;
      fast = [];
      fastD = 0;
      pending = [];
    }

    // Сворачивает в счётчики все раунды, доигранные с прошлого вызова.
    function ingest(h) {
      while (processed < h.length) {
        var i = processed;
        var oppNow = h.opp(i);
        var oppBetrayed = oppNow === D;

        if (oppBetrayed) streakD += 1;
        else streakD = 0;

        if (mode === 'fire') {
          // Эпоха заморожена: всё, что видно в Огне, спровоцировано мною.
          fN += 1;
          if (oppBetrayed) fD += 1;
        } else if (i >= truceUntil) {
          epochLen += 1;
          if (oppBetrayed) oppDefEpoch += 1;
          if (i >= 1 && i !== excuseRound) {
            if (h.mine(i - 1) === D) {
              // Удар состоялся в i-1; ответ ждём RETAL_WINDOW раундов.
              pending.push({ at: i - 1, answered: false });
            } else {
              uN += 1;
              if (oppBetrayed) uD += 1;
              pushWin(oppBetrayed);
              pushFast(oppBetrayed);
            }
          }
          // Закрываем удары, у которых окно ответа истекло.
          var keep = [];
          for (var k = 0; k < pending.length; k++) {
            var hit = pending[k];
            if (oppBetrayed) hit.answered = true;
            if (i - hit.at >= RETAL_WINDOW) {
              rN += 1;
              if (hit.answered) rD += 1;
            } else {
              keep.push(hit);
            }
          }
          pending = keep;
        }
        processed += 1;
      }
    }

    function lockLen(h) {
      var n = 0;
      var i = h.length - 1;
      while (i >= 0 && h.mine(i) === D && h.opp(i) === D) {
        n += 1;
        i -= 1;
      }
      return n;
    }

    function mountainReady() {
      if (epochLen >= MTN_EPOCH1 && uN >= MTN_U1 && uD / uN >= MTN_U_RATE1 &&
        oppDefEpoch / epochLen >= MTN_DEF_RATE1) {
        return true;
      }
      return epochLen >= MTN_EPOCH2 && uN >= MTN_U2 && uD === uN &&
        oppDefEpoch / epochLen >= MTN_DEF_RATE2;
    }

    function fireReady() {
      if (fireEntries >= FIRE_MAX_ENTRIES) return false;
      if (uN < FIRE_MIN_U || uD / uN > FIRE_MAX_U_RATE) return false;
      // Главный фильтр круга 2: доить можно только того, кто ВООБЩЕ не бьёт.
      // Фон его измен должен быть на уровне шума, а не «чуть выше».
      if (epochLen < FIRE_MIN_EPOCH || oppDefEpoch / epochLen > FIRE_MAX_OPP_DEF) return false;
      if (rN >= FIRE_FAST_R && rD === 0) return true;
      return rN >= FIRE_SLOW_R && rD / rN <= FIRE_SLOW_RATE;
    }

    function forestReady() {
      if (win.length < WIN_SIZE || winD > FOREST_IN_MAX_D) return false;
      return rD >= 1 || epochLen >= FOREST_IN_OPEN;
    }

    function forestBroken() {
      if (streakD >= FOREST_OUT_STREAK) return true;
      if (fast.length >= FOREST_FAST_WIN && fastD >= FOREST_FAST_D) return true;
      return win.length >= WIN_SIZE && winD >= FOREST_OUT_D;
    }

    function fireBroken() {
      if (fN >= FIRE_OUT_N1 && fD / fN >= FIRE_OUT_RATE1) return true;
      return fN >= FIRE_OUT_N2 && fD / fN >= FIRE_OUT_RATE2;
    }

    return {
      move: function (h) {
        ingest(h);

        // Распознавание собственного сорвавшегося приказа: сравниваем то, что
        // вернули из move(), с тем, что попало в историю.
        if (intended !== null && h.length > 0 && h.mine(-1) !== intended) {
          if (intended === C && (mode === 'wind' || mode === 'forest')) {
            contrite = CONTRITION;
            // Его ответ через раунд после удара тоже не в счёт: тот раунд
            // пойдёт после моего покаянного C и иначе попал бы в u-корзину.
            excuseRound = h.length + 1;
          }
        }

        // ——— переходы ———
        if (mode === 'fire') {
          if (fireBroken()) {
            mode = 'wind';
            fN = 0;
            fD = 0;
            resetEpoch();
            truceUntil = h.length + TRUCE;
            contrite = 0;
            amends = FIRE_AMENDS; // перемирие теперь и в ходах, а не только в счётчиках
          }
        } else if (mode !== 'mountain') {
          if (mode === 'wind' && mountainReady()) {
            mode = 'mountain';
          } else if (fireReady()) {
            mode = 'fire';
            fireEntries += 1;
            fN = 0;
            fD = 0;
            contrite = 0;
          } else if (mode === 'wind') {
            if (forestReady()) {
              mode = 'forest';
              contrite = 0; // в Лесу и так одно C, долг раскаяния не переносим
            }
          } else if (forestBroken()) {
            mode = 'wind';
          }
        }

        // ——— ход ———
        var move;
        if (mode === 'mountain' || mode === 'fire') {
          move = D;
        } else if (mode === 'forest') {
          move = C;
        } else if (amends > 0) {
          // Искупление: войну начал я, поэтому его ответный огонь принимаю
          // молча и не отражаю — иначе Ветер сам продлевает мою же войну.
          amends -= 1;
          move = C;
        } else if (contrite > 0) {
          contrite -= 1;
          move = C;
        } else if (h.length === 0) {
          move = C;
        } else if (lockLen(h) >= WIND_LOCK) {
          // Размыкание глухого замка: восемь раундов взаимного D — это уже не
          // отражение соперника, а стояние. Ветер обязан быть быстрым.
          move = C;
        } else {
          move = h.lastOpp() === D ? D : C;
        }

        intended = move;
        return move;
      }
    };
  }
};

});

define("strategies/evolved/nameless", function (module, exports, require) {
'use strict';

/*
 * ДОСЬЕ · «Безымянный» (Nameless) — выведен эволюцией, не написан рукой
 *
 * ЭТОТ ФАЙЛ СГЕНЕРИРОВАН `node sim/evolve.js`. Правки будут перезаписаны.
 * Досье выводится из самой хромосомы, поэтому описание не может разойтись
 * с поведением.
 *
 * Происхождение:
 *   сид 42, популяция 64, 150 поколений, матч 150 раундов, шум 0.05.
 *   Отбор турнирный (3), кроссовер 0.6, мутация 0.01, элита 2.
 *   Рукописных стратегий в среде отбора не было: популяция варилась
 *   в собственном соку, и встреча с лигой — независимая проверка.
 *   К последнему поколению этот геном занял 49 мест из 64.
 *
 * Хромосома: DDCDDCDDCDDDDCDDDCDDC
 *   [0] первый ход, [1..4] ответ во втором раунде, [5..20] память на два раунда.
 *
 * Принцип трактата:
 *   «У войска нет неизменной мощи, у воды нет неизменной формы; кто умеет
 *    в зависимости от противника владеть изменениями и превращениями и
 *    одерживать победу, тот называется божеством». (VI. Полнота и пустота)
 *   У Безымянного нет ни имени, ни замысла, ни принципа — только таблица,
 *   которую отобрала выгода. Он единственный в лиге, кто не знает, почему
 *   поступает так, как поступает.
 *
 * Что он делает (полная таблица ответов, читается «что было → мой ответ»):
 *   первый ход: D
 *     CC → CC  →  C
 *     CC → CD  →  D
 *     CC → DC  →  D
 *     CC → DD  →  C
 *     CD → CC  →  D
 *     CD → CD  →  D
 *     CD → DC  →  D
 *     CD → DD  →  D
 *     DC → CC  →  C
 *     DC → CD  →  D
 *     DC → DC  →  D
 *     DC → DD  →  D
 *     DD → CC  →  C
 *     DD → CD  →  D
 *     DD → DC  →  D
 *     DD → DD  →  C
 *
 * Черты, выведенные из таблицы:
 *   — держит достигнутый мир;
 *   — отвечает на предательство;
 *   — выходит из взаимной войны сам;
 *   — доит того, кто стерпел удар;
 *   — НЕ открывает сотрудничеством;
 *   — НЕ прощает исправившегося;
 *   — НЕ извиняется за собственный сорвавшийся ход;
 *
 * На кого похож:
 *   TitForTat 56%, Pavlov 81%, AlwaysCooperate 31%, AlwaysDefect 69%.
 *   Ближе всего к Pavlov, но совпадение неполное — расхождения
 *   и есть то, что эволюция нашла сама.
 */

var genomeLib = require('../../engine/genome');

var GENOME = 'DDCDDCDDCDDDDCDDDCDDC';

module.exports = genomeLib.toStrategy(GENOME, {
  id: 'nameless',
  latin: 'Nameless',
  name: 'Безымянный',
  color: '#f8fafc',
  glyph: '無',
  family: 'evolved',
  tagline: 'Таблица на 21 локус, отобранная выгодой',
  dossier: {
    principle: '«У войска нет неизменной мощи» — VI. Полнота и пустота',
    philosophy:
      'Не написан, а выведен: 150 поколений отбора в популяции из 64 ' +
      'хромосом, без единой рукописной стратегии в среде. Хромосома DDCDDCDDCDDDDCDDDCDDC. ' +
      'Ближе всего к Pavlov (81% состояний), но совпадение неполное.',
    strengths: [
      'Ни одного правила, придуманного человеком, — только то, что окупилось',
      'Занял 49 мест из 64 в последнем поколении: устойчив к собственным копиям'
    ],
    weaknesses: [
      'Память ровно на два раунда: длинные замыслы соперника ему невидимы',
      'Отобран против себе подобных, а не против лиги — встреча с ней для него внезапна'
    ],
    targets: 'Ни против кого специально — это и есть вопрос эксперимента'
  }
});

});

  var LEAGUE = [
    { id: "alwaysCooperate", color: "#34d399", module: "strategies/alwaysCooperate" },
    { id: "alwaysDefect", color: "#ff4d5e", module: "strategies/alwaysDefect" },
    { id: "random", color: "#a78bfa", module: "strategies/random" },
    { id: "titForTat", color: "#38bdf8", module: "strategies/titForTat" },
    { id: "grimTrigger", color: "#fb7c3c", module: "strategies/grimTrigger" },
    { id: "pavlov", color: "#fbbf24", module: "strategies/pavlov" },
    { id: "knowTheEnemy", color: "#a3e635", module: "strategies/knowTheEnemy" },
    { id: "winWithoutFighting", color: "#f472b6", module: "strategies/winWithoutFighting" },
    { id: "feignedWeakness", color: "#d97757", module: "strategies/feignedWeakness" },
    { id: "patience", color: "#94a3b8", module: "strategies/patience" },
    { id: "waterShape", color: "#0d9488", module: "strategies/waterShape" },
    { id: "reconInForce", color: "#e879f9", module: "strategies/reconInForce" },
    { id: "counterIntelligence", color: "#0ea5e9", module: "strategies/challengers/counterIntelligence" },
    { id: "quartermaster", color: "#ca8a04", module: "strategies/challengers/quartermaster" },
    { id: "resonance", color: "#7c3aed", module: "strategies/challengers/resonance" },
    { id: "windAndMountain", color: "#be123c", module: "strategies/challengers/windAndMountain" },
    { id: "nameless", color: "#f8fafc", module: "strategies/evolved/nameless" }
  ];

  return {
    require: load,
    /** Определения участников лиги в порядке реестра, с назначенными цветами. */
    league: function () {
      return LEAGUE.map(function (row) {
        var def = load(row.module);
        var copy = {};
        for (var k in def) if (Object.prototype.hasOwnProperty.call(def, k)) copy[k] = def[k];
        copy.color = row.color;
        return copy;
      });
    }
  };
})();
