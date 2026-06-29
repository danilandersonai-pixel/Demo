// Isometric (2:1) coordinate math. Grid (gx,gy) <-> screen (sx,sy).

export const TILE_W = 64;
export const TILE_H = 32;
export const HW = TILE_W / 2;
export const HH = TILE_H / 2;
export const WALL_H = 30; // pixel height of wall blocks

// Grid coords -> screen coords (before camera offset is applied).
export function gridToScreen(gx, gy) {
  return {
    x: (gx - gy) * HW,
    y: (gx + gy) * HH,
  };
}

// Screen coords (already camera-relative) -> fractional grid coords.
export function screenToGrid(sx, sy) {
  return {
    x: (sx / HW + sy / HH) / 2,
    y: (sy / HH - sx / HW) / 2,
  };
}

// Painter's-algorithm depth key: larger = nearer the camera (drawn later).
export function depth(gx, gy) { return gx + gy; }
