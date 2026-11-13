/**
 * Баннеры HUD: READY / GO!, LEVEL N, NEW RECORD!, SHIELD DOWN, COMBO BREAK,
 * OVERDRIVE. Три полки делят «небо» между HUD и линией, где объекты выходят
 * из дымки: вверху — рекорд, в середине — старт и уровни, ниже — щит и комбо.
 * На полке живёт один баннер (новый вытесняет прежний, см. GameHost), размер
 * надписей считается от высоты полки (hud.css) — поэтому баннеры не ложатся ни
 * друг на друга, ни на счёт, ни на дорогу с кораблём на любом экране.
 */
import { AnimatePresence, motion, type TargetAndTransition, type Variants } from 'framer-motion';
import { Crown, ShieldOff, Zap } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { TICK_DT, TICKS_PER_BEAT } from '../../core/timing';
import type { Banner } from '../../core/types';
import { useBanners } from '../hudStore';
import { BANNER_SHELF, EASE_OUT, SHELVES } from './constants';
import { useBeat } from './pulse';

/** Вытесненный баннер гаснет сразу — на его месте уже новый. */
const QUICK_EXIT: TargetAndTransition = { opacity: 0, transition: { duration: 0.1 } };

/** Уход баннера; custom из AnimatePresence — «на полке уже стоит следующий». */
function exitTo(normal: TargetAndTransition): Variants {
  return { exit: (replaced: boolean) => (replaced ? QUICK_EXIT : normal) };
}

