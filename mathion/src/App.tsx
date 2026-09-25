import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { useCallback, useState } from 'react';
import { ArenaView } from './components/arena/ArenaView';
import { InventoryView } from './components/inventory/InventoryView';
import { LabView } from './components/lab/LabView';
import { BattleLog } from './components/layout/BattleLog';
import { Header } from './components/layout/Header';
import { TowerView } from './components/tower/TowerView';
import { AlchemyCircle } from './components/ui/AlchemyCircle';
import { TAB_KEY } from './game/constants';
import { readPreference, writePreference } from './game/storage';
import { useGame } from './hooks/useGame';
import type { TabId } from './types';

const TABS: TabId[] = ['arena', 'lab', 'tower', 'inventory'];
const LOG_KEY = 'mathion:log-open';

function initialTab(): TabId {
  const stored = readPreference(TAB_KEY);
  return TABS.includes(stored as TabId) ? (stored as TabId) : 'arena';
}

export default function App() {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [logOpen, setLogOpen] = useState(() => readPreference(LOG_KEY) === 'open');
  const game = useGame(tab === 'arena');
  const { state, derived, actions, fx } = game;

  const changeTab = useCallback((next: TabId) => {
    setTab(next);
    writePreference(TAB_KEY, next);
  }, []);

  const toggleLog = useCallback(() => {
    setLogOpen((open) => {
      writePreference(LOG_KEY, open ? 'closed' : 'open');
      return !open;
    });
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="lab-backdrop" aria-hidden="true">
        <AlchemyCircle className="absolute -top-40 -right-40 h-[44rem] w-[44rem] animate-spin-slow text-amber-400/[0.06]" />
        <AlchemyCircle className="absolute -bottom-48 -left-48 h-[38rem] w-[38rem] animate-spin-rev text-emerald-400/[0.06]" />
      </div>

      <div className={`relative z-10 mx-auto flex max-w-[1400px] flex-col gap-4 px-4 pt-4 sm:px-6 ${logOpen ? 'pb-80' : 'pb-36'}`}>
        <Header state={state} derived={derived} tab={tab} onTab={changeTab} />

        <AnimatePresence mode="wait">
          <motion.main
            key={tab}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === 'arena' && <ArenaView state={state} derived={derived} actions={actions} fx={fx} paused={game.paused} onNavigate={changeTab} />}
            {tab === 'lab' && <LabView state={state} actions={actions} />}
            {tab === 'tower' && <TowerView state={state} actions={actions} onStart={() => changeTab('arena')} />}
            {tab === 'inventory' && <InventoryView state={state} derived={derived} actions={actions} onNavigate={changeTab} />}
          </motion.main>
        </AnimatePresence>

        {game.saveFailed && (
          <p className="rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-2 text-sm text-red-200">
            Браузер запретил сохранение (localStorage) — прогресс не переживёт перезагрузку страницы.
          </p>
        )}
      </div>

      <BattleLog entries={state.log} open={logOpen} onToggle={toggleLog} onClear={actions.clearLog} />

      <AnimatePresence>
        {fx.banner && (
          <motion.div
            key={fx.banner.id}
            className="pointer-events-none fixed inset-x-0 top-24 z-[80] flex justify-center"
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            role="status"
          >
            <div className="brass-plaque flex items-center gap-2 rounded-xl px-6 py-3 font-display text-2xl font-bold shadow-[0_0_40px_rgba(240,200,114,0.8)]">
              <Sparkles size={22} /> {fx.banner.text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
