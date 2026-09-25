import { motion, useReducedMotionConfig } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { rand, TAU } from '../../game/math';

interface BurstParticle {
  dx: number;
  dy: number;
  /** Сторона пикселя или длина искры, px. */
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
const BURST_MS = 1150;
const MIN_PARTICLES = 18;
const MAX_PARTICLES = 24;

function makeParticles(colors: readonly string[], width: number): BurstParticle[] {
  const count = MIN_PARTICLES + Math.floor(Math.random() * (MAX_PARTICLES - MIN_PARTICLES + 1));
  // Кнопки широкие — разлёт по горизонтали больше, чтобы взрыв «вышел» из всей кнопки.
  const stretch = Math.min(1.8, Math.max(1.1, width / 90));
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * TAU + rand(-0.22, 0.22);
    const dist = rand(44, 118);
    return {
      dx: Math.cos(angle) * dist * stretch,
      dy: Math.sin(angle) * dist - 12,
      size: rand(3, 7),
      color: colors[i % colors.length],
      spark: i % 3 === 0,
      angle,
      duration: rand(0.6, 1),
      delay: rand(0, 0.06),
    };
  });
}

function BurstView({ burst }: { burst: Burst }) {
  const main = burst.colors[0] ?? '#ffffff';
  return (
    <div className="absolute" style={{ left: burst.x, top: burst.y }}>
      {/* Вспышка в точке покупки. */}
      <motion.span
        className="absolute -left-10 -top-10 h-20 w-20 rounded-full"
        style={{ background: `radial-gradient(circle, #ffffff 0%, ${main} 30%, transparent 70%)` }}
        initial={{ opacity: 0.95, scale: 0.4 }}
        animate={{ opacity: 0, scale: 1.8 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      />
      {/* Ударная волна. */}
      <motion.span
        className="absolute -left-6 -top-6 h-12 w-12 rounded-full border-2"
        style={{ borderColor: main, boxShadow: `0 0 14px ${main}, inset 0 0 10px ${main}` }}
        initial={{ opacity: 1, scale: 0.3 }}
        animate={{ opacity: 0, scale: 3.4 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />
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
            boxShadow: `0 0 8px ${p.color}, 0 0 2px #ffffff`,
            rotate: p.spark ? (p.angle * 180) / Math.PI : 0,
          }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          // Разлёт с затуханием скорости и лёгким «падением» в конце — как частицы на холсте.
          animate={{ x: [0, p.dx * 0.82, p.dx], y: [0, p.dy * 0.82, p.dy + 26], opacity: [1, 1, 0], scale: [1, 0.9, 0.3] }}
          transition={{ duration: p.duration, delay: p.delay, times: [0, 0.55, 1], ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

export interface PurchaseBurstApi {
  /** Взорвать частицами из центра элемента (обычно — кнопки «Купить»). */
  fire(from: HTMLElement | null, colors: readonly string[]): void;
  /** Слой с частицами: портал в body поверх панели. Вставьте в разметку компонента. */
  layer: ReactNode;
}

/**
 * Взрыв неоновых частиц при покупке. Слой — портал в body над панелями
 * (z-45), поэтому частицы не обрезаются прокруткой панели.
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
    (from: HTMLElement | null, colors: readonly string[]) => {
      // При «уменьшить движение» частицы не летят — карточка просто вспыхивает.
      if (!from || reduce) return;
      const r = from.getBoundingClientRect();
      const id = nextId.current++;
      const burst: Burst = {
        id,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        colors,
        particles: makeParticles(colors, r.width),
      };
      setBursts((list) => [...list, burst]);
      const t = setTimeout(() => {
        timers.current.delete(t);
        setBursts((list) => list.filter((b) => b.id !== id));
      }, BURST_MS);
      timers.current.add(t);
    },
    [reduce],
  );

  const layer =
    bursts.length > 0 && typeof document !== 'undefined'
      ? createPortal(
          <div aria-hidden className="pointer-events-none fixed inset-0 z-[45] overflow-hidden">
            {bursts.map((b) => (
              <BurstView key={b.id} burst={b} />
            ))}
          </div>,
          document.body,
        )
      : null;

  return { fire, layer };
}
