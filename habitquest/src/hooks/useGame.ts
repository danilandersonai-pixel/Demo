import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AvatarId,
  DailyDraft,
  EngineResult,
  Floater,
  GameState,
  HabitDraft,
  Origin,
  RewardDraft,
  TaskType,
  TodoDraft,
} from '../types';
import * as engine from '../game/engine';
import { STORAGE_KEY, maxHp, xpToNextLevel } from '../game/constants';
import { gameToday, toDateKey } from '../game/dates';
import { createInitialState } from '../game/seed';
import { loadState, normalizeState, saveState } from '../game/storage';
import { uid } from '../game/utils';

export interface LevelUpInfo {
  level: number;
  bonusGold: number;
}

export interface DeathInfo {
  lostLevel: boolean;
  lostGold: number;
}

const FLOATER_LIFETIME = 1600;
const DAY_CHECK_INTERVAL = 30_000;

function realToday(): string {
  return toDateKey(new Date());
}

function defaultOrigin(): Origin {
  return { x: window.innerWidth / 2, y: Math.min(160, window.innerHeight / 3) };
}

/**
 * Центральный хук игры. Хранит GameState, прогоняет действия через движок,
 * сохраняет результат в localStorage и превращает события движка в визуальные эффекты.
 */
export function useGame() {
  const [state, setState] = useState<GameState>(() => loadState(realToday()));
  const stateRef = useRef(state);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [levelUp, setLevelUp] = useState<LevelUpInfo | null>(null);
  const [death, setDeath] = useState<DeathInfo | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  // Автосохранение после каждого изменения состояния.
  useEffect(() => {
    setSaveFailed(!saveState(state));
  }, [state]);

  const spawnFloater = useCallback((origin: Origin, xp: number, gold: number, hp: number, crit: boolean) => {
    const floater: Floater = { id: uid(), x: origin.x, y: origin.y, xp, gold, hp, crit };
    setFloaters((list) => [...list, floater]);
    window.setTimeout(() => {
      setFloaters((list) => list.filter((f) => f.id !== floater.id));
    }, FLOATER_LIFETIME);
  }, []);

  /**
   * Применяет действие движка. Текущее состояние берётся из ref, а не из замыкания,
   * поэтому быстрые повторные клики не теряют изменений.
   */
  const commit = useCallback(
    (action: (current: GameState) => EngineResult, origin?: Origin) => {
      const current = stateRef.current;
      const { state: next, events } = action(current);
      if (next === current && events.length === 0) return;
      stateRef.current = next;
      setState(next);

      let xp = 0;
      let gold = 0;
      let hp = 0;
      let crit = false;
      let hasFloat = false;
      for (const event of events) {
        if (event.type === 'float') {
          xp += event.xp;
          gold += event.gold;
          hp += event.hp;
          crit = crit || event.crit;
          hasFloat = true;
        } else if (event.type === 'levelUp') {
          setLevelUp({ level: event.level, bonusGold: event.bonusGold });
        } else if (event.type === 'death') {
          setDeath({ lostLevel: event.lostLevel, lostGold: event.lostGold });
        }
      }
      if (hasFloat && (xp !== 0 || gold !== 0 || hp !== 0)) {
        spawnFloater(origin ?? defaultOrigin(), xp, gold, hp, crit);
      }
    },
    [spawnFloater],
  );

  const ctx = useCallback(
    (current: GameState): engine.ActionContext => ({ today: gameToday(current.dayOffset), rng: Math.random }),
    [],
  );

  // Смена суток: при запуске, раз в 30 секунд и при возвращении на вкладку.
  useEffect(() => {
    const check = () => commit((s) => engine.processNewDay(s, gameToday(s.dayOffset)));
    check();
    const timer = window.setInterval(check, DAY_CHECK_INTERVAL);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [commit]);

  // Синхронизация между вкладками: если игра открыта дважды, изменения подтягиваются из соседней вкладки.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const incoming = normalizeState(JSON.parse(event.newValue), realToday());
        if (incoming) {
          stateRef.current = incoming;
          setState(incoming);
        }
      } catch {
        // Соседняя вкладка записала что-то нечитаемое — игнорируем.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const actions = useMemo(
    () => ({
      habitPlus: (id: string, origin?: Origin) => commit((s) => engine.habitPlus(s, id, ctx(s)), origin),
      habitMinus: (id: string, origin?: Origin) => commit((s) => engine.habitMinus(s, id), origin),
      toggleDaily: (id: string, origin?: Origin) => commit((s) => engine.toggleDaily(s, id, ctx(s)), origin),
      toggleTodo: (id: string, origin?: Origin) => commit((s) => engine.toggleTodo(s, id, ctx(s)), origin),

      createHabit: (draft: HabitDraft) => commit((s) => engine.createHabit(s, draft, ctx(s))),
      updateHabit: (id: string, draft: HabitDraft) => commit((s) => engine.updateHabit(s, id, draft)),
      createDaily: (draft: DailyDraft) => commit((s) => engine.createDaily(s, draft, ctx(s))),
      updateDaily: (id: string, draft: DailyDraft) => commit((s) => engine.updateDaily(s, id, draft)),
      createTodo: (draft: TodoDraft) => commit((s) => engine.createTodo(s, draft)),
      updateTodo: (id: string, draft: TodoDraft) => commit((s) => engine.updateTodo(s, id, draft)),
      deleteTask: (type: TaskType, id: string) => commit((s) => engine.deleteTask(s, type, id)),
      moveTask: (type: TaskType, id: string, direction: -1 | 1) => commit((s) => engine.moveTask(s, type, id, direction)),
      clearCompletedTodos: () => commit((s) => engine.clearCompletedTodos(s)),

      buyReward: (id: string, origin?: Origin) => commit((s) => engine.buyReward(s, id), origin),
      createReward: (draft: RewardDraft) => commit((s) => engine.createReward(s, draft)),
      updateReward: (id: string, draft: RewardDraft) => commit((s) => engine.updateReward(s, id, draft)),
      deleteReward: (id: string) => commit((s) => engine.deleteReward(s, id)),

      updateProfile: (name: string, avatar: AvatarId) => commit((s) => engine.updateProfile(s, name, avatar)),
      clearLog: () => commit((s) => engine.clearLog(s)),
      simulateNextDay: () => commit((s) => engine.simulateNextDay(s, realToday())),
      resetGame: () => commit(() => ({ state: createInitialState(realToday()), events: [] })),
      importState: (imported: GameState) =>
        commit(() => {
          const entry = {
            id: uid(),
            ts: Date.now(),
            kind: 'system' as const,
            text: `Сохранение героя «${imported.hero.name}» импортировано.`,
          };
          return { state: { ...imported, log: [entry, ...imported.log] }, events: [] };
        }),
    }),
    [commit, ctx],
  );

  const derived = useMemo(() => {
    const today = gameToday(state.dayOffset);
    return {
      today,
      maxHp: maxHp(state.hero),
      xpNeeded: xpToNextLevel(state.hero.level),
    };
  }, [state.dayOffset, state.hero, state.lastProcessedDate]);

  return {
    state,
    derived,
    actions,
    floaters,
    levelUp,
    dismissLevelUp: () => setLevelUp(null),
    death,
    dismissDeath: () => setDeath(null),
    saveFailed,
  };
}

export type GameApi = ReturnType<typeof useGame>;
export type GameActions = GameApi['actions'];
