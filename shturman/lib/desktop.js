'use strict';

/**
 * Встраивание Штурмана в систему: ярлык на рабочем столе, запуск без
 * терминала, автозапуск при входе, пункт «Открыть Штурман здесь» в меню
 * правой кнопки.
 *
 * Правило файла: всё содержимое считают **чистые функции**, а трогает диск
 * только `apply`. Так три операционные системы проверяются тестами на любой
 * машине — иначе половину этого кода никто никогда бы не увидел до первого
 * пользователя.
 *
 * Что делает каждая ОС по-своему:
 *   Windows — ярлык .lnk создаёт PowerShell, окно консоли прячет wscript,
 *             пункт меню живёт в реестре HKCU;
 *   macOS   — ярлык это .app-бандл (он же убирает окно терминала),
 *             автозапуск — LaunchAgent, пункт меню — Quick Action;
 *   Linux   — всё через .desktop-файлы, пункт меню — скрипт Nautilus.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var { execFile } = require('child_process');

var APP_NAME = 'Штурман';
var APP_ID = 'ru.shturman.panel';
var COMMENT = 'Показывает простым языком, что делает Claude Code';

// ---------------------------------------------------------------------------
// Пути
// ---------------------------------------------------------------------------

/** Рабочий стол. На Linux он бывает переведён — спрашиваем у самой системы. */
function desktopDir(home, platform) {
  var h = home || os.homedir();
  var plat = platform || process.platform;
  if (plat === 'linux') {
    try {
      var conf = fs.readFileSync(path.join(h, '.config', 'user-dirs.dirs'), 'utf8');
      var m = /XDG_DESKTOP_DIR="?([^"\n]+)"?/.exec(conf);
      if (m) return m[1].replace('$HOME', h);
    } catch (e) { /* нет файла — берём английское имя */ }
  }
  return path.join(h, 'Desktop');
}

function iconFor(root, platform) {
  var plat = platform || process.platform;
  var dir = path.join(root, 'public', 'icons');
  if (plat === 'win32') return path.join(dir, 'shturman.ico');
  if (plat === 'darwin') return path.join(dir, 'shturman.icns');
  return path.join(dir, 'icon-256.png');
}

// ---------------------------------------------------------------------------
// Содержимое файлов
// ---------------------------------------------------------------------------

/**
 * Windows: обёртка, которая прячет окно.
 *
 * Почему .vbs через wscript, а не `start /min`: `start /min` окно всё равно
 * создаёт — оно просто свёрнуто и висит на панели задач, а закрыть его
 * значит убить Штурман. wscript.exe запускает процесс с окном в состоянии 0
 * («скрыто») и никакого своего окна не имеет вовсе. Ничего ставить для
 * этого не нужно: wscript входит в Windows.
 */
function windowsVbs(opts) {
  var node = toWin(opts.node);
  var server = toWin(path.join(opts.root, 'server.js'));
  return [
    "' Штурман — запуск без окна консоли.",
    "' Файл создан установщиком; правьте установщик, а не его.",
    'Option Explicit',
    'Dim sh, args, cmd, i',
    'Set sh = CreateObject("WScript.Shell")',
    'cmd = """' + node + '"" ""' + server + '"" --pick"',
    "' Папку можно передать первым аргументом — так работает пункт",
    "' «Открыть Штурман здесь» в меню правой кнопки.",
    'If WScript.Arguments.Count > 0 Then',
    '  cmd = cmd & " --project """ & WScript.Arguments(0) & """"',
    'End If',
    "sh.Run cmd, 0, False"
  ].join('\r\n') + '\r\n';
}

