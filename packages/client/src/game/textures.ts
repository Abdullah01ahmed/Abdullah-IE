/**
 * Procedural PBR texture sets for every map material. Everything is generated
 * in code (no image files), which keeps licensing clean and lets quality scale
 * with a single "size" parameter.
 *
 * A set is three RGBA8 buffers:
 *   albedo  — sRGB colour (+ alpha for cut-out / blended materials)
 *   normal  — tangent-space normal derived from the painted height field
 *             (OpenGL layout: +R = +u, +G = +v; Materials.ts sets the Babylon
 *             inversion flags that match this layout)
 *   orm     — R = ambient occlusion, G = roughness, B = metallic
 *
 * Painters run in tile space (u, v ∈ [0, 1) across one texture repeat) so the
 * result tiles seamlessly; world-aligned UVs in the map renderer decide how
 * many metres one repeat covers.
 *
 * Cost control: the paint pass runs at most at 1024² and reads pre-rasterised
 * noise fields (see noise.ts); larger sizes are bilinearly upsampled with
 * per-pixel grain added to the albedo so 2048² sets do not look soft.
 * Generated sets are cached (byte-bounded) so a rematch is fast.
 */
import type { MaterialId } from '@tra/shared';
import { Field, cellFields, clamp01, fbmField, fract, grainAt, hash2, imod, mix, smoothstep, whiteNoise, type CellFields } from './noise';

export interface TextureSet {
  id: MaterialId;
  /** Albedo resolution (square). */
  size: number;
  albedo: Uint8Array;
  /** Normal / ORM resolution: the paint resolution, never above MAX_PAINT_RES. */
  detailSize: number;
  normal: Uint8Array;
  orm: Uint8Array;
  hasAlpha: boolean;
}

/** Per-pixel painter output. Values are 0..1. */
interface Surface {
  r: number;
  g: number;
  b: number;
  a: number;
  /** Height field used for normals and ambient occlusion. */
  h: number;
  rough: number;
  metal: number;
}

type Painter = (u: number, v: number, out: Surface) => void;

interface PainterSpec {
  paint: Painter;
  /** Normal-map gradient strength (tuned for 1024²; scaled with resolution). */
  bump: number;
  /** Ambient-occlusion strength from height cavities. */
  ao: number;
  /** Per-pixel colour grain amplitude (0..1). */
  grain: number;
  hasAlpha: boolean;
}

/** Largest resolution at which the painter pass runs; larger sizes upsample. */
export const MAX_PAINT_RES = 1024;

// ---------------------------------------------------------------------------
// Helpers shared by painters
// ---------------------------------------------------------------------------

const INV255 = 1 / 255;

/** Colour in 0..255 units scaled by `k`; clamping happens when bytes are written. */
function setRgb(out: Surface, r: number, g: number, b: number, k = 1): void {
  const s = k * INV255;
  out.r = r * s;
  out.g = g * s;
  out.b = b * s;
}

interface BrickSample {
  mortar: boolean;
  /** Stable per-brick randoms in [0, 1). */
  rnd: number;
  rnd2: number;
  /** 0 at the mortar line rising to 1 inside the brick face (bevel profile). */
  bevel: number;
}

const brickOut: BrickSample = { mortar: false, rnd: 0, rnd2: 0, bevel: 0 };

/** Running-bond brick layout with per-brick random tables. */
class BrickLayout {
  private readonly rnd: Float32Array;
  private readonly rnd2: Float32Array;

  constructor(
    private readonly cols: number,
    private readonly rows: number,
    private readonly mortar: number,
    private readonly bevelW: number,
    seed: number,
  ) {
    this.rnd = new Float32Array(cols * rows);
    this.rnd2 = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.rnd[r * cols + c] = hash2(c, r, seed);
        this.rnd2[r * cols + c] = hash2(c, r, seed + 977);
      }
    }
  }

  at(u: number, v: number): BrickSample {
    const { cols, rows } = this;
    const rowF = fract(v) * rows;
    const row = rowF | 0;
    const rv = rowF - row;
    const colF = fract(u) * cols + (row & 1 ? 0.5 : 0);
    const col = colF | 0;
    const cu = colF - col;
    const du = (cu < 0.5 ? cu : 1 - cu) / cols;
    const dv = (rv < 0.5 ? rv : 1 - rv) / rows;
    const edge = (du < dv ? du : dv) - this.mortar / 2;
    brickOut.mortar = edge < 0;
    brickOut.bevel = edge < 0 ? 0 : smoothstep(edge >= this.bevelW ? 1 : edge / this.bevelW);
    const i = row * cols + (col >= cols ? col - cols : col);
    brickOut.rnd = this.rnd[i];
    brickOut.rnd2 = this.rnd2[i];
    return brickOut;
  }
}

// Shared fields: every material samples the same handful of cached noise
// fields at its own offsets, which is far cheaper than per-material fields and
// visually indistinguishable.
function fields() {
  return {
    fine: fbmField(24, 3, 101),
    mid: fbmField(6, 4, 103),
    broad: fbmField(3, 2, 107),
    micro: fbmField(64, 2, 109),
    wear: fbmField(3, 4, 113, 0.55),
  };
}

