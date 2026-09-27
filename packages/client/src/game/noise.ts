/**
 * Small, fast, tileable noise primitives used by the procedural texture
 * generator. Everything works in "tile space": coordinates in [0, 1) wrap, so
 * a texture sampled over one period tiles seamlessly.
 *
 * The expensive parts (lattice noise, Worley/cellular noise) are rasterised
 * once into periodic float *fields* that are cached for the process lifetime;
 * painters then pay one bilinear lookup per sample. That is what keeps a full
 * 1024² PBR set in the ~100 ms range instead of seconds.
 *
 * Pure functions and typed arrays only — no DOM, no Babylon — so the texture
 * generator can run in unit tests and in a worker unchanged.
 */

/** Integer hash → [0, 1). Deterministic, cheap, decent distribution. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Fractional part with wrap into [0, 1). */
export function fract(a: number): number {
  return a - Math.floor(a);
}

/** Positive integer modulo. */
export function imod(a: number, n: number): number {
  const m = a % n;
  return m < 0 ? m + n : m;
}

/** Resolution of the cached periodic fields. */
export const FIELD_RES = 512;

/** A periodic scalar field rasterised over one tile; sampled bilinearly with wrap. */
export class Field {
  constructor(public readonly res: number, public readonly data: Float32Array) {}

  sample(u: number, v: number): number {
    const res = this.res;
    const data = this.data;
    const fx = (u - Math.floor(u)) * res;
    const fy = (v - Math.floor(v)) * res;
    const x0 = fx | 0;
    const y0 = fy | 0;
    const tx = fx - x0;
    const ty = fy - y0;
    const x1 = x0 + 1 === res ? 0 : x0 + 1;
    const r0 = y0 * res;
    const r1 = y0 + 1 === res ? 0 : r0 + res;
    const a = data[r0 + x0];
    const b = data[r0 + x1];
    const c = data[r1 + x0];
    const d = data[r1 + x1];
    const top = a + (b - a) * tx;
    const bot = c + (d - c) * tx;
    return top + (bot - top) * ty;
  }

  /** Nearest-texel lookup (for id-like fields that must not interpolate). */
  nearest(u: number, v: number): number {
    const res = this.res;
    const x = ((u - Math.floor(u)) * res) | 0;
    const y = ((v - Math.floor(v)) * res) | 0;
    return this.data[y * res + x];
  }
}

const fieldCache = new Map<string, Field>();

/** Rasterise one octave of tileable value noise with `period` lattice cells. */
function valueNoiseInto(out: Float32Array, res: number, period: number, seed: number, amp: number): void {
  const scale = period / res;
  for (let j = 0; j < res; j++) {
    const fy = j * scale;
    const y0 = Math.floor(fy);
    const ty = smoothstep(fy - y0);
    const y1 = (y0 + 1) % period;
    const row = j * res;
    for (let i = 0; i < res; i++) {
      const fx = i * scale;
      const x0 = Math.floor(fx);
      const tx = smoothstep(fx - x0);
      const x1 = (x0 + 1) % period;
      const a = hash2(x0, y0, seed);
      const b = hash2(x1, y0, seed);
      const c = hash2(x0, y1, seed);
      const d = hash2(x1, y1, seed);
      out[row + i] += (mix(mix(a, b, tx), mix(c, d, tx), ty)) * amp;
    }
  }
}

/** Cached fractal value-noise field in [0, 1]. */
export function fbmField(basePeriod: number, octaves: number, seed: number, gain = 0.5, res = FIELD_RES): Field {
  const key = `f:${basePeriod}:${octaves}:${seed}:${gain}:${res}`;
  const hit = fieldCache.get(key);
  if (hit) return hit;
  const data = new Float32Array(res * res);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    valueNoiseInto(data, res, basePeriod * 2 ** o, seed + o * 131, amp);
    total += amp;
    amp *= gain;
  }
  const inv = 1 / total;
  for (let i = 0; i < data.length; i++) data[i] *= inv;
  const f = new Field(res, data);
  fieldCache.set(key, f);
  return f;
}

/**
 * Cached tileable cellular (Worley) fields: distance to the nearest and second
 * nearest feature point (in cell units) and the nearest cell's id.
 */
export interface CellFields {
  f1: Field;
  f2: Field;
  id: Field;
  /** Two stable random values per cell id. */
  rnd: Float32Array;
  rnd2: Float32Array;
  period: number;
}

const cellCache = new Map<string, CellFields>();

export function cellFields(period: number, seed: number, res = FIELD_RES): CellFields {
  const key = `c:${period}:${seed}:${res}`;
  const hit = cellCache.get(key);
  if (hit) return hit;
  const n = period * period;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const rnd = new Float32Array(n);
  const rnd2 = new Float32Array(n);
  for (let cy = 0; cy < period; cy++) {
    for (let cx = 0; cx < period; cx++) {
      const i = cy * period + cx;
      px[i] = hash2(cx, cy, seed);
      py[i] = hash2(cx, cy, seed + 7919);
      rnd[i] = hash2(cx, cy, seed + 104729);
      rnd2[i] = hash2(cx, cy, seed + 1299709);
    }
  }
  const f1 = new Float32Array(res * res);
  const f2 = new Float32Array(res * res);
  const id = new Float32Array(res * res);
  const scale = period / res;
  for (let j = 0; j < res; j++) {
    const fy = (j + 0.5) * scale;
    const cy = Math.floor(fy);
    for (let i = 0; i < res; i++) {
      const fx = (i + 0.5) * scale;
      const cx = Math.floor(fx);
      let d1 = 9;
      let d2 = 9;
      let best = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const gy = cy + dy;
        const wy = imod(gy, period);
        for (let dx = -1; dx <= 1; dx++) {
          const gx = cx + dx;
          const wx = imod(gx, period);
          const ci = wy * period + wx;
          const ddx = gx + px[ci] - fx;
          const ddy = gy + py[ci] - fy;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = ci;
          } else if (d < d2) {
            d2 = d;
          }
        }
      }
      const o = j * res + i;
      f1[o] = d1;
      f2[o] = d2;
      id[o] = best;
    }
  }
  const fields: CellFields = { f1: new Field(res, f1), f2: new Field(res, f2), id: new Field(res, id), rnd, rnd2, period };
  cellCache.set(key, fields);
  return fields;
}

/** 256×256 white-noise tile for per-pixel grain (repetition is invisible). */
const WHITE_RES = 256;
const whiteTiles = new Map<number, Float32Array>();

export function whiteNoise(seed: number): Float32Array {
  let t = whiteTiles.get(seed);
  if (t) return t;
  t = new Float32Array(WHITE_RES * WHITE_RES);
  for (let y = 0; y < WHITE_RES; y++) for (let x = 0; x < WHITE_RES; x++) t[y * WHITE_RES + x] = hash2(x, y, seed) - 0.5;
  whiteTiles.set(seed, t);
  return t;
}

/** Grain value in [-0.5, 0.5] for an integer pixel coordinate. */
export function grainAt(tile: Float32Array, x: number, y: number): number {
  return tile[((y & 255) << 8) | (x & 255)];
}
