import type { Application } from 'pixi.js';
import { BUILDINGS, BELTLIKE, type BuildingType } from './data/buildings';
import { Sim, DT, SAVE_VERSION, type NewGameOptions, type SimSnapshot } from './sim/sim';
import { saveSlot, loadSlot, listSlots, exportFile, importFile, type SlotId } from './ui/saves';
import type { Entity, Toast } from './sim/types';
import { WorldRenderer } from './render/renderer';
import { rotCW, type Dir } from './core/iso';
import { audio } from './ui/audio';
import { sendToPoi, DRONE_NAMES } from './sim/drones';

export type Tool =
  | { kind: 'none' }
  | { kind: 'build'; type: BuildingType; dir: Dir; recipe?: string }
  | { kind: 'decon' }
  | { kind: 'group' }
  | { kind: 'copy' }
  | { kind: 'paste'; bp: Blueprint };

export interface Blueprint {
  name: string;
  w: number;
  h: number;
  entities: { type: BuildingType; dx: number; dy: number; dir: Dir; recipe?: string }[];
}

export type Panel = 'build' | 'research' | 'stats' | 'agents' | 'vibe' | 'codex' | 'map' | 'drones' | 'settings' | 'menu' | 'git' | null;

export interface UiToast extends Toast {
  id: number;
  at: number;
}

export interface UiState {
  panel: Panel;
  buildCategory: string;
  toasts: UiToast[];
  selectedId: number | null;
  hover: { x: number; y: number } | null;
  showPerf: boolean;
  mainMenu: boolean;
  pendingGroup: number[] | null;
  groupRect: { x0: number; y0: number; x1: number; y1: number } | null;
  cutscene: { era: number } | null;
  victory: boolean;
  focusTile: { x: number; y: number } | null;
  codexTab: string;
  vibeTarget: number | null;
  mapLayers: Record<string, boolean>;
  tutorialHighlight: string | null;
}

type Listener = () => void;

export class Game {
  app: Application;
  renderer: WorldRenderer;
  sim!: Sim;
  speed = 1;
  paused = false;
  tool: Tool = { kind: 'none' };
  ui: UiState = {
    panel: null, buildCategory: 'logistics', toasts: [], selectedId: null, hover: null, showPerf: false, mainMenu: true,
    pendingGroup: null, groupRect: null, cutscene: null, victory: false, focusTile: null, codexTab: 'buildings', vibeTarget: null,
    mapLayers: { forest: true, mountains: true, desert: true, tundra: true, swamp: true, water: true, plains: true, danger: true },
    tutorialHighlight: null,
  };
  blueprints: Blueprint[] = [];
  settings = loadSettings();
  demoAvailable = false;
  startDemo: () => void = () => {};
  renderLlmSettings?: () => any;
  private autosaveT = 0;
  private listeners = new Set<Listener>();
  private acc = 0;
  private uiTimer = 0;
  private toastId = 1;
  private recentToasts = new Map<string, number>();
  private keys = new Set<string>();
  private drag: { button: number; sx: number; sy: number; tx: number; ty: number; moved: boolean; lastX: number; lastY: number } | null = null;
  perf = { fps: 60, ups: 60, tickMs: 0, frameMs: 0, steps: 0, lastFpsT: 0, frames: 0, upsCount: 0 };
  version = 0;
  unsubs: (() => void)[] = [];

  constructor(app: Application) {
    this.app = app;
    this.renderer = new WorldRenderer(app);
  }

  // ------------------------------------------------------------ lifecycle
  start(sim: Sim): void {
    this.attach(sim);
    this.renderer.init(sim);
    this.bindInput();
    this.app.ticker.add((t) => this.frame(t.deltaMS / 1000));
  }

