import { motion } from 'framer-motion';
import { FlaskConical, TrendingUp, Trophy, type LucideIcon } from 'lucide-react';
import { pct } from '../game/format';
import { RESEARCH } from '../game/config';
import type { Records } from '../game/records';
import type { RightTab } from '../game/save';
import type { GameState, ResearchId, SellableRes } from '../game/types';
import { MarketPanel } from './MarketPanel';
import { RecordsPanel } from './RecordsPanel';
import { ResearchPanel } from './ResearchPanel';

const TABS: Array<{ id: RightTab; label: string; icon: LucideIcon }> = [
  { id: 'research', label: 'НИОКР', icon: FlaskConical },
  { id: 'market', label: 'Рынок', icon: TrendingUp },
  { id: 'records', label: 'Рекорды', icon: Trophy },
];

export function RightRack({
  state,
  records,
  tab,
  onTab,
  onResearch,
  onSell,
  onAutoSell,
}: {
  state: GameState;
  records: Records;
  tab: RightTab;
  onTab: (t: RightTab) => void;
  onResearch: (id: ResearchId) => void;
  onSell: (res: SellableRes, fraction: number) => void;
  onAutoSell: (res: SellableRes, on: boolean) => void;
}) {
  const act = state.research.active;
  const badge: Partial<Record<RightTab, string>> = {};
  if (act) badge.research = pct(act.paid / RESEARCH[act.id].code);
  if (state.market.event) badge.market = state.market.event.factor >= 1 ? '▲' : '▼';

  return (
    <section className="panel flex min-h-0 flex-col md:flex-1">
      <div role="tablist" aria-label="Модули управления" className="flex border-b border-steel-750 px-1 pt-1">
        {TABS.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              onClick={() => onTab(t.id)}
              className={`relative flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 font-display text-[11px] uppercase tracking-[0.12em] transition-colors ${
                active ? 'text-steel-100' : 'text-steel-400 hover:text-steel-200'
              }`}
            >
              <Icon size={13} aria-hidden />
              {t.label}
              {badge[t.id] && (
                <span className="num rounded-sm bg-code/25 px-1 text-[9.5px] tracking-normal text-code">{badge[t.id]}</span>
              )}
              {active && (
                <motion.span
                  layoutId="rack-tab"
                  className="absolute inset-x-2 bottom-0 h-[2px] rounded bg-data shadow-[0_0_10px_#22d3ee]"
                  transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3"
      >
        {tab === 'research' && <ResearchPanel state={state} onResearch={onResearch} />}
        {tab === 'market' && <MarketPanel state={state} onSell={onSell} onAutoSell={onAutoSell} />}
        {tab === 'records' && <RecordsPanel state={state} records={records} />}
      </div>
    </section>
  );
}
