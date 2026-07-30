'use strict';

/**
 * Реестр стратегий основной лиги.
 *
 * Порядок массива фиксирован и является частью протокола детерминизма: индекс
 * стратегии входит в сид каждого матча (см. sim/tournament.js), поэтому
 * перестановка элементов изменит результаты прогонов. Новые стратегии
 * добавлять только в конец.
 */

/**
 * Ядро лиги — двенадцать стратегий первого сезона. Список заморожен: индекс
 * стратегии входит в сид каждого матча, поэтому любая перестановка изменила бы
 * все прогоны и обесценила бы числа в REPORT.md. Новые участники добавляются
 * только в `admitted`, то есть в хвост общего списка, где они ничьих сидов
 * не сдвигают.
 */
var core = [
  require('./alwaysCooperate'),
  require('./alwaysDefect'),
  require('./random'),
  require('./titForTat'),
  require('./grimTrigger'),
  require('./pavlov'),
  require('./knowTheEnemy'),
  require('./winWithoutFighting'),
  require('./feignedWeakness'),
  require('./patience'),
  require('./waterShape'),
  require('./reconInForce')
];

/**
 * Приём в лигу.
 *
 * Цвет — метаданные визуализатора, а не механика: он не входит ни в сид матча,
 * ни в расчёт, и его смена не меняет ни одного числа в results/. Поэтому при
 * приёме цвет назначается заново, из палитры, разведённой по тону: в закрытом
 * турнире из пяти участников соседние оттенки незаметны, а на карте
 * территории из семнадцати фракций две близкие заливки сливаются. Замер:
 * с исходными цветами худшая пара с участием новичка давала перцептивное
 * расстояние 71 (Прагматик ↔ Интендант), с назначенными — 82.
 * Всё остальное — механика, досье, имя — остаётся авторским.
 */
function admit(def, color) {
  var copy = Object.assign({}, def);
  copy.color = color;
  return copy;
}

/**
 * Принятые в лигу после первого сезона: четверо выживших претендентов
 * (все четверо пережили оба круга) и выведенный генетикой «Безымянный».
 * Порядок заморожен и только дописывается — индексы ядра не сдвигаются,
 * поэтому прогоны первого сезона остаются воспроизводимыми.
 */
var admitted = [
  admit(require('./challengers/counterIntelligence'), '#0ea5e9'),
  admit(require('./challengers/quartermaster'), '#ca8a04'),
  admit(require('./challengers/resonance'), '#7c3aed'),
  admit(require('./challengers/windAndMountain'), '#be123c'),
  admit(require('./evolved/nameless'), '#f8fafc')
];

/** Основная лига целиком: ядро плюс принятые. */
var list = core.concat(admitted);

var REQUIRED_FIELDS = ['id', 'latin', 'name', 'color', 'glyph', 'family', 'tagline', 'dossier'];
var REQUIRED_DOSSIER = ['principle', 'philosophy', 'strengths', 'weaknesses', 'targets'];

/**
 * Проверка контракта стратегии. Вызывается при загрузке реестра и в тестах:
 * дешевле упасть на старте, чем отрисовать карточку с пустым досье.
 * @param {object} def
 * @returns {object} тот же def
 */
function validate(def) {
  REQUIRED_FIELDS.forEach(function (field) {
    if (def[field] === undefined || def[field] === null || def[field] === '') {
      throw new Error('Стратегия без поля "' + field + '": ' + JSON.stringify(def && def.id));
    }
  });
  REQUIRED_DOSSIER.forEach(function (field) {
    if (!def.dossier[field] || !def.dossier[field].length) {
      throw new Error('Досье "' + def.id + '" без поля "' + field + '"');
    }
  });
  if (typeof def.create !== 'function') {
    throw new Error('Стратегия "' + def.id + '" без фабрики create()');
  }
  return def;
}

var seen = Object.create(null);
var seenColor = Object.create(null);
list.forEach(function (def) {
  validate(def);
  if (seen[def.id]) throw new Error('Дублирующийся id стратегии: ' + def.id);
  if (seenColor[def.color]) {
    throw new Error('Дублирующийся цвет ' + def.color + ': ' + seenColor[def.color] + ' и ' + def.id);
  }
  seen[def.id] = def;
  seenColor[def.color] = def.id;
});

/** @param {string} id @returns {object|undefined} */
function byId(id) {
  return seen[id];
}

/** Метаданные без фабрик — то, что уезжает в JSON и в визуализатор. */
function meta(defs) {
  return (defs || list).map(function (def) {
    return {
      id: def.id,
      latin: def.latin,
      name: def.name,
      color: def.color,
      glyph: def.glyph,
      family: def.family,
      tagline: def.tagline,
      dossier: {
        principle: def.dossier.principle,
        philosophy: def.dossier.philosophy,
        strengths: def.dossier.strengths.slice(),
        weaknesses: def.dossier.weaknesses.slice(),
        targets: def.dossier.targets
      }
    };
  });
}

module.exports = {
  core: core,
  admitted: admitted,
  list: list,
  byId: byId,
  meta: meta,
  validate: validate,
  REQUIRED_FIELDS: REQUIRED_FIELDS,
  REQUIRED_DOSSIER: REQUIRED_DOSSIER
};
