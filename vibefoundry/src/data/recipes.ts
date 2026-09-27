import type { ItemId } from './items';

export type MachineClass = 'smelter' | 'assembler' | 'assembler2' | 'chem';

export interface Stack {
  item: ItemId;
  n: number;
}

export interface RecipeDef {
  id: string;
  name: string;
  machine: MachineClass;
  /** Seconds at crafting speed 1. */
  time: number;
  inputs: Stack[];
  outputs: Stack[];
  /** Fluid taken from the pipe network when a craft starts. */
  fluid?: { item: 'oil'; n: number };
  /** Abstract AI resources consumed at craft start (science AI/autonomy). */
  ai?: { data?: number; weights?: number };
  /** Tech id required; undefined = available from start. */
  unlock?: string;
}

export const RECIPE_LIST: RecipeDef[] = [
  // Smelter
  { id: 'iron_plate', name: 'Железная пластина', machine: 'smelter', time: 3.2, inputs: [{ item: 'iron_ore', n: 1 }], outputs: [{ item: 'iron_plate', n: 1 }] },
  { id: 'copper_plate', name: 'Медная пластина', machine: 'smelter', time: 3.2, inputs: [{ item: 'copper_ore', n: 1 }], outputs: [{ item: 'copper_plate', n: 1 }] },
  { id: 'stone_brick', name: 'Кирпич', machine: 'smelter', time: 3.2, inputs: [{ item: 'stone', n: 2 }], outputs: [{ item: 'stone_brick', n: 1 }] },
  { id: 'silicon_wafer', name: 'Кремниевая пластина', machine: 'smelter', time: 4, inputs: [{ item: 'silicon_ore', n: 2 }], outputs: [{ item: 'silicon_wafer', n: 1 }], unlock: 'silicon' },
  { id: 'steel', name: 'Сталь', machine: 'smelter', time: 16, inputs: [{ item: 'iron_plate', n: 5 }], outputs: [{ item: 'steel', n: 1 }], unlock: 'steel' },
  // Assembler
  { id: 'gear', name: 'Шестерня', machine: 'assembler', time: 0.5, inputs: [{ item: 'iron_plate', n: 2 }], outputs: [{ item: 'gear', n: 1 }] },
  { id: 'copper_wire', name: 'Медный провод', machine: 'assembler', time: 0.5, inputs: [{ item: 'copper_plate', n: 1 }], outputs: [{ item: 'copper_wire', n: 2 }] },
  { id: 'science_mech', name: 'Пакет «Механика»', machine: 'assembler', time: 5, inputs: [{ item: 'gear', n: 1 }, { item: 'copper_plate', n: 1 }], outputs: [{ item: 'science_mech', n: 1 }] },
  { id: 'microchip', name: 'Микросхема', machine: 'assembler', time: 6, inputs: [{ item: 'silicon_wafer', n: 1 }, { item: 'copper_wire', n: 3 }, { item: 'plastic', n: 1 }], outputs: [{ item: 'microchip', n: 1 }], unlock: 'electronics' },
  { id: 'science_elec', name: 'Пакет «Электроника»', machine: 'assembler', time: 8, inputs: [{ item: 'microchip', n: 1 }, { item: 'battery', n: 1 }], outputs: [{ item: 'science_elec', n: 1 }], unlock: 'electronics' },
  { id: 'magnet', name: 'Редкоземельный магнит', machine: 'assembler', time: 5, inputs: [{ item: 'rare_earth', n: 1 }, { item: 'iron_plate', n: 1 }], outputs: [{ item: 'magnet', n: 1 }], unlock: 'rare_earth' },
  { id: 'memory_module', name: 'Модуль памяти', machine: 'assembler', time: 8, inputs: [{ item: 'microchip', n: 2 }, { item: 'plastic', n: 1 }], outputs: [{ item: 'memory_module', n: 1 }], unlock: 'memory' },
  { id: 'science_ai', name: 'Пакет «ИИ»', machine: 'assembler', time: 10, inputs: [{ item: 'tensor_chip', n: 1 }], outputs: [{ item: 'science_ai', n: 1 }], ai: { data: 10 }, unlock: 'ai_science' },
  { id: 'science_auto', name: 'Пакет «Автономия»', machine: 'assembler', time: 14, inputs: [{ item: 'uranium_fuel', n: 1 }], outputs: [{ item: 'science_auto', n: 1 }], ai: { weights: 0.25 }, unlock: 'autonomy_science' },
  // Assembler II only
  { id: 'tensor_chip', name: 'Тензорный ИИ-чип', machine: 'assembler2', time: 12, inputs: [{ item: 'microchip', n: 2 }, { item: 'magnet', n: 1 }, { item: 'silicon_wafer', n: 1 }], outputs: [{ item: 'tensor_chip', n: 1 }], unlock: 'tensor' },
  // Chemical plant
  { id: 'plastic', name: 'Пластик', machine: 'chem', time: 1, inputs: [], fluid: { item: 'oil', n: 10 }, outputs: [{ item: 'plastic', n: 1 }], unlock: 'oil_processing' },
  { id: 'electrolyte', name: 'Электролит', machine: 'chem', time: 2, inputs: [{ item: 'copper_plate', n: 1 }], fluid: { item: 'oil', n: 10 }, outputs: [{ item: 'electrolyte', n: 2 }], unlock: 'batteries' },
  { id: 'battery', name: 'Аккумулятор', machine: 'chem', time: 4, inputs: [{ item: 'iron_plate', n: 1 }, { item: 'copper_plate', n: 1 }, { item: 'electrolyte', n: 1 }], outputs: [{ item: 'battery', n: 1 }], unlock: 'batteries' },
  { id: 'uranium_fuel', name: 'Урановое топливо', machine: 'chem', time: 20, inputs: [{ item: 'uranium_ore', n: 10 }], outputs: [{ item: 'uranium_fuel', n: 1 }], unlock: 'uranium' },
];

export const RECIPES: Record<string, RecipeDef> = Object.fromEntries(RECIPE_LIST.map((r) => [r.id, r]));

/** Smelters pick their recipe automatically from the first accepted input. */
export const SMELT_BY_INPUT: Partial<Record<ItemId, string>> = {
  iron_ore: 'iron_plate',
  copper_ore: 'copper_plate',
  stone: 'stone_brick',
  silicon_ore: 'silicon_wafer',
  iron_plate: 'steel',
};

/** Recipes a machine class can run. Assembler II runs everything an assembler can. */
export function recipesFor(machine: MachineClass): RecipeDef[] {
  if (machine === 'assembler2') return RECIPE_LIST.filter((r) => r.machine === 'assembler' || r.machine === 'assembler2');
  return RECIPE_LIST.filter((r) => r.machine === machine);
}

/** Recipe producing the item (first match). */
export function recipeForItem(item: ItemId): RecipeDef | undefined {
  return RECIPE_LIST.find((r) => r.outputs.some((o) => o.item === item));
}
