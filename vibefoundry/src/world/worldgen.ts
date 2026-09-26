import { Biome, Deco, isWater } from '../data/biomes';
import { RES_CODE, type ResourceId } from '../data/items';
import { Simplex2 } from '../core/noise';
import { Rng, hash2 } from '../core/rng';
import { World, type Poi, type PoiKind, type Deposit } from './world';

export interface WorldGenOptions {
  seed: number;
  size?: number;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Procedural island: simplex fbm + warped radial mask, biomes by height/moisture/temperature. */
export function generateWorld(opts: WorldGenOptions): World {
  const N = opts.size ?? 256;
  const seed = opts.seed >>> 0;
  const rng = new Rng(seed ^ 0xa5a5a5);
  const nH = new Simplex2(seed);
  const nW = new Simplex2(seed + 11);
  const nM = new Simplex2(seed + 23);
  const nT = new Simplex2(seed + 37);
  const nR = new Simplex2(seed + 51);
  const nL = new Simplex2(seed + 67);

  const size = N * N;
  const biome = new Uint8Array(size);
  const heightArr = new Uint8Array(size);
  const hRaw = new Float32Array(size);
  const res = new Uint8Array(size);
  const amt = new Float32Array(size);
  const deco = new Uint8Array(size);
  const fog = new Uint8Array(size);

  const c = N / 2;
  // --- height field -------------------------------------------------------
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const wx = x + nW.fbm(x / 60, y / 60, 3) * 26;
      const wy = y + nW.fbm(x / 60 + 40, y / 60 + 40, 3) * 26;
      const dx = (wx - c) / (N * 0.5);
      const dy = (wy - c) / (N * 0.5);
      const d = Math.sqrt(dx * dx + dy * dy);
      const mask = 1 - smoothstep(0.5, 1.0, d);
      const e = nH.fbm(x / 64, y / 64, 5) * 0.5 + 0.5;
      const h = mask * (0.55 + 0.55 * e) - 0.28 + (e - 0.5) * 0.35;
      hRaw[y * N + x] = h;
    }
  }

  // --- biomes -------------------------------------------------------------
  // Height thresholds by quantiles of land tiles → stable biome mix across seeds.
  const landH: number[] = [];
  for (let i = 0; i < size; i += 3) if (hRaw[i] >= 0.115) landH.push(hRaw[i]);
  landH.sort((a, b) => a - b);
  const q = (p: number) => landH[Math.min(landH.length - 1, Math.floor(landH.length * p))] ?? 1;
  const qHills = q(0.72), qMount = q(0.84), qSnow = q(0.95), qSwamp = q(0.25);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const h = hRaw[i];
      heightArr[i] = Math.max(0, Math.min(255, Math.round((h + 0.3) * 200)));
      if (h < -0.02) {
        biome[i] = Biome.Deep;
        continue;
      }
      if (h < 0.08) {
        biome[i] = Biome.Sea;
        continue;
      }
      if (h < 0.115) {
        biome[i] = Biome.Beach;
        continue;
      }
      const m = nM.fbm(x / 55, y / 55, 4);
      // "north" = top of the screen = small x+y → colder
      const t = (x + y) / (2 * N) + nT.fbm(x / 80, y / 80, 3) * 0.25;
      const ridge = 1 - Math.abs(nR.fbm(x / 38, y / 38, 4));
      let b: Biome;
      if (h > qMount && ridge > 0.55) b = h > qSnow || t < 0.4 ? Biome.Snow : Biome.Mountain;
      else if (h > qHills) b = t < 0.32 ? Biome.Tundra : Biome.Hills;
      else if (t > 0.7 && m < 0.18) b = Biome.Desert;
      else if (t < 0.3 && m < 0.2) b = Biome.Tundra;
      else if (m > 0.28 && h < qSwamp) b = Biome.Swamp;
      else if (m > 0.0) b = Biome.Forest;
      else if (m > -0.25) b = Biome.Meadow;
      else b = Biome.Plains;
      // lakes
      if (h > qSwamp * 0.9 && h < qHills && nL.fbm(x / 22, y / 22, 3) > 0.45) b = Biome.Lake;
      biome[i] = b;
    }
  }

  // --- rivers: downhill walks from high ground -----------------------------
  const riverStarts: { x: number; y: number }[] = [];
  for (let tries = 0; tries < 400 && riverStarts.length < 4; tries++) {
    const x = rng.int(20, N - 20);
    const y = rng.int(20, N - 20);
    const i = y * N + x;
    if (hRaw[i] > qHills && !riverStarts.some((p) => Math.hypot(p.x - x, p.y - y) < 50)) riverStarts.push({ x, y });
  }
  for (const s of riverStarts) {
    let x = s.x, y = s.y;
    for (let step = 0; step < 260; step++) {
      const i = y * N + x;
      if (isWater(biome[i]) && step > 3) break;
      biome[i] = Biome.Lake;
      if (step % 3 === 0 && x + 1 < N) biome[i + 1] = biome[i + 1] <= Biome.Lake ? biome[i + 1] : Biome.Lake;
      // pick the lowest neighbour with a bit of noise
      let best = -1, bx = x, by = y;
      for (let d = 0; d < 4; d++) {
        const nx = x + [0, 1, 0, -1][d];
        const ny = y + [-1, 0, 1, 0][d];
        if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1) continue;
        const score = -hRaw[ny * N + nx] + hash2(nx, ny, seed) * 0.05;
        if (best === -1 || score > best) {
          best = score;
          bx = nx;
          by = ny;
        }
      }
      hRaw[i] += 0.02; // avoid oscillation
      x = bx;
      y = by;
    }
  }

  // --- base location: land near the centre with clear space ------------------
  const base = findBase(biome, hRaw, N, rng);
  for (let y = base.y - 9; y <= base.y + 9; y++) {
    for (let x = base.x - 9; x <= base.x + 9; x++) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const i = y * N + x;
      const d = Math.hypot(x - base.x, y - base.y);
      if (d <= 8.5) biome[i] = d < 5 ? Biome.Meadow : biome[i] === Biome.Forest || isWater(biome[i]) || biome[i] === Biome.Swamp ? Biome.Meadow : biome[i];
    }
  }

  // --- special zones (volcanic red zone, purple crystal zone) ---------------
  const nests: { x: number; y: number }[] = [];
  const volcanic = pickFar(biome, hRaw, N, rng, base, 75, (b, h) => !isWater(b) && h > 0.3);
  if (volcanic) paintZone(biome, N, volcanic, 15, Biome.Volcanic, nW, rng);
  const crystal = pickFar(biome, hRaw, N, rng, base, 60, (b, h) => !isWater(b) && h > 0.25, volcanic ? [volcanic] : []);
  if (crystal) paintZone(biome, N, crystal, 10, Biome.Crystal, nW, rng);
  if (volcanic) {
    for (let k = 0; k < 5; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(2, 10);
      const nx = Math.round(volcanic.x + Math.cos(a) * r);
      const ny = Math.round(volcanic.y + Math.sin(a) * r);
      if (nx > 1 && ny > 1 && nx < N - 2 && ny < N - 2 && !isWater(biome[ny * N + nx])) nests.push({ x: nx, y: ny });
    }
  }

  // --- deposits -----------------------------------------------------------
  const deposits: Deposit[] = [];
  const placePatch = (r: ResourceId, cx: number, cy: number, radius: number, richness: number) => {
    let total = 0;
    for (let y = cy - radius - 1; y <= cy + radius + 1; y++) {
      for (let x = cx - radius - 1; x <= cx + radius + 1; x++) {
        if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) continue;
        const i = y * N + x;
        if (isWater(biome[i])) continue;
        const d = Math.hypot(x - cx, y - cy) / radius + (hash2(x, y, seed + 5) - 0.5) * 0.45;
        if (d > 1) continue;
        if (r === 'oil' && hash2(x, y, seed + 9) > 0.35) continue;
        const a = Math.round(richness * (1.15 - d * 0.6) * (0.8 + hash2(x, y, seed + 3) * 0.4));
        res[i] = RES_CODE[r];
        amt[i] = a;
        deco[i] = Deco.None;
        total += a;
      }
    }
    if (total > 0) deposits.push({ res: r, x: cx, y: cy, total });
  };

  const ringSpot = (minD: number, maxD: number, ok: (b: Biome) => boolean): { x: number; y: number } | null => {
    for (let t = 0; t < 600; t++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(minD, maxD);
      const x = Math.round(base.x + Math.cos(a) * d);
      const y = Math.round(base.y + Math.sin(a) * d);
      if (x < 4 || y < 4 || x >= N - 4 || y >= N - 4) continue;
      const i = y * N + x;
      if (!ok(biome[i]) || res[i]) continue;
      if (deposits.some((dp) => Math.hypot(dp.x - x, dp.y - y) < 9)) continue;
      return { x, y };
    }
    return null;
  };
  const land = (b: Biome) => !isWater(b) && b !== Biome.Volcanic;
  // guaranteed starter patches
  const starter: [ResourceId, number, number, number, number][] = [
    ['iron_ore', 11, 17, 4, 1400],
    ['copper_ore', 11, 17, 4, 1300],
    ['iron_ore', 16, 24, 4, 1600],
    ['copper_ore', 16, 24, 3, 1400],
    ['stone', 12, 20, 3, 1000],
    ['silicon_ore', 18, 30, 3, 1400],
    ['oil', 16, 28, 3, 60000],
  ];
  for (const [r, a, b, rad, rich] of starter) {
    const p = ringSpot(a, b, land);
    if (p) placePatch(r, p.x, p.y, rad, rich);
  }
  // wider island
  const wide: [ResourceId, number, (b: Biome) => boolean, number, number, number][] = [
    ['iron_ore', 6, (b) => b === Biome.Hills || b === Biome.Meadow || b === Biome.Tundra || b === Biome.Plains, 4, 2500, 30],
    ['copper_ore', 6, (b) => b === Biome.Hills || b === Biome.Forest || b === Biome.Meadow, 4, 2400, 30],
    ['stone', 4, (b) => b === Biome.Mountain || b === Biome.Hills || b === Biome.Plains, 4, 1800, 30],
    ['silicon_ore', 5, (b) => b === Biome.Desert || b === Biome.Mountain || b === Biome.Beach, 4, 2400, 30],
    ['oil', 4, (b) => b === Biome.Swamp || b === Biome.Desert, 3, 120000, 35],
    ['rare_earth', 4, (b) => b === Biome.Mountain || b === Biome.Crystal || b === Biome.Snow, 3, 1800, 40],
    ['uranium_ore', 3, (b) => b === Biome.Mountain || b === Biome.Snow, 3, 1600, 70],
  ];
  for (const [r, count, ok, rad, rich, minD] of wide) {
    for (let k = 0; k < count; k++) {
      const p = ringSpot(minD, N * 0.62, ok);
      if (p) placePatch(r, p.x, p.y, rad + rng.int(0, 2), rich);
    }
  }
  if (crystal) placePatch('rare_earth', crystal.x, crystal.y, 5, 3000);
  // ensure uranium exists
  if (!deposits.some((d) => d.res === 'uranium_ore')) {
    const p = ringSpot(55, N * 0.62, land);
    if (p) placePatch('uranium_ore', p.x, p.y, 3, 1600);
  }

  // --- decorations ----------------------------------------------------------
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (res[i]) continue;
      const r = hash2(x, y, seed + 77);
      const r2 = hash2(y, x, seed + 91);
      const b = biome[i];
      let d = Deco.None;
      switch (b) {
        case Biome.Forest: d = r < 0.62 ? (r2 < 0.45 ? Deco.Pine : r2 < 0.85 ? Deco.Pine2 : Deco.Oak) : r < 0.68 ? Deco.Bush : Deco.None; break;
        case Biome.Meadow: d = r < 0.05 ? Deco.Oak : r < 0.09 ? Deco.Bush : r < 0.1 ? Deco.Rock : Deco.None; break;
        case Biome.Plains: d = r < 0.05 ? Deco.Bush : r < 0.07 ? Deco.Rock : Deco.None; break;
        case Biome.Hills: d = r < 0.08 ? Deco.Pine : r < 0.16 ? Deco.Rock : Deco.None; break;
        case Biome.Mountain: d = r < 0.22 ? Deco.Boulder : r < 0.36 ? Deco.Rock : r < 0.4 ? Deco.Pine2 : Deco.None; break;
        case Biome.Snow: d = r < 0.14 ? Deco.SnowPine : r < 0.3 ? Deco.Boulder : Deco.None; break;
        case Biome.Tundra: d = r < 0.14 ? Deco.SnowPine : r < 0.18 ? Deco.Rock : Deco.None; break;
        case Biome.Desert: d = r < 0.03 ? Deco.Cactus : r < 0.07 ? Deco.Rock : Deco.None; break;
        case Biome.Swamp: d = r < 0.22 ? Deco.Reed : r < 0.34 ? Deco.Oak : Deco.None; break;
        case Biome.Volcanic: d = r < 0.08 ? Deco.Lava : r < 0.2 ? Deco.Rock : Deco.None; break;
        case Biome.Crystal: d = r < 0.18 ? Deco.Crystal : r < 0.26 ? Deco.Rock : Deco.None; break;
        case Biome.Beach: d = r < 0.02 ? Deco.Rock : Deco.None; break;
      }
      deco[i] = d;
    }
  }
  // clear the base plaza
  for (let y = base.y - 7; y <= base.y + 7; y++) for (let x = base.x - 7; x <= base.x + 7; x++) if (x >= 0 && y >= 0 && x < N && y < N) deco[y * N + x] = Deco.None;

  // --- points of interest ---------------------------------------------------
  const pois: Poi[] = [];
  const kinds: PoiKind[] = ['ruins', 'ruins', 'ruins', 'drone', 'drone', 'cache', 'cache', 'cache', 'anomaly', 'anomaly', 'ruins', 'cache', 'anomaly', 'ruins'];
  for (let k = 0; k < kinds.length; k++) {
    for (let t = 0; t < 300; t++) {
      const x = rng.int(8, N - 8);
      const y = rng.int(8, N - 8);
      const i = y * N + x;
      if (isWater(biome[i]) || res[i]) continue;
      const dBase = Math.hypot(x - base.x, y - base.y);
      if (dBase < 24) continue;
      if (pois.some((p) => Math.hypot(p.x - x, p.y - y) < 18)) continue;
      pois.push({ id: k + 1, x, y, kind: kinds[k], explored: false });
      deco[i] = Deco.None;
      break;
    }
  }

  const world = new World({ w: N, h: N, seed, biome, height: heightArr, res, amt, deco, fog, pois, deposits, base, nests });
  world.reveal(base.x + 0.5, base.y + 0.5, 22);
  return world;
}

