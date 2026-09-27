/**
 * Procedural PBR texture sets for every map material. Everything is generated
 * in code (no image files), which keeps licensing clean and lets quality scale
 * with a single "size" parameter.
 *
 * A set is three RGBA8 buffers:
 *   albedo  — sRGB colour (+ alpha for cut-out / blended materials)
 *   normal  — tangent-space normal derived from the painted height field
 *             (OpenGL layout: +R = +u, +G = +v; see Materials.ts for the flags
 *             Babylon needs with this layout)
 *   orm     — R = ambient occlusion, G = roughness, B = metallic
 *
 * Painters run in tile space (u, v ∈ [0, 1) across one texture repeat) so the
 * result tiles seamlessly, and world-aligned UVs in the map renderer decide how
 * many metres one repeat covers.
 *
 * Cost control: the height/colour pass runs at most at 1024²; larger sizes are
 * bilinearly upsampled with per-pixel grain added to the albedo so 2048² sets
 * do not look soft. Generated sets are cached (bounded) so a rematch is fast.
 */
import type { MaterialId } from '@tra/shared';
import { Fbm, cellular, clamp01, grain, hash2, mix, pmod, smoothstep, type CellSample } from './noise';

export interface TextureSet {
  id: MaterialId;
  size: number;
  albedo: Uint8Array;
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
const MAX_PAINT_RES = 1024;

// ---------------------------------------------------------------------------
// Helpers shared by painters
// ---------------------------------------------------------------------------

const cell: CellSample = { f1: 0, f2: 0, id: 0 };

function setRgb(out: Surface, r: number, g: number, b: number, k = 1): void {
  out.r = clamp01((r / 255) * k);
  out.g = clamp01((g / 255) * k);
  out.b = clamp01((b / 255) * k);
}

interface BrickSample {
  mortar: boolean;
  /** Stable per-brick random in [0, 1). */
  rnd: number;
  rnd2: number;
  /** 0 at the mortar line rising to 1 inside the brick face (bevel profile). */
  bevel: number;
  /** Local brick coordinates 0..1. */
  bu: number;
  bv: number;
}

const brickOut: BrickSample = { mortar: false, rnd: 0, rnd2: 0, bevel: 0, bu: 0, bv: 0 };

/** Running-bond brick layout. `cols`/`rows` bricks per tile, `mortar` in tile units. */
function brickLayout(u: number, v: number, cols: number, rows: number, mortar: number, bevelW: number, seed: number): BrickSample {
  const rowF = pmod(v, 1) * rows;
  const row = Math.floor(rowF);
  const rv = rowF - row;
  const colF = pmod(u, 1) * cols + (row & 1 ? 0.5 : 0);
  const col = Math.floor(colF);
  const cu = colF - col;
  const du = Math.min(cu, 1 - cu) / cols;
  const dv = Math.min(rv, 1 - rv) / rows;
  const edge = Math.min(du, dv) - mortar / 2;
  brickOut.mortar = edge < 0;
  brickOut.bevel = edge < 0 ? 0 : smoothstep(Math.min(1, edge / bevelW));
  brickOut.rnd = hash2(pmod(col, cols), row, seed);
  brickOut.rnd2 = hash2(pmod(col, cols), row, seed + 977);
  brickOut.bu = cu;
  brickOut.bv = rv;
  return brickOut;
}

// ---------------------------------------------------------------------------
// Painters
// ---------------------------------------------------------------------------

function brickPainter(dark: boolean, seed: number): PainterSpec {
  const grainF = new Fbm(16, 3, seed + 1);
  const pitsF = new Fbm(48, 2, seed + 2);
  const broad = new Fbm(3, 2, seed + 3);
  const base = dark ? [142, 100, 70] : [206, 172, 118];
  const mortarC = dark ? [124, 112, 96] : [170, 160, 140];
  return {
    bump: 3.2,
    ao: 1.4,
    grain: 0.035,
    hasAlpha: false,
    paint: (u, v, out) => {
      const b = brickLayout(u, v, 4, 13, 0.012, 0.012, seed);
      const g = grainF.at(u, v);
      const pits = pitsF.at(u, v);
      if (b.mortar) {
        const k = 0.9 + g * 0.2;
        setRgb(out, mortarC[0], mortarC[1], mortarC[2], k);
        out.h = 0.22 + g * 0.1;
        out.rough = 0.95;
        out.metal = 0;
        return;
      }
      // Per-brick tone: warm/cool shift, occasional darker (over-fired) bricks.
      const lum = (dark ? 0.78 : 0.86) + b.rnd * (dark ? 0.4 : 0.26);
      const warm = (b.rnd2 - 0.5) * 22;
      const burnt = b.rnd > (dark ? 0.82 : 0.92) ? 0.78 : 1;
      const chip = pits > 0.72 ? smoothstep((pits - 0.72) / 0.1) : 0;
      const tone = lum * burnt * (0.92 + g * 0.16) * (1 - chip * 0.25) * (0.94 + broad.at(u, v) * 0.12);
      setRgb(out, base[0] + warm, base[1] + warm * 0.5, base[2] - warm * 0.3, tone);
      out.h = 0.55 + b.bevel * 0.4 + g * 0.06 - chip * 0.35;
      out.rough = 0.8 + g * 0.12 + chip * 0.1;
      out.metal = 0;
    },
  };
}

function plasterPainter(seed: number, worn: boolean): PainterSpec {
  const mottle = new Fbm(6, 4, seed + 1);
  const fine = new Fbm(24, 3, seed + 2);
  const broadF = new Fbm(3, 2, seed + 3);
  const crackMask = new Fbm(4, 2, seed + 4);
  const wearMask = new Fbm(3, 4, seed + 5, 0.55);
  const brick = brickPainter(false, seed + 6);
  return {
    bump: worn ? 4.5 : 2.2,
    ao: worn ? 1.6 : 0.8,
    grain: 0.02,
    hasAlpha: false,
    paint: (u, v, out) => {
      if (worn) {
        // Flaked patches reveal the brick beneath (the tile is 2 m so brick
        // coordinates run twice as fast).
        const m = wearMask.at(u, v);
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
          const k = 1.02 - t * 0.1;
          setRgb(out, 222, 206, 180, k);
          out.h = 0.75 + (1 - t) * 0.2;
          out.rough = 0.85;
          out.metal = 0;
          return;
        }
      }
      const mo = mottle.at(u, v);
      const f = fine.at(u, v);
      let k = 0.94 + mo * 0.12;
      let h = 0.6 + f * 0.18 + broadF.at(u, v) * 0.1;
      // Sparse hairline cracks.
      if (crackMask.at(u, v) > 0.58) {
        cellular(u, v, 5, seed + 9, cell);
        const gap = cell.f2 - cell.f1;
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
  const g = new Fbm(20, 3, seed + 1);
  const broad = new Fbm(2, 2, seed + 2);
  return {
    bump: 3.5,
    ao: 1.3,
    grain: 0.03,
    hasAlpha: false,
    paint: (u, v, out) => {
      const b = brickLayout(u, v, 2, 4, 0.008, 0.02, seed);
      const gr = g.at(u, v);
      if (b.mortar) {
        setRgb(out, 150, 140, 122, 0.9 + gr * 0.2);
        out.h = 0.25;
        out.rough = 0.95;
        out.metal = 0;
        return;
      }
      cellular(u * 1.5, v * 1.5, 24, seed + 3, cell);
      const chisel = cell.f1 < 0.4 ? (1 - cell.f1 / 0.4) * 0.5 : 0;
      const lum = 0.9 + b.rnd * 0.18;
      const k = lum * (0.94 + gr * 0.12 - chisel * 0.12) * (0.95 + broad.at(u, v) * 0.1);
      setRgb(out, 184 + (b.rnd2 - 0.5) * 14, 168, 142 - (b.rnd2 - 0.5) * 10, k);
      out.h = 0.5 + b.bevel * 0.4 + gr * 0.08 - chisel * 0.18;
      out.rough = 0.7 + gr * 0.15 + chisel * 0.1;
      out.metal = 0;
    },
  };
}

function woodPainter(seed: number): PainterSpec {
  const grainF = new Fbm(6, 4, seed + 1, 0.6);
  const fine = new Fbm(64, 2, seed + 2);
  const planks = 8;
  return {
    bump: 2.4,
    ao: 0.9,
    grain: 0.025,
    hasAlpha: false,
    paint: (u, v, out) => {
      const pf = pmod(u, 1) * planks;
      const plank = Math.floor(pf);
      const pu = pf - plank;
      const gap = Math.min(pu, 1 - pu) / planks;
      const id = hash2(plank, 0, seed);
      // Grain: noise stretched along the plank (v) with a per-plank offset.
      const gval = grainF.at(u * 3 + id * 5, v * 0.18 + id);
      const rings = 0.5 + 0.5 * Math.cos((gval * 7 + v * 0.6 + id * 3) * Math.PI * 2);
      const band = smoothstep(rings);
      const f = fine.at(u, v);
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

function latticePainter(seed: number): PainterSpec {
  const fine = new Fbm(32, 2, seed + 1);
  const cells = 6;
  const bar = 0.16; // fraction of a cell
  return {
    bump: 4,
    ao: 0.6,
    grain: 0.02,
    hasAlpha: true,
    paint: (u, v, out) => {
      const cu = pmod(u, 1) * cells;
      const cv = pmod(v, 1) * cells;
      const lu = cu - Math.floor(cu);
      const lv = cv - Math.floor(cv);
      // Orthogonal bars along the cell borders + a diamond lattice through
      // the cell centre: the classic turned-wood mashrabiya look.
      const dOrtho = Math.min(Math.min(lu, 1 - lu), Math.min(lv, 1 - lv));
      const dDiag = Math.min(Math.abs(lu - lv), Math.abs(lu + lv - 1)) * Math.SQRT1_2;
      const d = Math.min(dOrtho, dDiag);
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
      const near = Math.hypot(Math.min(lu, 1 - lu), Math.min(lv, 1 - lv));
      const bead = near < bar * 0.8 ? 1 : 0;
      const f = fine.at(u, v);
      setRgb(out, 98, 64, 38, (0.85 + profile * 0.3 + bead * 0.15) * (0.95 + f * 0.1));
      out.a = 1;
      out.h = 0.3 + profile * 0.6 + bead * 0.1;
      out.rough = 0.6;
      out.metal = 0;
    },
  };
}

function roofPainter(seed: number): PainterSpec {
  const mottle = new Fbm(5, 4, seed + 1);
  const fine = new Fbm(40, 2, seed + 2);
  const stain = new Fbm(2, 2, seed + 3);
  return {
    bump: 2.6,
    ao: 1.2,
    grain: 0.03,
    hasAlpha: false,
    paint: (u, v, out) => {
      cellular(u, v, 6, seed + 4, cell);
      const gap = cell.f2 - cell.f1;
      const crack = gap < 0.03 ? 1 - gap / 0.03 : 0;
      const m = mottle.at(u, v);
      const f = fine.at(u, v);
      const st = stain.at(u, v);
      const k = (0.92 + m * 0.14) * (1 - crack * 0.4) * (1 - Math.max(0, st - 0.55) * 0.5) * (0.96 + f * 0.08);
      setRgb(out, 188, 168, 138, k);
      out.h = 0.6 + f * 0.1 + m * 0.1 - crack * 0.4;
      out.rough = 0.9;
      out.metal = 0;
    },
  };
}

function groundPainter(seed: number): PainterSpec {
  const mottle = new Fbm(8, 4, seed + 1);
  const fine = new Fbm(48, 2, seed + 2);
  return {
    bump: 2.8,
    ao: 1.0,
    grain: 0.04,
    hasAlpha: false,
    paint: (u, v, out) => {
      const m = mottle.at(u, v);
      const f = fine.at(u, v);
      cellular(u, v, 40, seed + 3, cell);
      const isPebble = cell.f1 < 0.28 && hash2(cell.id, 1, seed) > 0.62;
      const pebble = isPebble ? 1 - cell.f1 / 0.28 : 0;
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
  const g = new Fbm(24, 3, seed + 1);
  const wear = new Fbm(2, 3, seed + 2);
  return {
    bump: 4.2,
    ao: 1.8,
    grain: 0.03,
    hasAlpha: false,
    paint: (u, v, out) => {
      cellular(u, v, 9, seed + 3, cell);
      const gap = cell.f2 - cell.f1;
      const stone = smoothstep(clamp01((gap - 0.03) / 0.14));
      const gr = g.at(u, v);
      const w = wear.at(u, v);
      const id = hash2(cell.id, 3, seed);
      const id2 = hash2(cell.id, 5, seed);
      if (stone < 0.02) {
        setRgb(out, 108, 94, 74, 0.9 + gr * 0.2);
        out.h = 0.1 + gr * 0.05;
        out.rough = 0.95;
        out.metal = 0;
        return;
      }
      const dome = stone * (1 - cell.f1 * 0.45);
      const k = (0.86 + id * 0.28) * (0.94 + gr * 0.12) * (0.92 + w * 0.14);
      const hueShift = (id2 - 0.5) * 18;
      // Blend stone colour toward the dirt colour at the stone's edge.
      const sr = mix(108, 146 + hueShift, stone);
      const sg = mix(94, 134, stone);
      const sb = mix(74, 116 - hueShift, stone);
      setRgb(out, sr, sg, sb, k);
      out.h = 0.1 + dome * 0.85 + gr * 0.05;
      out.rough = mix(0.95, 0.68 + gr * 0.15, stone);
      out.metal = 0;
    },
  };
}

function tilePainter(seed: number): PainterSpec {
  const speck = new Fbm(64, 2, seed + 1);
  const n = 5;
  const grout = 0.012;
  return {
    bump: 2.0,
    ao: 1.0,
    grain: 0.01,
    hasAlpha: false,
    paint: (u, v, out) => {
      const tu = pmod(u, 1) * n;
      const tv = pmod(v, 1) * n;
      const lu = tu - Math.floor(tu);
      const lv = tv - Math.floor(tv);
      const edge = Math.min(Math.min(lu, 1 - lu), Math.min(lv, 1 - lv)) / n;
      const sp = speck.at(u, v);
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
      const star = Math.min(sq / 0.62, dia / 0.62);
      let r: number, g: number, b: number;
      if (star < 0.62) {
        r = 40; g = 152; b = 160; // turquoise centre
      } else if (star < 1) {
        r = 236; g = 232; b = 220; // white star
      } else {
        r = 26; g = 64; b = 142; // cobalt field
      }
      const glaze = 0.96 + sp * 0.08;
      setRgb(out, r, g, b, glaze);
      out.h = 0.9 + sp * 0.04;
      out.rough = 0.22 + sp * 0.06;
      out.metal = 0.05;
    },
  };
}

function metalPainter(seed: number): PainterSpec {
  const rust = new Fbm(5, 4, seed + 1, 0.55);
  const fine = new Fbm(48, 2, seed + 2);
  return {
    bump: 3.0,
    ao: 0.7,
    grain: 0.02,
    hasAlpha: false,
    paint: (u, v, out) => {
      const wave = 0.5 + 0.5 * Math.sin(pmod(u, 1) * Math.PI * 2 * 10);
      const rm = rust.at(u, v);
      const f = fine.at(u, v);
      const rustK = smoothstep(clamp01((rm - 0.55) / 0.15));
      const pr = mix(106, 128, rustK);
      const pg = mix(118, 72, rustK);
      const pb = mix(124, 44, rustK);
      setRgb(out, pr, pg, pb, (0.9 + wave * 0.12) * (0.95 + f * 0.1));
      out.h = 0.3 + wave * 0.6 + rustK * f * 0.1;
      out.rough = mix(0.45 + f * 0.1, 0.9, rustK);
      out.metal = mix(0.85, 0.3, rustK);
    },
  };
}

function fabricPainter(seed: number): PainterSpec {
  const fine = new Fbm(80, 2, seed + 1);
  const fade = new Fbm(3, 2, seed + 2);
  return {
    bump: 1.2,
    ao: 0.4,
    grain: 0.02,
    hasAlpha: false,
    paint: (u, v, out) => {
      const stripe = Math.floor(pmod(u, 1) * 6) & 1;
      const weave = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 220) * Math.sin(v * Math.PI * 2 * 220);
      const f = fine.at(u, v);
      const fd = 0.92 + fade.at(u, v) * 0.12;
      if (stripe) setRgb(out, 186, 62, 52, fd * (0.92 + weave * 0.1 + f * 0.06));
      else setRgb(out, 235, 228, 210, fd * (0.94 + weave * 0.08 + f * 0.04));
      out.h = 0.5 + weave * 0.12 + f * 0.05;
      out.rough = 0.92;
      out.metal = 0;
    },
  };
}

function concretePainter(seed: number): PainterSpec {
  const mottle = new Fbm(6, 4, seed + 1);
  const fine = new Fbm(56, 2, seed + 2);
  return {
    bump: 2.0,
    ao: 0.9,
    grain: 0.03,
    hasAlpha: false,
    paint: (u, v, out) => {
      const m = mottle.at(u, v);
      const f = fine.at(u, v);
      cellular(u, v, 60, seed + 3, cell);
      const pit = cell.f1 < 0.18 && hash2(cell.id, 2, seed) > 0.7 ? 1 - cell.f1 / 0.18 : 0;
      // Formwork seam every half tile.
      const seam = Math.abs(pmod(v, 0.5) - 0.25) > 0.247 ? 1 : 0;
      const k = (0.94 + m * 0.1) * (0.96 + f * 0.08) * (1 - pit * 0.3) * (1 - seam * 0.15);
      setRgb(out, 150, 150, 146, k);
      out.h = 0.55 + m * 0.08 + f * 0.05 - pit * 0.3 - seam * 0.2;
      out.rough = 0.85 + pit * 0.1;
      out.metal = 0;
    },
  };
}

function waterPainter(seed: number): PainterSpec {
  const ripple = new Fbm(6, 4, seed + 1, 0.55);
  const fine = new Fbm(24, 2, seed + 2);
  return {
    bump: 3.5,
    ao: 0,
    grain: 0,
    hasAlpha: true,
    paint: (u, v, out) => {
      const r = ripple.at(u, v);
      const f = fine.at(u + 0.3, v);
      setRgb(out, 38, 78, 88, 0.9 + r * 0.2);
      out.a = 0.86;
      out.h = r * 0.7 + f * 0.3;
      out.rough = 0.06;
      out.metal = 0;
    },
  };
}

function sandPainter(seed: number): PainterSpec {
  const dune = new Fbm(4, 3, seed + 1);
  const fine = new Fbm(64, 2, seed + 2);
  return {
    bump: 2.2,
    ao: 0.6,
    grain: 0.05,
    hasAlpha: false,
    paint: (u, v, out) => {
      const d = dune.at(u, v);
      const rip = 0.5 + 0.5 * Math.sin((u + d * 0.3) * Math.PI * 2 * 14);
      const f = fine.at(u, v);
      setRgb(out, 212, 188, 142, (0.93 + d * 0.1) * (0.96 + rip * 0.06 + f * 0.04));
      out.h = 0.45 + rip * 0.2 + f * 0.1;
      out.rough = 0.96;
      out.metal = 0;
    },
  };
}

function glassPainter(seed: number): PainterSpec {
  const streak = new Fbm(3, 3, seed + 1);
  return {
    bump: 0.6,
    ao: 0,
    grain: 0.005,
    hasAlpha: true,
    paint: (u, v, out) => {
      const s = streak.at(u * 0.2, v * 3);
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
  for (let y = 0; y < res; y++) {
    const row = y * res;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[row + pmod(k, res)];
    for (let x = 0; x < res; x++) {
      tmp[row + x] = sum * inv;
      sum += src[row + pmod(x + radius + 1, res)] - src[row + pmod(x - radius, res)];
    }
  }
  for (let x = 0; x < res; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[pmod(k, res) * res + x];
    for (let y = 0; y < res; y++) {
      out[y * res + x] = sum * inv;
      sum += tmp[pmod(y + radius + 1, res) * res + x] - tmp[pmod(y - radius, res) * res + x];
    }
  }
  return out;
}

/** Bilinear ×2 upsample of an RGBA8 buffer (wrapping), with optional grain on RGB. */
function upsample2(src: Uint8Array, res: number, grainAmp: number, seed: number): Uint8Array {
  const size = res * 2;
  const out = new Uint8Array(size * size * 4);
  const amp = grainAmp * 255;
  for (let y = 0; y < size; y++) {
    const fy = (y + 0.5) / 2 - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const r0 = pmod(y0, res) * res;
    const r1 = pmod(y0 + 1, res) * res;
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) / 2 - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const c00 = (r0 + pmod(x0, res)) * 4;
      const c10 = (r0 + pmod(x0 + 1, res)) * 4;
      const c01 = (r1 + pmod(x0, res)) * 4;
      const c11 = (r1 + pmod(x0 + 1, res)) * 4;
      const o = (y * size + x) * 4;
      const g = amp ? grain(x, y, seed) * amp : 0;
      for (let c = 0; c < 4; c++) {
        const top = src[c00 + c] + (src[c10 + c] - src[c00 + c]) * tx;
        const bot = src[c01 + c] + (src[c11 + c] - src[c01 + c]) * tx;
        let val = top + (bot - top) * ty;
        if (c < 3) val += g;
        out[o + c] = val < 0 ? 0 : val > 255 ? 255 : val;
      }
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
  const grainAmp = spec.grain * 255;

  for (let y = 0; y < res; y++) {
    const v = (y + 0.5) / res;
    for (let x = 0; x < res; x++) {
      const u = (x + 0.5) / res;
      s.a = 1;
      spec.paint(u, v, s);
      const i = y * res + x;
      const g = grainAmp ? grain(x, y, seed) * grainAmp : 0;
      const o = i * 4;
      albedo[o] = clampByte(s.r * 255 + g);
      albedo[o + 1] = clampByte(s.g * 255 + g);
      albedo[o + 2] = clampByte(s.b * 255 + g);
      albedo[o + 3] = clampByte(s.a * 255);
      height[i] = s.h;
      rough[i] = s.rough;
      metal[i] = s.metal;
    }
  }

  // Normals from the height gradient (central differences, wrapping).
  const normal = new Uint8Array(n * 4);
  const strength = spec.bump * (res / 1024) * 0.5;
  for (let y = 0; y < res; y++) {
    const up = pmod(y + 1, res) * res;
    const dn = pmod(y - 1, res) * res;
    const row = y * res;
    for (let x = 0; x < res; x++) {
      const xl = pmod(x - 1, res);
      const xr = pmod(x + 1, res);
      const dhdu = (height[row + xr] - height[row + xl]) * strength;
      const dhdv = (height[up + x] - height[dn + x]) * strength;
      const inv = 1 / Math.sqrt(dhdu * dhdu + dhdv * dhdv + 1);
      const o = (row + x) * 4;
      normal[o] = clampByte((-dhdu * inv * 0.5 + 0.5) * 255);
      normal[o + 1] = clampByte((-dhdv * inv * 0.5 + 0.5) * 255);
      normal[o + 2] = clampByte((inv * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;
    }
  }

  // Ambient occlusion: cavities below the local mean height darken.
  const orm = new Uint8Array(n * 4);
  const blurred = spec.ao > 0 ? boxBlur(height, res, Math.max(1, res >> 7)) : null;
  for (let i = 0; i < n; i++) {
    const ao = blurred ? clamp01(1 - spec.ao * Math.max(0, blurred[i] - height[i]) * 2.5) : 1;
    const o = i * 4;
    orm[o] = clampByte(ao * 255);
    orm[o + 1] = clampByte(rough[i] * 255);
    orm[o + 2] = clampByte(metal[i] * 255);
    orm[o + 3] = 255;
  }

  let set: TextureSet = { id, size: res, albedo, normal, orm, hasAlpha: spec.hasAlpha };
  while (set.size < size) {
    set = {
      id,
      size: set.size * 2,
      albedo: upsample2(set.albedo, set.size, spec.grain * 0.6, seed + 17),
      normal: upsample2(set.normal, set.size, 0, 0),
      orm: upsample2(set.orm, set.size, 0, 0),
      hasAlpha: spec.hasAlpha,
    };
  }
  return set;
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
  const bytes = setBytes(set);
  if (bytes <= CACHE_BUDGET_BYTES) {
    while (cacheBytes + bytes > CACHE_BUDGET_BYTES && setCache.size) {
      const oldestKey = setCache.keys().next().value as string;
      const oldest = setCache.get(oldestKey)!;
      setCache.delete(oldestKey);
      cacheBytes -= setBytes(oldest);
    }
    setCache.set(key, set);
    cacheBytes += bytes;
  }
  return set;
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
  const f = new Fbm(6, 3, seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const ang = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5;
      const rag = 0.75 + (f.at(ang * 3, 0.2) - 0.5) * 0.5;
      const d = Math.hypot(dx, dy) / rag;
      const o = (y * size + x) * 4;
      const core = d < 0.42 ? 1 : 0;
      const rim = d < 1 ? clamp01(1 - (d - 0.42) / 0.58) : 0;
      const shade = core ? 18 : 40 + (1 - rim) * 60;
      out[o] = out[o + 1] = out[o + 2] = clampByte(shade + (f.at(dx, dy) - 0.5) * 30);
      out[o + 3] = clampByte((core ? 1 : rim * rim * 0.85) * 255);
    }
  }
  return out;
}

/** Palm frond: a tapering leaflet silhouette with a central rib, alpha cut-out. */
export function generateFrond(width: number, height: number, seed = 9): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const f = new Fbm(8, 2, seed);
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
      const shade = 0.75 + f.at(s, t * 4) * 0.4 - Math.abs(s) * 0.25;
      out[o] = clampByte(60 * shade);
      out[o + 1] = clampByte(120 * shade);
      out[o + 2] = clampByte(45 * shade);
      out[o + 3] = a * 255;
    }
  }
  return out;
}

/**
 * Equirectangular sky: vertical gradient, sun disc with a glow, and a haze band
 * near the horizon. Direction convention matches Babylon's sphere UVs.
 */
export function generateSky(
  width: number,
  height: number,
  skyTop: [number, number, number],
  skyHorizon: [number, number, number],
  sunDir: { x: number; y: number; z: number },
  sunColor: [number, number, number],
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const sl = Math.hypot(sunDir.x, sunDir.y, sunDir.z) || 1;
  const sx = sunDir.x / sl, sy = sunDir.y / sl, sz = sunDir.z / sl;
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1); // 0 = bottom (nadir), 1 = top (zenith)
    const el = (v - 0.5) * Math.PI; // elevation
    const ce = Math.cos(el);
    const dy = Math.sin(el);
    const above = clamp01(dy);
    // Sky gradient: horizon colour blends into the top colour with altitude;
    // below the horizon it darkens toward a dusty ground tone.
    const t = Math.pow(above, 0.55);
    let r = mix(skyHorizon[0], skyTop[0], t);
    let g = mix(skyHorizon[1], skyTop[1], t);
    let b = mix(skyHorizon[2], skyTop[2], t);
    if (dy < 0) {
      const k = 1 + dy * 1.6;
      r *= Math.max(0.35, k); g *= Math.max(0.35, k); b *= Math.max(0.35, k);
    }
    // Haze band hugging the horizon.
    const haze = Math.exp(-Math.abs(dy) * 9) * 0.35;
    r = mix(r, skyHorizon[0] * 1.05, haze);
    g = mix(g, skyHorizon[1] * 1.05, haze);
    b = mix(b, skyHorizon[2] * 1.05, haze);
    for (let x = 0; x < width; x++) {
      const az = (x / width) * Math.PI * 2 - Math.PI;
      const dx = Math.sin(az) * ce;
      const dz = Math.cos(az) * ce;
      const cosA = dx * sx + dy * sy + dz * sz;
      const ang = Math.acos(Math.min(1, Math.max(-1, cosA)));
      const disc = ang < 0.028 ? 1 : 0;
      const glow = Math.exp(-ang * ang * 40) * 0.9 + Math.exp(-ang * 2.2) * 0.35;
      const o = (y * width + x) * 4;
      const pr = r + sunColor[0] * glow + disc * 2.5;
      const pg = g + sunColor[1] * glow + disc * 2.2;
      const pb = b + sunColor[2] * glow + disc * 1.8;
      // Store in a soft-clipped 0..255 range; the material adds HDR emissive scale.
      out[o] = clampByte(tone(pr) * 255);
      out[o + 1] = clampByte(tone(pg) * 255);
      out[o + 2] = clampByte(tone(pb) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

function tone(x: number): number {
  return x <= 0 ? 0 : x / (1 + x * 0.35) * 1.05;
}
