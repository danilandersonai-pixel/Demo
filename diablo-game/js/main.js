// Bootstrap: wire renderer/ui/game, input, buttons, and the rAF loop.

import { Renderer } from './render.js';
import { UI } from './ui.js';
import { Game } from './game.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const ui = new UI();
const game = new Game(renderer, ui);

// --- input: tap / hold-to-move ------------------------------------------------
let pressing = false;
let lastMove = 0;

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  pressing = true;
  game.handleTap(e.clientX, e.clientY);
}, { passive: false });

canvas.addEventListener('pointermove', (e) => {
  if (!pressing) return;
  const now = performance.now();
  if (now - lastMove < 80) return; // throttle re-pathing while dragging
  lastMove = now;
  game.handleTap(e.clientX, e.clientY);
}, { passive: false });

const stopPress = () => { pressing = false; };
canvas.addEventListener('pointerup', stopPress);
canvas.addEventListener('pointercancel', stopPress);
canvas.addEventListener('pointerleave', stopPress);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// --- buttons ------------------------------------------------------------------
function bindAction(id, fn) {
  const el = document.getElementById(id);
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('press');
    fn();
  }, { passive: false });
  const up = () => el.classList.remove('press');
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
}
bindAction('btnPotion', () => game.drinkPotion());
bindAction('btnSpell', () => game.castSpell());

function start() {
  document.getElementById('start').classList.remove('show');
  document.getElementById('death').classList.remove('show');
  game.newGame((Math.floor(Math.random() * 1e9) >>> 0) || 1);
}
document.getElementById('startBtn').addEventListener('click', start);
document.getElementById('deathBtn').addEventListener('click', start);

// --- loop ---------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  try {
    game.update(dt);
    game.render();
  } catch (err) {
    console.error(err); // never let one bad frame kill the loop
  }
  requestAnimationFrame(frame);
}
document.getElementById('start').classList.add('show');
requestAnimationFrame(frame);

// Debug / verification hook.
window.__diablo = { game, renderer, ui };
