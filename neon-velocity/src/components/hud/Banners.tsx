import { AnimatePresence, motion, type TargetAndTransition, type Variants } from 'framer-motion';
import { Crown, ShieldOff, Zap } from 'lucide-react';
import { useState } from 'react';
import { useBanners } from '../../game/hudStore';
import type { Banner } from '../../game/types';
import { BANNER_SLOT, type BannerSlot } from './constants';

/**
 * Баннеры HUD (READY/GO, LEVEL N, NEW RECORD!, SHIELD DOWN, COMBO BREAK…).
 * Три «полки» по высоте: вверху — рекорд, в центре — старт и уровни, ниже —
 * щит и комбо. На полке живёт один баннер (новый вытесняет прежний, см.
 * BANNER_SLOT), поэтому надписи не печатаются друг поверх друга.
 * Корабль внизу экрана баннеры не закрывают.
 *
 * На низком экране (телефон боком) проценты не работают: HUD и корабль
 * занимают фиксированные пиксели, и между ними остаётся всего 150–190 px. Там верхняя
 * полка стоит сразу под HUD, нижняя — сразу над кораблём, средняя — посередине,
 * а надписи берут компактные размеры вместо sm: — иначе «NEW RECORD!» ложится
 * на HUD, а соседние полки наезжают друг на друга.
 */
const SLOTS: readonly { slot: BannerSlot; className: string }[] = [
  { slot: 'top', className: 'top-[25%] [@media(max-height:560px)_and_(orientation:landscape)]:top-[116px]' },
  { slot: 'mid', className: 'top-[41%] [@media(max-height:560px)_and_(orientation:landscape)]:top-[calc(50%-12px)]' },
  { slot: 'low', className: 'top-[56%] [@media(max-height:560px)_and_(orientation:landscape)]:top-[calc(100%-140px)]' },
];

/** Каждый баннер центрирован по линии своей полки. */
const PLACE = 'absolute inset-x-0 flex -translate-y-1/2 flex-col items-center px-3 text-center';
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Вытесненный баннер нижней полки гаснет быстро — новый ждёт его ухода. */
const QUICK_EXIT: TargetAndTransition = { opacity: 0, transition: { duration: 0.12 } };

/** Уход баннера нижней полки; custom из AnimatePresence — «на полке уже новый баннер». */
function lowExit(normal: TargetAndTransition): Variants {
  return { exit: (replaced: boolean) => (replaced ? QUICK_EXIT : normal) };
}

