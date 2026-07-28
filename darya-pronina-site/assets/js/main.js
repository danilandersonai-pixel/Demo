/* Дарья Сергеевна — сайт учителя. Рендер из data/site-data.json, тема, фильтры, карточка товара. */
(function () {
  'use strict';

  var THEME_KEY = 'daria-theme';

  /* ---------- Переключение темы (light/dark, сохраняется в localStorage) ---------- */
  function getTheme() {
    return document.documentElement.getAttribute('data-th') === 'dark' ? 'dark' : 'light';
  }

  function setTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-th', 'dark');
    } else {
      document.documentElement.removeAttribute('data-th');
    }
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  var themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    });
  }

  /* ---------- Помощник создания элементов ---------- */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  /* Ссылки берутся из данных сайта — разрешаем только относительные пути и http(s),
     иначе javascript:/data: URL исполнился бы на нашем origin. */
  function safeUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:/i.test(u)) return '';
    return u;
  }

  /* ---------- Рендер карточек разработок ---------- */
  function renderWorks(works) {
    var grid = document.getElementById('works-grid');
    if (!grid) return;
    grid.innerHTML = '';
    works.forEach(function (w) {
      var pdf = safeUrl(w.pdf);
      var isProduct = !!pdf;
      var card = el('article', isProduct ? 'work-card work-card--product' : 'work-card');
      card.setAttribute('data-cat', w.cat || '');
      if (w.subjects && w.subjects.length) card.setAttribute('data-subject', w.subjects.join(','));
      if (isProduct) {
        card.setAttribute('data-pdf', pdf);
        card.setAttribute('data-price', w.price || 'Бесплатно');
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-haspopup', 'dialog');
      }

      var media = el('div', 'work-card__media');
      var cover = safeUrl(w.cover);
      if (cover) {
        var img = el('img');
        img.src = cover;
        img.alt = 'Обложка: ' + (w.name || '');
        img.loading = 'lazy';
        media.appendChild(img);
      } else {
        media.appendChild(el('div', 'slot', 'Обложка / фото работы'));
      }
      card.appendChild(media);

      var body = el('div', 'work-card__body');
      var badges = el('div', 'work-card__badges');
      if (w.type) badges.appendChild(el('span', 'pill pill--red', w.type));
      var free = !w.price || w.price.toLowerCase() === 'бесплатно';
      badges.appendChild(free
        ? el('span', 'pill pill--green', 'БЕСПЛАТНО')
        : el('span', 'pill pill--amber', w.price));
      body.appendChild(badges);
      body.appendChild(el('div', 'work-card__name', w.name || ''));
      if (w.desc) body.appendChild(el('div', 'work-card__desc', w.desc));
      if (w.meta) body.appendChild(el('div', 'work-card__meta', w.meta));
      card.appendChild(body);

      grid.appendChild(card);
    });
  }

  /* ---------- Рендер отзывов ---------- */
  var REVIEW_ROTATIONS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];

  function renderReviews(reviews) {
    var grid = document.getElementById('reviews-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (!reviews.length) {
      // Плейсхолдеры, пока скриншотов нет
      for (var i = 0; i < 6; i++) {
        var ph = el('div', 'review-card review-card--' + REVIEW_ROTATIONS[i]);
        ph.appendChild(el('div', 'slot slot--rounded', 'Скриншот отзыва'));
        grid.appendChild(ph);
      }
      return;
    }
    reviews.forEach(function (r, i) {
      var card = el('div', 'review-card review-card--' + REVIEW_ROTATIONS[i % 6]);
      var img = el('img', 'review-card__img');
      img.src = safeUrl(r.image);
      img.alt = r.alt || 'Скриншот отзыва';
      img.loading = 'lazy';
      card.appendChild(img);
      grid.appendChild(card);
    });
  }

  /* ---------- Фильтры «Авторские разработки» + «Показать ещё» ---------- */
  function initWorksUI() {
    var WORKS_LIMIT = 4; // сколько карточек видно до раскрытия
    var chips = Array.prototype.slice.call(document.querySelectorAll('.chip[data-cat]'));
    var cards = Array.prototype.slice.call(document.querySelectorAll('.work-card[data-cat]'));
    var tags = Array.prototype.slice.call(document.querySelectorAll('.tag[data-subject]'));
    var moreWrap = document.getElementById('works-more');
    var moreBtn = document.getElementById('works-more-btn');
    var subjectNote = document.getElementById('subject-note');
    var subjectNoteText = document.getElementById('subject-note-text');
    var subjectClear = document.getElementById('subject-clear');
    var emptyNote = document.getElementById('works-empty');
    var activeCat = 'Все';
    var activeSubject = null;
    var expanded = false;

    function worksPlural(n) {
      var d10 = n % 10, d100 = n % 100;
      if (d10 === 1 && d100 !== 11) return 'разработку';
      if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'разработки';
      return 'разработок';
    }

    function isFree(card) {
      var price = card.getAttribute('data-price');
      if (price) return price.toLowerCase() === 'бесплатно';
      var pill = card.querySelector('.pill--green');
      return !!(pill && pill.textContent.trim().toLowerCase() === 'бесплатно');
    }

    function cardMatches(card) {
      if (activeCat === 'Бесплатно') {
        if (!isFree(card)) return false;
      } else if (activeCat !== 'Все' && card.getAttribute('data-cat') !== activeCat) {
        return false;
      }
      if (!activeSubject) return true;
      var subjects = (card.getAttribute('data-subject') || '').toLowerCase().split(',');
      return subjects.indexOf(activeSubject.toLowerCase()) !== -1;
    }

    function applyWorksFilter() {
      var matched = cards.filter(cardMatches);
      cards.forEach(function (card) { card.classList.add('is-hidden'); });
      matched.forEach(function (card, i) {
        card.classList.toggle('is-hidden', !expanded && i >= WORKS_LIMIT);
      });

      if (subjectNote) {
        subjectNote.classList.toggle('is-hidden', !activeSubject);
        if (activeSubject && subjectNoteText) {
          subjectNoteText.textContent = 'Показаны разработки по предмету «' + activeSubject + '»';
        }
      }
      if (emptyNote) emptyNote.classList.toggle('is-hidden', matched.length > 0);

      var hiddenCount = expanded ? 0 : Math.max(0, matched.length - WORKS_LIMIT);
      if (moreWrap) moreWrap.classList.toggle('is-hidden', hiddenCount === 0);
      if (moreBtn && hiddenCount > 0) {
        moreBtn.textContent = 'Показать ещё ' + hiddenCount + ' ' + worksPlural(hiddenCount);
      }
    }

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        activeCat = chip.getAttribute('data-cat');
        expanded = false;
        chips.forEach(function (c) { c.classList.toggle('is-active', c === chip); });
        applyWorksFilter();
      });
    });

    tags.forEach(function (tag) {
      tag.addEventListener('click', function () {
        activeSubject = tag.getAttribute('data-subject');
        activeCat = 'Все';
        expanded = false;
        chips.forEach(function (c) { c.classList.toggle('is-active', c.getAttribute('data-cat') === 'Все'); });
        applyWorksFilter();
        var works = document.getElementById('works');
        if (works) works.scrollIntoView({ behavior: 'smooth' });
      });
    });

    if (subjectClear) {
      subjectClear.addEventListener('click', function () {
        activeSubject = null;
        expanded = false;
        applyWorksFilter();
      });
    }

    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        expanded = true;
        applyWorksFilter();
      });
    }

    applyWorksFilter();
  }

  /* ---------- Карточка товара (модальное окно) ---------- */
  function initProductModal() {
    var modal = document.getElementById('product-modal');
    if (!modal) return;
    var modalImg = document.getElementById('product-modal-img');
    var modalBadges = document.getElementById('product-modal-badges');
    var modalTitle = document.getElementById('product-modal-title');
    var modalDesc = document.getElementById('product-modal-desc');
    var modalMeta = document.getElementById('product-modal-meta');
    var modalPrice = document.getElementById('product-modal-price');
    var modalDownload = document.getElementById('product-modal-download');
    var lastFocused = null;

    function openProduct(card) {
      var img = card.querySelector('.work-card__media img');
      var name = card.querySelector('.work-card__name');
      var desc = card.querySelector('.work-card__desc');
      var meta = card.querySelector('.work-card__meta');
      var badges = card.querySelector('.work-card__badges');

      if (modalImg) {
        // Чистим прежнюю обложку, иначе у товара без картинки останется чужая
        if (img) {
          modalImg.src = img.currentSrc || img.src;
          modalImg.alt = img.alt || '';
          modalImg.classList.remove('is-hidden');
        } else {
          modalImg.removeAttribute('src');
          modalImg.alt = '';
          modalImg.classList.add('is-hidden');
        }
      }
      if (modalTitle) modalTitle.textContent = name ? name.textContent : '';
      if (modalDesc) modalDesc.textContent = desc ? desc.textContent : '';
      if (modalMeta) modalMeta.textContent = meta ? meta.textContent : '';
      if (modalBadges) {
        modalBadges.innerHTML = '';
        if (badges) {
          Array.prototype.forEach.call(badges.children, function (b) {
            modalBadges.appendChild(b.cloneNode(true));
          });
        }
      }

      var price = card.getAttribute('data-price') || 'Бесплатно';
      var free = price.trim().toLowerCase() === 'бесплатно';
      if (modalPrice) modalPrice.textContent = price;
      if (modalDownload) {
        if (free) {
          modalDownload.textContent = 'Скачать PDF';
          modalDownload.href = safeUrl(card.getAttribute('data-pdf')) || '#';
          modalDownload.removeAttribute('aria-disabled');
        } else {
          // Платный материал не отдаём прямой ссылкой — ведём на связь с автором
          modalDownload.textContent = 'Как получить →';
          modalDownload.href = 'https://vk.ru/club237183078';
        }
      }

      lastFocused = document.activeElement;
      modal.classList.remove('is-hidden');
      document.body.classList.add('modal-open');
      var closeBtn = modal.querySelector('.product-modal__close');
      if (closeBtn) closeBtn.focus();
    }

    function closeProduct() {
      if (modal.classList.contains('is-hidden')) return;
      modal.classList.add('is-hidden');
      document.body.classList.remove('modal-open');
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    Array.prototype.forEach.call(document.querySelectorAll('.work-card--product'), function (card) {
      card.addEventListener('click', function () { openProduct(card); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openProduct(card);
        }
      });
    });

    Array.prototype.forEach.call(modal.querySelectorAll('[data-close]'), function (elc) {
      elc.addEventListener('click', closeProduct);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeProduct();
    });
  }

  /* ---------- Инициализация с данными ---------- */
  function initSite(data) {
    renderWorks((data && data.works) || []);
    renderReviews((data && data.reviews) || []);
    initWorksUI();
    initProductModal();
  }

  if (window.__SITE_DATA__) {
    initSite(window.__SITE_DATA__);
  } else {
    fetch('data/site-data.json')
      .then(function (r) { return r.json(); })
      .then(initSite)
      .catch(function () { initSite({ works: [], reviews: [] }); });
  }

  /* ---------- Текущий год в футере ---------- */
  var yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- Неактивные ссылки-заглушки (Telegram, прототип) ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('a[aria-disabled="true"]'), function (link) {
    link.addEventListener('click', function (e) { e.preventDefault(); });
  });
})();
