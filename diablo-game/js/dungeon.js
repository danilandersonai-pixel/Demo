// Procedural dungeon: rooms + L-corridors, walls, stairs. Zero dependencies.

import { makeRng } from './rng.js';

export const ROCK = 0;   // solid void (rendered black)
export const FLOOR = 1;
export const WALL = 2;    // solid, borders floor (rendered as a block)
export const STAIRS = 3;  // descend to next level

export class Dungeon {
  constructor(seed, level) {
    this.level = level;
    this.W = 44 + Math.min(level * 2, 16);
    this.H = 44 + Math.min(level * 2, 16);
    this.tiles = new Uint8Array(this.W * this.H); // ROCK
    this.rooms = [];
    this.rng = makeRng((seed ^ (level * 0x9e3779b9)) >>> 0);
    this._generate();
  }

  idx(x, y) { return y * this.W + x; }
  get(x, y) { return (x < 0 || y < 0 || x >= this.W || y >= this.H) ? ROCK : this.tiles[this.idx(x, y)]; }
  walkable(x, y) { const t = this.get(x, y); return t === FLOOR || t === STAIRS; }
  isWall(x, y) { return this.get(x, y) === WALL; }

  _carveRoom(r) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++)
        this.tiles[this.idx(x, y)] = FLOOR;
  }

  _carveH(x1, x2, y) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) this.tiles[this.idx(x, y)] = FLOOR;
  }
  _carveV(y1, y2, x) {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) this.tiles[this.idx(x, y)] = FLOOR;
  }

  _overlaps(r) {
    for (const o of this.rooms) {
      if (r.x - 1 < o.x + o.w && r.x + r.w + 1 > o.x &&
          r.y - 1 < o.y + o.h && r.y + r.h + 1 > o.y) return true;
    }
    return false;
  }

  _generate() {
    const rng = this.rng;
    const tries = 60;
    const maxRooms = 7 + Math.min(this.level, 8);
    for (let i = 0; i < tries && this.rooms.length < maxRooms; i++) {
      const w = rng.int(5, 9), h = rng.int(5, 9);
      const x = rng.int(1, this.W - w - 2);
      const y = rng.int(1, this.H - h - 2);
      const room = { x, y, w, h, cx: (x + (w >> 1)), cy: (y + (h >> 1)) };
      if (this._overlaps(room)) continue;
      this._carveRoom(room);
      this.rooms.push(room);
    }

    // Connect rooms in order with L corridors.
    for (let i = 1; i < this.rooms.length; i++) {
      const a = this.rooms[i - 1], b = this.rooms[i];
      if (rng.chance(0.5)) { this._carveH(a.cx, b.cx, a.cy); this._carveV(a.cy, b.cy, b.cx); }
      else { this._carveV(a.cy, b.cy, a.cx); this._carveH(a.cx, b.cx, b.cy); }
    }

    // Promote rock bordering floor to wall.
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        if (this.tiles[this.idx(x, y)] !== ROCK) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (this.get(x + dx, y + dy) === FLOOR) { near = true; break; }
        if (near) this.tiles[this.idx(x, y)] = WALL;
      }
    }

    const first = this.rooms[0];
    const last = this.rooms[this.rooms.length - 1];
    this.spawn = { x: first.cx + 0.5, y: first.cy + 0.5 };
    this.tiles[this.idx(last.cx, last.cy)] = STAIRS;
    this.stairs = { x: last.cx, y: last.cy };
  }

  // Random walkable tile inside a room (excluding the first room), for spawns.
  randomSpawnTile(avoidFirst = true) {
    const rng = this.rng;
    const start = avoidFirst ? 1 : 0;
    if (this.rooms.length <= start) return null;
    const r = this.rooms[rng.int(start, this.rooms.length - 1)];
    return { x: r.x + rng.int(0, r.w - 1) + 0.5, y: r.y + rng.int(0, r.h - 1) + 0.5 };
  }
}
