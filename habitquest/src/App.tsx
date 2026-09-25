import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useCallback, useMemo, useState } from 'react';
import { CombatLog } from './components/layout/CombatLog';
import { HeroStatusBar } from './components/layout/HeroStatusBar';
import { MobileNav, Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './components/dashboard/Dashboard';
import { ProfileModal } from './components/dashboard/ProfileModal';
import { QuestsView } from './components/quests/QuestsView';
import { SettingsView } from './components/settings/SettingsView';
import { ShopView } from './components/shop/ShopView';
import { FloatingRewards } from './components/effects/FloatingRewards';
import { DeathOverlay, LevelUpOverlay } from './components/effects/Overlays';
import { TAB_STORAGE_KEY } from './game/constants';
import { isDailyDue } from './game/engine';
import { readPreference, writePreference } from './game/storage';
import { useGame } from './hooks/useGame';
import type { TabId } from './types';

const TABS: TabId[] = ['dashboard', 'quests', 'shop', 'settings'];
const LOG_PREF_KEY = 'habitquest:log-open';

function initialTab(): TabId {
  const stored = readPreference(TAB_STORAGE_KEY);
  return TABS.includes(stored as TabId) ? (stored as TabId) : 'dashboard';
}

export default function App() {
  const game = useGame();
  const { state, derived, actions } = game;
  const [tab, setTab] = useState<TabId>(initialTab);
  const [logOpen, setLogOpen] = useState(() => {
    const stored = readPreference(LOG_PREF_KEY);
    if (stored) return stored === 'open';
    return window.innerWidth >= 1024;
  });
  const [profileOpen, setProfileOpen] = useState(false);

  const changeTab = useCallback((next: TabId) => {
    setTab(next);
    writePreference(TAB_STORAGE_KEY, next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const toggleLog = useCallback(() => {
    setLogOpen((open) => {
      writePreference(LOG_PREF_KEY, open ? 'closed' : 'open');
      return !open;
    });
  }, []);

  const badges = useMemo(() => {
    const pendingDailies = state.dailies.filter((d) => isDailyDue(d, derived.today) && !d.completed).length;
    return { quests: pendingDailies };
  }, [state.dailies, derived.today]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-backdrop" aria-hidden="true" />
      <Sidebar active={tab} onChange={changeTab} badges={badges} today={derived.today} dayOffset={state.dayOffset} />

      <div className="relative z-10 lg:pl-64">
        <MobileNav active={tab} onChange={changeTab} badges={badges} />
        <main className={`mx-auto flex max-w-[1500px] flex-col gap-4 px-4 pt-4 sm:px-6 lg:pt-6 ${logOpen ? 'pb-72' : 'pb-24'}`}>
          <HeroStatusBar hero={state.hero} maxHp={derived.maxHp} xpNeeded={derived.xpNeeded} onOpenProfile={() => setProfileOpen(true)} />

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {tab === 'dashboard' && (
                <Dashboard
                  state={state}
                  today={derived.today}
                  maxHp={derived.maxHp}
                  xpNeeded={derived.xpNeeded}
                  actions={actions}
                  onOpenProfile={() => setProfileOpen(true)}
                  onNavigate={changeTab}
                />
              )}
              {tab === 'quests' && <QuestsView state={state} today={derived.today} actions={actions} />}
              {tab === 'shop' && <ShopView state={state} actions={actions} />}
              {tab === 'settings' && <SettingsView state={state} today={derived.today} actions={actions} saveFailed={game.saveFailed} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CombatLog entries={state.log} open={logOpen} onToggle={toggleLog} onClear={actions.clearLog} />
      <ProfileModal open={profileOpen} hero={state.hero} onClose={() => setProfileOpen(false)} onSave={actions.updateProfile} />
      <FloatingRewards floaters={game.floaters} />
      <LevelUpOverlay info={game.levelUp} onClose={game.dismissLevelUp} />
      <DeathOverlay info={game.death} onClose={game.dismissDeath} />
    </MotionConfig>
  );
}
