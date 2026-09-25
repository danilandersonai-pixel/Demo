import { motion } from 'framer-motion';
import { Backpack, Castle, Coins, FlaskConical, Swords, type LucideIcon } from 'lucide-react';
import type { GameState, TabId } from '../../types';
import type { Derived } from '../../hooks/useGame';
import { EssenceRow } from '../ui/Icons';

interface HeaderProps {
  state: GameState;
  derived: Derived;
  tab: TabId;
  onTab: (tab: TabId) => void;
}

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'arena', label: 'Арена', icon: Swords },
  { id: 'lab', label: 'Лаборатория', icon: FlaskConical },
  { id: 'tower', label: 'Башня', icon: Castle },
  { id: 'inventory', label: 'Инвентарь', icon: Backpack },
];

export function Header({ state, derived, tab, onTab }: HeaderProps) {
  const { player } = state;
  const combat = (state.battle?.status === 'active' || state.blitz?.status === 'active') && tab !== 'arena';
  const xpPct = Math.min(100, (player.xp / derived.xpNeeded) * 100);

  return (
    <header className="wood-panel relative z-30 px-4 pt-4 pb-3 sm:px-6">
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <motion.div
            className="relative grid h-12 w-12 place-items-center rounded-full border-2 border-amber-500/70 bg-gradient-to-br from-emerald-900 to-[#081210] shadow-[0_0_26px_-6px_rgba(52,211,153,0.9)]"
            animate={{ rotate: [0, -4, 4, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <FlaskConical size={24} className="text-emerald-200" />
          </motion.div>
          <div>
            <h1 className="font-display text-2xl leading-none font-bold text-amber-100 gold-glow sm:text-3xl">Mathion</h1>
            <p className="font-display text-sm tracking-[0.2em] text-emerald-300/80 uppercase mystic-glow">Числовой Алхимик</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="min-w-32">
            <p className="flex items-baseline justify-between gap-3 font-display text-sm text-amber-100">
              Уровень <span className="font-mono text-lg font-bold text-amber-200">{player.level}</span>
            </p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full border border-amber-700/40 bg-black/50" aria-label={`Опыт: ${player.xp} из ${derived.xpNeeded}`}>
              <motion.div className="h-full bg-gradient-to-r from-amber-300 to-amber-600" initial={false} animate={{ width: `${xpPct}%` }} />
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-lg font-bold text-amber-200 gold-glow">
            <Coins size={17} className="text-amber-300" /> {player.gold}
          </span>
          <span className="rounded-lg border border-amber-700/30 bg-black/30 px-3 py-1.5">
            <EssenceRow essences={player.essences} />
          </span>
        </div>
      </div>

      <nav className="relative mt-4 grid grid-cols-4 gap-1.5" aria-label="Разделы игры">
        {TABS.map((item) => {
          const active = item.id === tab;
          const Icon = item.icon;
          return (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => onTab(item.id)}
              whileTap={{ scale: 0.95 }}
              aria-current={active ? 'page' : undefined}
              className={`focus-brass relative flex cursor-pointer items-center justify-center gap-2 rounded-lg px-2 py-2 font-display text-sm font-bold transition-colors sm:text-base ${
                active ? 'text-amber-950' : 'text-amber-200/75 hover:text-amber-100'
              }`}
            >
              {active && <motion.span layoutId="tab-plaque" className="brass-plaque absolute inset-0 rounded-lg" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <Icon size={17} className="relative z-10" />
              <span className="relative z-10 hidden sm:inline">{item.label}</span>
              {item.id === 'arena' && combat && (
                <span className="absolute top-1 right-1 z-10 h-2.5 w-2.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,1)]" aria-label="Идёт бой" />
              )}
            </motion.button>
          );
        })}
      </nav>
    </header>
  );
}