/** Windows: команды PowerShell, создающие ярлык с иконкой. */
function windowsShortcutCommand(opts) {
  var lnk = path.join(opts.desktop, APP_NAME + '.lnk');
  var ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + psq(lnk) + ')',
    '$s.TargetPath = ' + psq(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe')),
    '$s.Arguments = ' + psq('"' + toWin(opts.vbs) + '"'),
    '$s.WorkingDirectory = ' + psq(toWin(opts.root)),
    '$s.IconLocation = ' + psq(toWin(opts.icon)),
    '$s.Description = ' + psq(APP_NAME + ' — ' + COMMENT),
    '$s.Save()'
  ].join('; ');
  return { file: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', ps], target: lnk };
}

/** Windows: пункт меню правой кнопки живёт в реестре текущего пользователя. */
function windowsMenuCommands(opts, remove) {
  var cmd = 'wscript.exe "' + toWin(opts.vbs) + '" "%V"';
  var roots = [
    'HKCU\\Software\\Classes\\Directory\\shell\\Shturman',
    'HKCU\\Software\\Classes\\Directory\\Background\\shell\\Shturman'
  ];
  var out = [];
  roots.forEach(function (key) {
    if (remove) {
      out.push({ file: 'reg', args: ['delete', key, '/f'], target: key });
      return;
    }
    out.push({ file: 'reg', args: ['add', key, '/ve', '/d', 'Открыть ' + APP_NAME + ' здесь', '/f'], target: key });
    out.push({ file: 'reg', args: ['add', key, '/v', 'Icon', '/d', toWin(opts.icon), '/f'], target: key });
    out.push({ file: 'reg', args: ['add', key + '\\command', '/ve', '/d', cmd, '/f'], target: key + '\\command' });
  });
  return out;
}

/** Unix: сам запускающий скрипт. Используется и в .app, и в .desktop. */
function unixLauncher(opts) {
  return [
    '#!/bin/sh',
    '# Штурман — запуск без окна терминала. Файл создан установщиком.',
    'LOG="$HOME/.shturman.log"',
    'cd ' + shq(opts.root) + ' || exit 1',
    '# Папку можно передать первым аргументом — так работает пункт',
    '# «Открыть Штурман здесь» в меню правой кнопки.',
    'if [ -n "$1" ]; then',
    '  nohup ' + shq(opts.node) + ' ' + shq(path.join(opts.root, 'server.js')) +
      ' --pick --project "$1" >>"$LOG" 2>&1 &',
    'else',
    '  nohup ' + shq(opts.node) + ' ' + shq(path.join(opts.root, 'server.js')) +
      ' --pick >>"$LOG" 2>&1 &',
    'fi',
    'exit 0'
  ].join('\n') + '\n';
}

/** macOS: Info.plist для .app-бандла. */
function macPlist() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>CFBundleName</key><string>' + APP_NAME + '</string>',
    '  <key>CFBundleDisplayName</key><string>' + APP_NAME + '</string>',
    '  <key>CFBundleIdentifier</key><string>' + APP_ID + '</string>',
    '  <key>CFBundleVersion</key><string>1.0</string>',
    '  <key>CFBundleShortVersionString</key><string>1.0</string>',
    '  <key>CFBundlePackageType</key><string>APPL</string>',
    '  <key>CFBundleExecutable</key><string>shturman</string>',
    '  <key>CFBundleIconFile</key><string>shturman</string>',
    '  <key>NSHighResolutionCapable</key><true/>',
    '  <!-- Папку можно бросить на иконку — Штурман откроет её как проект. -->',
    '  <key>CFBundleDocumentTypes</key>',
    '  <array><dict>',
    '    <key>CFBundleTypeName</key><string>Folder</string>',
    '    <key>CFBundleTypeRole</key><string>Viewer</string>',
    '    <key>LSItemContentTypes</key><array><string>public.folder</string></array>',
    '  </dict></array>',
    '</dict>',
    '</plist>'
  ].join('\n') + '\n';
}