export function Banners() {
  const banners = useBanners();
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-0 overflow-hidden">
      {SLOTS.map(({ slot, className }) => {
        const list = banners.filter((b) => BANNER_SLOT[b.kind] === slot);
        return (
          <div key={slot} className={`absolute inset-x-0 h-0 ${className}`}>
            {/* READY → GO! на средней полке — задуманный переход «одно в другое»; внизу — строго по очереди. */}
            <AnimatePresence mode={slot === 'low' ? 'wait' : 'sync'} custom={list.length > 0}>
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
    case 'comboUp':
      return <ComboUpBanner banner={banner} />;
  }
}

// ─── READY / GO! ─────────────────────────────────────────────────────────────

function ReadyBanner({ banner }: { banner: Banner }) {
  return (
    <motion.div
      className={PLACE}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.08, filter: 'blur(6px)', transition: { duration: 0.25 } }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
    >
      <div className="flex items-center gap-3 sm:gap-5 [@media(max-height:560px)_and_(orientation:landscape)]:gap-3">
        <span className="nv-blink h-2 w-2 rounded-full bg-neon-cyan shadow-[0_0_10px_#22f0ff]" />
        <motion.span
          initial={{ letterSpacing: '0.9em' }}
          animate={{ letterSpacing: '0.32em' }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
          className="whitespace-nowrap pl-[0.32em] font-display text-4xl font-black text-neon-cyan text-glow-cyan sm:text-6xl [@media(max-height:560px)_and_(orientation:landscape)]:text-4xl"
        >
          {banner.text}
        </motion.span>
        <span className="nv-blink h-2 w-2 rounded-full bg-neon-cyan shadow-[0_0_10px_#22f0ff]" />
      </div>
      {banner.sub && (
        <span className="mt-2 pl-[0.6em] text-[10px] font-bold tracking-[0.6em] text-ink-dim sm:text-xs [@media(max-height:560px)_and_(orientation:landscape)]:text-[10px]">
          {banner.sub}
        </span>
      )}
    </motion.div>
  );
}

function GoBanner({ banner }: { banner: Banner }) {
  return (
    <motion.div
      className={PLACE}
      initial={{ opacity: 0, scale: 0.2, rotate: -10 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      exit={{ opacity: 0, scale: 2.6, filter: 'blur(10px)', transition: { duration: 0.35, ease: 'easeIn' } }}
      transition={{ type: 'spring', stiffness: 460, damping: 14 }}
    >
      <span className="font-display text-6xl font-black italic tracking-wider text-neon-yellow text-glow-yellow sm:text-8xl [@media(max-height:560px)_and_(orientation:landscape)]:text-6xl">
        {banner.text}
      </span>
    </motion.div>
  );
}

// ─── LEVEL N ─────────────────────────────────────────────────────────────────

function LevelBanner({ banner }: { banner: Banner }) {
  return (
    <motion.div
      className={PLACE}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -18, filter: 'blur(6px)', transition: { duration: 0.35 } }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center gap-3 sm:gap-5 [@media(max-height:560px)_and_(orientation:landscape)]:gap-3">
        <motion.span
          aria-hidden
          className="h-[2px] w-8 origin-right bg-linear-to-l from-neon-pink to-transparent shadow-[0_0_8px_#ff2bd6] sm:w-28 [@media(max-height:560px)_and_(orientation:landscape)]:w-8"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
        />
        <motion.span
          initial={{ x: -70, skewX: -24, opacity: 0 }}
          animate={{ x: 0, skewX: -8, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          className="whitespace-nowrap font-display text-3xl font-black italic tracking-widest text-neon-pink text-glow-pink sm:text-6xl [@media(max-height:560px)_and_(orientation:landscape)]:text-2xl"
        >
          {banner.text}
        </motion.span>
        <motion.span
          aria-hidden
          className="h-[2px] w-8 origin-left bg-linear-to-r from-neon-pink to-transparent shadow-[0_0_8px_#ff2bd6] sm:w-28 [@media(max-height:560px)_and_(orientation:landscape)]:w-8"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
        />
      </div>
      {banner.sub && (
        <motion.span
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.35, ease: EASE_OUT }}
          className="nv-digits mt-2 flex items-center gap-2 pl-[0.35em] font-mono text-sm font-bold tracking-[0.35em] text-neon-cyan text-glow-cyan sm:text-lg [@media(max-height:560px)_and_(orientation:landscape)]:mt-1 [@media(max-height:560px)_and_(orientation:landscape)]:text-xs"
        >
          <Zap size={16} strokeWidth={2.5} aria-hidden />
          {banner.sub}
        </motion.span>
      )}
    </motion.div>
  );
}

// ─── NEW RECORD! ─────────────────────────────────────────────────────────────

interface Spark {
  x: number;
  y: number;
  size: number;
  delay: number;
  color: string;
}

const SPARK_COLORS = ['#ffe94a', '#ff2bd6', '#22f0ff', '#ffffff'];

function makeSparks(count: number): Spark[] {
  return Array.from({ length: count }, (_, i) => {
    // Равномерно по кругу с разбросом — без «дыр» в салюте.
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const dist = 90 + Math.random() * 120;
    return {
      x: Math.cos(angle) * dist * 1.6,
      y: Math.sin(angle) * dist * 0.7,
      size: 3 + Math.random() * 4,
      delay: Math.random() * 0.12,
      color: SPARK_COLORS[i % SPARK_COLORS.length],
    };
  });
}

/** Главная вспышка HUD: надпись влетает по буквам, горит с перебоями, вокруг — салют. */
function RecordBanner({ banner }: { banner: Banner }) {
  const [sparks] = useState(() => makeSparks(18));
  const letters = Array.from(banner.text);
  return (
    <motion.div
      className={PLACE}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.12, filter: 'blur(8px)', transition: { duration: 0.45 } }}
      transition={{ duration: 0.15 }}
    >
      {[
        '-top-3 sm:-top-4 via-neon-yellow shadow-[0_0_12px_#ffe94a]',
        '-bottom-3 sm:-bottom-4 via-neon-pink shadow-[0_0_12px_#ff2bd6]',
      ].map((edge, i) => (
        <motion.span
          key={edge}
          aria-hidden
          className={`absolute inset-x-[6%] h-px bg-linear-to-r from-transparent to-transparent ${edge}`}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, delay: 0.05 + i * 0.08, ease: EASE_OUT }}
        />
      ))}
      {/* Ореол-вспышка: короткий удар, дальше не мешает читать. */}
      <motion.span
        aria-hidden
        className="absolute left-1/2 top-1/2 h-40 w-[min(30rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,233,74,0.55),rgba(255,43,214,0.25)_55%,transparent)]"
        initial={{ scale: 0.2, opacity: 1 }}
        animate={{ scale: [0.2, 1.4, 1.2], opacity: [1, 0.85, 0] }}
        transition={{ duration: 1.1, ease: EASE_OUT }}
      />
      {/* Развёртка во всю ширину экрана. */}
      <motion.span
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-[2px] bg-linear-to-r from-transparent via-neon-yellow to-transparent"
        initial={{ scaleX: 0, opacity: 1 }}
        animate={{ scaleX: 1, opacity: 0 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />
      {/* Кольца-волны. */}
      {[0, 0.14, 0.28].map((delay, i) => (
        <motion.span
          key={delay}
          aria-hidden
          className={[
            'absolute left-1/2 top-1/2 -ml-10 -mt-10 h-20 w-20 rounded-full border-2',
            i === 1 ? 'border-neon-pink shadow-[0_0_16px_#ff2bd6]' : 'border-neon-yellow shadow-[0_0_16px_#ffe94a]',
          ].join(' ')}
          initial={{ scale: 0.3, opacity: 0.95 }}
          animate={{ scale: 4.2, opacity: 0 }}
          transition={{ duration: 1, delay, ease: 'easeOut' }}
        />
      ))}
      {/* Салют искр. */}
      {sparks.map((s, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute left-1/2 top-1/2 rounded-[1px]"
          style={{ width: s.size, height: s.size, background: s.color, boxShadow: `0 0 8px ${s.color}` }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1.4 }}
          animate={{ x: s.x, y: s.y, opacity: 0, scale: 0.4 }}
          transition={{ duration: 1.1, delay: 0.05 + s.delay, ease: EASE_OUT }}
        />
      ))}

      <div className="nv-record-flicker relative whitespace-nowrap font-display text-[29px] font-black italic tracking-wider sm:text-7xl [@media(max-height:560px)_and_(orientation:landscape)]:text-[29px]">
        {/* Хроматические двойники проявляются, когда буквы встали на место. */}
        <motion.span
          aria-hidden
          className="nv-chroma nv-chroma-pink"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.55 }}
          transition={{ delay: 0.5 }}
        >
          {banner.text}
        </motion.span>
        <motion.span
          aria-hidden
          className="nv-chroma nv-chroma-cyan"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          transition={{ delay: 0.5 }}
        >
          {banner.text}
        </motion.span>
        <span className="sr-only">{banner.text}</span>
        {/* Тёмный контур букв вместо тёмной полосы во всю ширину: надпись читается
            даже поверх жёлтого солнца, а подлетающие препятствия вокруг видны. */}
        <span
          aria-hidden
          className="relative text-neon-yellow text-glow-yellow [paint-order:stroke_fill] [-webkit-text-stroke:5px_rgba(5,5,10,0.85)] sm:[-webkit-text-stroke:8px_rgba(5,5,10,0.85)] [@media(max-height:560px)_and_(orientation:landscape)]:[-webkit-text-stroke:5px_rgba(5,5,10,0.85)]"
        >
          {letters.map((ch, i) => (
            <motion.span
              key={i}
              className="inline-block"
              initial={{ y: -46, opacity: 0, scale: 1.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.035, type: 'spring', stiffness: 620, damping: 17 }}
            >
              {ch === ' ' ? ' ' : ch}
            </motion.span>
          ))}
        </span>
      </div>
      <motion.span
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.4, ease: EASE_OUT }}
        className="relative mt-2 flex items-center gap-2 rounded-[2px] bg-void/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.35em] text-neon-pink text-glow-pink sm:text-sm [@media(max-height:560px)_and_(orientation:landscape)]:mt-1 [@media(max-height:560px)_and_(orientation:landscape)]:py-0 [@media(max-height:560px)_and_(orientation:landscape)]:text-[10px]"
      >
        <Crown size={14} strokeWidth={2.5} aria-hidden />
        {banner.sub ?? 'рекорд побит'}
      </motion.span>
    </motion.div>
  );
}

