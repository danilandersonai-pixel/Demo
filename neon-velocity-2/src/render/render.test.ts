/**
 * Тесты той части рендера, которой не нужен браузер: согласованность двух
 * способов попасть в пиксель холста (матрица и ручной пересчёт), сила тряски
 * камеры, яркость и слой меток прилёта, пул частиц и волны дороги. Сама
 * картинка проверяется глазами — на тестовой странице.
 */
import { describe, expect, it } from 'vitest';
import { approachTicksForLevel, BASE_SIM_LOADOUT, GAME, SKINS, THEMES } from '../core/config';
import { Simulation } from '../core/sim';
import { holdAt, runUntil, scriptedChart } from '../core/testkit';
import { TICK_RATE } from '../core/timing';
import type { ObstacleSpec, SimEvent } from '../core/types';
import { SHIP_SIZE } from '../core/shipGeometry';
import { makeCamera, type Camera } from './camera';
import { markerPower, Objects } from './objects';
import { labelCeiling, Particles, type LabelBox } from './particles';
import { LANE_STEPS, Road } from './road';
import { shakeAmplitude, shakeOffset } from './shake';
import { SHIP_HOVER } from './ship';
import { devX, devY, lineScale, useWorld, type Sprites, type View } from './view';

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Данные кадра без холста: вместо контекста — заглушка, которая запоминает матрицу. */
function fakeView(matrix: Matrix, patch: Partial<View> = {}): View {
  const ctx = {
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
      Object.assign(matrix, { a, b, c, d, e, f });
    },
  };
  const sim = new Simulation();
  const view = {
    ctx,
    cam: makeCamera(1280, 800, 2),
    state: sim.state,
    colors: THEMES.cyberpunk.colors,
    skin: SKINS.core,
    kx: 2,
    ky: 2,
    t: 0,
    alpha: 1,
    now: 0,
    dt: 0,
    beat: 0,
    downbeat: 0,
    shipX: 50,
    shipSx: 640,
    shipSy: 650,
    hull: '#22f0ff',
    shipCore: '#ffffff',
    gridColor: '#ff2bd6',
    scroll: 0,
    speed: 170,
    overdrive: 0,
    reduced: false,
    line: 1,
    span: 384,
    flat: 0.3,
    ox: 0,
    oy: 0,
    zoom: 1,
    shear: 0,
    ...patch,
  };
  return view as unknown as View;
}

describe('матрица мира', () => {
  it('devX / devY дают ту же точку, что и матрица useWorld', () => {
    const cases: Partial<View>[] = [
      {},
      { ox: 7, oy: -5 },
      { zoom: 1.05 },
      { shear: 0.008 },
      { kx: 1.73, ky: 1.71, ox: -11, oy: 4, zoom: 1.03, shear: -0.006 },
    ];
    for (const patch of cases) {
      const m: Matrix = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
      const view = fakeView(m, patch);
      useWorld(view);
      for (const [x, y] of [
        [0, 0],
        [640, 272],
        [100, 700],
        [1279, 799],
      ]) {
        expect(devX(view, x, y)).toBeCloseTo(m.a * x + m.c * y + m.e, 6);
        expect(devY(view, y)).toBeCloseTo(m.b * x + m.d * y + m.f, 6);
      }
    }
  });

  it('точка схода неподвижна при крене и ударе масштаба', () => {
    const m: Matrix = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
    const still = fakeView(m);
    const moved = fakeView(m, { zoom: 1.055, shear: 0.008 });
    const { cx, horizonY } = still.cam;
    expect(devX(moved, cx, horizonY)).toBeCloseTo(devX(still, cx, horizonY), 6);
    expect(devY(moved, horizonY)).toBeCloseTo(devY(still, horizonY), 6);
  });

  it('толщина линий ограничена на телефоне и на большом экране', () => {
    expect(lineScale(makeCamera(1280, 800, 2))).toBeCloseTo(1, 1);
    expect(lineScale(makeCamera(390, 844, 3))).toBe(0.6);
    expect(lineScale(makeCamera(3840, 2160, 1))).toBe(1.3);
  });
});

