/* ==========================================================
   Городок на Phaser 3 — прототип сцены на настоящем движке.
   Та же карта-«пирог» и те же ассеты, но сценой управляет
   движок: глубина, твины, частицы, инерционная камера.
   ========================================================== */
(() => {
  'use strict';

  const W = 15, H = 15, TW = 100, TH = 50, PADX = 12, PADY = 110;
  const CANW = PADX * 2 + (W + H - 2) * TW / 2 + TW;
  const CANH = PADY + (W + H - 2) * TH / 2 + TH + 30;

  const LAYOUT = [
    'ggggggffggggggg',
    'ggfffgffggggggg',
    'gffffggggfgmmmg',
    'ggffgggfffgmmmg',
    'ggggggggffggmgg',
    'ffggggggggggggg',
    'ffgwwggfggfffgg',
    'gggwwwggggfffgg',
    'gmmgwwgggggfgfg',
    'gmggggggggggffg',
    'gggggggwwgggffg',
    'gggfffggwwggggg',
    'ggggfffggwwggfg',
    'gggggfggggggffg',
    'ggggggggggggggg',
  ];
  const TMAP = { g: 'grass', f: 'forest', m: 'mountain', w: 'water' };
  const terr = (x, y) => TMAP[LAYOUT[y][x]];

  const idx = (x, y) => y * W + x;
  const origin = (x, y) => [PADX + (x - y + H - 1) * TW / 2, PADY + (x + y) * TH / 2];
  const center = (x, y) => { const [sx, sy] = origin(x, y); return [sx + TW / 2, sy + TH / 2]; };

  const BUILD = {
    house:  { name: 'Дом',       img: 'h_house',  cost: 12, terr: 'grass',    inc: { pop: 3 } },
    farm:   { name: 'Ферма',     img: 'n_farm',   cost: 14, terr: 'grass',    inc: { food: 4 } },
    lumber: { name: 'Лесопилка', img: 'n_lumber', cost: 16, terr: 'forest',   inc: { prod: 2 } },
    mine:   { name: 'Шахта',     img: 'n_mine',   cost: 24, terr: 'mountain', inc: { prod: 2, gold: 2 } },
    church: { name: 'Церковь',   img: 'n_church', cost: 24, terr: 'grass',    inc: {} },
    market: { name: 'Рынок',     img: 'n_market', cost: 20, terr: 'grass',    inc: { gold: 3 } },
    tavern: { name: 'Таверна',   img: 'h_tavern', cost: 18, terr: 'grass',    inc: {} },
    dock:   { name: 'Причал',    img: 'h_dock',   cost: 12, terr: 'water',    inc: { food: 3 } },
  };
  const SMOKY = { townhall: 1, house: 1, tavern: 1, lumber: 1 };

  // состояние партии (вертикальный срез: стройка + экономика дня)
  const S = {
    day: 1, food: 30, prod: 30, gold: 12, pop: 4,
    built: {},                     // i -> ключ здания
  };
  S.built[idx(7, 7)] = 'townhall';

  let placing = null;
  let scene = null;
  const sprites = {};              // i -> {b, shadow, smoke}

  /* ---------- HUD ---------- */
  const $ = (id) => document.getElementById(id);
  function refreshHud() {
    $('r-day').textContent = S.day;
    $('r-food').textContent = S.food;
    $('r-prod').textContent = S.prod;
    $('r-gold').textContent = S.gold;
    $('r-pop').textContent = S.pop;
    $('i-food').src = ASSETS.r_food;
    $('i-prod').src = ASSETS.r_workers;
    $('i-gold').src = ASSETS.r_gold;
    for (const el of document.querySelectorAll('.card')) {
      const k = el.dataset.k;
      el.classList.toggle('is-off', S.prod < BUILD[k].cost);
      el.classList.toggle('is-active', placing === k);
    }
  }

  function makeCards() {
    const box = $('cards');
    for (const k in BUILD) {
      const b = BUILD[k];
      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.k = k;
      el.innerHTML = `<img src="${ASSETS[b.img]}" alt=""><div>${b.name}</div>` +
        `<div class="cost">⚒ ${b.cost}</div>`;
      el.addEventListener('click', () => {
        if (S.prod < b.cost) return;
        placing = placing === k ? null : k;
        $('hint').style.display = placing ? 'block' : 'none';
        scene && scene.showPlaces();
        refreshHud();
      });
      box.appendChild(el);
    }
  }

  /* ---------- опора спрайта: середина основания (нижняя треть) ---------- */
  const pivotCache = {};
  function basePivotFrac(key) {
    if (pivotCache[key] != null) return pivotCache[key];
    const img = scene.textures.get(key).getSourceImage();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let best = c.height - 1, bw = -1;
    for (let y = Math.floor(c.height * .66); y < c.height; y++) {
      let x0 = -1, x1 = -1;
      for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] > 40) { if (x0 < 0) x0 = x; x1 = x; }
      }
      if (x1 - x0 > bw) { bw = x1 - x0; best = y; }
    }
    pivotCache[key] = best / c.height;
    return pivotCache[key];
  }

  /* ---------- сцена ---------- */
  class Town extends Phaser.Scene {
    create() {
      const need = ['ground_base', 'h_castle', 'h_house', 'h_tavern', 'h_dock', 'h_pen',
        'n_church', 'n_market', 'n_farm', 'n_lumber', 'n_mine',
        'p_tree1', 'p_tree2', 'p_pineB', 'p_oak1', 'p_oak2', 'p_oak3', 'p_stump',
        'p_rocks2', 'p_barrel', 'p_cart', 'p_lantern', 'f_1', 'f_2', 'f_3', 'h_peak',
        'v_1', 'v_2', 'v_3', 'v_4', 'v_5', 'v_6', 'w_1', 'w_2', 'a_deer',
        'r_food', 'r_gold', 'r_workers'];
      let left = need.length;
      const done = () => { if (--left === 0) this.build(); };
      for (const k of need) {
        if (this.textures.exists(k)) { done(); continue; }
        this.textures.once('addtexture-' + k, done);
        this.textures.addBase64(k, ASSETS[k]);
      }
    }

    build() {
      scene = this;
      const boot = document.getElementById('boot');
      if (boot) boot.remove();
      // процедурные текстуры: клуб дыма и светлячок
      const g1 = this.make.graphics({ x: 0, y: 0, add: false });
      g1.fillStyle(0xe8e4da, 1); g1.fillCircle(8, 8, 7);
      g1.generateTexture('puff', 16, 16); g1.destroy();
      const g2 = this.make.graphics({ x: 0, y: 0, add: false });
      g2.fillStyle(0xffe9a0, 1); g2.fillCircle(3, 3, 2.5);
      g2.generateTexture('spark', 6, 6); g2.destroy();

      // земля-«пирог» одним изображением
      this.add.image(0, 0, 'ground_base').setOrigin(0, 0).setDepth(-9999);

      // рассев мира (детерминированный, как в canvas-версии)
      const TREES = ['p_tree1', 'p_tree2', 'p_pineB'];
      const MEADOW = ['p_oak1', 'p_oak2', 'p_oak3', 'f_1', 'f_2', 'f_3'];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = idx(x, y);
          const t = terr(x, y);
          const [sx, sy] = origin(x, y);
          const h1 = (i * 2654435761) >>> 0;
          if (t === 'forest') {
            const n = 6 + h1 % 2;
            for (let k = 0; k < n; k++) {
              const hh = ((i * 73856093) ^ ((k + 1) * 19349663)) >>> 0;
              const key = TREES[hh % 3];
              const scl = [1, 1, .78, 1.18, 1.45][hh % 5];
              this.prop(key, sx + 8 + (hh % 84), sy + 6 + ((hh >> 6) % 40), scl, hh % 2 === 0);
            }
          } else if (t === 'mountain') {
            const pk = this.prop('h_peak', sx + TW / 2 + ((h1 >> 8) % 13) - 6, sy + TH / 2 + 18,
              h1 % 3 === 2 ? 1.3 : 1, h1 % 2 === 0);
            for (let k = 0; k < 1 + h1 % 2; k++) {
              const hh = ((i * 73856093) ^ ((k + 1) * 19349663)) >>> 0;
              this.prop('p_rocks2', sx + 12 + (hh % 72), sy + 10 + ((hh >> 6) % 30),
                hh % 2 ? 1 : 1.4, hh % 3 === 0);
            }
          } else if (t === 'grass' && (h1 % 4) === 0) {
            const hh = (h1 >> 3) >>> 0;
            this.prop(MEADOW[hh % MEADOW.length], sx + 14 + (hh % 68), sy + 10 + ((hh >> 6) % 32),
              1, hh % 2 === 0);
          }
          // загоны с овцами — редкий декор лугов
          if (t === 'grass' && (h1 % 23) === 5) {
            this.prop('h_pen', sx + TW / 2, sy + TH / 2 + 8, 1, false);
          }
        }
      }
      // олень у западного леса
      this.prop('a_deer', ...center(2, 9), .5, false);

      // стартовая ратуша
      this.placeBuilding(idx(7, 7), 'townhall', true);

      // жители: спрайты с листа, блуждают твинами
      this.walkers = [];
      const VKEYS = ['v_1', 'v_2', 'v_3', 'v_4', 'v_5', 'v_6', 'w_1', 'w_2'];
      for (let k = 0; k < 9; k++) {
        const [cx, cy] = center(6 + (k % 3), 6 + ((k / 3) | 0));
        const s = this.add.image(cx + (k * 17) % 40 - 20, cy + (k * 11) % 24 - 12, VKEYS[k % 8])
          .setOrigin(.5, 1).setScale(.5);
        this.walkers.push(s);
        this.wander(s);
      }

      // светлячки над берегом озера
      const [lx, ly] = center(4, 7);
      this.add.particles(lx, ly, 'spark', {
        x: { min: -140, max: 140 }, y: { min: -70, max: 90 },
        alpha: { start: 0, peak: .9, end: 0 }, scale: { min: .4, max: 1 },
        speedX: { min: -6, max: 6 }, speedY: { min: -10, max: -2 },
        lifespan: { min: 2600, max: 5200 }, frequency: 260,
        blendMode: 'ADD',
      }).setDepth(ly + 400);

      // выделение и подсветка стройки
      this.marker = this.add.graphics().setDepth(99999);
      this.placeMarks = this.add.graphics().setDepth(99998);

      this.setupCamera();
      this.setupInput();
      refreshHud();
    }

    prop(key, bx, by, scale = 1, flip = false) {
      // контактная тень + объект с опорой в точке касания
      const img = this.textures.get(key).getSourceImage();
      const w = img.width * scale;
      this.add.ellipse(bx, by - 1, w * .72, w * .27, 0x0b0f0a, .18).setDepth(by - .5);
      return this.add.image(bx, by, key).setOrigin(.5, 1).setScale(scale)
        .setFlipX(flip).setDepth(by);
    }

    placeBuilding(i, key, instant = false) {
      const x = i % W, y = (i / W) | 0;
      const [cx, cy] = center(x, y);
      const img = key === 'townhall' ? 'h_castle' : BUILD[key].img;
      const fr = basePivotFrac(img);
      const spr = this.add.image(cx, cy, img).setOrigin(.5, fr).setDepth(cy);
      this.add.ellipse(cx, cy + 4, 76, 32, 0x0b0f0a, .2).setDepth(cy - .5);
      S.built[i] = key;
      if (!instant) {
        spr.setScale(.4).setAlpha(0);
        this.tweens.add({ targets: spr, scale: 1, alpha: 1, duration: 320, ease: 'Back.Out' });
        // пыль стройки
        const dust = this.add.particles(cx, cy + 6, 'puff', {
          speed: { min: 30, max: 90 }, scale: { start: .8, end: 0 },
          alpha: { start: .8, end: 0 }, lifespan: 550, quantity: 14,
          tint: 0xb8a06a, emitting: false,
        }).setDepth(cy + 1);
        dust.explode(14);
        this.time.delayedCall(900, () => dust.destroy());
      }
      if (SMOKY[key]) {
        const tex = this.textures.get(img).getSourceImage();
        const top = cy - tex.height * basePivotFrac(img);
        this.add.particles(cx + 14, top + 14, 'puff', {
          speedY: { min: -18, max: -9 }, speedX: { min: -4, max: 6 },
          scale: { start: .5, end: 1.4 }, alpha: { start: .5, end: 0 },
          lifespan: { min: 2200, max: 3600 }, frequency: 700,
        }).setDepth(cy + 300);
      }
    }

    wander(s) {
      const opts = Object.keys(S.built).map(Number);
      const base = opts[(Math.random() * opts.length) | 0];
      const bx = base % W, by = (base / W) | 0;
      const nx = Phaser.Math.Clamp(bx + ((Math.random() * 5) | 0) - 2, 0, W - 1);
      const ny = Phaser.Math.Clamp(by + ((Math.random() * 5) | 0) - 2, 0, H - 1);
      if (terr(nx, ny) === 'water') return this.wander(s);
      const [cx, cy] = center(nx, ny);
      const tx = cx + Math.random() * 40 - 20;
      const ty = cy + Math.random() * 20 - 10;
      const dist = Phaser.Math.Distance.Between(s.x, s.y, tx, ty);
      s.setFlipX(tx < s.x);
      this.tweens.add({
        targets: s, x: tx, y: ty,
        duration: 900 + dist * 22,
        ease: 'Sine.InOut',
        onUpdate: () => s.setDepth(s.y),
        onComplete: () => this.time.delayedCall(400 + Math.random() * 2600, () => this.wander(s)),
      });
    }

    /* --- камера: cover-зум, инерционный пан, зум к курсору --- */
    setupCamera() {
      const cam = this.cameras.main;
      cam.setBounds(0, 0, CANW, CANH);
      const vw = this.scale.width, vh = this.scale.height;
      this.minZoom = Math.max(vw / CANW, vh / CANH);
      cam.setZoom(this.minZoom * 1.35);
      cam.centerOn(...center(7, 7));
    }

    setupInput() {
      const cam = this.cameras.main;
      let dragging = false, moved = 0, vx = 0, vy = 0;
      this.input.on('pointerdown', () => { dragging = true; moved = 0; vx = vy = 0; });
      this.input.on('pointermove', (p) => {
        if (!dragging || !p.isDown) return;
        const dx = (p.x - p.prevPosition.x) / cam.zoom;
        const dy = (p.y - p.prevPosition.y) / cam.zoom;
        moved += Math.abs(dx) + Math.abs(dy);
        cam.scrollX -= dx; cam.scrollY -= dy;
        vx = dx; vy = dy;
      });
      this.input.on('pointerup', (p) => {
        dragging = false;
        // инерция
        if (Math.abs(vx) + Math.abs(vy) > 2) {
          this.tweens.addCounter({
            from: 1, to: 0, duration: 600, ease: 'Cubic.Out',
            onUpdate: (tw) => {
              cam.scrollX -= vx * tw.getValue() * 2;
              cam.scrollY -= vy * tw.getValue() * 2;
            },
          });
        }
        if (moved < 6) this.tapAt(p);
      });
      this.input.on('wheel', (p, _o, _dx, dy) => {
        const target = Phaser.Math.Clamp(cam.zoom * (dy > 0 ? .82 : 1.22),
          this.minZoom, this.minZoom * 4.2);
        this.tweens.add({ targets: cam, zoom: target, duration: 220, ease: 'Cubic.Out' });
      });
    }

    tileAt(p) {
      // обратная изометрия: центр ромба (x,y) → x−y и x+y
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      const a = (wp.x - PADX - TW / 2) / (TW / 2);   // = x − y + H − 1
      const b = (wp.y - PADY - TH / 2) / (TH / 2);   // = x + y
      const gx = Math.round((a + b - (H - 1)) / 2);
      const gy = Math.round((b - a + (H - 1)) / 2);
      return [gx, gy];
    }

    tapAt(p) {
      const [x, y] = this.tileAt(p);
      if (x < 0 || x >= W || y < 0 || y >= H) { this.clearSel(); return; }
      const i = idx(x, y);
      if (placing) {
        const ok = terr(x, y) === BUILD[placing].terr && !S.built[i];
        if (ok && S.prod >= BUILD[placing].cost) {
          S.prod -= BUILD[placing].cost;
          S.pop += BUILD[placing].inc.pop || 0;
          this.placeBuilding(i, placing);
          placing = null;
          $('hint').style.display = 'none';
          this.showPlaces();
          refreshHud();
          return;
        }
        placing = null;
        $('hint').style.display = 'none';
        this.showPlaces();
        refreshHud();
        return;
      }
      // выделение ромба
      const [sx, sy] = origin(x, y);
      this.marker.clear();
      this.marker.lineStyle(3, 0xefc76e, .95);
      this.marker.strokePoints([
        { x: sx + TW / 2, y: sy }, { x: sx + TW, y: sy + TH / 2 },
        { x: sx + TW / 2, y: sy + TH }, { x: sx, y: sy + TH / 2 },
      ], true);
    }

    clearSel() { this.marker.clear(); }

    showPlaces() {
      this.placeMarks.clear();
      if (!placing) return;
      this.placeMarks.lineStyle(2, 0x7fb069, .8);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (terr(x, y) !== BUILD[placing].terr || S.built[idx(x, y)]) continue;
          const [sx, sy] = origin(x, y);
          this.placeMarks.strokePoints([
            { x: sx + TW / 2, y: sy + 4 }, { x: sx + TW - 6, y: sy + TH / 2 },
            { x: sx + TW / 2, y: sy + TH - 4 }, { x: sx + 6, y: sy + TH / 2 },
          ], true);
        }
      }
    }

    endDay() {
      S.day++;
      let df = 0, dp = 2, dg = 1;
      for (const i in S.built) {
        const inc = (BUILD[S.built[i]] || {}).inc || {};
        df += inc.food || 0; dp += inc.prod || 0; dg += inc.gold || 0;
      }
      df -= Math.ceil(S.pop / 2);
      S.food = Math.max(0, S.food + df);
      S.prod += dp;
      S.gold += dg;
      $('d-food').textContent = (df >= 0 ? '+' : '') + df;
      $('d-prod').textContent = '+' + dp;
      $('d-gold').textContent = '+' + dg;
      refreshHud();
      // сумерки: мягкое затемнение сцены твином
      const night = this.add.rectangle(CANW / 2, CANH / 2, CANW, CANH, 0x0a1226, 0)
        .setDepth(999999);
      this.tweens.add({
        targets: night, fillAlpha: .55, duration: 550, yoyo: true, hold: 350,
        ease: 'Sine.InOut',
        onComplete: () => night.destroy(),
      });
    }
  }

  /* ---------- запуск ---------- */
  // ошибки — на экран, чтобы «не запускается» всегда объясняло себя
  window.addEventListener('error', (e) => {
    const el = document.getElementById('boot');
    if (el) el.textContent = 'Ошибка: ' + (e.message || e.error || e);
  });

  function start() {
    makeCards();
    new Phaser.Game({
      // CANVAS: работает и там, где WebGL недоступен (песочницы, iframe)
      type: Phaser.CANVAS,
      parent: 'stage',
      backgroundColor: '#10161a',
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      render: { pixelArt: false, antialias: true },
      scene: Town,
    });
    document.getElementById('endday').addEventListener('click', () => {
      scene && scene.endDay();
    });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else window.addEventListener('DOMContentLoaded', start);
})();
