import '@fontsource/exo-2/500.css';
import '@fontsource/exo-2/600.css';
import '@fontsource/exo-2/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './ui/styles.css';
import { Application } from 'pixi.js';
import { render, h } from 'preact';
import { Game } from './game';
import { Sim } from './sim/sim';
import { App } from './ui/App';
import { installDebugApi } from './debug';

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#03263a',
    antialias: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
    preference: 'webgl',
    powerPreference: 'high-performance',
  });
  document.getElementById('game')!.appendChild(app.canvas);
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed')) || 20260926;
  const game = new Game(app);
  game.start(Sim.newGame({ seed }));
  if (params.has('autostart')) game.ui.mainMenu = false;
  render(h(App, { game }), document.getElementById('ui')!);
  installDebugApi(game);
}

void boot();
