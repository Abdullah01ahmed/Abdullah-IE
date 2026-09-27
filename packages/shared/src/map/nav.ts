/**
 * Bot navigation: a layered walkable grid derived automatically from the
 * collision world, plus A* path finding. Because every map is boxes, sampling
 * a grid of standing positions on every floor level (ground, stairs, rooftops,
 * interiors) gives a reliable navigation graph with no hand placement.
 */
import { MOVEMENT } from '../constants';
import type { AABB, Vec3 } from '../types';
import type { MapDef } from './schema';
import { buildCollisionWorld, overlapsWorld, queryBoxes, type CollisionWorld } from '../sim/collision';

export interface NavNode {
  id: number;
  pos: Vec3;
  /** Grid coordinates. */
  cx: number;
  cz: number;
  /** Neighbour node ids with traversal costs. `jump`: the bot must jump/mantle; `drop`: one-way descent. */
  links: { to: number; cost: number; drop: boolean; jump: boolean }[];
  /** Indoor heuristic: a ceiling within 3.5 m above. */
  covered: boolean;
}

export interface NavGrid {
  nodes: NavNode[];
  cell: number;
  origin: { x: number; z: number };
  cols: number;
  rows: number;
  /** cell index → node ids on that column (different floors). */
  column: Map<number, number[]>;
}

const R = MOVEMENT.capsuleRadius;
const H = MOVEMENT.standHeight;
const STEP = MOVEMENT.stepHeight;
/** Highest ledge a bot will jump/mantle onto (slightly under the sim's mantle height). */
const MAX_JUMP = MOVEMENT.mantleHeight - 0.1;
const MAX_DROP = 3.2;

function colKey(cx: number, cz: number, cols: number): number {
  return cz * cols + cx;
}

