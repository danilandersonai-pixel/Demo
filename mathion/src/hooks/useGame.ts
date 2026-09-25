import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlitzElement, Element, EngineResult, GameState, HuntTier, PotionId, SpellId, UpgradeId } from '../types';
import * as engine from '../game/engine';
import { STORAGE_KEY, critChance, critMultiplier, lensesBonus, maxHp, maxMana, shieldBlock, xpToNext } from '../game/constants';
import { createInitialState } from '../game/seed';
import { loadState, normalizeState, saveState } from '../game/storage';
import { uid } from '../game/utils';

export type FloaterTarget = 'enemy' | 'player' | 'blitz';
export type FloaterTone = 'damage' | 'crit' | 'hurt' | 'heal' | 'mana' | 'shield' | 'points' | 'time';

export interface Floater {
  id: string;
  target: FloaterTarget;
  text: string;
  tone: FloaterTone;
  /** Горизонтальный разброс, чтобы цифры не накладывались. */
  offset: number;
}

export interface Projectile {
  id: string;
  element: Element;
}

export interface PotionFx {
  id: string;
  potion: PotionId;
}

export interface Banner {
  id: string;
  text: string;
}

const TICK_MS = 100;
const FLOATER_LIFETIME = 1400;
const SAVE_INTERVAL = 1000;

function hasClock(state: GameState): boolean {
  return (state.battle !== null && state.battle.status === 'active') || (state.blitz !== null && state.blitz.status === 'active');
}

/**
 * Центральный хук игры: хранит состояние, гоняет игровые часы, сохраняет прогресс
 * и превращает события движка в визуальные эффекты.
 * @param onArena — открыта ли вкладка арены (часы идут только там).
 */
