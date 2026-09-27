/**
 * Production statistics: produced/consumed per key with three ring buffers
 * (60 × 1 s, 60 × 10 s, 60 × 60 s). Keys are item ids or AI resource names.
 */
export interface SeriesData {
  p: number[];
  c: number[];
}

export interface StatsData {
  keys: string[];
  cur: SeriesData[];
  s1: SeriesData[];
  s10: SeriesData[];
  s60: SeriesData[];
  head1: number;
  head10: number;
  head60: number;
  seconds: number;
  totalProduced: Record<string, number>;
}

const LEN = 60;

export class Stats {
  keys: string[] = [];
  index = new Map<string, number>();
  cur: Float64Array[] = []; // [produced, consumed] this second
  s1: { p: Float64Array; c: Float64Array }[] = [];
  s10: { p: Float64Array; c: Float64Array }[] = [];
  s60: { p: Float64Array; c: Float64Array }[] = [];
  acc10: Float64Array[] = [];
  acc60: Float64Array[] = [];
  head1 = 0;
  head10 = 0;
  head60 = 0;
  seconds = 0;
  totalProduced: Record<string, number> = {};

  key(k: string): number {
    let i = this.index.get(k);
    if (i === undefined) {
      i = this.keys.length;
      this.keys.push(k);
      this.index.set(k, i);
      this.cur.push(new Float64Array(2));
      this.acc10.push(new Float64Array(2));
      this.acc60.push(new Float64Array(2));
      this.s1.push({ p: new Float64Array(LEN), c: new Float64Array(LEN) });
      this.s10.push({ p: new Float64Array(LEN), c: new Float64Array(LEN) });
      this.s60.push({ p: new Float64Array(LEN), c: new Float64Array(LEN) });
    }
    return i;
  }

  produce(k: string, n: number): void {
    this.cur[this.key(k)][0] += n;
    this.totalProduced[k] = (this.totalProduced[k] ?? 0) + n;
  }

  consume(k: string, n: number): void {
    this.cur[this.key(k)][1] += n;
  }

  /** Called once per simulated second. */
  roll(): void {
    this.seconds++;
    for (let i = 0; i < this.keys.length; i++) {
      const c = this.cur[i];
      this.s1[i].p[this.head1] = c[0];
      this.s1[i].c[this.head1] = c[1];
      this.acc10[i][0] += c[0];
      this.acc10[i][1] += c[1];
      c[0] = 0;
      c[1] = 0;
    }
    this.head1 = (this.head1 + 1) % LEN;
    if (this.seconds % 10 === 0) {
      for (let i = 0; i < this.keys.length; i++) {
        const a = this.acc10[i];
        this.s10[i].p[this.head10] = a[0];
        this.s10[i].c[this.head10] = a[1];
        this.acc60[i][0] += a[0];
        this.acc60[i][1] += a[1];
        a[0] = 0;
        a[1] = 0;
      }
      this.head10 = (this.head10 + 1) % LEN;
    }
    if (this.seconds % 60 === 0) {
      for (let i = 0; i < this.keys.length; i++) {
        const a = this.acc60[i];
        this.s60[i].p[this.head60] = a[0];
        this.s60[i].c[this.head60] = a[1];
        a[0] = 0;
        a[1] = 0;
      }
      this.head60 = (this.head60 + 1) % LEN;
    }
  }

  /** Produced per minute over the last `window` seconds (≤ 60), extrapolated when the game is younger. */
  rate(k: string, window = 60): number {
    const i = this.index.get(k);
    if (i === undefined) return 0;
    const n = Math.min(window, LEN, Math.max(1, this.seconds));
    let s = 0;
    for (let j = 1; j <= n; j++) s += this.s1[i].p[(this.head1 - j + LEN * 2) % LEN];
    return (s / n) * 60;
  }

  consumeRate(k: string, window = 60): number {
    const i = this.index.get(k);
    if (i === undefined) return 0;
    const n = Math.min(window, LEN, Math.max(1, this.seconds));
    let s = 0;
    for (let j = 1; j <= n; j++) s += this.s1[i].c[(this.head1 - j + LEN * 2) % LEN];
    return (s / n) * 60;
  }

  /** Series for charts, oldest → newest. scale: 1 = 1 min (1 s buckets), 10 = 10 min, 60 = 1 h. */
  series(k: string, scale: 1 | 10 | 60): { p: number[]; c: number[] } {
    const i = this.index.get(k);
    const p: number[] = [];
    const c: number[] = [];
    if (i === undefined) return { p: new Array(LEN).fill(0), c: new Array(LEN).fill(0) };
    const ring = scale === 1 ? this.s1[i] : scale === 10 ? this.s10[i] : this.s60[i];
    const head = scale === 1 ? this.head1 : scale === 10 ? this.head10 : this.head60;
    for (let j = 0; j < LEN; j++) {
      const idx = (head + j) % LEN;
      p.push(ring.p[idx]);
      c.push(ring.c[idx]);
    }
    return { p, c };
  }

  toData(): StatsData {
    const conv = (arr: { p: Float64Array; c: Float64Array }[]) => arr.map((s) => ({ p: Array.from(s.p), c: Array.from(s.c) }));
    return {
      keys: this.keys.slice(),
      cur: this.cur.map((c) => ({ p: [c[0]], c: [c[1]] })),
      s1: conv(this.s1),
      s10: conv(this.s10),
      s60: conv(this.s60),
      head1: this.head1,
      head10: this.head10,
      head60: this.head60,
      seconds: this.seconds,
      totalProduced: { ...this.totalProduced },
    };
  }

  static fromData(d: StatsData): Stats {
    const s = new Stats();
    d.keys.forEach((k, i) => {
      s.key(k);
      s.cur[i][0] = d.cur[i].p[0];
      s.cur[i][1] = d.cur[i].c[0];
      s.s1[i].p.set(d.s1[i].p);
      s.s1[i].c.set(d.s1[i].c);
      s.s10[i].p.set(d.s10[i].p);
      s.s10[i].c.set(d.s10[i].c);
      s.s60[i].p.set(d.s60[i].p);
      s.s60[i].c.set(d.s60[i].c);
    });
    s.head1 = d.head1;
    s.head10 = d.head10;
    s.head60 = d.head60;
    s.seconds = d.seconds;
    s.totalProduced = { ...d.totalProduced };
    return s;
  }
}