/** Build the navigation grid for a map. */
export function buildNavGrid(map: MapDef, world: CollisionWorld = buildCollisionWorld(map), cell = map.navCell || 1): NavGrid {
  const b = map.bounds;
  const origin = { x: b.min.x, z: b.min.z };
  const cols = Math.ceil((b.max.x - b.min.x) / cell);
  const rows = Math.ceil((b.max.z - b.min.z) / cell);
  const nodes: NavNode[] = [];
  const column = new Map<number, number[]>();
  const probe: AABB = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };

  for (let cz = 0; cz < rows; cz++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = origin.x + (cx + 0.5) * cell;
      const z = origin.z + (cz + 0.5) * cell;
      // Candidate floor heights: tops of boxes under this column.
      probe.min.x = x - R; probe.max.x = x + R;
      probe.min.z = z - R; probe.max.z = z + R;
      probe.min.y = b.min.y - 5; probe.max.y = b.max.y + 5;
      const cands = queryBoxes(world, probe);
      const tops = new Set<number>();
      for (const c of cands) {
        if (c.material === 'invisible' && c.tag?.includes('blocker')) continue;
        tops.add(Math.round(c.max.y * 1000) / 1000);
      }
      const ids: number[] = [];
      for (const top of tops) {
        if (top < b.min.y || top > b.max.y) continue;
        // The floor must actually support the footprint centre: a box with this
        // top must contain the centre point in XZ.
        let supported = false;
        for (const c of cands) {
          if (Math.abs(c.max.y - top) < 0.002 && x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z) { supported = true; break; }
        }
        if (!supported) continue;
        // Reject floors buried inside another box (e.g. a lower stair step
        // whose solid fill extends under a higher one).
        let buried = false;
        for (const c of cands) {
          if (c.min.y <= top + 0.01 && c.max.y > top + 0.01 && x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z) { buried = true; break; }
        }
        if (buried) continue;
        // Standing capsule must fit (anything under step height inside the
        // footprint is fine — the sim steps over it).
        probe.min.y = top + STEP + 0.02; probe.max.y = top + H - 0.02;
        probe.min.x = x - R + 0.02; probe.max.x = x + R - 0.02;
        probe.min.z = z - R + 0.02; probe.max.z = z + R - 0.02;
        if (overlapsWorld(world, probe)) continue;
        // Covered? (ceiling within 3.5 m)
        probe.min.y = top + H; probe.max.y = top + H + 3.5;
        const covered = overlapsWorld(world, probe);
        const id = nodes.length;
        nodes.push({ id, pos: { x, y: top, z }, cx, cz, links: [], covered });
        ids.push(id);
      }
      if (ids.length) column.set(colKey(cx, cz, cols), ids);
    }
  }

  const grid: NavGrid = { nodes, cell, origin, cols, rows, column };

  // Link neighbours.
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  for (const n of nodes) {
    for (const [dx, dz] of dirs) {
      const nx = n.cx + dx;
      const nz = n.cz + dz;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      const ids = column.get(colKey(nx, nz, cols));
      if (!ids) continue;
      const diagonal = dx !== 0 && dz !== 0;
      for (const id of ids) {
        const m = nodes[id];
        const dy = m.pos.y - n.pos.y;
        if (dy > MAX_JUMP) continue; // too high even with a mantle
        if (dy < -MAX_DROP) continue; // too far to drop
        const jump = dy > STEP + 0.01;
        const drop = dy < -STEP - 0.01;
        if (diagonal) {
          if (jump || drop) continue;
          // Both orthogonal neighbours must be walkable at a similar height to avoid corner cutting.
          const a = column.get(colKey(n.cx + dx, n.cz, cols));
          const c = column.get(colKey(n.cx, n.cz + dz, cols));
          const ok = (list?: number[]) => !!list && list.some((i) => Math.abs(nodes[i].pos.y - n.pos.y) <= STEP + 0.01);
          if (!ok(a) || !ok(c)) continue;
        }
        // Verify the capsule can move between the two cells at the higher of the two heights.
        if (!drop && !segmentClear(world, n.pos, m.pos)) continue;
        const dist = Math.hypot(m.pos.x - n.pos.x, m.pos.z - n.pos.z);
        const cost = dist + Math.max(0, dy) * 1.5 + (drop ? 1.0 : 0) + (jump ? 2.0 : 0);
        n.links.push({ to: id, cost, drop, jump });
      }
    }
  }
  return grid;
}

/** Check that a standing capsule can slide from a to b (sampled). */
function segmentClear(world: CollisionWorld, a: Vec3, b: Vec3): boolean {
  const steps = 3;
  const probe: AABB = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  const topY = Math.max(a.y, b.y);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    probe.min.x = x - R + 0.03; probe.max.x = x + R - 0.03;
    probe.min.z = z - R + 0.03; probe.max.z = z + R - 0.03;
    probe.min.y = topY + STEP + 0.02; probe.max.y = topY + H - 0.02;
    if (overlapsWorld(world, probe)) return false;
  }
  return true;
}

/** Nearest node to a world position (prefers the same floor level). */
export function nearestNode(grid: NavGrid, pos: Vec3, maxRadius = 3): NavNode | null {
  const cx = Math.floor((pos.x - grid.origin.x) / grid.cell);
  const cz = Math.floor((pos.z - grid.origin.z) / grid.cell);
  const r = Math.ceil(maxRadius / grid.cell);
  let best: NavNode | null = null;
  let bestScore = Infinity;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= grid.cols || z >= grid.rows) continue;
      const ids = grid.column.get(colKey(x, z, grid.cols));
      if (!ids) continue;
      for (const id of ids) {
        const n = grid.nodes[id];
        const dy = pos.y - n.pos.y;
        if (dy < -0.6 || dy > 2.5) continue; // node above the player or far below
        const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z) + Math.abs(dy) * 2;
        if (d < bestScore) { bestScore = d; best = n; }
      }
    }
  }
  return best;
}

