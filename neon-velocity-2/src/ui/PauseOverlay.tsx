/**
 * Экран паузы: размытый стоп-кадр забега (под ним холст заморожен, HUD стоит)
 * и неоновая карточка с короткой сводкой и действиями. Заново и выход в меню
 * завершают забег — его результат засчитывается (см. GameHost).
 */
import { motion, useIsPresent } from 'framer-motion';
import { Home, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useId, useRef } from 'react';
import { HIDE_KBD_ON_TOUCH } from './hud/constants';
import './hud/hud.css';
import { ScoreDigits } from './hud/ScoreDigits';
import { useHudSnapshot } from './hudStore';
import { CrystalCount } from './kit/CrystalCount';
import { formatSpeed } from './kit/format';
import { IconButton } from './kit/IconButton';
import { NeonButton } from './kit/NeonButton';
import { Overlay } from './kit/Overlay';
import { useDialogFocus } from './kit/useDialogFocus';

export interface PauseOverlayProps {
  soundOn: boolean;
  onToggleSound(): void;
  onResume(): void;
  /** Начать забег заново (текущий засчитывается). */
  onRestart(): void;
  /** Выйти в меню (текущий забег засчитывается). */
  onMenu(): void;
}

const CORNERS = [
  '-left-1 -top-1 border-l-2 border-t-2',
  '-right-1 -top-1 border-r-2 border-t-2',
  '-bottom-1 -left-1 border-b-2 border-l-2',
  '-bottom-1 -right-1 border-b-2 border-r-2',
];

export function PauseOverlay({ soundOn, onToggleSound, onResume, onRestart, onMenu }: PauseOverlayProps) {
  const hud = useHudSnapshot();
  // Уходящая пауза (анимация выхода) инертна: её «В меню» не оборвёт забег, который уже продолжился.
  const isPresent = useIsPresent();
  const titleId = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const resume = useRef<HTMLButtonElement>(null);
  useDialogFocus(anchor, resume);

  return (
    <Overlay blur="md" label="Пауза" inert={!isPresent} className={isPresent ? '' : 'pointer-events-none'}>
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ opacity: 0, y: 26, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26, opacity: { type: 'tween', duration: 0.22, ease: 'easeOut' } }}
        className="relative w-full max-w-sm rounded-[4px] bg-[linear-gradient(180deg,rgba(20,18,42,0.9),rgba(8,7,20,0.94))] font-mono leading-normal box-glow-cyan [@media(max-height:560px)]:max-w-2xl"
      >
        {CORNERS.map((c) => (
          <span key={c} aria-hidden className={`pointer-events-none absolute h-4 w-4 border-neon-cyan ${c}`} />
        ))}

        <IconButton
          icon={soundOn ? Volume2 : VolumeX}
          label={soundOn ? 'Выключить звук' : 'Включить звук'}
          aria-pressed={soundOn}
          variant={soundOn ? 'cyan' : 'ghost'}
          size="sm"
          // Свой щелчок прозвучал бы по старой настройке; включение подтверждает звуковой движок.
          sound={null}
          onClick={onToggleSound}
          // На низком экране правый верхний угол занят кнопкой «Продолжить».
          className="absolute right-3 top-3 [@media(max-height:560px)]:left-3 [@media(max-height:560px)]:right-auto"
        />

        <div
          ref={anchor}
          className="flex flex-col gap-5 px-5 pb-5 pt-6 sm:px-7 sm:pb-6 sm:pt-7 [@media(max-height:560px)]:flex-row [@media(max-height:560px)]:items-center [@media(max-height:560px)]:gap-6 [@media(max-height:560px)]:px-5 [@media(max-height:560px)]:py-4"
        >
          <div className="flex min-w-0 flex-1 flex-col items-center gap-4 [@media(max-height:560px)]:gap-3">
            <div className="flex flex-col items-center gap-1.5">
              <motion.h2
                id={titleId}
                initial={{ letterSpacing: '0.7em' }}
                animate={{ letterSpacing: '0.3em' }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                // На 320 px заголовок мельче: иначе его правый край уходит под кнопку звука.
                className="m-0 pl-[0.3em] font-display text-4xl font-black leading-none text-neon-cyan text-glow-cyan max-[359px]:text-[1.75rem] sm:text-5xl [@media(max-height:560px)]:text-4xl"
              >
                PAUSE
              </motion.h2>
              <p className="m-0 text-[11px] tracking-[0.2em] text-ink-dim">ЗАБЕГ ОСТАНОВЛЕН</p>
            </div>

            <dl className="m-0 grid w-full grid-cols-3 gap-2 text-center">
              <div className="flex flex-col items-center gap-1 rounded-[3px] border border-white/10 bg-white/[0.03] px-1 py-2">
                <dt className="nvh-label text-ink-dim">Score</dt>
                <dd className="m-0">
                  <ScoreDigits value={hud.score} width={1} className="text-sm font-bold text-ink sm:text-base" />
                </dd>
              </div>
              <div className="flex flex-col items-center gap-1 rounded-[3px] border border-white/10 bg-white/[0.03] px-1 py-2">
                <dt className="nvh-label text-ink-dim">Level</dt>
                <dd className="nvh-digits m-0 whitespace-nowrap text-sm font-bold text-theme-b sm:text-base">
                  {hud.level}
                  <span className="ml-1.5 text-[10px] font-semibold text-ink-dim sm:text-xs">{formatSpeed(hud.speedMult)}</span>
                </dd>
              </div>
              <div className="flex flex-col items-center gap-1 rounded-[3px] border border-white/10 bg-white/[0.03] px-1 py-2">
                <dt className="nvh-label text-ink-dim">Combo</dt>
                <dd className={`nvh-digits m-0 text-sm font-bold sm:text-base ${hud.multiplier > 1 ? 'text-neon-yellow' : 'text-ink'}`}>
                  x{hud.multiplier}
                </dd>
              </div>
            </dl>

            <div className="flex items-center gap-2 text-[11px] tracking-wide text-ink-dim">
              <span>Собрано за забег</span>
              <CrystalCount value={hud.crystals} size="sm" />
            </div>
          </div>

          <div className={`flex min-w-0 flex-1 flex-col gap-2.5 ${HIDE_KBD_ON_TOUCH}`}>
            <NeonButton ref={resume} variant="cyan" size="lg" icon={Play} hotkey="Esc" fullWidth onClick={onResume}>
              Продолжить
            </NeonButton>
            <div className="grid grid-cols-2 gap-2.5">
              <NeonButton variant="ghost" icon={RotateCcw} hotkey="R" fullWidth onClick={onRestart} className="px-2!">
                Заново
              </NeonButton>
              <NeonButton variant="ghost" icon={Home} hotkey="M" sound="back" fullWidth onClick={onMenu} className="px-2!">
                В меню
              </NeonButton>
            </div>
            <p className="m-0 text-center text-[10px] leading-snug tracking-wide text-ink-faint">
              «Заново» и «В меню» завершают забег — очки и кристаллы будут засчитаны
            </p>
          </div>
        </div>
      </motion.section>
    </Overlay>
  );
}
