import type { BuildingType } from '../data/buildings';
import type { Dir } from '../core/iso';

export type Status =
  | 'working' | 'idle' | 'no_input' | 'output_full' | 'no_power' | 'low_power' | 'disabled' | 'no_recipe'
  | 'limit' | 'no_fluid' | 'no_resource' | 'no_materials' | 'out_of_range' | 'waiting' | 'no_cooling' | 'no_research';

export const STATUS_TEXT: Record<Status, string> = {
  working: 'Работает',
  idle: 'Простаивает',
  no_input: 'Нет входа',
  output_full: 'Выход забит',
  no_power: 'Нет энергии',
  low_power: 'Мало энергии',
  disabled: 'Отключено',
  no_recipe: 'Нет рецепта',
  limit: 'Лимит запаса',
  no_fluid: 'Нет нефти',
  no_resource: 'Нет ресурса',
  no_materials: 'Нет материалов',
  out_of_range: 'Вне зоны дронов',
  waiting: 'Ожидает',
  no_cooling: 'Нет охлаждения',
  no_research: 'Нет исследования',
};

/** A placed building (or ghost). Plain data → trivially serializable. */
export interface Entity {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  w: number;
  h: number;
  dir: Dir;
  hp: number;
  ghost?: boolean;
  decon?: boolean;
  /** Drone id assigned to build/deconstruct this. */
  assigned?: number;
  /** Cost already taken from storage (reserved). */
  paid?: boolean;
  createdAt?: number;

  recipe?: string | null;
  progress?: number;
  crafting?: boolean;
  inv?: Record<string, number>;
  out?: Record<string, number>;
  store?: Record<string, number>;
  storeTotal?: number;

  /** BeltStore slot for belt-like entities. */
  bi?: number;
  /** Underground pairing. */
  ug?: 'in' | 'out';
  pair?: number;
  /** Splitter round-robin cursor and per-item output filters (0 fwd, 1 left, 2 right). */
  rr?: number;

  /** Inserter state. */
  hand?: number;
  phase?: number;
  t?: number;
  filter?: string | null;

  mine?: number;
  charge?: number;
  fuel?: number;
  modules?: number;
  scanR?: number;
  cooldown?: number;
  aim?: number;
  fluid?: number;

  /** Manual controls from the building panel. */
  off?: boolean;
  prio?: number;

  // ---- runtime (recomputed, stripped from saves) ----
  status?: Status;
  sat?: number;
  net?: number;
  fnet?: number;
  scriptOff?: boolean;
  scriptOn?: boolean;
  scriptPrio?: number;
  wantPower?: number;
  next?: number;
  nextMode?: number;
  curve?: number;
  outs?: number[];
  toggles?: number;
  lastOffState?: boolean;
  anim?: number;
  cooled?: boolean;
}

export const RUNTIME_KEYS: (keyof Entity)[] = [
  'status', 'sat', 'net', 'fnet', 'scriptOff', 'scriptOn', 'scriptPrio', 'wantPower', 'next', 'nextMode', 'curve', 'outs',
  'toggles', 'lastOffState', 'anim', 'cooled',
];

export type DroneKind = 'construction' | 'worker' | 'logistic' | 'engineer' | 'combat';

export interface Drone {
  id: number;
  kind: DroneKind;
  x: number;
  y: number;
  px: number;
  py: number;
  home: number;
  state: 'idle' | 'fly' | 'work' | 'return' | 'expedition' | 'rogue';
  task?: { type: 'build' | 'decon' | 'poi' | 'repair' | 'deliver' | 'collect' | 'attack' | 'patrol' | 'explore'; id: number; x: number; y: number; item?: string; n?: number; from?: number };
  t: number;
  hp: number;
  carry?: { item: string; n: number };
  /** Heading for rendering. */
  ang: number;
}

export interface Enemy {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  hp: number;
  target: number;
  cooldown: number;
  nest: number;
  rogueDrone?: boolean;
}

export type ToastKind = 'warning' | 'info' | 'success' | 'danger';

export interface Toast {
  kind: ToastKind;
  title: string;
  text?: string;
  focus?: { x: number; y: number };
  action?: { label: string; cmd: string; arg?: any };
  key?: string;
}

export interface PowerNetStats {
  id: number;
  capacity: number;
  demand: number;
  nominal: number;
  used: number;
  sat: number;
  charge: number;
  chargeMax: number;
}
