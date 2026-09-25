import { AnimatePresence, motion, useAnimate } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { GAME } from '../../game/config';

export interface ComboMeterProps {
  multiplier: number;
  chain: number;
  /** 0..1 — прогресс цепочки до следующего множителя. */
  chainProgress: number;
}

/** Сколько миллисекунд множитель горит красным после сброса. */
const BREAK_MS = 700;

/** Цвет множителя растёт вместе с ним: серый → бирюза → маджента → жёлтый. */
function tone(multiplier: number): string {
  if (multiplier >= 7) return 'text-neon-yellow text-glow-yellow';
  if (multiplier >= 4) return 'text-neon-pink text-glow-pink';
  if (multiplier >= 2) return 'text-neon-cyan text-glow-cyan';
  return 'text-ink-dim';
}

function segmentTone(multiplier: number): string {
  if (multiplier >= GAME.combo.maxMultiplier) return 'bg-neon-yellow shadow-[0_0_8px_#ffe94a]';
  if (multiplier >= 4) return 'bg-neon-pink shadow-[0_0_8px_#ff2bd6]';
  return 'bg-neon-cyan shadow-[0_0_8px_#22f0ff]';
}

/**
 * Центр HUD: COMBO xN. При росте множителя — пружинный «поп» и кольцо-волна,
 * при сбросе цепочки — красная дрожь. Полоска из GAME.combo.step сегментов
 * показывает, сколько сфер осталось до следующего множителя.
 */
export function ComboMeter({ multiplier, chain, chainProgress }: ComboMeterProps) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const prev = useRef({ multiplier, chain });
  const [broken, setBroken] = useState(false);
  const [popId, setPopId] = useState(0);

  useEffect(() => {
    const before = prev.current;
    prev.current = { multiplier, chain };
    const el = scope.current;
    if (!el) return;
    if (multiplier > before.multiplier) {
      setBroken(false);
      setPopId((n) => n + 1);
      animate(el, { scale: [1.75, 1] }, { type: 'spring', stiffness: 560, damping: 13 });
      return;
    }
    if (chain < before.chain && before.chain > 0) {
      setBroken(true);
      animate(el, { x: [0, -11, 10, -8, 6, -3, 0], rotate: [0, -4, 4, -2, 0] }, { duration: 0.45, ease: 'easeOut' });
      const t = setTimeout(() => setBroken(false), BREAK_MS);
      return () => clearTimeout(t);
    }
  }, [multiplier, chain, animate, scope]);

  const max = multiplier >= GAME.combo.maxMultiplier;
  const step = GAME.combo.step;
  const filled = max ? step : Math.round(chainProgress * step);

  return (
    <div className="relative flex flex-col items-center">
      <span className={['text-[9px] font-bold tracking-[0.4em] sm:text-[11px]', broken ? 'text-neon-red' : 'text-neon-pink/80'].join(' ')}>
        COMBO
      </span>
      <div className="relative flex items-center justify-center">
        {/* Кольцо-волна при росте множителя. */}
        <AnimatePresence>
          {popId > 0 && (
            <motion.span
              key={popId}
              aria-hidden
              initial={{ opacity: 0.9, scale: 0.4 }}
              animate={{ opacity: 0, scale: 2.4 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              className="pointer-events-none absolute h-10 w-10 rounded-full border-2 border-neon-pink shadow-[0_0_14px_#ff2bd6] sm:h-14 sm:w-14"
            />
          )}
        </AnimatePresence>
        <div
          ref={scope}
          className={[
            'nv-digits font-display text-[30px] font-black leading-[1.05] tracking-wider sm:text-5xl',
            broken ? 'text-neon-red text-glow-red' : tone(multiplier),
          ].join(' ')}
        >
          x{multiplier}
        </div>
      </div>
      <div className="mt-1 flex gap-1" aria-hidden>
        {Array.from({ length: step }, (_, i) => (
          <span
            key={i}
            className={[
              'h-1 w-3.5 rounded-[1px] transition-colors duration-150 sm:h-1.5 sm:w-5',
              broken ? 'bg-neon-red/40' : i < filled ? segmentTone(multiplier) : 'bg-white/12',
            ].join(' ')}
          />
        ))}
      </div>
      <span className="sr-only">
        Множитель комбо x{multiplier}, цепочка {chain}
      </span>
      {max && (
        <span className="nv-record-flicker mt-1 text-[8px] font-black tracking-[0.3em] text-neon-yellow text-glow-yellow sm:text-[10px]">
          MAX
        </span>
      )}
    </div>
  );
}