export function useGame(onArena: boolean) {
  const [state, setState] = useState<GameState>(loadState);
  const stateRef = useRef(state);
  // Если при загрузке бой или блиц был в процессе — начинаем на паузе, чтобы игрок успел сориентироваться.
  const [paused, setPaused] = useState(() => hasClock(stateRef.current));
  const [docVisible, setDocVisible] = useState(() => document.visibilityState !== 'hidden');
  const [saveFailed, setSaveFailed] = useState(false);

  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [potionFx, setPotionFx] = useState<PotionFx | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [playerShake, setPlayerShake] = useState(0);
  const [enemyShake, setEnemyShake] = useState(0);

  // ---- Сохранение: не чаще раза в SAVE_INTERVAL мс (в бою состояние меняется 10 раз в секунду,
  // поэтому debounce не подходит — он бы откладывал запись до конца боя), и сразу при уходе со страницы.
  const lastSaveRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const write = () => {
      saveTimerRef.current = null;
      lastSaveRef.current = Date.now();
      setSaveFailed(!saveState(stateRef.current));
    };
    const wait = SAVE_INTERVAL - (Date.now() - lastSaveRef.current);
    if (wait <= 0) {
      write();
    } else if (saveTimerRef.current === null) {
      saveTimerRef.current = window.setTimeout(write, wait);
    }
  }, [state]);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveState(stateRef.current);
    },
    [],
  );

  useEffect(() => {
    const flush = () => saveState(stateRef.current);
    const onVisibility = () => {
      const visible = document.visibilityState !== 'hidden';
      setDocVisible(visible);
      if (!visible) flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // ---- Синхронизация между вкладками браузера.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const incoming = normalizeState(JSON.parse(event.newValue));
        if (incoming) {
          stateRef.current = incoming;
          setState(incoming);
          setPaused(hasClock(incoming));
        }
      } catch {
        // Некорректные данные из соседней вкладки игнорируем.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ---- Эффекты
  const pushFloater = useCallback((target: FloaterTarget, text: string, tone: FloaterTone) => {
    const floater: Floater = { id: uid(), target, text, tone, offset: Math.round((Math.random() - 0.5) * 70) };
    setFloaters((list) => [...list.slice(-14), floater]);
    window.setTimeout(() => setFloaters((list) => list.filter((f) => f.id !== floater.id)), FLOATER_LIFETIME);
  }, []);

  const handleEvents = useCallback(
    (result: EngineResult) => {
      for (const event of result.events) {
        switch (event.type) {
          case 'enemyHit':
            if (event.amount > 0) pushFloater('enemy', event.crit ? `КРИТ −${event.amount}` : `−${event.amount}`, event.crit ? 'crit' : 'damage');
            if (event.shield > 0) pushFloater('enemy', `щит −${event.shield}`, 'shield');
            setEnemyShake((n) => n + 1);
            break;
          case 'playerHit':
            pushFloater('player', `−${event.amount}`, 'hurt');
            setPlayerShake((n) => n + 1);
            break;
          case 'heal':
            pushFloater('player', `+${event.amount} HP`, 'heal');
            break;
          case 'mana':
            pushFloater('player', `+${event.amount} маны`, 'mana');
            break;
          case 'enemyHeal':
            pushFloater('enemy', `+${event.amount}`, 'heal');
            break;
          case 'enemyShield':
            pushFloater('enemy', `+${event.amount} щит`, 'shield');
            break;
          case 'cast': {
            const projectile = { id: uid(), element: event.element };
            setProjectiles((list) => [...list, projectile]);
            window.setTimeout(() => setProjectiles((list) => list.filter((p) => p.id !== projectile.id)), 700);
            break;
          }
          case 'potion': {
            const fx = { id: uid(), potion: event.id };
            setPotionFx(fx);
            window.setTimeout(() => setPotionFx((current) => (current?.id === fx.id ? null : current)), 1100);
            break;
          }
          case 'wrong':
            setPlayerShake((n) => n + 1);
            break;
          case 'levelUp': {
            const next = { id: uid(), text: `Уровень ${event.level}!` };
            setBanner(next);
            window.setTimeout(() => setBanner((current) => (current?.id === next.id ? null : current)), 2600);
            break;
          }
          case 'blitzPoints':
            pushFloater('blitz', `+${event.points}`, 'points');
            pushFloater('blitz', `+${event.bonusTime / 1000} с`, 'time');
            break;
          case 'victory':
          case 'defeat':
            break;
        }
      }
    },
    [pushFloater],
  );

  /** Применяет действие движка к актуальному состоянию из ref. */
  const commit = useCallback(
    (action: (current: GameState) => EngineResult) => {
      const current = stateRef.current;
      const result = action(current);
      if (result.state === current && result.events.length === 0) return;
      stateRef.current = result.state;
      setState(result.state);
      handleEvents(result);
    },
    [handleEvents],
  );

  // ---- Игровые часы
  const clockNeeded = hasClock(state);
  const running = onArena && !paused && docVisible && clockNeeded;

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      // Ограничиваем шаг: после «заморозки» вкладки не хотим мгновенно проиграть несколько ходов.
      const dt = Math.min(now - last, 500);
      last = now;
      commit((s) => engine.tick(s, dt, Math.random));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [running, commit]);

  // Уход с арены или сворачивание вкладки ставит бой на паузу — подглядывать в пример нельзя.
  useEffect(() => {
    if (clockNeeded && (!onArena || !docVisible)) setPaused(true);
  }, [onArena, docVisible, clockNeeded]);

  const actions = useMemo(
    () => ({
      startHunt: (tier: HuntTier) => {
        commit((s) => engine.startHunt(s, tier, Math.random));
        setPaused(false);
      },
      startFloor: (floor: number) => {
        commit((s) => engine.startFloor(s, floor, Math.random));
        setPaused(false);
      },
      submitAnswer: (input: string) => commit((s) => engine.submitAnswer(s, input, Math.random)),
      selectElement: (element: Element) => commit((s) => engine.selectElement(s, element, Math.random)),
      usePotion: (id: PotionId) => commit((s) => engine.usePotion(s, id, Math.random)),
      castSpell: (id: SpellId) => commit((s) => engine.castSpell(s, id, Math.random)),
      flee: () => commit((s) => engine.fleeBattle(s)),
      closeBattle: () => commit((s) => engine.closeBattle(s)),
      startBlitz: (element: BlitzElement) => {
        commit((s) => engine.startBlitz(s, element, Math.random));
        setPaused(false);
      },
      submitBlitz: (input: string) => commit((s) => engine.submitBlitz(s, input, Math.random)),
      endBlitz: () => commit((s) => engine.endBlitz(s)),
      closeBlitz: () => commit((s) => engine.closeBlitz(s)),
      buyUpgrade: (id: UpgradeId) => commit((s) => engine.buyUpgrade(s, id)),
      craftPotion: (id: PotionId) => commit((s) => engine.craftPotion(s, id)),
      meditate: () => commit((s) => engine.meditate(s)),
      clearLog: () => commit((s) => engine.clearLog(s)),
      resetGame: () => {
        commit(() => ({ state: createInitialState(), events: [] }));
        setPaused(false);
      },
      pause: () => setPaused(true),
      resume: () => setPaused(false),
    }),
    [commit],
  );

  const derived = useMemo(
    () => ({
      maxHp: maxHp(state),
      maxMana: maxMana(state),
      xpNeeded: xpToNext(state.player.level),
      critChance: critChance(state.battle?.combo ?? 0),
      critMultiplier: critMultiplier(state.upgrades.stone),
      shieldBlock: shieldBlock(state.upgrades.shield),
      lensesBonus: lensesBonus(state.upgrades.lenses),
    }),
    [state],
  );

  return {
    state,
    derived,
    actions,
    paused: paused && clockNeeded,
    saveFailed,
    fx: { floaters, projectiles, potionFx, banner, playerShake, enemyShake },
  };
}

export type GameApi = ReturnType<typeof useGame>;
export type GameActions = GameApi['actions'];
export type GameFx = GameApi['fx'];
export type Derived = GameApi['derived'];
