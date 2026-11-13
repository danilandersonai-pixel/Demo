/**
 * «Сочная» отдача: рецепты вспышек частиц поверх пула. Все числа здесь —
 * чисто косметическая настройка (скорости разлёта, время жизни, размеры);
 * баланс игры живёт в config.ts.
 *
 * Цвета берутся только из темы/скина плюс их «раскалённые» варианты и белый:
 * рендер кэширует спрайты свечения по цвету, поэтому палитра должна быть
 * маленькой — никаких случайных смешанных оттенков на каждую частицу.
 */
import { WORLD_W } from './config';
import { lighten, rand, TAU } from './math';
import type { ParticlePool } from './particles';
import type { Obstacle } from './types';

const WHITE = '#ffffff';

export class Fx {
  private readonly hotCache = new Map<string, string>();

  constructor(private readonly pool: ParticlePool) {}

  /** Раскалённый (почти белый) вариант цвета, с кэшем. */
  private hot(color: string): string {
    let h = this.hotCache.get(color);
    if (h === undefined) {
      h = lighten(color, 0.6);
      this.hotCache.set(color, h);
    }
    return h;
  }

  /** Россыпь пикселей во все стороны. */
  private pixels(
    x: number,
    y: number,
    count: number,
    speedMin: number,
    speedMax: number,
    lifeMin: number,
    lifeMax: number,
    color: string,
    alt: string,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      // Квадрат случайной величины — больше медленных частиц у центра, «ядро» взрыва плотнее.
      const u = Math.random();
      const sp = speedMin + (speedMax - speedMin) * u * u;
      const p = this.pool.spawn(
        x,
        y,
        Math.cos(a) * sp,
        Math.sin(a) * sp,
        rand(lifeMin, lifeMax),
        rand(1.8, 4.2),
        i % 3 === 0 ? alt : color,
        'pixel',
      );
      p.drag = 2.6;
      p.gravity = 55;
      p.rotation = rand(0, TAU);
      p.spin = rand(-9, 9);
    }
  }

  /** Искры-штрихи: длина вдоль направления полёта. */
  private sparks(
    x: number,
    y: number,
    count: number,
    angle: number,
    spread: number,
    speedMin: number,
    speedMax: number,
    color: string,
    alt: string,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-spread, spread);
      const sp = rand(speedMin, speedMax);
      const p = this.pool.spawn(
        x,
        y,
        Math.cos(a) * sp,
        Math.sin(a) * sp,
        rand(0.25, 0.6),
        rand(7, 16),
        i % 2 === 0 ? color : alt,
        'spark',
      );
      p.rotation = a;
      p.drag = 3.8;
      p.gravity = 120;
      p.grow = -10;
    }
  }

  private ring(x: number, y: number, size: number, grow: number, life: number, color: string): void {
    const p = this.pool.spawn(x, y, 0, 0, life, size, color, 'ring');
    p.grow = grow;
  }

  private glow(x: number, y: number, size: number, grow: number, life: number, color: string): void {
    const p = this.pool.spawn(x, y, 0, 0, life, size, color, 'glow');
    p.grow = grow;
  }

  /** Сбор сферы: 24 (редкая — 38) пикселя, кольцо-волна и короткая вспышка ядра. */
  collect(x: number, y: number, color: string, rare: boolean): void {
    const hot = this.hot(color);
    this.pixels(x, y, rare ? 38 : 24, 60, rare ? 320 : 240, 0.35, rare ? 0.9 : 0.7, color, hot);
    this.ring(x, y, 6, rare ? 210 : 150, rare ? 0.5 : 0.38, color);
    this.glow(x, y, rare ? 34 : 24, -50, 0.24, hot);
    if (rare) {
      this.ring(x, y, 4, 320, 0.32, WHITE);
      this.sparks(x, y, 14, -Math.PI / 2, Math.PI, 180, 380, hot, WHITE);
    }
  }

  /** Сфера, «собранная» автопилотом в меню: тише и мельче. */
  attractPop(x: number, y: number, color: string): void {
    this.pixels(x, y, 12, 40, 160, 0.3, 0.55, color, this.hot(color));
    this.ring(x, y, 5, 110, 0.3, color);
  }

  /** Рост множителя комбо: кольцо и искры вверх. */
  comboUp(x: number, y: number, color: string): void {
    this.ring(x, y, 14, 170, 0.45, color);
    this.sparks(x, y, 12, -Math.PI / 2, 0.9, 160, 320, color, this.hot(color));
  }

  /** Почти задел: пучок мелких искр в сторону препятствия. */
  nearMiss(x: number, y: number, dir: number, color: string): void {
    const angle = dir >= 0 ? -0.35 : Math.PI + 0.35;
    this.sparks(x + dir * 10, y, 10, angle, 0.7, 140, 300, color, WHITE);
    this.ring(x + dir * 12, y, 4, 90, 0.22, color);
  }

  /** Срыв щита: дождь искр, двойная волна и осколки. */
  shieldBreak(x: number, y: number, color: string): void {
    const hot = this.hot(color);
    this.sparks(x, y, 46, -Math.PI / 2, Math.PI, 220, 560, hot, WHITE);
    this.pixels(x, y, 18, 80, 260, 0.4, 0.8, color, hot);
    this.ring(x, y, 12, 320, 0.5, color);
    this.ring(x, y, 8, 180, 0.65, WHITE);
    this.glow(x, y, 46, -60, 0.3, hot);
  }

  /** Препятствие разлетается (щит или смерть). Лазер осыпается вдоль всего луча. */
  shatter(o: Obstacle, color: string): void {
    const hot = this.hot(color);
    if (o.kind === 'laser') {
      const left = o.x - o.gapW / 2;
      const right = o.x + o.gapW / 2;
      const span = left + (WORLD_W - right);
      for (let i = 0; i < 40; i++) {
        const s = Math.random() * span;
        const px = s < left ? s : right + (s - left);
        const p = this.pool.spawn(px, o.y, rand(-40, 40), rand(-110, 110), rand(0.3, 0.7), rand(1.8, 3.6), i % 3 === 0 ? hot : color, 'pixel');
        p.drag = 3;
        p.gravity = 90;
        p.spin = rand(-8, 8);
      }
      return;
    }
    this.pixels(o.x, o.y, 28, 70, 300, 0.4, 0.85, color, hot);
    this.ring(o.x, o.y, o.size * 0.8, 200, 0.4, color);
  }

  /**
   * Взрыв корабля: 124 пикселя, 40 искр, три ударные волны и вспышка.
   * accent — неон темы: у бледных корпусов (призрак, сингулярность) взрыв
   * иначе выходит почти белым.
   */
  death(x: number, y: number, hull: string, core: string, hit: string, accent: string): void {
    const hotHull = this.hot(hull);
    this.pixels(x, y, 52, 60, 540, 0.6, 1.6, hull, hotHull);
    this.pixels(x, y, 36, 40, 380, 0.5, 1.3, hit, core);
    this.pixels(x, y, 24, 90, 500, 0.6, 1.5, accent, this.hot(accent));
    this.pixels(x, y, 12, 120, 620, 0.4, 1.0, WHITE, hotHull);
    this.sparks(x, y, 40, -Math.PI / 2, Math.PI, 260, 700, hotHull, WHITE);
    this.ring(x, y, 10, 260, 0.6, hull);
    this.ring(x, y, 8, 420, 0.8, accent);
    this.ring(x, y, 6, 620, 1.0, hit);
    this.glow(x, y, 60, 140, 0.35, WHITE);
    this.glow(x, y, 34, 50, 0.8, hull);
  }

  /** Новый уровень скорости: большая волна от корабля. */
  levelUp(x: number, y: number, color: string): void {
    this.ring(x, y, 20, 560, 0.75, color);
    this.ring(x, y, 12, 360, 0.6, this.hot(color));
    this.sparks(x, y, 20, -Math.PI / 2, 1.2, 200, 460, color, WHITE);
  }

  /** Рекорд побит: золотой фейерверк. */
  newRecord(x: number, y: number, color: string): void {
    const hot = this.hot(color);
    this.pixels(x, y, 40, 100, 420, 0.6, 1.2, color, hot);
    this.ring(x, y, 16, 380, 0.7, color);
    this.ring(x, y, 10, 240, 0.9, WHITE);
  }

  /** Демо-объекты растворяются при старте забега. */
  dissolve(x: number, y: number, color: string): void {
    this.pixels(x, y, 10, 30, 150, 0.3, 0.6, color, this.hot(color));
  }

  /** Короткий выхлоп двигателя: капли летят назад и гаснут. */
  exhaust(x: number, y: number, color: string, core: string): void {
    const p = this.pool.spawn(
      x + rand(-1.5, 1.5),
      y,
      rand(-18, 18),
      rand(170, 270),
      rand(0.09, 0.18),
      rand(3, 5),
      Math.random() < 0.4 ? core : color,
      'glow',
    );
    p.grow = -22;
  }

  /** Частица неонового шлейфа: остаётся в мире и сползает вниз, рисуя след манёвров. */
  trail(x: number, y: number, vx: number, color: string, index: number): void {
    const glow = index % 3 === 0;
    const p = this.pool.spawn(
      x + rand(-2, 2),
      y + rand(-1, 2),
      -vx * 0.08 + rand(-10, 10),
      rand(150, 200),
      rand(0.45, 0.75),
      glow ? rand(4.5, 6.5) : rand(2, 3.4),
      index % 4 === 1 ? this.hot(color) : color,
      glow ? 'glow' : 'pixel',
    );
    p.drag = 1.1;
    p.grow = glow ? -6 : -2.5;
    p.spin = rand(-6, 6);
  }
}