// ─── SHIELD DOWN / COMBO ─────────────────────────────────────────────────────

const VIOLET_GLOW = '[text-shadow:0_0_2px_#fff,0_0_10px_#9d4dff,0_0_24px_#9d4dff]';

const SHIELD_EXIT = lowExit({ opacity: 0, y: 14, transition: { duration: 0.3 } });
const COMBO_BREAK_EXIT = lowExit({ opacity: 0, y: 10, transition: { duration: 0.25 } });
const COMBO_UP_EXIT = lowExit({ opacity: 0, y: -26, transition: { duration: 0.35 } });

function ShieldBanner({ banner }: { banner: Banner }) {
  return (
    <motion.div
      className={PLACE}
      variants={SHIELD_EXIT}
      initial={{ opacity: 0, scale: 1.35 }}
      animate={{ opacity: 1, scale: 1, x: [0, -7, 6, -4, 2, 0] }}
      exit="exit"
      transition={{ duration: 0.45, ease: 'easeOut' }}
    >
      <span
        className={`flex items-center gap-2 whitespace-nowrap font-display text-2xl font-black tracking-widest text-neon-violet sm:text-4xl [@media(max-height:560px)_and_(orientation:landscape)]:text-xl ${VIOLET_GLOW}`}
      >
        <ShieldOff
          className="h-6 w-6 drop-shadow-[0_0_8px_#9d4dff] sm:h-8 sm:w-8 [@media(max-height:560px)_and_(orientation:landscape)]:h-5 [@media(max-height:560px)_and_(orientation:landscape)]:w-5"
          strokeWidth={2.5}
          aria-hidden
        />
        {banner.text}
      </span>
      {banner.sub && (
        <span className="mt-1.5 text-[10px] font-bold tracking-[0.3em] text-neon-cyan sm:text-xs [@media(max-height:560px)_and_(orientation:landscape)]:mt-1 [@media(max-height:560px)_and_(orientation:landscape)]:text-[10px]">
          {banner.sub}
        </span>
      )}
    </motion.div>
  );
}

