/* Амарант — вся клиентская логика. Один IIFE, без зависимостей. */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Навигация: фон при скролле + мобильное меню ---------- */
  var topbar = document.getElementById('topbar');
  var toggle = document.getElementById('navToggle');
  var menu = document.getElementById('navMenu');

  function onScrollTopbar() {
    topbar.classList.toggle('is-scrolled', window.scrollY > 24);
  }
  onScrollTopbar();
  window.addEventListener('scroll', onScrollTopbar, { passive: true });

  function closeMenu() {
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Открыть меню');
  }
  toggle.addEventListener('click', function () {
    var open = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  });
  menu.addEventListener('click', function (e) {
    if (e.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });

  /* ---------- Scroll-reveal (IntersectionObserver) ---------- */
  var revealNodes = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealNodes.forEach(function (n) { n.classList.add('is-visible'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealNodes.forEach(function (n, i) {
      n.style.setProperty('--reveal-delay', (Math.min(i % 4, 3) * 0.08) + 's');
      io.observe(n);
    });
  }

  /* ---------- Липкий CTA: показывать после hero, прятать у формы ---------- */
  var sticky = document.getElementById('stickyCta');
  var hero = document.getElementById('hero');
  var request = document.getElementById('request');
  if (sticky && 'IntersectionObserver' in window) {
    var heroVisible = true, requestVisible = false;
    function syncSticky() {
      var show = !heroVisible && !requestVisible;
      sticky.classList.toggle('is-shown', show);
      sticky.setAttribute('aria-hidden', String(!show));
    }
    new IntersectionObserver(function (entries) {
      heroVisible = entries[0].isIntersecting; syncSticky();
    }, { threshold: 0.1 }).observe(hero);
    new IntersectionObserver(function (entries) {
      requestVisible = entries[0].isIntersecting; syncSticky();
    }, { threshold: 0.05 }).observe(request);
  }

  /* ---------- Форма заявки (демо-режим: без бэкенда) ---------- */
  var form = document.getElementById('requestForm');
  var status = document.getElementById('formStatus');

  function setStatus(text, ok) {
    status.textContent = text;
    status.classList.toggle('is-ok', !!ok);
    status.classList.toggle('is-err', !ok && text !== '');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    /* honeypot: боты заполняют скрытое поле */
    if (form.elements.website.value) return;

    var name = form.elements.name;
    var phone = form.elements.phone;
    var valid = true;

    [name, phone].forEach(function (field) {
      var bad = field.value.trim().length < 2;
      field.setAttribute('aria-invalid', String(bad));
      if (bad) valid = false;
    });

    if (!valid) {
      setStatus('Пожалуйста, укажите имя и контакт — иначе мы не сможем ответить.', false);
      (name.getAttribute('aria-invalid') === 'true' ? name : phone).focus();
      return;
    }

    var btn = form.querySelector('.form__submit');
    var firstName = name.value.trim().split(/\s+/)[0];
    btn.disabled = true;
    btn.textContent = 'Отправляем…';

    /* Демо-режим: имитация отправки. Для боевого режима подключите
       endpoint (Formspree/Telegram-бот) вместо setTimeout. */
    setTimeout(function () {
      form.reset();
      btn.disabled = false;
      btn.textContent = 'Отправить заявку';
      setStatus('Спасибо, ' + firstName + '! Заявка у нас — ответим в течение 2 часов.', true);
    }, reduceMotion ? 0 : 600);
  });
})();