/** macOS: автозапуск при входе в систему. */
function macLaunchAgent(opts) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key><string>' + APP_ID + '</string>',
    '  <key>ProgramArguments</key>',
    '  <array>',
    '    <string>' + opts.node + '</string>',
    '    <string>' + path.join(opts.root, 'server.js') + '</string>',
    '    <string>--pick</string>',
    '    <string>--no-open</string>',
    '  </array>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>KeepAlive</key><false/>',
    '</dict>',
    '</plist>'
  ].join('\n') + '\n';
}

/**
 * macOS: Quick Action «Открыть Штурман здесь».
 *
 * Это обычный бандл-папка с плистом внутри — Automator для создания не нужен.
 * Формат подсмотрен у сохранённого Automator'ом сервиса и сведён к минимуму:
 * один шаг «Run Shell Script», принимающий выделенные папки в Finder.
 */
function macQuickAction(opts) {
  var uuid = opts.uuid || ['A', 'B', 'C'];
  var script = shq(opts.launcher) + ' "$1"';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>AMApplicationBuild</key><string>521</string>',
    '  <key>AMApplicationVersion</key><string>2.10</string>',
    '  <key>AMDocumentVersion</key><string>2</string>',
    '  <key>actions</key>',
    '  <array><dict>',
    '    <key>action</key>',
    '    <dict>',
    '      <key>AMAccepts</key>',
    '      <dict><key>Container</key><string>List</string><key>Optional</key><true/>',
    '        <key>Types</key><array><string>com.apple.cocoa.string</string></array></dict>',
    '      <key>AMActionVersion</key><string>2.0.3</string>',
    '      <key>AMApplication</key><array><string>Automator</string></array>',
    '      <key>AMProvides</key>',
    '      <dict><key>Container</key><string>List</string>',
    '        <key>Types</key><array><string>com.apple.cocoa.string</string></array></dict>',
    '      <key>ActionBundlePath</key><string>/System/Library/Automator/Run Shell Script.action</string>',
    '      <key>ActionName</key><string>Run Shell Script</string>',
    '      <key>ActionParameters</key>',
    '      <dict>',
    '        <key>COMMAND_STRING</key><string>' + xml(script) + '</string>',
    '        <key>CheckedForUserDefaultShell</key><true/>',
    '        <key>inputMethod</key><integer>1</integer>',
    '        <key>shell</key><string>/bin/sh</string>',
    '        <key>source</key><string></string>',
    '      </dict>',
    '      <key>BundleIdentifier</key><string>com.apple.RunShellScript</string>',
    '      <key>CFBundleVersion</key><string>2.0.3</string>',
    '      <key>CanShowSelectedItemsWhenRun</key><false/>',
    '      <key>CanShowWhenRun</key><true/>',
    '      <key>Category</key><array><string>AMCategoryUtilities</string></array>',
    '      <key>Class Name</key><string>RunShellScriptAction</string>',
    '      <key>InputUUID</key><string>' + uuid[0] + '</string>',
    '      <key>OutputUUID</key><string>' + uuid[1] + '</string>',
    '      <key>UUID</key><string>' + uuid[2] + '</string>',
    '      <key>UnlocalizedApplications</key><array><string>Automator</string></array>',
    '      <key>arguments</key><dict/>',
    '      <key>isViewVisible</key><integer>1</integer>',
    '      <key>location</key><string>309.000000:253.000000</string>',
    '    </dict>',
    '    <key>isViewVisible</key><integer>1</integer>',
    '  </dict></array>',
    '  <key>connectors</key><dict/>',
    '  <key>workflowMetaData</key>',
    '  <dict>',
    '    <key>applicationBundleIDsByPath</key><dict/>',
    '    <key>applicationPaths</key><array/>',
    '    <key>serviceApplicationBundleID</key><string>com.apple.finder</string>',
    '    <key>serviceInputTypeIdentifier</key><string>com.apple.Automator.fileSystemObject.folder</string>',
    '    <key>serviceOutputTypeIdentifier</key><string>com.apple.Automator.nothing</string>',
    '    <key>serviceProcessesInput</key><integer>0</integer>',
    '    <key>workflowTypeIdentifier</key><string>com.apple.Automator.servicesMenu</string>',
    '  </dict>',
    '</dict>',
    '</plist>'
  ].join('\n') + '\n';
}

