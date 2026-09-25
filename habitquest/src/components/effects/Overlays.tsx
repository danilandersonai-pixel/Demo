import { AnimatePresence, motion } from 'framer-motion';
import { ChevronsUp, Coins, HeartPulse, Skull } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { heroTitle, xpToNextLevel } from '../../game/constants';
import type { DeathInfo, LevelUpInfo } from '../../hooks/useGame';
import { Button } from '../ui/Button';

const PARTICLES = 26;

function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, onClose]);
}

/** Праздничный экран повышения уровня: лучи, частицы, пружинная цифра уровня. */
export function LevelUpOverlay({ info, onClose }: { info: LevelUpInfo | null; onClose: () => void }) {
  useEscape(info !== null, onClose);
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLES }, (_, i) => {
        const angle = (i / PARTICLES) * Math.PI * 2;
        const distance = 140 + (i % 5) * 38;
        return { id: i, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, delay: (i % 7) * 0.03, gold: i % 3 === 0 };
      }),
    [],
  );

  return (
    <AnimatePresence>
      {info && (
        <motion.div
          className="fixed inset-0 z-[90] grid place-items-center overflow-hidden bg-black/75 p-6 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="alertdialog"
          aria-modal="true"
          aria-label={`Новый уровень ${info.level}`}
        >
          <motion.div
            className="absolute h-[140vmax] w-[140vmax] bg-[conic-gradient(from_0deg,transparent_0deg,rgba(168,85,247,0.22)_20deg,transparent_40deg,transparent_60deg,rgba(251,191,36,0.16)_80deg,transparent_100deg)]"
            animate={{ rotate: 360 }}
            transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
          />
          {particles.map((p) => (
            <motion.span
              key={p.id}
              className={`absolute h-2 w-2 rounded-full ${p.gold ? 'bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,1)]' : 'bg-fuchsia-400 shadow-[0_0_12px_rgba(232,121,249,1)]'}`}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.3 }}
              transition={{ duration: 1.4, delay: 0.15 + p.delay, ease: 'easeOut' }}
            />
          ))}

          <motion.div
            className="glass-strong relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl px-8 py-10 text-center"
            initial={{ scale: 0.5, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            onClick={(event) => event.stopPropagation()}
          >
            <motion.div
              className="grid h-16 w-16 place-items-center rounded-2xl border border-violet-300/50 bg-violet-600/40 text-white shadow-[0_0_40px_rgba(168,85,247,0.9)]"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ChevronsUp size={36} />
            </motion.div>
            <p className="font-display text-xs tracking-[0.4em] text-cyan-300 uppercase neon-cyber">Level up</p>
            <motion.p
              className="bg-gradient-to-b from-white via-violet-200 to-fuchsia-400 bg-clip-text font-display text-8xl leading-none text-transparent drop-shadow-[0_0_30px_rgba(168,85,247,0.8)]"
              initial={{ scale: 2.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.2 }}
            >
              {info.level}
            </motion.p>
            <p className="font-display text-lg text-white">{heroTitle(info.level)}</p>
            <ul className="w-full space-y-2 text-sm text-violet-100/85">
              <li className="flex items-center justify-center gap-2">
                <HeartPulse size={16} className="text-rose-400" /> Здоровье полностью восстановлено
              </li>
              {info.bonusGold > 0 && (
                <li className="flex items-center justify-center gap-2">
                  <Coins size={16} className="text-amber-300" /> Бонус: +{info.bonusGold} золота
                </li>
              )}
              <li className="text-xs text-violet-200/60">Следующий уровень потребует {xpToNextLevel(info.level)} XP</li>
            </ul>
            <Button variant="primary" size="lg" onClick={onClose} className="mt-2 w-full">
              Продолжить путь
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Экран гибели героя при падении HP до нуля. */
export function DeathOverlay({ info, onClose }: { info: DeathInfo | null; onClose: () => void }) {
  useEscape(info !== null, onClose);
  return (
    <AnimatePresence>
      {info && (
        <motion.div
          className="fixed inset-0 z-[95] grid place-items-center bg-[radial-gradient(circle_at_center,rgba(127,29,29,0.55),rgba(0,0,0,0.92))] p-6 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="alertdialog"
          aria-modal="true"
          aria-label="Герой пал"
        >
          <motion.div
            className="glass-strong flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border-rose-500/40 px-8 py-10 text-center"
            initial={{ scale: 1.15, opacity: 0, filter: 'blur(8px)' }}
            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)', x: [0, -10, 10, -6, 6, 0] }}
            transition={{ duration: 0.7 }}
          >
            <Skull size={64} className="text-rose-400 drop-shadow-[0_0_24px_rgba(255,59,92,0.9)]" strokeWidth={1.4} />
            <h2 className="font-display text-3xl tracking-widest text-rose-300 uppercase neon-hp">Герой пал</h2>
            <p className="text-sm text-violet-100/80">
              Вредные привычки и пропуски взяли своё.{' '}
              {info.lostLevel ? 'Вы потеряли один уровень' : 'Вы потеряли опыт текущего уровня'}
              {info.lostGold > 0 ? ` и ${info.lostGold} золота.` : '.'}
            </p>
            <p className="text-xs text-violet-200/55">Но легенды не умирают окончательно — HP восстановлено, путь продолжается.</p>
            <Button variant="danger" size="lg" onClick={onClose} className="mt-2 w-full">
              Воскреснуть
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
