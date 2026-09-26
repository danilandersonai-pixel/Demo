import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { computeEconomy, projectTick } from '../game/economy.ts';
import { gameReducer } from '../game/engine.ts';
import { freshSeed } from '../game/rng.ts';
import { SAVE_KEY, loadGame, readSaveOwner, saveGame } from '../game/storage.ts';
import type { GameState } from '../game/types.ts';

/** Не чаще одного сохранения в секунду — и на скорости 4× тоже. */
const SAVE_INTERVAL = 1000;

/**
 * Состояние игры + автосохранение в localStorage.
 * Сохранение «троттлится»: сразу, если с прошлого прошло больше секунды, иначе один отложенный
 * вызов, который следующие тики не отменяют. Плюс сброс при скрытии и закрытии вкладки.
 * Если сейв перехватила другая вкладка, эта перестаёт писать и предлагает забрать управление.
 */
export function useGame() {
  const [boot] = useState(() => loadGame(Date.now(), freshSeed()));
  const [state, dispatch] = useReducer(gameReducer, boot.state);
  const [stale, setStale] = useState(false);
  const tabId = useState(() => `tab-${freshSeed().toString(36)}`)[0];
  const latest = useRef<GameState>(state);
  const staleRef = useRef(false);
  const lastSave = useRef(0);
  const pending = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (staleRef.current) return;
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
      pending.current = null;
    }
    lastSave.current = Date.now();
    saveGame(latest.current, tabId);
  }, [tabId]);

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
      if (event.key !== SAVE_KEY || event.newValue === null) return;
      const owner = readSaveOwner(event.newValue);
      if (owner && owner !== tabId) {
        staleRef.current = true;
        setStale(true);
        if (pending.current !== null) {
          window.clearTimeout(pending.current);
          pending.current = null;
        }
      }
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
      if (pending.current !== null) window.clearTimeout(pending.current);
    };
  }, [flush, tabId]);

  /** Забрать управление: загрузить свежий сейв другой вкладки и снова стать владельцем. */
  const takeOver = useCallback(() => {
    const fresh = loadGame(Date.now(), freshSeed()).state;
    staleRef.current = false;
    setStale(false);
    latest.current = fresh;
    dispatch({ type: 'HYDRATE', state: fresh });
    flush();
  }, [flush]);

  const econ = useMemo(() => computeEconomy(state), [state]);
  const projection = useMemo(() => projectTick(state), [state]);

  return { state, dispatch, econ, projection, restored: boot.restored, stale, takeOver };
}