/** Linux: .desktop-файл. Он же ярлык, он же автозапуск. */
function desktopEntry(opts) {
  var exec = shq(opts.launcher);
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=' + APP_NAME,
    'Comment=' + COMMENT,
    'Exec=' + exec + ' %f',
    'Icon=' + opts.icon,
    'Terminal=false',
    'Categories=Development;Utility;',
    'StartupNotify=false',
    'MimeType=inode/directory;',
    'X-GNOME-Autostart-enabled=true'
  ].join('\n') + '\n';
}

/** Linux: пункт меню правой кнопки в Nautilus — просто исполняемый скрипт. */
function nautilusScript(opts) {
  return [
    '#!/bin/sh',
    '# «Открыть Штурман здесь» — пункт меню правой кнопки в Nautilus.',
    '# Файл создан установщиком Штурмана.',
    'DIR="$NAUTILUS_SCRIPT_CURRENT_URI"',
    'DIR="${DIR#file://}"',
    '[ -n "$1" ] && DIR="$1"',
    'exec ' + shq(opts.launcher) + ' "$DIR"'
  ].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// План: что и куда положить
// ---------------------------------------------------------------------------

/**
 * Полный список действий для установки. Ничего не выполняет — только
 * описывает. `kind` нужен, чтобы потом снять ровно то, что ставили.
 */
function plan(o) {
  var platform = o.platform || process.platform;
  var home = o.home || os.homedir();
  var root = o.root;
  var node = o.node || process.execPath;
  var desktop = o.desktop || desktopDir(home, platform);
  var icon = iconFor(root, platform);
  var items = [];

  if (platform === 'win32') {
    var vbs = path.join(root, 'install', 'launch.vbs');
    items.push({ kind: 'launcher', type: 'file', path: vbs, content: windowsVbs({ root: root, node: node }) });
    items.push(Object.assign({ kind: 'shortcut', type: 'command' },
      windowsShortcutCommand({ desktop: desktop, vbs: vbs, root: root, icon: icon })));
    if (o.autostart) {
      var startup = path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows',
        'Start Menu', 'Programs', 'Startup');
      items.push(Object.assign({ kind: 'autostart', type: 'command' },
        windowsShortcutCommand({ desktop: startup, vbs: vbs, root: root, icon: icon })));
    }
    if (o.contextMenu) {
      windowsMenuCommands({ vbs: vbs, icon: icon }, false).forEach(function (c) {
        items.push(Object.assign({ kind: 'menu', type: 'command' }, c));
      });
    }
    return items;
  }

  if (platform === 'darwin') {
    var app = path.join(desktop, APP_NAME + '.app');
    var exe = path.join(app, 'Contents', 'MacOS', 'shturman');
    items.push({ kind: 'shortcut', type: 'file', path: path.join(app, 'Contents', 'Info.plist'), content: macPlist() });
    items.push({ kind: 'shortcut', type: 'file', path: exe, content: unixLauncher({ root: root, node: node }), mode: 0o755 });
    items.push({ kind: 'shortcut', type: 'copy', path: path.join(app, 'Contents', 'Resources', 'shturman.icns'), from: icon });
    if (o.autostart) {
      items.push({ kind: 'autostart', type: 'file',
        path: path.join(home, 'Library', 'LaunchAgents', APP_ID + '.plist'),
        content: macLaunchAgent({ root: root, node: node }) });
    }
    if (o.contextMenu) {
      var wf = path.join(home, 'Library', 'Services', 'Открыть ' + APP_NAME + ' здесь.workflow');
      items.push({ kind: 'menu', type: 'file', path: path.join(wf, 'Contents', 'document.wflow'),
        content: macQuickAction({ launcher: exe, uuid: o.uuid }) });
      items.push({ kind: 'menu', type: 'file', path: path.join(wf, 'Contents', 'Info.plist'),
        content: quickActionInfo() });
    }
    return items;
  }

  // Linux и всё остальное
  var launcher = path.join(root, 'install', 'shturman-launch.sh');
  items.push({ kind: 'launcher', type: 'file', path: launcher,
    content: unixLauncher({ root: root, node: node }), mode: 0o755 });
  var entry = desktopEntry({ launcher: launcher, icon: icon });
  items.push({ kind: 'shortcut', type: 'file', mode: 0o755,
    path: path.join(home, '.local', 'share', 'applications', 'shturman.desktop'), content: entry });
  items.push({ kind: 'shortcut', type: 'file', mode: 0o755,
    path: path.join(desktop, 'shturman.desktop'), content: entry });
  if (o.autostart) {
    items.push({ kind: 'autostart', type: 'file', mode: 0o755,
      path: path.join(home, '.config', 'autostart', 'shturman.desktop'), content: entry });
  }
  if (o.contextMenu) {
    items.push({ kind: 'menu', type: 'file', mode: 0o755,
      path: path.join(home, '.local', 'share', 'nautilus', 'scripts', 'Открыть ' + APP_NAME + ' здесь'),
      content: nautilusScript({ launcher: launcher }) });
  }
  return items;
}

