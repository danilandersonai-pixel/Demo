'use strict';

// Баннер в терминале. Вынесен отдельно, потому что вырос: теперь это не
// три строчки, а первое, что видит новичок, — и оно должно объяснять,
// что происходит и что делать дальше.
//
// Чистые функции: на входе данные, на выходе строки. Поэтому текст баннера
// проверяется тестами, а не «посмотрел глазами».

var qr = require('./qr');

var W = 66;                            // ширина рамки в символах

function line(text) {
  return '  ' + (text === undefined ? '' : text);
}

function rule(char) {
  return line((char || '─').repeat(W));
}

/**
 * Шапка с названием.
 */
function head() {
  return [
    '',
    line('╭' + '─'.repeat(W - 2) + '╮'),
    line('│' + center('🧭  ШТУРМАН — панель-наставник для Claude Code', W - 2) + '│'),
    line('╰' + '─'.repeat(W - 2) + '╯'),
    ''
  ];
}

// Центрирование с учётом того, что эмодзи занимает две колонки.
function center(text, width) {
  var visible = displayWidth(text);
  var left = Math.max(0, Math.floor((width - visible) / 2));
  var right = Math.max(0, width - visible - left);
  return ' '.repeat(left) + text + ' '.repeat(right);
}

// Грубая, но достаточная оценка ширины: эмодзи и прочие символы вне BMP
// занимают в терминале две колонки.
function displayWidth(text) {
  var w = 0;
  for (var ch of String(text)) {
    var code = ch.codePointAt(0);
    w += (code > 0x1100 && (code >= 0x1f300 || (code >= 0x2600 && code <= 0x27bf))) ? 2 : 1;
  }
  return w;
}

/**
 * Основной блок: адрес, проект, источник данных, git.
 */
function status(info) {
  var out = [];
  out.push(line('Панель:   ' + info.localUrl));
  if (info.portShifted) {
    out.push(line('          порт ' + info.requestedPort + ' был занят, взят следующий свободный'));
  }
  out.push('');

  (info.projects || []).forEach(function (p) {
    out.push(line('Проект:   ' + p.project));
    out.push(line('Источник: ' + (p.level === 'A'
      ? 'уровень A — транскрипты Claude Code, файлы и git'
      : 'уровень B — только файлы и git')));
    if (p.level !== 'A' && p.levelReason) {
      out.push(line('          ' + p.levelReason));
    }
    out.push(line('Git:      ' + (p.branch ? 'ветка ' + p.branch : 'недоступен — панель работает без него')));
    out.push('');
  });

  if ((info.projects || []).length > 1) {
    out.push(line('Проектов: ' + info.projects.length + ' — переключаются в шапке панели.'));
    out.push('');
  }
  return out;
}

/**
 * Блок телефонного режима: адреса, ссылка и QR-код.
 */
function shareBlock(info) {
  var out = [];
  out.push(rule());
  out.push(line('📱 ДОСТУП С ТЕЛЕФОНА ВКЛЮЧЁН'));
  out.push('');

  if (!info.addresses || !info.addresses.length) {
    out.push(line('Не нашлось ни одного адреса в локальной сети.'));
    out.push(line('Скорее всего, компьютер не подключён к Wi-Fi или к роутеру.'));
    out.push(line('Панель работает, но открыть её с телефона не получится.'));
    out.push('');
    return out;
  }

  out.push(line('Наведите камеру телефона на этот код:'));
  out.push('');
  qr.toAscii(info.shareUrl, { quiet: 2 }).split('\n').forEach(function (l) {
    out.push('    ' + l);
  });
  out.push('');
  out.push(line('Или наберите ссылку руками:'));
  out.push(line('  ' + info.shareUrl));
  out.push('');

  if (info.addresses.length > 1) {
    out.push(line('Другие адреса этого компьютера — если первый не открылся:'));
    info.addresses.slice(1).forEach(function (a) {
      out.push(line('  http://' + a.address + ':' + info.port + '/  — ' + a.label));
    });
    out.push('');
  }

  out.push(line('Телефон должен быть в той же сети, что и компьютер.'));
  out.push(line('Ссылка содержит ключ доступа: без него панель не откроется.'));
  out.push(line('Штурман по-прежнему только читает — с телефона ничего'));
  out.push(line('изменить в проекте нельзя.'));
  out.push('');
  return out;
}

/**
 * Подсказки внизу.
 */
function hints(info) {
  var out = [];
  out.push(rule());
  if (!info.share) {
    out.push(line('Панель видна только на этом компьютере.'));
    out.push(line('Нужен доступ с телефона? Перезапустите с флагом --share.'));
  }
  out.push(line('Выключить — кнопкой «Выключить Штурман» в панели или Ctrl+C.'));
  out.push(line('Штурман только наблюдает: он ничего не меняет в вашем проекте.'));
  out.push('');
  return out;
}

/**
 * Собирает баннер целиком.
 */
function render(info) {
  var out = [].concat(head(), status(info));
  if (info.share) out = out.concat(shareBlock(info));
  out = out.concat(hints(info));
  return out.join('\n');
}

/**
 * Компактная строка статуса для режима --tui.
 * Помещается в одну строку терминала на втором мониторе.
 */
function tuiLine(state) {
  var icon = { working: '⚙', waiting: '🔔', ended: '💤' }[state.detectorState] || '·';
  var what = {
    working: 'работает',
    waiting: 'ЖДЁТ ВАС',
    ended: 'сессия затихла'
  }[state.detectorState] || 'ожидание';

  var parts = [
    icon + ' Клод ' + what,
    'файлов ' + state.files,
    'команд ' + state.commands,
    (state.errors ? '⛔ ошибок ' + state.errors : 'ошибок нет'),
    state.duration
  ];
  if (state.branch) parts.push('⎇ ' + state.branch);
  if (state.lastTitle) parts.push('· ' + state.lastTitle);
  return parts.join('  │  ');
}

module.exports = {
  render: render,
  head: head,
  status: status,
  shareBlock: shareBlock,
  hints: hints,
  tuiLine: tuiLine,
  displayWidth: displayWidth,
  center: center,
  WIDTH: W
};
