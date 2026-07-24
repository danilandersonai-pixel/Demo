/* Дарья Сергеевна — сайт учителя. Тема, фильтры разработок, карточка товара, год. */
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

  /* ---------- Фильтр «Разработки»: категория + предмет + «Показать ещё» ---------- */
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

  /* Плашки предметов в герое: фильтр по предмету + переход к разработкам */
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

  /* ---------- Карточка товара (модальное окно) ---------- */
  var modal = document.getElementById('product-modal');
  var modalImg = document.getElementById('product-modal-img');
  var modalBadges = document.getElementById('product-modal-badges');
  var modalTitle = document.getElementById('product-modal-title');
  var modalDesc = document.getElementById('product-modal-desc');
  var modalMeta = document.getElementById('product-modal-meta');
  var modalPrice = document.getElementById('product-modal-price');
  var modalDownload = document.getElementById('product-modal-download');
  var lastFocused = null;

  function openProduct(card) {
    if (!modal) return;
    var img = card.querySelector('.work-card__media img');
    var name = card.querySelector('.work-card__name');
    var desc = card.querySelector('.work-card__desc');
    var meta = card.querySelector('.work-card__meta');
    var badges = card.querySelector('.work-card__badges');

    if (modalImg && img) { modalImg.src = img.currentSrc || img.src; modalImg.alt = img.alt || ''; }
    if (modalTitle && name) modalTitle.textContent = name.textContent;
    if (modalDesc && desc) modalDesc.textContent = desc.textContent;
    if (modalMeta && meta) modalMeta.textContent = meta.textContent;
    if (modalBadges && badges) modalBadges.innerHTML = badges.innerHTML;
    if (modalPrice) modalPrice.textContent = card.getAttribute('data-price') || 'Бесплатно';
    if (modalDownload) modalDownload.href = card.getAttribute('data-pdf') || '#';

    lastFocused = document.activeElement;
    modal.classList.remove('is-hidden');
    document.body.classList.add('modal-open');
    var closeBtn = modal.querySelector('.product-modal__close');
    if (closeBtn) closeBtn.focus();
  }

  function closeProduct() {
    if (!modal || modal.classList.contains('is-hidden')) return;
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

  if (modal) {
    Array.prototype.forEach.call(modal.querySelectorAll('[data-close]'), function (el) {
      el.addEventListener('click', closeProduct);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeProduct();
    });
  }

  /* ---------- Текущий год в футере ---------- */
  var yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- Неактивные ссылки-заглушки (Telegram, прототип, кабинет) ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('a[aria-disabled="true"]'), function (link) {
    link.addEventListener('click', function (e) { e.preventDefault(); });
  });
})();
