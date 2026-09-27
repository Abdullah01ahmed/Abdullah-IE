/**
 * Shanasheel — lane dressing: the slatted souq roof, market stalls and carts
 * used as cover in the alleys, lanterns, cloth lines and the facade details on
 * the perimeter houses.
 */
import { box, prop } from '../../map/builder';
import type { MapBlock, MapLight, MapProp } from '../../map/schema';
import { clutter, lantern, lowCover, windowRow } from './util';

const blocks: MapBlock[] = [];
const props: MapProp[] = [];
const lights: MapLight[] = [];
const light = (x: number, y: number, z: number) => {
  const l = lantern(x, y, z);
  props.push(l.prop);
  lights.push(l.light);
};

// ---------------------------------------------------------------------------
// Covered souq (west half of the south lane, x -16.2..-1.5, z -22..-19.2).
// The roof is a row of timber slats 0.24 m wide centred on grid lines: light
// falls through, bullets pass between them, and no slat top becomes a nav
// floor. Openings: west end (west alley), east end (junction with lane A'),
// the side lane from the square and the bakery door.
// ---------------------------------------------------------------------------
for (const zc of [-21.5, -21.0, -20.5, -20.0, -19.5]) {
  blocks.push(box(-16.2, 3.3, zc - 0.12, 14.7, 0.2, 0.24, 'wood', { tag: 'souq-roof' }));
}
for (const x of [-14, -9, -4]) props.push(prop('awning', x, 3.05, -20.6, { yaw: Math.PI / 2, scale: 1.1, tint: [0.7, 0.45, 0.25] }));
props.push(prop('sign', -16.6, 3.0, -20.6, { text: 'سوق الصفافير', yaw: -Math.PI / 2, scale: 1.1 }));
props.push(prop('sign', -1.1, 3.0, -20.6, { text: 'سوق الصفافير', yaw: Math.PI / 2, scale: 1.1 }));
// Stall counters staggered along both sides.
blocks.push(lowCover(-15.0, -19.9, -13.0, -19.2, 0.9, 'wood', 0, 'cover'));
blocks.push(lowCover(-9.0, -22.0, -7.0, -21.3, 0.9, 'wood', 0, 'cover'));
blocks.push(lowCover(-3.8, -19.9, -2.0, -19.2, 0.9, 'wood', 0, 'cover'));
props.push(clutter('sacks', -13.3, 0, -21.5, { yaw: 0.4 }), clutter('crate', -6.0, 0, -19.7, { scale: 0.8 }), clutter('barrel', -11.6, 0, -21.6));
props.push(clutter('pot', -1.9, 0, -21.6), prop('rug', -11.0, 0, -20.6, { yaw: Math.PI / 2, tint: [0.65, 0.2, 0.2] }));
light(-13.5, 2.8, -20.6);
light(-4.5, 2.8, -20.6);

// South junction (x -1.5..2.5, z -22..-16.2) and lane A' (z -19..-16.2, x 2..24).
blocks.push(lowCover(-1.0, -21.8, 0.6, -21.0, 0.8, 'stone', 0, 'cover'));
blocks.push(lowCover(12.0, -18.8, 13.6, -18.0, 1.0, 'wood', 0, 'cover'));
props.push(clutter('barrel', 20.4, 0, -18.6), clutter('barrel', 21.2, 0, -18.4), clutter('crate', 5.2, 0, -18.5, { scale: 0.9 }));
props.push(clutter('sacks', 15.6, 0, -16.7, { yaw: 1.0 }), prop('bicycle', 7.6, 0, -16.6, { yaw: 0 }));
props.push(prop('cloth_line', 10.5, 4.3, -17.6, { yaw: Math.PI / 2, scale: 0.7 }));
light(8.0, 2.9, -18.7);

// North alley A (z 16.2..19, x -24..-1.5), junction and alley B (z 19.2..22, x -2.5..19).
blocks.push(lowCover(-13.6, 18.2, -12.0, 19.0, 1.0, 'wood', 0, 'cover'));
blocks.push(lowCover(-6.0, 16.2, -5.0, 17.2, 1.0, 'wood', 0, 'cover'));
blocks.push(lowCover(-0.6, 21.0, 1.0, 21.8, 0.8, 'stone', 0, 'cover'));
blocks.push(lowCover(4.0, 19.2, 5.6, 20.0, 1.0, 'wood', 0, 'cover'));
blocks.push(lowCover(14.0, 21.0, 15.0, 22.0, 1.0, 'wood', 0, 'cover'));
props.push(clutter('barrel', -20.5, 0, 18.5), clutter('sacks', -3.0, 0, 18.4, { yaw: 0.7 }), clutter('crate', 12.4, 0, 19.7, { scale: 0.8 }));
props.push(prop('cloth_line', -8.0, 4.6, 17.6, { yaw: Math.PI / 2, scale: 0.7 }), prop('cloth_line', 8.0, 4.4, 20.6, { yaw: Math.PI / 2, scale: 0.7 }));
light(-20.0, 2.9, 18.7);
light(16.0, 2.9, 21.7);

