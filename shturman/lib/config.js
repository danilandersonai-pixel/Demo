'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');

/**
 * Конфиг «Штурмана» — ~/.shturman.json: порт, настройки, последние проекты.
 * Живёт в ДОМАШНЕЙ папке пользователя, а не в наблюдаемом проекте:
 * приложение по-прежнему ничего не пишет в чужие папки (Д-18).
 * Создаётся сам, битый файл молча заменяется умолчаниями.
 */

var DEFAULTS = {
  port: 4517,
  openBrowser: true,
  recentProjects: []
};

function configPath() {
  // для тестов путь можно подменить переменной окружения
  return process.env.SHTURMAN_CONFIG || path.join(os.homedir(), '.shturman.json');
}

function loadConfig() {
  var cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
  } catch (e) {
    cfg = {}; // нет файла или битый JSON — начинаем с чистого листа
  }
  var out = {};
  Object.keys(DEFAULTS).forEach(function (k) {
    out[k] = cfg[k] !== undefined ? cfg[k] : DEFAULTS[k];
  });
  if (typeof out.port !== 'number' || out.port < 1 || out.port > 65535) out.port = DEFAULTS.port;
  if (!Array.isArray(out.recentProjects)) out.recentProjects = [];
  return out;
}

function saveConfig(cfg) {
  var out = {};
  Object.keys(DEFAULTS).forEach(function (k) {
    out[k] = cfg[k] !== undefined ? cfg[k] : DEFAULTS[k];
  });
  try {
    fs.writeFileSync(configPath(), JSON.stringify(out, null, 2) + '\n');
    return true;
  } catch (e) {
    return false; // диск только для чтения — не смертельно, живём без конфига
  }
}

/** Добавить проекты в «последние» (свежие — в начало, максимум 10). */
function rememberProjects(cfg, projects) {
  var merged = projects.concat(cfg.recentProjects || []);
  var seen = {};
  cfg.recentProjects = merged.filter(function (p) {
    if (seen[p]) return false;
    seen[p] = true;
    return true;
  }).slice(0, 10);
  return cfg;
}

module.exports = {
  loadConfig: loadConfig,
  saveConfig: saveConfig,
  rememberProjects: rememberProjects,
  configPath: configPath,
  DEFAULTS: DEFAULTS
};
