import { MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BuildMenu } from './components/BuildMenu';
import { BuildingPanel } from './components/BuildingPanel';
import { HelpDialog, OfflineDialog, ResetDialog, WelcomeDialog } from './components/Dialogs';
import { FactoryFloor } from './components/FactoryFloor';
import { EventLog, GoalStrip, Toasts } from './components/Feed';
import { Inventory } from './components/Inventory';
import { PowerGrid } from './components/PowerGrid';
import { RecordBurst } from './components/RecordBurst';
import { RightRack } from './components/RightRack';
import { TechDebt } from './components/TechDebt';
import { TopBar } from './components/TopBar';
import { useGame } from './hooks/useGame';
import type { BuildingType } from './game/types';

export default function App() {
  const g = useGame();
  const [cell, setCell] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const lastSpeed = useRef(g.speed > 0 ? g.speed : 1);

  const welcomeOpen = !g.welcomed && g.offline === null;
  const modalOpen = cell !== null || selected !== null || help || confirmReset || welcomeOpen || g.offline !== null;

  const setSpeed = g.setSpeed;
  const changeSpeed = useCallback(
    (v: number) => {
      if (v > 0) lastSpeed.current = v;
      setSpeed(v);
    },
    [setSpeed],
  );

  // Закрытое/снесённое здание не должно держать открытой панель.
  useEffect(() => {
    if (selected !== null && !g.state.buildings.some((b) => b.id === selected)) setSelected(null);
    if (moving !== null && !g.state.buildings.some((b) => b.id === moving)) setMoving(null);
  }, [g.state.buildings, selected, moving]);

  const onCell = (x: number, y: number) => {
    if (moving !== null) {
      if (g.move(moving, x, y)) setMoving(null);
      return;
    }
    setSelected(null);
    setCell({ x, y });
  };

  const onBuilding = (id: number) => {
    if (moving !== null) {
      if (id === moving) setMoving(null);
      return;
    }
    setCell(null);
    setSelected(id);
  };

  const onBuild = (type: BuildingType) => {
    if (cell && g.build(type, cell.x, cell.y)) setCell(null);
  };

  const closeTop = useCallback(() => {
    if (confirmReset) return setConfirmReset(false);
    if (help) return setHelp(false);
    if (cell) return setCell(null);
    if (selected !== null) return setSelected(null);
    if (moving !== null) return setMoving(null);
    if (g.offline) return g.dismissOffline();
    if (welcomeOpen) return g.markWelcomed();
  }, [confirmReset, help, cell, selected, moving, g, welcomeOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      if (e.key === 'Escape') {
        closeTop();
        return;
      }
      if (modalOpen) return;
      const interactive = !!t && !!t.closest('button, a, [role="button"], [role="switch"], [role="tab"]');
      if (e.key === 'p' || e.key === 'з' || (e.code === 'Space' && !interactive)) {
        e.preventDefault();
        changeSpeed(g.speed === 0 ? lastSpeed.current : 0);
      } else if (e.key === '1') changeSpeed(1);
      else if (e.key === '2') changeSpeed(2);
      else if (e.key === '3') changeSpeed(4);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeTop, modalOpen, changeSpeed, g.speed]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-bg flex min-h-full flex-col text-steel-100 md:h-full">
        <TopBar
          state={g.state}
          records={g.records}
          speed={g.speed}
          onSpeed={changeSpeed}
          onHelp={() => setHelp(true)}
          onReset={() => setConfirmReset(true)}
          lastSave={g.lastSave}
          storageOk={g.storageOk}
        />

        <main className="flex flex-col gap-3 px-4 py-3 md:grid md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-1 xl:grid-cols-[292px_minmax(0,1fr)_352px]">
          {/* Центр: цех и текущий контракт */}
          <div className="contents md:col-start-1 md:row-start-1 md:flex md:min-h-0 md:flex-col md:gap-3 xl:col-start-2">
            <div className="order-1 flex min-h-0 flex-col md:flex-1">
              <FactoryFloor
                state={g.state}
                selectedId={selected}
                selectedCell={cell}
                moving={moving}
                onCell={onCell}
                onBuilding={onBuilding}
                onCancelMove={() => setMoving(null)}
              />
            </div>
            <div className="order-2">
              <GoalStrip state={g.state} />
            </div>
          </div>

          {/* Боковые стойки: на среднем экране — одна прокручиваемая колонка, на широком — две */}
          <div className="scroll-thin contents md:col-start-2 md:row-start-1 md:flex md:min-h-0 md:flex-col md:gap-3 md:overflow-y-auto xl:contents">
            <div className="scroll-thin contents xl:col-start-1 xl:row-start-1 xl:flex xl:min-h-0 xl:flex-col xl:gap-3 xl:overflow-y-auto">
              <div className="order-3">
                <Inventory state={g.state} onAutoSell={g.setAutoSell} />
              </div>
              <div className="order-4">
                <PowerGrid state={g.state} />
              </div>
              <div className="order-5">
                <TechDebt state={g.state} onRefactor={g.refactor} />
              </div>
              <div className="order-7">
                <EventLog state={g.state} />
              </div>
            </div>
            <div className="order-6 flex min-h-[520px] flex-col md:shrink-0 xl:col-start-3 xl:row-start-1 xl:min-h-0">
              <RightRack
                state={g.state}
                records={g.records}
                tab={g.tab}
                onTab={g.setTab}
                onResearch={g.research}
                onSell={g.sell}
                onAutoSell={g.setAutoSell}
              />
            </div>
          </div>
        </main>

        <BuildMenu state={g.state} cell={cell} onBuild={onBuild} onClose={() => setCell(null)} />
        <BuildingPanel
          state={g.state}
          id={selected}
          onClose={() => setSelected(null)}
          onUpgrade={g.upgrade}
          onToggle={g.toggle}
          onMove={(id) => {
            setSelected(null);
            setMoving(id);
          }}
          onDemolish={(id) => {
            if (g.demolish(id)) setSelected(null);
          }}
          onRefactor={g.refactor}
        />
        <HelpDialog open={help} onClose={() => setHelp(false)} state={g.state} />
        <ResetDialog
          open={confirmReset}
          onClose={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            setCell(null);
            setSelected(null);
            setMoving(null);
            g.reset();
          }}
        />
        <OfflineDialog summary={g.offline} onClose={g.dismissOffline} />
        <WelcomeDialog open={welcomeOpen} onClose={g.markWelcomed} />

        <Toasts toasts={g.toasts} onDismiss={g.dismissToast} />
        <RecordBurst celebration={g.celebration} onDone={g.dismissCelebration} />
        <div className="scanlines" aria-hidden />
      </div>
    </MotionConfig>
  );
}