// West alley (x -19..-16.2) and east alley (x 16.2..19): carts, sacks, cloth lines.
blocks.push(lowCover(-19.0, -2.0, -18.2, -0.4, 1.0, 'wood', 0, 'cover'));
blocks.push(lowCover(18.2, 0.4, 19.0, 2.0, 1.0, 'wood', 0, 'cover'));
props.push(clutter('sacks', -18.4, 0, -16.0, { yaw: 0.2 }), clutter('barrel', -18.6, 0, 12.0), clutter('sacks', 18.4, 0, 16.0, { yaw: 0.9 }), clutter('barrel', 18.6, 0, -12.0));
props.push(prop('cloth_line', -17.6, 4.4, -10.0, { yaw: 0, scale: 0.7 }), prop('cloth_line', 17.6, 4.3, 10.0, { yaw: 0, scale: 0.7 }));
light(-18.7, 2.9, -8.0);
light(18.7, 2.9, 8.0);

// Side lanes beside the tea house.
props.push(clutter('crate', -6.3, 0, -14.0, { scale: 0.9 }), clutter('barrel', 6.3, 0, -9.0), clutter('pot', -4.6, 0, -6.2, { scale: 0.8 }));

// ---------------------------------------------------------------------------
// Perimeter facades: windows, doors and shanasheel bays on the blank walls
// that face the alleys, rooftop hardware on the skyline.
// ---------------------------------------------------------------------------
// North-west quarter (faces alley A, south side).
props.push(...windowRow('window', 'x', 18.95, -23.5, -3.5, 4, 1.7, 'south'));
props.push(...windowRow('shanasheel', 'x', 18.7, -22, -5, 2, 3.6, 'south'));
props.push(prop('door', -17.0, 0, 18.95, { yaw: Math.PI }), prop('door', -8.0, 0, 18.95, { yaw: Math.PI }));
// North-east quarter (faces alley B, south side).
props.push(...windowRow('window', 'x', 21.95, 0, 18, 4, 1.7, 'south'));
props.push(...windowRow('shanasheel', 'x', 21.7, 2, 17, 2, 3.6, 'south'));
props.push(prop('door', 12.0, 0, 21.95, { yaw: Math.PI }), prop('awning', 6.5, 2.6, 21.6, { yaw: Math.PI, tint: [0.2, 0.45, 0.6] }));
// East side (faces the east alley, west side).
props.push(...windowRow('window', 'z', 19.05, 0, 20, 3, 1.7, 'west'));
props.push(...windowRow('shanasheel', 'z', 19.3, 2, 18, 2, 3.6, 'west'));
props.push(prop('door', 19.05, 0, 14.0, { yaw: -Math.PI / 2 }));
// West side (faces the west alley, east side).
props.push(...windowRow('window', 'z', -19.05, -20, 0, 3, 1.7, 'east'));
props.push(...windowRow('shanasheel', 'z', -19.3, -18, -2, 2, 3.6, 'east'));
props.push(prop('door', -19.05, 0, -14.0, { yaw: Math.PI / 2 }));
// South side (faces lane A' / the souq, north side).
props.push(...windowRow('window', 'x', -19.05, 4, 23, 3, 1.7, 'north'));
props.push(...windowRow('window', 'x', -22.05, -18, -3, 3, 1.7, 'north'));
props.push(...windowRow('shanasheel', 'x', -18.8, 6, 22, 2, 3.6, 'north'));
props.push(prop('door', 16.0, 0, -19.05, { yaw: 0 }), prop('awning', 18.5, 2.6, -18.6, { yaw: 0, tint: [0.75, 0.3, 0.2] }));
for (const [x, y, z, yaw] of [[-18.95, 3.2, -6.5, Math.PI / 2], [18.95, 3.2, 6.5, -Math.PI / 2], [-4.0, 3.3, 18.95, Math.PI], [4.0, 3.3, -18.95, 0]] as const) {
  props.push(prop('ac_unit', x, y, z, { yaw }));
}

export const lanes = { blocks, props, lights };
