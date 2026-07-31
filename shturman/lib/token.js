'use strict';

// Токен доступа для режима «--share».
//
// Задача скромная и оттого выполнимая: не пустить в панель случайного соседа
// по Wi-Fi. Это не защита от взлома — трафик идёт по http, и внутри
// доверенной домашней сети этого достаточно. Что именно защищено и что нет,
// написано и в интерфейсе, и в README (DECISIONS.md, решение 24).

var crypto = require('crypto');

var TOKEN_BYTES = 16;              // 128 бит — не подберут перебором по сети
var COOKIE_NAME = 'shturman_token';
var HEADER_NAME = 'x-shturman-token';
var QUERY_NAME = 't';

// Адреса, которым токен не нужен: с самой машины панель открывается как
// раньше, без ссылок и QR-кодов.
function isLoopback(remoteAddress) {
  if (!remoteAddress) return false;
  var a = String(remoteAddress);
  // Node отдаёт IPv4-адрес в виде ::ffff:127.0.0.1, когда слушает двойной стек.
  if (a.indexOf('::ffff:') === 0) a = a.slice(7);
  return a === '127.0.0.1' || a === '::1' || a.indexOf('127.') === 0;
}

function generate() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

// Сравнение в постоянное время: обычное === выдаёт по времени, сколько
// символов угадано. Дёшево сделать правильно — делаем правильно.
function safeEqual(a, b) {
  var x = Buffer.from(String(a || ''), 'utf8');
  var y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

// Достаём токен откуда угодно: из ссылки (пришёл по QR), из куки
// (уже заходили) или из заголовка (запрос из JS панели).
function extract(req, query) {
  var q = query || {};
  if (q[QUERY_NAME]) return String(q[QUERY_NAME]);
  var header = req && req.headers && req.headers[HEADER_NAME];
  if (header) return String(header);
  var cookie = parseCookies(req && req.headers && req.headers.cookie)[COOKIE_NAME];
  if (cookie) return cookie;
  return null;
}

function parseCookies(raw) {
  var out = {};
  String(raw || '').split(';').forEach(function (part) {
    var i = part.indexOf('=');
    if (i === -1) return;
    var k = part.slice(0, i).trim();
    var v = part.slice(i + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; }
    }
  });
  return out;
}

/**
 * Охранник доступа. Создаётся один на сервер.
 *
 * `enabled: false` (обычный режим) — пускает всех: сервер и так слушает
 * только петлю, придумывать себе пароль на собственной машине незачем.
 */
function createGuard(options) {
  var opts = options || {};
  var enabled = !!opts.enabled;
  var token = opts.token || (enabled ? generate() : null);
  var allowLoopback = opts.allowLoopback !== false;
  var rotatedAt = Date.now();

  // Кто сейчас смотрит панель — для экрана «Подключённые устройства».
  var clients = new Map();          // ключ -> {ip, agent, firstSeen, lastSeen, hits}
  var rejected = 0;

  function noteClient(req, ok) {
    if (!ok) { rejected++; return; }
    var ip = req && req.socket ? req.socket.remoteAddress : 'неизвестно';
    var agent = (req && req.headers && req.headers['user-agent']) || '';
    var key = ip + '|' + agent.slice(0, 80);
    var now = Date.now();
    var rec = clients.get(key);
    if (!rec) {
      rec = { ip: ip, agent: agent, firstSeen: now, lastSeen: now, hits: 0, loopback: isLoopback(ip) };
      clients.set(key, rec);
    }
    rec.lastSeen = now;
    rec.hits++;
  }

  return {
    enabled: function () { return enabled; },
    token: function () { return token; },
    rotatedAt: function () { return rotatedAt; },

    /**
     * Пускать ли запрос. Возвращает {allowed, reason, viaLoopback}.
     */
    check: function (req, query) {
      if (!enabled) {
        noteClient(req, true);
        return { allowed: true, reason: 'общий доступ выключен — панель только на этом компьютере' };
      }
      var remote = req && req.socket ? req.socket.remoteAddress : null;
      if (allowLoopback && isLoopback(remote)) {
        noteClient(req, true);
        return { allowed: true, viaLoopback: true, reason: 'запрос с этого же компьютера' };
      }
      var given = extract(req, query);
      if (!given) {
        noteClient(req, false);
        return { allowed: false, reason: 'нет ключа доступа' };
      }
      if (!safeEqual(given, token)) {
        noteClient(req, false);
        return { allowed: false, reason: 'ключ доступа не подходит' };
      }
      noteClient(req, true);
      return { allowed: true, reason: 'ключ доступа принят' };
    },

    /** Новый токен: все открытые ссылки перестают работать. */
    rotate: function () {
      token = generate();
      rotatedAt = Date.now();
      clients.clear();
      rejected = 0;
      return token;
    },

    /** Включить или выключить общий доступ на лету. */
    setEnabled: function (on) {
      enabled = !!on;
      if (enabled && !token) token = generate();
      return enabled;
    },

    /** Кто смотрит панель. Для экрана «Подключённые устройства». */
    devices: function (staleMs) {
      var cutoff = Date.now() - (staleMs || 120000);
      var out = [];
      clients.forEach(function (c, key) {
        if (c.lastSeen < cutoff) { clients.delete(key); return; }
        out.push({
          ip: c.ip,
          agent: c.agent,
          shortAgent: shortAgent(c.agent),
          firstSeen: c.firstSeen,
          lastSeen: c.lastSeen,
          hits: c.hits,
          loopback: c.loopback
        });
      });
      return out.sort(function (a, b) { return b.lastSeen - a.lastSeen; });
    },

    rejectedCount: function () { return rejected; },

    /** Заголовок Set-Cookie: один раз пришли по ссылке — дальше без неё. */
    cookieHeader: function () {
      if (!enabled || !token) return null;
      // Без Secure: панель работает по http в локальной сети, с флагом Secure
      // браузер бы такую куку просто выбросил. SameSite=Lax защищает от того,
      // что чужая страница дёрнет наши адреса от имени пользователя.
      return COOKIE_NAME + '=' + encodeURIComponent(token) +
        '; Path=/; SameSite=Lax; Max-Age=86400';
    }
  };
}

// «Mozilla/5.0 (iPhone; …) …» -> «iPhone, Safari». Для списка устройств.
function shortAgent(ua) {
  var s = String(ua || '');
  if (!s) return 'неизвестное устройство';
  var device = 'компьютер';
  if (/iPhone/i.test(s)) device = 'iPhone';
  else if (/iPad/i.test(s)) device = 'iPad';
  else if (/Android/i.test(s)) device = 'Android';
  else if (/Macintosh|Mac OS X/i.test(s)) device = 'Mac';
  else if (/Windows/i.test(s)) device = 'Windows';
  else if (/Linux/i.test(s)) device = 'Linux';

  var browser = '';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/OPR\//.test(s)) browser = 'Opera';
  else if (/YaBrowser/.test(s)) browser = 'Яндекс';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Chrome\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';

  return browser ? device + ', ' + browser : device;
}

module.exports = {
  TOKEN_BYTES: TOKEN_BYTES,
  COOKIE_NAME: COOKIE_NAME,
  HEADER_NAME: HEADER_NAME,
  QUERY_NAME: QUERY_NAME,
  generate: generate,
  safeEqual: safeEqual,
  extract: extract,
  parseCookies: parseCookies,
  isLoopback: isLoopback,
  createGuard: createGuard,
  shortAgent: shortAgent
};
