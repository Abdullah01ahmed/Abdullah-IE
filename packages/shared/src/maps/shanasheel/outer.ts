/**
 * Shanasheel — outer ring: ground, the perimeter of tall non-enterable houses
 * that closes the map, the two shielded spawn courtyards (tigris north-west,
 * euphrates south-east), the skyline landmarks outside the bounds, and the
 * spawn/zone data.
 *
 * Ring alleys referenced here (see shanasheel.ts for the full plan):
 *   west alley  x -19.0..-16.2, z -22..19      east alley  x 16.2..19, z -19..22
 *   north alley z 16.2..19 (x -24..-1.5)        alley B     z 19.2..22 (x -2.5..19)
 *   souq (west) z -22..-19.2 (x -19..2.5)       lane A'     z -19..-16.2 (x 2..24)
 */
import { box, prop, spawn } from '../../map/builder';
import type { MapBlock, MapLight, MapProp, MapZone, SpawnPoint } from '../../map/schema';
import { CEILING, MASS_H, blocker, lantern, mass, spawnFacing, wallX, wallZ, windowRow } from './util';

/** Half-size of the level including the perimeter houses. */
export const EXTENT = 31.5;
/** Playable bounds half-size (1 m margin around the alleys). */
export const BOUND = 31;

export const SQUARE_CENTRE = { x: 0, y: 0, z: 2 };

const blocks: MapBlock[] = [];
const props: MapProp[] = [];
const lights: MapLight[] = [];

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------
blocks.push(box(-EXTENT - 8, -1, -EXTENT - 8, (EXTENT + 8) * 2, 1, (EXTENT + 8) * 2, 'cobble', { tag: 'ground', uvScale: 0.6 }));

// ---------------------------------------------------------------------------
// Perimeter houses (solid masses taller than the playable ceiling). Heights
// vary to give the skyline some life; materials alternate brick and plaster.
// ---------------------------------------------------------------------------
// North-west quarter (north of the north alley) and the stub end of that alley.
blocks.push(mass(-EXTENT, 19, -20, EXTENT, MASS_H + 1.2, 'brick_dark', { tag: 'perimeter' }));
blocks.push(mass(-20, 19, -10, EXTENT, MASS_H, 'plaster_worn', { tag: 'perimeter' }));
blocks.push(mass(-10, 19, -2.5, EXTENT, MASS_H + 0.6, 'brick', { tag: 'perimeter' }));
blocks.push(mass(-EXTENT, 16.2, -24, 19, MASS_H, 'brick', { tag: 'perimeter' }));
// North-east quarter (north of alley B).
blocks.push(mass(-2.5, 22, 8, EXTENT, MASS_H + 0.4, 'plaster', { tag: 'perimeter' }));
blocks.push(mass(8, 22, 20, EXTENT, MASS_H + 1.4, 'brick_dark', { tag: 'perimeter' }));
blocks.push(mass(20, 22, EXTENT, EXTENT, MASS_H, 'brick', { tag: 'perimeter' }));
// East side (between alley B and the euphrates house).
blocks.push(mass(19, 10, EXTENT, 22, MASS_H + 0.8, 'plaster_worn', { tag: 'perimeter' }));
blocks.push(mass(19, -2, EXTENT, 10, MASS_H, 'brick', { tag: 'perimeter' }));
// South-east quarter (south of lane A') and the stub end of that lane.
blocks.push(mass(24, -19, EXTENT, -16.2, MASS_H, 'brick', { tag: 'perimeter' }));
blocks.push(mass(20, -EXTENT, EXTENT, -19, MASS_H + 1.2, 'brick_dark', { tag: 'perimeter' }));
blocks.push(mass(10, -EXTENT, 20, -19, MASS_H, 'plaster_worn', { tag: 'perimeter' }));
blocks.push(mass(2.5, -EXTENT, 10, -19, MASS_H + 0.6, 'brick', { tag: 'perimeter' }));
// South-west quarter (south of the souq).
blocks.push(mass(-8, -EXTENT, 2.5, -22, MASS_H + 0.4, 'plaster', { tag: 'perimeter' }));
blocks.push(mass(-20, -EXTENT, -8, -22, MASS_H + 1.4, 'brick_dark', { tag: 'perimeter' }));
blocks.push(mass(-EXTENT, -EXTENT, -20, -22, MASS_H, 'brick', { tag: 'perimeter' }));
// West side (between the souq and the tigris house).
blocks.push(mass(-EXTENT, -22, -19, -10, MASS_H + 0.8, 'plaster_worn', { tag: 'perimeter' }));
blocks.push(mass(-EXTENT, -10, -19, 2, MASS_H, 'brick', { tag: 'perimeter' }));

