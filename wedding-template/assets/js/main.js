/* ============================================================
   Егор & Диана — свадебное приглашение
   Ванильный JS: прелоадер, интро, таймер, reveal, parallax,
   навигация, календарь (.ics), лайтбокс, форма RSVP
   ============================================================ */
// Formspree endpoint берётся из config.js (rsvp.endpoint); фолбэк — плейсхолдер (демо-режим)
const RSVP_ENDPOINT = (window.WEDDING && window.WEDDING.rsvp && window.WEDDING.rsvp.endpoint) || "https://formspree.io/f/YOUR_FORM_ID";

(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Конфиг из config.js (с безопасными фолбэками на «Егор & Диана») */
  var CFG = window.WEDDING || {};
  var CFG_EVENT = CFG.event || {};
  var CFG_COUPLE = CFG.couple || {};
  var CFG_RSVP = CFG.rsvp || {};

  /* Дата+время события из конфига → объект Date (локальное время).
     Фолбэк: 26.08.2026 10:00. */
  function buildEventDate() {
    var iso = CFG_EVENT.dateISO || '2026-08-26';
    var time = CFG_EVENT.startTime || '10:00';
    var d = String(iso).split('-');
    var t = String(time).split(':');
    var y = +d[0], mo = +d[1], da = +d[2];
    var hh = +t[0] || 0, mm = +t[1] || 0;
    if (!y || !mo || !da) return new Date(2026, 7, 26, 10, 0, 0);
    return new Date(y, mo - 1, da, hh, mm, 0);
  }

  /* UTC-метка YYYYMMDDTHHMMSSZ из локального времени события,
     минус utcOffset часов. */
  function toUtcStamp(date) {
    var off = (CFG_EVENT.utcOffset != null ? CFG_EVENT.utcOffset : 3);
    var u = new Date(date.getTime() - off * 3600000);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return u.getUTCFullYear() + p(u.getUTCMonth() + 1) + p(u.getUTCDate()) +
      'T' + p(u.getUTCHours()) + p(u.getUTCMinutes()) + p(u.getUTCSeconds()) + 'Z';
  }

  /* ----------------------------------------------------------
     0a. Имена в Hero: разбивка на слова (амперсанд — отдельный
         span) + стаггер-проявление. Запуск — после закрытия
         интро (или скрытия прелоадера, если интро нет).
     ---------------------------------------------------------- */
  var heroNames = document.querySelector('.hero__names');
  var heroNamesPlayed = false;

  function playHeroNames() {
    if (!heroNames || heroNamesPlayed) return;
    heroNamesPlayed = true;
    heroNames.classList.add('hero__names--play');
  }

  if (heroNames && !reduceMotion) {
    /* Доступность: полный текст остаётся в aria-label заголовка */
    heroNames.setAttribute('aria-label', heroNames.textContent.replace(/\s+/g, ' ').trim());

    var heroFrag = document.createDocumentFragment();
    var heroWordIndex = 0;

    var makeHeroWord = function (content) {
      var word = document.createElement('span');
      word.className = 'name-word';
      word.setAttribute('aria-hidden', 'true');
      word.style.setProperty('--name-delay', (heroWordIndex * 0.07).toFixed(2) + 's');
      heroWordIndex += 1;
      if (typeof content === 'string') {
        word.textContent = content;
      } else {
        word.appendChild(content);
      }
      return word;
    };

    Array.prototype.slice.call(heroNames.childNodes).forEach(function (node) {
      if (node.nodeType === 3) {
        node.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            heroFrag.appendChild(document.createTextNode(' '));
          } else {
            heroFrag.appendChild(makeHeroWord(part));
          }
        });
      } else if (node.nodeType === 1) {
        /* Элементы (амперсанд) — отдельный span с сохранением стилей */
        heroFrag.appendChild(makeHeroWord(node));
      }
    });

    heroNames.textContent = '';
    heroNames.appendChild(heroFrag);
    heroNames.classList.add('hero__names--split');
  }

  /* Если на странице нет ни прелоадера, ни интро — играем сразу */
  if (!document.getElementById('preloader') && !document.getElementById('intro')) {
    playHeroNames();
  }

  /* ----------------------------------------------------------
     0. Прелоадер: показывается первым, исчезает по load,
        затем гостя встречает интро-видео
     ---------------------------------------------------------- */
  var preloader = document.getElementById('preloader');

  if (preloader) {
    var preloaderHidden = false;

    var hidePreloader = function () {
      if (preloaderHidden) return;
      preloaderHidden = true;
      preloader.classList.add('preloader--hidden');
      /* Если интро-оверлея нет, hero уже виден — запускаем имена */
      if (!document.getElementById('intro')) {
        playHeroNames();
      }
      window.setTimeout(function () {
        if (preloader.parentNode) {
          preloader.parentNode.removeChild(preloader);
        }
      }, reduceMotion ? 0 : 1000);
    };

    if (reduceMotion || document.readyState === 'complete') {
      hidePreloader();
    } else {
      window.addEventListener('load', function () {
        window.setTimeout(hidePreloader, 350);
      });
      /* Страховка: не держим гостя дольше 4,5 секунд */
      window.setTimeout(hidePreloader, 4500);
    }
  }

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
    /* Hero открылся — запускаем проявление имён */
    playHeroNames();
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

  var progressBar = document.querySelector('.scroll-progress__bar');

  function onNavScroll() {
    if (nav) {
      nav.classList.toggle('nav--scrolled', window.scrollY > 24);
    }
    /* Прогресс прокрутки: scaleX 0..1 */
    if (progressBar) {
      var scrollMax = document.documentElement.scrollHeight - window.innerHeight;
      var progress = scrollMax > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollMax)) : 0;
      progressBar.style.transform = 'scaleX(' + progress.toFixed(4) + ')';
    }
  }

  window.addEventListener('scroll', onNavScroll, { passive: true });
  window.addEventListener('resize', onNavScroll, { passive: true });
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
  var drawEls = Array.prototype.slice.call(document.querySelectorAll('.anim-draw'));

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.concat(drawEls).forEach(function (el) { el.classList.add('is-visible'); });
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

    /* «Прорисовка» разделителей — тем же обсервером */
    drawEls.forEach(function (el) {
      if (!el.classList.contains('reveal')) {
        revealObserver.observe(el);
      }
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
     4b. Атмосферный фон Hero: золотое боке (сырой WebGL, без
         библиотек). Декоративный слой за именами; параллакс
         поля — через uniform, НЕ через [data-parallax].
     ---------------------------------------------------------- */
  (function heroFx() {
    var canvas = document.querySelector('.hero__fx');
    var hero = document.querySelector('.hero');
    if (!canvas || !hero) return;

    var gl = null;
    var glOpts = { alpha: true, premultipliedAlpha: true, antialias: true };
    try {
      gl = canvas.getContext('webgl', glOpts) ||
           canvas.getContext('experimental-webgl', glOpts);
    } catch (e) { gl = null; }
    if (!gl) return; /* нет WebGL — Hero остаётся как прежде */

    /* Золото дизайн-системы: --gold, --gold-bright, тёплый акцент */
    var GOLD = [
      [0.843, 0.682, 0.388],
      [0.961, 0.851, 0.576],
      [0.725, 0.537, 0.314]
    ];
    var DPR = Math.min(window.devicePixelRatio || 1, 1.5);

    function particleCount() {
      var w = window.innerWidth;
      if (w < 620) return 34;
      if (w < 1100) return 50;
      return 68;
    }

    var vsSource = [
      'precision mediump float;',
      'attribute vec2 aSeed;',
      'attribute vec3 aParam;',   /* depth, speed, phase */
      'attribute vec3 aColor;',
      'uniform float uTime;',
      'uniform vec2 uPointer;',
      'uniform float uDpr;',
      'varying float vDepth;',
      'varying vec3 vColor;',
      'void main() {',
      '  float depth = aParam.x;',
      '  float speed = aParam.y;',
      '  float phase = aParam.z;',
      '  float t = uTime * 0.00009;',
      '  float y = fract(aSeed.y + t * speed);',
      '  float sway = sin((phase + t) * 6.2831) * 0.04 * depth;',
      '  float x = fract(aSeed.x + sway + t * speed * 0.18);',
      '  x += uPointer.x * 0.03 * depth;',
      '  y += uPointer.y * 0.03 * depth;',
      '  vec2 clip = vec2(x * 2.0 - 1.0, (1.0 - y) * 2.0 - 1.0);',
      '  gl_Position = vec4(clip, 0.0, 1.0);',
      '  gl_PointSize = (depth * 26.0 + 4.0) * uDpr;',
      '  vDepth = depth;',
      '  vColor = aColor;',
      '}'
    ].join('\n');

    var fsSource = [
      'precision mediump float;',
      'varying float vDepth;',
      'varying vec3 vColor;',
      'void main() {',
      '  vec2 c = gl_PointCoord - vec2(0.5);',
      '  float d = length(c);',
      '  if (d > 0.5) discard;',
      '  float core = smoothstep(0.5, 0.0, d);',
      '  float soft = pow(core, mix(2.4, 1.2, vDepth));',
      '  float alpha = soft * mix(0.10, 0.40, vDepth);',
      '  gl_FragColor = vec4(vColor * alpha, alpha);', /* premultiplied */
      '}'
    ].join('\n');

    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
      return sh;
    }

    var vs = compile(gl.VERTEX_SHADER, vsSource);
    var fs = compile(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    var aSeed = gl.getAttribLocation(prog, 'aSeed');
    var aParam = gl.getAttribLocation(prog, 'aParam');
    var aColor = gl.getAttribLocation(prog, 'aColor');
    var uTime = gl.getUniformLocation(prog, 'uTime');
    var uPointer = gl.getUniformLocation(prog, 'uPointer');
    var uDpr = gl.getUniformLocation(prog, 'uDpr');

    var N = particleCount();
    var seed = new Float32Array(N * 2);
    var param = new Float32Array(N * 3);
    var color = new Float32Array(N * 3);

    function rand(a, b) { return a + Math.random() * (b - a); }
    for (var i = 0; i < N; i++) {
      seed[i * 2] = Math.random();
      seed[i * 2 + 1] = Math.random();
      var depth = Math.pow(Math.random(), 1.5); /* больше дальних, мелких */
      param[i * 3] = depth;
      param[i * 3 + 1] = rand(0.08, 0.26);
      param[i * 3 + 2] = Math.random();
      var g = GOLD[(Math.random() * GOLD.length) | 0];
      var k = rand(0.85, 1.1);
      color[i * 3] = Math.min(1, g[0] * k);
      color[i * 3 + 1] = Math.min(1, g[1] * k);
      color[i * 3 + 2] = Math.min(1, g[2] * k);
    }

    function makeBuffer(data, loc, size) {
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    makeBuffer(seed, aSeed, 2);
    makeBuffer(param, aParam, 3);
    makeBuffer(color, aColor, 3);

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); /* premultiplied «over» */
    gl.uniform1f(uDpr, DPR);

    function resize() {
      var w = hero.clientWidth;
      var h = hero.clientHeight;
      canvas.width = Math.max(1, Math.round(w * DPR));
      canvas.height = Math.max(1, Math.round(h * DPR));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    /* Сглаженный параллакс поля по указателю / гироскопу */
    var tpx = 0, tpy = 0, px = 0, py = 0;
    function onPointer(e) {
      tpx = (e.clientX / window.innerWidth) * 2 - 1;
      tpy = (e.clientY / window.innerHeight) * 2 - 1;
    }
    function onOrient(e) {
      if (e.gamma == null || e.beta == null) return;
      tpx = Math.max(-1, Math.min(1, e.gamma / 30));
      tpy = Math.max(-1, Math.min(1, e.beta / 45));
    }

    function draw(t) {
      px += (tpx - px) * 0.05;
      py += (tpy - py) * 0.05;
      gl.uniform1f(uTime, t);
      gl.uniform2f(uPointer, px, py);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, N);
    }

    var rafId = null;
    var running = false;
    var heroVisible = true;
    function frame(t) {
      draw(t);
      rafId = window.requestAnimationFrame(frame);
    }
    function start() {
      if (running || reduceMotion) return;
      running = true;
      rafId = window.requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (rafId) { window.cancelAnimationFrame(rafId); rafId = null; }
    }

    resize();

    if (reduceMotion) {
      draw(0); /* один статичный кадр — без движения */
    } else {
      window.addEventListener('pointermove', onPointer, { passive: true });
      if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', onOrient, { passive: true });
      }
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            heroVisible = en.isIntersecting;
            if (heroVisible) start(); else stop();
          });
        }, { threshold: 0 });
        io.observe(hero);
      } else {
        start();
      }
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop();
        else if (heroVisible) start();
      });
    }

    var rt = null;
    window.addEventListener('resize', function () {
      if (rt) window.clearTimeout(rt);
      rt = window.setTimeout(function () {
        resize();
        if (reduceMotion) draw(0);
      }, 150);
    }, { passive: true });
  })();

  /* ----------------------------------------------------------
     5. Обратный отсчёт до 26.08.2026, 10:00 (локальное время)
     ---------------------------------------------------------- */
  var target = buildEventDate(); // дата+время из config.js (фолбэк 26.08.2026 10:00)
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

  function getRemaining() {
    var diff = Math.max(0, target.getTime() - Date.now());
    var totalSeconds = Math.floor(diff / 1000);
    return {
      days: Math.floor(totalSeconds / 86400),
      hours: Math.floor((totalSeconds % 86400) / 3600),
      minutes: Math.floor((totalSeconds % 3600) / 60),
      seconds: totalSeconds % 60
    };
  }

  function updateCountdown() {
    var remaining = getRemaining();
    setDigit(cd.days, pad(remaining.days, 3));
    setDigit(cd.hours, pad(remaining.hours, 2));
    setDigit(cd.minutes, pad(remaining.minutes, 2));
    setDigit(cd.seconds, pad(remaining.seconds, 2));
  }

  if (cd.days && cd.hours && cd.minutes && cd.seconds) {
    var countdownStarted = false;

    /* Штатный тик; гейт гарантирует ровно один интервал */
    var startCountdownTicker = function () {
      if (countdownStarted) return;
      countdownStarted = true;
      updateCountdown();
      window.setInterval(updateCountdown, 1000);
    };

    var countdownSection = document.getElementById('countdown');

    if (reduceMotion || !('IntersectionObserver' in window) || !countdownSection) {
      /* Фолбэк / reduced motion: прежнее поведение */
      startCountdownTicker();
    } else {
      var countUpStarted = false;

      /* Count-up: цифры «докручиваются» от 0 за ~1с с ease-out,
         затем стартует штатный интервал */
      var runCountUp = function () {
        if (countUpStarted || countdownStarted) return;
        countUpStarted = true;

        var finals = getRemaining();
        var duration = 1000;
        var startTime = null;

        var step = function (now) {
          if (countdownStarted) return;
          if (startTime === null) startTime = now;
          var t = Math.min(1, (now - startTime) / duration);
          var eased = 1 - Math.pow(1 - t, 3); /* ease-out cubic */
          cd.days.textContent = pad(Math.round(finals.days * eased), 3);
          cd.hours.textContent = pad(Math.round(finals.hours * eased), 2);
          cd.minutes.textContent = pad(Math.round(finals.minutes * eased), 2);
          cd.seconds.textContent = pad(Math.round(finals.seconds * eased), 2);
          if (t < 1) {
            window.requestAnimationFrame(step);
          } else {
            startCountdownTicker();
          }
        };

        window.requestAnimationFrame(step);
      };

      var countdownObserver = new IntersectionObserver(function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          runCountUp();
        });
      }, { threshold: 0.25 });

      countdownObserver.observe(countdownSection);
    }
  }

  /* ----------------------------------------------------------
     6. «Добавить в календарь»: генерация .ics через Blob
        (10:00–23:00 МСК = 07:00–20:00 UTC)
     ---------------------------------------------------------- */
  var icsButton = document.getElementById('icsDownload');
  var gcalLink = document.getElementById('gcalLink');

  /* Данные события из конфига (с фолбэками на «Егор & Диана») */
  var n1 = CFG_COUPLE.name1 || 'Егор';
  var n2 = CFG_COUPLE.name2 || 'Диана';
  var hashtag = CFG_COUPLE.hashtag || '#EgDiDa';

  var calStart = target;                                  /* локальное начало */
  var calEnd = (function () {
    var endTime = CFG_EVENT.endTime || '23:00';
    var t = String(endTime).split(':');
    var e = new Date(calStart.getTime());
    e.setHours(+t[0] || 0, +t[1] || 0, 0, 0);
    return e;
  })();

  var calStartUtc = toUtcStamp(calStart);
  var calEndUtc = toUtcStamp(calEnd);

  /* Сводка / место / описание; первая локация — основное место */
  var firstLoc = (CFG.locations && CFG.locations[0]) || {};
  var calSummary = 'Свадьба ' + n1 + ' и ' + n2;
  var calLocation = firstLoc.address || (CFG_EVENT.city || 'Санкт-Петербург');
  var calDescription = 'Приглашение на свадьбу ' + n1 + ' и ' + n2 + '. Хэштег ' + hashtag;

  /* Экранирование запятых для .ics (RFC 5545) */
  function icsEscape(s) { return String(s).replace(/,/g, '\\,'); }

  if (icsButton) {
    icsButton.addEventListener('click', function () {
      var dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      var ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Wedding Invitation//RU',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:wedding-' + calStartUtc + '@invitation',
        'DTSTAMP:' + dtstamp,
        'DTSTART:' + calStartUtc,
        'DTEND:' + calEndUtc,
        'SUMMARY:' + icsEscape(calSummary),
        'LOCATION:' + icsEscape(calLocation),
        'DESCRIPTION:' + icsEscape(calDescription),
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'wedding.ics';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
    });
  }

  /* Ссылка «Google Calendar»: TEMPLATE с UTC-метками */
  if (gcalLink) {
    var gcalHref = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(calSummary) +
      '&dates=' + calStartUtc + '/' + calEndUtc +
      '&location=' + encodeURIComponent(calLocation) +
      '&details=' + encodeURIComponent(calDescription);
    gcalLink.setAttribute('href', gcalHref);
  }

  /* ----------------------------------------------------------
     7. Лайтбокс: галерея + Love Story
     ---------------------------------------------------------- */
  var lightbox = document.getElementById('lightbox');
  var lightboxImg = document.getElementById('lightboxImg');
  var lightboxCaption = document.getElementById('lightboxCaption');
  var lightboxClose = document.getElementById('lightboxClose');
  var lightboxPrev = document.getElementById('lightboxPrev');
  var lightboxNext = document.getElementById('lightboxNext');

  if (lightbox && lightboxImg && lightboxClose && lightboxPrev && lightboxNext) {
    var zoomables = Array.prototype.slice.call(
      document.querySelectorAll('.gallery__card img, .story__photo img')
    );
    var currentIndex = -1;
    var lastFocused = null;

    var renderSlide = function (index) {
      var total = zoomables.length;
      currentIndex = ((index % total) + total) % total;
      var img = zoomables[currentIndex];
      lightboxImg.src = img.currentSrc || img.src;
      lightboxImg.alt = img.alt || '';
      if (lightboxCaption) {
        lightboxCaption.textContent =
          (img.alt || '') + ' · ' + (currentIndex + 1) + ' / ' + total;
      }
    };

    var openLightbox = function (index) {
      lastFocused = document.activeElement;
      renderSlide(index);
      lightbox.hidden = false;
      lockScroll();
      lightboxClose.focus();
    };

    var closeLightbox = function () {
      lightbox.hidden = true;
      lightboxImg.src = '';
      unlockScroll();
      if (lastFocused && typeof lastFocused.focus === 'function') {
        lastFocused.focus();
      }
    };

    zoomables.forEach(function (img, index) {
      img.classList.add('is-zoomable');
      img.setAttribute('tabindex', '0');
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', 'Открыть фото: ' + (img.alt || 'фотография'));

      img.addEventListener('click', function () {
        if (img.classList.contains('img-failed')) return;
        openLightbox(index);
      });

      img.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (img.classList.contains('img-failed')) return;
        openLightbox(index);
      });
    });

    lightboxClose.addEventListener('click', closeLightbox);
    lightboxPrev.addEventListener('click', function () { renderSlide(currentIndex - 1); });
    lightboxNext.addEventListener('click', function () { renderSlide(currentIndex + 1); });

    /* Клик по затемнённому фону закрывает просмотр */
    lightbox.addEventListener('click', function (event) {
      if (event.target === lightbox) closeLightbox();
    });

    document.addEventListener('keydown', function (event) {
      if (lightbox.hidden) return;
      if (event.key === 'Escape') {
        closeLightbox();
      } else if (event.key === 'ArrowLeft') {
        renderSlide(currentIndex - 1);
      } else if (event.key === 'ArrowRight') {
        renderSlide(currentIndex + 1);
      } else if (event.key === 'Tab') {
        /* Ловушка фокуса внутри диалога: фокусируемые узлы собираем
           динамически, чтобы не зависеть от их количества */
        var focusables = Array.prototype.slice
          .call(lightbox.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'))
          .filter(function (node) { return node.offsetParent !== null; });
        if (!focusables.length) return;
        var idx = focusables.indexOf(document.activeElement);
        event.preventDefault();
        if (event.shiftKey) {
          idx = idx <= 0 ? focusables.length - 1 : idx - 1;
        } else {
          idx = idx === focusables.length - 1 ? 0 : idx + 1;
        }
        focusables[idx].focus();
      }
    });
  }

  /* ----------------------------------------------------------
     8. Форма RSVP: Formspree (или демо-режим, пока endpoint
        не настроен) + клиентская валидация + honeypot
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

    var submitBtn = form.querySelector('.form__submit');
    var resultTitle = result ? result.querySelector('.form__result-title') : null;
    var resultSub = result ? result.querySelector('.form__result-sub') : null;

    function showResult(title, sub) {
      if (!result) return;
      if (resultTitle) resultTitle.textContent = title;
      if (resultSub) resultSub.textContent = sub;
      result.hidden = false;
      result.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'center'
      });
    }

    function finishSubmit(label) {
      if (!submitBtn) return;
      submitBtn.disabled = true;
      submitBtn.textContent = label;
      submitBtn.style.opacity = '.55';
      submitBtn.style.cursor = 'default';
    }

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

      /* Endpoint не настроен — демо-режим, как раньше */
      if (RSVP_ENDPOINT.indexOf('YOUR_FORM_ID') !== -1) {
        showResult(
          'Спасибо! (демо-режим, отправка не настроена)',
          'Ждём вас 26 августа — будет красиво.'
        );
        finishSubmit('Ответ отправлен');
        return;
      }

      /* Реальная отправка на Formspree */
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Отправляем…';
      }

      fetch(RSVP_ENDPOINT, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: new FormData(form)
      })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          showResult(
            'Спасибо! Ваш ответ получен',
            'Ждём вас 26 августа — будет красиво.'
          );
          finishSubmit('Ответ отправлен');
        })
        .catch(function () {
          showResult(
            'Не удалось отправить, попробуйте позже',
            'Проверьте соединение и отправьте форму ещё раз.'
          );
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Отправить ответ';
          }
        });
    });
  }
})();