// ---------------------------------------------------------------------------
// Painters
// ---------------------------------------------------------------------------

function brickPainter(dark: boolean, seed: number): PainterSpec {
  const F = fields();
  const layout = new BrickLayout(4, 13, 0.012, 0.012, seed);
  const base = dark ? [142, 100, 70] : [206, 172, 118];
  const mortarC = dark ? [124, 112, 96] : [170, 160, 140];
  const ou = (seed % 7) * 0.137;
  return {
    bump: 3.2,
    ao: 1.4,
    grain: 0.035,
    hasAlpha: false,
    paint: (u, v, out) => {
      const b = layout.at(u, v);
      const g = F.fine.sample(u + ou, v);
      if (b.mortar) {
        setRgb(out, mortarC[0], mortarC[1], mortarC[2], 0.9 + g * 0.2);
        out.h = 0.22 + g * 0.1;
        out.rough = 0.95;
        out.metal = 0;
        return;
      }
      const pits = F.micro.sample(u, v + ou);
      // Per-brick tone: warm/cool shift, occasional darker (over-fired) bricks.
      const lum = (dark ? 0.78 : 0.86) + b.rnd * (dark ? 0.4 : 0.26);
      const warm = (b.rnd2 - 0.5) * 22;
      const burnt = b.rnd > (dark ? 0.82 : 0.92) ? 0.78 : 1;
      const chip = pits > 0.7 ? smoothstep(Math.min(1, (pits - 0.7) / 0.12)) : 0;
      const tone = lum * burnt * (0.92 + g * 0.16) * (1 - chip * 0.25) * (0.94 + F.broad.sample(u, v) * 0.12);
      setRgb(out, base[0] + warm, base[1] + warm * 0.5, base[2] - warm * 0.3, tone);
      out.h = 0.55 + b.bevel * 0.4 + g * 0.06 - chip * 0.35;
      out.rough = 0.8 + g * 0.12 + chip * 0.1;
      out.metal = 0;
    },
  };
}

function plasterPainter(seed: number, worn: boolean): PainterSpec {
  const F = fields();
  const cracks = cellFields(5, seed + 9);
  const brick = brickPainter(false, seed + 6);
  const ou = (seed % 5) * 0.21;
  return {
    bump: worn ? 4.5 : 2.2,
    ao: worn ? 1.6 : 0.8,
    grain: 0.02,
    hasAlpha: false,
    paint: (u, v, out) => {
      if (worn) {
        // Flaked patches reveal the brick beneath (the tile is 2 m so brick
        // coordinates run twice as fast).
        const m = F.wear.sample(u + ou, v);
        if (m > 0.6) {
          brick.paint(u * 2, v * 2, out);
          const dim = 0.86 - Math.min(0.1, (m - 0.6) * 0.5);
          out.r *= dim; out.g *= dim; out.b *= dim;
          out.h = out.h * 0.6 - 0.05;
          return;
        }
        if (m > 0.55) {
          // Raised, slightly dusty flake edge.
          const t = (m - 0.55) / 0.05;
          setRgb(out, 222, 206, 180, 1.02 - t * 0.1);
          out.h = 0.75 + (1 - t) * 0.2;
          out.rough = 0.85;
          out.metal = 0;
          return;
        }
      }
      const mo = F.mid.sample(u + ou, v + ou);
      const f = F.fine.sample(u, v + ou);
      let k = 0.94 + mo * 0.12;
      let h = 0.6 + f * 0.18 + F.broad.sample(u + ou, v) * 0.1;
      // Sparse hairline cracks.
      if (F.broad.sample(u, v + 0.5) > 0.58) {
        const gap = cracks.f2.sample(u, v) - cracks.f1.sample(u, v);
        if (gap < 0.025) {
          const t = 1 - gap / 0.025;
          k *= 1 - t * 0.35;
          h -= t * 0.3;
        }
      }
      setRgb(out, 226, 211, 186, k);
      out.h = h;
      out.rough = 0.78 + f * 0.12;
      out.metal = 0;
    },
  };
}

function stonePainter(seed: number): PainterSpec {
  const F = fields();
  const layout = new BrickLayout(2, 4, 0.008, 0.02, seed);
  const chiselC = cellFields(24, seed + 3);
  return {
    bump: 3.5,
    ao: 1.3,
    grain: 0.03,
    hasAlpha: false,
    paint: (u, v, out) => {
      const b = layout.at(u, v);
      const gr = F.fine.sample(u + 0.31, v + 0.17);
      if (b.mortar) {
        setRgb(out, 150, 140, 122, 0.9 + gr * 0.2);
        out.h = 0.25;
        out.rough = 0.95;
        out.metal = 0;
        return;
      }
      const f1 = chiselC.f1.sample(u * 1.5, v * 1.5);
      const chisel = f1 < 0.4 ? (1 - f1 / 0.4) * 0.5 : 0;
      const lum = 0.9 + b.rnd * 0.18;
      const k = lum * (0.94 + gr * 0.12 - chisel * 0.12) * (0.95 + F.broad.sample(u, v) * 0.1);
      setRgb(out, 184 + (b.rnd2 - 0.5) * 14, 168, 142 - (b.rnd2 - 0.5) * 10, k);
      out.h = 0.5 + b.bevel * 0.4 + gr * 0.08 - chisel * 0.18;
      out.rough = 0.7 + gr * 0.15 + chisel * 0.1;
      out.metal = 0;
    },
  };
}

