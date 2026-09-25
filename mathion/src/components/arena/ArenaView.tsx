import type { GameState, TabId } from '../../types';
import type { Derived, GameActions, GameFx } from '../../hooks/useGame';
import { ArenaLobby } from './ArenaLobby';
import { BattleView } from './BattleView';
import { BlitzView } from './BlitzView';

interface ArenaViewProps {
  state: GameState;
  derived: Derived;
  actions: GameActions;
  fx: GameFx;
  paused: boolean;
  onNavigate: (tab: TabId) => void;
}

/** Арена показывает одно из трёх: бой, блиц или лагерь перед боем. */
export function ArenaView({ state, derived, actions, fx, paused, onNavigate }: ArenaViewProps) {
  if (state.blitz) {
    return <BlitzView state={state} blitz={state.blitz} actions={actions} fx={fx} paused={paused} />;
  }
  if (state.battle) {
    return <BattleView state={state} battle={state.battle} derived={derived} actions={actions} fx={fx} paused={paused} onNavigate={onNavigate} />;
  }
  return <ArenaLobby state={state} derived={derived} actions={actions} fx={fx} onNavigate={onNavigate} />;
}
