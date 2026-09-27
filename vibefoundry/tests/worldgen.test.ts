import { describe, it, expect } from 'vitest';
import { generateWorld } from '../src/world/worldgen';
import { BIOMES, Biome, isWater } from '../src/data/biomes';

describe('worldgen', () => {
  it('is deterministic by seed', () => {
    const a = generateWorld({ seed: 42 });
    const b = generateWorld({ seed: 42 });
    expect(a.base).toEqual(b.base);
    expect(Buffer.from(a.biome).equals(Buffer.from(b.biome))).toBe(true);
    expect(Buffer.from(a.res).equals(Buffer.from(b.res))).toBe(true);
  });

  it('produces an island with all key biomes, deposits, pois and nests', () => {
    for (const seed of [1, 42, 1337, 2026]) {
      const w = generateWorld({ seed });
      const counts = new Array(BIOMES.length).fill(0);
      for (const b of w.biome) counts[b]++;
      const land = counts.reduce((s, n, i) => (isWater(i) ? s : s + n), 0);
      const frac = land / w.biome.length;
      if (process.env.VF_MAP) {
        const ch = '~≈=.,\'"^AMt:%&x*';
        let out = `seed ${seed} land ${(frac * 100).toFixed(1)}% base ${w.base.x},${w.base.y}\n`;
        for (let y = 0; y < w.h; y += 4) {
          let row = '';
          for (let x = 0; x < w.w; x += 2) {
            const i = y * w.w + x;
            row += w.res[i] ? String(w.res[i]) : ch[w.biome[i]];
          }
          out += row + '\n';
        }
        require("fs").appendFileSync("/tmp/vf_map.txt", out + counts.map((n, i) => `${BIOMES[i].name}:${n}`).join(" ") + "\n");
      }
      expect(frac).toBeGreaterThan(0.3);
      expect(frac).toBeLessThan(0.75);
      for (const b of [Biome.Forest, Biome.Meadow, Biome.Mountain, Biome.Lake, Biome.Sea]) expect(counts[b]).toBeGreaterThan(0);
      expect(counts[Biome.Volcanic]).toBeGreaterThan(0);
      const resSet = new Set(w.deposits.map((d) => d.res));
      for (const r of ['iron_ore', 'copper_ore', 'stone', 'silicon_ore', 'oil', 'rare_earth', 'uranium_ore']) expect(resSet.has(r as any)).toBe(true);
      expect(w.pois.length).toBeGreaterThanOrEqual(10);
      expect(w.nests.length).toBeGreaterThan(0);
      expect(isWater(w.biome[w.base.y * w.w + w.base.x])).toBe(false);
      // starter iron and copper within 26 tiles of base
      const near = (r: string) => w.deposits.some((d) => d.res === r && Math.hypot(d.x - w.base.x, d.y - w.base.y) < 26);
      expect(near('iron_ore')).toBe(true);
      expect(near('copper_ore')).toBe(true);
    }
  });
});