function woodPainter(seed: number): PainterSpec {
  const F = fields();
  const grainF = fbmField(6, 4, seed + 1, 0.6);
  const planks = 8;
  const plankRnd = new Float32Array(planks);
  for (let i = 0; i < planks; i++) plankRnd[i] = hash2(i, 0, seed);
  return {
    bump: 2.4,
    ao: 0.9,
    grain: 0.025,
    hasAlpha: false,
    paint: (u, v, out) => {
      const pf = fract(u) * planks;
      const plank = pf | 0;
      const pu = pf - plank;
      const gap = (pu < 0.5 ? pu : 1 - pu) / planks;
      const id = plankRnd[plank];
      // Grain: noise stretched along the plank (v) with a per-plank offset.
      const gval = grainF.sample(u * 3 + id * 5, v * 0.18 + id);
      const rings = 0.5 + 0.5 * Math.cos((gval * 7 + v * 0.6 + id * 3) * Math.PI * 2);
      const band = smoothstep(rings);
      const f = F.micro.sample(u, v);
      if (gap < 0.004) {
        setRgb(out, 60, 40, 24, 0.9);
        out.h = 0.2;
        out.rough = 0.8;
        out.metal = 0;
        return;
      }
      const k = (0.82 + id * 0.22) * (0.86 + band * 0.24) * (0.95 + f * 0.1);
      setRgb(out, 124, 84, 48, k);
      out.h = 0.5 + band * 0.18 + f * 0.06;
      out.rough = 0.5 + band * 0.22;
      out.metal = 0;
    },
  };
}

function latticePainter(_seed: number): PainterSpec {
  const F = fields();
  const cells = 6;
  const bar = 0.16; // fraction of a cell
  return {
    bump: 4,
    ao: 0.6,
    grain: 0.02,
    hasAlpha: true,
    paint: (u, v, out) => {
      const cu = fract(u) * cells;
      const cv = fract(v) * cells;
      const lu = cu - (cu | 0);
      const lv = cv - (cv | 0);
      // Orthogonal bars along the cell borders + a diamond lattice through
      // the cell centre: the classic turned-wood mashrabiya look.
      const eu = lu < 0.5 ? lu : 1 - lu;
      const ev = lv < 0.5 ? lv : 1 - lv;
      const dOrtho = eu < ev ? eu : ev;
      const dDiag = Math.min(Math.abs(lu - lv), Math.abs(lu + lv - 1)) * Math.SQRT1_2;
      const d = dOrtho < dDiag ? dOrtho : dDiag;
      if (d > bar / 2) {
        out.r = out.g = out.b = 0;
        out.a = 0;
        out.h = 0;
        out.rough = 1;
        out.metal = 0;
        return;
      }
      const profile = Math.cos((d / (bar / 2)) * Math.PI * 0.5); // rounded bar
      // Turned "beads" at the intersections.
      const bead = Math.hypot(eu, ev) < bar * 0.8 ? 1 : 0;
      const f = F.micro.sample(u, v);
      setRgb(out, 98, 64, 38, (0.85 + profile * 0.3 + bead * 0.15) * (0.95 + f * 0.1));
      out.a = 1;
      out.h = 0.3 + profile * 0.6 + bead * 0.1;
      out.rough = 0.6;
      out.metal = 0;
    },
  };
}

function roofPainter(seed: number): PainterSpec {
  const F = fields();
  const cracks = cellFields(6, seed + 4);
  return {
    bump: 2.6,
    ao: 1.2,
    grain: 0.03,
    hasAlpha: false,
    paint: (u, v, out) => {
      const gap = cracks.f2.sample(u, v) - cracks.f1.sample(u, v);
      const crack = gap < 0.03 ? 1 - gap / 0.03 : 0;
      const m = F.mid.sample(u + 0.4, v);
      const f = F.micro.sample(u, v + 0.4);
      const st = F.broad.sample(u + 0.2, v + 0.6);
      const k = (0.92 + m * 0.14) * (1 - crack * 0.4) * (1 - Math.max(0, st - 0.55) * 0.5) * (0.96 + f * 0.08);
      setRgb(out, 188, 168, 138, k);
      out.h = 0.6 + f * 0.1 + m * 0.1 - crack * 0.4;
      out.rough = 0.9;
      out.metal = 0;
    },
  };
}

function groundPainter(seed: number): PainterSpec {
  const F = fields();
  const pebbles = cellFields(40, seed + 3);
  return {
    bump: 2.8,
    ao: 1.0,
    grain: 0.04,
    hasAlpha: false,
    paint: (u, v, out) => {
      const m = F.mid.sample(u + 0.7, v + 0.1);
      const f = F.micro.sample(u + 0.3, v);
      const f1 = pebbles.f1.sample(u, v);
      const id = pebbles.id.nearest(u, v);
      const pebble = f1 < 0.28 && pebbles.rnd[id] > 0.62 ? 1 - f1 / 0.28 : 0;
      const k = (0.9 + m * 0.2) * (0.95 + f * 0.1);
      if (pebble > 0) {
        setRgb(out, 152, 142, 126, k * (0.9 + pebble * 0.2));
        out.h = 0.5 + pebble * 0.3;
        out.rough = 0.8;
      } else {
        setRgb(out, 168, 140, 100, k);
        out.h = 0.45 + m * 0.12 + f * 0.06;
        out.rough = 0.96;
      }
      out.metal = 0;
    },
  };
}

