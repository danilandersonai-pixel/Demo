/**
 * Экран паузы: затемнённый замерший кадр и стеклянная неоновая карточка. Сцена под ним не
 * обновляется (GameCanvas рисует без update), звук приглушён.
 */
import { motion, useIsPresent } from 'framer-motion';
import { Hand, House, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useHudSnapshot } from '../game/hudStore';
import { HIDE_KBD_ON_PHONE } from './hud/constants';
import { NeonCard } from './hud/NeonCard';
import { isCoarsePointer } from './hud/pointer';
import { ScoreDigits } from './hud/ScoreDigits';
import './hud/hud.css';
import { formatSpeed } from './ui/format';
import { IconButton } from './ui/IconButton';
import { Kbd } from './ui/Kbd';
import { NeonButton } from './ui/NeonButton';
import { Overlay } from './ui/Overlay';

export interface PauseOverlayProps {
  onResume(): void;
  onRestart(): void;
  onMenu(): void;
  soundOn: boolean;
  onToggleSound(): void;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <span className="text-[9px] font-bold tracking-[0.3em] text-ink-faint">{label}</span>
      <span className="nv-digits truncate text-sm font-bold tracking-wider text-ink">{children}</span>
    </div>
  );
}

export function PauseOverlay({ onResume, onRestart, onMenu, soundOn, onToggleSound }: PauseOverlayProps) {
  const titleId = useId();
  const hud = useHudSnapshot();
  const [touch] = useState(isCoarsePointer);
  // Пауза уже уходит (анимация выхода): «Заново» и «В меню» не ловят клики.
  const isPresent = useIsPresent();

  return (
    <Overlay blur="md" label="Пауза" className={isPresent ? '' : 'pointer-events-none'}>
      <NeonCard
        accent="cyan"
        labelledBy={titleId}
        className="max-w-sm [@media(max-height:560px)_and_(orientation:landscape)]:max-w-md"
      >
        <div className="absolute right-3 top-3">
          <IconButton
            icon={soundOn ? Volume2 : VolumeX}
            label={soundOn ? 'Выключить звук' : 'Включить звук'}
            aria-pressed={soundOn}
            variant={soundOn ? 'cyan' : 'ghost'}
            size="sm"
            // Свой щелчок здесь звучал бы при старой настройке: включение — в
            // заглушённый микшер, выключение — обрезанный затуханием.
            sound={null}
            onClick={onToggleSound}
          />
        </div>

        {/* Низкий экран (телефон боком): без знака паузы и подсказок, кнопки плотнее — карточка влезает без прокрутки. */}
        <div className="flex flex-col items-center px-5 pb-5 pt-8 sm:px-7 sm:pb-6 [@media(max-height:560px)_and_(orientation:landscape)]:pb-4 [@media(max-height:560px)_and_(orientation:landscape)]:pt-5">
          {/* Две неоновые полосы знака паузы. */}
          <div className="mb-3 flex gap-2 [@media(max-height:560px)_and_(orientation:landscape)]:hidden" aria-hidden>
            {[0, 1].map((i) => (
              <motion.span
                key={i}
                className="h-7 w-2.5 rounded-[1px] bg-neon-cyan shadow-[0_0_12px_#22f0ff]"
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ delay: 0.1 + i * 0.08, type: 'spring', stiffness: 500, damping: 20 }}
              />
            ))}
          </div>
          <h2
            id={titleId}
            className="animate-flicker [animation-iteration-count:2] pl-[0.35em] font-display text-4xl font-black tracking-[0.35em] text-neon-cyan text-glow-cyan sm:text-5xl [@media(max-height:560px)_and_(orientation:landscape)]:text-3xl"
          >
            PAUSE
          </h2>
          <p className="mt-2 text-[10px] font-semibold tracking-[0.35em] text-ink-dim">ЗАБЕГ ОСТАНОВЛЕН</p>

          <div className="mt-5 grid w-full grid-cols-3 gap-2 rounded-[3px] border border-white/10 bg-void/45 px-2 py-3 [@media(max-height:560px)_and_(orientation:landscape)]:mt-3 [@media(max-height:560px)_and_(orientation:landscape)]:py-2">
            <Stat label="SCORE">
              <ScoreDigits value={hud.score} digitsClassName="text-white" />
            </Stat>
            <Stat label="COMBO">
              <span className={hud.multiplier > 1 ? 'text-neon-pink' : 'text-ink-dim'}>x{hud.multiplier}</span>
            </Stat>
            <Stat label="LEVEL">
              <span className="text-theme-a">{hud.level}</span>
              <span className="text-ink-faint"> · </span>
              <span className="text-neon-cyan">{formatSpeed(hud.speedMult)}</span>
            </Stat>
          </div>

          <div
            className={`mt-5 flex w-full flex-col gap-2.5 ${HIDE_KBD_ON_PHONE} [@media(max-height:560px)_and_(orientation:landscape)]:mt-3 [@media(max-height:560px)_and_(orientation:landscape)]:grid [@media(max-height:560px)_and_(orientation:landscape)]:grid-cols-2 [@media(max-height:560px)_and_(orientation:landscape)]:gap-2`}
          >
            <NeonButton
              variant="cyan"
              size="lg"
              icon={Play}
              hotkey="Esc"
              fullWidth
              autoFocus
              className="[@media(max-height:560px)_and_(orientation:landscape)]:col-span-2 [@media(max-height:560px)_and_(orientation:landscape)]:h-12"
              onClick={onResume}
            >
              Продолжить
            </NeonButton>
            <NeonButton variant="pink" icon={RotateCcw} hotkey="R" fullWidth onClick={onRestart}>
              Заново
            </NeonButton>
            <NeonButton variant="ghost" icon={House} hotkey="M" fullWidth sound="back" onClick={onMenu}>
              В меню
            </NeonButton>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10px] text-ink-dim [@media(max-height:560px)_and_(orientation:landscape)]:hidden">
            {touch ? (
              <span className="flex items-center gap-1.5">
                <Hand size={13} className="text-neon-cyan" aria-hidden />
                ведите пальцем по экрану
              </span>
            ) : (
              <>
                <span className="flex items-center gap-1">
                  <Kbd>←</Kbd>
                  <Kbd>→</Kbd>
                  <span className="text-ink-faint">/</span>
                  <Kbd>A</Kbd>
                  <Kbd>D</Kbd>
                  <span className="ml-1">или мышь</span>
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>Esc</Kbd>
                  <span className="text-ink-faint">/</span>
                  <Kbd>P</Kbd>
                  <span className="ml-1">пауза</span>
                </span>
              </>
            )}
          </div>
        </div>
      </NeonCard>
    </Overlay>
  );
}
