import { describe, it, expect } from 'vitest';
import { TECH_LIST, TECHS } from '../src/data/research';
import { RECIPE_LIST, type RecipeDef } from '../src/data/recipes';
import { BUILDING_LIST } from '../src/data/buildings';

/**
 * Static progression check: research techs in dependency order and verify that every tech's
 * science packs are producible with what was unlocked before it (no dead ends in the tree).
 */
describe('tech tree has no dead ends', () => {
  it('every tech is researchable with previously unlocked content', () => {
    const done = new Set<string>();
    const raw = new Set(['iron_ore', 'copper_ore', 'silicon_ore', 'stone', 'oil']);
    const machineUnlocked = (m: RecipeDef['machine']) => {
      const b = m === 'smelter' ? 'smelter' : m === 'chem' ? 'chem' : m === 'assembler2' ? 'assembler2' : 'assembler';
      const def = BUILDING_LIST.find((x) => x.id === b)!;
      return !def.unlock || done.has(def.unlock);
    };
    const producible = (): Set<string> => {
      const have = new Set(raw);
      if (done.has('rare_earth')) have.add('rare_earth');
      if (done.has('uranium')) have.add('uranium_ore');
      // oil needs a pumpjack
      const pump = BUILDING_LIST.find((b) => b.id === 'pumpjack')!;
      if (pump.unlock && !done.has(pump.unlock)) have.delete('oil');
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of RECIPE_LIST) {
          if (r.unlock && !done.has(r.unlock)) continue;
          if (!machineUnlocked(r.machine)) continue;
          if (!r.inputs.every((i) => have.has(i.item))) continue;
          if (r.fluid && !have.has('oil')) continue;
          if (r.ai?.data && !done.has('data_collection')) continue;
          if (r.ai?.weights && !done.has('training')) continue;
          for (const o of r.outputs) if (!have.has(o.item)) {
            have.add(o.item);
            changed = true;
          }
        }
      }
      return have;
    };
    const order: string[] = [];
    const remaining = new Set(TECH_LIST.map((t) => t.id));
    for (let guard = 0; guard < 200 && remaining.size; guard++) {
      const have = producible();
      const next = [...remaining].find((id) => TECHS[id].prereq.every((p) => done.has(p)) && TECHS[id].packs.every((p) => have.has(p)));
      if (!next) break;
      done.add(next);
      order.push(next);
      remaining.delete(next);
    }
    expect([...remaining]).toEqual([]);
    expect(order.length).toBe(TECH_LIST.length);
  });
});
