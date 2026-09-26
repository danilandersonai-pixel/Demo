import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import Header from './components/Header.jsx';
import MetricsPanel from './components/MetricsPanel.jsx';
import ArchitectPanel from './components/ArchitectPanel.jsx';
import VibeCodingPanel from './components/VibeCodingPanel.jsx';
import Terminal from './components/Terminal.jsx';
import GoalsPanel from './components/GoalsPanel.jsx';
import { AutonomyModal, BankruptModal, ConfirmResetModal, HelpModal, RecordBanner } from './components/Overlays.jsx';
import { SPEEDS } from './game/config.js';
import * as E from './game/engine.js';
import { hoursLabel, money } from './game/format.js';
import { clearGame, loadGame, loadRecords, saveGame, saveRecords } from './game/storage.js';

let bannerSeq = 0;

export default function App() {
  const [game, setGame] = useState(() => loadGame() || E.createNewGame());
  const [records, setRecords] = useState(() => loadRecords());
  const [speed, setSpeed] = useState(1);
  const [helpOpen, setHelpOpen] = useState(() => !loadRecords().seenHelp);
  const [resetOpen, setResetOpen] = useState(false);
  const [autonomyOpen, setAutonomyOpen] = useState(false);
  const [banner, setBanner] = useState(null);
  const [critFlash, setCritFlash] = useState({});
  const [savedAt, setSavedAt] = useState(null);

  const gameRef = useRef(game);
  const recordsRef = useRef(records);
  // Порог, после которого снова показываем баннер дохода (чтобы не мигал каждый час)
  const announcedIncome = useRef(records.maxIncome);
  const lastIncomeBannerHour = useRef(-999);

  const commitGame = useCallback((next) => {
    gameRef.current = next;
    setGame(next);
  }, []);

  const commitRecords = useCallback((next) => {
    recordsRef.current = next;
    setRecords(next);
    saveRecords(next);
  }, []);

  const showBanner = useCallback((kind, text, sub) => {
    bannerSeq += 1;
    setBanner({ id: bannerSeq, kind, text, sub });
  }, []);

  // Обработка событий тика: рекорды, инциденты, банкротство, победа
  const handleEvents = useCallback(
    (events, state) => {
      let rec = recordsRef.current;
      let changed = false;
      const flashes = {};
      for (const e of events) {
        if (e.type === 'crit') flashes[e.agentId] = true;
        if (e.type === 'record_income' && e.value > rec.maxIncome) {
          rec = { ...rec, maxIncome: e.value, maxIncomeAt: state.hour - 1 };
          changed = true;
          const threshold = Math.max(announcedIncome.current * 1.1, announcedIncome.current + 15);
          if (e.value >= threshold && state.hour - lastIncomeBannerHour.current >= 12) {
            announcedIncome.current = e.value;
            lastIncomeBannerHour.current = state.hour;
            showBanner('income', `Пассивный доход ${money(e.value, 0)} в час`, 'Среднее за последние 6 часов — лучший результат за всё время');
          }
        }
        if (e.type === 'record_streak' && e.value > rec.maxStreak) {
          rec = { ...rec, maxStreak: e.value, maxStreakAt: state.hour };
          changed = true;
          if (e.announce) showBanner('streak', `${hoursLabel(e.value)} без галлюцинаций — и счёт идёт`, 'Самая стабильная система за всё время');
        }
        if (e.type === 'autonomy') {
          rec = {
            ...rec,
            autonomyWins: rec.autonomyWins + 1,
            fastestAutonomy: rec.fastestAutonomy === null ? state.hour : Math.min(rec.fastestAutonomy, state.hour),
          };
          changed = true;
          showBanner('autonomy', `Система работает сама за ${hoursLabel(state.hour)}`, 'Зарабатывает, масштабируется и чинит себя без вас');
          setAutonomyOpen(true);
        }
        if (e.type === 'bankrupt') setSpeed(0);
      }
      if (changed) commitRecords(rec);
      if (Object.keys(flashes).length) {
        setCritFlash((f) => ({ ...f, ...flashes }));
        setTimeout(() => {
          setCritFlash((f) => {
            const n = { ...f };
            for (const id of Object.keys(flashes)) delete n[id];
            return n;
          });
        }, 1200);
      }
    },
    [commitRecords, showBanner]
  );

  // Игровой цикл: 1 тик = 1 игровой час
  const modalOpen = helpOpen || resetOpen || autonomyOpen || game.bankrupt;
  const effectiveSpeed = modalOpen ? 0 : speed;
  useEffect(() => {
    const mult = SPEEDS.find((s) => s.id === effectiveSpeed).mult;
    if (!mult) return undefined;
    const id = setInterval(() => {
      const { state, events } = E.tick(gameRef.current, Math.random, recordsRef.current);
      commitGame(state);
      if (events.length) handleEvents(events, state);
    }, 1000 / mult);
    return () => clearInterval(id);
  }, [effectiveSpeed, commitGame, handleEvents]);

  // Автосохранение
  useEffect(() => {
    if (saveGame(game)) setSavedAt(Date.now());
  }, [game]);

  useEffect(() => {
    const onUnload = () => saveGame(gameRef.current);
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // Горячие клавиши
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.code === 'Space') {
        if (tag === 'BUTTON') return; // пробел на кнопке — это клик по ней

        e.preventDefault();
        setSpeed((s) => (s === 0 ? 1 : 0));
      } else if (e.key === '1') setSpeed(1);
      else if (e.key === '2') setSpeed(2);
      else if (e.key === '3') setSpeed(4);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Обёртка для действий игрока: действие из движка возвращает новый state или null
  const apply = useCallback(
    (fn) => {
      const next = fn(gameRef.current);
      if (next) commitGame(next);
      return !!next;
    },
    [commitGame]
  );

  const actions = useMemo(
    () => ({
      deploy: (taskId, modelId) => apply((s) => E.actDeployAgent(s, taskId, modelId)),
      update: (id, patch) => apply((s) => E.actUpdateAgent(s, id, patch)),
      toggle: (id) => apply((s) => E.actToggleAgent(s, id)),
      remove: (id) => apply((s) => E.actRemoveAgent(s, id)),
      buyKey: (modelId) => apply((s) => E.actBuyKey(s, modelId)),
      buyServer: (id) => apply((s) => E.actBuyServer(s, id)),
      sellServer: (id) => apply((s) => E.actSellServer(s, id)),
      research: (id) => apply((s) => E.actResearch(s, id)),
      build: (id) => apply((s) => E.actStartBuild(s, id)),
      refactor: () => apply((s) => E.actRefactor(s)),
      cancelJob: () => apply((s) => E.actCancelJob(s)),
      setBuildMode: (mode) => apply((s) => E.actSetBuildMode(s, mode)),
    }),
    [apply]
  );

  const derived = useMemo(() => E.computeDerived(game), [game]);

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    if (!recordsRef.current.seenHelp) commitRecords({ ...recordsRef.current, seenHelp: true });
  }, [commitRecords]);

  const restart = useCallback(() => {
    clearGame();
    const fresh = E.createNewGame();
    commitGame(fresh);
    commitRecords({ ...recordsRef.current, gamesStarted: recordsRef.current.gamesStarted + 1 });
    announcedIncome.current = recordsRef.current.maxIncome;
    lastIncomeBannerHour.current = -999;
    setResetOpen(false);
    setAutonomyOpen(false);
    setSpeed(1);
  }, [commitGame, commitRecords]);

  const closeBanner = useCallback(() => setBanner(null), []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="ide-grid min-h-screen bg-[#0F141C] text-slate-300">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(34,211,238,0.08),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(168,85,247,0.08),transparent_50%)]" />
        <Header hour={game.hour} speed={speed} onSpeed={setSpeed} onHelp={() => setHelpOpen(true)} onReset={() => setResetOpen(true)} savedAt={savedAt} />

        <main className="relative mx-auto max-w-[1600px] space-y-4 px-4 py-4">
          <MetricsPanel game={game} derived={derived} records={records} />

          <div className="grid gap-4 xl:grid-cols-12">
            <div className="min-w-0 xl:col-span-7">
              <ArchitectPanel game={game} derived={derived} critFlash={critFlash} actions={actions} />
            </div>
            <div className="min-w-0 xl:col-span-5">
              <VibeCodingPanel game={game} speed={effectiveSpeed} actions={actions} />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-12">
            <div className="min-w-0 xl:col-span-8">
              <Terminal logs={game.logs} onClear={() => commitGame({ ...gameRef.current, logs: [] })} />
            </div>
            <div className="min-w-0 xl:col-span-4">
              <GoalsPanel game={game} derived={derived} records={records} />
            </div>
          </div>

          <footer className="pb-4 pt-2 text-center text-[10px] text-slate-600">
            VibeTycoon · 1 секунда = 1 час · всё сохраняется в localStorage · пробел — пауза
          </footer>
        </main>

        <RecordBanner banner={banner} onClose={closeBanner} />
        <HelpModal open={helpOpen} onClose={closeHelp} />
        <ConfirmResetModal open={resetOpen} onCancel={() => setResetOpen(false)} onConfirm={restart} />
        <AutonomyModal open={autonomyOpen} game={game} onClose={() => setAutonomyOpen(false)} />
        <BankruptModal open={game.bankrupt} game={game} onRestart={restart} />
      </div>
    </MotionConfig>
  );
}
