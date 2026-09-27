/**
 * Small, fast, tileable noise primitives used by the procedural texture
 * generator. Everything works in "tile space": coordinates in [0, period) wrap,
 * so a texture sampled over one period tiles seamlessly.
 *
 * Pure functions and typed arrays only — no DOM, no Babylon — so the texture
 * generator can be unit tested and (later) moved to a worker unchanged.
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

/** Positive modulo. */
export function pmod(a: number, n: number): number {
  const m = a % n;
  return m < 0 ? m + n : m;
}

/**
 * A pre-computed tileable value-noise field with `period` lattice cells across
 * the tile, rasterised at `res`×`res`. Sampling is a bilinear lookup, which is
 * an order of magnitude cheaper than evaluating lattice noise per pixel — this
 * is what keeps 1024² texture sets in the sub-second range.
 */
export interface NoiseTile {
  res: number;
  data: Float32Array;
}

const tileCache = new Map<string, NoiseTile>();

export function noiseTile(res: number, period: number, seed: number): NoiseTile {
  const key = `${res}:${period}:${seed}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  const data = new Float32Array(res * res);
  const scale = period / res;
  for (let j = 0; j < res; j++) {
    const fy = j * scale;
    const y0 = Math.floor(fy);
    const ty = smoothstep(fy - y0);
    const y1 = (y0 + 1) % period;
    for (let i = 0; i < res; i++) {
      const fx = i * scale;
      const x0 = Math.floor(fx);
      const tx = smoothstep(fx - x0);
      const x1 = (x0 + 1) % period;
      const a = hash2(x0, y0, seed);
      const b = hash2(x1, y0, seed);
      const c = hash2(x0, y1, seed);
      const d = hash2(x1, y1, seed);
      data[j * res + i] = mix(mix(a, b, tx), mix(c, d, tx), ty);
    }
  }
  const tile = { res, data };
  tileCache.set(key, tile);
  return tile;
}

/** Bilinear, wrapping sample of a tile at tile-space coordinates u, v in [0, 1). */
export function sampleTile(tile: NoiseTile, u: number, v: number): number {
  const { res, data } = tile;
  const fx = pmod(u, 1) * res;
  const fy = pmod(v, 1) * res;
  const x0 = fx | 0;
  const y0 = fy | 0;
  const tx = fx - x0;
  const ty = fy - y0;
  const x1 = x0 + 1 === res ? 0 : x0 + 1;
  const y1 = y0 + 1 === res ? 0 : y0 + 1;
  const r0 = y0 * res;
  const r1 = y1 * res;
  const top = data[r0 + x0] + (data[r0 + x1] - data[r0 + x0]) * tx;
  const bot = data[r1 + x0] + (data[r1 + x1] - data[r1 + x0]) * tx;
  return top + (bot - top) * ty;
}

/** Fractal Brownian motion built from cached tiles. Result is in [0, 1]. */
export class Fbm {
  private readonly tiles: NoiseTile[] = [];
  private readonly amps: number[] = [];
  private readonly norm: number;

  constructor(basePeriod: number, octaves: number, seed: number, gain = 0.5, tileRes = 256) {
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
      const period = basePeriod * 2 ** o;
      this.tiles.push(noiseTile(Math.min(tileRes * 2 ** Math.min(o, 2), 512), period, seed + o * 131));
      this.amps.push(amp);
      total += amp;
      amp *= gain;
    }
    this.norm = 1 / total;
  }

  at(u: number, v: number): number {
    let s = 0;
    for (let o = 0; o < this.tiles.length; o++) s += sampleTile(this.tiles[o], u, v) * this.amps[o];
    return s * this.norm;
  }
}

/**
 * Tileable cellular (Worley) noise. Returns the two nearest feature distances
 * and the id of the nearest cell, scaled so that distances are in cell units.
 */
export interface CellSample {
  f1: number;
  f2: number;
  id: number;
}

export function cellular(u: number, v: number, period: number, seed: number, out: CellSample): CellSample {
  const fx = pmod(u, 1) * period;
  const fy = pmod(v, 1) * period;
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      const wx = pmod(gx, period);
      const wy = pmod(gy, period);
      const px = gx + hash2(wx, wy, seed);
      const py = gy + hash2(wx, wy, seed + 7919);
      const ddx = px - fx;
      const ddy = py - fy;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = wy * period + wx;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
  return out;
}

/** Per-pixel white noise (grain), stable for a given seed. */
export function grain(x: number, y: number, seed: number): number {
  return hash2(x, y, seed) - 0.5;
}
