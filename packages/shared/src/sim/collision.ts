/**
 * Static collision world: a set of axis-aligned boxes in a uniform grid.
 * Used by movement (capsule ≈ box sweep), hitscan (ray) and navigation.
 */
import { aabbOverlaps, rayAABB } from '../math';
import type { AABB, Vec3 } from '../types';
import type { MapDef, MaterialId } from '../map/schema';
import { collisionBlocks } from '../map/schema';
import { propCollider } from '../map/builder';

export interface WorldBox extends AABB {
  material: MaterialId;
  tag?: string;
  index: number;
}

export interface CollisionWorld {
  boxes: WorldBox[];
  bounds: AABB;
  killZ: number;
  cellSize: number;
  /** Grid cell key → indices into boxes. */
  grid: Map<number, number[]>;
  gridMin: { x: number; z: number };
  gridCols: number;
  gridRows: number;
}

const GRID_CELL = 4;

function cellKey(cx: number, cz: number, cols: number): number {
  return cz * cols + cx;
}

/** Build a collision world from a map definition (blocks + colliding props). */
export function buildCollisionWorld(map: MapDef): CollisionWorld {
  const boxes: WorldBox[] = [];
  let i = 0;
  for (const b of collisionBlocks(map)) {
    boxes.push({ min: { ...b.min }, max: { ...b.max }, material: b.material, tag: b.tag, index: i++ });
  }
  for (const p of map.props) {
    const c = propCollider(p);
    if (c) boxes.push({ min: c.min, max: c.max, material: c.material, tag: c.tag, index: i++ });
  }
  return buildWorldFromBoxes(boxes, map.bounds, map.killZ);
}

export function buildWorldFromBoxes(boxes: WorldBox[], bounds: AABB, killZ: number): CollisionWorld {
  // Pad the grid so boxes slightly outside the bounds are still indexed.
  const pad = 8;
  const gridMin = { x: bounds.min.x - pad, z: bounds.min.z - pad };
  const gridCols = Math.max(1, Math.ceil((bounds.max.x + pad - gridMin.x) / GRID_CELL));
  const gridRows = Math.max(1, Math.ceil((bounds.max.z + pad - gridMin.z) / GRID_CELL));
  const grid = new Map<number, number[]>();
  const world: CollisionWorld = { boxes, bounds, killZ, cellSize: GRID_CELL, grid, gridMin, gridCols, gridRows };
  for (const b of boxes) {
    const cx0 = clampCell(Math.floor((b.min.x - gridMin.x) / GRID_CELL), gridCols);
    const cx1 = clampCell(Math.floor((b.max.x - gridMin.x) / GRID_CELL), gridCols);
    const cz0 = clampCell(Math.floor((b.min.z - gridMin.z) / GRID_CELL), gridRows);
    const cz1 = clampCell(Math.floor((b.max.z - gridMin.z) / GRID_CELL), gridRows);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = cellKey(cx, cz, gridCols);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(b.index);
      }
    }
  }
  return world;
}

function clampCell(c: number, n: number): number {
  return c < 0 ? 0 : c >= n ? n - 1 : c;
}

/** Iterate candidate boxes overlapping a query AABB (XZ grid broadphase). */
export function queryBoxes(world: CollisionWorld, q: AABB, out: WorldBox[] = []): WorldBox[] {
  out.length = 0;
  const { gridMin, gridCols, gridRows, cellSize } = world;
  const cx0 = clampCell(Math.floor((q.min.x - gridMin.x) / cellSize), gridCols);
  const cx1 = clampCell(Math.floor((q.max.x - gridMin.x) / cellSize), gridCols);
  const cz0 = clampCell(Math.floor((q.min.z - gridMin.z) / cellSize), gridRows);
  const cz1 = clampCell(Math.floor((q.max.z - gridMin.z) / cellSize), gridRows);
  const seen = new Set<number>();
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const list = world.grid.get(cellKey(cx, cz, gridCols));
      if (!list) continue;
      for (const idx of list) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        const b = world.boxes[idx];
        if (aabbOverlaps(b, q)) out.push(b);
      }
    }
  }
  return out;
}