function cobblePainter(seed: number): PainterSpec {
  const F = fields();
  const stones: CellFields = cellFields(9, seed + 3);
  return {
    bump: 4.2,
    ao: 1.8,
    grain: 0.03,
    hasAlpha: false,
    paint: (u, v, out) => {
      const f1 = stones.f1.sample(u, v);
      const gap = stones.f2.sample(u, v) - f1;
      const stone = smoothstep(clamp01((gap - 0.03) / 0.14));
      const gr = F.fine.sample(u + 0.5, v + 0.5);
      if (stone < 0.02) {
        setRgb(out, 108, 94, 74, 0.9 + gr * 0.2);
        out.h = 0.1 + gr * 0.05;
        out.rough = 0.95;
        out.metal = 0;
        return;
      }
      const id = stones.id.nearest(u, v);
      const rnd = stones.rnd[id];
      const rnd2 = stones.rnd2[id];
      const w = F.broad.sample(u, v + 0.33);
      const dome = stone * (1 - f1 * 0.45);
      const k = (0.86 + rnd * 0.28) * (0.94 + gr * 0.12) * (0.92 + w * 0.14);
      const hueShift = (rnd2 - 0.5) * 18;
      // Blend stone colour toward the dirt colour at the stone's edge.
      setRgb(out, mix(108, 146 + hueShift, stone), mix(94, 134, stone), mix(74, 116 - hueShift, stone), k);
      out.h = 0.1 + dome * 0.85 + gr * 0.05;
      out.rough = mix(0.95, 0.68 + gr * 0.15, stone);
      out.metal = 0;
    },
  };
}

function tilePainter(_seed: number): PainterSpec {
  const F = fields();
  const n = 5;
  const grout = 0.012;
  return {
    bump: 2.0,
    ao: 1.0,
    grain: 0.01,
    hasAlpha: false,
    paint: (u, v, out) => {
      const tu = fract(u) * n;
      const tv = fract(v) * n;
      const lu = tu - (tu | 0);
      const lv = tv - (tv | 0);
      const eu = lu < 0.5 ? lu : 1 - lu;
      const ev = lv < 0.5 ? lv : 1 - lv;
      const edge = (eu < ev ? eu : ev) / n;
      const sp = F.micro.sample(u, v);
      if (edge < grout / 2) {
        setRgb(out, 214, 206, 190, 0.92 + sp * 0.12);
        out.h = 0.25;
        out.rough = 0.9;
        out.metal = 0;
        return;
      }
      // Eight-point star motif: a square and a rotated square.
      const x = lu * 2 - 1;
      const y = lv * 2 - 1;
      const sq = Math.max(Math.abs(x), Math.abs(y));
      const dia = (Math.abs(x) + Math.abs(y)) * Math.SQRT1_2;
      const star = Math.min(sq, dia) / 0.62;
      let r: number, g: number, b: number;
      if (star < 0.62) {
        r = 40; g = 152; b = 160; // turquoise centre
      } else if (star < 1) {
        r = 236; g = 232; b = 220; // white star
      } else {
        r = 26; g = 64; b = 142; // cobalt field
      }
      setRgb(out, r, g, b, 0.96 + sp * 0.08);
      out.h = 0.9 + sp * 0.04;
      out.rough = 0.22 + sp * 0.06;
      out.metal = 0.05;
    },
  };
}

function metalPainter(_seed: number): PainterSpec {
  const F = fields();
  return {
    bump: 3.0,
    ao: 0.7,
    grain: 0.02,
    hasAlpha: false,
    paint: (u, v, out) => {
      const wave = 0.5 + 0.5 * Math.sin(fract(u) * Math.PI * 2 * 10);
      const rm = F.wear.sample(u + 0.61, v + 0.23);
      const f = F.micro.sample(u + 0.1, v + 0.9);
      const rustK = smoothstep(clamp01((rm - 0.55) / 0.15));
      setRgb(out, mix(106, 128, rustK), mix(118, 72, rustK), mix(124, 44, rustK), (0.9 + wave * 0.12) * (0.95 + f * 0.1));
      out.h = 0.3 + wave * 0.6 + rustK * f * 0.1;
      out.rough = mix(0.45 + f * 0.1, 0.9, rustK);
      out.metal = mix(0.85, 0.3, rustK);
    },
  };
}

function fabricPainter(_seed: number): PainterSpec {
  const F = fields();
  return {
    bump: 1.2,
    ao: 0.4,
    grain: 0.02,
    hasAlpha: false,
    paint: (u, v, out) => {
      const stripe = ((fract(u) * 6) | 0) & 1;
      const weave = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 220) * Math.sin(v * Math.PI * 2 * 220);
      const f = F.micro.sample(u + 0.8, v + 0.2);
      const fd = 0.92 + F.broad.sample(u + 0.1, v + 0.7) * 0.12;
      if (stripe) setRgb(out, 186, 62, 52, fd * (0.92 + weave * 0.1 + f * 0.06));
      else setRgb(out, 235, 228, 210, fd * (0.94 + weave * 0.08 + f * 0.04));
      out.h = 0.5 + weave * 0.12 + f * 0.05;
      out.rough = 0.92;
      out.metal = 0;
    },
  };
}