function findBase(biome: Uint8Array, h: Float32Array, N: number, rng: Rng): { x: number; y: number } {
  const c = N / 2;
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  for (let t = 0; t < 2500; t++) {
    const x = Math.round(c + rng.range(-40, 40));
    const y = Math.round(c + rng.range(-40, 40));
    let landCount = 0;
    let waterNear = 0;
    for (let yy = y - 8; yy <= y + 8; yy += 2) {
      for (let xx = x - 8; xx <= x + 8; xx += 2) {
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        const b = biome[yy * N + xx];
        if (isWater(b)) waterNear++;
        else if (b === Biome.Meadow || b === Biome.Plains || b === Biome.Forest || b === Biome.Hills) landCount++;
      }
    }
    const i = y * N + x;
    if (isWater(biome[i])) continue;
    const score = landCount * 2 - waterNear * 6 - Math.hypot(x - c, y - c) * 0.5 - Math.abs(h[i] - 0.25) * 20;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best ?? { x: c, y: c };
}

function pickFar(
  biome: Uint8Array, h: Float32Array, N: number, rng: Rng, base: { x: number; y: number }, minDist: number,
  ok: (b: Biome, h: number) => boolean, avoid: { x: number; y: number }[] = [],
): { x: number; y: number } | null {
  for (let t = 0; t < 3000; t++) {
    const x = rng.int(20, N - 20);
    const y = rng.int(20, N - 20);
    const i = y * N + x;
    if (!ok(biome[i], h[i])) continue;
    if (Math.hypot(x - base.x, y - base.y) < minDist) continue;
    if (avoid.some((a) => Math.hypot(a.x - x, a.y - y) < 45)) continue;
    return { x, y };
  }
  return null;
}

function paintZone(biome: Uint8Array, N: number, p: { x: number; y: number }, r: number, b: Biome, n: Simplex2, rng: Rng): void {
  const off = rng.range(0, 100);
  for (let y = p.y - r - 4; y <= p.y + r + 4; y++) {
    for (let x = p.x - r - 4; x <= p.x + r + 4; x++) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const i = y * N + x;
      if (isWater(biome[i])) continue;
      const d = Math.hypot(x - p.x, y - p.y) + n.noise(x / 6 + off, y / 6) * 4;
      if (d < r) biome[i] = b;
    }
  }
}
