/**
 * Shanasheel — the centre: the tea-house square (x -6.8..6.8, z -4.8..9.3),
 * the blue-tiled gateway on its north side with the passage up to the north
 * alley, and the Shabandar tea house on its south side (rooftop R1).
 */
import { box, prop, stairs } from '../../map/builder';
import type { MapBlock, MapLight, MapProp } from '../../map/schema';
import {
  LOW_ROOF, UPPER_ROOF, clutter, deck, door, lantern, lowCover, palm, parapetPiece, patch, wallX, wallZ, win,
} from './util';

const blocks: MapBlock[] = [];
const props: MapProp[] = [];
const lights: MapLight[] = [];

/** Rooftop marker R1: middle of the tea-house roof. */
export const TEAHOUSE_ROOF_TOP = UPPER_ROOF + 0.3; // 5.9
export const R1 = { x: 0, y: TEAHOUSE_ROOF_TOP, z: -10.5 };

// ---------------------------------------------------------------------------
// Tea house "مقهى الشابندر": interior x -3.8..3.8, z -15.8..-5.2, one tall hall
// with three arches to the square, side doors into both lanes, a back door to
// lane A', and an interior stair through a roof hatch.
// ---------------------------------------------------------------------------
const TH_H = UPPER_ROOF; // wall height; roof slab 5.6..5.9
const TH = { x0: -4.2, x1: 4.2, z0: -16.2, z1: -4.8 };
const brick = 'brick';

blocks.push(patch(-3.8, -15.8, 3.8, -5.2, 'stone', { tag: 'teahouse-floor' }));
// North facade: three 2 m arches, 3 m tall.
blocks.push(...wallX(-5, TH.x0, TH.x1, 0, TH_H, brick, [
  { at: -3.4, w: 2.0, h: 3.0 }, { at: -1.0, w: 2.0, h: 3.0 }, { at: 1.4, w: 2.0, h: 3.0 },
], { tag: 'teahouse' }));
// South wall: back door onto lane A' / the souq junction.
blocks.push(...wallX(-16, TH.x0, TH.x1, 0, TH_H, brick, [door(1.4), win(-1.2, 1.0, 1.2, 1.0)], { tag: 'teahouse' }));
// West wall: side door under the second flight (2.95 m headroom).
blocks.push(...wallZ(-4, -15.8, -5.2, 0, TH_H, brick, [door(-11.2)], { tag: 'teahouse' }));
// East wall: side door plus a shooting window.
blocks.push(...wallZ(4, -15.8, -5.2, 0, TH_H, brick, [door(-11.2), win(-14.4)], { tag: 'teahouse' }));

// Interior stair along the west wall: two straight flights, 1.4 m wide.
blocks.push(...stairs(-3.8, 0, -15.8, 'north', 1.4, 2.95, 4.4, 'stone', { tag: 'teahouse-stairs' }));
blocks.push(...stairs(-3.8, 2.95, -11.4, 'north', 1.4, 2.95, 4.4, 'stone', { tag: 'teahouse-stairs' }));
// Roof slab (top 5.9) with the stair hatch x -3.8..-1.8, z -10.6..-7.0.
blocks.push(deck(TH.x0, TH.z0, TH.x1, -10.6, TEAHOUSE_ROOF_TOP, 'roof', 0.3, { tag: 'teahouse-roof' }));
blocks.push(deck(-1.8, -10.6, TH.x1, -7.0, TEAHOUSE_ROOF_TOP, 'roof', 0.3, { tag: 'teahouse-roof' }));
blocks.push(deck(TH.x0, -10.6, -3.8, -7.0, TEAHOUSE_ROOF_TOP, 'roof', 0.3, { tag: 'teahouse-roof' }));
blocks.push(deck(TH.x0, -7.0, TH.x1, TH.z1, TEAHOUSE_ROOF_TOP, 'roof', 0.3, { tag: 'teahouse-roof' }));

