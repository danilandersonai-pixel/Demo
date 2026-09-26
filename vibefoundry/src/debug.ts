import type { Game } from './game';

/** Debug API for automated playtests (window.__vf). Not used by gameplay. */
export function installDebugApi(game: Game): void {
  (window as any).__vf = {
    game,
    get sim() {
      return game.sim;
    },
    ready: true,
  };
}
