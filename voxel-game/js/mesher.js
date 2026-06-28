// Builds renderable geometry for a chunk: per-face culling, ambient occlusion,
// directional face shading. Produces interleaved [x,y,z,u,v,light] vertices.

import { CHUNK_SX, CHUNK_SY, CHUNK_SZ, BLOCKS, B, isOpaque, isTranslucent } from './blocks.js';
import { blockIndex } from './world.js';
import { tileUV } from './textures.js';

// Faces in tile order: +X, -X, +Y, -Y, +Z, -Z.
// Each corner: [ox, oy, oz, s, t]; t=0 is the top of the tile.
const FACES = [
  { // +X
    n: [1, 0, 0], shade: 0.6, axisA: 1, axisB: 2,
    v: [[1, 0, 1, 0, 1], [1, 0, 0, 1, 1], [1, 1, 0, 1, 0], [1, 1, 1, 0, 0]],
  },
  { // -X
    n: [-1, 0, 0], shade: 0.6, axisA: 1, axisB: 2,
    v: [[0, 0, 0, 0, 1], [0, 0, 1, 1, 1], [0, 1, 1, 1, 0], [0, 1, 0, 0, 0]],
  },
  { // +Y (top)
    n: [0, 1, 0], shade: 1.0, axisA: 0, axisB: 2,
    v: [[0, 1, 0, 0, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1], [1, 1, 0, 1, 0]],
  },
  { // -Y (bottom)
    n: [0, -1, 0], shade: 0.5, axisA: 0, axisB: 2,
    v: [[0, 0, 0, 0, 0], [1, 0, 0, 1, 0], [1, 0, 1, 1, 1], [0, 0, 1, 0, 1]],
  },
  { // +Z
    n: [0, 0, 1], shade: 0.8, axisA: 0, axisB: 1,
    v: [[0, 0, 1, 0, 1], [1, 0, 1, 1, 1], [1, 1, 1, 1, 0], [0, 1, 1, 0, 0]],
  },
  { // -Z
    n: [0, 0, -1], shade: 0.8, axisA: 0, axisB: 1,
    v: [[1, 0, 0, 0, 1], [0, 0, 0, 1, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]],
  },
];

const AO_FACTOR = [0.45, 0.62, 0.81, 1.0]; // level 0 (dark corner) .. 3 (open)

function occl(world, x, y, z) {
  return isOpaque(world.getBlock(x, y, z)) ? 1 : 0;
}

// Ambient-occlusion level (0..3) for one face vertex.
function vertexAO(world, gx, gy, gz, n, ox, oy, oz, axisA, axisB) {
  const off = [ox, oy, oz];
  const sA = off[axisA] ? 1 : -1;
  const sB = off[axisB] ? 1 : -1;
  const bx = gx + n[0], by = gy + n[1], bz = gz + n[2];
  const da = [0, 0, 0]; da[axisA] = sA;
  const db = [0, 0, 0]; db[axisB] = sB;
  const s1 = occl(world, bx + da[0], by + da[1], bz + da[2]);
  const s2 = occl(world, bx + db[0], by + db[1], bz + db[2]);
  if (s1 && s2) return 0;
  const c = occl(world, bx + da[0] + db[0], by + da[1] + db[1], bz + da[2] + db[2]);
  return 3 - (s1 + s2 + c);
}

export function meshChunk(world, chunk) {
  const opaque = [];
  const water = [];
  const baseX = chunk.cx * CHUNK_SX;
  const baseZ = chunk.cz * CHUNK_SZ;
  const blocks = chunk.blocks;

  for (let y = 0; y < CHUNK_SY; y++) {
    for (let z = 0; z < CHUNK_SZ; z++) {
      for (let x = 0; x < CHUNK_SX; x++) {
        const id = blocks[blockIndex(x, y, z)];
        if (id === B.AIR) continue;
        const def = BLOCKS[id];
        const liquid = !!def.liquid;
        const gx = baseX + x, gy = y, gz = baseZ + z;
        const target = liquid ? water : opaque;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nbx = gx + face.n[0], nby = gy + face.n[1], nbz = gz + face.n[2];
          const nb = world.getBlock(nbx, nby, nbz);

          let emit;
          if (liquid) {
            emit = (nb === B.AIR);
          } else {
            emit = !isOpaque(nb);
            if (emit && isTranslucent(id) && nb === id) emit = false; // glass-glass
          }
          if (!emit) continue;

          const uv = tileUV(def.tiles[f]);
          const du = uv.u1 - uv.u0;
          const dv = uv.v1 - uv.v0;

          // Build the 4 corner vertices.
          const corner = [];
          const ao = [];
          for (let k = 0; k < 4; k++) {
            const vd = face.v[k];
            const ox = vd[0], oy = vd[1], oz = vd[2];
            let light = face.shade;
            let lvl = 3;
            if (!liquid) {
              lvl = vertexAO(world, gx, gy, gz, face.n, ox, oy, oz, face.axisA, face.axisB);
              light *= AO_FACTOR[lvl];
            }
            ao.push(lvl);
            corner.push([
              x + ox, y + oy, z + oz,
              uv.u0 + vd[3] * du,
              uv.v0 + vd[4] * dv,
              light,
            ]);
          }

          // Flip the quad diagonal to keep AO gradients smooth.
          let order;
          if (ao[0] + ao[2] > ao[1] + ao[3]) order = [0, 1, 2, 0, 2, 3];
          else order = [1, 2, 3, 1, 3, 0];
          for (let o = 0; o < 6; o++) {
            const c = corner[order[o]];
            target.push(c[0], c[1], c[2], c[3], c[4], c[5]);
          }
        }
      }
    }
  }

  return {
    opaque: new Float32Array(opaque),
    water: new Float32Array(water),
  };
}