// Shanasheel balconies on both side facades at 3 m: the roof's second way
// down (drop 2.9 m onto the balcony, then 3 m to the lane). The timber eave
// above each balcony lets the nav grid link roof and balcony cells.
for (const s of [-1, 1] as const) {
  const inner = s * 4.2;
  const outerX = s * 5.6;
  blocks.push(deck(inner, -11.6, outerX, -9.6, LOW_ROOF, 'wood', 0.15, { tag: 'balcony' }));
  blocks.push(box(Math.min(outerX, outerX + s * 0.1), LOW_ROOF, -11.6, 0.1, 1.0, 2.0, 'lattice', { tag: 'balcony-rail' }));
  blocks.push(box(Math.min(inner, outerX), LOW_ROOF, -11.7, 1.4, 1.0, 0.1, 'lattice', { tag: 'balcony-rail' }));
  blocks.push(box(Math.min(inner, outerX), LOW_ROOF, -9.6, 1.4, 1.0, 0.1, 'lattice', { tag: 'balcony-rail' }));
  blocks.push(deck(inner, -11.6, s * 4.7, -9.6, TEAHOUSE_ROOF_TOP, 'wood', 0.3, { tag: 'eave' }));
  props.push(prop('shanasheel', s * 4.35, 3.6, -13.6, { yaw: s > 0 ? Math.PI / 2 : -Math.PI / 2, scale: 0.9 }));
  props.push(prop('shanasheel', s * 4.35, 3.6, -7.4, { yaw: s > 0 ? Math.PI / 2 : -Math.PI / 2, scale: 0.9 }));
}

// Parapets with gaps over the balconies (west/east) so the drop is possible.
const P = (side: 'north' | 'south' | 'east' | 'west', from: number, to: number) =>
  blocks.push(parapetPiece(side, TH.x0, TH.z0, TH.x1, TH.z1, TEAHOUSE_ROOF_TOP, from, to, brick));
P('south', TH.x0, TH.x1);
P('north', TH.x0, TH.x1);
P('west', TH.z0, -11.6);
P('west', -9.6, TH.z1);
P('east', TH.z0, -11.6);
P('east', -9.6, TH.z1);
// Rooftop cover and clutter.
blocks.push(lowCover(-0.6, -13.6, 1.4, -12.8, 1.0, 'brick', TEAHOUSE_ROOF_TOP, 'cover'));
blocks.push(lowCover(1.4, -8.6, 3.2, -7.6, 0.9, 'wood', TEAHOUSE_ROOF_TOP, 'cover'));
props.push(clutter('water_tank', 2.6, TEAHOUSE_ROOF_TOP, -14.6, { scale: 0.95 }));
props.push(prop('flag', 3.6, TEAHOUSE_ROOF_TOP, -5.4, { tint: [0.9, 0.85, 0.7] }));
props.push(prop('satellite_dish', -3.2, TEAHOUSE_ROOF_TOP, -15.4, { yaw: 2.4 }));
props.push(prop('antenna', -2.2, TEAHOUSE_ROOF_TOP, -5.5));
props.push(prop('ac_unit', 4.1, 4.4, -14.2, { yaw: Math.PI / 2 }));

