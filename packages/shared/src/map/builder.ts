/**
 * Small helpers for authoring maps in TypeScript. Everything produces MapBlocks
 * (axis-aligned boxes) so collision, navigation and rendering agree.
 */
import type { Vec3 } from '../types';
import type { MapBlock, MapProp, MaterialId, PropKind, SpawnPoint } from './schema';

export interface BlockOpts {
  tag?: string;
  noCollide?: boolean;
  uvScale?: number;
  tint?: [number, number, number];
}

/** Box from min corner and size. */
export function box(
  x: number, y: number, z: number,
  w: number, h: number, d: number,
  material: MaterialId,
  opts: BlockOpts = {},
): MapBlock {
  return {
    min: { x, y, z },
    max: { x: x + w, y: y + h, z: z + d },
    material,
    ...opts,
  };
}

/** Box from explicit min/max corners. */
export function boxMinMax(min: Vec3, max: Vec3, material: MaterialId, opts: BlockOpts = {}): MapBlock {
  return {
    min: { x: Math.min(min.x, max.x), y: Math.min(min.y, max.y), z: Math.min(min.z, max.z) },
    max: { x: Math.max(min.x, max.x), y: Math.max(min.y, max.y), z: Math.max(min.z, max.z) },
    material,
    ...opts,
  };
}

/** Horizontal slab (floor / roof / ceiling). */
export function slab(x: number, y: number, z: number, w: number, d: number, material: MaterialId, thickness = 0.3, opts: BlockOpts = {}): MapBlock {
  return box(x, y - thickness, z, w, thickness, d, material, opts);
}

/**
 * Four walls around a rectangular footprint (no floor/roof). Openings are cut
 * by giving `openings` for a side: each opening is [start, width, bottom, height]
 * measured along that side from its min corner.
 */
export interface WallOpening {
  /** Offset along the wall from its starting corner (m). */
  at: number;
  width: number;
  /** Bottom of the opening above `y` (m). Default 0 (a doorway). */
  bottom?: number;
  /** Height of the opening. Default = wall height - bottom (full-height cut). */
  height?: number;
}

export interface RoomWallsOpts extends BlockOpts {
  thickness?: number;
  openings?: Partial<Record<'north' | 'south' | 'east' | 'west', WallOpening[]>>;
}

/**
 * Walls of a room whose interior footprint is [x, x+w] × [z, z+d], from y to y+h.
 * Walls are placed OUTSIDE the footprint so the interior stays exactly w × d.
 * north = +Z side, south = -Z side, east = +X side, west = -X side.
 */
export function roomWalls(
  x: number, y: number, z: number, w: number, h: number, d: number,
  material: MaterialId,
  opts: RoomWallsOpts = {},
): MapBlock[] {
  const t = opts.thickness ?? 0.4;
  const { thickness: _t, openings, ...blockOpts } = opts;
  const out: MapBlock[] = [];
  // Each wall is described by its axis-aligned segment; we split around openings.
  const sides = [
    { side: 'south' as const, axis: 'x' as const, from: x - t, to: x + w + t, fixedMin: z - t, fixedMax: z },
    { side: 'north' as const, axis: 'x' as const, from: x - t, to: x + w + t, fixedMin: z + d, fixedMax: z + d + t },
    { side: 'west' as const, axis: 'z' as const, from: z, to: z + d, fixedMin: x - t, fixedMax: x },
    { side: 'east' as const, axis: 'z' as const, from: z, to: z + d, fixedMin: x + w, fixedMax: x + w + t },
  ];
  for (const s of sides) {
    const ops = (openings?.[s.side] ?? []).slice().sort((a, b) => a.at - b.at);
    const segments: { from: number; to: number; yFrom: number; yTo: number }[] = [];
    let cursor = s.from;
    const len = s.to - s.from;
    for (const op of ops) {
      const oFrom = s.from + op.at;
      const oTo = Math.min(s.to, oFrom + op.width);
      const bottom = op.bottom ?? 0;
      const height = op.height ?? h - bottom;
      if (oFrom > cursor) segments.push({ from: cursor, to: oFrom, yFrom: y, yTo: y + h });
      // Wall below the opening (sill) and above it (lintel)
      if (bottom > 0) segments.push({ from: oFrom, to: oTo, yFrom: y, yTo: y + bottom });
      if (bottom + height < h) segments.push({ from: oFrom, to: oTo, yFrom: y + bottom + height, yTo: y + h });
      cursor = oTo;
    }
    if (cursor < s.from + len) segments.push({ from: cursor, to: s.to, yFrom: y, yTo: y + h });
    for (const seg of segments) {
      if (seg.to - seg.from <= 0.001 || seg.yTo - seg.yFrom <= 0.001) continue;
      if (s.axis === 'x') {
        out.push(boxMinMax({ x: seg.from, y: seg.yFrom, z: s.fixedMin }, { x: seg.to, y: seg.yTo, z: s.fixedMax }, material, { ...blockOpts, tag: blockOpts.tag ?? `wall-${s.side}` }));
      } else {
        out.push(boxMinMax({ x: s.fixedMin, y: seg.yFrom, z: seg.from }, { x: s.fixedMax, y: seg.yTo, z: seg.to }, material, { ...blockOpts, tag: blockOpts.tag ?? `wall-${s.side}` }));
      }
    }
  }
  return out;
}