// Invisible ceiling over the perimeter so nothing can ever leave the map,
// even from the tallest reachable roof.
blocks.push(blocker(-EXTENT, MASS_H, -EXTENT, EXTENT, CEILING + 6, -19, 'perimeter-blocker'));
blocks.push(blocker(-EXTENT, MASS_H, 19, EXTENT, CEILING + 6, EXTENT, 'perimeter-blocker'));
blocks.push(blocker(-EXTENT, MASS_H, -19, -19, CEILING + 6, 19, 'perimeter-blocker'));
blocks.push(blocker(19, MASS_H, -19, EXTENT, CEILING + 6, 19, 'perimeter-blocker'));

// ---------------------------------------------------------------------------
// Landmarks outside the playable bounds
// ---------------------------------------------------------------------------
// Minaret at the north-east corner: brick shaft, tiled balcony ring, lantern cap.
blocks.push(box(32.5, 0, 32.5, 3.2, 21, 3.2, 'brick', { tag: 'minaret' }));
blocks.push(box(31.9, 14.5, 31.9, 4.4, 0.6, 4.4, 'tile', { tag: 'minaret' }));
blocks.push(box(32.2, 15.1, 32.2, 3.8, 1.0, 3.8, 'wood', { tag: 'minaret' }));
blocks.push(box(33.0, 21, 33.0, 2.2, 2.6, 2.2, 'tile', { tag: 'minaret' }));
blocks.push(box(33.6, 23.6, 33.6, 1.0, 1.6, 1.0, 'metal', { tag: 'minaret' }));
// Stepped dome silhouette to the east.
blocks.push(box(33, 0, -9, 9, 8.5, 9, 'plaster', { tag: 'dome' }));
blocks.push(box(34, 8.5, -8, 7, 1.6, 7, 'tile', { tag: 'dome' }));
blocks.push(box(34.8, 10.1, -7.2, 5.4, 1.4, 5.4, 'tile', { tag: 'dome' }));
blocks.push(box(35.7, 11.5, -6.3, 3.6, 1.1, 3.6, 'tile', { tag: 'dome' }));
blocks.push(box(36.6, 12.6, -5.4, 1.8, 0.8, 1.8, 'tile', { tag: 'dome' }));
blocks.push(box(37.3, 13.4, -4.7, 0.4, 1.4, 0.4, 'metal', { tag: 'dome' }));

