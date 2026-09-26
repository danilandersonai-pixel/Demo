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
import { Sim, DAY_LENGTH } from './sim/sim';
import { buildDemo } from './demo';
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
  if (params.has('autostart')) {
    game.start(Sim.newGame({ seed }));
    game.ui.mainMenu = false;
  } else {
    // main-menu backdrop: the demo colony at golden hour, alive but silent
    const bg = buildDemo();
    bg.events.muted = true;
    bg.dayTime = 0.64 * DAY_LENGTH;
    game.start(bg);
    const { x, y } = bg.world.base;
    game.renderer.flyTo(x + 2, y + 2, 0.95);
    game.renderer.cam.x = game.renderer.cam.tx;
    game.renderer.cam.y = game.renderer.cam.ty;
    game.renderer.cam.zoom = game.renderer.cam.tzoom = 0.95;
  }
  render(h(App, { game }), document.getElementById('ui')!);
  installDebugApi(game);
}

void boot();
