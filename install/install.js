#!/usr/bin/env node
'use strict';

/**
 * Установщик Штурмана.
 *
 * Запускается двойным кликом по «Установить Штурман.bat» или
 * «Установить Штурман.command» — те находят Node и зовут этот файл.
 * Здесь уже можно писать на JavaScript и не бороться с двумя диалектами
 * командной строки.
 *
 * Что делает:
 *   1) проверяет версию Node;
 *   2) ставит зависимости, если они вдруг появятся (сейчас их нет);
 *   3) рисует иконки, если их не оказалось в поставке;
 *   4) кладёт ярлык на рабочий стол;
 *   5) спрашивает про пункт «Открыть Штурман здесь» — и ставит его только
 *      с явного согласия;
 *   6) говорит по-русски, что готово.
 *
 * Повторный запуск ничего не ломает: файлы перезаписываются, лишнего не
 * появляется.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var readline = require('readline');
var { execFileSync } = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var desktop = require(path.join(ROOT, 'lib', 'desktop.js'));

var MIN_NODE = 18;

function say(text) { process.stdout.write(text + '\n'); }
function line() { say('  ' + '─'.repeat(58)); }

function head() {
  say('');
  say('  ╭' + '─'.repeat(58) + '╮');
  say('  │  ' + pad('Ш Т У Р М А Н   —   у с т а н о в к а', 56) + '│');
  say('  ╰' + '─'.repeat(58) + '╯');
  say('');
}

function pad(s, n) {
  var len = Array.from(s).length;
  return s + ' '.repeat(Math.max(0, n - len));
}

function nodeOk() {
  var major = parseInt(String(process.versions.node).split('.')[0], 10);
  return major >= MIN_NODE;
}

/** Зависимости. Их нет и, скорее всего, не будет — но код честный. */
function installDeps() {
  var pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); } catch (e) { return; }
  var deps = Object.keys(pkg.dependencies || {});
  if (!deps.length) {
    say('  Зависимостей нет — ставить нечего. Это и хорошо: Штурман работает');
    say('  сразу после распаковки, без интернета.');
    return;
  }
  say('  Ставлю зависимости (' + deps.join(', ') + ')…');
  try {
    execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'],
      { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    say('  Не получилось поставить зависимости. Штурман, скорее всего, всё равно');
    say('  запустится — если нет, напишите об этом.');
  }
}

/** Иконки. В поставке они есть, но вдруг папку почистили. */
function ensureIcons() {
  var icon = desktop.iconFor(ROOT);
  if (fs.existsSync(icon)) return true;
  try {
    require(path.join(ROOT, 'tools', 'make-icons.js'));
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'make-icons.js')], { cwd: ROOT, stdio: 'ignore' });
  } catch (e) { /* ниже скажем честно */ }
  return fs.existsSync(icon);
}

/** Вопрос «да/нет» с ответом по умолчанию «нет». */
function ask(question) {
  return new Promise(function (resolve) {
    if (!process.stdin.isTTY) return resolve(false);
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('  ' + question + ' [д/Н]: ', function (answer) {
      rl.close();
      var a = String(answer).trim().toLowerCase();
      resolve(a === 'д' || a === 'да' || a === 'y' || a === 'yes');
    });
  });
}

function argHas(name) { return process.argv.indexOf(name) !== -1; }

function main() {
  head();

  if (!nodeOk()) {
    say('  На этом компьютере Node.js версии ' + process.versions.node + ',');
    say('  а Штурману нужна ' + MIN_NODE + '-я или новее.');
    say('  Обновите Node.js и запустите установку снова.');
    say('');
    return Promise.resolve(1);
  }
  say('  Node.js ' + process.versions.node + ' — подходит.');
  say('  Папка Штурмана: ' + ROOT);
  line();

  installDeps();
  var haveIcons = ensureIcons();
  if (!haveIcons) say('  Иконку нарисовать не удалось — ярлык будет со стандартной.');
  line();

  // Снятие пункта меню — отдельный, обратный сценарий.
  if (argHas('--remove-menu')) {
    return desktop.apply(desktop.removalPlan({ root: ROOT }, ['menu'])).then(function (res) {
      report(res, true);
      say('  Пункт «Открыть Штурман здесь» убран из меню.');
      say('');
      return 0;
    });
  }

  var wantMenu = argHas('--with-menu');
  var skipAsk = argHas('--yes') || argHas('--no-menu') || wantMenu;

  return (skipAsk ? Promise.resolve(wantMenu)
    : ask('Добавить пункт «Открыть Штурман здесь» в меню правой кнопки по папке?')
  ).then(function (menu) {
    var items = desktop.plan({ root: ROOT, contextMenu: menu, uuid: uuids() });
    return desktop.apply(items).then(function (res) {
      line();
      report(res);
      line();
      var failed = res.filter(function (r) { return !r.ok; });
      if (failed.length) {
        say('  Часть шагов не прошла — смотрите строки со знаком ✖ выше.');
        say('  Штурман всё равно можно запустить: откройте папку и дважды');
        say('  щёлкните по файлу server.js… а лучше напишите нам, что сломалось.');
        say('');
        return 1;
      }
      say('  ГОТОВО. Ярлык «Штурман» на рабочем столе.');
      say('');
      say('  Дважды щёлкните по нему — панель откроется сама.');
      if (menu) say('  А ещё правая кнопка по любой папке → «Открыть Штурман здесь».');
      say('');
      return 0;
    });
  });
}

function report(results, removing) {
  var names = {
    launcher: 'запускающий файл',
    shortcut: 'ярлык на рабочем столе',
    autostart: 'запуск при входе в систему',
    menu: 'пункт меню правой кнопки'
  };
  results.forEach(function (r) {
    var name = names[r.kind] || r.kind;
    if (!r.ok) return say('  ✖ ' + pad(name, 30) + r.error);
    // При снятии галочка означает «убрано», а не «поставлено»: одна и та же
    // строка без пометки читалась бы ровно наоборот.
    if (removing) return say('  ✔ убрано: ' + name + ' — ' + short(r.target));
    say('  ✔ ' + pad(name, 30) + short(r.target));
  });
}

function short(p) {
  var home = os.homedir();
  return String(p).indexOf(home) === 0 ? '~' + String(p).slice(home.length) : String(p);
}

function uuids() {
  var c = require('crypto');
  return [c.randomUUID(), c.randomUUID(), c.randomUUID()];
}

if (require.main === module) {
  main().then(function (code) {
    process.exitCode = code || 0;
  }).catch(function (e) {
    say('');
    say('  Установка сорвалась: ' + (e && e.message));
    say('');
    process.exitCode = 1;
  });
}

module.exports = { main: main, ROOT: ROOT, MIN_NODE: MIN_NODE };
