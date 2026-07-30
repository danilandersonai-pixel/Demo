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
 * Принятые в лигу после первого сезона: выжившие претенденты и выведенный
 * генетикой «Безымянный». Порядок тоже заморожен и тоже только дописывается.
 */
var admitted = [];

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
list.forEach(function (def) {
  validate(def);
  if (seen[def.id]) throw new Error('Дублирующийся id стратегии: ' + def.id);
  seen[def.id] = def;
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
