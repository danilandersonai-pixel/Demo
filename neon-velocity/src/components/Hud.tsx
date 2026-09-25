/**
 * Аркадный HUD поверх холста (слой z-10). Читает снимок из hudStore — цикл
 * публикует его не чаще 30 раз в секунду, поэтому React не перерисовывается
 * на каждом кадре. Всё, кроме кнопки паузы, прозрачно для указателя: мышь и
 * палец управляют кораблём прямо сквозь HUD.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useHudSnapshot } from '../game/hudStore';
import { Banners } from './hud/Banners';
import { ComboMeter } from './hud/ComboMeter';
import { ControlHint } from './hud/ControlHint';
import './hud/hud.css';
import { ScoreBlock } from './hud/ScoreBlock';
import { StatusCluster } from './hud/StatusCluster';

export interface HudProps {
  /** Номер забега: счётчики анимаций комбо начинают его с чистого листа. */
  runId: number;
  showFps: boolean;
  /** Первый забег — показать подсказку управления. */
  showHint: boolean;
  /** Подсказка отработала своё время: App отмечает, что игрок её видел. */
  onHintDone(): void;
  onPause(): void;
  /** Пауза недоступна (корабль уже взрывается). */
  canPause: boolean;
}

/** Сколько секунд забега висит подсказка управления. */
const HINT_SECONDS = 7;

function fpsTone(fps: number): string {
  if (fps >= 55) return 'text-neon-green';
  if (fps >= 40) return 'text-neon-yellow';
  return 'text-neon-red';
}

export function Hud({ runId, showFps, showHint, onHintDone, onPause, canPause }: HudProps) {
  const hud = useHudSnapshot();
  const hintReported = useRef(false);
  const hintTimeUp = hud.elapsed >= HINT_SECONDS;

  useEffect(() => {
    if (showHint && hintTimeUp && !hintReported.current) {
      hintReported.current = true;
      onHintDone();
    }
  }, [showHint, hintTimeUp, onHintDone]);

  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-10 select-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {/* Лёгкое затемнение сверху — цифры читаются на любом фоне. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-28 bg-linear-to-b from-void/80 via-void/35 to-transparent sm:h-36" />

      <header className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 px-3 pt-3 sm:gap-4 sm:px-6 sm:pt-5">
        <ScoreBlock score={hud.score} best={hud.highscore} beaten={hud.newRecord} />
        <ComboMeter key={runId} multiplier={hud.multiplier} chain={hud.chain} chainProgress={hud.chainProgress} />
        <StatusCluster
          level={hud.level}
          speedMult={hud.speedMult}
          levelProgress={hud.levelProgress}
          crystals={hud.crystals}
          shieldCharges={hud.shieldCharges}
          maxShieldCharges={hud.maxShieldCharges}
          canPause={canPause}
          onPause={onPause}
        />
      </header>

      <Banners />

      <AnimatePresence>{showHint && !hintTimeUp && <ControlHint key="hint" />}</AnimatePresence>

      {showFps && (
        <div
          className={`nv-digits absolute left-3 text-[10px] font-bold tracking-widest sm:left-5 sm:text-xs ${fpsTone(hud.fps)}`}
          style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
        >
          {hud.fps > 0 ? hud.fps : '--'} FPS
        </div>
      )}
    </motion.div>
  );
}
