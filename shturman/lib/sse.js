'use strict';

/**
 * SSE-хаб: держит подключённых клиентов и кольцевой буфер последних событий,
 * чтобы новый клиент (или переподключившийся) сразу получил историю.
 */

var BUFFER_SIZE = 300;

function createHub() {
  var clients = [];       // [{res}]
  var buffer = [];        // [{id, type, data}]
  var nextId = 1;

  function attach(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');

    // если клиент переподключился — дошлём только пропущенное; браузерный
    // реконнект несёт заголовок Last-Event-ID, а «экономный» реконнект
    // после сворачивания вкладки — параметр ?after=<id>
    var lastId = parseInt(req.headers['last-event-id'] || '0', 10) || 0;
    var afterMatch = /[?&]after=(\d+)/.exec(String(req.url || ''));
    if (afterMatch) lastId = Math.max(lastId, parseInt(afterMatch[1], 10) || 0);
    for (var i = 0; i < buffer.length; i++) {
      if (buffer[i].id > lastId) writeEvent(res, buffer[i]);
    }

    var client = { res: res };
    clients.push(client);
    var ping = setInterval(function () {
      try { res.write(': ping\n\n'); } catch (e) { /* закрыто */ }
    }, 25000);
    if (ping.unref) ping.unref();

    req.on('close', function () {
      clearInterval(ping);
      var idx = clients.indexOf(client);
      if (idx !== -1) clients.splice(idx, 1);
    });
  }

  function writeEvent(res, item) {
    try {
      res.write('id: ' + item.id + '\n' +
        'event: ' + item.type + '\n' +
        'data: ' + JSON.stringify(item.data) + '\n\n');
    } catch (e) { /* клиент отвалился — почистится по close */ }
  }

  function broadcast(type, data) {
    var item = { id: nextId++, type: type, data: data };
    buffer.push(item);
    if (buffer.length > BUFFER_SIZE) buffer.shift();
    for (var i = 0; i < clients.length; i++) writeEvent(clients[i].res, item);
    return item.id;
  }

  /**
   * Служебное событие «текущее состояние» (пульс, git, файлы): уходит живым
   * клиентам, но НЕ пишется в буфер — иначе периодика вытеснит настоящую
   * историю ленты, а при переподключении клиент получит ворох устаревших
   * состояний.
   */
  function transient(type, data) {
    var payload = 'event: ' + type + '\n' + 'data: ' + JSON.stringify(data) + '\n\n';
    for (var i = 0; i < clients.length; i++) {
      try { clients[i].res.write(payload); } catch (e) { /* отвалился */ }
    }
  }

  return {
    attach: attach,
    broadcast: broadcast,
    transient: transient,
    clientCount: function () { return clients.length; },
    bufferedEvents: function () { return buffer.slice(); }
  };
}

module.exports = { createHub: createHub, BUFFER_SIZE: BUFFER_SIZE };
