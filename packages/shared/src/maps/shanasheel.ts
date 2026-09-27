/**
 * Old Baghdad — "Shanasheel".
 *
 * PLACEHOLDER LAYOUT: this file is replaced by the full level design. It keeps
 * the id/metadata stable so the rest of the game can be developed against it.
 */
import { box, cover, roomWalls, spawn, stairs } from '../map/builder';
import type { MapDef } from '../map/schema';

const SIZE = 48;

export const shanasheel: MapDef = {
  id: 'shanasheel',
  name: 'Shanasheel',
  nameAr: 'الشناشيل',
  location: 'Old Baghdad',
  locationAr: 'بغداد القديمة',
  description: 'Narrow alleys, brick houses with wooden shanasheel balconies, small courtyards and a central tea-house square.',
  descriptionAr: 'أزقة ضيقة وبيوت من الطابوق بشناشيل خشبية وأفنية صغيرة وساحة مقهى في الوسط.',
  bounds: { min: { x: -SIZE / 2, y: -1, z: -SIZE / 2 }, max: { x: SIZE / 2, y: 14, z: SIZE / 2 } },
  killZ: -15,
  atmosphere: {
    timeOfDay: 'golden',
    sunDir: { x: -0.45, y: 0.55, z: 0.35 },
    sunColor: [1.0, 0.82, 0.6],
    sunIntensity: 3.2,
    skyTop: [0.36, 0.5, 0.78],
    skyHorizon: [0.95, 0.78, 0.6],
    ambientColor: [0.72, 0.66, 0.6],
    ambientIntensity: 0.55,
    fogColor: [0.9, 0.78, 0.62],
    fogDensity: 0.006,
    exposure: 1.05,
    ambience: 'old_city',
    dust: 0.6,
  },
  blocks: [
    box(-SIZE / 2, -1, -SIZE / 2, SIZE, 1, SIZE, 'cobble', { tag: 'ground' }),
    ...roomWalls(-SIZE / 2, 0, -SIZE / 2, SIZE, 7, SIZE, 'brick', { thickness: 1, tag: 'perimeter' }),
    box(-5, 0, -5, 10, 3, 10, 'brick', { tag: 'teahouse' }),
    ...stairs(-1.5, 0, -9, 'north', 3, 3, 4, 'stone'),
    ...stairs(-1.5, 0, 9, 'south', 3, 3, 4, 'stone'),
    // parapet with gaps where the stairs arrive (x -1.5..1.5)
    box(-5, 3, -5, 3.5, 0.9, 0.3, 'brick', { tag: 'parapet' }),
    box(1.5, 3, -5, 3.5, 0.9, 0.3, 'brick', { tag: 'parapet' }),
    box(-5, 3, 4.7, 3.5, 0.9, 0.3, 'brick', { tag: 'parapet' }),
    box(1.5, 3, 4.7, 3.5, 0.9, 0.3, 'brick', { tag: 'parapet' }),
    box(-5, 3, -4.7, 0.3, 0.9, 9.4, 'brick', { tag: 'parapet' }),
    box(4.7, 3, -4.7, 0.3, 0.9, 9.4, 'brick', { tag: 'parapet' }),
    cover(-14, 0, -3, 1.2, 5, 'wood', 1.1),
    cover(12.8, 0, -3, 1.2, 5, 'wood', 1.1),
    cover(-3, 0, -16, 6, 1.2, 'wood', 1.0),
    cover(-3, 0, 14.8, 6, 1.2, 'wood', 1.0),
    box(-19, 0, -8, 0.6, 3.5, 16, 'plaster', { tag: 'shield' }),
    box(18.4, 0, -8, 0.6, 3.5, 16, 'plaster', { tag: 'shield' }),
  ],
  props: [],
  lights: [],
  zones: [],
  spawns: {
    tigris: [spawn(-21, 0, -6, 90), spawn(-21, 0, -3, 90), spawn(-21, 0, 0, 90), spawn(-21, 0, 3, 90), spawn(-21, 0, 6, 90)],
    euphrates: [spawn(21, 0, -6, -90), spawn(21, 0, -3, -90), spawn(21, 0, 0, -90), spawn(21, 0, 3, -90), spawn(21, 0, 6, -90)],
    neutral: [spawn(0, 3, 0, 0), spawn(-12, 0, 12, 45), spawn(12, 0, -12, -135), spawn(-12, 0, -12, 135), spawn(12, 0, 12, -45)],
  },
  navCell: 0.5,
  palette: { primary: '#c8a165', secondary: '#5a3d2b', accent: '#2f7f8f' },
};
