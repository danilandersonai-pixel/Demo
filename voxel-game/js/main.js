// Entry point: world streaming, render loop, input, HUD. Zero dependencies.

import { create, perspective, lookAt, multiply, vec3 } from './glmatrix.js';
import { B, HOTBAR, BLOCKS, CHUNK_SY } from './blocks.js';
import { World } from './world.js';
import { meshChunk } from './mesher.js';
import { Renderer } from './renderer.js';
import { Player } from './player.js';

const FOV = (70 * Math.PI) / 180;
const SENS = 0.0022;
const GEN_BUDGET = 4;     // chunks generated per frame
const MESH_BUDGET = 4;    // chunks meshed per frame
let RENDER_DISTANCE = 7;  // chunks (radius)

const SWATCH = {
  [B.GRASS]: '#6a9c46', [B.DIRT]: '#86603e', [B.STONE]: '#808084',
  [B.COBBLE]: '#6f6f73', [B.PLANKS]: '#b28a56', [B.LOG]: '#785436',
  [B.LEAVES]: '#367830', [B.SAND]: '#dcce98', [B.GLASS]: '#b0dce6',
};

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const hotbarEl = document.getElementById('hotbar');
const startError = document.getElementById('error');

let renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  startError.textContent = 'Не удалось запустить WebGL: ' + e.message;
  startError.style.display = 'block';
  throw e;
}

const seed = (Math.floor(Math.random() * 1e9) >>> 0) || 1337;
const world = new World(seed);

// Spawn at the surface above origin.
const spawnY = world.surfaceY(0, 0) + 1;
const player = new Player(world, 0.5, spawnY + 1, 0.5);

let selected = 0; // hotbar index
let locked = false;

// --- HUD: hotbar ---------------------------------------------------------------
const slotEls = [];
HOTBAR.forEach((id, i) => {
  const el = document.createElement('div');
  el.className = 'slot';
  el.style.setProperty('--swatch', SWATCH[id] || '#888');
  el.innerHTML = `<span class="num">${i + 1}</span><span class="sw"></span>`;
  el.title = BLOCKS[id].name;
  hotbarEl.appendChild(el);
  slotEls.push(el);
});
function refreshHotbar() {
  slotEls.forEach((el, i) => el.classList.toggle('active', i === selected));
}
refreshHotbar();

// --- matrices ------------------------------------------------------------------
const proj = create();
const view = create();
const viewProj = create();

// --- chunk streaming -----------------------------------------------------------
const NEIGHBOR_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
function neighborsReady(c) {
  // All 8 neighbours (incl. diagonals) so chunk-corner ambient occlusion is
  // computed once with full context and never leaves a seam.
  for (const [dx, dz] of NEIGHBOR_OFFSETS) {
    const n = world.getChunk(c.cx + dx, c.cz + dz);
    if (!n || !n.generated) return false;
  }
  return true;
}

function updateChunks() {
  const pcx = Math.floor(player.pos[0] / 16);
  const pcz = Math.floor(player.pos[2] / 16);

  // Unload distant chunks.
  for (const [key, c] of world.chunks) {
    if (Math.abs(c.cx - pcx) > RENDER_DISTANCE + 2 || Math.abs(c.cz - pcz) > RENDER_DISTANCE + 2) {
      renderer.freeChunk(c);
      world.chunks.delete(key);
    }
  }

  // Generate nearest missing chunks (one extra ring so edges have neighbours).
  let gen = GEN_BUDGET;
  const genR = RENDER_DISTANCE + 1;
  for (let r = 0; r <= genR && gen > 0; r++) {
    for (let dz = -r; dz <= r && gen > 0; dz++) {
      for (let dx = -r; dx <= r && gen > 0; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const c = world.getChunk(pcx + dx, pcz + dz);
        if (!c || !c.generated) { world.generate(pcx + dx, pcz + dz); gen--; }
      }
    }
  }

  // Mesh dirty chunks (nearest first) whose neighbours exist.
  const dirty = [];
  for (const c of world.chunks.values()) {
    if (!c.generated || !c.dirty) continue;
    if (Math.abs(c.cx - pcx) > RENDER_DISTANCE || Math.abs(c.cz - pcz) > RENDER_DISTANCE) continue;
    if (!neighborsReady(c)) continue;
    dirty.push(c);
  }
  dirty.sort((a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz));
  let mesh = MESH_BUDGET;
  for (const c of dirty) {
    if (mesh <= 0) break;
    renderer.uploadChunk(c, meshChunk(world, c));
    c.dirty = false;
    mesh--;
  }
}

