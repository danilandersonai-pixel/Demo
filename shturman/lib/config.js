'use strict';

// Конфиг `.shturman.json`: порт, настройки, последние проекты.
//
// Где лежит: в домашнем каталоге пользователя, а НЕ в наблюдаемом проекте.
// Это принципиально — Штурман обещал ничего не писать в чужую папку, и
// собственный конфиг не повод нарушать обещание (DECISIONS.md, решение 22).

var fs = require('fs');
var os = require('os');
var path = require('path');

var FILE_NAME = '.shturman.json';
var MAX_RECENT = 10;

// Значения по умолчанию — они же описание формата.
var DEFAULTS = {
  version: 1,
  port: 4517,
  theme: 'auto',            // auto | dark | light
  sound: true,
  notify: true,
  idleSeconds: 45,
  feedMode: 'simple',       // simple | detailed
  share: false,             // включать ли доступ по сети по умолчанию
  openBrowser: true,
  openLast: true,           // сразу открывать последний проект, минуя выбор
  density: 'cozy',          // cozy | compact
  recent: []                // [{path, name, lastOpened, port}]
};

function configPath(dir) {
  return path.join(dir || os.homedir(), FILE_NAME);
}

// Читаем и «санируем»: чужой или испорченный файл не должен ронять запуск.
function load(dir) {
  var file = configPath(dir);
  var raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    // Нет файла или битый JSON — работаем на умолчаниях. Это нормальный
    // первый запуск, а не ошибка.
    return { config: Object.assign({}, DEFAULTS), path: file, existed: false };
  }
  return { config: merge(raw), path: file, existed: true };
}

// Слияние с умолчаниями + проверка типов. Всё, что не прошло проверку,
// молча заменяется значением по умолчанию.
function merge(raw) {
  var out = Object.assign({}, DEFAULTS);
  if (!raw || typeof raw !== 'object') return out;

  if (isPort(raw.port)) out.port = raw.port;
  if (raw.theme === 'auto' || raw.theme === 'dark' || raw.theme === 'light') out.theme = raw.theme;
  if (typeof raw.sound === 'boolean') out.sound = raw.sound;
  if (typeof raw.notify === 'boolean') out.notify = raw.notify;
  if (typeof raw.share === 'boolean') out.share = raw.share;
  if (typeof raw.openBrowser === 'boolean') out.openBrowser = raw.openBrowser;
  if (typeof raw.openLast === 'boolean') out.openLast = raw.openLast;
  if (raw.density === 'cozy' || raw.density === 'compact') out.density = raw.density;
  if (raw.feedMode === 'simple' || raw.feedMode === 'detailed') out.feedMode = raw.feedMode;
  if (typeof raw.idleSeconds === 'number' && raw.idleSeconds >= 5 && raw.idleSeconds <= 3600) {
    out.idleSeconds = Math.round(raw.idleSeconds);
  }
  if (Array.isArray(raw.recent)) {
    out.recent = raw.recent
      .filter(function (r) { return r && typeof r.path === 'string'; })
      .slice(0, MAX_RECENT)
      .map(function (r) {
        return {
          path: r.path,
          name: typeof r.name === 'string' ? r.name : path.basename(r.path),
          lastOpened: typeof r.lastOpened === 'number' ? r.lastOpened : 0,
          port: isPort(r.port) ? r.port : null
        };
      });
  }
  return out;
}

function isPort(n) {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535;
}

/**
 * Сохранение. Пишем атомарно (во временный файл + переименование), чтобы
 * прерванная запись не оставила обрезанный JSON — иначе следующий запуск
 * потеряет все настройки.
 */
function save(config, dir) {
  var file = configPath(dir);
  var tmp = file + '.tmp';
  var body = JSON.stringify(merge(config), null, 2) + '\n';
  try {
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true, path: file };
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (x) { /* и так не создался */ }
    // Не можем записать (только чтение, нет прав) — не повод падать:
    // Штурман просто не запомнит настройки до следующего раза.
    return { ok: false, path: file, error: e.message };
  }
}

/**
 * Добавить проект в список последних. Повтор поднимается наверх, а не
 * дублируется.
 */
function rememberProject(config, projectPath, port, now) {
  var abs = path.resolve(projectPath);
  var when = now || Date.now();
  var recent = (config.recent || []).filter(function (r) {
    return path.resolve(r.path) !== abs;
  });
  recent.unshift({
    path: abs,
    name: path.basename(abs) || abs,
    lastOpened: when,
    port: isPort(port) ? port : null
  });
  config.recent = recent.slice(0, MAX_RECENT);
  return config;
}

// Отсеиваем из списка последних то, чего уже нет на диске: показывать
// новичку папки-призраки — верный способ его запутать.
function pruneMissing(config) {
  config.recent = (config.recent || []).filter(function (r) {
    try {
      return fs.statSync(r.path).isDirectory();
    } catch (e) {
      return false;
    }
  });
  return config;
}

module.exports = {
  FILE_NAME: FILE_NAME,
  DEFAULTS: DEFAULTS,
  MAX_RECENT: MAX_RECENT,
  configPath: configPath,
  load: load,
  save: save,
  merge: merge,
  rememberProject: rememberProject,
  pruneMissing: pruneMissing,
  isPort: isPort
};
