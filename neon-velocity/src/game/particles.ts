/**
 * Пул частиц. Объекты переиспользуются, чтобы горячий цикл не плодил мусор:
 * умершие частицы уходят в запас и выдаются снова. В `live` — только живые
 * частицы в порядке появления (самые старые — в начале); именно этот массив
 * движок отдаёт рендеру как state.particles.
 */
import { GAME } from './config';
import type { Particle, ParticleShape } from './types';

export class ParticlePool {
  /** Живые частицы, от самых старых к самым новым. */
  readonly live: Particle[] = [];
  /** Лимит одновременно живых частиц. */
  readonly max: number;
  private readonly spare: Particle[] = [];

  constructor(max: number = GAME.particles.max) {
    this.max = Math.max(1, Math.floor(max));
  }

  /**
   * Выпустить частицу. Дополнительные поля (drag, gravity, grow, rotation, spin)
   * сброшены в 0 — вызывающий дописывает их в возвращённый объект, так не
   * нужно создавать объект-описание на каждую частицу.
   * При переполнении перезаписывается самая старая живая частица.
   */
  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    color: string,
    shape: ParticleShape,
  ): Particle {
    let p: Particle;
    if (this.live.length >= this.max) {
      // shift() в V8 для массивов такого размера — обрезка начала без копирования.
      p = this.live.shift() as Particle;
    } else {
      p =
        this.spare.pop() ??
        {
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          life: 0,
          maxLife: 0,
          size: 0,
          color: '',
          drag: 0,
          gravity: 0,
          shape: 'pixel',
          rotation: 0,
          spin: 0,
          grow: 0,
        };
    }
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.color = color;
    p.shape = shape;
    p.drag = 0;
    p.gravity = 0;
    p.rotation = 0;
    p.spin = 0;
    p.grow = 0;
    this.live.push(p);
    return p;
  }

  /** Физика: v *= exp(−drag·dt), vy += gravity·dt, size += grow·dt, life −= dt. */
  update(dt: number): void {
    const live = this.live;
    let w = 0;
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      p.life -= dt;
      if (p.life > 0) {
        if (p.drag !== 0) {
          const k = Math.exp(-p.drag * dt);
          p.vx *= k;
          p.vy *= k;
        }
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.spin * dt;
        p.size += p.grow * dt;
        if (p.size > 0) {
          // Стабильное уплотнение: порядок появления сохраняется.
          live[w++] = p;
          continue;
        }
      }
      if (this.spare.length < this.max) this.spare.push(p);
    }
    live.length = w;
  }

  /**
   * Смена высоты экрана: линия корабля переезжает с pOld на pNew, мир над ней
   * растягивается в k раз (как объекты в GameEngine.resize), а всё, что на
   * линии или ниже, сдвигается вместе с ней без растяжения. Скорости по Y
   * масштабируются в k раз, как скорость падения через heightFactor.
   */
  remapY(k: number, pOld: number, pNew: number): void {
    const live = this.live;
    const shift = pNew - pOld;
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      p.y = p.y < pOld ? pNew - k * (pOld - p.y) : p.y + shift;
      p.vy *= k;
    }
  }

  clear(): void {
    for (let i = 0; i < this.live.length; i++) {
      if (this.spare.length < this.max) this.spare.push(this.live[i]);
    }
    this.live.length = 0;
  }
}
