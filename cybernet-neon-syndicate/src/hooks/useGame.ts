import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { computeEconomy, projectTick } from '../game/economy.ts';
import { gameReducer } from '../game/engine.ts';
import { freshSeed } from '../game/rng.ts';
import { loadGame, saveGame } from '../game/storage.ts';
import type { GameState } from '../game/types.ts';

/**
 * Состояние игры + автосохранение в localStorage.
 * Сохраняем с небольшой задержкой после каждого изменения и принудительно — при закрытии вкладки.
 */
export function useGame() {
  const [boot] = useState(() => loadGame(Date.now(), freshSeed()));
  const [state, dispatch] = useReducer(gameReducer, boot.state);
  const latest = useRef<GameState>(state);

  useEffect(() => {
    latest.current = state;
    const id = window.setTimeout(() => saveGame(state), 250);
    return () => window.clearTimeout(id);
  }, [state]);

  useEffect(() => {
    const flush = () => saveGame(latest.current);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  const econ = useMemo(() => computeEconomy(state), [state]);
  const projection = useMemo(() => projectTick(state), [state]);

  return { state, dispatch, econ, projection, restored: boot.restored };
}
