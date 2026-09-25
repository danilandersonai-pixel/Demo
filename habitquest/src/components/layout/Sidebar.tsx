import { motion } from 'framer-motion';
import { CalendarClock, LayoutDashboard, Settings, Store, Swords, type LucideIcon } from 'lucide-react';
import { formatLongDate } from '../../game/dates';
import type { TabId } from '../../types';

export interface NavItem {
  id: TabId;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

export const NAV_ITEMS: Array<Omit<NavItem, 'badge'>> = [
  { id: 'dashboard', label: 'Персонаж', icon: LayoutDashboard },
  { id: 'quests', label: 'Квесты', icon: Swords },
  { id: 'shop', label: 'Магазин', icon: Store },
  { id: 'settings', label: 'Настройки', icon: Settings },
];

interface NavProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  badges: Partial<Record<TabId, number>>;
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-10 w-10 place-items-center rounded-xl border border-violet-300/40 bg-gradient-to-br from-violet-600 to-fuchsia-700 shadow-[0_0_24px_-2px_rgba(168,85,247,0.9)]">
        <Swords size={20} className="text-white" />
      </div>
      <div className="leading-tight">
        <p className="font-display text-lg tracking-wider text-white">
          Habit<span className="text-cyan-300 neon-cyber">Quest</span>
        </p>
        <p className="text-[10px] tracking-[0.3em] text-violet-200/50 uppercase">life rpg</p>
      </div>
    </div>
  );
}

/** Боковое меню для широких экранов. */
export function Sidebar({ active, onChange, badges, today, dayOffset }: NavProps & { today: string; dayOffset: number }) {
  return (
    <aside className="glass fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-y-0 border-l-0 px-4 py-6 lg:flex">
      <Logo />
      <nav className="mt-10 flex flex-col gap-1.5" aria-label="Разделы">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === active;
          const Icon = item.icon;
          const badge = badges[item.id];
          return (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.97 }}
              aria-current={isActive ? 'page' : undefined}
              className={`focus-ring relative flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold tracking-wide transition-colors ${
                isActive ? 'text-white' : 'text-violet-200/60 hover:text-violet-50'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-xl border border-violet-300/35 bg-gradient-to-r from-violet-600/45 to-fuchsia-600/15 shadow-[0_0_24px_-6px_rgba(168,85,247,0.9)]"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              {isActive && (
                <motion.span
                  layoutId="sidebar-bar"
                  className="absolute top-2 bottom-2 left-0 w-1 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,1)]"
                />
              )}
              <Icon size={18} className="relative z-10" />
              <span className="relative z-10 flex-1">{item.label}</span>
              {badge !== undefined && badge > 0 && (
                <span className="relative z-10 grid min-w-6 place-items-center rounded-md bg-rose-500/80 px-1.5 py-0.5 text-[11px] font-bold text-white shadow-[0_0_10px_rgba(255,59,92,0.7)]">
                  {badge}
                </span>
              )}
            </motion.button>
          );
        })}
      </nav>

      <div className="mt-auto rounded-xl border border-violet-400/15 bg-black/20 p-3 text-xs text-violet-200/60">
        <p className="flex items-center gap-1.5 font-semibold text-violet-100/80">
          <CalendarClock size={14} className="text-cyan-300" /> Игровой день
        </p>
        <p className="mt-1 capitalize">{formatLongDate(today)}</p>
        {dayOffset > 0 && <p className="mt-1 text-amber-300/80">Симуляция: +{dayOffset} дн.</p>}
      </div>
    </aside>
  );
}

/** Верхняя навигация для телефонов и планшетов. */
export function MobileNav({ active, onChange, badges }: NavProps) {
  return (
    <div className="glass sticky top-[env(safe-area-inset-top,0px)] z-40 border-x-0 border-t-0 px-4 pt-3 pb-2 lg:hidden">
      <Logo />
      <nav className="mt-3 grid grid-cols-4 gap-1" aria-label="Разделы">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === active;
          const Icon = item.icon;
          const badge = badges[item.id];
          return (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              whileTap={{ scale: 0.92 }}
              aria-current={isActive ? 'page' : undefined}
              className={`focus-ring relative flex cursor-pointer flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-semibold transition-colors ${
                isActive ? 'text-white' : 'text-violet-200/55'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="mobile-active"
                  className="absolute inset-0 rounded-lg border border-violet-300/35 bg-violet-600/35"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <Icon size={18} className="relative z-10" />
              <span className="relative z-10">{item.label}</span>
              {badge !== undefined && badge > 0 && (
                <span className="absolute top-1 right-2 z-10 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                  {badge}
                </span>
              )}
            </motion.button>
          );
        })}
      </nav>
    </div>
  );
}
