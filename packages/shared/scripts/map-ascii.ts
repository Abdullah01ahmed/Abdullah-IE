/**
 * ASCII top-down dump of a map for layout review.
 *
 *   npx tsx packages/shared/scripts/map-ascii.ts shanasheel [cell=1] [--nav] [--level=<y>] [--stats]
 *
 * Default view: highest solid surface per cell, classified by height so alleys,
 * rooms, low roofs and rooftops read at a glance. `--nav` colours cells by nav
 * reachability instead (walkable ground, elevated, unreachable islands), which
 * is the quickest way to find gaps and floating surfaces. `--level=Y` shows
 * only what is walkable at (roughly) that height. `--stats` prints spawn-to-
 * square path lengths per team and the longest eye-level sightline.
 */
import {
  MOVEMENT,
  buildCollisionWorld,
  buildNavGrid,
  findPath,
  floorHeightAt,
  largestComponent,
  lineOfSight,
  nearestNode,
  playerFits,
  queryBoxes,
  getMap,
  type MapDef,
  type NavGrid,
  type Vec3,
} from '../src';

const args = process.argv.slice(2);
const mapId = args.find((a) => !a.startsWith('--') && !/^\d/.test(a)) ?? 'shanasheel';
const cellArg = args.find((a) => /^\d+(\.\d+)?$/.test(a));
const cell = cellArg ? Number(cellArg) : 1;
const showNav = args.includes('--nav');
const showStats = args.includes('--stats');
const levelArg = args.find((a) => a.startsWith('--level='));
const level = levelArg ? Number(levelArg.slice('--level='.length)) : null;

const map = getMap(mapId);
if (!map) {
  console.error(`Unknown map '${mapId}'.`);
  process.exit(1);
}

export function renderHeightMap(m: MapDef, size: number): string[] {
  const world = buildCollisionWorld(m);
  const b = m.bounds;
  const cols = Math.ceil((b.max.x - b.min.x) / size);
  const rows = Math.ceil((b.max.z - b.min.z) / size);
  const lines: string[] = [];
  const probe = { min: { x: 0, y: -100, z: 0 }, max: { x: 0, y: 100, z: 0 } };
  const glyph = (top: number): string => {
    if (top > b.max.y) return '#'; // building mass / perimeter
    if (top >= 5.5) return 'R'; // rooftop level
    if (top >= 2.6) return 'r'; // low roof / bridge / balcony
    if (top >= 1.3) return 'w'; // wall you cannot climb
    if (top >= 0.4) return 'o'; // cover / stairs
    return '.'; // ground
  };
  for (let r = rows - 1; r >= 0; r--) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const x = b.min.x + (c + 0.5) * size;
      const z = b.min.z + (r + 0.5) * size;
      probe.min.x = x - 0.05; probe.max.x = x + 0.05;
      probe.min.z = z - 0.05; probe.max.z = z + 0.05;
      let top = -Infinity;
      for (const box of queryBoxes(world, probe)) {
        if (box.material === 'invisible') continue;
        if (level !== null && box.max.y > level + 0.3) continue;
        top = Math.max(top, box.max.y);
      }
      line += Number.isFinite(top) ? glyph(top) : ' ';
    }
    lines.push(line);
  }
  return lines;
}

export function renderNavMap(m: MapDef, size: number): { lines: string[]; grid: NavGrid; unreachable: number } {
  const world = buildCollisionWorld(m);
  const grid = buildNavGrid(m, world);
  const main = largestComponent(grid);
  const b = m.bounds;
  const cols = Math.ceil((b.max.x - b.min.x) / size);
  const rows = Math.ceil((b.max.z - b.min.z) / size);
  // Bucket nodes per display cell.
  const cellsOf = new Map<number, { reach: boolean; y: number }[]>();
  for (const n of grid.nodes) {
    if (level !== null && Math.abs(n.pos.y - level) > 0.6) continue;
    const c = Math.floor((n.pos.x - b.min.x) / size);
    const r = Math.floor((n.pos.z - b.min.z) / size);
    const k = r * cols + c;
    let list = cellsOf.get(k);
    if (!list) cellsOf.set(k, (list = []));
    list.push({ reach: main.has(n.id), y: n.pos.y });
  }
  const lines: string[] = [];
  for (let r = rows - 1; r >= 0; r--) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const list = cellsOf.get(r * cols + c);
      if (!list) { line += ' '; continue; }
      if (list.some((n) => !n.reach)) { line += 'X'; continue; } // unreachable island
      const y = Math.max(...list.map((n) => n.y));
      line += y >= 5.5 ? 'R' : y >= 2.6 ? 'r' : y >= 0.4 ? 'o' : '.';
    }
    lines.push(line);
  }
  const unreachable = grid.nodes.length - main.size;
  return { lines, grid, unreachable };
}