/** True if any solid box overlaps the given AABB. */
export function overlapsWorld(world: CollisionWorld, q: AABB): boolean {
  const { gridMin, gridCols, gridRows, cellSize } = world;
  const cx0 = clampCell(Math.floor((q.min.x - gridMin.x) / cellSize), gridCols);
  const cx1 = clampCell(Math.floor((q.max.x - gridMin.x) / cellSize), gridCols);
  const cz0 = clampCell(Math.floor((q.min.z - gridMin.z) / cellSize), gridRows);
  const cz1 = clampCell(Math.floor((q.max.z - gridMin.z) / cellSize), gridRows);
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const list = world.grid.get(cellKey(cx, cz, gridCols));
      if (!list) continue;
      for (const idx of list) {
        if (aabbOverlaps(world.boxes[idx], q)) return true;
      }
    }
  }
  return false;
}

export interface WorldRayHit {
  t: number;
  point: Vec3;
  normal: Vec3;
  box: WorldBox;
}

/**
 * Cast a ray against the world. Walks the XZ grid cells the ray crosses (DDA)
 * and tests boxes in each; returns the nearest hit within maxDist or null.
 */
export function raycastWorld(world: CollisionWorld, origin: Vec3, dir: Vec3, maxDist: number): WorldRayHit | null {
  const { gridMin, gridCols, gridRows, cellSize } = world;
  let best: WorldRayHit | null = null;
  let bestT = maxDist;
  const tested = new Set<number>();

  const testCell = (cx: number, cz: number): void => {
    if (cx < 0 || cz < 0 || cx >= gridCols || cz >= gridRows) return;
    const list = world.grid.get(cellKey(cx, cz, gridCols));
    if (!list) return;
    for (const idx of list) {
      if (tested.has(idx)) continue;
      tested.add(idx);
      const b = world.boxes[idx];
      const hit = rayAABB(origin, dir, b, bestT);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        best = {
          t: hit.t,
          point: { x: origin.x + dir.x * hit.t, y: origin.y + dir.y * hit.t, z: origin.z + dir.z * hit.t },
          normal: hit.normal,
          box: b,
        };
      }
    }
  };

  // 2D DDA over XZ.
  let cx = Math.floor((origin.x - gridMin.x) / cellSize);
  let cz = Math.floor((origin.z - gridMin.z) / cellSize);
  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(cellSize / dir.x) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(cellSize / dir.z) : Infinity;
  const nextBoundaryX = gridMin.x + (cx + (stepX > 0 ? 1 : 0)) * cellSize;
  const nextBoundaryZ = gridMin.z + (cz + (stepZ > 0 ? 1 : 0)) * cellSize;
  let tMaxX = stepX !== 0 ? (nextBoundaryX - origin.x) / dir.x : Infinity;
  let tMaxZ = stepZ !== 0 ? (nextBoundaryZ - origin.z) / dir.z : Infinity;
  let t = 0;
  // Guard against origins outside the grid: clamp the starting cell and let the
  // per-cell bounds check handle the rest.
  let guard = gridCols + gridRows + 4;
  while (t <= bestT && guard-- > 0) {
    testCell(cx, cz);
    // Once the ray has crossed a cell boundary further than the current best
    // hit, no later cell can contain a closer hit.
    if (tMaxX < tMaxZ) {
      t = tMaxX;
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      cz += stepZ;
    }
    if (t > bestT) break;
    if ((stepX === 0 && stepZ === 0)) break;
    if (cx < -1 || cz < -1 || cx > gridCols || cz > gridRows) break;
  }
  return best;
}

/** True if the segment from a to b is unobstructed by the world. */
export function lineOfSight(world: CollisionWorld, a: Vec3, b: Vec3): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return true;
  const dir = { x: dx / len, y: dy / len, z: dz / len };
  return raycastWorld(world, a, dir, len - 1e-3) === null;
}

/**
 * Find the floor height directly below a point: the highest box top that is at
 * or below `pos.y + tolerance` within the XZ footprint of radius r. Returns
 * -Infinity if there is no floor.
 */
export function floorHeightAt(world: CollisionWorld, pos: Vec3, r: number, tolerance = 0.05): { y: number; box: WorldBox | null } {
  const q: AABB = {
    min: { x: pos.x - r, y: -1e9, z: pos.z - r },
    max: { x: pos.x + r, y: pos.y + tolerance, z: pos.z + r },
  };
  const cands = queryBoxes(world, q);
  let best = -Infinity;
  let bestBox: WorldBox | null = null;
  for (const b of cands) {
    if (b.max.y <= pos.y + tolerance && b.max.y > best) {
      best = b.max.y;
      bestBox = b;
    }
  }
  return { y: best, box: bestBox };
}
