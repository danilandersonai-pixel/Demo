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

    // если клиент переподключился — дошлём только пропущенное
    var lastId = parseInt(req.headers['last-event-id'] || '0', 10) || 0;
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

  return {
    attach: attach,
    broadcast: broadcast,
    clientCount: function () { return clients.length; },
    bufferedEvents: function () { return buffer.slice(); }
  };
}

module.exports = { createHub: createHub, BUFFER_SIZE: BUFFER_SIZE };
