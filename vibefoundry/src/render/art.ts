import { Graphics } from 'pixi.js';
import { shade, mix, PAL } from './color';

/** Iso point in "building space": origin = top vertex of the footprint, units = tiles, z in px. */
export function P(tx: number, ty: number, z = 0): [number, number] {
  return [(tx - ty) * 32, (tx + ty) * 16 - z];
}

export function poly(g: Graphics, pts: [number, number][], color: number, alpha = 1): void {
  const flat: number[] = [];
  for (const p of pts) flat.push(p[0], p[1]);
  g.poly(flat).fill({ color, alpha });
}

export function polyStroke(g: Graphics, pts: [number, number][], color: number, width = 1, alpha = 1): void {
  const flat: number[] = [];
  for (const p of pts) flat.push(p[0], p[1]);
  g.poly(flat).stroke({ color, width, alpha });
}

export interface BoxColors {
  top: number;
  left: number;
  right: number;
}

export function boxColors(c: number, topLift = 0.18, rightDrop = 0.3): BoxColors {
  return { top: shade(c, topLift), left: c, right: shade(c, -rightDrop) };
}

/** Iso prism: footprint (tx,ty,tw,th) from z0 to z1. Only visible faces are drawn. */
export function box(g: Graphics, tx: number, ty: number, tw: number, th: number, z0: number, z1: number, c: BoxColors | number): void {
  const col = typeof c === 'number' ? boxColors(c) : c;
  // left (south-west) face: edge y = ty+th
  poly(g, [P(tx, ty + th, z1), P(tx + tw, ty + th, z1), P(tx + tw, ty + th, z0), P(tx, ty + th, z0)], col.left);
  // right (south-east) face: edge x = tx+tw
  poly(g, [P(tx + tw, ty, z1), P(tx + tw, ty + th, z1), P(tx + tw, ty + th, z0), P(tx + tw, ty, z0)], col.right);
  poly(g, [P(tx, ty, z1), P(tx + tw, ty, z1), P(tx + tw, ty + th, z1), P(tx, ty + th, z1)], col.top);
}

/** Thin outline of the top face (panel seams). */
export function topEdge(g: Graphics, tx: number, ty: number, tw: number, th: number, z: number, color: number, alpha = 0.5): void {
  polyStroke(g, [P(tx, ty, z), P(tx + tw, ty, z), P(tx + tw, ty + th, z), P(tx, ty + th, z)], color, 1, alpha);
}

/** Vertical cylinder centred at tile (cx, cy) with pixel radius r. */
export function cyl(g: Graphics, cx: number, cy: number, r: number, z0: number, z1: number, color: number, topColor?: number): void {
  const [x, y0] = P(cx, cy, z0);
  const [, y1] = P(cx, cy, z1);
  const ry = r * 0.5;
  // body: left half lighter, right half darker
  g.rect(x - r, y1, r, y0 - y1).fill(color);
  g.rect(x, y1, r, y0 - y1).fill(shade(color, -0.28));
  g.ellipse(x, y0, r, ry).fill(shade(color, -0.12));
  g.rect(x - r, y1, r * 2, y0 - y1).fill({ color: 0x000000, alpha: 0 });
  g.ellipse(x - r * 0.35, y1 + (y0 - y1) * 0.5, r * 0.18, (y0 - y1) * 0.45).fill({ color: 0xffffff, alpha: 0.07 });
  g.ellipse(x, y1, r, ry).fill(topColor ?? shade(color, 0.2));
}

/** Tapered cooling tower. */
export function tower(g: Graphics, cx: number, cy: number, rBot: number, rTop: number, z0: number, z1: number, color: number): void {
  const [x, y0] = P(cx, cy, z0);
  const [, y1] = P(cx, cy, z1);
  const mid = (y0 + y1) / 2;
  const rMid = Math.min(rBot, rTop) * 0.92;
  g.poly([x - rBot, y0, x - rMid, mid, x - rTop, y1, x, y1, x, y0]).fill(color);
  g.poly([x, y0, x, y1, x + rTop, y1, x + rMid, mid, x + rBot, y0]).fill(shade(color, -0.25));
  g.ellipse(x, y0, rBot, rBot * 0.5).fill(shade(color, -0.1));
  g.ellipse(x, y1, rTop, rTop * 0.5).fill(shade(color, -0.45));
  g.ellipse(x, y1, rTop, rTop * 0.5).stroke({ color: shade(color, 0.25), width: 1.5 });
}

/** Parallelogram window on the left face (edge y = ty+th) from u0..u1 along x, v0..v1 in z. */
export function leftPanel(g: Graphics, tx: number, ty: number, tw: number, th: number, u0: number, u1: number, z0: number, z1: number, color: number, alpha = 1): void {
  const y = ty + th;
  poly(g, [P(tx + tw * u0, y, z1), P(tx + tw * u1, y, z1), P(tx + tw * u1, y, z0), P(tx + tw * u0, y, z0)], color, alpha);
}
export function rightPanel(g: Graphics, tx: number, ty: number, tw: number, th: number, u0: number, u1: number, z0: number, z1: number, color: number, alpha = 1): void {
  const x = tx + tw;
  poly(g, [P(x, ty + th * u0, z1), P(x, ty + th * u1, z1), P(x, ty + th * u1, z0), P(x, ty + th * u0, z0)], color, alpha);
}

/** Row of windows on both visible faces. */
export function windows(g: Graphics, tx: number, ty: number, tw: number, th: number, z0: number, z1: number, n: number, color: number, alpha = 1, fill = 0.55): void {
  for (let i = 0; i < n; i++) {
    const a = (i + (1 - fill) / 2) / n;
    const b = (i + (1 + fill) / 2) / n;
    leftPanel(g, tx, ty, tw, th, a, b, z0, z1, color, alpha);
    rightPanel(g, tx, ty, tw, th, a, b, z0, z1, color, alpha);
  }
}

/** Soft radial glow (for the lights layer). */
export function glow(g: Graphics, x: number, y: number, r: number, color: number, alpha = 0.35): void {
  for (let i = 4; i >= 1; i--) g.circle(x, y, (r * i) / 4).fill({ color, alpha: (alpha * (5 - i)) / 10 });
}

export function hazardStripes(g: Graphics, tx: number, ty: number, tw: number, th: number, z0: number, z1: number): void {
  const n = 6;
  for (let i = 0; i < n; i += 2) leftPanel(g, tx, ty, tw, th, i / n, (i + 1) / n, z0, z1, PAL.hazard);
  for (let i = 0; i < n; i += 2) rightPanel(g, tx, ty, tw, th, i / n, (i + 1) / n, z0, z1, shade(PAL.hazard, -0.25));
}

export { shade, mix, PAL };
