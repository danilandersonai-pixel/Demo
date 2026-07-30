'use strict';

/**
 * Сборка `viz/strategies.js` — кода стратегий для браузера.
 *
 * Нужен режиму «Сыграй сам»: человек играет вживую против участника лиги, и
 * играть он должен против НАСТОЯЩЕЙ стратегии, а не против её пересказа.
 * Переписывать семнадцать характеров на клиенте значило бы завести вторую
 * реализацию, которая начнёт расходиться с первой в тот же день, — и разбор
 * после матча стал бы разбором несуществующего противника.
 *
 * Поэтому исходники модулей переносятся дословно, байт в байт, и оборачиваются
 * в минимальный аналог CommonJS: у каждого модуля свои `module`, `exports` и
 * `require`, разрешающий относительные пути по той же схеме, что и Node.
 * Ничего не транспилируется — весь код и так ES5 внутри IIFE.
 *
 * Почему не `fetch` исходников из браузера: `arena.html` открывается двойным
 * щелчком с диска, а `file://` запросы браузер блокирует. Отсюда же и форма
 * выдачи — присваивание в `window`, как у `replay.js`.
 *
 *   node sim/bundle.js
 */

var fs = require('node:fs');
var path = require('node:path');

var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, 'viz', 'strategies.js');

/**
 * Модули движка, которые нужны стратегиям и интерактивному матчу.
 *
 * `engine/match` здесь не ради живого поединка — тот идёт по раунду за клик и
 * своим циклом, — а ради разбора после боя: все контрфакты («а если бы ты не
 * бил первым», «а если бы с пятого раунда играл Зеркалом») считаются тем же
 * `playMatch`, что и весь турнир. Иначе разбор мерил бы одну реализацию правил
 * против другой.
 */
var ENGINE = ['engine/payoff', 'engine/rng', 'engine/history', 'engine/genome', 'engine/match'];

/**
 * Путь модуля стратегии по её положению в реестре. Реестр — единственный
 * источник истины о составе лиги, поэтому список выводится из него, а не
 * дублируется здесь: добавили участника — он приедет в браузер сам.
 */
function strategyModules() {
  var registry = require('../strategies');
  var core = registry.core.map(function (def) {
    return { id: def.id, module: 'strategies/' + def.id, color: def.color };
  });
  // Принятые лежат в подкаталогах, и цвет им назначен реестром при приёме —
  // берём именно назначенный, иначе браузер раскрасил бы лигу по-своему.
  var admitted = registry.admitted.map(function (def) {
    var dir = def.id === 'nameless' ? 'evolved' : 'challengers';
    return { id: def.id, module: 'strategies/' + dir + '/' + def.id, color: def.color };
  });
  return core.concat(admitted);
}

/** Нормализация относительного пути: 'strategies/evolved' + '../../engine/genome'. */
function resolvePath(fromDir, spec) {
  var parts = fromDir ? fromDir.split('/') : [];
  spec.split('/').forEach(function (seg) {
    if (seg === '.' || seg === '') return;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  });
  return parts.join('/');
}

function readModule(id) {
  var src = fs.readFileSync(path.join(ROOT, id + '.js'), 'utf8');
  if (src.indexOf('</scr' + 'ipt>') >= 0) {
    throw new Error(id + ': в исходнике закрывающий тег скрипта — он разорвёт страницу');
  }
  return src;
}

function build() {
  var mods = strategyModules();
  var ids = ENGINE.concat(mods.map(function (m) { return m.module; }));

  var defs = ids.map(function (id) {
    return 'define(' + JSON.stringify(id) + ', function (module, exports, require) {\n'
      + readModule(id)
      + '\n});\n';
  }).join('\n');

  var league = mods.map(function (m) {
    return '    { id: ' + JSON.stringify(m.id)
      + ', color: ' + JSON.stringify(m.color)
      + ', module: ' + JSON.stringify(m.module) + ' }';
  }).join(',\n');

  return [
    '/* Автоматически сгенерировано `node sim/bundle.js`. Правки будут перезаписаны.',
    ' *',
    ' * Исходники стратегий и движка, перенесённые в браузер дословно. Нужны',
    ' * режиму «Сыграй сам»: человек играет против настоящего кода участника',
    ' * лиги, а не против его пересказа на клиенте.',
    ' *',
    ' * Подаётся присваиванием в window, а не через fetch: страница открывается',
    ' * с диска, где запросы к file:// блокируются браузером.',
    ' */',
    'window.ARENA_CODE = (function () {',
    '  \'use strict\';',
    '',
    '  var factories = {};',
    '  var cache = {};',
    '',
    '  function define(id, factory) { factories[id] = factory; }',
    '',
    '  function resolve(fromDir, spec) {',
    '    if (spec.charAt(0) !== \'.\') return spec;',
    '    var parts = fromDir ? fromDir.split(\'/\') : [];',
    '    spec.split(\'/\').forEach(function (seg) {',
    '      if (seg === \'.\' || seg === \'\') return;',
    '      if (seg === \'..\') parts.pop();',
    '      else parts.push(seg);',
    '    });',
    '    return parts.join(\'/\');',
    '  }',
    '',
    '  function load(id) {',
    '    if (cache[id]) return cache[id].exports;',
    '    var factory = factories[id];',
    '    if (!factory) throw new Error(\'нет модуля \' + id);',
    '    var dir = id.split(\'/\').slice(0, -1).join(\'/\');',
    '    var module = { exports: {} };',
    '    cache[id] = module;',
    '    factory(module, module.exports, function (spec) { return load(resolve(dir, spec)); });',
    '    return module.exports;',
    '  }',
    '',
    defs,
    '  var LEAGUE = [',
    league,
    '  ];',
    '',
    '  return {',
    '    require: load,',
    '    /** Определения участников лиги в порядке реестра, с назначенными цветами. */',
    '    league: function () {',
    '      return LEAGUE.map(function (row) {',
    '        var def = load(row.module);',
    '        var copy = {};',
    '        for (var k in def) if (Object.prototype.hasOwnProperty.call(def, k)) copy[k] = def[k];',
    '        copy.color = row.color;',
    '        return copy;',
    '      });',
    '    }',
    '  };',
    '})();',
    ''
  ].join('\n');
}

function main() {
  var out = build();
  fs.writeFileSync(OUT, out, 'utf8');
  var kb = (Buffer.byteLength(out) / 1024).toFixed(1);
  process.stdout.write('viz/strategies.js — ' + kb + ' КБ\n');
}

if (require.main === module) main();

module.exports = { build: build, resolvePath: resolvePath, ENGINE: ENGINE, OUT: OUT };
