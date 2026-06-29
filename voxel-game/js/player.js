// First-person player: input-driven movement, AABB vs voxel collision, raycast.

import { vec3 } from './glmatrix.js';
import { isSolid, B } from './blocks.js';

const HALF = 0.3;          // half-width on x/z
const HEIGHT = 1.8;        // full body height
const EYE = 1.62;          // eye offset above feet
const GRAVITY = 30;
const JUMP = 9.2;
const WALK = 4.8;
const RUN = 8.2;
const FLY = 14;
const TERMINAL = 55;
const REACH = 6;
const EPS = 1e-3;

export class Player {
  constructor(world, x, y, z) {
    this.world = world;
    this.pos = [x, y, z];   // feet (centre of the base)
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.fly = false;
    this.keys = Object.create(null);
  }

  eyePos() { return [this.pos[0], this.pos[1] + EYE, this.pos[2]]; }
  forward() { return vec3.fromYawPitch(this.yaw, this.pitch); }

  addLook(dx, dy, sensitivity) {
    this.yaw += dx * sensitivity;
    this.pitch -= dy * sensitivity;
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  _solidAt(x, y, z) { return isSolid(this.world.getBlock(x, y, z)); }

  _collides() {
    const p = this.pos;
    const x0 = Math.floor(p[0] - HALF + EPS), x1 = Math.floor(p[0] + HALF - EPS);
    const y0 = Math.floor(p[1] + EPS), y1 = Math.floor(p[1] + HEIGHT - EPS);
    const z0 = Math.floor(p[2] - HALF + EPS), z1 = Math.floor(p[2] + HALF - EPS);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (this._solidAt(x, y, z)) return true;
    return false;
  }

  _moveAxis(axis, delta) {
    if (delta === 0) return;
    const p = this.pos;
    // Sub-step so a fast move cannot skip over (or sink into) a solid cell:
    // each step is < 1 block, so _collides() always catches the contact frame.
    const MAXSTEP = 0.45;
    let remaining = delta;
    while (remaining !== 0) {
      const s = Math.max(-MAXSTEP, Math.min(MAXSTEP, remaining));
      remaining -= s;
      p[axis] += s;
      if (!this._collides()) continue;

      if (axis === 1) {
        if (s < 0) { p[1] = Math.floor(p[1]) + 1; this.onGround = true; }
        else { p[1] = Math.floor(p[1] + HEIGHT) - HEIGHT - EPS; }
      } else if (axis === 0) {
        if (s > 0) p[0] = Math.floor(p[0] + HALF) - HALF - EPS;
        else p[0] = Math.floor(p[0] - HALF) + 1 + HALF + EPS;
      } else {
        if (s > 0) p[2] = Math.floor(p[2] + HALF) - HALF - EPS;
        else p[2] = Math.floor(p[2] - HALF) + 1 + HALF + EPS;
      }
      this.vel[axis] = 0;
      return;
    }
  }

  update(dt) {
    const k = this.keys;
    const fwd = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
    const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];

    let wx = 0, wz = 0;
    if (k['KeyW'] || k['ArrowUp']) { wx += fwd[0]; wz += fwd[2]; }
    if (k['KeyS'] || k['ArrowDown']) { wx -= fwd[0]; wz -= fwd[2]; }
    if (k['KeyD'] || k['ArrowRight']) { wx += right[0]; wz += right[2]; }
    if (k['KeyA'] || k['ArrowLeft']) { wx -= right[0]; wz -= right[2]; }
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }

    const speed = this.fly ? FLY : (k['ShiftLeft'] || k['ShiftRight'] ? RUN : WALK);
    this.vel[0] = wx * speed;
    this.vel[2] = wz * speed;

    if (this.fly) {
      let vy = 0;
      if (k['Space']) vy += FLY;
      if (k['ShiftLeft'] || k['ShiftRight']) vy -= FLY;
      this.vel[1] = vy;
    } else {
      this.vel[1] -= GRAVITY * dt;
      if (this.vel[1] < -TERMINAL) this.vel[1] = -TERMINAL;
      if (k['Space'] && this.onGround) { this.vel[1] = JUMP; this.onGround = false; }
    }

    this.onGround = false;
    this._moveAxis(0, this.vel[0] * dt);
    this._moveAxis(2, this.vel[2] * dt);
    this._moveAxis(1, this.vel[1] * dt);
  }

  toggleFly() { this.fly = !this.fly; this.vel[1] = 0; }

  // Voxel DDA (Amanatides & Woo). Returns the first solid block plus the empty
  // cell in front of it for placement, or null.
  raycast(maxDist = REACH) {
    const o = this.eyePos();
    const d = this.forward();
    let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
    const step = [Math.sign(d[0]), Math.sign(d[1]), Math.sign(d[2])];
    const tDelta = [Math.abs(1 / d[0]), Math.abs(1 / d[1]), Math.abs(1 / d[2])];
    const tMax = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      if (d[a] > 0) tMax[a] = (Math.floor(o[a]) + 1 - o[a]) / d[a];
      else if (d[a] < 0) tMax[a] = (o[a] - Math.floor(o[a])) / -d[a];
      else tMax[a] = Infinity;
    }
    let normal = [0, 0, 0];
    let t = 0;
    while (t <= maxDist) {
      // Skip the eye's own cell (normal still zero): never target the block you
      // are inside, and never emit a degenerate place == hit.
      if (normal[0] || normal[1] || normal[2]) {
        const b = this.world.getBlock(x, y, z);
        if (isSolid(b)) {
          return { hit: [x, y, z], place: [x + normal[0], y + normal[1], z + normal[2]], normal };
        }
      }
      if (tMax[0] < tMax[1]) {
        if (tMax[0] < tMax[2]) { x += step[0]; t = tMax[0]; tMax[0] += tDelta[0]; normal = [-step[0], 0, 0]; }
        else { z += step[2]; t = tMax[2]; tMax[2] += tDelta[2]; normal = [0, 0, -step[2]]; }
      } else {
        if (tMax[1] < tMax[2]) { y += step[1]; t = tMax[1]; tMax[1] += tDelta[1]; normal = [0, -step[1], 0]; }
        else { z += step[2]; t = tMax[2]; tMax[2] += tDelta[2]; normal = [0, 0, -step[2]]; }
      }
    }
    return null;
  }

  // True if placing a block at [bx,by,bz] would intersect the player.
  intersectsBlock(bx, by, bz) {
    const p = this.pos;
    return (
      bx + 1 > p[0] - HALF && bx < p[0] + HALF &&
      by + 1 > p[1] && by < p[1] + HEIGHT &&
      bz + 1 > p[2] - HALF && bz < p[2] + HALF
    );
  }
}