function ComboBreakBanner({ banner }: { banner: Banner }) {
  return (
    <motion.div
      className={PLACE}
      variants={COMBO_BREAK_EXIT}
      initial={{ opacity: 0, scale: 1.25 }}
      animate={{ opacity: 1, scale: 1, x: [0, -10, 9, -6, 4, 0] }}
      exit="exit"
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <span className="whitespace-nowrap font-display text-xl font-black italic tracking-widest text-neon-red text-glow-red sm:text-3xl [@media(max-height:560px)_and_(orientation:landscape)]:text-xl">
        {banner.text}
      </span>
      {banner.sub && (
        <span className="mt-1 text-[10px] font-bold tracking-[0.3em] text-neon-red/80 line-through decoration-2 sm:text-xs [@media(max-height:560px)_and_(orientation:landscape)]:text-[10px]">
          {banner.sub}
        </span>
      )}
    </motion.div>
  );
}

function ComboUpBanner({ banner }: { banner: Banner }) {
  return (
    <motion.div
      className={PLACE}
      variants={COMBO_UP_EXIT}
      initial={{ opacity: 0, y: 14, scale: 0.6 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit="exit"
      transition={{ type: 'spring', stiffness: 520, damping: 18 }}
    >
      <span className="flex items-baseline gap-2 rounded-[3px] border border-neon-yellow/70 bg-void/50 px-3 py-1 shadow-[0_0_14px_rgba(255,233,74,0.45)]">
        <span className="font-display text-2xl font-black text-neon-yellow text-glow-yellow sm:text-3xl [@media(max-height:560px)_and_(orientation:landscape)]:text-2xl">
          {banner.text}
        </span>
        {banner.sub && (
          <span className="text-[10px] font-bold tracking-[0.35em] text-neon-pink sm:text-xs [@media(max-height:560px)_and_(orientation:landscape)]:text-[10px]">
            {banner.sub}
          </span>
        )}
      </span>
    </motion.div>
  );
}
