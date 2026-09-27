import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  MOVEMENT,
  PROP_FOOTPRINT,
  buildCollisionWorld,
  buildNavGrid,
  findPath,
  floorHeightAt,
  largestComponent,
  lineOfSight,
  nearestNode,
  playerFits,
  reachableFrom,
  shanasheel,
  type NavGrid,
  type NavNode,
  type SpawnPoint,
  type Vec3,
} from '../src';
import { SHANASHEEL_ROOFTOPS, SHANASHEEL_SQUARE_CENTRE } from '../src/maps/shanasheel';

const map = shanasheel;
const world = buildCollisionWorld(map);
const grid = buildNavGrid(map, world);
const main = largestComponent(grid);
const EYE = MOVEMENT.eyeHeightStand;

const allSpawns: { team: string; sp: SpawnPoint }[] = [
  ...map.spawns.tigris.map((sp) => ({ team: 'tigris', sp })),
  ...map.spawns.euphrates.map((sp) => ({ team: 'euphrates', sp })),
  ...map.spawns.neutral.map((sp) => ({ team: 'neutral', sp })),
];

const eye = (p: Vec3): Vec3 => ({ x: p.x, y: p.y + EYE, z: p.z });
const label = (p: Vec3) => `(${p.x}, ${p.y}, ${p.z})`;

function nodeAt(p: Vec3): NavNode {
  const n = nearestNode(grid, p, 1.5);
  expect(n, `no nav node near ${label(p)}`).not.toBeNull();
  return n!;
}

/** Path length in metres along the nav graph (sum of link costs without penalties). */
function pathLength(g: NavGrid, from: NavNode, to: NavNode): number {
  const path = findPath(g, from.id, to.id);
  expect(path, `no path from ${label(from.pos)} to ${label(to.pos)}`).not.toBeNull();
  let len = 0;
  for (let i = 1; i < path!.length; i++) {
    const a = path![i - 1].pos;
    const b = path![i].pos;
    len += Math.hypot(b.x - a.x, b.z - a.z) + Math.abs(b.y - a.y);
  }
  return len;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

describe('shanasheel: data integrity', () => {
  it('has positive block sizes, a sane bounds/killZ pair and metadata in both languages', () => {
    for (const b of map.blocks) {
      expect(b.max.x - b.min.x, `block ${b.tag ?? b.material} width`).toBeGreaterThan(0);
      expect(b.max.y - b.min.y, `block ${b.tag ?? b.material} height`).toBeGreaterThan(0);
      expect(b.max.z - b.min.z, `block ${b.tag ?? b.material} depth`).toBeGreaterThan(0);
    }
    expect(map.killZ).toBeLessThan(map.bounds.min.y);
    expect(map.bounds.max.y - map.bounds.min.y).toBeGreaterThan(6);
    for (const key of ['name', 'nameAr', 'location', 'locationAr', 'description', 'descriptionAr', 'notes'] as const) {
      expect(map[key], key).toBeTruthy();
    }
    expect(map.notes).toContain('npx tsx packages/shared/scripts/map-ascii.ts shanasheel');
    expect(map.atmosphere.ambience).toBe('old_city');
  });

  it('keeps block and prop counts within the performance budget', () => {
    expect(map.blocks.length).toBeGreaterThan(200);
    expect(map.blocks.length).toBeLessThanOrEqual(1200);
    expect(map.props.length).toBeGreaterThan(100);
    expect(map.props.length).toBeLessThanOrEqual(300);
  });

  it('places every spawn and prop inside the bounds', () => {
    const inside = (p: Vec3) =>
      p.x >= map.bounds.min.x && p.x <= map.bounds.max.x &&
      p.z >= map.bounds.min.z && p.z <= map.bounds.max.z &&
      p.y >= map.bounds.min.y && p.y <= map.bounds.max.y;
    for (const { team, sp } of allSpawns) expect(inside(sp.pos), `${team} spawn ${label(sp.pos)}`).toBe(true);
    for (const p of map.props) expect(inside(p.pos), `${p.kind} at ${label(p.pos)}`).toBe(true);
  });

  it('gives every sign non-empty Arabic text and uses only known prop kinds', () => {
    const arabic = /[؀-ۿ]/;
    const signs = map.props.filter((p) => p.kind === 'sign');
    expect(signs.length).toBeGreaterThanOrEqual(6);
    for (const s of signs) {
      expect(s.text, `sign at ${label(s.pos)}`).toBeTruthy();
      expect(arabic.test(s.text!), `sign '${s.text}' is not Arabic`).toBe(true);
    }
    for (const p of map.props) expect(PROP_FOOTPRINT[p.kind], `unknown prop kind ${p.kind}`).toBeDefined();
  });

  it('has exactly five spawns per team, 1.5 m apart, plus five neutral fallbacks and spawn-protect zones', () => {
    expect(map.spawns.tigris).toHaveLength(5);
    expect(map.spawns.euphrates).toHaveLength(5);
    expect(map.spawns.neutral).toHaveLength(5);
    for (const list of [map.spawns.tigris, map.spawns.euphrates, map.spawns.neutral]) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const d = Math.hypot(list[i].pos.x - list[j].pos.x, list[i].pos.z - list[j].pos.z);
          expect(d, `spawns ${i}/${j} too close`).toBeGreaterThanOrEqual(1.5);
        }
      }
    }
    const protect = map.zones.filter((z) => z.kind === 'spawn_protect');
    expect(protect.map((z) => z.team).sort()).toEqual(['euphrates', 'tigris']);
    for (const z of protect) {
      for (const sp of map.spawns[z.team!]) {
        expect(sp.pos.x).toBeGreaterThan(z.box.min.x);
        expect(sp.pos.x).toBeLessThan(z.box.max.x);
        expect(sp.pos.z).toBeGreaterThan(z.box.min.z);
        expect(sp.pos.z).toBeLessThan(z.box.max.z);
      }
    }
    // Team spawns face into the map (towards the square).
    for (const sp of map.spawns.tigris) expect(Math.sin(sp.yaw)).toBeGreaterThan(0.5);
    for (const sp of map.spawns.euphrates) expect(Math.sin(sp.yaw)).toBeLessThan(-0.5);
  });

  it('lights the alleys with warm lanterns', () => {
    expect(map.lights.length).toBeGreaterThanOrEqual(15);
    expect(map.lights.length).toBeLessThanOrEqual(30);
    for (const l of map.lights) {
      expect(l.color[0]).toBeGreaterThan(l.color[2]); // warm: more red than blue
    }
    expect(map.props.filter((p) => p.kind === 'lantern').length).toBeGreaterThanOrEqual(15);
  });
});

