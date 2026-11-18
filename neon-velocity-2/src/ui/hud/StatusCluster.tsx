import { AnimatePresence, motion } from 'framer-motion';
import { Pause, Shield, ShieldOff } from 'lucide-react';
import { memo } from 'react';
import { CrystalCount } from '../kit/CrystalCount';
import { IconButton } from '../kit/IconButton';
import { ScoreDigits } from './ScoreDigits';

export interface StatusClusterProps {
  /** max(рекорд до забега, текущий счёт). */
  best: number;
  /** Рекорд уже побит в этом забеге. */
  beaten: boolean;
  crystals: number;
  shield: number;
  shieldMax: number;
  canPause: boolean;
  onPause(): void;
}

/** Правый край HUD: BEST, кристаллы забега, заряды щита и пауза — единственная кнопка. */
export const StatusCluster = memo(function StatusCluster({ best, beaten, crystals, shield, shieldMax, canPause, onPause }: StatusClusterProps) {
  return (
    <div className="nvh-right">
      <div className="nvh-right-info">
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            <AnimatePresence>
              {beaten && (
                <motion.span
                  key="new"
                  initial={{ opacity: 0, scale: 0.3, rotate: -12 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 14 }}
                  className="-my-1 rounded-[2px] bg-neon-yellow px-1 text-[8px] font-black leading-[1.6] tracking-[0.12em] text-void shadow-[0_0_10px_rgba(255,233,74,0.7)]"
                >
                  NEW
                </motion.span>
              )}
            </AnimatePresence>
            <span className={`nvh-label -mr-[0.3em] transition-colors duration-300 ${beaten ? 'text-neon-yellow' : 'text-ink-dim'}`}>Best</span>
          </div>
          <ScoreDigits
            value={best}
            className={`nvh-best transition-colors duration-300 ${beaten ? 'text-neon-yellow text-glow-yellow' : 'text-ink-dim'}`}
          />
        </div>

        <div className="flex items-center gap-2">
          {shieldMax > 0 && (
            <span className="flex items-center gap-0.5">
              {Array.from({ length: shieldMax }, (_, i) =>
                i < shield ? (
                  <Shield
                    key={i}
                    size={14}
                    strokeWidth={2.4}
                    fill="currentColor"
                    fillOpacity={0.35}
                    aria-hidden
                    className="text-neon-violet drop-shadow-[0_0_5px_#9d4dff]"
                  />
                ) : (
                  <ShieldOff key={i} size={14} strokeWidth={2.2} aria-hidden className="text-ink-faint" />
                ),
              )}
              <span className="sr-only">
                Щит: {shield} из {shieldMax}
              </span>
            </span>
          )}
          <CrystalCount value={crystals} size="sm" />
        </div>
      </div>

      <IconButton icon={Pause} label="Пауза" variant="cyan" disabled={!canPause} onClick={onPause} className="pointer-events-auto" />
    </div>
  );
});
