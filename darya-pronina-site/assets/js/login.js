/* Вход в кабинет: почта + пароль. Пароль расшифровывает GitHub-ключ из data/auth.json
   (PBKDF2-SHA256 + AES-256-GCM, WebCrypto). Неверный пароль = ключ не расшифруется. */
(function () {
  'use strict';

  var SESSION_KEY = 'daria-admin-session';
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

  function bytesToB64(bytes) {
    var bin = '';
    var arr = new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function deriveKey(password, saltBytes, iterations) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (material) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: saltBytes, iterations: iterations, hash: 'SHA-256' },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  /* ---------- Вход ---------- */
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
          if (email !== String(auth.email || '').trim().toLowerCase()) {
            throw new Error('WRONG_CREDENTIALS');
          }
          return deriveKey(password, b64ToBytes(auth.kdf.salt), auth.kdf.iterations)
            .then(function (key) {
              return crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: b64ToBytes(auth.token.iv) },
                key,
                b64ToBytes(auth.token.data)
              );
            })
            .catch(function () { throw new Error('WRONG_CREDENTIALS'); });
        })
        .then(function (plainBuf) {
          var token = new TextDecoder().decode(plainBuf);
          try {
            localStorage.setItem(SESSION_KEY, token); // вход запоминается на этом устройстве
            sessionStorage.removeItem(SESSION_KEY);
          } catch (e) {}
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

  /* ---------- Служебный генератор (login.html?setup) ---------- */
  if (location.search.indexOf('setup') !== -1) {
    document.getElementById('setup-card').classList.remove('is-hidden');
    document.getElementById('su-btn').addEventListener('click', function () {
      var email = document.getElementById('su-email').value.trim().toLowerCase();
      var pass = document.getElementById('su-pass').value;
      var token = document.getElementById('su-token').value.trim();
      var out = document.getElementById('su-out');
      if (!email || !pass || !token) { out.value = 'Заполните все поля'; return; }
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var iterations = 310000;
      deriveKey(pass, salt, iterations)
        .then(function (key) {
          return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(token));
        })
        .then(function (ct) {
          out.value = JSON.stringify({
            email: email,
            kdf: { salt: bytesToB64(salt), iterations: iterations },
            token: { iv: bytesToB64(iv), data: bytesToB64(ct) }
          }, null, 2);
        });
    });
  }
})();
