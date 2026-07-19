/* Дарья Пронина — сайт учителя. Вся клиентская логика: тема, фильтр работ, год. */
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

  /* ---------- Фильтр «Мои работы» + «Показать ещё» ---------- */
  var WORKS_LIMIT = 4; // сколько карточек видно до раскрытия
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip[data-cat]'));
  var cards = Array.prototype.slice.call(document.querySelectorAll('.work-card[data-cat]'));
  var moreWrap = document.getElementById('works-more');
  var moreBtn = document.getElementById('works-more-btn');
  var activeCat = 'Все';
  var expanded = false;

  function worksPlural(n) {
    var d10 = n % 10, d100 = n % 100;
    if (d10 === 1 && d100 !== 11) return 'работу';
    if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'работы';
    return 'работ';
  }

  function applyWorksFilter() {
    var matched = cards.filter(function (card) {
      return activeCat === 'Все' || card.getAttribute('data-cat') === activeCat;
    });
    cards.forEach(function (card) { card.classList.add('is-hidden'); });
    matched.forEach(function (card, i) {
      card.classList.toggle('is-hidden', !expanded && i >= WORKS_LIMIT);
    });
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

  if (moreBtn) {
    moreBtn.addEventListener('click', function () {
      expanded = true;
      applyWorksFilter();
    });
  }

  applyWorksFilter();

  /* ---------- Текущий год в футере ---------- */
  var yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- Неактивные ссылки-заглушки (Telegram, прототип, кабинет) ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('a[aria-disabled="true"]'), function (link) {
    link.addEventListener('click', function (e) { e.preventDefault(); });
  });
})();
