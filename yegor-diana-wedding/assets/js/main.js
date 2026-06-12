/* ============================================================
   Егор & Диана — свадебное приглашение
   Ванильный JS: интро, таймер, reveal, parallax, навигация, форма
   ============================================================ */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ----------------------------------------------------------
     1. Интро-видео: Play / Skip / ended → fade overlay
     ---------------------------------------------------------- */
  var intro = document.getElementById('intro');
  var introVideo = document.getElementById('introVideo');
  var introPlay = document.getElementById('introPlay');
  var introSkip = document.getElementById('introSkip');

  function lockScroll() {
    document.body.classList.add('no-scroll');
  }

  function unlockScroll() {
    document.body.classList.remove('no-scroll');
  }

  function closeIntro() {
    if (!intro || intro.classList.contains('intro--hidden')) return;
    intro.classList.add('intro--hidden');
    if (introVideo) {
      try {
        introVideo.pause();
      } catch (e) { /* noop */ }
    }
    unlockScroll();
    /* Полностью убрать оверлей после fade-out */
    window.setTimeout(function () {
      if (intro && intro.parentNode) {
        intro.parentNode.removeChild(intro);
      }
    }, 1300);
  }

  if (intro && introVideo) {
    lockScroll();

    introVideo.addEventListener('ended', closeIntro);

    /* Фолбэк: если видео не загрузилось — постер/градиент */
    introVideo.addEventListener('error', function () {
      intro.classList.add('video-failed');
    }, true);

    var lastSource = introVideo.querySelector('source:last-of-type');
    if (lastSource) {
      lastSource.addEventListener('error', function () {
        intro.classList.add('video-failed');
      });
    }

    if (introPlay) {
      introPlay.addEventListener('click', function () {
        introVideo.muted = false;
        introVideo.currentTime = 0;
        var playPromise = introVideo.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(function () {
            /* Если запуск со звуком запрещён — играем без звука */
            introVideo.muted = true;
            introVideo.play().catch(function () {
              intro.classList.add('video-failed');
            });
          });
        }
      });
    }

    if (introSkip) {
      introSkip.addEventListener('click', closeIntro);
    }

    /* Esc тоже пропускает интро */
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeIntro();
    });
  }

  /* ----------------------------------------------------------
     2. Навигация: фон при скролле, мобильное меню,
        плавный скролл, подсветка активного пункта
     ---------------------------------------------------------- */
  var nav = document.getElementById('siteNav');
  var navToggle = document.getElementById('navToggle');
  var navMenu = document.getElementById('navMenu');
  var navLinks = navMenu ? Array.prototype.slice.call(navMenu.querySelectorAll('.nav__link')) : [];

  function onNavScroll() {
    if (!nav) return;
    nav.classList.toggle('nav--scrolled', window.scrollY > 24);
  }

  window.addEventListener('scroll', onNavScroll, { passive: true });
  onNavScroll();

  function closeMenu() {
    if (!nav) return;
    nav.classList.remove('nav--open');
    if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
  }

  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      var open = nav.classList.toggle('nav--open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      navToggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    });
  }

  /* Плавный скролл по всем якорным ссылкам */
  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[href^="#"]');
    if (!link) return;
    var target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    closeMenu();
    target.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start'
    });
  });

  /* Подсветка активного пункта меню */
  if ('IntersectionObserver' in window && navLinks.length) {
    var sectionByLink = {};
    navLinks.forEach(function (link) {
      var section = document.querySelector(link.getAttribute('href'));
      if (section) sectionByLink[section.id] = link;
    });

    var activeObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = sectionByLink[entry.target.id];
        if (!link) return;
        if (entry.isIntersecting) {
          navLinks.forEach(function (l) { l.classList.remove('is-active'); });
          link.classList.add('is-active');
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });

    Object.keys(sectionByLink).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) activeObserver.observe(section);
    });
  }

  /* ----------------------------------------------------------
     3. Scroll-reveal через IntersectionObserver
     ---------------------------------------------------------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    revealEls.forEach(function (el, index) {
      el.style.setProperty('--reveal-delay', (index % 4) * 0.08 + 's');
      revealObserver.observe(el);
    });
  }

  /* ----------------------------------------------------------
     4. Лёгкий parallax (hero + галерея) через rAF
     ---------------------------------------------------------- */
  var parallaxEls = Array.prototype.slice.call(document.querySelectorAll('[data-parallax]'));

  if (!reduceMotion && parallaxEls.length) {
    var ticking = false;

    var applyParallax = function () {
      var viewportCenter = window.innerHeight / 2;
      parallaxEls.forEach(function (el) {
        /* Не трогаем элементы, пока не завершился их scroll-reveal */
        if (el.classList.contains('reveal') && !el.classList.contains('is-visible')) return;
        var rect = el.getBoundingClientRect();
        if (rect.bottom < -200 || rect.top > window.innerHeight + 200) return;
        var factor = parseFloat(el.getAttribute('data-parallax')) || 0;
        var offset = (rect.top + rect.height / 2 - viewportCenter) * factor;
        el.style.transform =
          'translateY(' + offset.toFixed(1) + 'px) rotate(var(--tilt, 0deg))';
      });
      ticking = false;
    };

    var requestParallax = function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(applyParallax);
    };

    window.addEventListener('scroll', requestParallax, { passive: true });
    window.addEventListener('resize', requestParallax, { passive: true });
    requestParallax();
  }

  /* ----------------------------------------------------------
     5. Обратный отсчёт до 26.08.2026, 10:00 (локальное время)
     ---------------------------------------------------------- */
  var target = new Date(2026, 7, 26, 10, 0, 0); // месяцы с нуля: 7 = август
  var cd = {
    days: document.getElementById('cdDays'),
    hours: document.getElementById('cdHours'),
    minutes: document.getElementById('cdMinutes'),
    seconds: document.getElementById('cdSeconds')
  };

  function pad(value, size) {
    var str = String(value);
    while (str.length < size) str = '0' + str;
    return str;
  }

  function setDigit(el, value) {
    if (!el || el.textContent === value) return;
    if (reduceMotion) {
      el.textContent = value;
      return;
    }
    el.classList.add('tick');
    window.setTimeout(function () {
      el.textContent = value;
      el.classList.remove('tick');
    }, 150);
  }

  function updateCountdown() {
    var diff = Math.max(0, target.getTime() - Date.now());
    var totalSeconds = Math.floor(diff / 1000);
    var days = Math.floor(totalSeconds / 86400);
    var hours = Math.floor((totalSeconds % 86400) / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;

    setDigit(cd.days, pad(days, 3));
    setDigit(cd.hours, pad(hours, 2));
    setDigit(cd.minutes, pad(minutes, 2));
    setDigit(cd.seconds, pad(seconds, 2));
  }

  if (cd.days && cd.hours && cd.minutes && cd.seconds) {
    updateCountdown();
    window.setInterval(updateCountdown, 1000);
  }

  /* ----------------------------------------------------------
     6. Форма RSVP: только визуал, без отправки на сервер
     ---------------------------------------------------------- */
  var form = document.getElementById('guestForm');
  var result = document.getElementById('result');

  if (form) {
    /* Показ поля «имя гостя +1» при выборе «приду с парой» */
    var plusOneRadios = form.querySelectorAll('input[name="plusOne"]');
    Array.prototype.forEach.call(plusOneRadios, function (radio) {
      radio.addEventListener('change', function () {
        form.classList.toggle('form--plusone', radio.value === 'yes' && radio.checked);
      });
    });

    function clearFieldError(wrapper) {
      wrapper.classList.remove('is-invalid');
    }

    function validate() {
      var valid = true;

      /* ФИО */
      var nameInput = form.querySelector('#guestName');
      var nameRow = nameInput.closest('.form__row');
      if (!nameInput.value.trim()) {
        nameRow.classList.add('is-invalid');
        valid = false;
      } else {
        clearFieldError(nameRow);
      }

      /* Присутствие */
      var attendanceChecked = form.querySelector('input[name="attendance"]:checked');
      var attendanceFieldset = form.querySelector('input[name="attendance"]').closest('.form__fieldset');
      if (!attendanceChecked) {
        attendanceFieldset.classList.add('is-invalid');
        valid = false;
      } else {
        clearFieldError(attendanceFieldset);
      }

      return valid;
    }

    /* Снимать подсветку ошибки по мере исправления */
    form.addEventListener('input', function (event) {
      var wrapper = event.target.closest('.is-invalid');
      if (wrapper) clearFieldError(wrapper);
    });
    form.addEventListener('change', function (event) {
      var wrapper = event.target.closest('.is-invalid');
      if (wrapper) clearFieldError(wrapper);
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      /* Honeypot: боты заполняют скрытое поле — молча выходим */
      var honeypot = form.querySelector('#website');
      if (honeypot && honeypot.value) return;

      if (!validate()) {
        var firstInvalid = form.querySelector('.is-invalid');
        if (firstInvalid) {
          firstInvalid.scrollIntoView({
            behavior: reduceMotion ? 'auto' : 'smooth',
            block: 'center'
          });
        }
        return;
      }

      if (result) {
        result.hidden = false;
        result.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'center'
        });
      }

      var submitBtn = form.querySelector('.form__submit');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Ответ отправлен';
        submitBtn.style.opacity = '.55';
        submitBtn.style.cursor = 'default';
      }
    });
  }
})();
