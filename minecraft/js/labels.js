/* Кубокрафт — надписи на объектах мира: заводские таблички, бирки задвижек, предупреждающие знаки,
   номера ёмкостей, стрелки направления потока. Текст рисуется один раз в отдельный атлас
   с чётким шрифтом и сглаживанием (2048×2048) (в плитках 16×16 буквы не читаются), а таблички — прямоугольники
   в динамическом батче с этим атласом. */
(function () {
  'use strict';
  var KC = window.KC;
  var W = 2048, H = 2048, PPM = 256;          // пикселей атласа на метр ширины таблички
  var defs = [], byKey = {}, canvas = null, dirty = true;

  // Стили: фон, рамка, цвет текста
  var STYLES = {
    plate: { bg: '#24539a', edge: '#e8ecf0', ink: '#ffffff', ink2: '#cfe0f5' },     // заводская табличка
    tag: { bg: '#f2c318', edge: '#3a3000', ink: '#14110a', ink2: '#2b2510', hole: true },   // бирка задвижки
    warn: { bg: '#f2c318', edge: '#16130a', ink: '#14110a', ink2: '#2b2510', stripe: true, sign: '!' },
    num: { bg: '#1c2227', edge: '#f0f0ea', ink: '#ffffff', ink2: '#d6d6cc' },        // номер ёмкости
    white: { bg: '#f1f1ec', edge: '#2a2a2a', ink: '#1a1a1a', ink2: '#3a3a3a' },
    red: { bg: '#c22a22', edge: '#ffffff', ink: '#ffffff', ink2: '#ffe2dc' },
    green: { bg: '#1f7a46', edge: '#ffffff', ink: '#ffffff', ink2: '#d6f2e0' }
  };

  // Описать надпись: key — имя, lines — строки (первая крупнее), style; для стрелки — { arrow: цвет }
  function def(key, lines, style) {
    if (byKey[key]) return byKey[key];
    var d = { key: key, lines: typeof lines === 'string' ? [lines] : lines, style: style || 'plate', rect: null, aspect: 3 };
    if (style && style.arrow) { d.arrow = style.arrow; d.style = 'arrow'; d.lines = []; }
    defs.push(d); byKey[key] = d; dirty = true;
    return d;
  }

  function font(px) { return 'bold ' + px + 'px Arial, "Helvetica Neue", "Liberation Sans", sans-serif'; }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }

  // Раскладка и отрисовка атласа (полками)
  function build() {
    if (!dirty && canvas) return canvas;
    if (typeof document === 'undefined' || !document.createElement) return null;
    canvas = canvas || document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var g = canvas.getContext && canvas.getContext('2d');
    if (!g) return null;
    g.clearRect(0, 0, W, H);
    var x = 4, y = 4, rowH = 0, i;
    for (i = 0; i < defs.length; i++) {
      var d = defs[i], st = STYLES[d.style] || STYLES.plate, pw, ph, big = 34, small = 23, pad = 16;
      if (d.style === 'arrow') { pw = 160; ph = 56; }
      else {
        if (d.style === 'num') { big = 64; small = 26; }
        g.font = font(big); var tw = g.measureText(d.lines[0]).width;
        if (d.lines[1]) { g.font = font(small); tw = Math.max(tw, g.measureText(d.lines[1]).width); }
        if (d.lines[2]) { g.font = font(small); tw = Math.max(tw, g.measureText(d.lines[2]).width); }
        var extra = st.hole ? 34 : st.sign ? 58 : 0;
        pw = Math.ceil(tw + pad * 2 + extra);
        ph = big + 24 + (d.lines.length - 1) * (small + 8);
      }
      if (x + pw + 4 > W) { x = 4; y += rowH + 6; rowH = 0; }
      if (y + ph + 4 > H) { if (window.console) console.warn('Атлас надписей переполнен'); break; }
      d.rect = [x, y, pw, ph]; d.aspect = pw / ph;
      paint(g, d, st, x, y, pw, ph, big, small, pad);
      x += pw + 6; rowH = Math.max(rowH, ph);
    }
    dirty = false;
    KC.Labels.used = Math.round((y + rowH) / H * 100);
    return canvas;
  }

  function paint(g, d, st, x, y, w, h, big, small, pad) {
    g.save();
    if (d.style === 'arrow') {
      g.fillStyle = d.arrow; g.fillRect(x, y, w, h);
      g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x + 14, y + h * 0.36); g.lineTo(x + w - 58, y + h * 0.36); g.lineTo(x + w - 58, y + 8); g.lineTo(x + w - 10, y + h / 2);
      g.lineTo(x + w - 58, y + h - 8); g.lineTo(x + w - 58, y + h * 0.64); g.lineTo(x + 14, y + h * 0.64); g.closePath(); g.fill(); g.stroke();
      g.restore();
      return;
    }
    roundRect(g, x + 1, y + 1, w - 2, h - 2, 8); g.fillStyle = st.edge; g.fill();
    roundRect(g, x + 5, y + 5, w - 10, h - 10, 6); g.fillStyle = st.bg; g.fill();
    if (st.stripe) {                              // чёрно-жёлтая полоса по краю
      g.save(); roundRect(g, x + 1, y + 1, w - 2, h - 2, 8); g.clip();
      g.fillStyle = '#16130a';
      for (var s = -h; s < w; s += 22) { g.beginPath(); g.moveTo(x + s, y); g.lineTo(x + s + 11, y); g.lineTo(x + s + 11 + h, y + h); g.lineTo(x + s + h, y + h); g.closePath(); g.fill(); }
      g.restore();
      roundRect(g, x + 8, y + 8, w - 16, h - 16, 5); g.fillStyle = st.bg; g.fill();
    }
    var tx = x + w / 2, left = 0;
    if (st.hole) { g.fillStyle = '#555'; g.beginPath(); g.arc(x + 22, y + h / 2, 7, 0, Math.PI * 2); g.fill(); left = 17; }
    if (st.sign) {                                // треугольник «внимание»
      var cx = x + 38, cy = y + h / 2, r = Math.min(26, h / 2 - 12);
      g.fillStyle = '#16130a'; g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r * 1.05, cy + r * 0.8); g.lineTo(cx - r * 1.05, cy + r * 0.8); g.closePath(); g.fill();
      g.fillStyle = st.bg; g.font = font(Math.round(r * 1.1)); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', cx, cy + r * 0.2);
      left = 29;
    }
    tx += left;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = st.ink; g.font = font(big);
    var by = y + 12 + big * 0.86;
    g.fillText(d.lines[0], tx, by);
    for (var k = 1; k < d.lines.length; k++) {
      g.fillStyle = st.ink2; g.font = font(small);
      by += small + 8;
      g.fillText(d.lines[k], tx, by);
    }
    // заклёпки по углам
    if (d.style === 'plate' || d.style === 'num' || d.style === 'white' || d.style === 'red' || d.style === 'green') {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      [[x + 11, y + 11], [x + w - 11, y + 11], [x + 11, y + h - 11], [x + w - 11, y + h - 11]].forEach(function (q) { g.beginPath(); g.arc(q[0], q[1], 3.5, 0, Math.PI * 2); g.fill(); });
    }
    g.restore();
  }

  // Табличка в батч: c — центр (мир), n — нормаль, u — направление «вправо» по тексту, w — ширина, м
  var tmp = [0, 0, 0];
  function quad(batch, d, c, n, u, w, light, sunK) {
    if (!d.rect) return;
    var h = w / d.aspect, v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    var r = d.rect, u0 = r[0] / W, u1 = (r[0] + r[2]) / W, v0 = r[1] / H, v1 = (r[1] + r[3]) / H;
    var hw = w / 2, hh = h / 2, col = KC.Models.faceLight(n, light, sunK, null), k = 1.08;
    var o = [c[0] + n[0] * 0.012, c[1] + n[1] * 0.012, c[2] + n[2] * 0.012];
    function P(a, b) { tmp[0] = o[0] + u[0] * a + v[0] * b; tmp[1] = o[1] + u[1] * a + v[1] * b; tmp[2] = o[2] + u[2] * a + v[2] * b; return tmp; }
    batch.reserve(1);
    var p = P(-hw, -hh); batch.v(p[0], p[1], p[2], u0, v1, col[0] * k, col[1] * k, col[2] * k);
    p = P(hw, -hh); batch.v(p[0], p[1], p[2], u1, v1, col[0] * k, col[1] * k, col[2] * k);
    p = P(hw, hh); batch.v(p[0], p[1], p[2], u1, v0, col[0] * k, col[1] * k, col[2] * k);
    p = P(-hw, hh); batch.v(p[0], p[1], p[2], u0, v0, col[0] * k, col[1] * k, col[2] * k);
    batch.quads++;
    return h;
  }

  KC.Labels = {
    def: def, build: build, quad: quad, get: function (k) { return byKey[k] || null; },
    get dirty() { return dirty; }, W: W, H: H, PPM: PPM
  };
})();
