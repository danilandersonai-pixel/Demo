import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { computeEconomy, projectTick } from '../game/economy.ts';
import { gameReducer } from '../game/engine.ts';
import { freshSeed } from '../game/rng.ts';
import { OWNER_KEY, isNewerClaim, loadGame, parseClaim, readClaim, saveGame, writeClaim, type OwnerClaim } from '../game/storage.ts';
import type { GameState } from '../game/types.ts';

/** Не чаще одного сохранения в секунду — и на скорости 4× тоже. */
const SAVE_INTERVAL = 1000;

/**
 * Состояние игры + автосохранение в localStorage.
 *
 * Сохранение «троттлится»: сразу, если с прошлого прошло больше секунды, иначе один отложенный
 * вызов, который следующие тики не отменяют. Плюс сброс при скрытии и закрытии вкладки.
 *
 * Несколько вкладок: при открытии вкладка пишет заявку на владение (id + время). Перед каждым
 * сохранением заявка сверяется: если появилась более новая, эта вкладка замирает и больше
 * ничего не пишет, а игроку предлагается «Продолжить здесь».
 */
export function useGame() {
  const [boot] = useState(() => loadGame(Date.now(), freshSeed()));
  const [state, dispatch] = useReducer(gameReducer, boot.state);
  const [stale, setStale] = useState(false);
  const [tabId] = useState(() => `tab-${freshSeed().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const claim = useRef<OwnerClaim>({ tab: tabId, at: 0 });
  const latest = useRef<GameState>(state);
  const staleRef = useRef(false);
  const lastSave = useRef(0);
  const pending = useRef<number | null>(null);

  const cancelPending = useCallback(() => {
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
      pending.current = null;
    }
  }, []);

  const goStale = useCallback(() => {
    staleRef.current = true;
    setStale(true);
    cancelPending();
  }, [cancelPending]);

  /** Заявить права на сейв: вызывается при открытии вкладки и при «Продолжить здесь». */
  const claimOwnership = useCallback(() => {
    claim.current = { tab: tabId, at: Date.now() };
    writeClaim(claim.current);
  }, [tabId]);

  // Заявка пишется в layout-эффекте — раньше, чем любой эффект сохранения.
  useLayoutEffect(() => {
    claimOwnership();
  }, [claimOwnership]);

  const flush = useCallback(() => {
    if (staleRef.current) return;
    cancelPending();
    const owner = readClaim();
    if (owner && owner.tab !== tabId && isNewerClaim(owner, claim.current)) {
      goStale();
      return;
    }
    lastSave.current = Date.now();
    saveGame(latest.current, tabId);
  }, [cancelPending, goStale, tabId]);

  useEffect(() => {
    latest.current = state;
    if (staleRef.current) return;
    const wait = SAVE_INTERVAL - (Date.now() - lastSave.current);
    if (wait <= 0) flush();
    else if (pending.current === null) pending.current = window.setTimeout(flush, wait);
  }, [state, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== OWNER_KEY) return;
      const owner = parseClaim(event.newValue);
      if (owner && owner.tab !== tabId && isNewerClaim(owner, claim.current)) goStale();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('storage', onStorage);
      cancelPending();
    };
  }, [flush, goStale, cancelPending, tabId]);

  /** Забрать управление: загрузить свежий сейв другой вкладки и снова стать владельцем. */
  const takeOver = useCallback(() => {
    claimOwnership();
    const fresh = loadGame(Date.now(), freshSeed()).state;
    staleRef.current = false;
    setStale(false);
    latest.current = fresh;
    dispatch({ type: 'HYDRATE', state: fresh });
    flush();
  }, [claimOwnership, flush]);

  const econ = useMemo(() => computeEconomy(state), [state]);
  const projection = useMemo(() => projectTick(state), [state]);

  return { state, dispatch, econ, projection, restored: boot.restored, stale, takeOver };
}
