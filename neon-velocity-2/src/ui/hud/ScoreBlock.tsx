import { AnimatePresence, motion } from 'framer-motion';
import { memo, useRef } from 'react';
import { GAME } from '../../core/config';
import { BARS_PER_LEVEL } from '../../core/timing';
import { formatSpeed } from '../kit/format';
import { pulse, useBeat } from './pulse';
import { ScoreDigits } from './ScoreDigits';

export interface ScoreBlockProps {
  score: number;
  /** Идёт OVERDRIVE: очки удваиваются, счёт «раскаляется». */
  overdrive: boolean;
}

/** SCORE — главный счётчик: крупно, моноширинно, с приглушёнными ведущими нулями. */
export const ScoreBlock = memo(function ScoreBlock({ score, overdrive }: ScoreBlockProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="nvh-label text-ink-dim">Score</span>
        <AnimatePresence>
          {overdrive && (
            <motion.span
              key="od"
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ type: 'spring', stiffness: 520, damping: 18 }}
              className="-my-1 rounded-[2px] bg-neon-yellow px-1 text-[9px] font-black leading-[1.5] text-void shadow-[0_0_10px_rgba(255,233,74,0.7)]"
            >
              ×{GAME.combo.overdriveBonus}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <ScoreDigits
        value={score}
        className={`nvh-score transition-colors duration-200 ${overdrive ? 'text-neon-yellow text-glow-yellow' : 'text-ink text-glow-soft'}`}
      />
    </div>
  );
});

export interface LevelStripProps {
  level: number;
  speedMult: number;
  /** 0..1 — прогресс уровня. */
  levelProgress: number;
}

/**
 * Уровень скорости: «LV N · SPEED ×1.13» и полоса из восьми ячеек — по одной
 * на такт уровня. Полоса вспыхивает в долю, на восьмом такте (разгон к дропу)
 * мигает жёлтым.
 */
export const LevelStrip = memo(function LevelStrip({ level, speedMult, levelProgress }: LevelStripProps) {
  const bar = useRef<HTMLDivElement>(null);
  useBeat((beat) => {
    pulse(bar.current, [{ filter: `brightness(${beat.beatInBar === 0 ? 2.2 : 1.55})` }, { filter: 'brightness(1)' }], 300);
  });

  const bars = levelProgress * BARS_PER_LEVEL;
  const done = Math.min(Math.floor(bars + 1e-6), BARS_PER_LEVEL - 1);
  const part = Math.min(Math.max(bars - done, 0), 1);

  return (
    <div className="flex flex-col gap-1">
      <div className="nvh-level-text flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-ink-dim">LV</span>
        <span className="nvh-digits text-theme-b">{level}</span>
        <span aria-hidden className="text-ink-faint">
          ·
        </span>
        <span className="nvh-speed-word text-ink-dim">SPEED</span>
        <span className="nvh-digits text-ink">{formatSpeed(speedMult)}</span>
      </div>
      <div ref={bar} aria-hidden className="nvh-level-bar" data-drop={done === BARS_PER_LEVEL - 1 || undefined}>
        {Array.from({ length: BARS_PER_LEVEL }, (_, i) => (
          <span key={i} className="nvh-level-cell">
            <span className="nvh-level-fill" style={{ transform: `scaleX(${i < done ? 1 : i === done ? part : 0})` }} />
          </span>
        ))}
      </div>
    </div>
  );
});
