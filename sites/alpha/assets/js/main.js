/* АМАРАНТ — студия свадебной флористики.
   Один IIFE, без зависимостей. Все анимационные ветки уважают prefers-reduced-motion. */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ===== Мобильное меню ===== */
  var toggle = document.querySelector('.nav__toggle');
  var menu = document.getElementById('nav-menu');

  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.setAttribute('aria-label', open ? 'Открыть меню' : 'Закрыть меню');
      menu.classList.toggle('is-open', !open);
    });

    // Закрываем меню при переходе по якорю
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Открыть меню');
        menu.classList.remove('is-open');
      }
    });

    // Закрытие по Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) {
        toggle.setAttribute('aria-expanded', 'false');
        menu.classList.remove('is-open');
        toggle.focus();
      }
    });
  }

  /* ===== Scroll-reveal ===== */
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
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealNodes.forEach(function (n) { io.observe(n); });
  }

  /* ===== Sticky CTA на мобильном: показываем после hero, прячем у формы ===== */
  var stickyCta = document.getElementById('sticky-cta');
  var hero = document.querySelector('.hero');
  var request = document.getElementById('request');

  if (stickyCta && hero && request && 'IntersectionObserver' in window) {
    var heroVisible = true;
    var requestVisible = false;

    var syncCta = function () {
      stickyCta.classList.toggle('is-shown', !heroVisible && !requestVisible);
    };

    new IntersectionObserver(function (entries) {
      heroVisible = entries[0].isIntersecting;
      syncCta();
    }, { threshold: 0.15 }).observe(hero);

    new IntersectionObserver(function (entries) {
      requestVisible = entries[0].isIntersecting;
      syncCta();
    }, { threshold: 0.1 }).observe(request);
  }

  /* ===== Форма заявки (демо-режим: без бэкенда) ===== */
  var form = document.getElementById('rsvp-form');

  if (form) {
    var status = form.querySelector('.form__status');
    var phoneRe = /^[+\d][\d\s()\-]{9,17}$/;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      // honeypot: боты заполняют скрытое поле
      if (form.elements.website && form.elements.website.value) return;

      var name = form.elements.name;
      var phone = form.elements.phone;
      var ok = true;

      [name, phone].forEach(function (field) {
        field.removeAttribute('aria-invalid');
      });

      if (!name.value.trim()) {
        name.setAttribute('aria-invalid', 'true');
        ok = false;
      }
      if (!phoneRe.test(phone.value.trim())) {
        phone.setAttribute('aria-invalid', 'true');
        ok = false;
      }

      if (!ok) {
        status.textContent = 'Проверьте имя и телефон — без них мы не сможем перезвонить.';
        status.classList.add('is-error');
        (name.getAttribute('aria-invalid') ? name : phone).focus();
        return;
      }

      status.classList.remove('is-error');
      status.textContent = 'Спасибо! Заявка принята — вернёмся с оценкой бюджета в течение рабочего дня.';
      form.reset();
    });
  }
})();
