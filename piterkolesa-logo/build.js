// Parametric generator for the PITERKOLESA logo -> clean SVG (paths/circles only)
const fs = require('fs');

const BLACK = '#111111';
const ORANGE = '#F26522';

// ---------- helpers ----------
const fmt = n => (Math.round(n * 100) / 100);
const P = (x, y) => [x, y];
function pth(pts, close = true) {
  return 'M' + pts.map(p => `${fmt(p[0])} ${fmt(p[1])}`).join(' L') + (close ? ' Z' : '');
}
function rect(x1, x2, yTop, yBot) { return [P(x1, yTop), P(x2, yTop), P(x2, yBot), P(x1, yBot)]; }
function rev(p) { return p.slice().reverse(); }
function bar(p0, p1, w) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy);
  const nx = -dy / L * (w / 2), ny = dx / L * (w / 2);
  return [P(p0[0] + nx, p0[1] + ny), P(p1[0] + nx, p1[1] + ny), P(p1[0] - nx, p1[1] - ny), P(p0[0] - nx, p0[1] - ny)];
}
function signedArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; }
// chamfer convex corners of a closed polygon by amount c
function chamfer(pts, c) {
  if (!c) return pts;
  const ccw = signedArea(pts) > 0;
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], d = pts[(i + 1) % n];
    const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [d[0] - b[0], d[1] - b[1]];
    const cross = v1[0] * v2[1] - v1[1] * v2[0];
    const convex = ccw ? cross > 0 : cross < 0;
    const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
    if (convex && Math.abs(cross) > 1e-6 && l1 > 1 && l2 > 1) {
      const cc = Math.min(c, l1 * 0.46, l2 * 0.46);
      out.push([b[0] - v1[0] / l1 * cc, b[1] - v1[1] / l1 * cc]);
      out.push([b[0] + v2[0] / l2 * cc, b[1] + v2[1] / l2 * cc]);
    } else out.push(b);
  }
  return out;
}
const rad = d => d * Math.PI / 180;
function arcPathStroke(cx, cy, r, a0, a1) {
  const x0 = cx + r * Math.cos(rad(a0)), y0 = cy + r * Math.sin(rad(a0));
  const x1 = cx + r * Math.cos(rad(a1)), y1 = cy + r * Math.sin(rad(a1));
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0, sweep = a1 > a0 ? 1 : 0;
  return `M${fmt(x0)} ${fmt(y0)} A${r} ${r} 0 ${large} ${sweep} ${fmt(x1)} ${fmt(y1)}`;
}
function circlePath(cx, cy, r, sweep) {
  return `M${fmt(cx - r)} ${fmt(cy)} A${r} ${r} 0 1 ${sweep} ${fmt(cx + r)} ${fmt(cy)} A${r} ${r} 0 1 ${sweep} ${fmt(cx - r)} ${fmt(cy)} Z`;
}
function ellipsePath(cx, cy, rx, ry, sweep) {
  return `M${fmt(cx - rx)} ${fmt(cy)} A${rx} ${ry} 0 1 ${sweep} ${fmt(cx + rx)} ${fmt(cy)} A${rx} ${ry} 0 1 ${sweep} ${fmt(cx - rx)} ${fmt(cy)} Z`;
}

