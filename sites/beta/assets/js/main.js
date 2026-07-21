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
    if (e.key === 'Escape' && menu.classList.contains('is-open')) {
      closeMenu();
      toggle.focus();
    }
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
      if ('inert' in sticky) sticky.inert = !show; /* спрятанная панель недоступна и с клавиатуры */
    }
    new IntersectionObserver(function (entries) {
      heroVisible = entries[0].isIntersecting; syncSticky();
    }, { threshold: 0.1 }).observe(hero);
    new IntersectionObserver(function (entries) {
      requestVisible = entries[0].isIntersecting; syncSticky();
    }, { threshold: 0.05 }).observe(request);
  }

  /* ---------- Калькулятор сметы: три шага → вилка → заявка ---------- */
  var calc = document.getElementById('calcForm');
  if (calc) {
    var calcSteps = calc.querySelectorAll('.calc__step');
    var calcDots = calc.querySelectorAll('.calc__dot');
    var calcLive = document.getElementById('calcStepStatus');
    var calcResult = calc.querySelector('.calc__result');
    var calcNav = calc.querySelector('.calc__nav');
    var calcBack = document.getElementById('calcBack');
    var calcNext = document.getElementById('calcNext');
    var calcError = document.getElementById('calcError');
    var calcRange = document.getElementById('calcRange');
    var calcNote = document.getElementById('calcNote');
    var calcStep = 0;
    var lastEstimate = null;

    var fmtRub = function (n) {
      return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
    };
    var round5k = function (n) { return Math.round(n / 5000) * 5000; };

    var showCalcStep = function (i) {
      calcStep = i;
      calcSteps.forEach(function (s, idx) { s.hidden = idx !== i; });
      calcDots.forEach(function (d, idx) { d.classList.toggle('is-active', idx <= i); });
      calcResult.hidden = true;
      calcNav.hidden = false;
      calcBack.hidden = i === 0;
      calcNext.textContent = i === calcSteps.length - 1 ? 'Показать расчёт' : 'Далее';
      calcLive.textContent = 'Шаг ' + (i + 1) + ' из ' + calcSteps.length;
    };

    var calcEstimate = function () {
      var size = calc.querySelector('input[name="calcSize"]:checked');
      var scopes = Array.prototype.slice.call(calc.querySelectorAll('input[name="calcScope"]:checked'));
      var palette = calc.querySelector('input[name="calcPalette"]:checked');
      var low = 0;
      scopes.forEach(function (s) {
        var factor = parseFloat(size.getAttribute('data-' + s.getAttribute('data-scale')));
        low += parseInt(s.getAttribute('data-base'), 10) * factor;
      });
      /* округляем до 5 000, но не даём вилке упасть ниже честной суммы цен «от» */
      var raw = low;
      low = round5k(low);
      if (low < raw) low = Math.round(raw / 1000) * 1000;
      return {
        low: low,
        high: round5k(low * 1.35),
        sizeLabel: size.getAttribute('data-label'),
        scopes: scopes.map(function (s) { return s.value; }),
        palette: palette.value
      };
    };

    calcNext.addEventListener('click', function () {
      if (calcStep === 1) {
        var any = calc.querySelector('input[name="calcScope"]:checked');
        calcError.hidden = !!any;
        if (!any) {
          calcLive.textContent = 'Выберите хотя бы одно направление';
          return;
        }
      }
      if (calcStep < calcSteps.length - 1) {
        showCalcStep(calcStep + 1);
        return;
      }
      /* финальный шаг: считаем и показываем вилку */
      lastEstimate = calcEstimate();
      calcSteps.forEach(function (s) { s.hidden = true; });
      calcNav.hidden = true;
      calcDots.forEach(function (d) { d.classList.add('is-active'); });
      calcRange.textContent = fmtRub(lastEstimate.low) + ' — ' + fmtRub(lastEstimate.high);
      calcNote.textContent = 'Свадьба: ' + lastEstimate.sizeLabel + '; оформляем: ' +
        lastEstimate.scopes.join(', ').toLowerCase() + '; палитра: «' + lastEstimate.palette +
        '». Это честная вилка, а не оферта: точную смету зафиксируем в договоре — и она не вырастет ни на рубль.';
      calcResult.hidden = false;
      calcLive.textContent = 'Расчёт готов: ' + calcRange.textContent;
      calcResult.focus();
    });

    calcBack.addEventListener('click', function () {
      if (calcStep > 0) showCalcStep(calcStep - 1);
    });

    document.getElementById('calcReset').addEventListener('click', function () {
      showCalcStep(0);
    });

    /* перенос расчёта в форму заявки: сообщение, бюджет и чекбоксы уже заполнены */
    document.getElementById('calcToRequest').addEventListener('click', function () {
      if (!lastEstimate) return;
      document.getElementById('fMsg').value = 'Расчёт из калькулятора: свадьба ' + lastEstimate.sizeLabel +
        '; оформляем: ' + lastEstimate.scopes.join(', ').toLowerCase() +
        '; палитра: «' + lastEstimate.palette + '». Предварительная вилка: ' +
        fmtRub(lastEstimate.low) + ' — ' + fmtRub(lastEstimate.high) + '.';
      var mid = (lastEstimate.low + lastEstimate.high) / 2;
      document.getElementById('fBudget').selectedIndex =
        mid < 100000 ? 1 : mid < 250000 ? 2 : mid < 450000 ? 3 : 4;
      Array.prototype.forEach.call(document.querySelectorAll('#requestForm input[name="scope"]'), function (box) {
        box.checked = lastEstimate.scopes.indexOf(box.value) !== -1;
      });
      document.getElementById('request').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
      document.getElementById('fName').focus({ preventScroll: true });
    });
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
