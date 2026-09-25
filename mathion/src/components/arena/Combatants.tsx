import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { Biohazard, Flame, Heart, Shield, ShieldPlus, Snowflake, Sparkles, Swords, Target, WandSparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ELEMENT_META } from '../../game/constants';
import { TRAIT_META } from '../../game/enemies';
import type { Battle, Enemy, Player, PotionId } from '../../types';
import type { Floater } from '../../hooks/useGame';
import { ELEMENT_STYLE, ENEMY_ICONS, ElementIcon, POTION_ICONS } from '../ui/Icons';
import { Meter } from '../ui/Meter';
import { FloatingLayer } from './FloatingLayer';

// ---------------------------------------------------------------------------
// Герой
// ---------------------------------------------------------------------------

interface PlayerCardProps {
  player: Player;
  maxHp: number;
  maxMana: number;
  battle: Battle | null;
  floaters: Floater[];
  shakeKey: number;
  potionFx: { id: string; potion: PotionId } | null;
}

export function PlayerCard({ player, maxHp, maxMana, battle, floaters, shakeKey, potionFx }: PlayerCardProps) {
  const controls = useAnimationControls();
  const first = useRef(true);

  // Ошибка или удар — карточка героя вздрагивает.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void controls.start({ x: [0, -10, 9, -6, 5, -2, 0], transition: { duration: 0.45 } });
  }, [shakeKey, controls]);

  const lowHp = player.hp / maxHp < 0.3;

  return (
    <motion.div animate={controls} className="wood-panel relative flex flex-col gap-4 p-4 sm:p-5">
      <FloatingLayer floaters={floaters} target="player" />
      <PotionBurst fx={potionFx} />

      <div className="relative flex items-center gap-3">
        <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full border-2 border-amber-500/60 bg-gradient-to-br from-emerald-900 to-[#0b1a17] shadow-[0_0_24px_-6px_rgba(52,211,153,0.8)]">
          <WandSparkles size={30} className="text-emerald-200" strokeWidth={1.6} />
          <span className="absolute -right-1 -bottom-1 grid h-7 min-w-7 place-items-center rounded-full border border-amber-200/70 bg-gradient-to-b from-amber-300 to-amber-600 px-1 font-mono text-xs font-bold text-amber-950">
            {player.level}
          </span>
        </div>
        <div className="min-w-0">
          <p className="font-display text-xs tracking-[0.2em] text-emerald-300/80 uppercase">Алхимик</p>
          <p className="truncate font-display text-lg font-bold text-amber-50">{player.name}</p>
        </div>
      </div>

      <div className="relative space-y-3">
        <motion.div animate={lowHp ? { opacity: [1, 0.6, 1] } : { opacity: 1 }} transition={lowHp ? { duration: 1.2, repeat: Infinity } : undefined}>
          <Meter tone="hp" label="Здоровье" icon={<Heart size={12} />} value={player.hp} max={maxHp} size="lg" />
        </motion.div>
        <Meter tone="mana" label="Мана" icon={<Sparkles size={12} />} value={player.mana} max={maxMana} />
      </div>

      {battle && (
        <div className="relative flex flex-wrap gap-1.5">
          {battle.combo >= 2 && (
            <motion.span
              key={battle.combo}
              initial={{ scale: 1.4 }}
              animate={{ scale: 1 }}
              className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 bg-amber-500/15 px-2 py-0.5 font-mono text-xs font-bold text-amber-200"
            >
              <Flame size={12} /> Комбо ×{battle.combo}
            </motion.span>
          )}
          {battle.poisonTurns > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-lime-400/50 bg-lime-500/15 px-2 py-0.5 font-mono text-xs text-lime-200">
              <Biohazard size={12} /> Яд: {battle.poisonTurns}
            </span>
          )}
          {battle.freezeLeft > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-cyan-300/50 bg-cyan-400/15 px-2 py-0.5 font-mono text-xs text-cyan-100">
              <Snowflake size={12} /> Заморозка
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-700/40 bg-black/30 px-2 py-0.5 font-mono text-xs text-amber-200/80">
            <Target size={12} /> {battle.correct} / {battle.correct + battle.wrong}
          </span>
        </div>
      )}
    </motion.div>
  );
}