  attach(sim: Sim): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.sim = sim;
    this.unsubs.push(sim.events.on('toast', (t) => this.pushToast(t)));
    this.unsubs.push(sim.events.on('sound', (s) => audio.play(s.name)));
    this.unsubs.push(sim.events.on('era', (e) => {
      this.ui.cutscene = { era: e.era };
      audio.play('era');
      this.emit();
    }));
    this.unsubs.push(sim.events.on('victory', () => {
      this.ui.victory = true;
      this.emit();
    }));
    this.tool = { kind: 'none' };
    this.ui.selectedId = null;
    this.ui.toasts = [];
    this.acc = 0;
  }

  newGame(opts: NewGameOptions): void {
    const sim = Sim.newGame(opts);
    this.load(sim);
  }

  load(sim: Sim): void {
    this.attach(sim);
    this.renderer.attach(sim);
    this.ui.mainMenu = false;
    this.ui.panel = null;
    this.ui.victory = false;
    this.ui.cutscene = null;
    this.emit();
  }

  loadSnapshot(s: SimSnapshot): void {
    this.load(Sim.deserialize(s));
  }

  // ---------------------------------------------------------------- store
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  pushToast(t: Toast): void {
    const now = performance.now();
    if (t.key) {
      const last = this.recentToasts.get(t.key);
      if (last && now - last < 20000) return;
      this.recentToasts.set(t.key, now);
    }
    this.ui.toasts = [{ ...t, id: this.toastId++, at: now }, ...this.ui.toasts].slice(0, 5);
    if (t.kind === 'danger') audio.play('alarm');
    else audio.play('notify');
    this.emit();
  }
  dismissToast(id: number): void {
    this.ui.toasts = this.ui.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  // ----------------------------------------------------------------- loop
  private frame(dtReal: number): void {
    const t0 = performance.now();
    dtReal = Math.min(dtReal, 0.1);
    // keyboard panning
    const panSpeed = 900 * dtReal;
    let px = 0;
    let py = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) py -= panSpeed;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) py += panSpeed;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) px -= panSpeed;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) px += panSpeed;
    if (px || py) this.renderer.pan(px, py);
    let steps = 0;
    const ts = performance.now();
    if (!this.paused && !this.ui.mainMenu && !this.ui.victory) {
      this.acc += dtReal * this.speed;
      const maxSteps = Math.max(8, this.speed * 3);
      while (this.acc >= DT && steps < maxSteps) {
        this.sim.step();
        this.acc -= DT;
        steps++;
      }
      if (steps >= maxSteps) this.acc = 0;
    }
    const tickMs = steps ? (performance.now() - ts) / steps : this.perf.tickMs;
    this.renderer.render(this.paused ? 0 : this.acc / DT, dtReal);
    // perf
    const p = this.perf;
    p.frames++;
    p.upsCount += steps;
    p.tickMs = p.tickMs * 0.9 + tickMs * 0.1;
    p.frameMs = p.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    if (t0 - p.lastFpsT > 1000) {
      p.fps = Math.round((p.frames * 1000) / (t0 - p.lastFpsT));
      p.ups = Math.round((p.upsCount * 1000) / (t0 - p.lastFpsT));
      p.frames = 0;
      p.upsCount = 0;
      p.lastFpsT = t0;
    }
    // autosave every 60 real seconds
    if (!this.ui.mainMenu && !this.paused) {
      this.autosaveT += dtReal;
      if (this.autosaveT > 60) {
        this.autosaveT = 0;
        void this.saveTo('auto');
      }
    }
    // UI refresh at ~8 Hz, expire toasts
    this.uiTimer += dtReal;
    if (this.uiTimer > 0.125) {
      this.uiTimer = 0;
      const now = performance.now();
      const before = this.ui.toasts.length;
      this.ui.toasts = this.ui.toasts.filter((t) => now - t.at < (t.action ? 14000 : 8000));
      if (before !== this.ui.toasts.length || true) this.emit();
    }
  }

  applySettings(): void {
    audio.setEnabled(this.settings.sound);
    audio.setVolume(this.settings.volume);
    document.documentElement.style.setProperty('--ui-scale', String(this.settings.uiScale));
    document.body.classList.toggle('hc', this.settings.highContrast);
    try {
      localStorage.setItem('vf-settings', JSON.stringify(this.settings));
    } catch {
      /* storage may be blocked */
    }
    this.emit();
  }

  snapshot() {
    return { ...this.sim.serialize(), blueprints: this.blueprints };
  }

  async saveTo(slot: SlotId): Promise<void> {
    const snap = this.snapshot();
    await saveSlot(slot, snap, { day: this.sim.day, era: this.sim.ai.era, seed: this.sim.seed, playtime: this.sim.time, label: `День ${this.sim.day}, эра ${this.sim.ai.era}, сид ${this.sim.seed}` });
    if (slot !== 'auto') this.pushToast({ kind: 'success', title: 'Игра сохранена', text: `Слот ${slot.slice(-1)}` });
  }

  async loadFrom(slot: SlotId): Promise<boolean> {
    const rec = await loadSlot(slot);
    if (!rec) return false;
    this.applySnapshot(rec.data);
    this.pushToast({ kind: 'info', title: 'Игра загружена', text: rec.meta.label });
    return true;
  }

  async loadLatest(): Promise<boolean> {
    const metas = await listSlots();
    if (!metas.length) return false;
    metas.sort((a, b) => b.savedAt - a.savedAt);
    return this.loadFrom(metas[0].slot);
  }

  applySnapshot(data: SimSnapshot & { blueprints?: Blueprint[] }): void {
    if (data.version !== SAVE_VERSION) {
      this.pushToast({ kind: 'danger', title: 'Несовместимое сохранение', text: `Версия формата ${data.version}, нужна ${SAVE_VERSION}` });
      return;
    }
    this.blueprints = data.blueprints ?? [];
    this.load(Sim.deserialize(data));
  }

  exportSave(): void {
    exportFile(this.snapshot(), `vibefoundry-day${this.sim.day}.json`);
  }

  async importSave(): Promise<void> {
    const d = await importFile();
    if (!d) {
      this.pushToast({ kind: 'warning', title: 'Файл не распознан', text: 'Нужен экспорт сохранения VibeFoundry (.json)' });
      return;
    }
    this.applySnapshot(d as any);
  }

  setSpeed(s: number): void {
    if (s === 0) this.paused = true;
    else {
      this.paused = false;
      this.speed = s;
    }
    this.emit();
  }

  // ---------------------------------------------------------------- tools
  setTool(t: Tool): void {
    this.tool = t;
    this.renderer.preview = null;
    this.emit();
  }

  selectBuild(type: BuildingType, recipe?: string): void {
    const prevDir = this.tool.kind === 'build' ? this.tool.dir : 1;
    this.setTool({ kind: 'build', type, dir: prevDir, recipe });
  }

  selected(): Entity | null {
    if (this.ui.selectedId == null) return null;
    return this.sim.ents.get(this.ui.selectedId) ?? null;
  }

  select(e: Entity | null): void {
    this.ui.selectedId = e?.id ?? null;
    this.renderer.selected = e;
    if (e) audio.play('click');
    this.emit();
  }

  focusTile(x: number, y: number, zoom = 1.3): void {
    this.renderer.flyTo(x + 0.5, y + 0.5, zoom);
    this.ui.focusTile = { x, y };
    this.emit();
  }

  /** Belt/pipe drag path (L-shaped, dominant axis first). */
  private linePath(x0: number, y0: number, x1: number, y1: number): { x: number; y: number; dir: Dir }[] {
    const out: { x: number; y: number; dir: Dir }[] = [];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const horizFirst = Math.abs(dx) >= Math.abs(dy);
    const dirX: Dir = dx >= 0 ? 1 : 3;
    const dirY: Dir = dy >= 0 ? 2 : 0;
    let x = x0;
    let y = y0;
    if (horizFirst) {
      while (x !== x1) {
        out.push({ x, y, dir: dirX });
        x += Math.sign(dx);
      }
      if (dy === 0) out.push({ x, y, dir: this.tool.kind === 'build' && dx === 0 ? this.tool.dir : dirX });
      while (y !== y1 + Math.sign(dy) && dy !== 0) {
        out.push({ x, y, dir: dirY });
        y += Math.sign(dy);
      }
    } else {
      while (y !== y1) {
        out.push({ x, y, dir: dirY });
        y += Math.sign(dy);
      }
      if (dx === 0) out.push({ x, y, dir: dirY });
      while (x !== x1 + Math.sign(dx) && dx !== 0) {
        out.push({ x, y, dir: dirX });
        x += Math.sign(dx);
      }
    }
    return out;
  }

  private placementTiles(tx: number, ty: number): { x: number; y: number; dir: Dir }[] {
    if (this.tool.kind === 'paste') {
      return this.tool.bp.entities.map((e) => ({ x: tx + e.dx, y: ty + e.dy, dir: e.dir }));
    }
    if (this.tool.kind !== 'build') return [];
    const def = BUILDINGS[this.tool.type];
    const ox = tx - Math.floor((def.w - 1) / 2);
    const oy = ty - Math.floor((def.h - 1) / 2);
    const lineable = this.tool.type === 'belt' || this.tool.type === 'pipe';
    if (lineable && this.drag && this.drag.button === 0) {
      const path = this.linePath(this.drag.tx, this.drag.ty, tx, ty);
      if (this.tool.type === 'pipe') return path.map((p) => ({ ...p, dir: 0 as Dir }));
      if (path.length === 1) path[0].dir = this.tool.dir;
      return path;
    }
    return [{ x: ox, y: oy, dir: this.tool.dir }];
  }

  private updatePreview(): void {
    const h = this.ui.hover;
    if (!h || (this.tool.kind !== 'build' && this.tool.kind !== 'paste')) {
      this.renderer.preview = null;
      return;
    }
    const tiles = this.placementTiles(h.x, h.y);
    if (this.tool.kind === 'paste') {
      const bp = this.tool.bp;
      this.renderer.preview = {
        type: bp.entities[0]?.type ?? 'belt',
        tiles: tiles.slice(0, 1),
        valid: [true],
      };
      // show all entities of the blueprint via multiple previews of their own type
      (this.renderer as any).preview = null;
      this.renderer.preview = { type: 'belt', tiles: [], valid: [] };
      const multi = bp.entities.map((e, i) => ({ t: tiles[i], type: e.type }));
      // renderer supports single type per preview; show footprints via belts type when mixed
      this.renderer.preview = {
        type: multi[0]?.type ?? 'belt',
        tiles: multi.filter((m) => m.type === multi[0].type).map((m) => m.t),
        valid: multi.filter((m) => m.type === multi[0].type).map((m) => this.sim.canPlace(m.type, m.t.x, m.t.y, m.t.dir).ok),
      };
      return;
    }
    const type = this.tool.type;
    const valid = tiles.map((t) => {
      if (type === 'belt') {
        const ex = this.sim.entityAt(t.x, t.y);
        if (ex && ex.type === 'belt') return true;
      }
      return this.sim.canPlace(type, t.x, t.y, t.dir).ok;
    });
    this.renderer.preview = { type, tiles, valid };
  }

  commitPlacement(tx: number, ty: number): void {
    if (this.tool.kind === 'paste') {
      const bp = this.tool.bp;
      let n = 0;
      for (const e of bp.entities) {
        const r = this.sim.place(e.type, tx + e.dx, ty + e.dy, e.dir, { recipe: e.recipe });
        if (r) n++;
      }
      if (n) audio.play('place');
      this.pushToast({ kind: 'info', title: 'Чертёж вставлен', text: `${n} из ${bp.entities.length} призраков поставлено` });
      return;
    }
    if (this.tool.kind !== 'build') return;
    const tiles = this.placementTiles(tx, ty);
    let placed = 0;
    let reason = '';
    for (const t of tiles) {
      const r = this.sim.place(this.tool.type, t.x, t.y, t.dir, { recipe: this.tool.recipe });
      if (r) placed++;
      else if (!reason) reason = this.sim.canPlace(this.tool.type, t.x, t.y, t.dir).reason ?? '';
    }
    if (placed) audio.play('place');
    else if (reason) this.pushToast({ kind: 'warning', title: 'Нельзя построить', text: reason, key: 'noplace-' + reason });
  }

  rotate(): void {
    if (this.tool.kind === 'build') {
      this.tool = { ...this.tool, dir: rotCW(this.tool.dir) };
      this.updatePreview();
      this.emit();
      return;
    }
    const h = this.ui.hover;
    const e = (h && this.sim.entityAt(h.x, h.y)) || this.selected();
    if (e) {
      this.sim.rotate(e);
      this.sim.noteManual();
      audio.play('click');
    }
  }

  pipette(): void {
    const h = this.ui.hover;
    const e = h ? this.sim.entityAt(h.x, h.y) : null;
    if (!e || e.type === 'hq') return;
    if (!this.sim.buildingUnlocked(e.type)) return;
    this.setTool({ kind: 'build', type: e.type, dir: e.dir, recipe: e.recipe ?? undefined });
  }

  deconstructAt(x: number, y: number): void {
    const e = this.sim.entityAt(x, y);
    if (!e) return;
    if (e.type === 'hq') {
      this.pushToast({ kind: 'warning', title: 'Базу нельзя снести', key: 'hq-decon' });
      return;
    }
    if (e.decon) {
      delete e.decon;
      delete e.assigned;
      return;
    }
    this.sim.deconstruct(e);
    audio.play('decon');
    if (this.ui.selectedId === e.id && !this.sim.ents.has(e.id)) this.select(null);
  }

  entitiesInRect(x0: number, y0: number, x1: number, y1: number): Entity[] {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    return this.sim.list.filter((e) => e.x + e.w - 1 >= ax && e.x <= bx && e.y + e.h - 1 >= ay && e.y <= by);
  }

  // ---------------------------------------------------------------- input
  private bindInput(): void {
    const cv = this.app.canvas as HTMLCanvasElement;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (ev) => {
      if (this.ui.mainMenu) return;
      cv.setPointerCapture(ev.pointerId);
      const t = this.renderer.screenToTile(ev.offsetX, ev.offsetY);
      this.drag = { button: ev.button, sx: ev.offsetX, sy: ev.offsetY, tx: t.x, ty: t.y, moved: false, lastX: ev.offsetX, lastY: ev.offsetY };
      this.ui.groupRect = null;
    });
    cv.addEventListener('pointermove', (ev) => {
      const t = this.renderer.screenToTile(ev.offsetX, ev.offsetY);
      const h = this.ui.hover;
      if (!h || h.x !== t.x || h.y !== t.y) {
        this.ui.hover = { x: t.x, y: t.y };
        this.renderer.hover = this.ui.hover;
      }
      const d = this.drag;
      if (d) {
        if (Math.hypot(ev.offsetX - d.sx, ev.offsetY - d.sy) > 5) d.moved = true;
        const panning = d.button === 1 || d.button === 2 || (d.button === 0 && this.tool.kind === 'none');
        if (panning && d.moved) this.renderer.pan(-(ev.offsetX - d.lastX), -(ev.offsetY - d.lastY));
        if (d.button === 0 && (this.tool.kind === 'decon' || this.tool.kind === 'group' || this.tool.kind === 'copy')) {
          this.ui.groupRect = { x0: d.tx, y0: d.ty, x1: t.x, y1: t.y };
          this.drawRectSelection();
        }
        // non-line buildings: paint while dragging (poles, inserters...)
        if (d.button === 0 && this.tool.kind === 'build' && d.moved && !['belt', 'pipe'].includes(this.tool.type) && BUILDINGS[this.tool.type].w === 1) {
          if (!h || h.x !== t.x || h.y !== t.y) this.commitPlacement(t.x, t.y);
        }
        d.lastX = ev.offsetX;
        d.lastY = ev.offsetY;
      }
      this.updatePreview();
    });
    cv.addEventListener('pointerup', (ev) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      const t = this.renderer.screenToTile(ev.offsetX, ev.offsetY);
      if (d.button === 0) {
        if (this.tool.kind === 'build') {
          if (['belt', 'pipe'].includes(this.tool.type)) {
            this.drag = d; // keep path origin for placementTiles
            this.commitPlacement(t.x, t.y);
            this.drag = null;
          } else if (!d.moved || BUILDINGS[this.tool.type].w > 1) this.commitPlacement(t.x, t.y);
        } else if (this.tool.kind === 'paste') {
          this.commitPlacement(t.x, t.y);
        } else if (this.tool.kind === 'decon') {
          const list = this.entitiesInRect(d.tx, d.ty, t.x, t.y);
          for (const e of list) if (e.type !== 'hq') this.sim.deconstruct(e);
          if (list.length) audio.play('decon');
          this.ui.groupRect = null;
          this.renderer.overlayG.clear();
        } else if (this.tool.kind === 'group') {
          const list = this.entitiesInRect(d.tx, d.ty, t.x, t.y).filter((e) => !BELTLIKE.has(e.type) && e.type !== 'pipe' && e.type !== 'pole');
          this.ui.pendingGroup = list.map((e) => e.id);
          this.ui.groupRect = null;
          this.setTool({ kind: 'none' });
        } else if (this.tool.kind === 'copy') {
          this.copyBlueprint(d.tx, d.ty, t.x, t.y);
          this.ui.groupRect = null;
        } else if (!d.moved) {
          const e = this.sim.entityAt(t.x, t.y);
          this.select(e ?? null);
          if (!e) this.ui.focusTile = { x: t.x, y: t.y };
          const poi = this.sim.world.pois.find((p) => p.x === t.x && p.y === t.y && !p.explored);
          if (poi) this.ui.focusTile = { x: poi.x, y: poi.y };
        }
      } else if (d.button === 2 && !d.moved) {
        if (this.tool.kind !== 'none' && !this.sim.entityAt(t.x, t.y)) this.setTool({ kind: 'none' });
        else this.deconstructAt(t.x, t.y);
      }
      this.updatePreview();
      this.emit();
    });
    cv.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        this.renderer.zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.offsetX, ev.offsetY);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (ev) => this.onKey(ev));
    window.addEventListener('keyup', (ev) => this.keys.delete(ev.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private drawRectSelection(): void {
    const r = this.ui.groupRect;
    if (!r) return;
    const g = this.renderer.overlayG;
    const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1) + 1, y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1) + 1;
    const col = this.tool.kind === 'decon' ? 0xed5347 : this.tool.kind === 'copy' ? 0xedbb5a : 0x9096db;
    const iso = (x: number, y: number) => [(x - y) * 32, (x + y) * 16];
    const pts = [...iso(x0, y0), ...iso(x1, y0), ...iso(x1, y1), ...iso(x0, y1)];
    g.poly(pts).fill({ color: col, alpha: 0.12 });
    g.poly(pts).stroke({ color: col, width: 2 / this.renderer.cam.zoom });
  }

  private onKey(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      if (ev.key === 'Escape') target.blur();
      return;
    }
    if (this.ui.mainMenu) return;
    const code = ev.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
      this.keys.add(code);
      if (code.startsWith('Arrow')) ev.preventDefault();
      return;
    }
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ctrl && code === 'KeyC') {
      if (this.sim.isUnlocked('blueprints')) this.setTool({ kind: 'copy' });
      else this.pushToast({ kind: 'warning', title: 'Нужно исследование «Чертежи»', key: 'bp-lock' });
      ev.preventDefault();
      return;
    }
    if (ctrl && code === 'KeyV') {
      const bp = this.blueprints[this.blueprints.length - 1];
      if (bp) this.setTool({ kind: 'paste', bp });
      ev.preventDefault();
      return;
    }
    switch (code) {
      case 'KeyR':
        this.rotate();
        break;
      case 'KeyQ':
        this.pipette();
        break;
      case 'KeyM':
        this.togglePanel('map');
        break;
      case 'Tab':
        ev.preventDefault();
        this.togglePanel('vibe');
        break;
      case 'KeyB':
        this.togglePanel('build');
        break;
      case 'KeyT':
        this.togglePanel('research');
        break;
      case 'AltLeft':
      case 'AltRight':
        ev.preventDefault();
        this.renderer.altMode = !this.renderer.altMode;
        this.emit();
        break;
      case 'Space':
        ev.preventDefault();
        this.paused = !this.paused;
        this.emit();
        break;
      case 'Digit1':
        this.setSpeed(1);
        break;
      case 'Digit2':
        this.setSpeed(2);
        break;
      case 'Digit3':
        this.setSpeed(4);
        break;
      case 'Digit4':
        this.setSpeed(8);
        break;
      case 'F3':
        ev.preventDefault();
        this.ui.showPerf = !this.ui.showPerf;
        this.emit();
        break;
      case 'Delete':
      case 'Backspace': {
        const s = this.selected();
        if (s) this.deconstructAt(s.x, s.y);
        break;
      }
      case 'Escape':
        if (this.tool.kind !== 'none') this.setTool({ kind: 'none' });
        else if (this.ui.panel) this.ui.panel = null;
        else if (this.ui.selectedId != null) this.select(null);
        else this.ui.panel = 'menu';
        this.emit();
        break;
    }
  }

  /** UI command dispatcher (toasts, panels). */
  command(cmd: string, arg?: any): void {
    const sim = this.sim;
    switch (cmd) {
      case 'explorePoi': {
        const d = sim.drones.find((x) => (x.kind === 'worker' || x.kind === 'construction') && x.state === 'idle');
        if (!d) {
          this.pushToast({ kind: 'warning', title: 'Нет свободных дронов', text: 'Все дроны заняты — попробуйте позже.' });
          break;
        }
        sendToPoi(sim, d, arg);
        this.pushToast({ kind: 'info', title: 'Экспедиция отправлена', text: `${DRONE_NAMES[d.kind]} летит к точке «?»` });
        break;
      }
      case 'installModule': {
        const e = sim.ents.get(arg);
        if (e && sim.takeStock([{ item: 'memory_module', n: 1 }])) {
          const slots = e.type === 'aicore' ? 20 : 4;
          if ((e.modules ?? 0) < slots) {
            e.modules = (e.modules ?? 0) + 1;
            sim.stats.consume('memory_module', 1);
          } else sim.addStock('memory_module', 1);
        }
        break;
      }
      case 'panel':
        this.ui.panel = arg;
        break;
      default:
        this.onCommand?.(cmd, arg);
    }
    this.emit();
  }
  onCommand?: (cmd: string, arg?: any) => void;

  togglePanel(p: Panel): void {
    this.ui.panel = this.ui.panel === p ? null : p;
    audio.play('click');
    this.emit();
  }

  copyBlueprint(x0: number, y0: number, x1: number, y1: number): void {
    const list = this.entitiesInRect(x0, y0, x1, y1).filter((e) => e.type !== 'hq');
    if (!list.length) return;
    const minX = Math.min(...list.map((e) => e.x));
    const minY = Math.min(...list.map((e) => e.y));
    const bp: Blueprint = {
      name: `Чертёж ${this.blueprints.length + 1}`,
      w: Math.max(...list.map((e) => e.x + e.w)) - minX,
      h: Math.max(...list.map((e) => e.y + e.h)) - minY,
      entities: list.map((e) => ({ type: e.type, dx: e.x - minX, dy: e.y - minY, dir: e.dir, recipe: e.recipe ?? undefined })),
    };
    this.blueprints.push(bp);
    this.setTool({ kind: 'paste', bp });
    this.pushToast({ kind: 'success', title: 'Чертёж скопирован', text: `${bp.name}: ${list.length} построек. Клик — вставить, Esc — отмена.` });
  }
}

export interface GameSettings {
  sound: boolean;
  volume: number;
  uiScale: number;
  highContrast: boolean;
}

function loadSettings(): GameSettings {
  const def: GameSettings = { sound: true, volume: 0.5, uiScale: 1, highContrast: false };
  try {
    const raw = localStorage.getItem('vf-settings');
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return def;
}