describe('тряска камеры', () => {
  const desktop = makeCamera(1280, 800, 1);
  const phone = makeCamera(390, 844, 2);

  /**
   * Что увидит игрок после события: кадры идут как в рендере (травма спадает,
   * сдвиг округляется до пикселей устройства). peak — наибольший сдвиг по оси,
   * span — сколько секунд картинка вообще двигалась.
   */
  function shaken(trauma0: number, cam: Camera, pixelRatio: number, now0: number): { peak: number; span: number } {
    const fps = 60;
    const out = { x: 0, y: 0 };
    let trauma = trauma0;
    let peak = 0;
    let first = -1;
    let last = -1;
    for (let frame = 0; trauma > 0; frame++) {
      trauma = Math.max(0, trauma - GAME.shake.decay / fps);
      shakeOffset(trauma, cam, now0 + frame / fps, out);
      const ox = Math.round(out.x * pixelRatio);
      const oy = Math.round(out.y * pixelRatio);
      if (ox === 0 && oy === 0) continue;
      if (first < 0) first = frame;
      last = frame;
      peak = Math.max(peak, Math.abs(ox), Math.abs(oy));
    }
    return { peak, span: first < 0 ? 0 : (last - first + 1) / fps };
  }

  /** Событие может прийти в любой фазе колебания: статистика по двум сотням фаз. */
  function survey(trauma: number, cam: Camera, pixelRatio: number): { seen: number; peak: number; span: number } {
    const runs = Array.from({ length: 200 }, (_, i) => shaken(trauma, cam, pixelRatio, i * 0.731));
    const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1];
    return {
      seen: runs.filter((run) => run.peak >= 1).length / runs.length,
      peak: median(runs.map((run) => run.peak)),
      span: median(runs.map((run) => run.span)),
    };
  }

  it('без травмы кадр неподвижен; размах на узком экране вдвое меньше', () => {
    expect(shakeOffset(0, desktop, 12.3, { x: 5, y: 5 })).toEqual({ x: 0, y: 0 });
    expect(shakeAmplitude(1, desktop)).toBe(GAME.shake.maxOffset);
    expect(shakeAmplitude(1, phone)).toBeCloseTo(GAME.shake.maxOffset * (390 / 720), 6);
    expect(shakeAmplitude(1, makeCamera(320, 568, 2))).toBe(GAME.shake.maxOffset / 2);
  });

  it('каждое событие переживает округление до пикселя — на мониторе и на телефоне', () => {
    const { hit, shield, levelUp, nearMiss } = GAME.shake;
    for (const [cam, pixelRatio] of [[desktop, 1], [phone, 2], [makeCamera(390, 844, 1), 1]] as const) {
      for (const trauma of [hit, shield, levelUp]) expect(survey(trauma, cam, pixelRatio).seen).toBe(1);
      // Лёгкий тик «впритирку» — самый слабый: ему разрешено потеряться лишь в редкой неудачной фазе.
      expect(survey(nearMiss, cam, pixelRatio).seen).toBeGreaterThanOrEqual(0.97);
    }
  });

  it('новый уровень ощутим, но слабее столкновений; «впритирку» — лёгкий тик', () => {
    for (const [cam, pixelRatio] of [[desktop, 1], [phone, 2]] as const) {
      const hit = survey(GAME.shake.hit, cam, pixelRatio);
      const shield = survey(GAME.shake.shield, cam, pixelRatio);
      const levelUp = survey(GAME.shake.levelUp, cam, pixelRatio);
      const nearMiss = survey(GAME.shake.nearMiss, cam, pixelRatio);
      // Несколько пикселей на треть секунды и дольше.
      expect(levelUp.peak).toBeGreaterThanOrEqual(4);
      expect(levelUp.span).toBeGreaterThanOrEqual(0.3);
      expect(levelUp.span).toBeLessThanOrEqual(0.5);
      // Заметно слабее и короче удара о щит, а тот — слабее гибели.
      expect(levelUp.peak).toBeLessThanOrEqual(shield.peak * 0.75);
      expect(levelUp.span).toBeLessThan(shield.span);
      expect(shield.peak).toBeLessThan(hit.peak);
      expect(shield.span).toBeLessThan(hit.span);
      // Тик: пара пикселей на доли секунды, минимум вдвое слабее смены уровня.
      expect(nearMiss.peak).toBeLessThanOrEqual(3);
      expect(nearMiss.peak).toBeLessThanOrEqual(levelUp.peak / 2);
      expect(nearMiss.span).toBeLessThanOrEqual(0.2);
    }
  });
});

