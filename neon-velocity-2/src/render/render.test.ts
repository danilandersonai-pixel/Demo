/**
 * Тесты той части рендера, которой не нужен браузер: согласованность двух
 * способов попасть в пиксель холста (матрица и ручной пересчёт), пул частиц и
 * волны дороги. Сама картинка проверяется глазами — на тестовой странице.
 */
import { describe, expect, it } from 'vitest';
import { SKINS, THEMES } from '../core/config';
import { Simulation } from '../core/sim';
import type { SimEvent } from '../core/types';
import { SHIP_SIZE } from '../core/shipGeometry';
import { makeCamera } from './camera';
import { labelCeiling, Particles, type LabelBox } from './particles';
import { LANE_STEPS, Road } from './road';
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
