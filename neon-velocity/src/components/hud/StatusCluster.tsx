import { AnimatePresence, motion } from 'framer-motion';
import { Pause, Shield, ShieldOff } from 'lucide-react';
import { CrystalCount } from '../ui/CrystalCount';
import { formatSpeed } from '../ui/format';
import { IconButton } from '../ui/IconButton';

export interface StatusClusterProps {
  level: number;
  speedMult: number;
  levelProgress: number;
  crystals: number;
  shieldCharges: number;
  maxShieldCharges: number;
  canPause: boolean;
  onPause(): void;
}

/**
 * Правый верхний угол HUD: уровень и скорость с полоской до следующего уровня,
 * кристаллы за забег, заряды щита и кнопка паузы — единственный интерактивный
 * элемент HUD.
 */
export function StatusCluster({
  level,
  speedMult,
  levelProgress,
  crystals,
  shieldCharges,
  maxShieldCharges,
  canPause,
  onPause,
}: StatusClusterProps) {
  return (
    <div className="flex min-w-0 items-start justify-end gap-2 sm:gap-3">
      <div className="flex min-w-0 flex-col items-end">
        {/* При ширине меньше 360 px уровень и скорость встают столбиком — в строку они наезжают на COMBO. */}
        <div className="nv-digits flex items-baseline gap-1.5 whitespace-nowrap text-[10px] font-bold tracking-widest sm:text-xs [@media(max-height:560px)_and_(orientation:landscape)]:text-[10px] max-[359px]:flex-col max-[359px]:items-end max-[359px]:gap-0">
          <motion.span
            key={level}
            initial={{ scale: 1.6, color: '#ffffff' }}
            animate={{ scale: 1, color: 'var(--theme-a)' }}
            transition={{ type: 'spring', stiffness: 420, damping: 16 }}
            className="inline-block origin-right text-glow-theme"
          >
            LV {level}
          </motion.span>
          <span className="text-ink-faint max-[359px]:hidden">·</span>
          <span className="text-neon-cyan">
            <span className="hidden sm:inline">SPEED </span>
            {formatSpeed(speedMult)}
          </span>
        </div>
        {/* Полоска до следующего уровня; key по уровню — без обратной анимации при сбросе в 0. */}
        <div className="mt-1 h-1 w-[5.5rem] overflow-hidden rounded-[1px] bg-white/10 sm:mt-1.5 sm:h-1.5 sm:w-40 [@media(max-height:560px)_and_(orientation:landscape)]:mt-1 [@media(max-height:560px)_and_(orientation:landscape)]:h-1 [@media(max-height:560px)_and_(orientation:landscape)]:w-28">
          <div
            key={level}
            className="h-full w-full origin-left bg-theme-a shadow-[0_0_8px_var(--theme-a)] transition-transform duration-200 ease-linear"
            style={{ transform: `scaleX(${Math.min(1, Math.max(0, levelProgress))})` }}
          />
        </div>
        <div className="mt-1.5 flex items-center gap-2 sm:mt-2 sm:gap-3 [@media(max-height:560px)_and_(orientation:landscape)]:mt-1.5 [@media(max-height:560px)_and_(orientation:landscape)]:gap-2">
          {maxShieldCharges > 0 && (
            <span className="flex items-center gap-0.5" aria-label={`Щит: ${shieldCharges} из ${maxShieldCharges}`}>
              {Array.from({ length: maxShieldCharges }, (_, i) => {
                const on = i < shieldCharges;
                return (
                  <AnimatePresence key={i} mode="wait" initial={false}>
                    <motion.span
                      key={on ? 'on' : 'off'}
                      initial={{ scale: on ? 0.4 : 1.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 1.6, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className={
                        on
                          ? 'text-neon-violet drop-shadow-[0_0_6px_#9d4dff]'
                          : 'text-neon-red/70 drop-shadow-[0_0_4px_#ff3b6b]'
                      }
                    >
                      {on ? (
                        <Shield size={14} strokeWidth={2.5} fill="currentColor" fillOpacity={0.25} aria-hidden />
                      ) : (
                        <ShieldOff size={14} strokeWidth={2.5} aria-hidden />
                      )}
                    </motion.span>
                  </AnimatePresence>
                );
              })}
            </span>
          )}
          <CrystalCount value={crystals} size="sm" />
        </div>
      </div>
      {/* Во время взрыва кнопка прячется, но место держит — HUD не «прыгает». */}
      <IconButton
        icon={Pause}
        label="Пауза (Esc)"
        variant="cyan"
        size="sm"
        disabled={!canPause}
        aria-hidden={!canPause}
        tabIndex={canPause ? 0 : -1}
        className={canPause ? 'pointer-events-auto' : 'invisible'}
        onClick={onPause}
      />
    </div>
  );
}
