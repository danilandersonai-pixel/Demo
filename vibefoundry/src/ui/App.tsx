import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../game';

export function useGame(game: Game): number {
  const [, setV] = useState(0);
  useEffect(() => game.subscribe(() => setV((v) => v + 1)), [game]);
  return game.version;
}

export function App({ game }: { game: Game }) {
  useGame(game);
  if (game.ui.mainMenu) {
    return (
      <div class="hud-root" style={{ display: 'grid', placeItems: 'center' }}>
        <div class="panel glow" style={{ padding: 32, width: 420 }}>
          <div class="h1" style={{ fontSize: 40 }}>VibeFoundry</div>
          <div class="label" style={{ marginTop: 6 }}>Build · Automate · Vibe Code · Repeat</div>
          <div style={{ marginTop: 24 }}>
            <button class="btn primary" onClick={() => { game.ui.mainMenu = false; game.emit(); }}>Новая игра</button>
          </div>
        </div>
      </div>
    );
  }
  return <div class="hud-root" />;
}
