import { motion, useReducedMotionConfig } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TAU } from '../../core/math';
import { EASE_OUT } from './shared';

interface BurstParticle {
  dx: number;
  dy: number;
  /** Сторона пикселя или толщина искры, px. */
  size: number;
  color: string;
  /** Искра — вытянутый штрих по направлению полёта; иначе квадратный пиксель. */
  spark: boolean;
  angle: number;
  duration: number;
  delay: number;
}

interface Burst {
  id: number;
  x: number;
  y: number;
  colors: readonly string[];
  particles: BurstParticle[];
}

/** Сколько живёт один взрыв, мс (с запасом на самую долгую частицу). */
const BURST_MS = 1300;
const PARTICLES = 30;
/** Насколько частицы «проседают» к концу полёта, px. */
const GRAVITY = 26;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function makeParticles(colors: readonly string[], width: number): BurstParticle[] {
  // Кнопки широкие — разлёт по горизонтали больше, чтобы взрыв «вышел» из всей кнопки.
  const stretch = Math.min(1.9, Math.max(1.1, width / 90));
  return Array.from({ length: PARTICLES }, (_, i) => {
    const angle = (i / PARTICLES) * TAU + rand(-0.2, 0.2);
    const dist = rand(46, 128);
    return {
      dx: Math.cos(angle) * dist * stretch,
      dy: Math.sin(angle) * dist - 10,
      size: rand(3, 7),
      color: colors[i % colors.length],
      spark: i % 3 === 0,
      angle,
      duration: rand(0.6, 1.05),
      delay: rand(0, 0.07),
    };
  });
}

function BurstView({ burst }: { burst: Burst }) {
  const main = burst.colors[0] ?? '#ffffff';
  const second = burst.colors[1] ?? main;
  return (
    <div className="absolute" style={{ left: burst.x, top: burst.y }}>
      {/* Вспышка в точке покупки. */}
      <motion.span
        className="absolute -left-12 -top-12 h-24 w-24 rounded-full"
        style={{ background: `radial-gradient(circle, #ffffff 0%, ${main} 32%, transparent 70%)` }}
        initial={{ opacity: 0.95, scale: 0.35 }}
        animate={{ opacity: 0, scale: 1.9 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      />
      {/* Две ударные волны: вторая догоняет первую другим цветом. */}
      {[main, second].map((color, i) => (
        <motion.span
          key={i}
          className="absolute -left-6 -top-6 h-12 w-12 rounded-full border-2"
          style={{ borderColor: color, boxShadow: `0 0 14px ${color}, inset 0 0 10px ${color}` }}
          initial={{ opacity: 1, scale: 0.3 }}
          animate={{ opacity: 0, scale: 3.6 - i * 1.1 }}
          transition={{ duration: 0.62 + i * 0.14, delay: i * 0.09, ease: EASE_OUT }}
        />
      ))}
      {burst.particles.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-[1px]"
          style={{
            left: p.spark ? -p.size * 1.5 : -p.size / 2,
            top: p.spark ? -1 : -p.size / 2,
            width: p.spark ? p.size * 3 : p.size,
            height: p.spark ? 2 : p.size,
            background: p.color,
            boxShadow: `0 0 8px ${p.color}, 0 0 2px #fff`,
            rotate: p.spark ? `${p.angle}rad` : undefined,
          }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          // Затухание: рывок в начале, затем частица тормозит, оседает, тускнеет и сжимается.
          animate={{ x: p.dx, y: [0, p.dy * 0.82, p.dy + GRAVITY], opacity: [1, 1, 0], scale: [1, 0.9, 0.25] }}
          transition={{ duration: p.duration, delay: p.delay, ease: EASE_OUT, times: [0, 0.55, 1] }}
        />
      ))}
    </div>
  );
}

export interface PurchaseBurstApi {
  /** Взрыв из центра элемента (обычно — нажатой кнопки) в цветах покупки. */
  fire(origin: Element | null, colors: readonly string[]): void;
  /** Слой со взрывами: отрендерить один раз где угодно в панели. */
  layer: ReactNode;
}

/**
 * Взрыв неоновых частиц при покупке (Framer Motion). Слой уходит порталом в
 * body: у панели остаётся filter после анимации появления, а он делает её
 * контейнером для position: fixed — без портала координаты съехали бы.
 */
export function usePurchaseBurst(): PurchaseBurstApi {
  const reduce = useReducedMotionConfig();
  const [bursts, setBursts] = useState<Burst[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, []);

  const fire = useCallback(
    (origin: Element | null, colors: readonly string[]) => {
      if (!origin) return;
      const rect = origin.getBoundingClientRect();
      const id = nextId.current++;
      const burst: Burst = {
        id,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        colors,
        // При «уменьшении движения» остаётся только короткая вспышка без разлёта.
        particles: reduce ? [] : makeParticles(colors, rect.width),
      };
      setBursts((list) => [...list, burst]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setBursts((list) => list.filter((b) => b.id !== id));
      }, BURST_MS);
      timers.current.add(timer);
    },
    [reduce],
  );

  const layer =
    bursts.length > 0 && typeof document !== 'undefined'
      ? createPortal(
          <div aria-hidden className="pointer-events-none fixed inset-0 z-45 overflow-hidden">
            {bursts.map((b) => (
              <BurstView key={b.id} burst={b} />
            ))}
          </div>,
          document.body,
        )
      : null;

  return { fire, layer };
}