class MinHeap {
  private items: { id: number; f: number }[] = [];
  get size(): number { return this.items.length; }
  push(id: number, f: number): void {
    const a = this.items;
    a.push({ id, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { id: number; f: number } | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A* over the nav grid. Returns the node path (inclusive) or null when no path
 * exists. `avoid` optionally penalises node ids (e.g. danger zones).
 */
export function findPath(grid: NavGrid, from: number, to: number, avoid?: (n: NavNode) => number): NavNode[] | null {
  if (from === to) return [grid.nodes[from]];
  const nodes = grid.nodes;
  const goal = nodes[to];
  const g = new Float64Array(nodes.length).fill(Infinity);
  const came = new Int32Array(nodes.length).fill(-1);
  const closed = new Uint8Array(nodes.length);
  const h = (n: NavNode) => Math.hypot(n.pos.x - goal.pos.x, n.pos.z - goal.pos.z) + Math.abs(n.pos.y - goal.pos.y);
  const open = new MinHeap();
  g[from] = 0;
  open.push(from, h(nodes[from]));
  while (open.size) {
    const cur = open.pop()!;
    if (closed[cur.id]) continue;
    if (cur.id === to) break;
    closed[cur.id] = 1;
    const n = nodes[cur.id];
    for (const l of n.links) {
      if (closed[l.to]) continue;
      const m = nodes[l.to];
      const ng = g[cur.id] + l.cost + (avoid ? avoid(m) : 0);
      if (ng < g[l.to]) {
        g[l.to] = ng;
        came[l.to] = cur.id;
        open.push(l.to, ng + h(m));
      }
    }
  }
  if (!Number.isFinite(g[to])) return null;
  const path: NavNode[] = [];
  for (let c = to; c !== -1; c = came[c]) path.push(nodes[c]);
  path.reverse();
  return path;
}

/** Ids of all nodes reachable from `start` (BFS). */
export function reachableFrom(grid: NavGrid, start: number): Set<number> {
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    for (const l of grid.nodes[id].links) {
      if (!seen.has(l.to)) { seen.add(l.to); stack.push(l.to); }
    }
  }
  return seen;
}

/** Largest connected component (by node ids). */
export function largestComponent(grid: NavGrid): Set<number> {
  const visited = new Uint8Array(grid.nodes.length);
  let best = new Set<number>();
  for (const n of grid.nodes) {
    if (visited[n.id]) continue;
    const comp = reachableFrom(grid, n.id);
    for (const id of comp) visited[id] = 1;
    if (comp.size > best.size) best = comp;
  }
  return best;
}

/** Simple string-pull: drop intermediate nodes when the straight line stays walkable. */
export function smoothPath(grid: NavGrid, path: NavNode[], world: CollisionWorld): NavNode[] {
  if (path.length <= 2) return path;
  const out: NavNode[] = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1) {
      const a = path[i];
      const b = path[j];
      if (Math.abs(a.pos.y - b.pos.y) < 0.05 && straightWalkable(world, a.pos, b.pos)) break;
      j--;
    }
    out.push(path[j]);
    i = j;
  }
  return out;
}

function straightWalkable(world: CollisionWorld, a: Vec3, b: Vec3): boolean {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(2, Math.ceil(dist / 0.5));
  const probe: AABB = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    // capsule body clear
    probe.min.x = x - R; probe.max.x = x + R;
    probe.min.z = z - R; probe.max.z = z + R;
    probe.min.y = a.y + STEP; probe.max.y = a.y + H - 0.02;
    if (overlapsWorld(world, probe)) return false;
    // floor present
    probe.min.y = a.y - 0.3; probe.max.y = a.y - 0.001;
    probe.min.x = x - 0.1; probe.max.x = x + 0.1;
    probe.min.z = z - 0.1; probe.max.z = z + 0.1;
    if (!overlapsWorld(world, probe)) return false;
  }
  return true;
}
