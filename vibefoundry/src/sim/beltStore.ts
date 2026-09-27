/**
 * Flat storage for items on belts: SLOTS items per belt tile, kept sorted by position
 * descending (index 0 = front-most, closest to the exit). No per-item objects.
 */
export const SLOTS = 4;
export const GAP = 0.25;

export interface BeltStoreData {
  cap: number;
  items: number[];
  pos: number[];
  cnt: number[];
  free: number[];
}

export class BeltStore {
  cap: number;
  items: Uint16Array;
  pos: Float32Array;
  cnt: Uint8Array;
  free: number[] = [];
  used = 0;

  constructor(cap = 256) {
    this.cap = cap;
    this.items = new Uint16Array(cap * SLOTS);
    this.pos = new Float32Array(cap * SLOTS);
    this.cnt = new Uint8Array(cap);
    for (let i = cap - 1; i >= 0; i--) this.free.push(i);
  }

  private grow(): void {
    const ncap = this.cap * 2;
    const items = new Uint16Array(ncap * SLOTS);
    items.set(this.items);
    const pos = new Float32Array(ncap * SLOTS);
    pos.set(this.pos);
    const cnt = new Uint8Array(ncap);
    cnt.set(this.cnt);
    for (let i = ncap - 1; i >= this.cap; i--) this.free.push(i);
    this.items = items;
    this.pos = pos;
    this.cnt = cnt;
    this.cap = ncap;
  }

  alloc(): number {
    if (!this.free.length) this.grow();
    const b = this.free.pop()!;
    this.cnt[b] = 0;
    this.used++;
    return b;
  }

  release(b: number): void {
    this.cnt[b] = 0;
    this.free.push(b);
    this.used--;
  }

  /** Can an item be placed at position p (0..1) respecting spacing? */
  canInsert(b: number, p: number): boolean {
    const n = this.cnt[b];
    if (n >= SLOTS) return false;
    const base = b * SLOTS;
    for (let k = 0; k < n; k++) {
      if (Math.abs(this.pos[base + k] - p) < GAP - 1e-4) return false;
    }
    return true;
  }

  /** Insert keeping descending order. Returns false if no room. */
  insert(b: number, item: number, p: number): boolean {
    if (!this.canInsert(b, p)) return false;
    const base = b * SLOTS;
    let n = this.cnt[b];
    let k = n;
    while (k > 0 && this.pos[base + k - 1] < p) {
      this.pos[base + k] = this.pos[base + k - 1];
      this.items[base + k] = this.items[base + k - 1];
      k--;
    }
    this.pos[base + k] = p;
    this.items[base + k] = item;
    this.cnt[b] = n + 1;
    return true;
  }

  /** Tail entry at position 0 (for items entering from behind). */
  canEnterTail(b: number): boolean {
    const n = this.cnt[b];
    if (n >= SLOTS) return false;
    if (n === 0) return true;
    return this.pos[b * SLOTS + n - 1] >= GAP - 1e-4;
  }

  pushTail(b: number, item: number, p: number): void {
    const n = this.cnt[b];
    const base = b * SLOTS;
    const last = n ? this.pos[base + n - 1] - GAP : 1;
    this.pos[base + n] = Math.max(0, Math.min(p, last));
    this.items[base + n] = item;
    this.cnt[b] = n + 1;
  }

  removeAt(b: number, k: number): number {
    const base = b * SLOTS;
    const n = this.cnt[b];
    const item = this.items[base + k];
    for (let j = k; j < n - 1; j++) {
      this.items[base + j] = this.items[base + j + 1];
      this.pos[base + j] = this.pos[base + j + 1];
    }
    this.cnt[b] = n - 1;
    return item;
  }

  clear(b: number): number[] {
    const out: number[] = [];
    const base = b * SLOTS;
    for (let k = 0; k < this.cnt[b]; k++) out.push(this.items[base + k]);
    this.cnt[b] = 0;
    return out;
  }

  totalItems(): number {
    let s = 0;
    for (let i = 0; i < this.cap; i++) s += this.cnt[i];
    return s;
  }

  toData(): BeltStoreData {
    return { cap: this.cap, items: Array.from(this.items), pos: Array.from(this.pos), cnt: Array.from(this.cnt), free: this.free.slice() };
  }

  static fromData(d: BeltStoreData): BeltStore {
    const s = new BeltStore(d.cap);
    s.items.set(d.items);
    s.pos.set(d.pos);
    s.cnt.set(d.cnt);
    s.free = d.free.slice();
    s.used = d.cap - d.free.length;
    return s;
  }
}