export type Dir = 'north' | 'south' | 'east' | 'west';

/**
 * A straight staircase. `x,y,z` is the bottom-front-left corner of the first
 * step; `dir` is the direction of ascent; `width` is across the direction of
 * travel; `rise` total height; `run` total horizontal length. Steps are
 * 0.2–0.25 m tall so the step-up logic (0.45 m) climbs them, and a solid
 * wedge-fill block underneath makes the underside solid.
 */
export function stairs(
  x: number, y: number, z: number,
  dir: Dir, width: number, rise: number, run: number,
  material: MaterialId,
  opts: BlockOpts = {},
): MapBlock[] {
  const steps = Math.max(1, Math.round(rise / 0.22));
  const stepH = rise / steps;
  const stepD = run / steps;
  const out: MapBlock[] = [];
  for (let i = 0; i < steps; i++) {
    const h = stepH * (i + 1);
    // Each step block spans from the step's front edge to the top of the stair (solid fill).
    const along0 = stepD * i;
    const along1 = run;
    let bx: number, bz: number, bw: number, bd: number;
    switch (dir) {
      case 'north': bx = x; bz = z + along0; bw = width; bd = along1 - along0; break;
      case 'south': bx = x; bz = z - along1; bw = width; bd = along1 - along0; break;
      case 'east': bx = x + along0; bz = z; bw = along1 - along0; bd = width; break;
      case 'west': bx = x - along1; bz = z; bw = along1 - along0; bd = width; break;
    }
    out.push(box(bx, y, bz, bw, h, bd, material, { ...opts, tag: opts.tag ?? 'stairs' }));
  }
  return out;
}

/** Simple column/pillar. */
export function pillar(x: number, y: number, z: number, size: number, h: number, material: MaterialId, opts: BlockOpts = {}): MapBlock {
  return box(x - size / 2, y, z - size / 2, size, h, size, material, { ...opts, tag: opts.tag ?? 'pillar' });
}

/**
 * An arch opening approximated as two piers and a lintel. Returns blocks for a
 * wall segment of `length` along `axis` at position (x, y, z) with total height
 * `h`, leaving an opening of `openW` × `openH` centred along the segment.
 */
export function archWall(
  x: number, y: number, z: number,
  axis: 'x' | 'z', length: number, h: number, thickness: number,
  openW: number, openH: number,
  material: MaterialId,
  opts: BlockOpts = {},
): MapBlock[] {
  const pierLen = Math.max(0, (length - openW) / 2);
  const out: MapBlock[] = [];
  if (axis === 'x') {
    if (pierLen > 0) {
      out.push(box(x, y, z, pierLen, h, thickness, material, opts));
      out.push(box(x + length - pierLen, y, z, pierLen, h, thickness, material, opts));
    }
    if (openH < h) out.push(box(x + pierLen, y + openH, z, openW, h - openH, thickness, material, { ...opts, tag: opts.tag ?? 'lintel' }));
  } else {
    if (pierLen > 0) {
      out.push(box(x, y, z, thickness, h, pierLen, material, opts));
      out.push(box(x, y, z + length - pierLen, thickness, h, pierLen, material, opts));
    }
    if (openH < h) out.push(box(x, y + openH, z + pierLen, thickness, h - openH, openW, material, { ...opts, tag: opts.tag ?? 'lintel' }));
  }
  return out;
}