function concretePainter(seed: number): PainterSpec {
  const F = fields();
  const pits = cellFields(60, seed + 3);
  return {
    bump: 2.0,
    ao: 0.9,
    grain: 0.03,
    hasAlpha: false,
    paint: (u, v, out) => {
      const m = F.mid.sample(u + 0.2, v + 0.8);
      const f = F.micro.sample(u + 0.6, v + 0.6);
      const f1 = pits.f1.sample(u, v);
      const pit = f1 < 0.18 && pits.rnd[pits.id.nearest(u, v)] > 0.7 ? 1 - f1 / 0.18 : 0;
      // Formwork seam every half tile.
      const seamD = Math.abs(fract(v * 2) - 0.5);
      const seam = seamD > 0.494 ? 1 : 0;
      const k = (0.94 + m * 0.1) * (0.96 + f * 0.08) * (1 - pit * 0.3) * (1 - seam * 0.15);
      setRgb(out, 150, 150, 146, k);
      out.h = 0.55 + m * 0.08 + f * 0.05 - pit * 0.3 - seam * 0.2;
      out.rough = 0.85 + pit * 0.1;
      out.metal = 0;
    },
  };
}

function waterPainter(_seed: number): PainterSpec {
  const F = fields();
  return {
    bump: 3.5,
    ao: 0,
    grain: 0,
    hasAlpha: true,
    paint: (u, v, out) => {
      const r = F.wear.sample(u + 0.05, v + 0.45);
      const f = F.fine.sample(u + 0.3, v);
      setRgb(out, 38, 78, 88, 0.9 + r * 0.2);
      out.a = 0.86;
      out.h = r * 0.7 + f * 0.3;
      out.rough = 0.06;
      out.metal = 0;
    },
  };
}

function sandPainter(_seed: number): PainterSpec {
  const F = fields();
  return {
    bump: 2.2,
    ao: 0.6,
    grain: 0.05,
    hasAlpha: false,
    paint: (u, v, out) => {
      const d = F.broad.sample(u + 0.9, v + 0.4);
      const rip = 0.5 + 0.5 * Math.sin((u + d * 0.3) * Math.PI * 2 * 14);
      const f = F.micro.sample(u + 0.25, v + 0.75);
      setRgb(out, 212, 188, 142, (0.93 + d * 0.1) * (0.96 + rip * 0.06 + f * 0.04));
      out.h = 0.45 + rip * 0.2 + f * 0.1;
      out.rough = 0.96;
      out.metal = 0;
    },
  };
}

function glassPainter(_seed: number): PainterSpec {
  const F = fields();
  return {
    bump: 0.6,
    ao: 0,
    grain: 0.005,
    hasAlpha: true,
    paint: (u, v, out) => {
      const s = F.broad.sample(u * 0.2, v * 3);
      setRgb(out, 200, 215, 220, 0.96 + s * 0.08);
      out.a = 0.28 + s * 0.08;
      out.h = 0.5 + s * 0.05;
      out.rough = 0.05;
      out.metal = 0;
    },
  };
}

