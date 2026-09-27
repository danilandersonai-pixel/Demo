import { BUILDING_ALIASES, BUILDINGS, CONTROLLABLE, type BuildingType } from '../data/buildings';
import { ITEMS, type ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import type { Sim } from '../sim/sim';
import type { Entity } from '../sim/types';

/** Item aliases accepted by scripts (English plural forms, short names). */
export const ITEM_ALIASES: Record<string, ItemId> = {
  chip: 'microchip', chips: 'microchip', microchips: 'microchip', microchip: 'microchip',
  battery: 'battery', batteries: 'battery', accumulators: 'battery',
  plastic: 'plastic', plastics: 'plastic',
  gear: 'gear', gears: 'gear',
  wire: 'copper_wire', wires: 'copper_wire', copper_wire: 'copper_wire', cable: 'copper_wire', cables: 'copper_wire',
  iron: 'iron_plate', iron_plate: 'iron_plate', iron_plates: 'iron_plate',
  copper: 'copper_plate', copper_plate: 'copper_plate', copper_plates: 'copper_plate',
  steel: 'steel',
  wafer: 'silicon_wafer', wafers: 'silicon_wafer', silicon: 'silicon_wafer', silicon_wafer: 'silicon_wafer', silicon_wafers: 'silicon_wafer',
  brick: 'stone_brick', bricks: 'stone_brick', stone_brick: 'stone_brick',
  electrolyte: 'electrolyte',
  magnet: 'magnet', magnets: 'magnet',
  memory: 'memory_module', memory_module: 'memory_module', memory_modules: 'memory_module', modules: 'memory_module',
  tensor: 'tensor_chip', tensor_chip: 'tensor_chip', tensor_chips: 'tensor_chip',
  fuel: 'uranium_fuel', uranium_fuel: 'uranium_fuel',
  iron_ore: 'iron_ore', copper_ore: 'copper_ore', stone: 'stone', sand: 'silicon_ore', silicon_ore: 'silicon_ore', quartz: 'silicon_ore',
  rare_earth: 'rare_earth', uranium: 'uranium_ore', uranium_ore: 'uranium_ore', oil: 'oil',
  science: 'science_mech', science_mech: 'science_mech', science_elec: 'science_elec', science_ai: 'science_ai', science_auto: 'science_auto',
};

export function resolveItem(name: string): ItemId | null {
  const n = name.trim().toLowerCase();
  if (n in ITEMS) return n as ItemId;
  return ITEM_ALIASES[n] ?? null;
}

/** Buildings producing an item: crafters by recipe output, drills by mined resource. */
export function producersOf(sim: Sim, item: ItemId): Entity[] {
  return sim.list.filter((e) => {
    if (e.ghost) return false;
    if (e.type === 'drill') return e.recipe === item;
    if (e.type === 'pumpjack') return item === 'oil';
    const r = e.recipe ? RECIPES[e.recipe] : undefined;
    return !!r && r.outputs.some((o) => o.item === item);
  });
}

/** Does a group name resolve to anything known (even if currently empty)? */
export function groupKnown(sim: Sim, name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n in sim.groups) return true;
  if (n === 'all' || n === 'everything') return true;
  if (BUILDING_ALIASES[n] || n in BUILDINGS) return true;
  const base = n.replace(/_(production|producers|line|lines|makers|mining|drills|smelters|smelting)$/, '');
  if (resolveItem(base) || resolveItem(n)) return true;
  if (BUILDING_ALIASES[base]) return true;
  return false;
}

/** Resolve a group name used by scripts into buildings. Unknown names resolve to []. */
export function resolveGroup(sim: Sim, name: string): Entity[] {
  const n = name.trim().toLowerCase();
  if (n in sim.groups) {
    const ids = sim.groups[n];
    return ids.map((id) => sim.ents.get(id)).filter((e): e is Entity => !!e && !e.ghost);
  }
  if (n === 'all' || n === 'everything') return sim.list.filter((e) => !e.ghost && CONTROLLABLE.has(e.type));
  const bt = (BUILDING_ALIASES[n] ?? (n in BUILDINGS ? n : null)) as BuildingType | null;
  if (bt) return sim.list.filter((e) => !e.ghost && e.type === bt);
  const m = n.match(/^(.+?)_(production|producers|line|lines|makers|mining|drills|smelters|smelting)$/);
  if (m) {
    const it = resolveItem(m[1]);
    if (it) {
      let list = producersOf(sim, it);
      // "iron_smelters" → smelters making iron plates; "copper_mining" → drills on copper
      if (m[2] === 'mining' || m[2] === 'drills') {
        const ore = (it.replace('_plate', '_ore') in ITEMS ? it.replace('_plate', '_ore') : it) as ItemId;
        list = sim.list.filter((e) => !e.ghost && e.type === 'drill' && e.recipe === ore);
      }
      if (m[2] === 'smelters' || m[2] === 'smelting') list = list.filter((e) => e.type === 'smelter');
      return list;
    }
    const bt2 = BUILDING_ALIASES[m[1]];
    if (bt2) return sim.list.filter((e) => !e.ghost && e.type === bt2);
  }
  const it = resolveItem(n);
  if (it) return producersOf(sim, it);
  return [];
}
