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

  /* ---------- Фильтр «Мои работы» по направлениям ---------- */
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip[data-cat]'));
  var cards = Array.prototype.slice.call(document.querySelectorAll('.work-card[data-cat]'));

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var cat = chip.getAttribute('data-cat');
      chips.forEach(function (c) { c.classList.toggle('is-active', c === chip); });
      cards.forEach(function (card) {
        card.classList.toggle('is-hidden', cat !== 'Все' && card.getAttribute('data-cat') !== cat);
      });
    });
  });

  /* ---------- Текущий год в футере ---------- */
  var yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- Неактивные ссылки-заглушки (Telegram, прототип, кабинет) ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('a[aria-disabled="true"]'), function (link) {
    link.addEventListener('click', function (e) { e.preventDefault(); });
  });
})();