function painterFor(id: MaterialId): PainterSpec | null {
  switch (id) {
    case 'brick': return brickPainter(false, 11);
    case 'brick_dark': return brickPainter(true, 23);
    case 'plaster': return plasterPainter(31, false);
    case 'plaster_worn': return plasterPainter(37, true);
    case 'stone': return stonePainter(41);
    case 'wood': return woodPainter(43);
    case 'lattice': return latticePainter(47);
    case 'roof': return roofPainter(53);
    case 'ground': return groundPainter(59);
    case 'cobble': return cobblePainter(61);
    case 'tile': return tilePainter(67);
    case 'metal': return metalPainter(71);
    case 'fabric': return fabricPainter(73);
    case 'concrete': return concretePainter(79);
    case 'water': return waterPainter(83);
    case 'sand': return sandPainter(89);
    case 'glass': return glassPainter(97);
    case 'invisible': return null;
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Separable wrapping box blur of a square float field (used for AO). */
function boxBlur(src: Float32Array, res: number, radius: number): Float32Array {
  const tmp = new Float32Array(res * res);
  const out = new Float32Array(res * res);
  const inv = 1 / (radius * 2 + 1);
  // wrap[i + radius] = i mod res for i in [-radius, res + radius]: keeps the
  // modulo out of the inner loops.
  const wrap = new Int32Array(res + radius * 2 + 1);
  for (let i = -radius; i <= res + radius; i++) wrap[i + radius] = imod(i, res);
  for (let y = 0; y < res; y++) {
    const row = y * res;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[row + wrap[k + radius]];
    for (let x = 0; x < res; x++) {
      tmp[row + x] = sum * inv;
      sum += src[row + wrap[x + radius * 2 + 1]] - src[row + wrap[x]];
    }
  }
  for (let x = 0; x < res; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[wrap[k + radius] * res + x];
    for (let y = 0; y < res; y++) {
      out[y * res + x] = sum * inv;
      sum += tmp[wrap[y + radius * 2 + 1] * res + x] - tmp[wrap[y] * res + x];
    }
  }
  return out;
}

/** Bilinear ×2 upsample of an RGBA8 buffer (wrapping), with optional grain on RGB. */
function upsample2(src: Uint8Array, res: number, grainAmp: number, seed: number): Uint8Array {
  const size = res * 2;
  const out = new Uint8Array(size * size * 4);
  const white = grainAmp > 0 ? whiteNoise(seed) : null;
  const amp = grainAmp * 255;
  // With pixel centres, output pixel 2k samples the source at k - 0.25 and
  // 2k+1 at k + 0.25, so every output pixel mixes its own source texel (weight
  // 0.75) with the previous/next one (0.25) along each axis.
  const w00 = 0.75 * 0.75, w10 = 0.75 * 0.25, w01 = 0.25 * 0.75, w11 = 0.25 * 0.25;
  for (let y = 0; y < size; y++) {
    const y0 = y >> 1;
    const yb = y & 1 ? (y0 + 1 === res ? 0 : y0 + 1) : (y0 === 0 ? res - 1 : y0 - 1);
    const rMain = y0 * res;
    const rNb = yb * res;
    let o = y * size * 4;
    for (let x = 0; x < size; x++) {
      const x0 = x >> 1;
      const xb = x & 1 ? (x0 + 1 === res ? 0 : x0 + 1) : (x0 === 0 ? res - 1 : x0 - 1);
      const i00 = (rMain + x0) << 2;
      const i10 = (rMain + xb) << 2;
      const i01 = (rNb + x0) << 2;
      const i11 = (rNb + xb) << 2;
      const g = white ? grainAt(white, x, y) * amp : 0;
      let r = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11 + g;
      let gg = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11 + g;
      let b = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11 + g;
      const a = src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11;
      if (r < 0) r = 0; else if (r > 255) r = 255;
      if (gg < 0) gg = 0; else if (gg > 255) gg = 255;
      if (b < 0) b = 0; else if (b > 255) b = 255;
      out[o++] = r;
      out[o++] = gg;
      out[o++] = b;
      out[o++] = a;
    }
  }
  return out;
}

/**
 * Generate the full texture set for a material at `size`×`size`. Returns null
 * for 'invisible'. Deterministic for a given (id, size).
 */
export function generateTextureSet(id: MaterialId, size: number): TextureSet | null {
  const spec = painterFor(id);
  if (!spec) return null;
  if (size < 4 || (size & (size - 1)) !== 0) throw new Error(`texture size must be a power of two ≥ 4, got ${size}`);
  const res = Math.min(size, MAX_PAINT_RES);
  const n = res * res;
  const albedo = new Uint8Array(n * 4);
  const height = new Float32Array(n);
  const rough = new Float32Array(n);
  const metal = new Float32Array(n);
  const s: Surface = { r: 0, g: 0, b: 0, a: 1, h: 0, rough: 1, metal: 0 };
  const seed = id.length * 7919 + id.charCodeAt(0);
  const white = spec.grain > 0 ? whiteNoise(seed) : null;
  const grainAmp = spec.grain * 255;
  const paint = spec.paint;

  for (let y = 0; y < res; y++) {
    const v = (y + 0.5) / res;
    let o = y * res * 4;
    let i = y * res;
    for (let x = 0; x < res; x++, i++) {
      s.a = 1;
      paint((x + 0.5) / res, v, s);
      const g = white ? grainAt(white, x, y) * grainAmp : 0;
      albedo[o++] = clampByte(s.r * 255 + g);
      albedo[o++] = clampByte(s.g * 255 + g);
      albedo[o++] = clampByte(s.b * 255 + g);
      albedo[o++] = clampByte(s.a * 255);
      height[i] = s.h;
      rough[i] = s.rough;
      metal[i] = s.metal;
    }
  }

  // Normals from the height gradient (central differences, wrapping).
  const normal = new Uint8Array(n * 4);
  const strength = spec.bump * (res / 1024) * 0.5;
  for (let y = 0; y < res; y++) {
    const up = (y + 1 === res ? 0 : y + 1) * res;
    const dn = (y === 0 ? res - 1 : y - 1) * res;
    const row = y * res;
    let o = row * 4;
    for (let x = 0; x < res; x++) {
      const xl = x === 0 ? res - 1 : x - 1;
      const xr = x + 1 === res ? 0 : x + 1;
      const dhdu = (height[row + xr] - height[row + xl]) * strength;
      const dhdv = (height[up + x] - height[dn + x]) * strength;
      const inv = 1 / Math.sqrt(dhdu * dhdu + dhdv * dhdv + 1);
      normal[o++] = clampByte((-dhdu * inv * 0.5 + 0.5) * 255);
      normal[o++] = clampByte((-dhdv * inv * 0.5 + 0.5) * 255);
      normal[o++] = clampByte((inv * 0.5 + 0.5) * 255);
      normal[o++] = 255;
    }
  }

  // Ambient occlusion: cavities below the local mean height darken.
  const orm = new Uint8Array(n * 4);
  const blurred = spec.ao > 0 ? boxBlur(height, res, Math.max(1, res >> 7)) : null;
  const aoK = spec.ao * 2.5;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const ao = blurred ? clamp01(1 - aoK * Math.max(0, blurred[i] - height[i])) : 1;
    orm[o] = clampByte(ao * 255);
    orm[o + 1] = clampByte(rough[i] * 255);
    orm[o + 2] = clampByte(metal[i] * 255);
    orm[o + 3] = 255;
  }

  // Only the albedo is carried up to the requested size: normal and ORM detail
  // at the paint resolution is visually sufficient and saves two thirds of the
  // upsample time and GPU memory.
  let albedoOut: Uint8Array = albedo;
  let albedoSize = res;
  while (albedoSize < size) {
    albedoOut = upsample2(albedoOut, albedoSize, spec.grain * 0.6, seed + 17);
    albedoSize *= 2;
  }
  return { id, size: albedoSize, albedo: albedoOut, detailSize: res, normal, orm, hasAlpha: spec.hasAlpha };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

// ---------------------------------------------------------------------------
// Bounded cache so a rematch (or an engine restart) does not regenerate
// everything. 1024² sets are 12 MB each, so the budget keeps memory sane.
// ---------------------------------------------------------------------------

const CACHE_BUDGET_BYTES = 160 * 1024 * 1024;
const setCache = new Map<string, TextureSet>();
let cacheBytes = 0;

function setBytes(set: TextureSet): number {
  return set.albedo.byteLength + set.normal.byteLength + set.orm.byteLength;
}

/** Cached variant of generateTextureSet (LRU by insertion order, byte-bounded). */
export function getTextureSet(id: MaterialId, size: number): TextureSet | null {
  const key = `${id}:${size}`;
  const hit = setCache.get(key);
  if (hit) {
    // Refresh recency.
    setCache.delete(key);
    setCache.set(key, hit);
    return hit;
  }
  const set = generateTextureSet(id, size);
  if (!set) return null;
  cacheTextureSet(set);
  return set;
}

/** Insert a set (e.g. one produced by a worker) into the bounded cache. */
export function cacheTextureSet(set: TextureSet): void {
  const key = `${set.id}:${set.size}`;
  const bytes = setBytes(set);
  if (bytes > CACHE_BUDGET_BYTES) return;
  const existing = setCache.get(key);
  if (existing) {
    setCache.delete(key);
    cacheBytes -= setBytes(existing);
  }
  while (cacheBytes + bytes > CACHE_BUDGET_BYTES && setCache.size) {
    const oldestKey = setCache.keys().next().value as string;
    const oldest = setCache.get(oldestKey)!;
    setCache.delete(oldestKey);
    cacheBytes -= setBytes(oldest);
  }
  setCache.set(key, set);
  cacheBytes += bytes;
}

/** Cached set lookup without generating. */
export function peekTextureSet(id: MaterialId, size: number): TextureSet | null {
  return setCache.get(`${id}:${size}`) ?? null;
}

/** Test/diagnostic hook: drop every cached set. */
export function clearTextureSetCache(): void {
  setCache.clear();
  cacheBytes = 0;
}

// ---------------------------------------------------------------------------
// Small utility sprites (particles, decals, sky) — also raw RGBA buffers.
// ---------------------------------------------------------------------------

/** Soft radial sprite: opaque centre fading to transparent. */
export function generateSoftDisc(size: number, hardness = 0.35): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / c;
      const a = clamp01(1 - smoothstep(clamp01((d - hardness) / (1 - hardness))));
      const o = (y * size + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = 255;
      out[o + 3] = clampByte(a * 255);
    }
  }
  return out;
}

