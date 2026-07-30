'use strict';

/**
 * Реестр претендентов.
 *
 * Отдельный от основной лиги намеренно: добавление стратегий в
 * `strategies/index.js` сдвинуло бы индексы, а вместе с ними — сиды всех
 * матчей, и обесценило бы каждый прогон и каждое число в отчёте.
 * Претенденты живут своим закрытым турниром (`sim/challengers.js`).
 *
 * Каждый файл здесь написан отдельным автором по собственному брифу и без
 * доступа к коду остальных претендентов; подробности и оговорка о том, как
 * это получилось на самом деле, — в DECISIONS.md.
 */

var validate = require('../index').validate;

var list = [
  require('./counterIntelligence'),
  require('./quartermaster'),
  require('./resonance'),
  require('./windAndMountain')
];

var seen = Object.create(null);
list.forEach(function (def) {
  validate(def);
  if (def.family !== 'challenger') {
    throw new Error('Претендент "' + def.id + '" должен иметь family: "challenger"');
  }
  if (seen[def.id]) throw new Error('Дублирующийся id претендента: ' + def.id);
  seen[def.id] = def;
});

/** @param {string} id @returns {object|undefined} */
function byId(id) {
  return seen[id];
}

module.exports = { list: list, byId: byId };
