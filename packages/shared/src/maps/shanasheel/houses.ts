/**
 * Shanasheel — the four enterable courtyard houses that flank the square, the
 * two passages under the shanasheel bridges, the shop strips and the alley
 * buttresses that break the long north–south sightlines.
 *
 * The west quarter is authored in place (houses W1 north of the west passage
 * and W2 south of it); the east quarter (E1, E2) is the same structure rotated
 * 180° about the map centre with its own materials and dressing, which keeps
 * routes to the square fair for both teams.
 *
 * W1 / E1 carry the two house rooftops (R2 / R3): a two-storey wing whose roof
 * is reached by a courtyard stair onto the single-storey annex roof (3 m) and
 * a second flight up the wing's wall. The annex roof also connects over a
 * timber bridge to the neighbouring house's roof, and drops into the alley.
 */
import { box, prop, stairs } from '../../map/builder';
import type { MapBlock, MapLight, MapProp, MaterialId } from '../../map/schema';
import {
  LOW_ROOF, MASS_H, ROOM_H, UPPER_ROOF, YARD_WALL,
  clutter, deck, door, lantern, lowCover, mass, palm, parapetPiece, patch, wallX, wallZ, win, windowRow,
} from './util';

interface Quarter {
  blocks: MapBlock[];
  props: MapProp[];
  lights: MapLight[];
}

interface QuarterMaterials {
  /** Two-storey house with the rooftop (W1 / E1). */
  h1: MaterialId;
  /** Single-storey house across the passage (W2 / E2). */
  h2: MaterialId;
  yard: MaterialId;
  strip: MaterialId;
}

/** Rooftop marker R2 (west house roof); R3 is its 180° rotation. */
export const R2 = { x: -9.5, y: UPPER_ROOF, z: 2.5 };
export const R3 = { x: -R2.x, y: UPPER_ROOF, z: -R2.z };

function rotBlock(b: MapBlock): MapBlock {
  return { ...b, min: { x: -b.max.x, y: b.min.y, z: -b.max.z }, max: { x: -b.min.x, y: b.max.y, z: -b.min.z } };
}
function rotProp(p: MapProp): MapProp {
  return { ...p, pos: { x: -p.pos.x, y: p.pos.y, z: -p.pos.z }, yaw: (p.yaw ?? 0) + Math.PI };
}
function rotLight(l: MapLight): MapLight {
  return { ...l, pos: { x: -l.pos.x, y: l.pos.y, z: -l.pos.z }, dir: l.dir ? { x: -l.dir.x, y: l.dir.y, z: -l.dir.z } : undefined };
}

