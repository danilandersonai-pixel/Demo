/**
 * Вспышка смерти поверх холста (слой z-20): белый кадр, расходящиеся неоновые
 * кольца и осколки из точки взрыва. Холст в это время рисует свой взрыв
 * частицами и слоу-мо — DOM-слой добавляет «удар по глазам», который на
 * Canvas без shadowBlur не сделать. Снимается сам через onDone.
 */
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useEffect, useState } from 'react';
import { rgba } from '../game/math';

export interface DeathFlashProps {
  /** Точка взрыва в CSS-пикселях экрана. */
  x: number;
  y: number;
  /** Цвета колец и осколков — акценты текущей темы. */
  colors: readonly [string, string, string];
  onDone(): void;
}

/** Сколько живёт слой, мс (чуть меньше GAME.death.duration — к Game Over он уже погас). */
const LIFETIME_MS = 1250;
const SHARD_COUNT = 16;

interface Shard {
  dx: number;
  dy: number;
  angle: number;
  length: number;
  delay: number;
  color: string;
}

function makeShards(colors: readonly string[]): Shard[] {
  return Array.from({ length: SHARD_COUNT }, (_, i) => {
    const a = (i / SHARD_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const dist = 110 + Math.random() * 190;
    return {
      dx: Math.cos(a) * dist,
      dy: Math.sin(a) * dist,
      // Осколок летит «остриём вперёд».
      angle: (a * 180) / Math.PI,
      length: 10 + Math.random() * 18,
      delay: Math.random() * 0.06,
      color: colors[i % colors.length],
    };
  });
}

const RINGS = [
  { delay: 0, radius: 150, width: 4, duration: 0.7 },
  { delay: 0.08, radius: 240, width: 3, duration: 0.85 },
  { delay: 0.18, radius: 340, width: 2, duration: 1 },
] as const;

export function DeathFlash({ x, y, colors, onDone }: DeathFlashProps) {
  const reduce = useReducedMotionConfig() ?? false;
  const [shards] = useState(() => makeShards(colors));

  useEffect(() => {
    const t = setTimeout(onDone, LIFETIME_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-20 overflow-hidden">
      {/* Белый кадр; при reduced motion — мягче, без резкого удара по глазам. */}
      <motion.div
        className="absolute inset-0 bg-white"
        initial={{ opacity: reduce ? 0.3 : 0.8 }}
        animate={{ opacity: 0 }}
        transition={{ duration: reduce ? 0.4 : 0.42, ease: [0.05, 0.7, 0.3, 1] }}
      />
      {/* Цветная засветка от точки взрыва. */}
      <motion.div
        className="absolute rounded-full"
        style={{
          left: x - 220,
          top: y - 220,
          width: 440,
          height: 440,
          background: `radial-gradient(closest-side, #ffffff 0%, ${colors[0]} 28%, ${rgba(colors[1], 0.33)} 55%, transparent 100%)`,
          mixBlendMode: 'screen',
        }}
        initial={{ opacity: 1, scale: 0.25 }}
        animate={{ opacity: 0, scale: 1.6 }}
        transition={{ duration: 0.75, ease: 'easeOut' }}
      />

      {!reduce && (
        <>
          <svg className="absolute inset-0 h-full w-full overflow-visible">
            {RINGS.map((ring, i) => {
              const color = colors[i % colors.length];
              return (
                <g key={i}>
                  {/* Широкий полупрозрачный штрих + тонкий яркий — неон без фильтров. */}
                  <motion.circle
                    cx={x}
                    cy={y}
                    fill="none"
                    stroke={color}
                    strokeOpacity={0.35}
                    strokeWidth={ring.width * 4}
                    initial={{ r: 6, opacity: 1 }}
                    animate={{ r: ring.radius, opacity: 0 }}
                    transition={{ duration: ring.duration, delay: ring.delay, ease: [0.16, 1, 0.3, 1] }}
                  />
                  <motion.circle
                    cx={x}
                    cy={y}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={ring.width}
                    initial={{ r: 6, opacity: 1 }}
                    animate={{ r: ring.radius, opacity: 0 }}
                    transition={{ duration: ring.duration, delay: ring.delay, ease: [0.16, 1, 0.3, 1] }}
                  />
                </g>
              );
            })}
          </svg>

          {shards.map((s, i) => (
            <motion.span
              key={i}
              className="absolute block rounded-full"
              style={{
                left: x,
                top: y,
                width: s.length,
                height: 3,
                marginLeft: -s.length / 2,
                marginTop: -1.5,
                background: `linear-gradient(90deg, transparent, ${s.color} 40%, #ffffff)`,
                boxShadow: `0 0 8px ${s.color}`,
              }}
              initial={{ x: 0, y: 0, rotate: s.angle, opacity: 1, scaleX: 0.4 }}
              animate={{ x: s.dx, y: s.dy, rotate: s.angle, opacity: 0, scaleX: 1.4 }}
              transition={{ duration: 0.9, delay: s.delay, ease: [0.16, 1, 0.3, 1] }}
            />
          ))}
        </>
      )}
    </div>
  );
}
