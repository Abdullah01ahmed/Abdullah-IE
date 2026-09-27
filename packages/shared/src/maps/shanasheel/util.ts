/**
 * Authoring helpers specific to the Shanasheel level. Everything here reduces
 * to plain MapBlocks / MapProps so the level stays a pure data module.
 *
 * Grid rule used throughout the level: the nav grid samples cell centres at
 * 0.25 mod 0.5 m (bounds start on an integer, cell 0.5). Any narrow wall whose
 * top is between mantle height and the map ceiling must therefore be centred
 * on a multiple of 0.5 m and be at most 0.49 m thick, so no nav node is ever
 * generated on top of it (an unreachable island for bots). Solid masses avoid
 * the problem by being taller than the playable ceiling (MASS_H > bounds.max.y).
 */
import { box, prop } from '../../map/builder';
import type { MapBlock, MapLight, MapProp, MaterialId, SpawnPoint } from '../../map/schema';
import type { BlockOpts } from '../../map/builder';

/** Interior height of ground-floor rooms. */
export const ROOM_H = 2.7;
/** Top of single-storey roofs / balconies / bridges (ROOM_H + slab). */
export const LOW_ROOF = 3.0;
/** Top of the two-storey wings that form rooftop positions. */
export const UPPER_ROOF = 5.6;
/** Playable ceiling: nav ignores any surface above this. */
export const CEILING = 7.4;
/** Minimum height of non-enterable building masses (must exceed CEILING). */
export const MASS_H = 7.6;
/** Height of open courtyard walls. */
export const YARD_WALL = 3.4;
export const WALL_T = 0.4;
export const SLAB_T = 0.3;
export const DOOR_W = 1.4;
export const DOOR_H = 2.3;

export interface Cut {
  /** Absolute coordinate (along the wall axis) where the opening starts. */
  at: number;
  w: number;
  /** Sill height above the wall base. Default 0 (doorway). */
  bottom?: number;
  /** Opening height. Default DOOR_H for doorways, otherwise required. */
  h?: number;
}

/** Doorway cut helper. */
export function door(at: number, w = DOOR_W): Cut {
  return { at, w };
}

/** Window cut helper (shoot-through, not walkable). */
export function win(at: number, w = 1.0, bottom = 1.1, h = 1.1): Cut {
  return { at, w, bottom, h };
}

function segments(from: number, to: number, y: number, h: number, cuts: Cut[]): { a: number; b: number; y0: number; y1: number }[] {
  const out: { a: number; b: number; y0: number; y1: number }[] = [];
  const sorted = cuts.slice().sort((p, q) => p.at - q.at);
  let cursor = from;
  for (const c of sorted) {
    const a = Math.max(from, c.at);
    const b = Math.min(to, c.at + c.w);
    if (b <= a) continue;
    const bottom = c.bottom ?? 0;
    const ch = c.h ?? (bottom > 0 ? h - bottom : DOOR_H);
    if (a > cursor) out.push({ a: cursor, b: a, y0: y, y1: y + h });
    if (bottom > 0) out.push({ a, b, y0: y, y1: y + bottom });
    if (bottom + ch < h) out.push({ a, b, y0: y + bottom + ch, y1: y + h });
    cursor = b;
  }
  if (cursor < to) out.push({ a: cursor, b: to, y0: y, y1: y + h });
  return out.filter((s) => s.b - s.a > 1e-3 && s.y1 - s.y0 > 1e-3);
}

/** Wall running along X, centred on z (thickness t), from x0 to x1. */
export function wallX(z: number, x0: number, x1: number, y: number, h: number, mat: MaterialId, cuts: Cut[] = [], opts: BlockOpts = {}, t = WALL_T): MapBlock[] {
  return segments(x0, x1, y, h, cuts).map((s) =>
    box(s.a, s.y0, z - t / 2, s.b - s.a, s.y1 - s.y0, t, mat, { tag: 'wall', ...opts }),
  );
}

/** Wall running along Z, centred on x (thickness t), from z0 to z1. */
export function wallZ(x: number, z0: number, z1: number, y: number, h: number, mat: MaterialId, cuts: Cut[] = [], opts: BlockOpts = {}, t = WALL_T): MapBlock[] {
  return segments(z0, z1, y, h, cuts).map((s) =>
    box(x - t / 2, s.y0, s.a, t, s.y1 - s.y0, s.b - s.a, mat, { tag: 'wall', ...opts }),
  );
}

