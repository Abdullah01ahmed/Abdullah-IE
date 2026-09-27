import type { AABB, Vec3, Vec3Tuple } from './types';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const EPSILON = 1e-6;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential approach. */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** Shortest signed difference b - a in radians. */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function v3copy(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function v3set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function v3assign(out: Vec3, v: Vec3): Vec3 {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  return out;
}

export function v3add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function v3sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function v3scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function v3addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}

export function v3dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function v3cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function v3len(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function v3lenSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function v3dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function v3distXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function v3norm(a: Vec3): Vec3 {
  const l = v3len(a);
  return l > EPSILON ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}

export function v3lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

export function v3eq(a: Vec3, b: Vec3, eps = EPSILON): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;
}

export function toTuple(v: Vec3): Vec3Tuple {
  return [round3(v.x), round3(v.y), round3(v.z)];
}

export function fromTuple(t: Vec3Tuple): Vec3 {
  return { x: t[0], y: t[1], z: t[2] };
}

/** Round to 3 decimals — used to keep JSON snapshots compact. */
export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Forward unit vector on the XZ plane for a yaw. */
export function yawForward(yaw: number): Vec3 {
  return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
}

/** Right unit vector on the XZ plane for a yaw. */
export function yawRight(yaw: number): Vec3 {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

/** View direction for yaw/pitch (pitch positive = looking down). */
export function aimDirection(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: cp * Math.sin(yaw), y: -Math.sin(pitch), z: cp * Math.cos(yaw) };
}

/** Yaw/pitch that look along a direction. */
export function anglesFromDirection(dir: Vec3): { yaw: number; pitch: number } {
  const yaw = Math.atan2(dir.x, dir.z);
  const horiz = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
  const pitch = -Math.atan2(dir.y, horiz);
  return { yaw, pitch };
}

// ---------------------------------------------------------------------------
// AABB helpers
// ---------------------------------------------------------------------------

export function aabb(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB {
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

export function aabbFromCenter(center: Vec3, halfExtents: Vec3): AABB {
  return {
    min: { x: center.x - halfExtents.x, y: center.y - halfExtents.y, z: center.z - halfExtents.z },
    max: { x: center.x + halfExtents.x, y: center.y + halfExtents.y, z: center.z + halfExtents.z },
  };
}

export function aabbCenter(b: AABB): Vec3 {
  return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
}

export function aabbSize(b: AABB): Vec3 {
  return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
}

export function aabbOverlaps(a: AABB, b: AABB): boolean {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}

export function aabbContainsPoint(b: AABB, p: Vec3): boolean {
  return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
}

export function aabbExpand(b: AABB, r: number): AABB {
  return {
    min: { x: b.min.x - r, y: b.min.y - r, z: b.min.z - r },
    max: { x: b.max.x + r, y: b.max.y + r, z: b.max.z + r },
  };
}

/**
 * Ray vs AABB (slab test). Returns the entry distance and hit normal, or null.
 * `maxDist` bounds the ray. A ray starting inside the box returns t = 0.
 */
export function rayAABB(
  origin: Vec3,
  dir: Vec3,
  box: AABB,
  maxDist: number,
): { t: number; normal: Vec3 } | null {
  let tmin = 0;
  let tmax = maxDist;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  // X slab
  {
    const inv = 1 / dir.x;
    let t1 = (box.min.x - origin.x) * inv;
    let t2 = (box.max.x - origin.x) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1; t1 = t2; t2 = tmp; n = 1;
    }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Y slab
  {
    const inv = 1 / dir.y;
    let t1 = (box.min.y - origin.y) * inv;
    let t2 = (box.max.y - origin.y) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1; t1 = t2; t2 = tmp; n = 1;
    }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Z slab
  {
    const inv = 1 / dir.z;
    let t1 = (box.min.z - origin.z) * inv;
    let t2 = (box.max.z - origin.z) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1; t1 = t2; t2 = tmp; n = 1;
    }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = n; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Number.isNaN(tmin)) return null;
  return { t: tmin, normal: { x: nx, y: ny, z: nz } };
}

/** Ray vs sphere. Returns entry distance or null. */
export function raySphere(origin: Vec3, dir: Vec3, center: Vec3, radius: number, maxDist: number): number | null {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c > 0 && b > 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = 0;
  return t <= maxDist ? t : null;
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** Small fast seeded PRNG (mulberry32). Returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Combine integers into a 32-bit seed. */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    let v = Math.floor(p) | 0;
    for (let i = 0; i < 4; i++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      v >>>= 8;
    }
  }
  return h >>> 0;
}

/** Hash a string to a 32-bit integer. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG for a given player's Nth shot in a given match. */
export function shotRandom(matchSeed: number, playerId: number, shotIndex: number): () => number {
  return mulberry32(hashSeed(matchSeed, playerId, shotIndex));
}