// ---------------------------------------------------------------------------
// Spawn houses: a courtyard sunk inside a two-storey mansion. Two corridors
// leave each courtyard; a screen wall inside breaks the line into the alley.
// ---------------------------------------------------------------------------
function spawnHouse(s: 1 | -1): void {
  // Coordinates below describe the tigris house (s = 1); s = -1 rotates it
  // 180° about the map centre for euphrates.
  const mat = s > 0 ? 'brick' : 'plaster_worn';
  const m = (x0: number, z0: number, x1: number, z1: number, h = MASS_H) => {
    blocks.push(mass(s * x0, s * z0, s * x1, s * z1, h, mat, { tag: 'spawn-house' }));
  };
  m(-EXTENT, 2, -28, 16.2);          // back wing
  m(-28, 2, -19, 5);                 // south wing
  m(-28, 14, -23.8, 16.2);           // north wing, west of the corridor
  m(-22.2, 14, -19, 16.2);           // north wing, east of the corridor
  m(-21, 5, -19, 7);                 // street wing, south of the corridor
  m(-21, 8.6, -19, 14);              // street wing, north of the corridor
  // Corridor ceilings (corridors are 1.6 m wide, 2.6 m tall).
  blocks.push(box(Math.min(s * -23.8, s * -22.2), 2.6, Math.min(s * 14, s * 16.2), 1.6, MASS_H - 2.6, 2.2, mat, { tag: 'spawn-house' }));
  blocks.push(box(Math.min(s * -21, s * -19), 2.6, Math.min(s * 7, s * 8.6), 2, MASS_H - 2.6, 1.6, mat, { tag: 'spawn-house' }));
  // Screen walls 1.5 m inside each corridor mouth (0.4 thick, centred on the grid).
  blocks.push(...wallZ(s * -22.5, Math.min(s * 6.3, s * 9.3), Math.max(s * 6.3, s * 9.3), 0, 2.8, 'plaster', [], { tag: 'screen' }));
  blocks.push(...wallX(s * 12.5, Math.min(s * -24.8, s * -21.2), Math.max(s * -24.8, s * -21.2), 0, 2.8, 'plaster', [], { tag: 'screen' }));
  // Wooden pergola beams over the courtyard's back half: cover from above,
  // 0.24 m thick and centred on grid lines so they never become nav floors.
  for (const zc of [6.5, 8, 9.5, 11, 12.5]) {
    blocks.push(box(Math.min(s * -28, s * -24), 3.6, s * zc - 0.12, 4, 0.2, 0.24, 'wood', { tag: 'pergola' }));
  }
  // Dressing: palm, pots, rug, bench, lanterns and windows on the inner facades.
  const inward = s > 0 ? 'east' : 'west';
  const fromSouth = s > 0 ? 'north' : 'south';
  props.push(prop('palm', s * -26.5, 0, s * 13, { yaw: s * 0.4, scale: 1.1 }));
  props.push(prop('pot', s * -27.4, 0, s * 5.7), prop('pot', s * -21.4, 0, s * 13.5, { scale: 0.9 }));
  props.push(prop('rug', s * -24.5, 0, s * 9.5, { yaw: s * 0.1, tint: s > 0 ? [0.8, 0.25, 0.2] : [0.2, 0.35, 0.7] }));
  props.push(prop('bench', s * -24, 0, s * 5.35, { yaw: s > 0 ? 0 : Math.PI }));
  props.push(prop('sacks', s * -27.3, 0, s * 12.2, { yaw: 0.6 }));
  props.push(...windowRow('window', 'z', s * -27.95, s * 6, s * 12, 3, 1.6, inward));
  props.push(...windowRow('shanasheel', 'z', s * -27.7, s * 7, s * 12, 2, 3.4, inward));
  props.push(...windowRow('window', 'x', s * 5.05, s * -27, s * -22, 3, 1.6, fromSouth));
  props.push(...windowRow('window', 'x', s * 13.95, s * -27, s * -24.5, 2, 4.6, s > 0 ? 'south' : 'north'));
  props.push(prop('door', s * -21.05, 0, s * 12.4, { yaw: s > 0 ? -Math.PI / 2 : Math.PI / 2 }));
  props.push(prop('cloth_line', s * -24.5, 3.9, s * 7.2, { yaw: Math.PI / 2 }));
  props.push(prop('flag', s * -19.5, MASS_H, s * 5.5, { tint: s > 0 ? [0.85, 0.2, 0.15] : [0.15, 0.45, 0.8] }));
  for (const [x, z] of [[-21.3, 6.2], [-27.5, 9.8], [-22.9, 13.6]] as const) {
    const l = lantern(s * x, 2.4, s * z);
    props.push(l.prop);
    lights.push(l.light);
  }
}
spawnHouse(1);
spawnHouse(-1);

// ---------------------------------------------------------------------------
// Spawns
// ---------------------------------------------------------------------------
/** Tigris: north-west courtyard, facing east into the map. */
const tigris: SpawnPoint[] = [
  spawn(-26.5, 0, 6.6, 90),
  spawn(-26.5, 0, 8.6, 90),
  spawn(-26.5, 0, 10.6, 90),
  spawn(-24.6, 0, 7.4, 90),
  spawn(-24.6, 0, 10.2, 90),
];
/** Euphrates: south-east courtyard, facing west into the map. */
const euphrates: SpawnPoint[] = tigris.map((p) => spawn(-p.pos.x, 0, -p.pos.z, -90));
/** Neutral fallbacks in the four house courtyards and the souq junction. */
const neutral: SpawnPoint[] = [
  spawnFacing(-11.5, 0.02, 12.5, SQUARE_CENTRE.x, SQUARE_CENTRE.z),
  spawnFacing(-11.5, 0.02, -11.5, SQUARE_CENTRE.x, SQUARE_CENTRE.z),
  spawnFacing(11.5, 0.02, -12.5, SQUARE_CENTRE.x, SQUARE_CENTRE.z),
  spawnFacing(11.5, 0.02, 11.5, SQUARE_CENTRE.x, SQUARE_CENTRE.z),
  spawnFacing(0.5, 0, -20.4, SQUARE_CENTRE.x, SQUARE_CENTRE.z),
];

const zones: MapZone[] = [
  { id: 'tigris_spawn', kind: 'spawn_protect', team: 'tigris', label: 'Tigris courtyard', box: { min: { x: -28, y: -1, z: 5 }, max: { x: -19, y: 6, z: 16.2 } } },
  { id: 'euphrates_spawn', kind: 'spawn_protect', team: 'euphrates', label: 'Euphrates courtyard', box: { min: { x: 19, y: -1, z: -16.2 }, max: { x: 28, y: 6, z: -5 } } },
];

export const outer = { blocks, props, lights, spawns: { tigris, euphrates, neutral }, zones };
