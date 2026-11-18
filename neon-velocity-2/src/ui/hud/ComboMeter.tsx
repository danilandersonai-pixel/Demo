import { useAnimate, useReducedMotionConfig } from 'framer-motion';
import { memo, useEffect, useRef } from 'react';
import { GAME } from '../../core/config';
import { pulse, useBeat } from './pulse';

export interface ComboMeterProps {
  multiplier: number;
  /** 0..1 — прогресс до следующего множителя (1 на максимуме). */
  chainProgress: number;
  overdrive: boolean;
}

const CELLS = GAME.combo.step;

/** «Температура» множителя: серый x1 → бирюза → маджента → жёлтый → OVERDRIVE. */
function toneFor(multiplier: number, overdrive: boolean): string {
  if (overdrive) return 'od';
  if (multiplier >= 6) return '3';
  if (multiplier >= 4) return '2';
  if (multiplier >= 2) return '1';
  return '0';
}

/**
 * COMBO: множитель и ячейки до следующего (по одной на сферу). Рост — пружинный
 * «поп», срыв — дрожь и красная вспышка, OVERDRIVE — раскалённая рамка с
 * бегущим светом. Рамка вспыхивает в долю. Все эффекты идут мимо состояния React.
 */
export const ComboMeter = memo(function ComboMeter({ multiplier, chainProgress, overdrive }: ComboMeterProps) {
  const reduce = useReducedMotionConfig();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const value = useRef<HTMLSpanElement>(null);
  const flash = useRef<HTMLSpanElement>(null);
  const shown = useRef(multiplier);

  useEffect(() => {
    const was = shown.current;
    shown.current = multiplier;
    if (multiplier === was || reduce || !scope.current || !value.current) return;
    if (multiplier > was) {
      animate(value.current, { scale: [1.75, 1] }, { type: 'spring', stiffness: 520, damping: 12 });
      pulse(flash.current, [{ opacity: 1, transform: 'scale(1.04)' }, { opacity: 0, transform: 'scale(1.26)' }], 520);
    } else {
      animate(scope.current, { x: [0, -8, 7, -5, 4, -2, 0] }, { duration: 0.42, ease: 'easeOut' });
      pulse(
        flash.current,
        [
          { opacity: 1, boxShadow: '0 0 0 2px #ff3b6b, 0 0 26px #ff3b6b', background: 'rgba(255, 59, 107, 0.35)' },
          { opacity: 0, boxShadow: '0 0 0 2px #ff3b6b, 0 0 26px #ff3b6b', background: 'rgba(255, 59, 107, 0)' },
        ],
        560,
      );
    }
  }, [multiplier, reduce, animate, scope]);

  useBeat((beat) => {
    // На x1 рамка молчит: пульс — награда за комбо, а не фон.
    if (shown.current < 2) return;
    const strong = beat.beatInBar === 0;
    pulse(flash.current, [{ opacity: strong ? 0.9 : 0.55 }, { opacity: 0 }], 380);
  });

  const lit = Math.round(Math.min(Math.max(chainProgress, 0), 1) * CELLS);

  return (
    <div ref={scope} className="nvh-combo" data-tone={toneFor(multiplier, overdrive)}>
      <span ref={flash} aria-hidden className="nvh-combo-flash" />
      <span className={`nvh-label nvh-combo-label ${overdrive ? 'nvh-od-text' : 'text-ink-dim'}`}>{overdrive ? 'Overdrive' : 'Combo'}</span>
      <span ref={value} className="nvh-combo-value nvh-digits font-display">
        x{multiplier}
      </span>
      <div aria-hidden className="nvh-combo-cells">
        {Array.from({ length: CELLS }, (_, i) => (
          <span key={i} className="nvh-combo-cell" data-lit={i < lit || undefined} />
        ))}
      </div>
    </div>
  );
});
