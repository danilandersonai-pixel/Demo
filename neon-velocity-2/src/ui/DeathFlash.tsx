/**
 * Вспышка гибели поверх HUD (слой z-20): удар света из точки взрыва, красная
 * рамка «попадания», расходящиеся кольца и осколки. Частицы самого взрыва
 * рисует холст — здесь то, что должно накрыть и интерфейс.
 */
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { EASE_OUT } from './hud/constants';

export interface DeathFlashProps {
  /** Точка взрыва в CSS-пикселях окна. */
  x: number;
  y: number;
  /** Акценты темы — цвета колец и осколков. */
  colors: readonly [string, string, string];
  /** Вспышка отыграла — можно размонтировать. */
  onDone(): void;
}

/** Вся вспышка короче замедленного взрыва (≈ 1.37 с), чтобы не лечь под экран Game Over. */
const TOTAL_MS = 1150;
const RING_COUNT = 3;
const SHARD_COUNT = 16;

interface Shard {
  angle: number;
  distance: number;
  length: number;
  spin: number;
  duration: number;
  color: number;
}

function makeShards(): Shard[] {
  return Array.from({ length: SHARD_COUNT }, (_, i) => ({
    // Равномерно по кругу с разбросом, чтобы веер не выглядел циферблатом.
    angle: ((i + Math.random() * 0.8) / SHARD_COUNT) * Math.PI * 2,
    distance: 110 + Math.random() * 230,
    length: 10 + Math.random() * 16,
    spin: (Math.random() - 0.5) * 540,
    duration: 0.6 + Math.random() * 0.45,
    color: i % 3,
  }));
}

export function DeathFlash({ x, y, colors, onDone }: DeathFlashProps) {
  const reduce = useReducedMotionConfig();
  const [shards] = useState(makeShards);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const timer = window.setTimeout(() => done.current(), TOTAL_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-20 overflow-hidden">
      {/* Удар света из точки взрыва. При «меньше движения» яркой вспышки нет — только кольца. */}
      {!reduce && (
        <motion.div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at ${x}px ${y}px, rgba(255,255,255,0.95) 0, ${colors[0]} 9%, transparent 48%)`,
          }}
          initial={{ opacity: 0.95 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      )}

      {/* Красная рамка «попадания» по краям экрана. */}
      <motion.div
        className="absolute inset-0 shadow-[inset_0_0_90px_24px_rgba(255,59,107,0.55)]"
        initial={{ opacity: 0.9 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.95, ease: 'easeOut' }}
      />

      {/* Горизонтальный росчерк через точку взрыва. */}
      {!reduce && (
        <motion.div
          className="absolute left-0 h-[3px] w-full bg-white shadow-[0_0_18px_4px_rgba(255,255,255,0.7)]"
          style={{ top: y - 1, transformOrigin: `${x}px 50%` }}
          initial={{ scaleX: 0.05, opacity: 1 }}
          animate={{ scaleX: 1, opacity: 0 }}
          transition={{ duration: 0.42, ease: EASE_OUT }}
        />
      )}

      {Array.from({ length: RING_COUNT }, (_, i) => (
        <motion.span
          key={i}
          className="absolute -ml-12 -mt-12 h-24 w-24 rounded-full border-2"
          style={{ left: x, top: y, borderColor: colors[i % 3], boxShadow: `0 0 22px ${colors[i % 3]}, inset 0 0 18px ${colors[i % 3]}` }}
          initial={{ scale: 0.15, opacity: 0.95 }}
          animate={{ scale: 3.2 + i * 2.1, opacity: 0 }}
          transition={{ duration: 0.85 + i * 0.1, delay: i * 0.09, ease: EASE_OUT }}
        />
      ))}

      {!reduce &&
        shards.map((s, i) => (
          <motion.span
            key={i}
            className="absolute -ml-[2px] w-1 rounded-[1px]"
            style={{
              left: x,
              top: y,
              height: s.length,
              marginTop: -s.length / 2,
              background: colors[s.color],
              boxShadow: `0 0 10px ${colors[s.color]}`,
            }}
            initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 1 }}
            animate={{
              x: Math.cos(s.angle) * s.distance,
              y: Math.sin(s.angle) * s.distance,
              rotate: s.spin,
              opacity: 0,
              scale: 0.35,
            }}
            transition={{ duration: s.duration, ease: EASE_OUT, opacity: { duration: s.duration, ease: 'easeIn' } }}
          />
        ))}
    </div>
  );
}
