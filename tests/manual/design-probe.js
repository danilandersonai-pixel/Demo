// Замеры доступности и инвентарь оформления — числа для DESIGN-AUDIT.md.
//
//   node server.js --port 4517 --quiet --no-open &
//   node tests/manual/design-probe.js [url]
//
// Считает по-настоящему, а не по декларациям в CSS: контраст каждого
// текстового узла берётся от вычисленного цвета к фактической подложке
// (ближайший непрозрачный предок), кегли и зоны касания — из геометрии.
const fs = require('fs');
const path = require('path');
const { launch, sleep, killAll } = require('./cdp');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const URL = process.argv[2] || 'http://127.0.0.1:4517/';

// ─── инвентарь: сколько разных значений живёт в стилях ─────────────────
function inventory() {
  const files = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.css'));
  const acc = { hex: new Set(), rgba: new Set(), px: new Set(), radius: new Set(), font: new Set() };
  const perFile = {};
  files.forEach((f) => {
    const src = fs.readFileSync(path.join(PUBLIC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const hex = src.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    const rgba = src.match(/rgba?\([^)]*\)/g) || [];
    hex.forEach((v) => acc.hex.add(v.toLowerCase()));
    rgba.forEach((v) => acc.rgba.add(v.replace(/\s+/g, '')));
    (src.match(/(?<![\w-])\d+(\.\d+)?px/g) || []).forEach((v) => acc.px.add(v));
    (src.match(/border-radius:\s*([^;]+)/g) || []).forEach((v) => acc.radius.add(v.split(':')[1].trim()));
    (src.match(/font-size:\s*([^;]+)/g) || []).forEach((v) => acc.font.add(v.split(':')[1].trim()));
    perFile[f] = { hex: hex.length, rgba: rgba.length };
  });
  return {
    files: perFile,
    hex: [...acc.hex].sort(), rgba: [...acc.rgba].sort(),
    px: [...acc.px].sort((a, b) => parseFloat(a) - parseFloat(b)),
    radius: [...acc.radius], font: [...acc.font].sort()
  };
}

// ─── замер в браузере ──────────────────────────────────────────────────
const PROBE = `(() => {
  // Цвета в системе собираются через color-mix, и getComputedStyle отдаёт их
  // как color(srgb …) или oklab(…). Разбирать эти строки руками — путь к
  // неверным числам, поэтому цвет «проявляем» через canvas: что нарисовалось,
  // то браузер и покажет человеку.
  var cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  var ctx = cv.getContext('2d', { willReadFrequently: true });

  function rgba(css) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    try { ctx.fillStyle = css; } catch (e) { return [0, 0, 0, 1]; }
    ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }
  function over(top, bottom) {
    var a = top[3];
    if (a >= 0.999) return top;
    return [
      top[0] * a + bottom[0] * (1 - a),
      top[1] * a + bottom[1] * (1 - a),
      top[2] * a + bottom[2] * (1 - a),
      1
    ];
  }
  function lum(c) {
    var f = c.slice(0, 3).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }
  function bgOf(el) {
    var stack = [];
    var n = el;
    while (n) {
      var c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 0.001) {
        stack.push(c);
        if (c[3] >= 0.999) break;
      }
      n = n.parentElement;
    }
    var base = [255, 255, 255, 1];
    for (var i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  }
  function ratio(fg, bg) {
    var l1 = lum(fg), l2 = lum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  var narrow = window.innerWidth <= 900;
  var out = { contrast: [], small: [], touch: [], noLabel: [], scrollW: document.documentElement.scrollWidth };
  var seen = {};

  Array.prototype.forEach.call(document.querySelectorAll('*'), function (el) {
    if (!el.offsetParent && el.tagName !== 'BODY') return;
    var own = Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; })
      .map(function (n) { return n.textContent.trim(); }).join('');
    if (own.length < 2) return;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.2) return;
    var size = parseFloat(cs.fontSize);
    var sel = el.tagName.toLowerCase() + '.' + String(el.className || '').slice(0, 44);
    var bg = bgOf(el);
    var r = ratio(over(rgba(cs.color), bg), bg);
    if (r < 4.5 && !seen['c' + sel + Math.round(r * 10)]) {
      seen['c' + sel + Math.round(r * 10)] = 1;
      out.contrast.push({ sel: sel, size: size, ratio: Number(r.toFixed(2)), sample: own.slice(0, 30) });
    }
    if (narrow && size < 15 && !seen['s' + sel + size]) {
      seen['s' + sel + size] = 1;
      out.small.push({ sel: sel, size: size, sample: own.slice(0, 26) });
    }
  });

  if (narrow) {
    Array.prototype.forEach.call(
      document.querySelectorAll('button, a[href], input, select, [role="tab"]'), function (el) {
      if (!el.offsetParent) return;
      var b = el.getBoundingClientRect();
      // Часть значков растягивает зону касания псевдоэлементом ::after.
      var after = getComputedStyle(el, '::after');
      var grow = 0;
      if (after && after.content !== 'none' && after.position === 'absolute') {
        var inset = parseFloat(after.top);
        if (inset < 0) grow = -inset * 2;
      }
      var w = b.width + grow, h = b.height + grow;
      if (w < 44 || h < 44) out.touch.push({
        sel: el.tagName.toLowerCase() + '.' + String(el.className || '').slice(0, 40),
        w: Math.round(w), h: Math.round(h) });
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('button, [role="tab"]'), function (el) {
    if (!el.offsetParent) return;
    var text = (el.textContent || '').replace(/[^\\p{L}\\p{N}]/gu, '').trim();
    if (text) return;
    if (el.getAttribute('aria-label') || el.getAttribute('title')) return;
    out.noLabel.push(el.tagName.toLowerCase() + '.' + String(el.className || '').slice(0, 40));
  });

  return out;
})()`;

(async () => {
  const inv = inventory();
  console.log('═══ ИНВЕНТАРЬ ОФОРМЛЕНИЯ ═══');
  Object.keys(inv.files).forEach((f) => {
    console.log('  ' + f.padEnd(18) + ' hex: ' + inv.files[f].hex + ', rgba: ' + inv.files[f].rgba);
  });
  console.log('  всего разных hex: ' + inv.hex.length + ', rgba: ' + inv.rgba.length);
  console.log('  разных px: ' + inv.px.length);
  console.log('  радиусов: ' + inv.radius.length + ' → ' + inv.radius.join(' | '));
  console.log('  font-size: ' + inv.font.length + ' → ' + inv.font.join(' | '));

  const b = await launch({ cdpPort: 9443, width: 1500, height: 980 });
  b.waitFor = async (expr, t = 8000) => {
    const deadline = Date.now() + t;
    for (;;) {
      if (await b.eval(expr)) return true;
      if (Date.now() > deadline) return false;
      await sleep(200);
    }
  };

  await b.metrics(1500, 980, false);
  await b.goto(URL, 5000);
  await b.waitFor(`document.querySelectorAll('.ev').length > 0`, 20000);
  await b.eval(`var t=document.getElementById('tourSkip'); if(t) t.click()`);
  await sleep(400);

  let bad = 0;
  for (const [w, h, mobile] of [[1500, 980, false], [360, 740, true]]) {
    await b.metrics(w, h, mobile);
    await sleep(400);
    await b.eval(`window.dispatchEvent(new Event('resize'))`);
    await sleep(500);
    for (const t of ['dark', 'light']) {
      await b.eval(`document.documentElement.setAttribute('data-theme','${t}')`);
      await sleep(350);
      const r = await b.json(PROBE);
      const label = w + 'px, ' + (t === 'dark' ? 'тёмная' : 'светлая');
      console.log('\n═══ ' + label + ' ═══');
      console.log('  контраст < 4.5:1 — ' + r.contrast.length);
      r.contrast.slice(0, 14).forEach((c) =>
        console.log('     ' + c.ratio + '  ' + c.size + 'px  ' + c.sel + '  «' + c.sample + '»'));
      if (mobile) {
        console.log('  текст < 15px — ' + r.small.length);
        r.small.slice(0, 14).forEach((s) =>
          console.log('     ' + s.size + 'px  ' + s.sel + '  «' + s.sample + '»'));
        console.log('  зоны касания < 44px — ' + r.touch.length);
        r.touch.slice(0, 14).forEach((s) => console.log('     ' + s.w + '×' + s.h + '  ' + s.sel));
      }
      console.log('  кнопки без имени — ' + r.noLabel.length +
        (r.noLabel.length ? ': ' + r.noLabel.join(', ') : ''));
      console.log('  ширина прокрутки — ' + r.scrollW + ' (окно ' + w + ')');
      bad += r.contrast.length + (mobile ? r.small.length + r.touch.length : 0) +
        r.noLabel.length + (r.scrollW > w ? 1 : 0);
    }
  }

  console.log('\n' + (bad === 0
    ? '✅ нарушений нет'
    : '✖ нарушений всего: ' + bad));
  await b.close();
  killAll();
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error(e); killAll(); process.exit(1); });
