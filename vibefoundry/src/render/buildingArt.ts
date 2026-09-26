import type { Graphics } from 'pixi.js';
import type { BuildingType } from '../data/buildings';
import { P, box, boxColors, cyl, tower, windows, leftPanel, rightPanel, glow, hazardStripes, poly, topEdge, shade, PAL } from './art';

/**
 * Procedural building art. `g` = base (lit by the day/night tint), `L` = emissive layer (additive, glows at night).
 * Coordinates: building space (origin = footprint top vertex). Returns the max height in px for framing.
 */
export function drawBuilding(type: BuildingType, w: number, h: number, g: Graphics, L: Graphics): number {
  const M = PAL.metal;
  const C = PAL.concrete;
  switch (type) {
    case 'hq': {
      box(g, 0, 0, w, h, 0, 8, boxColors(C, 0.12, 0.3));
      topEdge(g, 0.2, 0.2, w - 0.4, h - 0.4, 8, 0x9aa3a8, 0.35);
      box(g, 0.5, 0.6, 4, 3.8, 8, 40, boxColors(M, 0.2, 0.35));
      windows(g, 0.5, 0.6, 4, 3.8, 18, 30, 6, 0x0d2a3c);
      windows(L, 0.5, 0.6, 4, 3.8, 18, 30, 6, PAL.cyan, 0.9);
      box(g, 0.9, 0.9, 1.6, 1.4, 40, 52, boxColors(0x3a4652));
      // drone pad
      const [px, py] = P(3.6, 1.6, 41);
      g.ellipse(px, py, 18, 9).fill(0x1a232d);
      g.ellipse(px, py, 18, 9).stroke({ color: PAL.amber, width: 1.5 });
      g.rect(px - 5, py - 4, 2, 8).fill(PAL.amber);
      g.rect(px + 3, py - 4, 2, 8).fill(PAL.amber);
      g.rect(px - 3, py - 1, 6, 2).fill(PAL.amber);
      glow(L, px, py, 22, PAL.amber, 0.25);
      // central tower
      cyl(g, 2.3, 2.4, 13, 40, 118, 0x2e3a47, 0x3e4b58);
      for (const z of [62, 84, 106]) {
        const [x, y] = P(2.3, 2.4, z);
        g.ellipse(x, y, 16, 8).stroke({ color: 0x0f5f86, width: 3 });
        L.ellipse(x, y, 16, 8).stroke({ color: PAL.cyan, width: 3 });
        glow(L, x, y, 26, PAL.cyan, 0.2);
      }
      const [ax, ay] = P(2.3, 2.4, 118);
      g.rect(ax - 1, ay - 36, 2, 36).fill(0x8a99a6);
      L.circle(ax, ay - 36, 3).fill(PAL.red);
      glow(L, ax, ay - 36, 12, PAL.red, 0.4);
      // amber side lamps
      for (const t of [0.8, 2.6, 4.2]) {
        const [x, y] = P(t, 4.7, 12);
        L.circle(x, y, 2).fill(PAL.amber);
        glow(L, x, y, 8, PAL.amber, 0.3);
      }
      return 160;
    }
    case 'storage': {
      box(g, 0.05, 0.05, 1.9, 1.9, 0, 4, boxColors(C));
      const cols = [0x8c5a34, 0x2f5f86, 0x9a7a2a, 0x3e6b4a];
      box(g, 0.15, 0.2, 0.8, 1.6, 4, 20, boxColors(cols[0]));
      box(g, 1.05, 0.2, 0.8, 1.6, 4, 20, boxColors(cols[1]));
      box(g, 0.2, 0.3, 1.6, 0.7, 20, 34, boxColors(cols[2]));
      for (let i = 1; i < 6; i++) leftPanel(g, 0.15, 0.2, 0.8, 1.6, i / 6, i / 6 + 0.03, 5, 19, shade(cols[0], -0.3));
      return 40;
    }
    case 'pole': {
      const [x, y] = P(0.5, 0.5, 0);
      g.ellipse(x, y, 5, 2.5).fill(0x3a342c);
      g.rect(x - 1.5, y - 44, 3, 44).fill(0x6a5a44);
      g.rect(x - 9, y - 42, 18, 2.5).fill(0x5a4a36);
      g.circle(x - 8, y - 43, 1.8).fill(0x9fb4c4);
      g.circle(x + 8, y - 43, 1.8).fill(0x9fb4c4);
      return 48;
    }
    case 'big_pole': {
      const [x, y] = P(0.5, 0.5, 0);
      g.poly([x - 9, y, x - 2, y - 70, x + 2, y - 70, x + 9, y]).stroke({ color: 0x8a99a6, width: 1.5 });
      for (let i = 1; i < 6; i++) g.rect(x - 9 + i * 1.2, y - i * 12, 18 - i * 2.4, 1.2).fill(0x8a99a6);
      g.rect(x - 14, y - 66, 28, 2).fill(0x8a99a6);
      L.circle(x, y - 72, 2).fill(PAL.red);
      return 76;
    }
    case 'drill': {
      box(g, 0.08, 0.08, 1.84, 1.84, 0, 12, boxColors(0x3a3f45));
      hazardStripes(g, 0.08, 0.08, 1.84, 1.84, 2, 6);
      box(g, 0.45, 0.45, 1.1, 1.1, 12, 22, boxColors(0x4a5560));
      // derrick frame
      const [bx, by] = P(1, 1, 22);
      const [, ty] = P(1, 1, 62);
      g.poly([bx - 16, by, bx, ty, bx + 16, by]).stroke({ color: PAL.hazard, width: 2.5 });
      g.moveTo(bx - 10, by - 14).lineTo(bx + 10, by - 14).stroke({ color: PAL.hazard, width: 2 });
      g.rect(bx - 3, ty, 6, by - ty).fill({ color: 0x2a2f35, alpha: 0.8 });
      g.circle(bx, by - 4, 5).fill(PAL.copper);
      L.circle(bx, ty + 2, 2).fill(PAL.amber);
      glow(L, bx, ty + 2, 9, PAL.amber, 0.35);
      return 66;
    }
    case 'pumpjack': {
      box(g, 0.1, 0.1, 1.8, 1.8, 0, 6, boxColors(C));
      box(g, 0.3, 0.8, 0.6, 0.6, 6, 22, boxColors(0x3a3f45));
      const [x0, y0] = P(0.6, 1.1, 22);
      const [x1, y1] = P(1.6, 0.6, 34);
      g.moveTo(x0 - 18, y0 - 4).lineTo(x1, y1).stroke({ color: PAL.hazard, width: 5 });
      g.moveTo(x0, y0 + 14).lineTo(x0, y0 - 8).stroke({ color: 0x5a6570, width: 3 });
      g.circle(x0, y0 - 6, 5).fill(0x2a2f35);
      g.poly([x1, y1 - 6, x1 + 9, y1 + 2, x1 + 2, y1 + 12]).fill(0x2a2f35);
      cyl(g, 1.45, 1.45, 7, 6, 18, 0x1a222d);
      L.circle(x0 - 18, y0 - 4, 2).fill(PAL.amber);
      return 50;
    }
    case 'smelter': {
      const brick = 0x7a4a36;
      box(g, 0.1, 0.1, 1.8, 1.8, 0, 26, boxColors(brick, 0.14, 0.32));
      for (let i = 1; i < 4; i++) leftPanel(g, 0.1, 0.1, 1.8, 1.8, 0, 1, 26 - i * 6.5, 26 - i * 6.5 + 0.8, shade(brick, -0.3));
      box(g, 0.25, 0.25, 1.5, 1.5, 26, 30, boxColors(0x3a3f45));
      // furnace mouth
      leftPanel(g, 0.1, 0.1, 1.8, 1.8, 0.3, 0.7, 4, 16, 0x2a1208);
      leftPanel(L, 0.1, 0.1, 1.8, 1.8, 0.33, 0.67, 5, 14, 0xff8a3a);
      const [mx, my] = P(1.0, 1.9, 10);
      glow(L, mx, my, 22, 0xff7a2a, 0.45);
      cyl(g, 1.35, 0.65, 6, 30, 64, 0x4a3a32, 0x201a18);
      const [cx, cy] = P(1.35, 0.65, 64);
      L.ellipse(cx, cy, 5, 2.5).fill({ color: 0xff8a3a, alpha: 0.6 });
      return 70;
    }
    case 'assembler':
    case 'assembler2': {
      const accent = type === 'assembler2' ? PAL.violet : PAL.cyan;
      const body = type === 'assembler2' ? 0x333a4a : M;
      box(g, 0.1, 0.1, w - 0.2, h - 0.2, 0, 6, boxColors(C));
      box(g, 0.25, 0.25, w - 0.5, h - 0.5, 6, type === 'assembler2' ? 44 : 36, boxColors(body, 0.22, 0.35));
      const zt = type === 'assembler2' ? 44 : 36;
      leftPanel(g, 0.25, 0.25, w - 0.5, h - 0.5, 0.08, 0.92, 12, 16, shade(accent, -0.55));
      rightPanel(g, 0.25, 0.25, w - 0.5, h - 0.5, 0.08, 0.92, 12, 16, shade(accent, -0.6));
      leftPanel(L, 0.25, 0.25, w - 0.5, h - 0.5, 0.08, 0.92, 12, 16, accent, 0.9);
      rightPanel(L, 0.25, 0.25, w - 0.5, h - 0.5, 0.08, 0.92, 12, 16, accent, 0.7);
      topEdge(g, 0.5, 0.5, w - 1, h - 1, zt, 0x7a8894, 0.4);
      // roof gear emblem
      const [gx, gy] = P(w / 2, h / 2, zt);
      g.ellipse(gx, gy, 16, 8).fill(0x5a6570);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.ellipse(gx + Math.cos(a) * 17, gy + Math.sin(a) * 8.5, 3, 1.8).fill(0x5a6570);
      }
      g.ellipse(gx, gy, 6, 3).fill(0x2a3440);
      box(g, 0.4, 0.4, 0.6, 0.6, zt, zt + 12, boxColors(0x4a5560));
      glow(L, gx, gy + 20, 30, accent, 0.18);
      return zt + 20;
    }
    case 'chem': {
      box(g, 0.1, 0.1, 2.8, 2.8, 0, 6, boxColors(C));
      box(g, 0.3, 1.5, 1.4, 1.2, 6, 26, boxColors(0x3c4a4a));
      windows(g, 0.3, 1.5, 1.4, 1.2, 12, 20, 3, 0x0f3a30);
      windows(L, 0.3, 1.5, 1.4, 1.2, 12, 20, 3, 0x5fe0b0, 0.9);
      cyl(g, 0.9, 0.8, 13, 6, 46, 0xd8dee2);
      cyl(g, 2.1, 0.8, 11, 6, 40, 0x9ec8c0);
      cyl(g, 2.2, 2.0, 10, 6, 34, 0xd8dee2);
      const [a1x, a1y] = P(0.9, 0.8, 30);
      const [a2x, a2y] = P(2.1, 0.8, 26);
      g.moveTo(a1x + 12, a1y).lineTo(a2x - 10, a2y).stroke({ color: 0x8a99a6, width: 3 });
      L.circle(a1x, a1y - 14, 2).fill(PAL.teal);
      glow(L, a2x, a2y, 18, PAL.teal, 0.2);
      return 56;
    }
    case 'lab': {
      box(g, 0.1, 0.1, 2.8, 2.8, 0, 10, boxColors(0x3a4652));
      windows(g, 0.1, 0.1, 2.8, 2.8, 3, 7, 5, 0x0d2a3c);
      windows(L, 0.1, 0.1, 2.8, 2.8, 3, 7, 5, PAL.cyan, 0.8);
      const [x, y] = P(1.5, 1.5, 10);
      g.ellipse(x, y, 40, 20).fill(0x243240);
      g.ellipse(x, y - 12, 32, 30).fill({ color: 0x1a4a66, alpha: 0.9 });
      g.ellipse(x - 10, y - 24, 10, 8).fill({ color: 0xffffff, alpha: 0.18 });
      g.ellipse(x, y - 12, 32, 30).stroke({ color: 0x66d8ff, width: 1.5, alpha: 0.7 });
      L.ellipse(x, y - 10, 18, 14).fill({ color: PAL.cyan, alpha: 0.35 });
      glow(L, x, y - 12, 38, PAL.cyan, 0.3);
      return 52;
    }
    case 'power_plant': {
      box(g, 0.1, 0.1, 2.8, 2.8, 0, 6, boxColors(C));
      box(g, 0.2, 1.6, 2.6, 1.2, 6, 28, boxColors(0x4a4440));
      windows(g, 0.2, 1.6, 2.6, 1.2, 12, 20, 5, 0x3a2a12);
      windows(L, 0.2, 1.6, 2.6, 1.2, 12, 20, 5, PAL.amber, 0.9);
      tower(g, 0.85, 0.8, 16, 11, 6, 52, 0xb8b4ae);
      tower(g, 2.1, 0.75, 15, 10, 6, 48, 0xa8a49e);
      return 56;
    }
    case 'solar': {
      box(g, 0.05, 0.05, 2.9, 2.9, 0, 2, boxColors(0x3a4046));
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const tx = 0.15 + i * 0.95;
          const ty = 0.15 + j * 0.95;
          poly(g, [P(tx, ty, 10), P(tx + 0.85, ty, 10), P(tx + 0.85, ty + 0.85, 4), P(tx, ty + 0.85, 4)], 0x163a6a);
          poly(g, [P(tx + 0.05, ty + 0.05, 9.6), P(tx + 0.4, ty + 0.05, 9.6), P(tx + 0.4, ty + 0.8, 4.3), P(tx + 0.05, ty + 0.8, 4.3)], 0x1e4a82);
          poly(L, [P(tx + 0.1, ty + 0.1, 9.4), P(tx + 0.3, ty + 0.1, 9.4), P(tx + 0.3, ty + 0.3, 8.2), P(tx + 0.1, ty + 0.3, 8.2)], 0x66d8ff, 0.35);
        }
      }
      return 16;
    }
    case 'accumulator': {
      box(g, 0.1, 0.1, 1.8, 1.8, 0, 4, boxColors(C));
      for (const [cx, cy] of [[0.55, 0.55], [1.45, 0.55], [0.55, 1.45], [1.45, 1.45]]) {
        cyl(g, cx, cy, 9, 4, 26, 0x3a4a56, 0x5a6a76);
        const [x, y] = P(cx, cy, 16);
        g.rect(x - 7, y, 4, 6).fill(0x163a2a);
        L.rect(x - 7, y, 4, 6).fill(0x5fe07a);
      }
      return 32;
    }
    case 'reactor': {
      box(g, 0.1, 0.1, 4.8, 4.8, 0, 8, boxColors(C, 0.1, 0.3));
      box(g, 0.4, 2.6, 2.2, 2.0, 8, 34, boxColors(0x5a6068));
      windows(L, 0.4, 2.6, 2.2, 2.0, 16, 24, 4, 0x9aff6a, 0.8);
      const [x, y] = P(1.8, 1.6, 8);
      g.ellipse(x, y, 44, 22).fill(0x6a7078);
      g.ellipse(x, y - 18, 40, 36).fill(0x8a9098);
      g.ellipse(x - 12, y - 32, 14, 10).fill({ color: 0xffffff, alpha: 0.15 });
      glow(L, x, y - 10, 50, 0x9aff6a, 0.18);
      tower(g, 3.8, 1.2, 22, 15, 8, 74, 0xb8b4ae);
      return 82;
    }
    case 'aicore': {
      box(g, 0.1, 0.1, 3.8, 3.8, 0, 8, boxColors(0x2a3440));
      box(g, 0.5, 0.5, 3.0, 3.0, 8, 40, boxColors(0x222c38, 0.25, 0.35));
      windows(g, 0.5, 0.5, 3, 3, 16, 32, 5, 0x0b3a3a);
      windows(L, 0.5, 0.5, 3, 3, 16, 32, 5, PAL.teal, 0.9, 0.3);
      const [x, y] = P(2, 2, 40);
      g.ellipse(x, y, 34, 17).fill(0x1a2430);
      g.ellipse(x, y, 34, 17).stroke({ color: PAL.teal, width: 2 });
      g.circle(x, y - 22, 17).fill(0x0e4a54);
      L.circle(x, y - 22, 15).fill({ color: 0x4fd8be, alpha: 0.95 });
      L.circle(x - 4, y - 26, 6).fill({ color: 0xffffff, alpha: 0.7 });
      glow(L, x, y - 22, 46, PAL.teal, 0.4);
      L.ellipse(x, y - 22, 28, 9).stroke({ color: PAL.cyan, width: 1.5, alpha: 0.9 });
      return 84;
    }
    case 'server': {
      box(g, 0.1, 0.1, 1.8, 1.8, 0, 6, boxColors(C));
      box(g, 0.3, 0.3, 1.4, 1.4, 6, 92, boxColors(0x1e2834, 0.25, 0.35));
      for (let i = 0; i < 4; i++) {
        const u = 0.12 + i * 0.22;
        leftPanel(g, 0.3, 0.3, 1.4, 1.4, u, u + 0.06, 14, 86, 0x0d3a56);
        rightPanel(g, 0.3, 0.3, 1.4, 1.4, u, u + 0.06, 14, 86, 0x0a2c44);
        leftPanel(L, 0.3, 0.3, 1.4, 1.4, u, u + 0.06, 14, 86, PAL.cyan, 0.95);
        rightPanel(L, 0.3, 0.3, 1.4, 1.4, u, u + 0.06, 14, 86, PAL.cyan, 0.7);
      }
      const [x, y] = P(1, 1, 92);
      L.circle(x, y - 2, 2).fill(PAL.red);
      glow(L, x, y + 30, 30, PAL.cyan, 0.2);
      return 100;
    }
    case 'datacenter': {
      box(g, 0.1, 0.1, 5.8, 5.8, 0, 6, boxColors(C, 0.1, 0.3));
      box(g, 0.3, 3.2, 5.4, 2.4, 6, 30, boxColors(0x222c38));
      box(g, 3.2, 0.3, 2.5, 2.8, 6, 44, boxColors(0x1e2834));
      box(g, 0.3, 0.3, 2.7, 2.7, 6, 22, boxColors(0x2a3440));
      windows(g, 0.3, 3.2, 5.4, 2.4, 12, 24, 10, 0x0d2a44);
      windows(L, 0.3, 3.2, 5.4, 2.4, 12, 24, 10, PAL.cyan, 0.95, 0.4);
      windows(L, 3.2, 0.3, 2.5, 2.8, 14, 38, 5, 0x4a8cff, 0.9, 0.3);
      for (const [cx, cy] of [[1.0, 1.0], [2.1, 1.1], [1.2, 2.2]]) {
        const [x, y] = P(cx, cy, 22);
        g.ellipse(x, y, 16, 8).fill(0x5a6570);
        g.ellipse(x, y - 5, 13, 11).fill(0xb8c4cc);
        g.ellipse(x - 4, y - 9, 4, 3).fill({ color: 0xffffff, alpha: 0.4 });
      }
      const [tx, ty] = P(4.5, 1.8, 44);
      cyl(g, 4.5, 1.8, 10, 44, 70, 0x2a3440);
      L.ellipse(tx, ty - 26, 12, 6).stroke({ color: PAL.cyan, width: 2 });
      glow(L, tx, ty - 10, 40, PAL.cyan, 0.22);
      return 80;
    }
    case 'inference': {
      box(g, 0.1, 0.1, 1.8, 1.8, 0, 6, boxColors(C));
      box(g, 0.3, 0.3, 1.4, 1.4, 6, 34, boxColors(0x2e2a24, 0.2, 0.35));
      const [x, y] = P(1, 1, 34);
      g.ellipse(x, y - 10, 13, 13).fill(0x5a4a1a);
      L.ellipse(x, y - 10, 11, 11).fill({ color: 0xecc871, alpha: 0.95 });
      L.rect(x - 3, y - 16, 6, 12).fill({ color: 0x8a6a1a, alpha: 0.8 });
      glow(L, x, y - 10, 30, 0xecc871, 0.35);
      leftPanel(L, 0.3, 0.3, 1.4, 1.4, 0.1, 0.9, 16, 19, 0xecc871, 0.7);
      return 56;
    }
    case 'datacollector': {
      box(g, 0.1, 0.1, 1.8, 1.8, 0, 16, boxColors(0x2a3a40));
      windows(L, 0.1, 0.1, 1.8, 1.8, 6, 10, 3, 0x2d9289, 1);
      const [x, y] = P(1, 1, 16);
      g.rect(x - 1.5, y - 20, 3, 20).fill(0x8a99a6);
      g.ellipse(x, y - 26, 16, 10).fill(0xd8dee2);
      g.ellipse(x + 2, y - 27, 11, 6).fill(0xa8b4bc);
      g.moveTo(x, y - 26).lineTo(x + 8, y - 40).stroke({ color: 0x8a99a6, width: 1.5 });
      L.circle(x + 8, y - 40, 2.5).fill(PAL.teal);
      glow(L, x + 8, y - 40, 12, PAL.teal, 0.4);
      return 48;
    }
    case 'training': {
      box(g, 0.1, 0.1, 3.8, 3.8, 0, 6, boxColors(C));
      for (let i = 0; i < 3; i++) {
        box(g, 0.4 + i * 1.1, 0.4, 0.8, 3.2, 6, 36, boxColors(0x1e2834));
        leftPanel(L, 0.4 + i * 1.1, 0.4, 0.8, 3.2, 0.15, 0.85, 12, 30, PAL.violet, 0.8);
        rightPanel(L, 0.4 + i * 1.1, 0.4, 0.8, 3.2, 0.05, 0.95, 14, 16, PAL.cyan, 0.8);
        rightPanel(L, 0.4 + i * 1.1, 0.4, 0.8, 3.2, 0.05, 0.95, 24, 26, PAL.cyan, 0.8);
      }
      const [x, y] = P(2, 2, 60);
      L.ellipse(x - 7, y, 13, 11).stroke({ color: 0xb0a8ff, width: 2 });
      L.ellipse(x + 7, y, 13, 11).stroke({ color: 0x66d8ff, width: 2 });
      L.moveTo(x - 14, y).lineTo(x + 14, y).stroke({ color: 0xb0a8ff, width: 1 });
      L.moveTo(x, y - 10).lineTo(x, y + 10).stroke({ color: 0x66d8ff, width: 1 });
      glow(L, x, y, 44, PAL.violet, 0.3);
      return 80;
    }
    case 'ci': {
      box(g, 0.1, 0.1, 1.8, 1.8, 0, 14, boxColors(0x2a3440));
      box(g, 0.3, 0.9, 1.4, 0.3, 14, 44, boxColors(0x1a222d));
      leftPanel(g, 0.3, 0.9, 1.4, 0.3, 0.08, 0.92, 20, 40, 0x0a2a1a);
      leftPanel(L, 0.3, 0.9, 1.4, 0.3, 0.08, 0.92, 20, 40, 0xffffff, 0.9);
      return 50;
    }
    case 'droneport': {
      box(g, 0.05, 0.05, 2.9, 2.9, 0, 6, boxColors(0x3a4046, 0.1, 0.3));
      const [x, y] = P(1.5, 1.5, 6);
      g.ellipse(x, y, 40, 20).fill(0x222a32);
      g.ellipse(x, y, 40, 20).stroke({ color: PAL.amber, width: 2 });
      g.rect(x - 9, y - 7, 3, 14).fill(PAL.white);
      g.rect(x + 6, y - 7, 3, 14).fill(PAL.white);
      g.rect(x - 6, y - 1.5, 12, 3).fill(PAL.white);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        L.circle(x + Math.cos(a) * 36, y + Math.sin(a) * 18, 2).fill(i % 2 ? PAL.cyan : PAL.amber);
      }
      glow(L, x, y, 44, PAL.cyan, 0.12);
      box(g, 2.3, 0.1, 0.6, 0.6, 6, 30, boxColors(0x2a3440));
      return 36;
    }
    case 'radar': {
      box(g, 0.2, 0.2, 1.6, 1.6, 0, 10, boxColors(0x3a4652));
      const [x, y] = P(1, 1, 10);
      g.rect(x - 2, y - 18, 4, 18).fill(0x8a99a6);
      g.ellipse(x, y - 26, 20, 12).fill(0xc8d0d6);
      g.ellipse(x + 3, y - 27, 14, 8).fill(0x8a99a6);
      L.circle(x, y - 26, 2).fill(PAL.cyan);
      return 42;
    }
    case 'turret': {
      box(g, 0.2, 0.2, 1.6, 1.6, 0, 8, boxColors(0x3a4046));
      hazardStripes(g, 0.2, 0.2, 1.6, 1.6, 2, 5);
      const [x, y] = P(1, 1, 8);
      g.ellipse(x, y - 8, 16, 11).fill(0x1a222d);
      g.rect(x - 2, y - 16, 22, 5).fill(0x2a3440);
      L.circle(x - 4, y - 10, 2.5).fill(PAL.red);
      glow(L, x - 4, y - 10, 10, PAL.red, 0.4);
      return 30;
    }
    case 'spire': {
      box(g, 0, 0, 5, 5, 0, 10, boxColors(0x2a3440, 0.12, 0.3));
      box(g, 0.6, 0.6, 3.8, 3.8, 10, 40, boxColors(0x222c38, 0.22, 0.35));
      windows(L, 0.6, 0.6, 3.8, 3.8, 18, 32, 8, PAL.cyan, 0.9, 0.4);
      box(g, 1.3, 1.3, 2.4, 2.4, 40, 120, boxColors(0x1e2834, 0.22, 0.35));
      for (let k = 0; k < 6; k++) windows(L, 1.3, 1.3, 2.4, 2.4, 48 + k * 12, 54 + k * 12, 4, k % 2 ? PAL.cyan : PAL.violet, 0.9, 0.35);
      box(g, 1.9, 1.9, 1.2, 1.2, 120, 220, boxColors(0x1a222d, 0.25, 0.35));
      leftPanel(L, 1.9, 1.9, 1.2, 1.2, 0.4, 0.6, 124, 216, PAL.cyan, 1);
      rightPanel(L, 1.9, 1.9, 1.2, 1.2, 0.4, 0.6, 124, 216, PAL.cyan, 0.8);
      for (const [z, r] of [[80, 46], [150, 34], [205, 24]] as const) {
        const [x, y] = P(2.5, 2.5, z);
        g.ellipse(x, y, r, r / 2).stroke({ color: 0x3a4a5a, width: 4 });
        L.ellipse(x, y, r, r / 2).stroke({ color: z === 150 ? PAL.violet : PAL.cyan, width: 3 });
        glow(L, x, y, r + 16, PAL.cyan, 0.16);
      }
      const [ax, ay] = P(2.5, 2.5, 220);
      g.rect(ax - 1.5, ay - 50, 3, 50).fill(0x8a99a6);
      L.circle(ax, ay - 50, 4).fill(0xffffff);
      glow(L, ax, ay - 50, 26, PAL.cyan, 0.5);
      return 280;
    }
    case 'pipe':
    case 'belt':
    case 'underground':
    case 'splitter':
    case 'inserter':
      return 20;
  }
  return 20;
}
