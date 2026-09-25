import { motion } from 'framer-motion';
import { CalendarClock, LayoutDashboard, Settings, Store, Swords, type LucideIcon } from 'lucide-react';
import { formatLongDate } from '../../game/dates';
import type { TabId } from '../../types';

export interface NavItem {
  id: TabId;
  label: string;
  code: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Персонаж', code: 'HERO', icon: LayoutDashboard },
  { id: 'quests', label: 'Квесты', code: 'QST', icon: Swords },
  { id: 'shop', label: 'Магазин', code: 'SHOP', icon: Store },
  { id: 'settings', label: 'Настройки', code: 'SYS', icon: Settings },
];

interface NavProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  badges: Partial<Record<TabId, number>>;
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 via-purple-600 to-indigo-600 shadow-[0_0_24px_-4px_rgba(192,38,211,0.9)]">
        <Swords size={19} className="text-white" />
        <span aria-hidden="true" className="absolute inset-0 rounded-xl border border-white/25" />
      </div>
      <div className="leading-tight">
        <p className="font-display text-[17px] font-bold tracking-tight text-white">
          Habit<span className="bg-gradient-to-r from-cyan-300 to-fuchsia-400 bg-clip-text text-transparent">Quest</span>
        </p>
        <p className="font-mono text-[9px] tracking-[0.35em] text-slate-500 uppercase">life.rpg // v1</p>
      </div>
    </div>
  );
}

/** Боковое меню для широких экранов. */
export function Sidebar({ active, onChange, badges, today, dayOffset }: NavProps & { today: string; dayOffset: number }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/[0.06] bg-[#0b0d17]/70 px-4 py-6 backdrop-blur-xl lg:flex">
      <Logo />
      <p className="mt-9 mb-2 px-3 font-mono text-[9px] tracking-[0.3em] text-slate-600 uppercase">Навигация</p>
      <nav className="flex flex-col gap-1" aria-label="Разделы">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === active;
          const Icon = item.icon;
          const badge = badges[item.id];
          return (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              whileHover={{ x: 3 }}
              whileTap={{ scale: 0.97 }}
              aria-current={isActive ? 'page' : undefined}
              className={`focus-ring group relative flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors duration-300 ${
                isActive ? 'text-white' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-xl border border-white/[0.1] bg-gradient-to-r from-fuchsia-500/20 via-purple-600/10 to-transparent shadow-[inset_0_0_24px_-10px_rgba(217,70,239,0.8)]"
                  transition={{ type: 'spring', stiffness: 450, damping: 36 }}
                />
              )}
              {isActive && (
                <motion.span
                  layoutId="sidebar-bar"
                  className="absolute top-2.5 bottom-2.5 -left-4 w-[3px] rounded-r-full bg-gradient-to-b from-cyan-300 to-fuchsia-500 shadow-[0_0_12px_rgba(34,211,238,1)]"
                  transition={{ type: 'spring', stiffness: 450, damping: 36 }}
                />
              )}
              <span
                className={`relative z-10 grid h-8 w-8 place-items-center rounded-lg border transition-colors duration-300 ${
                  isActive ? 'border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-200' : 'border-white/[0.06] bg-white/[0.02] group-hover:border-white/[0.15]'
                }`}
              >
                <Icon size={16} />
              </span>
              <span className="relative z-10 flex-1">{item.label}</span>
              <span className="relative z-10 font-mono text-[9px] tracking-widest text-slate-600">{item.code}</span>
              {badge !== undefined && badge > 0 && (
                <span className="relative z-10 grid min-w-5 place-items-center rounded-md bg-red-500 px-1 py-0.5 font-mono text-[10px] font-bold text-white shadow-[0_0_12px_rgba(239,68,68,0.8)]">
                  {badge}
                </span>
              )}
            </motion.button>
          );
        })}
      </nav>

      <div className="glass mt-auto rounded-xl p-3.5">
        <p className="flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.2em] text-cyan-300 uppercase">
          <CalendarClock size={13} /> Игровой день
        </p>
        <p className="mt-1.5 text-sm text-slate-200 first-letter:uppercase">{formatLongDate(today)}</p>
        {dayOffset > 0 && <p className="mt-1 font-mono text-[11px] text-amber-300/90">SIM +{dayOffset} дн.</p>}
      </div>
    </aside>
  );
}

/** Верхняя навигация для телефонов и планшетов. */
export function MobileNav({ active, onChange, badges }: NavProps) {
  return (
    <div className="sticky top-[env(safe-area-inset-top,0px)] z-40 border-b border-white/[0.06] bg-[#0b0d17]/80 px-4 pt-3 pb-2 backdrop-blur-xl lg:hidden">
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
                isActive ? 'text-white' : 'text-slate-400'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="mobile-active"
                  className="absolute inset-0 rounded-lg border border-white/[0.1] bg-gradient-to-b from-fuchsia-500/25 to-indigo-600/10"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <Icon size={18} className="relative z-10" />
              <span className="relative z-10">{item.label}</span>
              {badge !== undefined && badge > 0 && (
                <span className="absolute top-1 right-2 z-10 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 font-mono text-[9px] font-bold text-white shadow-[0_0_10px_rgba(239,68,68,0.8)]">
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
