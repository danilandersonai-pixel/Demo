'use strict';

/**
 * Контракт между симуляцией и визуализатором.
 *
 * Здесь две разные проверки, и обе нужны.
 *
 * 1. Схема ARENA_DATA. Реальный файл viz/replay.js исполняется в песочнице
 *    с подставным `window` и проверяется поле за полем — ровно так, как его
 *    прочитает браузер.
 *
 * 2. Обратная проверка: что код отрисовки не обращается к полям, которых
 *    в данных нет. Из viz/arena.html вырезается код рендерера, из него
 *    удаляются комментарии и строковые литералы, и всё оставшееся
 *    сканируется на обращения вида `run.поле`, `frame.поле`, `lane.поле` и так
 *    далее. Каждое найденное поле обязано существовать в настоящих данных.
 *    Поэтому семь имён — data, run, frame, lane, st, sp, spFrame — в
 *    arena.html зарезервированы под объекты данных и ни для чего другого
 *    не используются (об этом сказано в шапке самого рендерера).
 */

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

var VIZ = path.join(__dirname, '..', 'viz');
var REPLAY = path.join(VIZ, 'replay.js');
var ARENA = path.join(VIZ, 'arena.html');

/**
 * Исполнить replay.js так же, как это сделает браузер: скормить файлу объект
 * `window` и забрать то, что он туда положил.
 *
 * Намеренно без vm.createContext: отдельный контекст — это отдельный realm со
 * своими Object и Array, и тогда deepStrictEqual спотыкается не о данные,
 * а о прототипы. Здесь важно проверять содержимое, а не происхождение объектов.
 */
function loadArenaData() {
  assert.ok(fs.existsSync(REPLAY), 'нет viz/replay.js — запусти node sim/run.js --all');
  var src = fs.readFileSync(REPLAY, 'utf8');
  var host = {};
  vm.compileFunction(src, ['window'], { filename: 'replay.js' })(host);
  return host.ARENA_DATA;
}

var data = loadArenaData();

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

/* ======================== Схема верхнего уровня ======================== */

test('ARENA_DATA: подаётся присваиванием в window, без fetch', function () {
  var src = fs.readFileSync(REPLAY, 'utf8');
  assert.ok(/window\.ARENA_DATA\s*=/.test(src), 'данные должны присваиваться в window.ARENA_DATA');
  assert.strictEqual(src.indexOf('fetch('), -1, 'fetch не работает с file:// — его быть не должно');

  var html = fs.readFileSync(ARENA, 'utf8');
  assert.ok(/<script src="replay\.js"><\/script>/.test(html), 'arena.html должна подключать replay.js тегом');
  assert.strictEqual(html.indexOf('http://'), -1, 'никаких внешних ресурсов');
  assert.strictEqual(html.indexOf('https://'), -1, 'никаких внешних ресурсов');
});

test('ARENA_DATA: корень содержит все обязательные разделы', function () {
  assert.ok(data, 'ARENA_DATA не определён');
  assert.strictEqual(data.version, 1);
  ['meta', 'strategies', 'runs'].forEach(function (key) {
    assert.ok(data[key], 'нет раздела ' + key);
  });
  assert.ok(Array.isArray(data.runs) && data.runs.length >= 3, 'нужны все три эталонных прогона');
  assert.ok('spatial' in data, 'ключ spatial обязан присутствовать, пусть даже равным null');
  assert.ok('challengers' in data, 'ключ challengers обязан присутствовать, пусть даже равным null');
});

test('ARENA_DATA: meta описывает условия турнира', function () {
  var meta = data.meta;
  assert.deepStrictEqual(meta.payoff, { R: 3, P: 1, T: 5, S: 0 });
  assert.strictEqual(meta.rounds, 200);
  assert.strictEqual(meta.generations, 30);
  assert.strictEqual(meta.noise, 0.05);
  assert.strictEqual(meta.dominationThreshold, 0.6);
  assert.strictEqual(meta.extinctionThreshold, 0.005);
  assert.deepStrictEqual(meta.seeds, [7, 42, 2026], 'реплей обязан содержать сиды 7, 42 и 2026');
});

