/** Small colour helpers for procedural art (0xRRGGBB numbers). */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
export function shade(c: number, f: number): number {
  return f >= 0 ? mix(c, 0xffffff, f) : mix(c, 0x000000, -f);
}
export function jitter(c: number, r: number, amt: number): number {
  return shade(c, (r - 0.5) * 2 * amt);
}
export function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

export const PAL = {
  bg: 0x000c19,
  metal: 0x2a3440,
  metalDark: 0x1c242e,
  metalLight: 0x4a5663,
  concrete: 0x5a5f63,
  concreteLight: 0x7a7f82,
  rust: 0x8c5a34,
  glass: 0x10394f,
  copper: 0xd37c4f,
  cyan: 0x32c6f4,
  cyanSoft: 0x66d8ff,
  teal: 0x33c0a7,
  amber: 0xedbb5a,
  red: 0xed5347,
  violet: 0x9096db,
  hazard: 0xd9a227,
  white: 0xe8eef2,
  green: 0x6fdc5a,
};
