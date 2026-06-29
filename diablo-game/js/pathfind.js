// A* pathfinding on the dungeon grid (8-directional, no corner cutting).

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

// walkable(x, y) -> boolean. Returns an array of {x,y} tile centers (excluding
// the start tile) or null if unreachable. Capped to avoid runaway searches.
export function findPath(sx, sy, tx, ty, walkable, maxNodes = 4000) {
  sx |= 0; sy |= 0; tx |= 0; ty |= 0;
  if (sx === tx && sy === ty) return [];
  if (!walkable(tx, ty)) return null;

  const key = (x, y) => x + ',' + y;
  const open = [{ x: sx, y: sy, g: 0, f: 0 }];
  const came = new Map();
  const gScore = new Map([[key(sx, sy), 0]]);
  const closed = new Set();
  const h = (x, y) => {
    const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
    return (dx + dy) + (1.414 - 2) * Math.min(dx, dy);
  };
  let nodes = 0;

  while (open.length && nodes++ < maxNodes) {
    // pop lowest f (linear scan; grids here are small)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y);
    if (cur.x === tx && cur.y === ty) {
      const path = [];
      let k = ck;
      while (came.has(k)) {
        const [px, py] = k.split(',').map(Number);
        path.push({ x: px, y: py });
        k = came.get(k);
      }
      path.reverse();
      return path;
    }
    if (closed.has(ck)) continue;
    closed.add(ck);

    for (const [dx, dy, cost] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!walkable(nx, ny)) continue;
      // disallow cutting diagonally past two walls
      if (dx !== 0 && dy !== 0 && (!walkable(cur.x + dx, cur.y) || !walkable(cur.x, cur.y + dy))) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const ng = cur.g + cost;
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        came.set(nk, ck);
        open.push({ x: nx, y: ny, g: ng, f: ng + h(nx, ny) });
      }
    }
  }
  return null;
}