describe('shanasheel: collision and navigation', () => {
  it('builds a nav grid whose main component holds ≥ 95 % of the nodes', () => {
    expect(grid.nodes.length).toBeGreaterThan(4000);
    expect(grid.nodes.length).toBeLessThan(20000);
    const share = main.size / grid.nodes.length;
    expect(share, `${grid.nodes.length - main.size} of ${grid.nodes.length} nodes are unreachable`).toBeGreaterThanOrEqual(0.95);
  });

  it('has every spawn standing on the floor with room to stand, on the main nav component', () => {
    for (const { team, sp } of allSpawns) {
      expect(playerFits(world, sp.pos, 'stand'), `${team} spawn ${label(sp.pos)} overlaps geometry`).toBe(true);
      const floor = floorHeightAt(world, sp.pos, MOVEMENT.capsuleRadius * 0.5);
      expect(Math.abs(floor.y - sp.pos.y), `${team} spawn ${label(sp.pos)} floats ${floor.y}`).toBeLessThanOrEqual(0.05);
      const n = nearestNode(grid, sp.pos, 1);
      expect(n, `${team} spawn ${label(sp.pos)} has no nav node within 1 m`).not.toBeNull();
      expect(Math.hypot(n!.pos.x - sp.pos.x, n!.pos.z - sp.pos.z)).toBeLessThanOrEqual(1);
      expect(main.has(n!.id), `${team} spawn ${label(sp.pos)} is off the main component`).toBe(true);
    }
  });

  it('reaches exactly three rooftop areas at ≥ 5.5 m, each with a marker on it', () => {
    const high = grid.nodes.filter((n) => n.pos.y >= 5.5 && main.has(n.id));
    expect(high.length).toBeGreaterThan(60);
    // Group the high nodes into areas connected through high nodes only.
    const highIds = new Set(high.map((n) => n.id));
    const seen = new Set<number>();
    const areas: NavNode[][] = [];
    for (const start of high) {
      if (seen.has(start.id)) continue;
      const area: NavNode[] = [];
      const stack = [start.id];
      seen.add(start.id);
      while (stack.length) {
        const id = stack.pop()!;
        area.push(grid.nodes[id]);
        for (const l of grid.nodes[id].links) {
          if (highIds.has(l.to) && !seen.has(l.to)) { seen.add(l.to); stack.push(l.to); }
        }
      }
      areas.push(area);
    }
    const sizeable = areas.filter((a) => a.length >= 8);
    expect(sizeable.length, `rooftop areas: ${areas.map((a) => a.length).join(', ')}`).toBe(3);
    expect(areas.length - sizeable.length, 'stray high nodes').toBe(0);
    expect(SHANASHEEL_ROOFTOPS).toHaveLength(3);
    for (const r of SHANASHEEL_ROOFTOPS) {
      const n = nodeAt(r);
      expect(n.pos.y).toBeGreaterThanOrEqual(5.5);
      expect(main.has(n.id)).toBe(true);
      expect(playerFits(world, r, 'stand')).toBe(true);
    }
    // Each rooftop has at least two ways down: a walkable descent and a drop.
    for (const r of SHANASHEEL_ROOFTOPS) {
      const from = nodeAt(r);
      const reach = reachableFrom(grid, from.id);
      const highArea = sizeable.find((a) => a.some((n) => n.id === from.id))!;
      const exits = new Set<string>();
      for (const n of highArea) {
        for (const l of n.links) {
          const m = grid.nodes[l.to];
          if (m.pos.y < 5.5 && reach.has(m.id)) exits.add(l.drop ? 'drop' : 'walk');
        }
      }
      expect([...exits].sort(), `rooftop ${label(r)} exits`).toEqual(['drop', 'walk']);
    }
  });

  it('shields both spawn courtyards from each other, the square and the rooftops', () => {
    for (const t of map.spawns.tigris) {
      for (const e of map.spawns.euphrates) {
        expect(lineOfSight(world, eye(t.pos), eye(e.pos)), `spawn LOS ${label(t.pos)} -> ${label(e.pos)}`).toBe(false);
      }
    }
    const centreEye = eye(SHANASHEEL_SQUARE_CENTRE);
    for (const sp of [...map.spawns.tigris, ...map.spawns.euphrates]) {
      expect(lineOfSight(world, eye(sp.pos), centreEye), `spawn ${label(sp.pos)} sees the square`).toBe(false);
      for (const r of SHANASHEEL_ROOFTOPS) {
        expect(lineOfSight(world, eye(sp.pos), eye(r)), `spawn ${label(sp.pos)} sees rooftop ${label(r)}`).toBe(false);
      }
    }
  });

  it('gives both teams a fair route to the square and keeps the spawns ≥ 30 m apart by path', () => {
    const centreNode = nodeAt(SHANASHEEL_SQUARE_CENTRE);
    const tigris = map.spawns.tigris.map((s) => pathLength(grid, nodeAt(s.pos), centreNode));
    const euphrates = map.spawns.euphrates.map((s) => pathLength(grid, nodeAt(s.pos), centreNode));
    const mt = mean(tigris);
    const me = mean(euphrates);
    expect(Math.abs(mt - me) / Math.max(mt, me), `tigris ${mt.toFixed(1)} m vs euphrates ${me.toFixed(1)} m`).toBeLessThanOrEqual(0.25);
    // Combat within ~10 s of spawning: the square is a short sprint away.
    expect(Math.max(mt, me)).toBeLessThan(MOVEMENT.sprintSpeed * 12);
    let shortest = Infinity;
    for (const t of map.spawns.tigris) {
      for (const e of map.spawns.euphrates) shortest = Math.min(shortest, pathLength(grid, nodeAt(t.pos), nodeAt(e.pos)));
    }
    expect(shortest).toBeGreaterThanOrEqual(30);
  });

  it('keeps sightlines under ~40 m along every alley axis', () => {
    // Sample eye-level rays along the four cardinal directions from a coarse grid of standing spots.
    const step = 2;
    let longest = 0;
    let where = '';
    for (let x = map.bounds.min.x + 1; x < map.bounds.max.x; x += step) {
      for (let z = map.bounds.min.z + 1; z < map.bounds.max.z; z += step) {
        const pos = { x, y: 0, z };
        if (!playerFits(world, pos, 'stand')) continue;
        if (floorHeightAt(world, pos, 0.1).y !== 0) continue;
        const from = eye(pos);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          let d = 4;
          while (d < 60 && lineOfSight(world, from, { x: x + dx * d, y: from.y, z: z + dz * d })) d += 1;
          if (d > longest) { longest = d; where = `${label(pos)} dir (${dx}, ${dz})`; }
        }
      }
    }
    expect(longest, `longest sightline ${longest} m at ${where}`).toBeLessThanOrEqual(42);
  });

  it('never blocks a doorway with cover', () => {
    // Every wall opening (a gap between two 'wall' blocks on the same line) should be walkable in the nav grid:
    // verified indirectly by checking that all four house courtyards connect to the square by a path.
    const centreNode = nodeAt(SHANASHEEL_SQUARE_CENTRE);
    for (const yard of [{ x: -11.5, y: 0.02, z: 10 }, { x: -11.5, y: 0.02, z: -11.5 }, { x: 11.5, y: 0.02, z: -10 }, { x: 11.5, y: 0.02, z: 11.5 }]) {
      expect(findPath(grid, nodeAt(yard).id, centreNode.id)).not.toBeNull();
    }
  });
});

describe('shanasheel: tooling', () => {
  it('renders an ASCII top-down dump', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/map-ascii.ts', 'shanasheel', '2'], {
      cwd: new URL('..', import.meta.url).pathname,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(out).toContain('height map');
    expect(out).toMatch(/blocks: \d+, props: \d+/);
    expect(out.split('\n').length).toBeGreaterThan(30);
  }, 90_000);
});