function overlayMarkers(lines: string[], m: MapDef, size: number): void {
  const b = m.bounds;
  const put = (p: Vec3, ch: string) => {
    const c = Math.floor((p.x - b.min.x) / size);
    const r = Math.floor((p.z - b.min.z) / size);
    const row = lines.length - 1 - r;
    if (row < 0 || row >= lines.length || c < 0 || c >= lines[row].length) return;
    lines[row] = lines[row].slice(0, c) + ch + lines[row].slice(c + 1);
  };
  for (const s of m.spawns.tigris) put(s.pos, 'T');
  for (const s of m.spawns.euphrates) put(s.pos, 'E');
  for (const s of m.spawns.neutral) put(s.pos, 'N');
}

const header = `${map.name} (${map.id}) — ${showNav ? 'nav reachability' : 'height map'}, ${cell} m per character` +
  (level !== null ? `, level ≈ ${level} m` : '');
console.log(header);
console.log('legend: # mass  R rooftop  r low roof  w wall  o cover/stairs  . ground  T/E/N spawns' + (showNav ? '  X unreachable nav node' : ''));
let lines: string[];
if (showNav) {
  const nav = renderNavMap(map, cell);
  lines = nav.lines;
  overlayMarkers(lines, map, cell);
  console.log(lines.join('\n'));
  console.log(`nav: ${nav.grid.nodes.length} nodes, ${nav.unreachable} outside the main component`);
  for (const [team, list] of Object.entries(map.spawns)) {
    for (const s of list) {
      const n = nearestNode(nav.grid, s.pos);
      const d = n ? Math.hypot(n.pos.x - s.pos.x, n.pos.z - s.pos.z) : Infinity;
      if (!n || d > 1) console.log(`  !! ${team} spawn at (${s.pos.x}, ${s.pos.z}) has no nav node within 1 m`);
    }
  }
} else {
  lines = renderHeightMap(map, cell);
  overlayMarkers(lines, map, cell);
  console.log(lines.join('\n'));
}
console.log(`blocks: ${map.blocks.length}, props: ${map.props.length}, lights: ${map.lights.length}`);
if (showStats) printStats(map);

/** Path fairness and sightline figures used when tuning the layout. */
function printStats(m: MapDef): void {
  const world = buildCollisionWorld(m);
  const grid = buildNavGrid(m, world);
  const centre = { x: (m.bounds.min.x + m.bounds.max.x) / 2, y: 0, z: (m.bounds.min.z + m.bounds.max.z) / 2 };
  const goal = nearestNode(grid, centre, 6);
  if (!goal) { console.log('stats: no nav node near the map centre'); return; }
  const pathLen = (from: Vec3): number => {
    const a = nearestNode(grid, from, 2);
    const path = a ? findPath(grid, a.id, goal.id) : null;
    if (!path) return NaN;
    let len = 0;
    for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].pos.x - path[i - 1].pos.x, path[i].pos.z - path[i - 1].pos.z) + Math.abs(path[i].pos.y - path[i - 1].pos.y);
    return len;
  };
  for (const team of ['tigris', 'euphrates'] as const) {
    const lens = m.spawns[team].map((s) => pathLen(s.pos));
    const mean = lens.reduce((p, q) => p + q, 0) / lens.length;
    console.log(`${team}: path to centre ${lens.map((l) => l.toFixed(1)).join(' / ')} m (mean ${mean.toFixed(1)} m ≈ ${(mean / MOVEMENT.sprintSpeed).toFixed(1)} s sprint)`);
  }
  let longest = 0;
  let where = '';
  const eyeY = MOVEMENT.eyeHeightStand;
  for (let x = m.bounds.min.x + 1; x < m.bounds.max.x; x += 1) {
    for (let z = m.bounds.min.z + 1; z < m.bounds.max.z; z += 1) {
      const pos = { x, y: 0, z };
      if (!playerFits(world, pos, 'stand') || floorHeightAt(world, pos, 0.1).y !== 0) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        let d = 4;
        while (d < 80 && lineOfSight(world, { x, y: eyeY, z }, { x: x + dx * d, y: eyeY, z: z + dz * d })) d += 1;
        if (d > longest) { longest = d; where = `(${x}, ${z}) towards (${dx}, ${dz})`; }
      }
    }
  }
  console.log(`longest axis-aligned eye-level sightline: ${longest} m from ${where}`);
}