/** Low cover block (crate stack, low wall, planter). */
export function cover(x: number, y: number, z: number, w: number, d: number, material: MaterialId, h = 1.0, opts: BlockOpts = {}): MapBlock {
  return box(x, y, z, w, h, d, material, { ...opts, tag: opts.tag ?? 'cover' });
}

/** Parapet around a roof edge (four low walls just inside the footprint). */
export function parapet(x: number, y: number, z: number, w: number, d: number, material: MaterialId, h = 0.9, t = 0.25, opts: BlockOpts = {}): MapBlock[] {
  const tag = opts.tag ?? 'parapet';
  return [
    box(x, y, z, w, h, t, material, { ...opts, tag }),
    box(x, y, z + d - t, w, h, t, material, { ...opts, tag }),
    box(x, y, z + t, t, h, d - 2 * t, material, { ...opts, tag }),
    box(x + w - t, y, z + t, t, h, d - 2 * t, material, { ...opts, tag }),
  ];
}

/** Spawn point helper. */
export function spawn(x: number, y: number, z: number, yawDeg: number): SpawnPoint {
  return { pos: { x, y, z }, yaw: (yawDeg * Math.PI) / 180 };
}

/** Prop helper. */
export function prop(kind: PropKind, x: number, y: number, z: number, extra: Omit<MapProp, 'kind' | 'pos'> = {}): MapProp {
  return { kind, pos: { x, y, z }, ...extra };
}

/**
 * Default footprint (half-extents and height) per prop kind, used to derive
 * collision boxes for props that block movement.
 */
export const PROP_FOOTPRINT: Record<PropKind, { hx: number; hz: number; h: number; collide: boolean }> = {
  palm: { hx: 0.25, hz: 0.25, h: 6, collide: true },
  lantern: { hx: 0.15, hz: 0.15, h: 0.5, collide: false },
  table: { hx: 0.45, hz: 0.45, h: 0.75, collide: true },
  chair: { hx: 0.25, hz: 0.25, h: 0.9, collide: true },
  rug: { hx: 1.0, hz: 1.6, h: 0.02, collide: false },
  awning: { hx: 1.5, hz: 1.0, h: 0.1, collide: false },
  pot: { hx: 0.3, hz: 0.3, h: 0.7, collide: true },
  crate: { hx: 0.5, hz: 0.5, h: 1.0, collide: true },
  barrel: { hx: 0.32, hz: 0.32, h: 0.95, collide: true },
  sign: { hx: 0.8, hz: 0.05, h: 0.5, collide: false },
  door: { hx: 0.5, hz: 0.05, h: 2.2, collide: false },
  window: { hx: 0.5, hz: 0.05, h: 1.2, collide: false },
  arch: { hx: 1.2, hz: 0.3, h: 3.2, collide: false },
  teapot: { hx: 0.1, hz: 0.1, h: 0.2, collide: false },
  bicycle: { hx: 0.9, hz: 0.2, h: 1.0, collide: true },
  sacks: { hx: 0.6, hz: 0.6, h: 0.8, collide: true },
  cloth_line: { hx: 2.0, hz: 0.05, h: 0.6, collide: false },
  shanasheel: { hx: 1.2, hz: 0.6, h: 2.6, collide: false },
  fountain: { hx: 1.4, hz: 1.4, h: 0.9, collide: true },
  bench: { hx: 0.9, hz: 0.3, h: 0.5, collide: true },
  antenna: { hx: 0.05, hz: 0.05, h: 2.5, collide: false },
  ac_unit: { hx: 0.4, hz: 0.3, h: 0.5, collide: false },
  satellite_dish: { hx: 0.4, hz: 0.4, h: 0.9, collide: false },
  water_tank: { hx: 0.6, hz: 0.6, h: 1.2, collide: true },
  flag: { hx: 0.05, hz: 0.05, h: 3, collide: false },
};

/** Collision box for a prop, or null if it does not collide. */
export function propCollider(p: MapProp): MapBlock | null {
  const fp = PROP_FOOTPRINT[p.kind];
  const collide = p.collide ?? fp.collide;
  if (!collide) return null;
  const s = p.scale ?? 1;
  return {
    min: { x: p.pos.x - fp.hx * s, y: p.pos.y, z: p.pos.z - fp.hz * s },
    max: { x: p.pos.x + fp.hx * s, y: p.pos.y + fp.h * s, z: p.pos.z + fp.hz * s },
    material: 'wood',
    tag: `prop-${p.kind}`,
  };
}
