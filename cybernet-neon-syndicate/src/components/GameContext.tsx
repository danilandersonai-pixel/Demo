import { createContext, useContext, type Dispatch } from 'react';
import type { Economy, TickProjection } from '../game/economy.ts';
import type { Action, GameState } from '../game/types.ts';

export interface GameContextValue {
  state: GameState;
  dispatch: Dispatch<Action>;
  econ: Economy;
  projection: TickProjection;
  running: boolean;
}

export const GameContext = createContext<GameContextValue | null>(null);

export function useGameContext(): GameContextValue {
  const value = useContext(GameContext);
  if (!value) throw new Error('useGameContext вызывается вне GameContext.Provider');
  return value;
}
