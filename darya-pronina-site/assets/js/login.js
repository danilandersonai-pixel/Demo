/* Вход в кабинет: почта + пароль.
   В публичном data/auth.json лежит только отпечаток пароля (PBKDF2-SHA256), ключ GitHub там НЕ хранится —
   его учитель вставляет один раз в самом кабинете, и он остаётся только в браузере этого устройства. */
(function () {
  'use strict';

  var AUTH_KEY = 'daria-admin-auth';   // отметка «вход выполнен»
  var THEME_KEY = 'daria-theme';

  var themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-th') === 'dark';
      if (dark) document.documentElement.removeAttribute('data-th');
      else document.documentElement.setAttribute('data-th', 'dark');
      try { localStorage.setItem(THEME_KEY, dark ? 'light' : 'dark'); } catch (e) {}
    });
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function bytesToB64(buf) {
    var arr = new Uint8Array(buf);
    var bin = '';
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function deriveBits(password, saltBytes, iterations) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (material) {
        return crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt: saltBytes, iterations: iterations, hash: 'SHA-256' },
          material,
          256
        );
      });
  }

  var form = document.getElementById('login-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = document.getElementById('login-status');
      var email = document.getElementById('email-input').value.trim().toLowerCase();
      var password = document.getElementById('password-input').value;
      var btn = document.getElementById('login-btn');
      status.textContent = '';
      btn.disabled = true;

      fetch('data/auth.json', { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('Файл доступа не найден');
          return r.json();
        })
        .then(function (auth) {
          return deriveBits(password, b64ToBytes(auth.kdf.salt), auth.kdf.iterations)
            .then(function (bits) {
              var ok = email === String(auth.email || '').trim().toLowerCase() &&
                bytesToB64(bits) === auth.verifier;
              if (!ok) throw new Error('WRONG_CREDENTIALS');
            });
        })
        .then(function () {
          try { localStorage.setItem(AUTH_KEY, String(Date.now())); } catch (e) {}
          location.replace('admin.html');
        })
        .catch(function (err) {
          status.textContent = err.message === 'WRONG_CREDENTIALS'
            ? 'Неверная почта или пароль'
            : 'Ошибка: ' + (err.message || err);
        })
        .then(function () { btn.disabled = false; });
    });
  }

  /* ---------- Служебный генератор файла доступа (login.html?setup) ---------- */
  if (location.search.indexOf('setup') !== -1) {
    document.getElementById('setup-card').classList.remove('is-hidden');
    document.getElementById('su-btn').addEventListener('click', function () {
      var email = document.getElementById('su-email').value.trim().toLowerCase();
      var pass = document.getElementById('su-pass').value;
      var out = document.getElementById('su-out');
      if (!email || !pass) { out.value = 'Заполните почту и пароль'; return; }
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var iterations = 310000;
      deriveBits(pass, salt, iterations).then(function (bits) {
        out.value = JSON.stringify({
          email: email,
          kdf: { salt: bytesToB64(salt), iterations: iterations },
          verifier: bytesToB64(bits)
        }, null, 2);
      });
    });
  }
})();