// =================================================================
// WHEEL
// =================================================================
function wheel() {
  const cx = 210, cy = 220;
  let out = [];
  // slash gap centers (deg, y-down) where the diagonal cuts the tire
  const g1 = 131, g2 = 311, gh = 7; // bottom-left & top-right gaps, half-width
  // tire body: two thick black arcs leaving diagonal gaps
  const bodyR = 150, bodyW = 56;
  out.push(`<path d="${arcPathStroke(cx, cy, bodyR, g2 + gh - 360, g1 - gh)}" fill="none" stroke="${BLACK}" stroke-width="${bodyW}"/>`);
  out.push(`<path d="${arcPathStroke(cx, cy, bodyR, g1 + gh, g2 - gh)}" fill="none" stroke="${BLACK}" stroke-width="${bodyW}"/>`);
  // tread: dashed outer ring, same two gaps
  const treadR = 182, treadW = 20;
  out.push(`<path d="${arcPathStroke(cx, cy, treadR, g2 + gh - 360, g1 - gh)}" fill="none" stroke="${BLACK}" stroke-width="${treadW}" stroke-dasharray="11 8"/>`);
  out.push(`<path d="${arcPathStroke(cx, cy, treadR, g1 + gh, g2 - gh)}" fill="none" stroke="${BLACK}" stroke-width="${treadW}" stroke-dasharray="11 8"/>`);
  // orange inner ring arc (C, opens toward upper-right / the slash)
  out.push(`<path d="${arcPathStroke(cx, cy, 102, 205, -25)}" fill="none" stroke="${ORANGE}" stroke-width="23"/>`);
  // five spokes (thicker, tapered)
  const spokes = [];
  const spokeRot = -90;
  for (let i = 0; i < 5; i++) {
    const ang = spokeRot + i * 72, r = rad(ang);
    const dx = Math.cos(r), dy = Math.sin(r), px = -dy, py = dx;
    const hx = cx + 30 * dx, hy = cy + 30 * dy, rx = cx + 112 * dx, ry = cy + 112 * dy;
    const wH = 19, wR = 38;
    spokes.push(pth([
      P(hx + px * wH, hy + py * wH), P(rx + px * wR, ry + py * wR),
      P(rx - px * wR, ry - py * wR), P(hx - px * wH, hy - py * wH)]));
  }
  out.push(`<path d="${spokes.join(' ')}" fill="${BLACK}"/>`);
  // hub + center hole + 5 bolt holes (evenodd knockouts)
  let hub = circlePath(cx, cy, 44, 1) + ' ' + circlePath(cx, cy, 12, 0);
  for (let i = 0; i < 5; i++) {
    const ang = spokeRot + i * 72, r = rad(ang);
    hub += ' ' + circlePath(cx + 27 * Math.cos(r), cy + 27 * Math.sin(r), 6.5, 0);
  }
  out.push(`<path d="${hub}" fill="${BLACK}" fill-rule="evenodd"/>`);
  // diagonal orange slash on top (through the gaps, extends beyond tire)
  const s0 = P(cx + 158, cy - 174), s1 = P(cx - 150, cy + 176);
  out.push(`<path d="${pth(chamfer(bar(s0, s1, 14), 6))}" fill="${ORANGE}"/>`);
  return `<g id="wheel">\n  ${out.join('\n  ')}\n</g>`;
}

// =================================================================
// WORDMARK
// =================================================================
const baseY = 322, H = 200, capTop = baseY - H;
const s = 50, b = 46;
const M1 = baseY - H / 2 - b / 2, M2 = baseY - H / 2 + b / 2; // mid bar edges
const yMid = baseY - H / 2;
const slant = 12, K = Math.tan(rad(slant));
const C = 8; // chamfer size

// glyph -> {outline:[pts], holes:[[pts]], prims:[pts...], orange:[pts...]}
const G = {};
G.I = (x, w) => ({ outline: rect(x, x + w, capTop, baseY) });
G.P = (x, w) => {
  const bb = capTop + 0.55 * H;
  return {
    outline: [P(x, capTop), P(x + w, capTop), P(x + w, bb), P(x + s, bb), P(x + s, baseY), P(x, baseY)],
    holes: [rect(x + s, x + w - b, capTop + b, bb - b)],
  };
};
G.T = (x, w) => {
  const l = x + (w - s) / 2, rr = x + (w + s) / 2;
  return { outline: [P(x, capTop), P(x + w, capTop), P(x + w, capTop + b), P(rr, capTop + b), P(rr, baseY), P(l, baseY), P(l, capTop + b), P(x, capTop + b)] };
};
G.E = (x, w) => {
  const wm = x + w * 0.84;
  return { outline: [
    P(x, capTop), P(x + w, capTop), P(x + w, capTop + b), P(x + s, capTop + b),
    P(x + s, M1), P(wm, M1), P(wm, M2), P(x + s, M2),
    P(x + s, baseY - b), P(x + w, baseY - b), P(x + w, baseY), P(x, baseY)] };
};
G.L = (x, w) => ({ outline: [P(x, capTop), P(x + s, capTop), P(x + s, baseY - b), P(x + w, baseY - b), P(x + w, baseY), P(x, baseY)] });
G.R = (x, w) => {
  const bb = capTop + 0.5 * H, lw = s;
  return {
    outline: [
      P(x, capTop), P(x + w, capTop), P(x + w, bb), P(x + s, bb),
      P(x + w, baseY), P(x + w - lw, baseY), P(x + s, bb + lw), P(x + s, baseY), P(x, baseY)],
    holes: [rect(x + s, x + w - b, capTop + b, bb - b)],
  };
};
G.S = (x, w) => ({ outline: [
  P(x, capTop), P(x + w, capTop), P(x + w, capTop + b), P(x + s, capTop + b),
  P(x + s, M1), P(x + w, M1), P(x + w, baseY), P(x, baseY),
  P(x, baseY - b), P(x + w - s, baseY - b), P(x + w - s, M2), P(x, M2)] });