/** Bullet-hole decal: dark crater with a ragged, slightly lighter rim. */
export function generateBulletHole(size: number, seed = 5): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  const f = fbmField(6, 3, seed, 0.5, 128);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const ang = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5;
      const rag = 0.75 + (f.sample(ang * 3, 0.2) - 0.5) * 0.5;
      const d = Math.hypot(dx, dy) / rag;
      const o = (y * size + x) * 4;
      const core = d < 0.42 ? 1 : 0;
      const rim = d < 1 ? clamp01(1 - (d - 0.42) / 0.58) : 0;
      const shade = core ? 18 : 40 + (1 - rim) * 60;
      out[o] = out[o + 1] = out[o + 2] = clampByte(shade + (f.sample(dx, dy) - 0.5) * 30);
      out[o + 3] = clampByte((core ? 1 : rim * rim * 0.85) * 255);
    }
  }
  return out;
}

/** Palm frond: a tapering leaflet silhouette with a central rib, alpha cut-out. */
export function generateFrond(width: number, height: number, seed = 9): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const f = fbmField(8, 2, seed, 0.5, 128);
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1); // along the frond, 0 = base
    const halfW = 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.35) + 0.02;
    for (let x = 0; x < width; x++) {
      const s = (x / (width - 1)) * 2 - 1; // across, -1..1
      const o = (y * width + x) * 4;
      const inside = Math.abs(s) < halfW;
      // Leaflets: alternating gaps along the length, except near the rib.
      const leaflet = Math.abs(s) < 0.05 || ((y * 0.25) | 0) % 2 === 0 || Math.abs(s) < halfW * 0.35;
      const a = inside && leaflet ? 1 : 0;
      const shade = 0.75 + f.sample(s, t * 4) * 0.4 - Math.abs(s) * 0.25;
      out[o] = clampByte(60 * shade);
      out[o + 1] = clampByte(120 * shade);
      out[o + 2] = clampByte(45 * shade);
      out[o + 3] = a * 255;
    }
  }
  return out;
}

