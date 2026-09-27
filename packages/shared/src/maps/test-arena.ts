/**
 * A tiny symmetrical test arena used by automated tests and as a fallback map.
 * Not part of the shipped rotation.
 */
import { box, cover, roomWalls, spawn, stairs } from '../map/builder';
import type { MapDef } from '../map/schema';

const SIZE = 40;

export const testArena: MapDef = {
  id: 'test_arena',
  name: 'Test Arena',
  nameAr: 'ساحة الاختبار',
  location: 'Nowhere',
  locationAr: 'لا مكان',
  description: 'Symmetrical box arena used by automated tests.',
  descriptionAr: 'ساحة اختبار متناظرة للاختبارات الآلية.',
  bounds: { min: { x: -SIZE / 2, y: -1, z: -SIZE / 2 }, max: { x: SIZE / 2, y: 12, z: SIZE / 2 } },
  killZ: -15,
  atmosphere: {
    timeOfDay: 'noon',
    sunDir: { x: 0.3, y: 0.8, z: 0.5 },
    sunColor: [1, 0.96, 0.9],
    sunIntensity: 3,
    skyTop: [0.35, 0.55, 0.85],
    skyHorizon: [0.8, 0.85, 0.9],
    ambientColor: [0.6, 0.65, 0.75],
    ambientIntensity: 0.6,
    fogColor: [0.8, 0.82, 0.85],
    fogDensity: 0.004,
    exposure: 1,
    ambience: 'none',
    dust: 0.1,
  },
  blocks: [
    // ground
    box(-SIZE / 2, -1, -SIZE / 2, SIZE, 1, SIZE, 'ground', { tag: 'ground' }),
    // perimeter walls
    ...roomWalls(-SIZE / 2, 0, -SIZE / 2, SIZE, 6, SIZE, 'brick', { thickness: 1, tag: 'perimeter' }),
    // central platform with stairs on both sides
    box(-4, 0, -4, 8, 2.4, 8, 'stone', { tag: 'platform' }),
    ...stairs(-1.5, 0, -8, 'north', 3, 2.4, 4, 'stone'),
    ...stairs(-1.5, 0, 8, 'south', 3, 2.4, 4, 'stone'),
    // parapet with gaps where the stairs arrive (x -1.5..1.5)
    box(-4, 2.4, -4, 2.5, 0.6, 0.2, 'stone', { tag: 'parapet' }),
    box(1.5, 2.4, -4, 2.5, 0.6, 0.2, 'stone', { tag: 'parapet' }),
    box(-4, 2.4, 3.8, 2.5, 0.6, 0.2, 'stone', { tag: 'parapet' }),
    box(1.5, 2.4, 3.8, 2.5, 0.6, 0.2, 'stone', { tag: 'parapet' }),
    box(-4, 2.4, -3.8, 0.2, 0.6, 7.6, 'stone', { tag: 'parapet' }),
    box(3.8, 2.4, -3.8, 0.2, 0.6, 7.6, 'stone', { tag: 'parapet' }),
    // cover pieces
    cover(-12, 0, -2, 1, 4, 'wood', 1.1),
    cover(11, 0, -2, 1, 4, 'wood', 1.1),
    cover(-2, 0, -14, 4, 1, 'wood', 1.1),
    cover(-2, 0, 13, 4, 1, 'wood', 1.1),
    // spawn-shielding walls
    box(-16, 0, -6, 0.5, 3, 12, 'plaster', { tag: 'shield' }),
    box(15.5, 0, -6, 0.5, 3, 12, 'plaster', { tag: 'shield' }),
    // a low ledge to test mantling (1.1 m)
    box(6, 0, 6, 3, 1.1, 3, 'concrete', { tag: 'ledge' }),
  ],
  props: [],
  lights: [],
  zones: [],
  spawns: {
    tigris: [spawn(-17.5, 0, -4, 90), spawn(-17.5, 0, -2, 90), spawn(-17.5, 0, 0, 90), spawn(-17.5, 0, 2, 90), spawn(-17.5, 0, 4, 90)],
    euphrates: [spawn(17.5, 0, -4, -90), spawn(17.5, 0, -2, -90), spawn(17.5, 0, 0, -90), spawn(17.5, 0, 2, -90), spawn(17.5, 0, 4, -90)],
    neutral: [spawn(0, 2.4, 0, 0), spawn(-10, 0, 10, 45), spawn(10, 0, -10, -135), spawn(-10, 0, -10, 135), spawn(10, 0, 10, -45)],
  },
  navCell: 0.5,
  palette: { primary: '#777', secondary: '#444', accent: '#c96' },
};
