// Игровой цикл и связь движка с React.
// Авторитетное состояние лежит в ref: тики и действия мутируют его копию,
// затем кладут в state для отрисовки. Так побочные эффекты (тосты, рекорды,
// сохранение) выполняются ровно один раз и не зависят от StrictMode.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BAL } from '../game/config';
import * as engine from '../game/engine';
import { newSeed } from '../game/rng';
import {
  onNewFactory,
  trackAgi,
  trackBuilt,
  trackIncome,
  type Celebration,
  type Records,
} from '../game/records';
import {
  clearGame,
  loadGame,
  loadPrefs,
  loadRecords,
  saveGame,
  savePrefs,
  saveRecords,
  storageAvailable,
  type Prefs,
  type RightTab,
} from '../game/save';
import { avgIncome } from '../game/selectors';
import type {
  ActionResult,
  BuildingType,
  GameState,
  Notice,
  OfflineSummary,
  ResearchId,
  SellableRes,
} from '../game/types';

export interface ToastItem extends Notice {
  id: number;
}

const SAVE_EVERY_MS = 5000;
const CELEBRATION_GAP_MS = 12000;
/** Больше стольких тиков за раз — показываем отчёт, как после офлайна. */
const BATCH_REPORT = 300;

interface Boot {
  state: GameState;
  records: Records;
  prefs: Prefs;
  offline: OfflineSummary | null;
  storageOk: boolean;
}

function boot(): Boot {
  const storageOk = storageAvailable();
  const prefs = loadPrefs();
  let records = loadRecords();
  let state = loadGame();
  let offline: OfflineSummary | null = null;
  if (!state) {
    state = engine.createState(newSeed(), Date.now());
  } else if (prefs.speed > 0) {
    // Пока вкладка была закрыта, фабрика работала сама (не дольше 4 часов).
    const elapsed = Math.floor((Date.now() - state.savedAt) / 1000);
    if (elapsed >= 2) {
      const before = state.stats.commissioned;
      const summary = engine.simulate(state, Math.min(elapsed, BAL.offlineCap));
      if (elapsed >= 60) offline = summary;
      records = trackIncome(records, avgIncome(state), Date.now()).r;
      const fresh = state.stats.commissioned - before;
      if (fresh > 0) records = trackBuilt(records, fresh).r;
    }
  }
  return { state, records, prefs, offline, storageOk };
}