// Facade dressing and interior furniture.
for (const x of [-2.4, 0, 2.4]) props.push(prop('arch', x, 0, -4.9, { yaw: 0 }));
props.push(prop('sign', 0, 3.5, -4.72, { text: 'مقهى الشابندر', yaw: 0, scale: 1.4 }));
props.push(prop('awning', -2.4, 3.1, -4.2, { tint: [0.75, 0.2, 0.15] }));
props.push(prop('awning', 2.4, 3.1, -4.2, { tint: [0.15, 0.4, 0.55] }));
for (const x of [-2.4, 0, 2.4]) props.push(prop('shanasheel', x, 3.6, -4.55, { yaw: 0 }));
props.push(prop('window', -2.6, 1.4, -16.25, { yaw: Math.PI }), prop('window', 3.4, 4.2, -16.25, { yaw: Math.PI }));
props.push(prop('rug', 1.2, 0.02, -8.5, { yaw: 0.1, tint: [0.7, 0.2, 0.2] }));
props.push(prop('rug', 0.6, 0.02, -13.4, { yaw: -0.08, tint: [0.25, 0.3, 0.6] }));
props.push(prop('table', 1.6, 0.02, -7.2), prop('chair', 2.4, 0.02, -7.2, { yaw: -Math.PI / 2 }), prop('chair', 0.8, 0.02, -7.2, { yaw: Math.PI / 2 }));
props.push(prop('table', 2.4, 0.02, -12.4), prop('chair', 3.2, 0.02, -12.4, { yaw: -Math.PI / 2 }), prop('chair', 2.4, 0.02, -13.2, { yaw: 0 }));
props.push(prop('teapot', 1.6, 0.77, -7.2), prop('teapot', 2.4, 0.77, -12.4));
props.push(prop('bench', 2.9, 0.02, -15.5, { yaw: 0 }));
for (const [x, z] of [[2.6, -10.2]] as const) {
  const l = lantern(x, 2.6, z);
  props.push(l.prop);
  lights.push(l.light);
}

// ---------------------------------------------------------------------------
// Square: fountain, planters with palms, café tables, carts, benches.
// ---------------------------------------------------------------------------
blocks.push(patch(-3, 2, 3, 8, 'tile', { tag: 'square-tiles' }));
props.push(prop('fountain', 0, 0.02, 5, { scale: 1.0 }));
// Planters (0.6 m stone boxes) with palms.
blocks.push(lowCover(-5.6, 3.0, -4.4, 6.0, 0.6, 'stone', 0, 'planter'));
blocks.push(lowCover(4.4, 3.0, 5.6, 6.0, 0.6, 'stone', 0, 'planter'));
blocks.push(lowCover(-1.0, -2.2, 1.0, -1.4, 0.6, 'stone', 0, 'planter'));
props.push(palm(-5.0, 0.6, 4.5, 0.3, 1.3), palm(5.0, 0.6, 4.5, 1.7, 1.45));
props.push(prop('pot', -0.5, 0.6, -1.8, { scale: 0.6, collide: false }), prop('pot', 0.5, 0.6, -1.8, { scale: 0.6, collide: false }));
// Café tables in front of the tea house.
for (const x of [-3.2, 3.2]) {
  props.push(prop('table', x, 0, -2.8));
  props.push(prop('chair', x - 0.8, 0, -2.8, { yaw: Math.PI / 2 }), prop('chair', x + 0.8, 0, -2.8, { yaw: -Math.PI / 2 }));
  props.push(prop('teapot', x, 0.75, -2.8));
}
props.push(prop('table', -4.8, 0.02, 7.6), prop('chair', -4.8, 0.02, 8.4, { yaw: Math.PI }), prop('chair', -4.0, 0.02, 7.6, { yaw: -Math.PI / 2 }));
// Carts and crates as mid cover, kept clear of every doorway.
blocks.push(lowCover(3.4, -2.2, 5.0, -1.4, 1.0, 'wood', 0, 'cover'));
blocks.push(lowCover(-6.6, 4.4, -5.6, 5.4, 1.0, 'wood', 0, 'cover'));
blocks.push(lowCover(5.6, 7.4, 6.6, 8.6, 1.0, 'wood', 0, 'cover'));
props.push(clutter('sacks', 4.2, 0, -1.0, { yaw: 0.4 }), clutter('barrel', -5.9, 0, 6.0), prop('bicycle', 6.5, 0, 1.4, { yaw: 0 }));
props.push(prop('bench', -4.5, 0, 8.95, { yaw: 0 }), prop('bench', 4.5, 0, 8.95, { yaw: 0 }));
props.push(prop('rug', -4.6, 0, 1.2, { yaw: 0.05, tint: [0.6, 0.25, 0.2] }), prop('rug', 4.6, 0, 6.4, { yaw: -0.1, tint: [0.2, 0.4, 0.5] }));
// Awnings and signs on the shop fronts facing the square.
props.push(prop('awning', -6.3, 2.7, 2.5, { yaw: Math.PI / 2, tint: [0.8, 0.55, 0.2] }));
props.push(prop('sign', -6.75, 3.2, 3.6, { text: 'بقالة', yaw: Math.PI / 2 }));
props.push(prop('awning', 6.3, 2.7, 5.8, { yaw: -Math.PI / 2, tint: [0.2, 0.5, 0.45] }));
props.push(prop('sign', 6.75, 3.2, 4.6, { text: 'خياط', yaw: -Math.PI / 2 }));
props.push(prop('sign', 6.75, 3.2, -2.5, { text: 'حلاق', yaw: -Math.PI / 2 }));
props.push(prop('sign', -6.75, 3.2, -4.0, { text: 'شاي', yaw: Math.PI / 2, scale: 0.8 }));
props.push(prop('cloth_line', 0, 4.6, 0.5, { yaw: Math.PI / 2, scale: 1.6 }));
for (const [x, z] of [[-6.2, 0.4], [6.2, 8.8], [-2.2, 8.9]] as const) {
  const l = lantern(x, 2.7, z);
  props.push(l.prop);
  lights.push(l.light);
}