/** West quarter in world coordinates: x -19..-1.5, z -19.2..16.2. */
function quarter(m: QuarterMaterials): Quarter {
  const blocks: MapBlock[] = [];
  const props: MapProp[] = [];
  const lights: MapLight[] = [];
  const light = (x: number, y: number, z: number) => {
    const l = lantern(x, y, z);
    props.push(l.prop);
    lights.push(l.light);
  };

  // ---- W1: two-storey wing A (x -11.8..-7.2) + annex B (x -15.8..-12.2), z 0.2..4.8;
  //      courtyard x -15.8..-7.2, z 5.2..15.8 -------------------------------------
  blocks.push(...wallX(0, -16.2, -6.8, 0, ROOM_H, m.h1, [door(-10.2)], { tag: 'w1' }));                    // to the west passage
  blocks.push(...wallX(5, -16.2, -6.8, 0, ROOM_H, m.h1, [door(-14.6), door(-9.0)], { tag: 'w1' }));         // to the courtyard
  blocks.push(...wallZ(-16, 0.2, 4.8, 0, ROOM_H, m.h1, [door(1.8)], { tag: 'w1' }));                        // B to the west alley
  blocks.push(...wallZ(-7, 0.2, 4.8, 0, ROOM_H, m.h1, [door(1.8), win(3.6, 0.9)], { tag: 'w1' }));          // A to the square
  blocks.push(...wallZ(-12, 0.2, 4.8, 0, ROOM_H, m.h1, [door(2.4)], { tag: 'w1' }));                        // A <-> B
  blocks.push(deck(-16.2, -0.2, -12.2, 5.2, LOW_ROOF, 'roof', 0.3, { tag: 'w1-annex-roof' }));
  // Timber gallery cantilevered over the west alley: landing for the second
  // flight, and a 3 m drop into the alley (knee-high kerb keeps it walkable).
  blocks.push(deck(-17.4, -0.2, -16.2, 5.2, LOW_ROOF, 'wood', 0.2, { tag: 'gallery' }));
  blocks.push(box(-17.5, LOW_ROOF, -0.2, 0.1, 0.45, 5.4, 'lattice', { tag: 'gallery-kerb' }));
  blocks.push(box(-12.2, ROOM_H, -0.2, 5.4, UPPER_ROOF - ROOM_H, 5.4, m.h1, { tag: 'w1-upper' }));
  // Eaves either side of the second flight's arrival let the nav grid link the
  // wing roof to the annex roof below (the drop route down from R2).
  blocks.push(deck(-12.7, -0.2, -12.2, 1.2, UPPER_ROOF, 'wood', 0.3, { tag: 'eave' }));
  blocks.push(deck(-12.7, 2.4, -12.2, 5.2, UPPER_ROOF, 'wood', 0.3, { tag: 'eave' }));
  blocks.push(parapetPiece('south', -12.2, -0.2, -6.8, 5.2, UPPER_ROOF, -12.2, -6.8, m.h1));
  blocks.push(parapetPiece('north', -12.2, -0.2, -6.8, 5.2, UPPER_ROOF, -12.2, -6.8, m.h1));
  blocks.push(parapetPiece('east', -12.2, -0.2, -6.8, 5.2, UPPER_ROOF, -0.2, 5.2, m.h1));
  // Courtyard walls (3.4 m, open sky) with gates to the alley, north alley and square.
  blocks.push(patch(-15.8, 5.2, -7.2, 15.8, 'ground', { tag: 'w1-yard' }));
  blocks.push(...wallZ(-16, 5.2, 15.8, 0, YARD_WALL, m.yard, [door(11.3)], { tag: 'w1-yard' }));
  blocks.push(...wallX(16, -16.2, -6.8, 0, YARD_WALL, m.yard, [door(-10.9)], { tag: 'w1-yard' }));
  blocks.push(...wallZ(-7, 5.2, 15.8, 0, YARD_WALL, m.yard, [door(6.3)], { tag: 'w1-yard' }));
  // Stairs: courtyard -> annex roof (3 m) along the west wall, then the second
  // flight across the middle of the annex roof up to the wing roof (5.6 m),
  // mounted from the gallery side.
  blocks.push(...stairs(-15.8, 0, 9.8, 'south', 1.2, LOW_ROOF, 4.6, 'stone', { tag: 'w1-stairs' }));
  blocks.push(...stairs(-15.2, LOW_ROOF, 1.2, 'east', 1.2, UPPER_ROOF - LOW_ROOF, 3.0, 'stone', { tag: 'w1-stairs' }));
  // Rooftop clutter and courtyard dressing.
  props.push(clutter('water_tank', -8.0, UPPER_ROOF, 1.0, { scale: 0.95 }), prop('satellite_dish', -11.4, UPPER_ROOF, 4.6, { yaw: 0.8 }));
  props.push(prop('ac_unit', -7.1, 4.3, 3.6, { yaw: Math.PI / 2 }), prop('antenna', -7.4, UPPER_ROOF, 0.4));
  props.push(clutter('water_tank', -13.4, LOW_ROOF, 4.0, { scale: 0.8 }), prop('ac_unit', -15.9, 4.2, 12.5, { yaw: -Math.PI / 2 }));
  props.push(palm(-9.4, 0.02, 12.6, 0.9, 1.4), clutter('pot', -14.4, 0.02, 15.3));
  props.push(prop('rug', -11.5, 0.02, 9.0, { yaw: 0.06, tint: [0.75, 0.3, 0.2] }));
  props.push(prop('bench', -12.6, 0.02, 15.45, { yaw: 0 }), prop('bicycle', -7.55, 0.02, 13.0, { yaw: Math.PI / 2 }));
  blocks.push(lowCover(-11.2, 6.0, -10.0, 7.2, 1.0, 'wood', 0.02, 'cover'));
  props.push(clutter('sacks', -13.6, 0.02, 8.6, { yaw: 1.2 }));
  props.push(...windowRow('window', 'z', -7.25, 6.5, 14.5, 2, 1.8, 'west'));
  props.push(...windowRow('shanasheel', 'z', -6.55, 1.0, 4.0, 1, 3.5, 'east'));
  props.push(prop('window', -6.75, 4.0, 0.9, { yaw: Math.PI / 2 }));
  props.push(prop('door', -16.25, 0, 8.0, { yaw: -Math.PI / 2 }), prop('window', -15.75, 1.6, 14.4, { yaw: Math.PI / 2 }));
  props.push(prop('window', -14.0, 1.6, 16.25, { yaw: 0 }), prop('door', -13.0, 0, 16.25, { yaw: 0 }));
  props.push(prop('cloth_line', -11.5, 4.4, 10.5, { yaw: Math.PI / 2, scale: 1.4 }));
  light(-8.6, 2.4, 8.0);
  light(-16.5, 2.8, 2.5);

  // ---- W2: rooms C (x -11.8..-7.2) + D (x -15.8..-12.2), z -7.8..-3.2 under one 3 m roof;
  //      courtyard x -15.8..-7.2, z -14.8..-8.2 ------------------------------------
  blocks.push(...wallX(-3, -16.2, -6.8, 0, ROOM_H, m.h2, [door(-10.2)], { tag: 'w2' }));                   // to the west passage
  blocks.push(...wallX(-8, -16.2, -6.8, 0, ROOM_H, m.h2, [door(-14.6), door(-9.0)], { tag: 'w2' }));        // to the courtyard
  blocks.push(...wallZ(-16, -7.8, -3.2, 0, ROOM_H, m.h2, [door(-6.2)], { tag: 'w2' }));                     // D to the west alley
  blocks.push(...wallZ(-7, -7.8, -3.2, 0, ROOM_H, m.h2, [door(-6.6), win(-4.6, 0.9)], { tag: 'w2' }));      // C to the side lane
  blocks.push(...wallZ(-12, -7.8, -3.2, 0, ROOM_H, m.h2, [door(-6.2)], { tag: 'w2' }));                     // C <-> D
  blocks.push(deck(-16.2, -8.2, -6.8, -2.8, LOW_ROOF, 'roof', 0.3, { tag: 'w2-roof' }));
  blocks.push(patch(-15.8, -14.8, -7.2, -8.2, 'ground', { tag: 'w2-yard' }));
  blocks.push(...wallZ(-16, -14.8, -8.2, 0, YARD_WALL, m.yard, [door(-14.3)], { tag: 'w2-yard' }));
  blocks.push(...wallZ(-7, -14.8, -8.2, 0, YARD_WALL, m.yard, [door(-11.3)], { tag: 'w2-yard' }));
  blocks.push(...wallX(-15, -16.2, -6.8, 0, YARD_WALL, m.yard, [door(-10.7)], { tag: 'w2-yard' }));         // to the shop
  blocks.push(...stairs(-15.8, 0, -12.8, 'north', 1.2, LOW_ROOF, 4.6, 'stone', { tag: 'w2-stairs' }));
  props.push(clutter('water_tank', -9.0, LOW_ROOF, -7.0, { scale: 0.95 }), prop('satellite_dish', -14.6, LOW_ROOF, -3.6, { yaw: 2.2 }), prop('antenna', -7.4, LOW_ROOF, -3.4));
  props.push(palm(-10.0, 0.02, -13.4, 2.1, 1.3), clutter('pot', -14.6, 0.02, -14.4, { scale: 0.85 }));
  props.push(prop('rug', -11.0, 0.02, -10.8, { yaw: -0.05, tint: [0.3, 0.35, 0.65] }));
  blocks.push(lowCover(-13.0, -10.6, -11.8, -9.6, 1.0, 'wood', 0.02, 'cover'));
  props.push(clutter('barrel', -8.0, 0.02, -12.4), clutter('sacks', -12.6, 0.02, -14.2, { yaw: 0.3 }));
  props.push(...windowRow('window', 'z', -16.25, -14.0, -9.0, 2, 1.6, 'west'));
  props.push(prop('shanasheel', -16.45, 3.5, -5.5, { yaw: -Math.PI / 2 }), prop('window', -6.75, 1.6, -13.0, { yaw: Math.PI / 2 }));
  props.push(prop('shanasheel', -6.55, 3.5, -12.5, { yaw: Math.PI / 2, scale: 0.9 }));
  props.push(prop('cloth_line', -11.5, 4.2, -11.5, { yaw: Math.PI / 2, scale: 1.4 }));
  light(-16.5, 2.8, -12.0);

  // ---- West passage (z -2.8..-0.2) and the shanasheel bridge over it at 3 m ----------
  blocks.push(deck(-16.1, -3.0, -14.5, 0.0, LOW_ROOF, 'wood', 0.15, { tag: 'bridge' }));
  blocks.push(box(-16.2, LOW_ROOF, -2.8, 0.1, 1.0, 2.6, 'lattice', { tag: 'bridge-rail' }));
  blocks.push(box(-14.5, LOW_ROOF, -2.8, 0.1, 1.0, 2.6, 'lattice', { tag: 'bridge-rail' }));
  props.push(prop('shanasheel', -9.0, 3.4, -0.25, { yaw: Math.PI, scale: 0.9 }), prop('shanasheel', -9.0, 3.4, -2.75, { yaw: 0, scale: 0.9 }));
  props.push(prop('arch', -6.9, 0, -1.5, { yaw: Math.PI / 2 }), prop('arch', -16.1, 0, -1.5, { yaw: Math.PI / 2 }));
  props.push(clutter('barrel', -8.2, 0, -2.5), clutter('crate', -12.0, 0, -0.55, { scale: 0.85 }));
  light(-11.0, 2.7, -2.7);

  // ---- Shop strip (z -19.2..-15.2) between W2 and the covered souq: solid mass
  //      with a bakery cut through it (souq <-> W2 courtyard) and the side lane. -----
  blocks.push(mass(-16.2, -19.2, -11.8, -15.2, MASS_H, m.strip, { tag: 'strip' }));
  blocks.push(mass(-8.2, -19.2, -6.8, -15.2, MASS_H, m.strip, { tag: 'strip' }));
  blocks.push(mass(-4.2, -19.2, -1.5, -16.2, MASS_H, m.strip, { tag: 'strip' }));   // stops at the tea house's back wall
  blocks.push(box(-11.8, ROOM_H, -19.2, 3.6, MASS_H - ROOM_H, 4.0, m.strip, { tag: 'strip' }));
  blocks.push(...wallX(-19, -11.8, -8.2, 0, ROOM_H, m.strip, [door(-10.7)], { tag: 'shop' }));
  blocks.push(patch(-11.8, -18.8, -8.2, -15.2, 'stone', { tag: 'shop-floor' }));
  blocks.push(lowCover(-11.8, -17.6, -10.8, -16.4, 0.9, 'wood', 0.02, 'cover'));
  props.push(clutter('sacks', -8.9, 0.02, -18.1, { yaw: 0.5 }), prop('rug', -10.0, 0.02, -16.0, { yaw: 0.02, tint: [0.7, 0.55, 0.3] }));
  props.push(prop('table', -8.8, 0.02, -15.9), prop('teapot', -8.8, 0.77, -15.9));

  // ---- Alley buttresses: staggered stubs that break the 41 m west alley -------------
  blocks.push(...wallX(-6, -19.0, -17.8, 0, 3.4, m.h2, [], { tag: 'buttress' }));
  blocks.push(...wallX(6, -17.4, -16.2, 0, 3.4, m.h1, [], { tag: 'buttress' }));

  return { blocks, props, lights };
}