G.A = (x, w) => {
  const lw = s, cbY = baseY - 0.34 * H, ax = x + w / 2;
  return {
    prims: [
      bar(P(x + 4, baseY), P(ax - 7, capTop), lw),                   // left leg
      bar(P(x + w - 4, baseY), P(ax + 7, capTop), lw),               // right leg
      rect(x + w * 0.11, x + w * 0.89, cbY - b / 2, cbY + b / 2),    // crossbar
    ],
  };
};
G.K = (x, w) => {
  const j = P(x + s - 12, yMid);  // junction on stem
  return {
    prims: [
      rect(x, x + s, capTop, baseY),
      bar(j, P(x + w, capTop), s - 2),   // upper arm (black)
    ],
    orange: [ bar(j, P(x + w, baseY), s - 2) ], // lower leg (orange)
  };
};

function glyphO(x, w) {
  const cx = x + w / 2, cy = yMid, rxO = w / 2, ryO = H / 2, ring = 46;
  const rxI = rxO - ring, ryI = ryO - ring;
  let d = ellipsePath(cx, cy, rxO, ryO, 1) + ' ' + ellipsePath(cx, cy, rxI, ryI, 0);
  return {
    black: `<path d="${d}" fill="${BLACK}" fill-rule="evenodd"/>`,
    orange: `<path d="${arcPathStroke(cx, cy, rxI - 13, 140, 410)}" fill="none" stroke="${ORANGE}" stroke-width="16"/>`,
  };
}

// ---------- layout ----------
const word = [
  ['P', 128], ['I', 50], ['T', 120], ['E', 118], ['R', 138],
  ['K', 146], ['O', 168], ['L', 110], ['E', 118], ['S', 122], ['A', 150],
];
const tracking = 5;
let x = 452;
const blackEO = [];   // outlines (+counters) -> fill-rule evenodd
const blackNZ = [];   // overlapping primitive letters -> fill-rule nonzero
const orangeParts = [];
let oBlack = '', oOrange = '';
for (const [ch, w] of word) {
  if (ch === 'O') { const o = glyphO(x, w); oBlack = o.black; oOrange = o.orange; x += w + tracking; continue; }
  const g = G[ch](x, w);
  if (g.outline) {
    let d = pth(chamfer(g.outline, C));
    if (g.holes) for (const h of g.holes) d += ' ' + pth(chamfer(rev(h), Math.min(C, 12)));
    blackEO.push(d);
  }
  if (g.prims) blackNZ.push(g.prims.map(p => pth(chamfer(p, C))).join(' '));
  if (g.orange) orangeParts.push(g.orange.map(p => pth(chamfer(p, C))).join(' '));
  x += w + tracking;
}

const textGroup =
`<g id="word" transform="matrix(1 0 ${fmt(-K)} 1 ${fmt(baseY * K)} 0)">
  <path d="${blackEO.join(' ')}" fill="${BLACK}" fill-rule="evenodd"/>
  <path d="${blackNZ.join(' ')}" fill="${BLACK}"/>
  ${orangeParts.length ? `<path d="${orangeParts.join(' ')}" fill="${ORANGE}"/>` : ''}
  ${oBlack}
  ${oOrange}
</g>`;

const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="440" viewBox="0 0 2000 440" fill="none">
<title>PITERKOLESA</title>
${wheel()}
${textGroup}
</svg>
`;

fs.writeFileSync(__dirname + '/piterkolesa-logo.svg', svg);
console.log('wrote piterkolesa-logo.svg', svg.length, 'bytes; word end x=', fmt(x));