function quickActionInfo() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>NSServices</key>',
    '  <array><dict>',
    '    <key>NSMenuItem</key><dict><key>default</key><string>Открыть ' + APP_NAME + ' здесь</string></dict>',
    '    <key>NSMessage</key><string>runWorkflowAsService</string>',
    '    <key>NSRequiredContext</key><dict><key>NSApplicationIdentifier</key><string>com.apple.finder</string></dict>',
    '    <key>NSSendFileTypes</key><array><string>public.folder</string></array>',
    '  </dict></array>',
    '</dict>',
    '</plist>'
  ].join('\n') + '\n';
}

/** Что нужно убрать, чтобы снять конкретную часть установки. */
function removalPlan(o, kinds) {
  var wanted = kinds || ['menu', 'autostart'];
  var platform = o.platform || process.platform;
  var items = [];
  if (platform === 'win32' && wanted.indexOf('menu') !== -1) {
    windowsMenuCommands({ vbs: '', icon: '' }, true).forEach(function (c) {
      items.push(Object.assign({ kind: 'menu', type: 'command', optional: true }, c));
    });
  }
  plan(Object.assign({}, o, { autostart: true, contextMenu: true }))
    .filter(function (i) { return wanted.indexOf(i.kind) !== -1 && i.type !== 'command'; })
    .forEach(function (i) { items.push({ kind: i.kind, type: 'unlink', path: i.path }); });
  return items;
}

// ---------------------------------------------------------------------------
// Выполнение
// ---------------------------------------------------------------------------

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function runCommand(item) {
  return new Promise(function (resolve) {
    execFile(item.file, item.args, { windowsHide: true, timeout: 20000 }, function (err) {
      resolve(err
        ? { kind: item.kind, target: item.target, ok: false, error: err.message }
        : { kind: item.kind, target: item.target, ok: true });
    });
  });
}