const west = quarter({ h1: 'brick', h2: 'plaster_worn', yard: 'brick', strip: 'brick_dark' });
const eastRaw = quarter({ h1: 'plaster', h2: 'brick', yard: 'plaster_worn', strip: 'brick' });
const east: Quarter = {
  blocks: eastRaw.blocks.map(rotBlock),
  props: eastRaw.props.map(rotProp),
  lights: eastRaw.lights.map(rotLight),
};

// Side-specific signs (Arabic shop names) — the only asymmetric dressing.
const signs: MapProp[] = [
  prop('sign', -10.0, 2.9, -19.25, { text: 'مخبز', yaw: Math.PI }),               // bakery onto the souq
  prop('sign', -16.25, 2.9, 2.5, { text: 'عطار', yaw: -Math.PI / 2, scale: 0.9 }),  // herbalist onto the west alley
  prop('sign', 10.0, 2.9, 19.25, { text: 'صائغ', yaw: 0 }),                       // goldsmith onto alley B
  prop('sign', 16.25, 2.9, -2.5, { text: 'نجار', yaw: Math.PI / 2, scale: 0.9 }),   // carpenter onto the east alley
  prop('window', -6.75, 1.6, -16.6, { yaw: Math.PI / 2 }),                        // bakery window onto the side lane
];

export const houses: Quarter = {
  blocks: [...west.blocks, ...east.blocks],
  props: [...west.props, ...east.props, ...signs],
  lights: [...west.lights, ...east.lights],
};
