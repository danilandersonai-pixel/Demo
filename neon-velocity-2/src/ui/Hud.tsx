/**
 * Аркадный HUD поверх холста (слой z-10). Читает снимок из hudStore — цикл
 * публикует его не чаще 30 раз в секунду, а пульс в долю идёт мимо React
 * (hud/pulse.ts). Всё, кроме кнопки паузы, прозрачно для указателя: мышь и
 * палец ведут корабль прямо сквозь HUD.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Banners } from './hud/Banners';
import { ComboMeter } from './hud/ComboMeter';
import { ControlHint } from './hud/ControlHint';
import { freezeAnimations } from './hud/freeze';
import './hud/hud.css';
import { LevelStrip, ScoreBlock } from './hud/ScoreBlock';
import { StatusCluster } from './hud/StatusCluster';
import { hudStore, useHudSnapshot, useResumeCount } from './hudStore';

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
   * HUD лежит под паузой: он инертен (один диалог для Tab и скринридера), а всё,
   * что в нём движется, стоит — под размытым экраном ничто не должно двигаться.
   * CSS-анимации держит правило [data-frozen] (hud.css), вспышки в долю, анимации
   * Framer Motion и переходы — freezeAnimations, баннеры не уходят (Banners).
   * Стоит HUD и весь отсчёт после паузы (useHeld) — ровно пока стоят тики; инертен
   * он только под самой паузой: кнопка паузы во время отсчёта работает. Дальше всё
   * продолжается с того же места.
   */
  frozen: boolean;
}

/**
 * HUD стоит под паузой и весь отсчёт после неё. Цифру отсчёта GameHost ставит в
 * layout-эффекте того же коммита, что снимает паузу, и его эффекты идут раньше
 * эффектов HUD (холст раньше в дереве). Поэтому «оттаять» решает эффект, а не
 * рендер: иначе HUD ожил бы на один рендер между паузой и отсчётом — баннеры,
 * истёкшие за паузу, ушли бы, а READY въехал бы заново посреди отсчёта.
 */
function useHeld(frozen: boolean): boolean {
  const counting = useResumeCount() > 0;
  const [held, setHeld] = useState(frozen);
  useLayoutEffect(() => {
    setHeld(frozen || hudStore.getResumeCount() > 0);
  }, [frozen, counting]);
  return frozen || held;
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
  const held = useHeld(frozen);
  const root = useRef<HTMLDivElement>(null);
  const hintReported = useRef(false);
  const hintTimeUp = hud.elapsed >= HINT_SECONDS;
  const hintVisible = showHint && !hintTimeUp;

  useEffect(() => {
    if (showHint && hintTimeUp && !hintReported.current) {
      hintReported.current = true;
      onHintDone();
    }
  }, [showHint, hintTimeUp, onHintDone]);

  // До отрисовки кадра паузы: идущие вспышки и переходы замирают, очистка эффекта их продолжает.
  // Снимок, пришедший уже под заморозкой (первый кадр отсчёта публикует состояние на момент
  // паузы — прежняя публикация могла отстать на 1/30 с), может запустить переход, например
  // полоски уровня: после такого рендера заморозка повторяется и останавливает и его.
  useLayoutEffect(() => {
    if (!held || !root.current) return;
    return freezeAnimations(root.current);
  }, [held, hud]);

  return (
    <motion.div
      ref={root}
      className="pointer-events-none fixed inset-0 z-10 select-none font-mono"
      // React 19 снимает атрибут при false.
      inert={frozen}
      data-frozen={held || undefined}
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
        <Banners frozen={held} runId={runId} />
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