/** Solid building mass from ground level (x0..x1 × z0..z1), h tall. */
export function mass(x0: number, z0: number, x1: number, z1: number, h: number, mat: MaterialId, opts: BlockOpts = {}): MapBlock {
  return box(Math.min(x0, x1), 0, Math.min(z0, z1), Math.abs(x1 - x0), h, Math.abs(z1 - z0), mat, { tag: 'mass', ...opts });
}

/** Horizontal slab whose TOP is at `top`, covering x0..x1 × z0..z1. */
export function deck(x0: number, z0: number, x1: number, z1: number, top: number, mat: MaterialId, thickness = SLAB_T, opts: BlockOpts = {}): MapBlock {
  return box(Math.min(x0, x1), top - thickness, Math.min(z0, z1), Math.abs(x1 - x0), thickness, Math.abs(z1 - z0), mat, { tag: 'roof', ...opts });
}

/** Ground material patch, 2 cm proud of the cobbles so it does not z-fight. */
export const PATCH_TOP = 0.02;
export function patch(x0: number, z0: number, x1: number, z1: number, mat: MaterialId, opts: BlockOpts = {}): MapBlock {
  return box(Math.min(x0, x1), -0.28, Math.min(z0, z1), Math.abs(x1 - x0), 0.3, Math.abs(z1 - z0), mat, { tag: 'patch', ...opts });
}

/**
 * Roof parapet piece: 0.2 m thick, 0.9 m high, hugging the INSIDE of the roof
 * edge. `side` is which edge of the rectangle x0..x1 × z0..z1 it sits on and
 * `from`..`to` the span along that edge, so gaps are expressed by omission.
 */
export function parapetPiece(side: 'north' | 'south' | 'east' | 'west', x0: number, z0: number, x1: number, z1: number, top: number, from: number, to: number, mat: MaterialId, h = 0.9): MapBlock {
  const t = 0.2;
  const opts: BlockOpts = { tag: 'parapet' };
  switch (side) {
    case 'south': return box(from, top, z0, to - from, h, t, mat, opts);
    case 'north': return box(from, top, z1 - t, to - from, h, t, mat, opts);
    case 'west': return box(x0, top, from, t, h, to - from, mat, opts);
    case 'east': return box(x1 - t, top, from, t, h, to - from, mat, opts);
  }
}

/** Low cover piece (crate stack, counter, planter, low wall). */
export function lowCover(x0: number, z0: number, x1: number, z1: number, h: number, mat: MaterialId, y = 0, tag = 'cover'): MapBlock {
  return box(Math.min(x0, x1), y, Math.min(z0, z1), Math.abs(x1 - x0), h, Math.abs(z1 - z0), mat, { tag });
}

/** Invisible collision-only block that the nav grid ignores (tag contains 'blocker'). */
export function blocker(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tag = 'blocker'): MapBlock {
  return box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 'invisible', { tag });
}

/** Yaw (degrees) for a spawn at (x, z) to face the point (tx, tz). */
export function facing(x: number, z: number, tx: number, tz: number): number {
  return (Math.atan2(tx - x, tz - z) * 180) / Math.PI;
}

export function spawnFacing(x: number, y: number, z: number, tx: number, tz: number): SpawnPoint {
  return { pos: { x, y, z }, yaw: (facing(x, z, tx, tz) * Math.PI) / 180 };
}

/** Warm lantern: a prop plus a matching map point light. */
export const LANTERN_COLOR: [number, number, number] = [1.0, 0.74, 0.42];
export function lantern(x: number, y: number, z: number, yaw = 0): { prop: MapProp; light: MapLight } {
  return {
    prop: prop('lantern', x, y, z, { yaw }),
    light: { kind: 'point', pos: { x, y: y + 0.35, z }, color: LANTERN_COLOR, intensity: 1.6, range: 9 },
  };
}

const DEG = Math.PI / 180;
/** Prop facing a compass direction: 'north' = faces +Z. */
export function faceDir(dir: 'north' | 'south' | 'east' | 'west'): number {
  return dir === 'north' ? 0 : dir === 'east' ? 90 * DEG : dir === 'south' ? 180 * DEG : -90 * DEG;
}

/** A row of decorative window props along a facade. */
export function windowRow(kind: 'window' | 'shanasheel' | 'door', axis: 'x' | 'z', fixed: number, from: number, to: number, count: number, y: number, dir: 'north' | 'south' | 'east' | 'west'): MapProp[] {
  const out: MapProp[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : (i + 0.5) / count;
    const p = from + (to - from) * t;
    out.push(axis === 'x' ? prop(kind, p, y, fixed, { yaw: faceDir(dir) }) : prop(kind, fixed, y, p, { yaw: faceDir(dir) }));
  }
  return out;
}
