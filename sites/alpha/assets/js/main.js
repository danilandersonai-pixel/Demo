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

  /* ===== «Прорисовка» золотых ветвей hero =====
     Прогрессивное улучшение: ставим pathLength="1" и класс анимации из JS,
     поэтому без JS или при prefers-reduced-motion ветви просто видны сразу. */
  if (!reduceMotion) {
    document.querySelectorAll('.hero__branch').forEach(function (svg) {
      svg.querySelectorAll('path, ellipse, circle').forEach(function (el, i) {
        el.setAttribute('pathLength', '1');
        el.style.setProperty('--draw-delay', (i * 110) + 'ms');
        el.classList.add('anim-draw');
      });
    });
  }

  /* ===== Scrollspy: подсветка активного пункта меню ===== */
  var spyLinks = {};
  document.querySelectorAll('.nav__menu a[href^="#"]').forEach(function (a) {
    spyLinks[a.getAttribute('href').slice(1)] = a;
  });

  if ('IntersectionObserver' in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = spyLinks[entry.target.id];
        if (!link) return;
        if (entry.isIntersecting) {
          Object.keys(spyLinks).forEach(function (id) {
            spyLinks[id].removeAttribute('aria-current');
          });
          link.setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '-35% 0px -55% 0px' });

    Object.keys(spyLinks).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) spy.observe(section);
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
      var show = !heroVisible && !requestVisible;
      stickyCta.classList.toggle('is-shown', show);
      stickyCta.setAttribute('aria-hidden', String(!show));
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

  /* ===== Калькулятор сметы ===== */
  var estimator = document.getElementById('estimator');

  if (estimator) {
    var PRICES = { bouquet: 12000, ceremony: 90000, banquet: 150000 };
    var GUEST_BASE = 40;      // до 40 гостей — в базовой цене банкета
    var GUEST_EXTRA = 2000;   // за каждого гостя сверх базы
    var FULL_DISCOUNT = 0.9;  // −10% на монтажную часть (≈ треть сметы)
    var MOUNT_SHARE = 0.3;

    var scopeInputs = estimator.querySelectorAll('input[name="est-scope"]');
    var guestsInput = document.getElementById('est-guests');
    var guestsOut = document.getElementById('est-guests-out');
    var guestsRow = guestsInput.closest('.est__row');
    var styleSelect = document.getElementById('est-style');
    var totalOut = document.getElementById('est-total');
    var noteOut = document.getElementById('est-note');

    var fmt = function (n) {
      // округляем до тысячи — смета-ориентир не притворяется точной
      return (Math.round(n / 1000) * 1000).toLocaleString('ru-RU') + ' ₽';
    };

    var readScope = function () {
      var scope = {};
      scopeInputs.forEach(function (input) { scope[input.value] = input.checked; });
      return scope;
    };

    var calc = function () {
      var scope = readScope();
      var guests = Number(guestsInput.value);
      var mult = Number(styleSelect.value);

      guestsOut.textContent = String(guests);
      guestsInput.disabled = !scope.banquet;
      guestsRow.classList.toggle('is-muted', !scope.banquet);

      var total = 0;
      if (scope.bouquet) total += PRICES.bouquet;
      if (scope.ceremony) total += PRICES.ceremony;
      if (scope.banquet) total += PRICES.banquet + Math.max(0, guests - GUEST_BASE) * GUEST_EXTRA;

      if (!total) {
        totalOut.textContent = '—';
        noteOut.textContent = 'Отметьте хотя бы одно направление, и мы посчитаем вилку.';
        return;
      }

      total *= mult;

      var full = scope.bouquet && scope.ceremony && scope.banquet;
      if (full) {
        total = total * (1 - MOUNT_SHARE) + total * MOUNT_SHARE * FULL_DISCOUNT;
      }

      totalOut.textContent = fmt(total) + ' — ' + fmt(total * 1.15);
      noteOut.textContent = full
        ? 'Скидка 10% на монтаж за полное оформление уже учтена.'
        : 'Верхняя граница — запас на сложные конструкции и логистику.';
    };

    estimator.addEventListener('input', calc);
    estimator.addEventListener('change', calc);
    calc();

    /* Перенос расчёта в форму заявки */
    document.getElementById('est-to-form').addEventListener('click', function () {
      var scope = readScope();
      var parts = [];
      if (scope.bouquet) parts.push('букет невесты');
      if (scope.ceremony) parts.push('церемония');
      if (scope.banquet) parts.push('банкет на ' + guestsInput.value + ' гостей');

      var styleName = styleSelect.options[styleSelect.selectedIndex].text.split(' — ')[0];
      var summary = parts.length
        ? 'Посчитали на сайте: ' + parts.join(' + ') + ', палитра «' + styleName +
          '». Предварительная вилка: ' + totalOut.textContent + '.'
        : '';

      var requestForm = document.getElementById('rsvp-form');
      if (summary && requestForm) {
        requestForm.elements.message.value = summary;
      }

      var requestSection = document.getElementById('request');
      requestSection.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
      setTimeout(function () {
        if (requestForm) requestForm.elements.name.focus({ preventScroll: true });
      }, reduceMotion ? 0 : 600);
    });
  }

  /* ===== Форма заявки (демо-режим: без бэкенда) ===== */
  var form = document.getElementById('rsvp-form');

  if (form) {
    var status = form.querySelector('.form__status');
    var phoneRe = /^[+\d][\d\s()\-]{9,17}$/;

    var setFieldError = function (field, errId, bad) {
      var err = document.getElementById(errId);
      if (bad) {
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', errId);
        if (err) err.hidden = false;
      } else {
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');
        if (err) err.hidden = true;
      }
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      // honeypot: боты заполняют скрытое поле
      if (form.elements.website && form.elements.website.value) return;

      var name = form.elements.name;
      var phone = form.elements.phone;

      var badName = !name.value.trim();
      var badPhone = !phoneRe.test(phone.value.trim());
      setFieldError(name, 'err-name', badName);
      setFieldError(phone, 'err-phone', badPhone);

      if (badName || badPhone) {
        status.textContent = 'Проверьте отмеченные поля — без них мы не сможем перезвонить.';
        status.classList.add('is-error');
        (badName ? name : phone).focus();
        return;
      }

      status.classList.remove('is-error');
      status.textContent = 'Спасибо! Заявка принята — вернёмся с оценкой бюджета в течение рабочего дня.';
      form.reset();
    });
  }
})();