/**
 * Sky gradient by elevation only (azimuth-invariant, so it can be wrapped on a
 * sphere without any alignment concern): horizon colour blending into the top
 * colour with altitude, a haze band hugging the horizon, and a darker dusty
 * tone below it. Row 0 is the nadir, the last row the zenith. The sun itself
 * is a separate billboard placed along the sun direction (see Environment).
 */
export function generateSkyGradient(height: number, skyTop: [number, number, number], skyHorizon: [number, number, number]): Uint8Array {
  const width = 2;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1); // 0 = nadir, 1 = zenith
    const dy = Math.sin((v - 0.5) * Math.PI);
    const t = Math.pow(clamp01(dy), 0.55);
    let r = mix(skyHorizon[0], skyTop[0], t);
    let g = mix(skyHorizon[1], skyTop[1], t);
    let b = mix(skyHorizon[2], skyTop[2], t);
    if (dy < 0) {
      const k = Math.max(0.35, 1 + dy * 1.6);
      r *= k; g *= k; b *= k;
    }
    const haze = Math.exp(-Math.abs(dy) * 9) * 0.35;
    r = mix(r, skyHorizon[0] * 1.05, haze);
    g = mix(g, skyHorizon[1] * 1.05, haze);
    b = mix(b, skyHorizon[2] * 1.05, haze);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = clampByte(r * 255);
      out[o + 1] = clampByte(g * 255);
      out[o + 2] = clampByte(b * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Sun sprite: a bright core disc inside a wide soft glow (additive billboard). */
export function generateSunSprite(size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / c; // 0 centre .. 1 edge
      const core = d < 0.11 ? 1 : d < 0.14 ? 1 - (d - 0.11) / 0.03 : 0;
      const glow = Math.exp(-d * d * 9) * 0.55 + Math.exp(-d * 3.5) * 0.25;
      const v = clamp01(core + glow * (1 - core));
      const o = (y * size + x) * 4;
      out[o] = clampByte(v * 255);
      out[o + 1] = clampByte(v * 250);
      out[o + 2] = clampByte(v * 235);
      out[o + 3] = clampByte(v * 255);
    }
  }
  return out;
}

/**
 * One face of a tiny reflection cube: a sky/ground gradient with a broad warm
 * highlight toward the sun. Face order and orientation follow the WebGL cube
 * map convention (+X, -X, +Y, -Y, +Z, -Z).
 */
export function generateEnvironmentFaces(
  size: number,
  skyTop: [number, number, number],
  skyHorizon: [number, number, number],
  ground: [number, number, number],
  sunDir: { x: number; y: number; z: number },
  sunColor: [number, number, number],
): Uint8Array[] {
  const sl = Math.hypot(sunDir.x, sunDir.y, sunDir.z) || 1;
  const sx = sunDir.x / sl, sy = sunDir.y / sl, sz = sunDir.z / sl;
  const faces: Uint8Array[] = [];
  for (let face = 0; face < 6; face++) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      const b = ((y + 0.5) / size) * 2 - 1;
      for (let x = 0; x < size; x++) {
        const a = ((x + 0.5) / size) * 2 - 1;
        let dx: number, dy: number, dz: number;
        switch (face) {
          case 0: dx = 1; dy = -b; dz = -a; break;
          case 1: dx = -1; dy = -b; dz = a; break;
          case 2: dx = a; dy = 1; dz = b; break;
          case 3: dx = a; dy = -1; dz = -b; break;
          case 4: dx = a; dy = -b; dz = 1; break;
          default: dx = -a; dy = -b; dz = -1; break;
        }
        const len = Math.hypot(dx, dy, dz);
        dx /= len; dy /= len; dz /= len;
        const t = Math.pow(clamp01(dy), 0.6);
        let r: number, g: number, bl: number;
        if (dy >= 0) {
          r = mix(skyHorizon[0], skyTop[0], t);
          g = mix(skyHorizon[1], skyTop[1], t);
          bl = mix(skyHorizon[2], skyTop[2], t);
        } else {
          const k = clamp01(-dy * 2.5);
          r = mix(skyHorizon[0], ground[0], k);
          g = mix(skyHorizon[1], ground[1], k);
          bl = mix(skyHorizon[2], ground[2], k);
        }
        const cosA = dx * sx + dy * sy + dz * sz;
        const glow = Math.exp(-(1 - cosA) * 6) * 0.9;
        const o = (y * size + x) * 4;
        data[o] = clampByte((r + sunColor[0] * glow) * 255);
        data[o + 1] = clampByte((g + sunColor[1] * glow) * 255);
        data[o + 2] = clampByte((bl + sunColor[2] * glow) * 255);
        data[o + 3] = 255;
      }
    }
    faces.push(data);
  }
  return faces;
}
