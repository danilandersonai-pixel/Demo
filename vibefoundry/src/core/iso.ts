/** Isometric 2:1 projection helpers. World tile (x, y) → screen pixels at zoom 1. */
export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

/** Grid directions: 0 = North (-y), 1 = East (+x), 2 = South (+y), 3 = West (-x). */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;
export const DIR_NAMES = ['север', 'восток', 'юг', 'запад'] as const;

export function rotCW(d: Dir): Dir {
  return ((d + 1) & 3) as Dir;
}
export function opposite(d: Dir): Dir {
  return ((d + 2) & 3) as Dir;
}

/** Tile-space point → screen-space point (top vertex of tile (0,0) at origin). */
export function toScreenX(x: number, y: number): number {
  return (x - y) * HALF_W;
}
export function toScreenY(x: number, y: number): number {
  return (x + y) * HALF_H;
}

/** Screen → fractional tile coordinates. */
export function toTile(sx: number, sy: number): { x: number; y: number } {
  const a = sx / HALF_W;
  const b = sy / HALF_H;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Depth key for painter's ordering of an object whose front-most tile corner is (x, y). */
export function depthOf(x: number, y: number): number {
  return x + y;
}
