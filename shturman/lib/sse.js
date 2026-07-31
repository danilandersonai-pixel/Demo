'use strict';

// SSE-хаб: раздача потока событий браузеру на голом node:http.

var HEARTBEAT_MS = 15000;   // комментарий-пинг, чтобы прокси не рвали соединение

function createHub(options) {
  var opts = options || {};
  var clients = new Set();
  var heartbeat = null;

  function frame(event, data, id) {
    var lines = [];
    if (id !== undefined && id !== null) lines.push('id: ' + id);
    if (event) lines.push('event: ' + event);
    // Данные могут содержать переводы строк — по спецификации каждая строка
    // получает собственный префикс data:.
    var payload = typeof data === 'string' ? data : JSON.stringify(data);
    String(payload).split('\n').forEach(function (line) {
      lines.push('data: ' + line);
    });
    return lines.join('\n') + '\n\n';
  }

  function attach(req, res, initial) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Панель локальная, но заголовок дешевле, чем ловить артефакты прокси.
      'X-Accel-Buffering': 'no'
    });
    // Подсказка браузеру: если связь оборвётся, переподключаться через 2 с.
    res.write('retry: 2000\n\n');

    var client = { res: res, alive: true };
    clients.add(client);

    if (initial) {
      // Досылаем то, что клиент пропустил (или весь буфер при первом входе).
      res.write(frame('snapshot', initial.snapshot, initial.lastId));
    }

    function cleanup() {
      if (!client.alive) return;
      client.alive = false;
      clients.delete(client);
      try { res.end(); } catch (e) { /* уже закрыт */ }
    }

    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);

    if (!heartbeat) startHeartbeat();
    return client;
  }

  function broadcast(event, data, id) {
    var text = frame(event, data, id);
    clients.forEach(function (c) {
      if (!c.alive) return;
      try {
        c.res.write(text);
      } catch (e) {
        c.alive = false;
        clients.delete(c);
      }
    });
  }

  function startHeartbeat() {
    heartbeat = setInterval(function () {
      clients.forEach(function (c) {
        if (!c.alive) return;
        try {
          c.res.write(': ping\n\n');
        } catch (e) {
          c.alive = false;
          clients.delete(c);
        }
      });
    }, opts.heartbeat || HEARTBEAT_MS);
    if (heartbeat.unref) heartbeat.unref();
  }

  return {
    attach: attach,
    broadcast: broadcast,
    frame: frame,
    count: function () { return clients.size; },
    close: function () {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      clients.forEach(function (c) {
        c.alive = false;
        try { c.res.end(); } catch (e) { /* уже закрыт */ }
      });
      clients.clear();
    }
  };
}

module.exports = { createHub: createHub, HEARTBEAT_MS: HEARTBEAT_MS };