/** Выполнить план. Возвращает список результатов — по одному на пункт. */
function apply(items) {
  return items.reduce(function (chain, item) {
    return chain.then(function (acc) {
      try {
        if (item.type === 'file') {
          ensureDir(item.path);
          fs.writeFileSync(item.path, item.content, { mode: item.mode || 0o644 });
          if (item.mode) fs.chmodSync(item.path, item.mode);
          acc.push({ kind: item.kind, target: item.path, ok: true });
          return acc;
        }
        if (item.type === 'copy') {
          ensureDir(item.path);
          if (fs.existsSync(item.from)) {
            fs.copyFileSync(item.from, item.path);
            acc.push({ kind: item.kind, target: item.path, ok: true });
          } else {
            acc.push({ kind: item.kind, target: item.path, ok: false, error: 'нет файла ' + item.from });
          }
          return acc;
        }
        if (item.type === 'unlink') {
          fs.rmSync(item.path, { recursive: true, force: true });
          acc.push({ kind: item.kind, target: item.path, ok: true });
          return acc;
        }
        if (item.type === 'command') {
          return runCommand(item).then(function (r) {
            if (!r.ok && item.optional) r.ok = true;      // нечего было удалять
            acc.push(r);
            return acc;
          });
        }
      } catch (e) {
        acc.push({ kind: item.kind, target: item.path || item.target, ok: false, error: e.message });
      }
      return acc;
    });
  }, Promise.resolve([]));
}

// ---------------------------------------------------------------------------
// Системный выбор папки
// ---------------------------------------------------------------------------

/**
 * Позвать системный диалог «выберите папку».
 *
 * Возвращает {path} | {cancelled:true} | {unavailable:true}. Последнее —
 * не ошибка: на голом сервере или в урезанном окружении диалога может не
 * быть, и тогда панель показывает свой обзор папок. Печатать путь руками
 * человека не заставляем ни при каком раскладе.
 */
function pickFolder(opts) {
  var o = opts || {};
  var platform = o.platform || process.platform;
  var start = o.start || os.homedir();
  var title = o.title || 'Выберите папку проекта';

  var attempts = [];
  if (platform === 'darwin') {
    attempts.push({ file: 'osascript', args: ['-e',
      'POSIX path of (choose folder with prompt "' + title.replace(/"/g, '') + '")'] });
  } else if (platform === 'win32') {
    attempts.push({ file: 'powershell', args: ['-NoProfile', '-STA', '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; " +
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      "$d.Description = " + psq(title) + "; " +
      "$d.SelectedPath = " + psq(start) + "; " +
      "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }"] });
  } else {
    attempts.push({ file: 'zenity', args: ['--file-selection', '--directory',
      '--title=' + title, '--filename=' + start + '/'] });
    attempts.push({ file: 'kdialog', args: ['--getexistingdirectory', start, '--title', title] });
  }

  return attempts.reduce(function (chain, attempt) {
    return chain.then(function (result) {
      if (result) return result;
      return tryPick(attempt);
    });
  }, Promise.resolve(null)).then(function (r) {
    return r || { unavailable: true };
  });
}

function tryPick(attempt) {
  return new Promise(function (resolve) {
    execFile(attempt.file, attempt.args, { timeout: 120000, windowsHide: false },
      function (err, stdout) {
        if (err && (err.code === 'ENOENT' || err.code === 127)) return resolve(null);
        var picked = String(stdout || '').trim();
        if (!picked) return resolve({ cancelled: true });
        resolve({ path: picked.replace(/\/+$/, '') || picked });
      });
  });
}

// ---------------------------------------------------------------------------
// Мелочи
// ---------------------------------------------------------------------------

function toWin(p) { return String(p).split('/').join('\\'); }
function shq(s) { return "'" + String(s).split("'").join("'\\''") + "'"; }
function psq(s) { return "'" + String(s).split("'").join("''") + "'"; }
function xml(s) {
  return String(s).replace(/[&<>]/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
  });
}

module.exports = {
  APP_NAME: APP_NAME,
  APP_ID: APP_ID,
  desktopDir: desktopDir,
  iconFor: iconFor,
  windowsVbs: windowsVbs,
  windowsShortcutCommand: windowsShortcutCommand,
  windowsMenuCommands: windowsMenuCommands,
  unixLauncher: unixLauncher,
  macPlist: macPlist,
  macLaunchAgent: macLaunchAgent,
  macQuickAction: macQuickAction,
  desktopEntry: desktopEntry,
  nautilusScript: nautilusScript,
  plan: plan,
  removalPlan: removalPlan,
  apply: apply,
  pickFolder: pickFolder
};
