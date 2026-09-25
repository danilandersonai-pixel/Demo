import { AnimatePresence, motion } from 'framer-motion';
import { ChevronsUp, Coins, HeartPulse, Skull } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { heroTitle, xpToNextLevel } from '../../game/constants';
import type { DeathInfo, LevelUpInfo } from '../../hooks/useGame';
import { Button } from '../ui/Button';

const PARTICLES = 28;

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

/** Праздничный экран повышения уровня: вращающиеся лучи, разлёт частиц, пружинная цифра уровня. */
export function LevelUpOverlay({ info, onClose }: { info: LevelUpInfo | null; onClose: () => void }) {
  useEscape(info !== null, onClose);
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLES }, (_, i) => {
        const angle = (i / PARTICLES) * Math.PI * 2;
        const distance = 150 + (i % 5) * 36;
        return { id: i, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, delay: (i % 7) * 0.03, kind: i % 3 };
      }),
    [],
  );

  return (
    <AnimatePresence>
      {info && (
        <motion.div
          className="fixed inset-0 z-[90] grid place-items-center overflow-hidden bg-[#05060c]/80 p-6 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="alertdialog"
          aria-modal="true"
          aria-label={`Новый уровень ${info.level}`}
        >
          <motion.div
            aria-hidden="true"
            className="absolute h-[140vmax] w-[140vmax] bg-[conic-gradient(from_0deg,transparent_0deg,rgba(217,70,239,0.2)_18deg,transparent_36deg,transparent_60deg,rgba(34,211,238,0.14)_78deg,transparent_96deg,transparent_120deg,rgba(99,102,241,0.18)_140deg,transparent_160deg)]"
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          />
          {particles.map((p) => (
            <motion.span
              key={p.id}
              aria-hidden="true"
              className={`absolute h-1.5 w-1.5 rounded-full ${
                p.kind === 0
                  ? 'bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,1)]'
                  : p.kind === 1
                    ? 'bg-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,1)]'
                    : 'bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,1)]'
              }`}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1.2 }}
              animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.3 }}
              transition={{ duration: 1.4, delay: 0.15 + p.delay, ease: 'easeOut' }}
            />
          ))}

          <motion.div
            className="glass-strong relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl px-8 py-10 text-center"
            initial={{ scale: 0.5, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            onClick={(event) => event.stopPropagation()}
          >
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute -inset-px rounded-[inherit] border-2 border-fuchsia-400/80 shadow-[0_0_40px_rgba(217,70,239,0.6)]"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 via-purple-600 to-indigo-600 text-white shadow-[0_0_40px_rgba(192,38,211,0.9)]"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ChevronsUp size={32} />
            </motion.div>
            <p className="font-mono text-[11px] font-bold tracking-[0.5em] text-cyan-300 uppercase neon-cyan">Level up</p>
            <motion.p
              className="bg-gradient-to-b from-white via-fuchsia-200 to-indigo-400 bg-clip-text font-mono text-8xl leading-none font-bold tracking-tight text-transparent drop-shadow-[0_0_30px_rgba(192,38,211,0.8)]"
              initial={{ scale: 2.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.2 }}
            >
              {String(info.level).padStart(2, '0')}
            </motion.p>
            <p className="font-display text-base font-medium text-white">{heroTitle(info.level)}</p>
            <ul className="w-full space-y-2 text-sm text-slate-300">
              <li className="flex items-center justify-center gap-2">
                <HeartPulse size={16} className="text-red-400" /> Здоровье полностью восстановлено
              </li>
              {info.bonusGold > 0 && (
                <li className="flex items-center justify-center gap-2">
                  <Coins size={16} className="text-amber-300" /> Бонус: <span className="gold-sheen font-mono font-bold">+{info.bonusGold}</span> золота
                </li>
              )}
              <li className="font-mono text-[11px] tracking-wider text-slate-500">NEXT: {xpToNextLevel(info.level)} XP</li>
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
          className="fixed inset-0 z-[95] grid place-items-center bg-[radial-gradient(circle_at_center,rgba(127,29,29,0.55),rgba(5,6,12,0.95))] p-6 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="alertdialog"
          aria-modal="true"
          aria-label="Герой пал"
        >
          <motion.div
            className="glass-strong relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border-red-500/40 px-8 py-10 text-center"
            initial={{ scale: 1.15, opacity: 0, filter: 'blur(8px)' }}
            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)', x: [0, -10, 10, -6, 6, 0] }}
            transition={{ duration: 0.7 }}
          >
            <span aria-hidden="true" className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-red-500 to-transparent" />
            <Skull size={60} className="text-red-400 drop-shadow-[0_0_24px_rgba(239,68,68,0.9)]" strokeWidth={1.4} />
            <p className="font-mono text-[11px] font-bold tracking-[0.5em] text-red-400/80 uppercase">Signal lost</p>
            <h2 className="font-display text-2xl font-bold tracking-widest text-red-300 uppercase neon-red">Герой пал</h2>
            <p className="text-sm text-slate-300">
              Вредные привычки и пропуски взяли своё.{' '}
              {info.lostLevel ? 'Вы потеряли один уровень' : 'Вы потеряли опыт текущего уровня'}
              {info.lostGold > 0 ? ` и ${info.lostGold} золота.` : '.'}
            </p>
            <p className="text-xs text-slate-500">Но легенды не умирают окончательно — HP восстановлено, путь продолжается.</p>
            <Button variant="danger" size="lg" onClick={onClose} className="mt-2 w-full">
              Воскреснуть
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
