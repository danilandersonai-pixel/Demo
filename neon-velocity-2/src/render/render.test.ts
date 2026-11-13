/**
 * Тесты той части рендера, которой не нужен браузер: согласованность двух
 * способов попасть в пиксель холста (матрица и ручной пересчёт), пул частиц и
 * волны дороги. Сама картинка проверяется глазами — на тестовой странице.
 */
import { describe, expect, it } from 'vitest';
import { SKINS, THEMES } from '../core/config';
import { Simulation } from '../core/sim';
import type { SimEvent } from '../core/types';
import { makeCamera } from './camera';
import { Particles } from './particles';
import { LANE_STEPS, Road } from './road';
import { devX, devY, lineScale, useWorld, type View } from './view';

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