test('ARENA_DATA: у каждой стратегии заполнено досье целиком', function () {
  assert.ok(data.strategies.length >= 10);
  data.strategies.forEach(function (st) {
    ['id', 'latin', 'name', 'color', 'glyph', 'family', 'tagline'].forEach(function (key) {
      assert.ok(typeof st[key] === 'string' && st[key].length, st.id + ': пустое поле ' + key);
    });
    assert.ok(/^#[0-9a-f]{6}$/i.test(st.color), st.id + ': цвет должен быть hex');
    var d = st.dossier;
    assert.ok(d, st.id + ': нет досье');
    ['principle', 'philosophy', 'targets'].forEach(function (key) {
      assert.ok(typeof d[key] === 'string' && d[key].length > 10, st.id + ': короткое поле ' + key);
    });
    ['strengths', 'weaknesses'].forEach(function (key) {
      assert.ok(Array.isArray(d[key]) && d[key].length >= 2, st.id + ': нужно ≥2 пункта в ' + key);
      d[key].forEach(function (line) {
        assert.ok(typeof line === 'string' && line.length > 5, st.id + ': пустой пункт в ' + key);
      });
    });
  });
});

/* ============================ Схема прогонов ============================ */

test('ARENA_DATA: каждый прогон полон и внутренне согласован', function () {
  data.runs.forEach(function (run) {
    ['seed', 'noise', 'rounds', 'generations', 'dominationThreshold',
      'extinctionThreshold', 'totalMatches'].forEach(function (key) {
      assert.ok(isNum(run[key]), 'прогон ' + run.seed + ': поле ' + key + ' не число');
    });
    assert.strictEqual(run.frames.length, run.generations);
    assert.ok(Array.isArray(run.strategyIds) && run.strategyIds.length >= 10);

    run.strategyIds.forEach(function (id) {
      assert.ok(
        data.strategies.some(function (st) { return st.id === id; }),
        'в прогоне есть фракция ' + id + ', которой нет в справочнике стратегий'
      );
    });

    ['type', 'id', 'gen'].forEach(function (key) {
      assert.ok(run.outcome[key] !== undefined, 'нет outcome.' + key);
    });
    assert.ok(['domination', 'extinction', 'coexistence'].indexOf(run.outcome.type) >= 0);

    run.standings.forEach(function (row) {
      assert.ok(typeof row.id === 'string' && isNum(row.share) && isNum(row.fitness));
    });
    run.extinctions.forEach(function (row) {
      assert.ok(typeof row.id === 'string' && isNum(row.gen));
    });
  });
});

test('ARENA_DATA: каждый кадр поколения содержит все массивы нужной длины', function () {
  data.runs.forEach(function (run) {
    var n = run.strategyIds.length;
    run.frames.forEach(function (frame) {
      assert.ok(isNum(frame.gen) && isNum(frame.avgFitness) && isNum(frame.alive));
      ['shares', 'sharesAfter', 'fitness', 'coop', 'hp'].forEach(function (key) {
        assert.ok(Array.isArray(frame[key]), 'нет массива ' + key);
        assert.strictEqual(frame[key].length, n, 'длина ' + key + ' не совпала с числом фракций');
        frame[key].forEach(function (v) {
          assert.ok(isNum(v), key + ' содержит не число: ' + v);
        });
      });
      assert.ok(Array.isArray(frame.extinct));
      assert.ok(typeof frame.leader === 'string');
      assert.strictEqual(frame.matrix.length, n);
      frame.matrix.forEach(function (row) {
        assert.strictEqual(row.length, n);
        row.forEach(function (v) {
          assert.ok(v >= 0 && v <= 5, 'очко за раунд вне диапазона выплат: ' + v);
        });
      });
      var total = frame.sharesAfter.reduce(function (a, b) { return a + b; }, 0);
      assert.ok(Math.abs(total - 1) < 1e-3, 'доли поколения ' + frame.gen + ' не дают единицу: ' + total);
    });
  });
});

test('ARENA_DATA: дорожки поля боя ссылаются на существующие фракции', function () {
  data.runs.forEach(function (run) {
    run.frames.forEach(function (frame) {
      assert.ok(isNum(frame.battle.intensity));
      assert.ok(Array.isArray(frame.battle.lanes) && frame.battle.lanes.length > 0);
      frame.battle.lanes.forEach(function (lane) {
        ['front', 'scoreLeft', 'scoreRight', 'damageLeft', 'damageRight',
          'leftIndex', 'rightIndex'].forEach(function (key) {
          assert.ok(isNum(lane[key]), 'дорожка: поле ' + key + ' не число');
        });
        [lane.left, lane.right, lane.winner].forEach(function (id) {
          if (id === null) return;
          assert.ok(run.strategyIds.indexOf(id) >= 0, 'дорожка ссылается на неизвестную фракцию ' + id);
        });
        assert.ok(lane.left !== null || lane.right !== null, 'пустая дорожка без обеих сторон');
      });
    });
  });
});

test('ARENA_DATA: пространственный режим согласован с сеткой', function () {
  var sp = data.spatial;
  assert.ok(sp, 'нет данных территории — запусти node sim/run.js --all');
  assert.strictEqual(sp.size, 20);
  assert.ok(sp.frames.length === sp.generations + 1, 'кадров должно быть на один больше числа поколений');
  sp.frames.forEach(function (spFrame) {
    assert.strictEqual(spFrame.grid.length, sp.size * sp.size);
    assert.strictEqual(spFrame.counts.length, sp.strategyIds.length);
    spFrame.grid.forEach(function (v) {
      assert.ok(Number.isInteger(v) && v >= 0 && v < sp.strategyIds.length, 'клетка вне справочника: ' + v);
    });
    var total = spFrame.counts.reduce(function (a, b) { return a + b; }, 0);
    assert.strictEqual(total, sp.size * sp.size, 'сумма клеток по фракциям должна давать всю сетку');
    assert.ok(isNum(spFrame.gen) && isNum(spFrame.flips) && isNum(spFrame.meanScore));
  });
  sp.standings.forEach(function (row) {
    assert.ok(typeof row.id === 'string' && Number.isInteger(row.cells));
  });
});

/* ================= Обратная проверка: код против данных ================= */

/** Вырезать код рендерера, убрав комментарии и строковые литералы. */
function rendererCode() {
  var html = fs.readFileSync(ARENA, 'utf8');
  var blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  assert.strictEqual(blocks.length, 1, 'ожидался ровно один встроенный <script> с рендерером');
  return blocks[0]
    .replace(/<\/?script>/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // блочные комментарии
    .replace(/\/\/[^\n]*/g, ' ') //       строчные комментарии
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''") // строки в одинарных кавычках
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""'); // строки в двойных кавычках
}

test('рендерер: код не обращается ни к одному отсутствующему полю данных', function () {
  var run = data.runs[0];
  var frame = run.frames[0];
  var samples = {
    data: data,
    run: run,
    frame: frame,
    lane: frame.battle.lanes[0],
    st: data.strategies[0],
    sp: data.spatial,
    spFrame: data.spatial.frames[0]
  };

  var code = rendererCode();
  var re = /\b(data|run|frame|lane|st|sp|spFrame)\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
  var seen = {};
  var missing = [];
  var m;
  while ((m = re.exec(code)) !== null) {
    var owner = m[1];
    var field = m[2];
    var key = owner + '.' + field;
    if (seen[key]) continue;
    seen[key] = true;
    if (!(field in samples[owner])) missing.push(key);
  }

  assert.deepStrictEqual(missing, [], 'рендерер читает несуществующие поля: ' + missing.join(', '));
  assert.ok(Object.keys(seen).length > 25, 'проверка выродилась: найдено всего ' + Object.keys(seen).length + ' обращений');
});

test('рендерер: вложенные поля, читаемые напрямую, тоже на месте', function () {
  // Сканер ловит только первый уровень, поэтому глубокие пути перечислены явно.
  var run = data.runs[0];
  ['R', 'P', 'T', 'S'].forEach(function (k) {
    assert.ok(isNum(data.meta.payoff[k]), 'нет meta.payoff.' + k);
  });
  ['principle', 'philosophy', 'strengths', 'weaknesses', 'targets'].forEach(function (k) {
    assert.ok(data.strategies[0].dossier[k], 'нет dossier.' + k);
  });
  ['type', 'id', 'gen'].forEach(function (k) {
    assert.ok(run.outcome[k] !== undefined, 'нет outcome.' + k);
  });
  ['lanes', 'intensity'].forEach(function (k) {
    assert.ok(run.frames[0].battle[k] !== undefined, 'нет battle.' + k);
  });
  assert.ok(isNum(run.standings[0].share) && isNum(run.standings[0].fitness));
  assert.ok(Number.isInteger(data.spatial.standings[0].cells));
});

test('рендерер: каждый прогон и каждый кадр проходят тот же контроль, что и первый', function () {
  // Первый кадр первого прогона мог оказаться удачным. Проверяем набор ключей
  // на всех кадрах всех прогонов — расхождение формы данных недопустимо.
  var reference = Object.keys(data.runs[0].frames[0]).sort().join(',');
  var laneReference = Object.keys(data.runs[0].frames[0].battle.lanes[0]).sort().join(',');
  data.runs.forEach(function (run) {
    assert.strictEqual(
      Object.keys(run).sort().join(','),
      Object.keys(data.runs[0]).sort().join(','),
      'прогон ' + run.seed + ' имеет другой набор полей'
    );
    run.frames.forEach(function (frame) {
      assert.strictEqual(Object.keys(frame).sort().join(','), reference,
        'кадр ' + frame.gen + ' прогона ' + run.seed + ' имеет другой набор полей');
      frame.battle.lanes.forEach(function (lane) {
        assert.strictEqual(Object.keys(lane).sort().join(','), laneReference, 'дорожка имеет другой набор полей');
      });
    });
  });
});