function dist2(c, pcx, pcz) {
  const dx = c.cx - pcx, dz = c.cz - pcz;
  return dx * dx + dz * dz;
}

function renderList(pcx, pcz) {
  const list = [];
  for (const c of world.chunks.values()) {
    if (Math.abs(c.cx - pcx) > RENDER_DISTANCE || Math.abs(c.cz - pcz) > RENDER_DISTANCE) continue;
    if (c.glOpaque || c.glWater) list.push(c);
  }
  return list;
}

// --- input ---------------------------------------------------------------------
const MOVE_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

window.addEventListener('keydown', (e) => {
  if (!locked) return; // ignore gameplay keys while paused (pointer not locked)
  if (e.code >= 'Digit1' && e.code <= 'Digit9') {
    const i = +e.code.slice(5) - 1;
    if (i < HOTBAR.length) { selected = i; refreshHotbar(); }
    return;
  }
  if (e.code === 'KeyF') { player.toggleFly(); return; }
  if (e.code === 'BracketRight') { RENDER_DISTANCE = Math.min(12, RENDER_DISTANCE + 1); return; }
  if (e.code === 'BracketLeft') { RENDER_DISTANCE = Math.max(3, RENDER_DISTANCE - 1); return; }
  if (MOVE_CODES.has(e.code)) {
    player.keys[e.code] = true;
    if (locked) e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  if (MOVE_CODES.has(e.code)) player.keys[e.code] = false;
});

canvas.addEventListener('click', () => {
  if (!locked) canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  overlay.classList.toggle('hidden', locked);
  if (!locked) player.keys = Object.create(null);
});

document.addEventListener('mousemove', (e) => {
  if (locked) player.addLook(e.movementX || 0, e.movementY || 0, SENS);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
  if (!locked) return;
  const rc = player.raycast();
  if (!rc) return;
  if (e.button === 0) {
    const [x, y, z] = rc.hit;
    if (world.getBlock(x, y, z) !== B.BEDROCK) world.setBlock(x, y, z, B.AIR);
  } else if (e.button === 2) {
    const [x, y, z] = rc.place;
    if (y < 0 || y >= CHUNK_SY) return;
    const cur = world.getBlock(x, y, z);
    if ((cur === B.AIR || cur === B.WATER) && !player.intersectsBlock(x, y, z)) {
      world.setBlock(x, y, z, HOTBAR[selected]);
    }
  }
});

window.addEventListener('wheel', (e) => {
  if (!locked) return;
  selected = (selected + (e.deltaY > 0 ? 1 : -1) + HOTBAR.length) % HOTBAR.length;
  refreshHotbar();
});

// --- main loop -----------------------------------------------------------------
let last = performance.now();
let fps = 0, fpsT = 0, fpsC = 0, hudT = 0;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;

  const aspect = renderer.resize();
  player.update(dt);
  updateChunks();

  const eye = player.eyePos();
  const center = vec3.add(eye, player.forward());
  lookAt(view, eye, center, [0, 1, 0]);
  const fogFar = (RENDER_DISTANCE - 0.5) * 16;
  const fogNear = fogFar * 0.55;
  perspective(proj, FOV, aspect, 0.1, fogFar + 32);
  multiply(viewProj, proj, view);

  const pcx = Math.floor(player.pos[0] / 16);
  const pcz = Math.floor(player.pos[2] / 16);

  renderer.beginFrame();
  renderer.renderChunks(renderList(pcx, pcz), viewProj, eye, fogNear, fogFar);
  const rc = player.raycast();
  if (rc) renderer.drawSelection(viewProj, rc.hit);

  // HUD (throttled).
  fpsC++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(fpsC / fpsT); fpsC = 0; fpsT = 0; }
  hudT += dt;
  if (hudT >= 0.12) {
    hudT = 0;
    const [x, y, z] = player.pos;
    hud.textContent =
      `XYZ ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}  |  ${fps} FPS  |  ` +
      `${BLOCKS[HOTBAR[selected]].name}  |  ${player.fly ? 'FLY' : 'WALK'}  |  RD ${RENDER_DISTANCE}`;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Expose a little state for automated checks / debugging.
window.__voxel = { world, player, renderer, seed, get locked() { return locked; } };
