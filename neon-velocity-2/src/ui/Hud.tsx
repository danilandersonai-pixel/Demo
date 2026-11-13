/**
 * Аркадный HUD поверх холста (слой z-10). Читает снимок из hudStore — цикл
 * публикует его не чаще 30 раз в секунду, а пульс в долю идёт мимо React
 * (hud/pulse.ts). Всё, кроме кнопки паузы, прозрачно для указателя: мышь и
 * палец ведут корабль прямо сквозь HUD.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { Banners } from './hud/Banners';
import { ComboMeter } from './hud/ComboMeter';
import { ControlHint } from './hud/ControlHint';
import './hud/hud.css';
import { LevelStrip, ScoreBlock } from './hud/ScoreBlock';
import { StatusCluster } from './hud/StatusCluster';
import { useHudSnapshot } from './hudStore';

export interface HudProps {
  /** Номер забега: счётчик комбо начинает его с чистого листа (без «срыва» с прошлого множителя). */
  runId: number;
  showFps: boolean;
  /** Первый забег — показать подсказку управления. */
  showHint: boolean;
  /** Подсказка отработала своё: App отмечает, что игрок её видел. */
  onHintDone(): void;
  onPause(): void;
  /** Пауза доступна (идёт забег и корабль цел). */
  canPause: boolean;
  /**
   * HUD лежит под паузой: он инертен (один диалог для Tab и скринридера), а его
   * бесконечные анимации стоят — под размытым экраном ничто не должно двигаться.
   */
  frozen: boolean;
}

/** Сколько секунд после GO висит подсказка управления. */
const HINT_SECONDS = 6;

/** Нижний отступ как у подсказки управления — FPS стоит на той же линии. */
const BOTTOM_INSET = 'max(0.75rem, env(safe-area-inset-bottom, 0px))';
/** Пока видна подсказка, FPS поднимается над ней: на узком телефоне её плашка во всю ширину. */
const FPS_ABOVE_HINT = `calc(${BOTTOM_INSET} + 2.5rem)`;

function fpsTone(fps: number): string {
  if (fps >= 55) return 'text-neon-green';
  if (fps >= 40) return 'text-neon-yellow';
  return 'text-neon-red';
}

export function Hud({ runId, showFps, showHint, onHintDone, onPause, canPause, frozen }: HudProps) {
  const hud = useHudSnapshot();
  const hintReported = useRef(false);
  const hintTimeUp = hud.elapsed >= HINT_SECONDS;
  const hintVisible = showHint && !hintTimeUp;

  useEffect(() => {
    if (showHint && hintTimeUp && !hintReported.current) {
      hintReported.current = true;
      onHintDone();
    }
  }, [showHint, hintTimeUp, onHintDone]);

  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-10 select-none font-mono"
      // React 19 снимает атрибут при false.
      inert={frozen}
      data-frozen={frozen || undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Лёгкое затемнение сверху — цифры читаются на любом небе. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-28 bg-linear-to-b from-void/85 via-void/40 to-transparent sm:h-36 [@media(max-height:560px)]:h-20" />

      <div className="nvh-sky">
        <div className="nvh-top">
          <div className="nvh-left">
            <ScoreBlock score={hud.score} overdrive={hud.overdrive} />
            <LevelStrip level={hud.level} speedMult={hud.speedMult} levelProgress={hud.levelProgress} />
          </div>
          <ComboMeter key={runId} multiplier={hud.multiplier} chainProgress={hud.chainProgress} overdrive={hud.overdrive} />
          <StatusCluster
            best={hud.highscore}
            beaten={hud.newRecord}
            crystals={hud.crystals}
            shield={hud.shield}
            shieldMax={hud.shieldMax}
            canPause={canPause}
            onPause={onPause}
          />
        </div>
        <Banners />
      </div>

      <AnimatePresence>{hintVisible && <ControlHint key="hint" />}</AnimatePresence>

      {showFps && (
        <div
          className={`nvh-digits absolute text-[10px] font-bold tracking-widest transition-[bottom] duration-500 sm:text-xs ${fpsTone(hud.fps)}`}
          style={{ left: 'max(0.75rem, env(safe-area-inset-left, 0px))', bottom: hintVisible ? FPS_ABOVE_HINT : BOTTOM_INSET }}
        >
          {hud.fps > 0 ? hud.fps : '--'} FPS
        </div>
      )}
    </motion.div>
  );
}
