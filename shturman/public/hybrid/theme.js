// Переключатель темы для макетов гибрида.
(function () {
  'use strict';
  var root = document.documentElement;
  var btn = document.getElementById('tt');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var dark = root.getAttribute('data-theme') === 'dark';
    root.setAttribute('data-theme', dark ? 'light' : 'dark');
    btn.textContent = dark ? 'Тема: день ◑' : 'Тема: ночь ◐';
  });
})();