// ---------------------------------------------------------------------------
// Blue-tiled gateway (north edge of the square) and the passage to the north
// alley between the two solid houses beside it.
// ---------------------------------------------------------------------------
blocks.push(...wallX(9.5, -6.8, 6.8, 0, 5.0, 'tile', [{ at: -1.5, w: 3.0, h: 5.0 }], { tag: 'gateway' }));
blocks.push(box(-2.7, 0, 9.0, 1.2, 7.6, 1.0, 'tile', { tag: 'gateway-pier' }));
blocks.push(box(1.5, 0, 9.0, 1.2, 7.6, 1.0, 'tile', { tag: 'gateway-pier' }));
blocks.push(box(-1.5, 3.4, 9.0, 3.0, 4.2, 1.0, 'tile', { tag: 'gateway-head' }));
props.push(prop('arch', 0, 0, 9.5, { yaw: 0, scale: 1.2 }));
props.push(prop('sign', 0, 4.1, 8.9, { text: 'باب الشناشيل', yaw: 0, scale: 1.2 }));
// The houses flanking the gate passage (non-enterable, taller than the ceiling).
blocks.push(box(-6.8, 0, 9.7, 5.3, 8.2, 6.5, 'plaster', { tag: 'house-nw' }));
blocks.push(box(1.5, 0, 9.7, 5.7, 7.8, 9.5, 'brick_dark', { tag: 'house-ne' }));
props.push(prop('sign', -1.55, 2.9, 12.5, { text: 'صيدلية', yaw: Math.PI / 2 }));
props.push(prop('door', -1.55, 0, 14.4, { yaw: Math.PI / 2 }), prop('window', -1.55, 1.5, 11.2, { yaw: Math.PI / 2 }));
props.push(prop('shanasheel', 1.4, 3.6, 12.8, { yaw: -Math.PI / 2 }), prop('window', 1.45, 1.5, 15.2, { yaw: -Math.PI / 2 }));
props.push(prop('cloth_line', 0, 4.2, 13.5, { yaw: Math.PI / 2, scale: 0.75 }));
props.push(clutter('crate', -1.0, 0, 15.4, { scale: 0.8 }));
for (const [x, z] of [[-1.1, 10.4]] as const) {
  const l = lantern(x, 2.9, z);
  props.push(l.prop);
  lights.push(l.light);
}

export const centre = { blocks, props, lights };