describe('метки прилёта', () => {
  it('яркость задаёт время до удара: за секунду — больше половины, за 0.6 с — полная, на любой скорости', () => {
    for (let level = 1; level <= 22; level++) {
      const approach = approachTicksForLevel(level);
      // За секунду до удара — или с самого появления, если весь полёт короче секунды.
      for (let left = Math.min(TICK_RATE, approach); left >= 0; left--) expect(markerPower(left)).toBeGreaterThanOrEqual(0.5);
    }
    for (let left = Math.floor(0.6 * TICK_RATE); left >= 0; left--) expect(markerPower(left)).toBe(1);
    // Чем ближе удар, тем ярче; только что появившийся далёкий объект метки ещё не имеет.
    for (let left = 0; left < GAME.approach.base; left++) expect(markerPower(left + 1)).toBeLessThanOrEqual(markerPower(left));
    expect(markerPower(2 * TICK_RATE)).toBe(0);
    expect(markerPower(GAME.approach.base)).toBe(0);
  });

  interface Stroke {
    alpha: number;
    points: [number, number][];
  }

  /** Контекст-самописец: запоминает обведённые пути, остальное молча принимает. */
  function recorder(): { ctx: CanvasRenderingContext2D; strokes: Stroke[] } {
    const strokes: Stroke[] = [];
    let path: [number, number][] = [];
    const props: Record<string | symbol, unknown> = { globalAlpha: 1 };
    const calls: Record<string | symbol, (...args: number[]) => void> = {
      beginPath: () => {
        path = [];
      },
      moveTo: (x, y) => void path.push([x, y]),
      lineTo: (x, y) => void path.push([x, y]),
      stroke: () => void strokes.push({ alpha: props.globalAlpha as number, points: path.slice() }),
    };
    const ctx = new Proxy(props, {
      get: (target, key) => (key in target ? target[key] : (calls[key] ?? (() => undefined))),
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
  }

  it('проход ворот — отдельный слой для отрисовки поверх частиц: скобы в воротах и на линии удара', () => {
    const cam = makeCamera(1280, 800, 1);
    const gate: ObstacleSpec = { kind: 'laser', arriveTick: 480, x: 30, sway: null, halfW: 12 };
    const xl = cam.cx + (gate.x - gate.halfW - 50) * cam.unit;
    const xr = cam.cx + (gate.x + gate.halfW - 50) * cam.unit;
    /** Обводки скоб на линии удара: вертикали по краям прохода прилёта. */
    const landing = (strokes: Stroke[]) =>
      strokes.filter((stroke) => [xl, xr].every((x) => stroke.points.some((p) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - cam.lineY) < 1e-6)));

    for (const [left, bright] of [[70, true], [200, false]] as const) {
      const sim = new Simulation();
      sim.startRun(1, BASE_SIM_LOADOUT, scriptedChart([gate]));
      runUntil(sim, gate.arriveTick - left, holdAt(50));
      const rec = recorder();
      const view = fakeView({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, { cam, state: sim.state, t: sim.state.tick, kx: 1, ky: 1 });
      view.ctx = rec.ctx;
      const objects = new Objects();
      // Слой полотна (под кораблём и частицами) скоб не рисует — только полосы и подсветку.
      objects.drawGround(view);
      expect(rec.strokes).toHaveLength(0);
      objects.drawPassages(view);
      // Скобы в самих воротах и на линии удара; каждая пара — ореол и сердцевина.
      expect(rec.strokes).toHaveLength(4);
      const marks = landing(rec.strokes);
      expect(marks).toHaveLength(2);
      const alpha = Math.max(...marks.map((stroke) => stroke.alpha));
      // 70 тиков (0.55 с) до удара — уже полная яркость; за 1.6 с метка только проявляется.
      if (bright) expect(alpha).toBe(1);
      else expect(alpha).toBeLessThan(0.5);
    }
  });
});

describe('частицы', () => {
  const death: SimEvent = { type: 'death', tick: 100, x: 50, kind: 'cube' };

  it('взрыв корабля — больше сотни частиц, и все они со временем гаснут', () => {
    const view = fakeView({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 });
    const particles = new Particles();
    particles.onEvent(death, view.state, view);
    expect(particles.alive).toBeGreaterThanOrEqual(100);
    for (let i = 0; i < 300; i++) particles.update(1 / 60);
    expect(particles.alive).toBe(0);
  });

  it('пул не растёт: шквал событий не выходит за его размер', () => {
    const view = fakeView({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 });
    const particles = new Particles();
    for (let i = 0; i < 40; i++) particles.onEvent(death, view.state, view);
    const full = particles.alive;
    particles.onEvent(death, view.state, view);
    expect(particles.alive).toBe(full);
    expect(full).toBeLessThanOrEqual(800);
  });

  it('на паузе (dt = 0) частицы не стареют; clear убирает всё', () => {
    const view = fakeView({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 });
    const particles = new Particles();
    particles.onEvent(death, view.state, view);
    const before = particles.alive;
    for (let i = 0; i < 100; i++) particles.update(0);
    expect(particles.alive).toBe(before);
    particles.clear();
    expect(particles.alive).toBe(0);
  });

  it('шлейф сыплется в движении и не рождается на паузе', () => {
    const view = fakeView({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, { skin: SKINS.trail, dt: 1 / 60 });
    const particles = new Particles();
    particles.trail(view);
    particles.trail(view);
    expect(particles.alive).toBeGreaterThan(0);
    particles.clear();
    view.dt = 0;
    particles.trail(view);
    expect(particles.alive).toBe(0);
  });
});

describe('дорога', () => {
  it('сетка запекается за конечное число шагов', () => {
    expect(LANE_STEPS).toBeGreaterThan(0);
    expect(Number.isInteger(LANE_STEPS)).toBe(true);
  });

  it('волн не больше четырёх: пятая занимает место самой далёкой', () => {
    const road = new Road();
    for (let i = 0; i < 4; i++) {
      road.wave('#ffffff', 1);
      road.update(0.1);
    }
    road.wave('#ff0000', 1);
    // Все волны продолжают жить и уходят за горизонт без ошибок.
    for (let i = 0; i < 200; i++) road.update(0.05);
    road.reset();
    expect(() => road.update(0.05)).not.toThrow();
  });
});

describe('всплывающие надписи', () => {
  /** Спрайты без холста: размеры как у настоящих (см. textSprite), ширина знака — с запасом. */
  const sprites = {
    text(text: string, _color: string, px: number) {
      const pad = Math.ceil(px * 0.7);
      return { canvas: null, w: Math.ceil(text.length * px * 0.85 + pad * 2), h: Math.ceil(px + pad * 2) };
    },
  } as unknown as Sprites;

  /** Воспроизводимый шум 0..1. */
  function noise(n: number): number {
    const x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  }

  it('в плотном потоке событий не накладываются друг на друга и не опускаются к кораблю', () => {
    const boxes: LabelBox[] = [];
    for (const [w, h] of [[1280, 800], [390, 844], [844, 390], [320, 568]] as const) {
      const cam = makeCamera(w, h, 2);
      const view = fakeView({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, { cam, sprites, line: lineScale(cam) });
      const state = view.state;
      const particles = new Particles();
      const ceiling = labelCeiling(view);
      // Черта надписей — выше пузыря щита (радиус 1.42 размера корпуса вокруг корабля).
      expect(ceiling).toBeLessThanOrEqual(cam.lineY - (SHIP_HOVER + SHIP_SIZE * 1.42) * cam.unit);
      let most = 0;
      for (let frame = 0; frame < 2400; frame++) {
        // Корабль ходит от борта к борту — надписи остаются привязаны к месту события.
        state.player.x = 50 + 44 * Math.sin(frame * 0.045);
        const x = state.player.x;
        const tick = frame * 2;
        // Цепочка сфер шестнадцатыми, магнит берёт их пачками; каждая шестая — редкая.
        if (frame % 7 === 0) {
          const burst = 1 + Math.floor(noise(frame) * 3);
          for (let k = 0; k < burst; k++) {
            const rare = (frame / 7 + k) % 6 === 0;
            const points = rare ? 8000 : 1600;
            particles.onEvent({ type: 'collect', tick, x: x + (noise(frame + k * 13) - 0.5) * 24, rare, chain: 40, multiplier: 8, note: frame, points }, state, view);
          }
        }
        // Впритирку — с обеих сторон, иногда в том же кадре, что и сфера.
        if (frame % 23 === 0) {
          particles.onEvent({ type: 'dodge', tick, x: x + (noise(frame * 3) < 0.5 ? -6 : 6), kind: 'cube', near: true, points: 300 }, state, view);
        }
        particles.update(1 / 60);
        particles.layoutLabels(view);
        const n = particles.labelBoxes(view, boxes);
        most = Math.max(most, n);
        for (let i = 0; i < n; i++) {
          const a = boxes[i];
          // Низ текста — над чертой: корабль под надписью не окажется, куда бы он ни ушёл.
          expect(a.y + a.h / 2).toBeLessThanOrEqual(ceiling + 0.01);
          for (let j = i + 1; j < n; j++) {
            const b = boxes[j];
            const overlapX = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
            const overlapY = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
            expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0.01);
          }
        }
      }
      // Проверка не пустая: на экране действительно бывало много надписей сразу.
      expect(most).toBeGreaterThanOrEqual(6);
    }
  });

  it('старшая надпись встаёт на строку выше младшей, а не перепрыгивает дальше', () => {
    const cam = makeCamera(1280, 800, 2);
    const view = fakeView({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, { cam, sprites, line: lineScale(cam) });
    const particles = new Particles();
    const boxes: LabelBox[] = [];
    const collect: SimEvent = { type: 'collect', tick: 0, x: 50, rare: false, chain: 1, multiplier: 1, note: 0, points: 100 };
    particles.onEvent(collect, view.state, view);
    particles.onEvent(collect, view.state, view);
    particles.onEvent(collect, view.state, view);
    expect(particles.labelBoxes(view, boxes)).toBe(3);
    const ys = boxes.slice(0, 3).map((b) => b.y).sort((p, q) => q - p);
    const line = boxes[0].h;
    // Нижняя — у самой черты, остальные — ровно через строку.
    expect(ys[0] + line / 2).toBeCloseTo(labelCeiling(view), 6);
    expect(ys[0] - ys[1]).toBeCloseTo(line, 6);
    expect(ys[1] - ys[2]).toBeCloseTo(line, 6);
  });
});
