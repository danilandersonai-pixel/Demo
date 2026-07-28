/* Кабинет учителя: правка data/site-data.json и загрузка файлов через GitHub Contents API.
   Ключ (fine-grained PAT, Contents RW на один репозиторий) хранится только в localStorage. */
(function () {
  'use strict';

  var CFG = {
    owner: 'danilandersonai-pixel',
    repo: 'Demo',
    branch: 'claude/darya-pronina-site-fitjjh',
    prefix: 'darya-pronina-site/',
    dataPath: 'data/site-data.json'
  };
  var SESSION_KEY = 'daria-admin-session';
  var THEME_KEY = 'daria-theme';
  var SUBJECTS = ['Русский язык', 'Математика', 'Окружающий мир', 'Литературное чтение',
    'Скорочтение', 'Английский язык', 'Праздники и мероприятия'];

  /* ---------- Тема (как на сайте) ---------- */
  var themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-th') === 'dark';
      if (dark) document.documentElement.removeAttribute('data-th');
      else document.documentElement.setAttribute('data-th', 'dark');
      try { localStorage.setItem(THEME_KEY, dark ? 'light' : 'dark'); } catch (e) {}
    });
  }

  /* ---------- Состояние ---------- */
  var state = {
    token: null,
    data: null,        // содержимое site-data.json
    dataSha: null,     // sha файла данных в репозитории
    uploads: {},       // repoPath -> { base64, dataUrl }
    editingId: null,   // id редактируемой разработки (null = новая)
    dirty: false,
    publishing: false, // идёт публикация — правки заблокированы
    reading: 0,        // сколько файлов читается прямо сейчас
    formToken: 0,      // «поколение» формы: поздний FileReader из прошлой формы игнорируется
    leaving: false     // намеренный уход (выход/переход) — не показывать beforeunload
  };

  /* ---------- Утилиты ---------- */
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function b64encodeUtf8(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64decodeUtf8(b64) {
    var bin = atob(b64.replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function readFileBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result);
        resolve({ base64: dataUrl.split(',')[1], dataUrl: dataUrl });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  var TRANSLIT = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
    'х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
  };

  function slugify(name) {
    var out = '';
    var lower = String(name || '').toLowerCase();
    for (var i = 0; i < lower.length; i++) {
      var ch = lower[i];
      if (TRANSLIT.hasOwnProperty(ch)) out += TRANSLIT[ch];
      else if (/[a-z0-9]/.test(ch)) out += ch;
      else out += '-';
    }
    out = out.replace(/-+/g, '-').replace(/^-|-$/g, '');
    return out || 'material';
  }

  function uniqueId(base) {
    var id = base, n = 2;
    var ids = state.data.works.map(function (w) { return w.id; });
    while (ids.indexOf(id) !== -1) { id = base + '-' + n; n++; }
    return id;
  }

  function setDirty(v) {
    state.dirty = v;
    $('dirty-note').classList.toggle('is-hidden', !v);
  }

  /* Неопубликованные правки живут только в памяти — предупреждаем перед уходом */
  window.addEventListener('beforeunload', function (e) {
    if (!state.dirty || state.leaving) return;
    e.preventDefault();
    e.returnValue = '';
  });

  function confirmLeave(msg) {
    if (!state.dirty) return true;
    return confirm(msg);
  }

  /* ---------- GitHub API ---------- */
  function gh(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      'Authorization': 'Bearer ' + state.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }, opts.headers || {});
    return fetch('https://api.github.com' + path, opts);
  }

  function contentsUrl(repoPath) {
    return '/repos/' + CFG.owner + '/' + CFG.repo + '/contents/' +
      encodeURIComponent(CFG.prefix + repoPath).replace(/%2F/g, '/');
  }

  function getFileSha(repoPath) {
    return gh(contentsUrl(repoPath) + '?ref=' + encodeURIComponent(CFG.branch))
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('GitHub: ' + r.status);
        return r.json().then(function (j) { return j.sha; });
      });
  }

  function putFile(repoPath, base64, message) {
    return getFileSha(repoPath).then(function (sha) {
      var body = { message: message, content: base64, branch: CFG.branch };
      if (sha) body.sha = sha;
      return gh(contentsUrl(repoPath), { method: 'PUT', body: JSON.stringify(body) })
        .then(function (r) {
          if (!r.ok) {
            return r.json().catch(function () { return {}; }).then(function (j) {
              throw new Error('GitHub ' + r.status + (j.message ? ': ' + j.message : ''));
            });
          }
          return r.json();
        });
    });
  }

  /* ---------- Сессия и загрузка данных ---------- */
  function getSessionToken() {
    try {
      return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    } catch (e) { return null; }
  }

  function toLogin() {
    state.leaving = true;
    try {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
    location.replace('login.html');
  }

  function isDemo() {
    return !!state.token && state.token.indexOf('github_pat_PLACEHOLDER') === 0;
  }

  function normalizeData() {
    if (!state.data.works) state.data.works = [];
    if (!state.data.reviews) state.data.reviews = [];
  }

  function loadDataApi() {
    return gh(contentsUrl(CFG.dataPath) + '?ref=' + encodeURIComponent(CFG.branch))
      .then(function (r) {
        if (!r.ok) throw new Error('Не удалось загрузить данные сайта (' + r.status + ')');
        return r.json();
      })
      .then(function (j) {
        state.dataSha = j.sha;
        state.data = JSON.parse(b64decodeUtf8(j.content));
        normalizeData();
      });
  }

  function loadDataLocal() {
    return fetch('data/site-data.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        state.dataSha = null;
        state.data = j;
        normalizeData();
      });
  }

  function init() {
    state.token = getSessionToken();
    if (!state.token) { toLogin(); return; }

    var ready;
    if (isDemo()) {
      $('demo-banner').classList.remove('is-hidden');
      $('publish-btn').disabled = true;
      $('publish-btn').title = 'В демо-режиме публикация отключена';
      ready = loadDataLocal();
    } else {
      ready = gh('/repos/' + CFG.owner + '/' + CFG.repo)
        .then(function (r) {
          if (r.status === 401 || r.status === 403) throw new Error('SESSION_INVALID');
          if (!r.ok) throw new Error('Нет доступа к репозиторию (' + r.status + ')');
          return loadDataApi();
        });
    }

    ready
      .then(function () {
        renderWorksList();
        renderReviewsList();
      })
      .catch(function (err) {
        if (err && err.message === 'SESSION_INVALID') {
          alert('Доступ устарел — войдите заново.');
          toLogin();
          return;
        }
        // Данные не загрузились (например, нет сети) — пробуем локальную копию
        loadDataLocal()
          .then(function () { renderWorksList(); renderReviewsList(); })
          .catch(function () { alert('Не удалось загрузить данные сайта: ' + (err.message || err)); });
      });
  }

  $('logout-btn').addEventListener('click', function () {
    if (!confirmLeave('Есть неопубликованные изменения — они будут потеряны. Выйти?')) return;
    toLogin();
  });

  var toSite = $('to-site-link');
  if (toSite) {
    toSite.addEventListener('click', function (e) {
      if (!confirmLeave('Есть неопубликованные изменения — они будут потеряны. Перейти на сайт?')) {
        e.preventDefault();
        return;
      }
      state.leaving = true;
    });
  }

  /* ---------- Вкладки ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.chip[data-tab]'), function (chip) {
    chip.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.chip[data-tab]'), function (c) {
        c.classList.toggle('is-active', c === chip);
      });
      var tab = chip.getAttribute('data-tab');
      $('tab-works').classList.toggle('is-hidden', tab !== 'works');
      $('tab-reviews').classList.toggle('is-hidden', tab !== 'reviews');
    });
  });

  /* ---------- Список разработок ---------- */
  function previewSrc(path) {
    if (!path) return null;
    if (state.uploads[path]) return state.uploads[path].dataUrl;
    return path; // относительный путь — работает после публикации
  }

  function renderWorksList() {
    var list = $('works-admin-list');
    list.innerHTML = '';
    state.data.works.forEach(function (w) {
      var row = el('div', 'admin-item');

      var thumb = el('div', 'admin-item__thumb');
      var cover = previewSrc(w.cover);
      if (cover) {
        var img = el('img');
        img.src = cover;
        img.alt = '';
        thumb.appendChild(img);
      } else {
        thumb.appendChild(el('span', 'admin-item__noimg', 'нет\nобложки'));
      }
      row.appendChild(thumb);

      var info = el('div', 'admin-item__info');
      info.appendChild(el('div', 'admin-item__name', w.name));
      info.appendChild(el('div', 'admin-item__meta',
        w.cat + ' · ' + (w.price || 'Бесплатно') + (w.pdf ? ' · PDF ✓' : ' · без PDF')));
      row.appendChild(info);

      var actions = el('div', 'admin-item__actions');
      var editBtn = el('button', 'btn btn--ghost btn--sm', 'Изменить');
      editBtn.type = 'button';
      editBtn.addEventListener('click', function () { openWorkForm(w.id); });
      var delBtn = el('button', 'btn btn--ghost btn--sm btn--danger', 'Удалить');
      delBtn.type = 'button';
      delBtn.addEventListener('click', function () {
        if (state.publishing) return;
        if (!confirm('Удалить «' + w.name + '» с сайта?')) return;
        // Файлы, которые ещё не опубликованы, выкидываем — иначе загрузятся впустую
        if (w.pdf && state.uploads[w.pdf]) delete state.uploads[w.pdf];
        if (w.cover && state.uploads[w.cover]) delete state.uploads[w.cover];
        state.data.works = state.data.works.filter(function (x) { return x.id !== w.id; });
        if (state.editingId === w.id) {
          state.editingId = null;
          state.formToken++;
          $('work-form-wrap').classList.add('is-hidden');
        }
        setDirty(true);
        renderWorksList();
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      row.appendChild(actions);

      list.appendChild(row);
    });
  }

  /* ---------- Форма разработки ---------- */
  var pendingPdf = null;   // { base64, dataUrl }
  var pendingCover = null;

  function buildSubjectChecks(selected) {
    var wrap = $('wf-subjects');
    wrap.innerHTML = '';
    SUBJECTS.forEach(function (s) {
      var label = el('label', 'admin-check');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = s;
      cb.checked = selected.indexOf(s) !== -1;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + s));
      wrap.appendChild(label);
    });
  }

  function openWorkForm(id) {
    state.editingId = id || null;
    state.formToken++;   // отменяет результаты чтения файлов из прошлой формы
    pendingPdf = null;
    pendingCover = null;
    $('work-save-btn').disabled = false;
    var w = id ? state.data.works.filter(function (x) { return x.id === id; })[0] : null;
    $('work-form-title').textContent = w ? 'Изменить: ' + w.name : 'Новая разработка';
    $('wf-name').value = w ? w.name : '';
    $('wf-desc').value = w ? w.desc : '';
    $('wf-meta').value = w ? w.meta : '';
    $('wf-cat').value = w ? w.cat : 'Наглядно-учебный материал к урокам';
    $('wf-type').value = w ? w.type : '';
    $('wf-price').value = w ? (w.price || 'Бесплатно') : 'Бесплатно';
    buildSubjectChecks(w ? (w.subjects || []) : []);
    $('wf-pdf').value = '';
    $('wf-cover').value = '';
    $('wf-pdf-current').textContent = w && w.pdf ? 'Сейчас: ' + w.pdf.split('/').pop() : 'PDF пока не загружен';
    var prev = $('wf-cover-preview');
    var cover = w ? previewSrc(w.cover) : null;
    prev.classList.toggle('is-hidden', !cover);
    if (cover) prev.src = cover;
    $('work-form-error').textContent = '';
    $('work-form-wrap').classList.remove('is-hidden');
    $('wf-name').focus();
  }

  $('add-work-btn').addEventListener('click', function () { openWorkForm(null); });
  $('work-cancel-btn').addEventListener('click', function () {
    $('work-form-wrap').classList.add('is-hidden');
    state.editingId = null;
    state.formToken++;
  });

  function trackRead(promise) {
    state.reading++;
    $('work-save-btn').disabled = true;
    return promise.then(function (res) { return res; })
      .catch(function () { return null; })
      .then(function (res) {
        state.reading--;
        if (state.reading === 0) $('work-save-btn').disabled = false;
        return res;
      });
  }

  $('wf-pdf').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var token = state.formToken;
    $('wf-pdf-current').textContent = 'Читаю файл…';
    trackRead(readFileBase64(f)).then(function (res) {
      if (!res || token !== state.formToken) return; // форму уже закрыли/сменили
      pendingPdf = res;
      $('wf-pdf-current').textContent = 'Будет загружен: ' + f.name;
    });
  });

  $('wf-cover').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var token = state.formToken;
    trackRead(readFileBase64(f)).then(function (res) {
      if (!res || token !== state.formToken) return;
      pendingCover = res;
      pendingCover.ext = f.type === 'image/png' ? 'png' : 'jpg';
      var prev = $('wf-cover-preview');
      prev.src = res.dataUrl;
      prev.classList.remove('is-hidden');
    });
  });

  $('work-save-btn').addEventListener('click', function () {
    if (state.publishing) { $('work-form-error').textContent = 'Идёт публикация, подождите'; return; }
    if (state.reading > 0) { $('work-form-error').textContent = 'Файл ещё читается, подождите секунду'; return; }
    var name = $('wf-name').value.trim();
    if (!name) { $('work-form-error').textContent = 'Название обязательно'; return; }

    var w;
    if (state.editingId) {
      w = state.data.works.filter(function (x) { return x.id === state.editingId; })[0];
      if (!w) { // запись удалили, пока форма была открыта — сохраняем как новую
        w = { id: uniqueId(slugify(name)), pdf: '', cover: '' };
        state.data.works.unshift(w);
      }
    } else {
      w = { id: uniqueId(slugify(name)), pdf: '', cover: '' };
      state.data.works.unshift(w);
    }

    w.name = name;
    w.desc = $('wf-desc').value.trim();
    w.meta = $('wf-meta').value.trim();
    w.cat = $('wf-cat').value;
    w.type = $('wf-type').value.trim() || w.cat.toUpperCase();
    w.price = $('wf-price').value.trim() || 'Бесплатно';
    w.subjects = Array.prototype.slice.call(document.querySelectorAll('#wf-subjects input:checked'))
      .map(function (cb) { return cb.value; });

    if (pendingPdf) {
      w.pdf = 'assets/materials/' + w.id + '.pdf';
      state.uploads[w.pdf] = pendingPdf;
    }
    if (pendingCover) {
      w.cover = 'assets/materials/covers/' + w.id + '.' + pendingCover.ext;
      state.uploads[w.cover] = pendingCover;
    }

    setDirty(true);
    $('work-form-wrap').classList.add('is-hidden');
    state.editingId = null;
    renderWorksList();
  });

  /* ---------- Отзывы ---------- */
  function renderReviewsList() {
    var grid = $('reviews-admin-list');
    grid.innerHTML = '';
    if (!state.data.reviews.length) {
      grid.appendChild(el('p', 'admin-note', 'Скриншотов пока нет — загрузите первые.'));
      return;
    }
    state.data.reviews.forEach(function (r, idx) {
      var card = el('div', 'admin-review');
      var img = el('img');
      img.src = previewSrc(r.image) || '';
      img.alt = 'Отзыв ' + (idx + 1);
      card.appendChild(img);
      var delBtn = el('button', 'admin-review__del', '×');
      delBtn.type = 'button';
      delBtn.title = 'Удалить отзыв';
      delBtn.addEventListener('click', function () {
        if (state.publishing) return;
        if (r.image && state.uploads[r.image]) delete state.uploads[r.image];
        state.data.reviews.splice(idx, 1);
        setDirty(true);
        renderReviewsList();
      });
      card.appendChild(delBtn);
      grid.appendChild(card);
    });
  }

  $('review-upload').addEventListener('change', function () {
    if (state.publishing) { this.value = ''; return; }
    var files = Array.prototype.slice.call(this.files || []);
    if (!files.length) return;
    var failed = 0;
    var jobs = files.map(function (f, i) {
      return readFileBase64(f).then(function (res) {
        var ext = f.type === 'image/png' ? 'png' : 'jpg';
        var path = 'assets/reviews/rev-' + Date.now() + '-' + i + '.' + ext;
        state.uploads[path] = res;
        state.data.reviews.push({ image: path, alt: 'Отзыв' });
      }).catch(function () { failed++; });
    });
    var input = this;
    Promise.all(jobs).then(function () {
      input.value = '';
      setDirty(true);
      renderReviewsList();
      if (failed) alert('Не удалось прочитать файлов: ' + failed + '. Остальные добавлены.');
    });
  });

  /* ---------- Публикация ---------- */
  function log(msg, isError) {
    var box = $('publish-log');
    box.classList.remove('is-hidden');
    var line = el('div', isError ? 'admin-log__line admin-log__line--err' : 'admin-log__line', msg);
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  $('publish-btn').addEventListener('click', function () {
    if (isDemo()) { log('Демо-режим: публикация отключена.', true); return; }
    if (state.publishing) return;
    if (!state.dirty) { log('Изменений нет — публиковать нечего.'); return; }
    var btn = this;
    btn.disabled = true;
    state.publishing = true;
    $('publish-log').innerHTML = '';
    log('Публикую изменения…');

    // Снимок на момент клика: файлы и данные должны соответствовать друг другу,
    // даже если во время публикации что-то ещё добавят.
    var paths = Object.keys(state.uploads);
    var snapshotJson = JSON.stringify(state.data, null, 2);

    var chain = Promise.resolve();
    paths.forEach(function (p) {
      chain = chain.then(function () {
        log('Загружаю ' + p.split('/').pop() + '…');
        return putFile(p, state.uploads[p].base64, 'Кабинет: файл ' + p.split('/').pop());
      });
    });

    chain
      .then(function () {
        log('Сохраняю данные сайта…');
        return putFile(CFG.dataPath, b64encodeUtf8(snapshotJson), 'Кабинет: обновление материалов и отзывов');
      })
      .then(function (resp) {
        if (resp && resp.content) state.dataSha = resp.content.sha;
        // Чистим только то, что реально опубликовано
        paths.forEach(function (p) { delete state.uploads[p]; });
        var stillDirty = Object.keys(state.uploads).length > 0 ||
          JSON.stringify(state.data, null, 2) !== snapshotJson;
        setDirty(stillDirty);
        log('Готово! Изменения опубликованы. Сайт обновится в течение пары минут.');
        if (stillDirty) log('Есть изменения, сделанные во время публикации — нажмите «Опубликовать» ещё раз.');
      })
      .catch(function (err) {
        var msg = String(err && err.message || err);
        if (/\b401\b|\b403\b/.test(msg)) {
          log('Доступ устарел или отозван — войдите заново.', true);
          log('Ваши изменения пока сохранены на этой странице: войдите в другой вкладке и вернитесь сюда.', true);
        } else {
          log('Ошибка: ' + msg, true);
          log('Изменения не потеряны — попробуйте «Опубликовать» ещё раз.', true);
        }
      })
      .then(function () {
        state.publishing = false;
        btn.disabled = false;
      });
  });

  /* ---------- Старт ---------- */
  init();
})();