export function Banners() {
  const banners = useBanners();
  return (
    <div role="status" aria-live="polite" className="nvh-band">
      {SHELVES.map((shelf) => {
        const list = banners.filter((b) => BANNER_SHELF[b.kind] === shelf);
        return (
          <div key={shelf} className="nvh-shelf">
            <AnimatePresence custom={list.length > 0}>
              {list.map((b) => (
                <BannerView key={b.id} banner={b} />
              ))}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function BannerView({ banner }: { banner: Banner }) {
  switch (banner.kind) {
    case 'ready':
      return <ReadyBanner banner={banner} />;
    case 'go':
      return <GoBanner banner={banner} />;
    case 'levelUp':
      return <LevelBanner banner={banner} />;
    case 'newRecord':
      return <RecordBanner banner={banner} />;
    case 'shield':
      return <ShieldBanner banner={banner} />;
    case 'comboBreak':
      return <ComboBreakBanner banner={banner} />;
    case 'overdrive':
      return <OverdriveBanner banner={banner} />;
    case 'comboUp':
      return <ComboUpBanner banner={banner} />;
  }
}

// ─── READY / GO! ─────────────────────────────────────────────────────────────

const COUNT_BEATS = 4;
const BEAT_MS = TICKS_PER_BEAT * TICK_DT * 1000;
/** Запас, который GameHost добавляет к жизни баннера READY сверх вступления, мс. */
const READY_TAIL_MS = 250;

const READY_EXIT = exitTo({ opacity: 0, scale: 1.1, transition: { duration: 0.2 } });

/**
 * READY с отсчётом: четыре огонька загораются на долях вступления (−4…−1), на
 * пятую приходит GO!. Огоньки переключаются атрибутом прямо в DOM. Первая доля
 * уже прошла к моменту появления баннера (и к возврату из паузы — не одна),
 * поэтому стартовое число огоньков считается из остатка жизни баннера.
 */
function ReadyBanner({ banner }: { banner: Banner }) {
  const pips = useRef<HTMLSpanElement>(null);
  const light = (count: number) => {
    const nodes = pips.current?.children;
    if (!nodes) return;
    for (let i = 0; i < nodes.length; i++) nodes[i].toggleAttribute('data-lit', i < count);
  };

  useLayoutEffect(() => {
    const left = banner.createdAt + banner.duration - READY_TAIL_MS - performance.now();
    light(Math.min(Math.max(Math.floor(COUNT_BEATS - left / BEAT_MS + 0.05) + 1, 1), COUNT_BEATS));
  });
  useBeat((beat) => {
    if (beat.beat < 0) light(beat.beat + COUNT_BEATS + 1);
  });

  return (
    <motion.div
      className="nvh-banner"
      data-big
      variants={READY_EXIT}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit="exit"
      transition={{ duration: 0.35, ease: EASE_OUT }}
    >
      <motion.span
        initial={{ letterSpacing: '0.7em' }}
        animate={{ letterSpacing: '0.28em' }}
        transition={{ duration: 0.7, ease: EASE_OUT }}
        className="nvh-banner-title nvh-neon pl-[0.28em] font-display [--glow:#22f0ff]"
      >
        {banner.text}
      </motion.span>
      <span ref={pips} aria-hidden className="nvh-count">
        {Array.from({ length: COUNT_BEATS }, (_, i) => (
          <span key={i} className="nvh-count-pip" />
        ))}
      </span>
      {banner.sub && <span className="sr-only">{banner.sub}</span>}
    </motion.div>
  );
}

const GO_EXIT = exitTo({ opacity: 0, scale: 2.2, filter: 'blur(8px)', transition: { duration: 0.32, ease: 'easeIn' } });

function GoBanner({ banner }: { banner: Banner }) {
  return (
    <motion.div
      className="nvh-banner"
      data-big
      variants={GO_EXIT}
      initial={{ opacity: 0, scale: 0.25, rotate: -8 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      exit="exit"
      transition={{ type: 'spring', stiffness: 480, damping: 15 }}
    >
      <span className="nvh-banner-title nvh-neon font-display italic [--glow:#ffe94a]">{banner.text}</span>
    </motion.div>
  );
}

// ─── LEVEL N ─────────────────────────────────────────────────────────────────

const LEVEL_EXIT = exitTo({ opacity: 0, y: '-0.35em', filter: 'blur(4px)', transition: { duration: 0.3, ease: 'easeIn' } });

function Wing({ side, optional = false }: { side: 'left' | 'right'; optional?: boolean }) {
  return (
    <motion.span
      aria-hidden
      className="nvh-wing"
      data-side={side}
      data-optional={optional || undefined}
      style={{ originX: side === 'left' ? 1 : 0 }}
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.1 }}
    />
  );
}

function LevelBanner({ banner }: { banner: Banner }) {
  return (
    <motion.div
      className="nvh-banner text-theme-a"
      variants={LEVEL_EXIT}
      initial={{ opacity: 0, y: '0.5em', skewX: -14 }}
      animate={{ opacity: 1, y: 0, skewX: 0 }}
      exit="exit"
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
    >
      <span className="nvh-banner-title nvh-neon font-display [--glow:var(--theme-a)]">
        <Wing side="left" />
        <span>{banner.text}</span>
        <Wing side="right" />
      </span>
      {banner.sub && <span className="nvh-banner-sub text-theme-b">{banner.sub}</span>}
    </motion.div>
  );
}

// ─── NEW RECORD! ─────────────────────────────────────────────────────────────

const SPARK_COUNT = 14;

interface Spark {
  angle: number;
  /** Дальность разлёта в em надписи. */
  reach: number;
  delay: number;
  color: string;
}

const SPARK_COLORS = ['#ffe94a', '#ffffff', '#ff2bd6', '#22f0ff'];

function makeSparks(): Spark[] {
  return Array.from({ length: SPARK_COUNT }, (_, i) => ({
    // Салют вытянут по горизонтали: по вертикали места — одна полка.
    angle: ((i + Math.random() * 0.7) / SPARK_COUNT) * Math.PI * 2,
    reach: 2.2 + Math.random() * 2.2,
    delay: Math.random() * 0.12,
    color: SPARK_COLORS[i % SPARK_COLORS.length],
  }));
}

const RECORD_EXIT = exitTo({ opacity: 0, scale: 1.12, filter: 'blur(6px)', transition: { duration: 0.35, ease: 'easeIn' } });

/**
 * NEW RECORD! — неоновая вывеска: влетает с перелётом, зажигается с перебоями,
 * по буквам проходит блик, за надписью расходится луч, из центра — салют искр.
 * Все анимации конечны: через две секунды баннер уходит сам.
 */
function RecordBanner({ banner }: { banner: Banner }) {
  const [sparks] = useState(makeSparks);
  return (
    <motion.div
      className="nvh-banner"
      variants={RECORD_EXIT}
      initial={{ opacity: 0, scale: 1.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit="exit"
      transition={{ type: 'spring', stiffness: 420, damping: 17 }}
    >
      <span className="nvh-banner-title font-display italic">
        <span aria-hidden className="nvh-record-beam" />
        {sparks.map((s, i) => (
          <motion.span
            key={i}
            aria-hidden
            className="absolute left-1/2 top-1/2 -ml-[0.06em] -mt-[0.06em] h-[0.12em] min-h-[3px] w-[0.12em] min-w-[3px] rounded-full"
            style={{ background: s.color, boxShadow: `0 0 0.3em ${s.color}` }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: `${Math.cos(s.angle) * s.reach * 1.6}em`, y: `${Math.sin(s.angle) * s.reach * 0.45}em`, opacity: 0, scale: 0.3 }}
            transition={{ duration: 0.9, delay: 0.08 + s.delay, ease: EASE_OUT, opacity: { duration: 0.9, delay: 0.08 + s.delay, ease: 'easeIn' } }}
          />
        ))}
        <Crown aria-hidden strokeWidth={2.6} className="text-neon-yellow drop-shadow-[0_0_6px_#ffe94a]" />
        <span className="relative">
          <span aria-hidden className="nvh-record-glow">
            {banner.text}
          </span>
          <span className="nvh-record-text">{banner.text}</span>
        </span>
        <Crown aria-hidden strokeWidth={2.6} className="text-neon-yellow drop-shadow-[0_0_6px_#ffe94a]" />
      </span>
      {banner.sub && <span className="nvh-banner-sub text-neon-yellow">{banner.sub}</span>}
    </motion.div>
  );
}

// ─── SHIELD DOWN / COMBO BREAK / OVERDRIVE ───────────────────────────────────

const SHIELD_EXIT = exitTo({ opacity: 0, scale: 0.92, filter: 'blur(4px)', transition: { duration: 0.3 } });

function ShieldBanner({ banner }: { banner: Banner }) {
  return (
    <motion.div
      className="nvh-banner"
      variants={SHIELD_EXIT}
      initial={{ opacity: 0, scale: 1.35, x: 0 }}
      animate={{ opacity: 1, scale: 1, x: [0, -9, 8, -6, 4, -2, 0] }}
      exit="exit"
      transition={{ duration: 0.45, ease: 'easeOut' }}
    >
      <span className="nvh-banner-title nvh-neon font-display [--glow:#9d4dff]">
        <ShieldOff aria-hidden strokeWidth={2.6} />
        <span>{banner.text}</span>
      </span>
      {banner.sub && <span className="nvh-banner-sub text-ink">{banner.sub}</span>}
    </motion.div>
  );
}

const BREAK_EXIT = exitTo({ opacity: 0, y: '0.45em', filter: 'blur(4px)', transition: { duration: 0.32, ease: 'easeIn' } });

function ComboBreakBanner({ banner }: { banner: Banner }) {
  return (
    <motion.div
      className="nvh-banner text-neon-red"
      variants={BREAK_EXIT}
      initial={{ opacity: 0, scale: 1.3 }}
      animate={{ opacity: 1, scale: 1 }}
      exit="exit"
      transition={{ duration: 0.22, ease: EASE_OUT }}
    >
      <span className="nvh-banner-title nvh-neon font-display [--glow:#ff3b6b]">
        <span className="nvh-crack">
          <span className="nvh-crack-half" data-half="top">
            {banner.text}
          </span>
          <span aria-hidden className="nvh-crack-half" data-half="bottom">
            {banner.text}
          </span>
        </span>
      </span>
      {banner.sub && <span className="nvh-banner-sub text-ink-dim">{banner.sub}</span>}
    </motion.div>
  );
}

const OVERDRIVE_EXIT = exitTo({ opacity: 0, scaleX: 1.35, filter: 'blur(6px)', transition: { duration: 0.3, ease: 'easeIn' } });

function OverdriveBanner({ banner }: { banner: Banner }) {
  return (
    <motion.div
      className="nvh-banner text-neon-yellow"
      variants={OVERDRIVE_EXIT}
      initial={{ opacity: 0, scaleX: 0.35, skewX: -20 }}
      animate={{ opacity: 1, scaleX: 1, skewX: 0 }}
      exit="exit"
      transition={{ type: 'spring', stiffness: 460, damping: 20 }}
    >
      <span className="nvh-banner-title font-display italic">
        <Wing side="left" optional />
        <Zap aria-hidden strokeWidth={2.6} fill="currentColor" className="drop-shadow-[0_0_6px_#ffe94a]" />
        <span className="nvh-od-text">{banner.text}</span>
        <Zap aria-hidden strokeWidth={2.6} fill="currentColor" className="drop-shadow-[0_0_6px_#ffe94a]" />
        <Wing side="right" optional />
      </span>
      {banner.sub && <span className="nvh-banner-sub">{banner.sub}</span>}
    </motion.div>
  );
}

const COMBO_UP_EXIT = exitTo({ opacity: 0, y: '-0.3em', transition: { duration: 0.25 } });

/** Весомый множитель (x4 и выше): короткая отметка — музыка в этот момент получает новый слой. */
function ComboUpBanner({ banner }: { banner: Banner }) {
  return (
    <motion.div
      className="nvh-banner text-neon-pink"
      variants={COMBO_UP_EXIT}
      initial={{ opacity: 0, scale: 0.55 }}
      animate={{ opacity: 1, scale: 1 }}
      exit="exit"
      transition={{ type: 'spring', stiffness: 520, damping: 16 }}
    >
      <span className="nvh-banner-title nvh-neon font-display [--glow:#ff2bd6]">{banner.text}</span>
      {banner.sub && <span className="nvh-banner-sub text-ink-dim">{banner.sub}</span>}
    </motion.div>
  );
}