export function useGame() {
  const initial = useMemo(boot, []);
  const stateRef = useRef<GameState>(initial.state);
  const [state, setState] = useState<GameState>(initial.state);
  const recordsRef = useRef<Records>(initial.records);
  const [records, setRecords] = useState<Records>(initial.records);
  const prefsRef = useRef<Prefs>(initial.prefs);
  const [speed, setSpeedState] = useState<number>(initial.prefs.speed);
  const speedRef = useRef<number>(initial.prefs.speed);
  const [tab, setTabState] = useState<RightTab>(initial.prefs.tab);
  const [welcomed, setWelcomedState] = useState<boolean>(initial.prefs.welcomed);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [offline, setOffline] = useState<OfflineSummary | null>(initial.offline);
  const [lastSave, setLastSave] = useState<number | null>(null);
  const [storageOk] = useState<boolean>(initial.storageOk);

  const toastSeq = useRef(0);
  const celebrationSeq = useRef(0);
  const lastCelebration = useRef(0);
  const lastSaveAt = useRef(Date.now());
  const toastTimers = useRef(new Map<number, number>());

  // ---------- уведомления ----------
  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    toastTimers.current.delete(id);
  }, []);

  const pushToasts = useCallback(
    (notices: Notice[]) => {
      if (!notices.length) return;
      const items = notices.slice(-4).map((n) => ({ ...n, id: ++toastSeq.current }));
      setToasts((list) => [...list, ...items].slice(-5));
      for (const it of items) {
        const ms = it.tone === 'bad' ? 7000 : 4800;
        toastTimers.current.set(
          it.id,
          window.setTimeout(() => dismissToast(it.id), ms),
        );
      }
    },
    [dismissToast],
  );

  useEffect(() => {
    const timers = toastTimers.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  const celebrate = useCallback((c: Omit<Celebration, 'id'>) => {
    const now = Date.now();
    if (now - lastCelebration.current < CELEBRATION_GAP_MS && c.kind === 'income') return;
    lastCelebration.current = now;
    setCelebration({ ...c, id: ++celebrationSeq.current });
  }, []);

  // ---------- сохранение ----------
  const persist = useCallback(() => {
    const s = stateRef.current;
    const ok = saveGame({ ...s, savedAt: Date.now() });
    saveRecords(recordsRef.current);
    lastSaveAt.current = Date.now();
    if (ok) setLastSave(Date.now());
  }, []);

  const setRecordsBoth = useCallback((r: Records) => {
    recordsRef.current = r;
    setRecords(r);
  }, []);

  const commit = useCallback((next: GameState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const afterTicks = useCallback(
    (next: GameState, commissionedBefore: number) => {
      // Рекорд построек растёт, когда узлы проходят 30-секундную пусконаладку.
      const fresh = next.stats.commissioned - commissionedBefore;
      if (fresh > 0) {
        const { r, milestone } = trackBuilt(recordsRef.current, fresh);
        setRecordsBoth(r);
        saveRecords(r);
        if (milestone) celebrate({ kind: 'built', value: milestone, prev: milestone });
      }
      const inc = avgIncome(next);
      const res = trackIncome(recordsRef.current, inc, Date.now());
      if (res.r !== recordsRef.current) {
        setRecordsBoth(res.r);
        if (res.celebrate) {
          celebrate({ kind: 'income', value: inc, prev: res.prev });
          saveRecords(res.r);
        }
      }
      if (Date.now() - lastSaveAt.current >= SAVE_EVERY_MS) persist();
    },
    [celebrate, persist, setRecordsBoth],
  );

  // ---------- игровой цикл ----------
  const advance = useCallback(
    (ticks: number) => {
      const commissionedBefore = stateRef.current.stats.commissioned;
      const next = structuredClone(stateRef.current);
      if (ticks > BATCH_REPORT) {
        const summary = engine.simulate(next, Math.min(ticks, BAL.offlineCap));
        commit(next);
        setOffline(summary);
      } else {
        const notices: Notice[] = [];
        for (let i = 0; i < ticks; i++) notices.push(...engine.step(next));
        commit(next);
        pushToasts(notices);
      }
      afterTicks(next, commissionedBefore);
    },
    [afterTicks, commit, pushToasts],
  );

  useEffect(() => {
    let last = performance.now();
    let acc = 0;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      const sp = speedRef.current;
      if (sp <= 0) {
        acc = 0;
        if (Date.now() - lastSaveAt.current >= SAVE_EVERY_MS) persist();
        return;
      }
      acc += dt * sp;
      const n = Math.floor(acc / 1000);
      if (n <= 0) return;
      acc -= n * 1000;
      advance(n);
    }, 100);
    return () => window.clearInterval(timer);
  }, [advance, persist]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [persist]);

  // ---------- действия игрока ----------
  const act = useCallback(
    (fn: (s: GameState) => ActionResult, after?: (s: GameState) => void): boolean => {
      const next = structuredClone(stateRef.current);
      const res = fn(next);
      if (!res.ok) {
        pushToasts([{ tone: 'warn', title: res.error ?? 'Не получилось' }]);
        return false;
      }
      commit(next);
      if (res.notices?.length) pushToasts(res.notices);
      after?.(next);
      return true;
    },
    [commit, pushToasts],
  );

  const build = useCallback(
    (type: BuildingType, x: number, y: number) =>
      act(
        (s) => engine.build(s, type, x, y),
        (s) => {
          if (type !== 'agi') return;
          const rec = trackAgi(recordsRef.current, s.tick);
          setRecordsBoth(rec);
          saveRecords(rec);
        },
      ),
    [act, setRecordsBoth],
  );

  const actions = useMemo(
    () => ({
      build,
      upgrade: (id: number) => act((s) => engine.upgrade(s, id)),
      demolish: (id: number) => act((s) => engine.demolish(s, id)),
      toggle: (id: number) => act((s) => engine.toggle(s, id)),
      move: (id: number, x: number, y: number) => act((s) => engine.move(s, id, x, y)),
      refactor: () => act((s) => engine.refactor(s)),
      research: (id: ResearchId) => act((s) => engine.startResearch(s, id)),
      sell: (res: SellableRes, fraction: number) => act((s) => engine.sell(s, res, fraction)),
      setAutoSell: (res: SellableRes, on: boolean) => act((s) => engine.setAutoSell(s, res, on)),
    }),
    [act, build],
  );

  const setSpeed = useCallback((sp: number) => {
    speedRef.current = sp;
    setSpeedState(sp);
    prefsRef.current = { ...prefsRef.current, speed: sp };
    savePrefs(prefsRef.current);
  }, []);

  const setTab = useCallback((t: RightTab) => {
    setTabState(t);
    prefsRef.current = { ...prefsRef.current, tab: t };
    savePrefs(prefsRef.current);
  }, []);

  const markWelcomed = useCallback(() => {
    setWelcomedState(true);
    prefsRef.current = { ...prefsRef.current, welcomed: true };
    savePrefs(prefsRef.current);
  }, []);

  const reset = useCallback(() => {
    const s = engine.createState(newSeed(), Date.now());
    commit(s);
    clearGame();
    const r = onNewFactory(recordsRef.current);
    setRecordsBoth(r);
    setOffline(null);
    persist();
    pushToasts([{ tone: 'info', title: 'Новая фабрика запущена', text: 'Рекорды сохранены — попробуйте их побить.' }]);
  }, [commit, persist, pushToasts, setRecordsBoth]);

  return {
    state,
    records,
    speed,
    setSpeed,
    tab,
    setTab,
    welcomed,
    markWelcomed,
    toasts,
    dismissToast,
    celebration,
    dismissCelebration: useCallback(() => setCelebration(null), []),
    offline,
    dismissOffline: useCallback(() => setOffline(null), []),
    lastSave,
    storageOk,
    reset,
    ...actions,
  };
}

export type GameApi = ReturnType<typeof useGame>;
