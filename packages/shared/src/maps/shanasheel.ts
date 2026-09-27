/**
 * Old Baghdad — "Shanasheel" (الشناشيل).
 *
 * A compact 5v5 arena of yellow-brick houses, latticed timber balconies and
 * narrow alleys around a tea-house square. Everything is axis-aligned boxes
 * built with the shared map helpers; the level is split into district modules
 * under ./shanasheel/ and assembled here.
 *
 * Plan (north = +Z, east = +X; the playable area is roughly 60 × 60 m):
 *
 *   • Ring of alleys 2.6–2.8 m wide: west alley (x −19..−16.2), east alley
 *     (x 16.2..19), north alley A (z 16.2..19) joining alley B (z 19.2..22)
 *     through a jog, and the south lane: covered souq (z −22..−19.2, west)
 *     joining lane A' (z −19..−16.2, east).
 *   • Centre block: the square (14 × 14 m) with the blue-tiled gate to the
 *     north, the two-storey Shabandar tea house to the south (rooftop R1 via
 *     interior stairs and a roof hatch), flanked by four enterable courtyard
 *     houses: W1 / E1 carry the rooftops R2 / R3 (courtyard stair → annex roof
 *     → second flight), W2 / E2 are single-storey; shanasheel bridges at 3 m
 *     cross the west and east passages between them.
 *   • Spawns: tigris in the north-west mansion courtyard, euphrates in the
 *     south-east one — point-symmetric, each with two screened corridors.
 *   • Three lanes between the spawns: north loop, square, south souq; the
 *     courtyards, side lanes and the gate passage provide flanks.
 */
import type { MapDef } from '../map/schema';
import type { Vec3 } from '../types';
import { centre, R1 } from './shanasheel/centre';
import { houses, R2, R3 } from './shanasheel/houses';
import { lanes } from './shanasheel/lanes';
import { BOUND, CEILING_BOUND, SQUARE_CENTRE, outer } from './shanasheel/outer';

/** Standing positions on the three rooftops (used by tests and bots' vantage logic). */
export const SHANASHEEL_ROOFTOPS: readonly Vec3[] = [R1, R2, R3];

/** Walkable centre of the tea-house square. */
export const SHANASHEEL_SQUARE_CENTRE: Vec3 = SQUARE_CENTRE;

const ASCII_SKETCH = [
  '        N                                                    ',
  ' +----------------------------------------------------------+',
  ' |  T I G R I S   ####  alley A  ###|J|## alley B ########  |',
  ' |  courtyard  ->| ##W1 yard  ## |gate| N-E  ## E2 yard ## |',
  ' |   ####  ##    | ##  R2  ##   |  |  ##  ## E2 rooms ## |',
  ' |   west  ##    ===bridge===  square  ===bridge===  east  |',
  ' |   alley ##    ## W2 rooms  ## fountain ##  R3   ##  alley |',
  ' |   ####  ##    ## W2 yard   ##[teahouse]## E1 yard ##    |',
  ' |   ####  ##    ##  bakery   ##   R1    ##  ####  <- E U P H |',
  ' |   ####  ==== covered souq ====|J|=== lane A\' === courtyard |',
  ' +----------------------------------------------------------+',
  '        S                                                    ',
].join('\n');

export const shanasheel: MapDef = {
  id: 'shanasheel',
  name: 'Shanasheel',
  nameAr: 'الشناشيل',
  location: 'Old Baghdad',
  locationAr: 'بغداد القديمة',
  description:
    'Narrow alleys between yellow-brick houses with wooden shanasheel balconies, small courtyards, rooftop bridges and a central tea-house square in the golden hour.',
  descriptionAr:
    'أزقة ضيقة بين بيوت من الطابوق الأصفر بشناشيل خشبية، وأفنية صغيرة، وجسور فوق السطوح، وساحة مقهى في الوسط عند الغروب.',
  bounds: { min: { x: -BOUND, y: -1, z: -BOUND }, max: { x: BOUND, y: CEILING_BOUND, z: BOUND } },
  killZ: -12,
  atmosphere: {
    timeOfDay: 'golden',
    sunDir: { x: -0.48, y: 0.42, z: 0.36 },
    sunColor: [1.0, 0.8, 0.56],
    sunIntensity: 3.4,
    skyTop: [0.34, 0.48, 0.76],
    skyHorizon: [0.96, 0.76, 0.56],
    ambientColor: [0.74, 0.66, 0.58],
    ambientIntensity: 0.55,
    fogColor: [0.92, 0.78, 0.6],
    fogDensity: 0.007,
    exposure: 1.05,
    ambience: 'old_city',
    dust: 0.6,
  },
  blocks: [...outer.blocks, ...centre.blocks, ...houses.blocks, ...lanes.blocks],
  props: [...outer.props, ...centre.props, ...houses.props, ...lanes.props],
  lights: [...outer.lights, ...centre.lights, ...houses.lights, ...lanes.lights],
  zones: outer.zones,
  spawns: outer.spawns,
  navCell: 0.5,
  palette: { primary: '#c8a165', secondary: '#5a3d2b', accent: '#2f7f8f' },
  notes: [
    'Reviewer summary: point-symmetric skeleton (spawn mansions NW/SE, ring alleys, four courtyard houses) with',
    'asymmetric dressing. Three rooftops: R1 tea house (5.9 m, interior stairs + hatch, balconies as drops),',
    'R2/R3 house wings (5.6 m, courtyard stair → 3 m annex roof → second flight; bridge and alley drops).',
    'Long alleys are broken by staggered buttresses and the north/south jogs; spawn courtyards are screened.',
    'Non-enterable masses are taller than bounds.max.y so their roofs never become nav islands; thin walls sit',
    'on the 0.5 m nav grid lines for the same reason. Review layouts with: npx tsx packages/shared/scripts/map-ascii.ts shanasheel',
    '',
    ASCII_SKETCH,
  ].join('\n'),
};
