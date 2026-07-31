'use strict';

var crypto = require('crypto');

/**
 * Доступ в share-режиме: одноразовый токен, вшитый в ссылку/QR.
 *
 * Правила:
 * - без share сервер слушает только 127.0.0.1, токен не нужен;
 * - в share-режиме запросы с самой машины (loopback) пускаются без токена —
 *   это хозяин; все остальные обязаны предъявить токен в query (?t=…),
 *   cookie или заголовке Authorization: Bearer;
 * - «отозвать доступ» = rotate(): старый токен мгновенно перестаёт работать.
 */
function createAuth(shareMode) {
  var token = crypto.randomBytes(16).toString('hex');

  function isLoopback(remoteAddress) {
    var a = String(remoteAddress || '');
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' ||
      a.indexOf('127.') === 0 || a.indexOf('::ffff:127.') === 0;
  }

  /** Достать предъявленный токен из запроса (query / cookie / заголовок). */
  function presentedToken(req) {
    var m = /[?&]t=([^&]+)/.exec(String(req.url || ''));
    if (m) {
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    var auth = String((req.headers && req.headers.authorization) || '');
    if (auth.indexOf('Bearer ') === 0) return auth.slice(7).trim();
    var cookies = String((req.headers && req.headers.cookie) || '');
    var cm = /(?:^|;\s*)shturman_token=([^;]+)/.exec(cookies);
    if (cm) return cm[1];
    return null;
  }

  function timingSafeEqual(a, b) {
    var ba = Buffer.from(String(a));
    var bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  }

  /**
   * Пускать ли запрос. Возвращает объект:
   * { ok, viaQueryToken } — viaQueryToken=true значит «токен пришёл в
   * ссылке, стоит поставить cookie, чтобы дальше работало без ?t=».
   */
  function check(req) {
    var remote = req.socket ? req.socket.remoteAddress : null;
    if (isLoopback(remote)) return { ok: true, viaQueryToken: false, owner: true };
    if (!shareMode) return { ok: false, viaQueryToken: false };
    var presented = presentedToken(req);
    if (presented && timingSafeEqual(presented, token)) {
      var fromQuery = /[?&]t=/.test(String(req.url || ''));
      return { ok: true, viaQueryToken: fromQuery, owner: false };
    }
    return { ok: false, viaQueryToken: false };
  }

  return {
    check: check,
    isLoopback: isLoopback,
    getToken: function () { return token; },
    rotate: function () {
      token = crypto.randomBytes(16).toString('hex');
      return token;
    },
    cookieHeader: function () {
      return 'shturman_token=' + token + '; Path=/; SameSite=Lax; Max-Age=86400';
    }
  };
}

module.exports = { createAuth: createAuth };
