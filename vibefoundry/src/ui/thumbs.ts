import { Sprite, type Texture } from 'pixi.js';
import { BUILDING_LIST, type BuildingType } from '../data/buildings';
import { ITEM_LIST, ITEM_INDEX, type ItemId } from '../data/items';
import { BIOMES } from '../data/biomes';
import type { WorldRenderer } from '../render/renderer';

/** Data-URL thumbnails rendered from the same procedural textures the world uses. */
const cache = new Map<string, string>();
let ready = false;
const listeners = new Set<() => void>();

export function thumb(kind: 'b' | 'i' | 't', id: string): string | undefined {
  return cache.get(kind + ':' + id);
}
export function thumbsReady(): boolean {
  return ready;
}
export function onThumbs(fn: () => void): void {
  listeners.add(fn);
}

export async function buildThumbs(r: WorldRenderer): Promise<void> {
  const ex = r.app.renderer.extract;
  const snap = async (key: string, tex: Texture) => {
    const s = new Sprite(tex);
    try {
      cache.set(key, await ex.base64({ target: s, resolution: 1 } as any));
    } catch {
      /* ignore */
    }
    s.destroy();
  };
  for (const b of BUILDING_LIST) {
    let tex: Texture | undefined;
    if (b.id === 'belt') tex = r.tex.belts[0][1][0];
    else if (b.id === 'splitter') tex = r.tex.splitter[1];
    else if (b.id === 'underground') tex = r.tex.underground[0][1];
    else if (b.id === 'pipe') tex = r.tex.pipes[0b1010];
    else if (b.id === 'inserter') tex = r.tex.inserterBase;
    else tex = r.tex.buildings.get(b.id as BuildingType)?.base;
    if (tex) await snap('b:' + b.id, tex);
  }
  for (const it of ITEM_LIST) await snap('i:' + it.id, r.tex.items[ITEM_INDEX[it.id as ItemId]]);
  for (const bi of BIOMES) await snap('t:' + bi.id, r.tex.tiles[bi.id][0]);
  ready = true;
  for (const fn of listeners) fn();
}