/** Вспышка выпитого зелья: цветной ореол и пузырьки. */
function PotionBurst({ fx }: { fx: { id: string; potion: PotionId } | null }) {
  return (
    <AnimatePresence>
      {fx && (
        <motion.div key={fx.id} className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[inherit]" initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className={`absolute top-1/2 left-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br opacity-60 blur-2xl ${POTION_ICONS[fx.potion].liquid}`}
            initial={{ scale: 0.2, opacity: 0.9 }}
            animate={{ scale: 2.2, opacity: 0 }}
            transition={{ duration: 1 }}
          />
          {Array.from({ length: 8 }, (_, i) => (
            <motion.span
              key={i}
              className={`absolute bottom-4 h-2.5 w-2.5 rounded-full bg-gradient-to-br ${POTION_ICONS[fx.potion].liquid}`}
              style={{ left: `${12 + i * 11}%` }}
              initial={{ y: 0, opacity: 0 }}
              animate={{ y: -90 - (i % 3) * 25, opacity: [0, 1, 0] }}
              transition={{ duration: 0.9, delay: i * 0.05 }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Враг
// ---------------------------------------------------------------------------

interface EnemyCardProps {
  enemy: Enemy;
  timeLeft: number;
  timeLimit: number;
  frozen: boolean;
  floaters: Floater[];
  hitKey: number;
}

/** Кольцо таймера атаки вокруг портрета врага. */
function AttackRing({ ratio, frozen }: { ratio: number; frozen: boolean }) {
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const color = frozen ? '#67e8f9' : ratio < 0.3 ? '#f97316' : '#f0c872';
  return (
    <svg viewBox="0 0 128 128" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
      <circle cx="64" cy="64" r={radius} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="6" />
      <circle
        cx="64"
        cy="64"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.max(0, Math.min(1, ratio)))}
        style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dashoffset 0.1s linear, stroke 0.3s' }}
      />
    </svg>
  );
}

export function EnemyCard({ enemy, timeLeft, timeLimit, frozen, floaters, hitKey }: EnemyCardProps) {
  const controls = useAnimationControls();
  const first = useRef(true);
  const Icon = ENEMY_ICONS[enemy.icon];
  const ratio = timeLimit > 0 ? timeLeft / timeLimit : 0;
  const isBoss = enemy.kind === 'boss' || enemy.traits.length > 0;

  // Попадание — враг отшатывается и вспыхивает.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void controls.start({ x: [0, 12, -6, 3, 0], filter: ['brightness(1)', 'brightness(1.9)', 'brightness(1)'], transition: { duration: 0.4 } });
  }, [hitKey, controls]);

  return (
    <div className={`wood-panel relative flex flex-col gap-4 p-4 sm:p-5 ${isBoss ? 'border-fuchsia-500/35 shadow-[0_0_40px_-18px_rgba(192,38,211,0.9)]' : ''}`}>
      <FloatingLayer floaters={floaters} target="enemy" />

      <div className="relative flex items-center gap-4">
        <motion.div animate={controls} className="relative grid h-24 w-24 shrink-0 place-items-center">
          <AttackRing ratio={ratio} frozen={frozen} />
          <motion.div
            className={`grid h-[4.6rem] w-[4.6rem] place-items-center rounded-full border ${
              isBoss ? 'border-fuchsia-400/60 bg-gradient-to-br from-fuchsia-950 to-[#120b1a]' : 'border-amber-600/50 bg-gradient-to-br from-[#2a1c10] to-[#120c07]'
            }`}
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Icon size={38} className={isBoss ? 'text-fuchsia-200' : 'text-amber-100'} strokeWidth={1.5} />
          </motion.div>
        </motion.div>
        <div className="min-w-0">
          <p className={`font-display text-xs tracking-[0.2em] uppercase ${isBoss ? 'text-fuchsia-300/90' : 'text-amber-300/70'}`}>
            {enemy.kind === 'boss' ? 'Босс' : enemy.kind === 'golem' ? 'Голем' : 'Монстр'} · ур. {enemy.level}
          </p>
          <p className="font-display text-lg leading-tight font-bold text-amber-50">{enemy.name}</p>
          <p className="text-sm text-amber-200/60 italic">{enemy.title}</p>
          <p className="mt-1 flex items-center gap-1 font-mono text-xs text-red-300">
            <Swords size={12} /> атака {enemy.attack + enemy.attackBonus}
            <span className="text-amber-200/50">· {(Math.max(0, timeLeft) / 1000).toFixed(1)} с</span>
          </p>
        </div>
      </div>

      <div className="relative space-y-3">
        <Meter tone="hp" label="Здоровье" icon={<Heart size={12} />} value={enemy.hp} max={enemy.maxHp} size="lg" />
        {(enemy.maxShield > 0 || enemy.shield > 0) && (
          <Meter tone="shield" label="Щит" icon={<Shield size={12} />} value={enemy.shield} max={Math.max(enemy.maxShield, enemy.shield)} />
        )}
      </div>

      <div className="relative flex flex-wrap gap-1.5 text-xs">
        {enemy.weakness && (
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${ELEMENT_STYLE[enemy.weakness].soft}`} title="Урон ×1.5">
            <ElementIcon element={enemy.weakness} size={12} /> Уязвим: {ELEMENT_META[enemy.weakness].name}
          </span>
        )}
        {enemy.resist && (
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-500/40 bg-slate-500/10 px-2 py-0.5 text-slate-300" title="Урон ×0.5">
            <ShieldPlus size={12} /> Стоек: {ELEMENT_META[enemy.resist].name}
          </span>
        )}
      </div>

      {enemy.traits.length > 0 && (
        <ul className="relative space-y-1.5">
          {enemy.traits.map((trait) => (
            <li key={trait} className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-950/30 px-2.5 py-1.5 text-xs">
              <span className="font-display font-bold text-fuchsia-200">{TRAIT_META[trait].name}.</span>{' '}
              <span className="text-amber-100/75">{TRAIT_META[trait].description}</span>
            </li>
          ))}
          {enemy.enraged && <li className="font-display text-xs font-bold text-red-300">Вторая фаза: атака усилена!</li>}
        </ul>
      )}
    </div>
  );
}
