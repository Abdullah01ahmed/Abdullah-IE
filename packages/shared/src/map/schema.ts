/**
 * Map definition schema. Maps are authored in TypeScript (see ../maps) with the
 * builder helpers in ./builder.ts. Collision is entirely axis-aligned boxes; the
 * renderer dresses those boxes with materials and adds decorative props.
 */
import type { AABB, Team, Vec3 } from '../types';

export type MaterialId =
  | 'brick'        // yellow Baghdad brick
  | 'brick_dark'   // darker/older brick
  | 'plaster'      // painted plaster
  | 'plaster_worn' // flaking plaster over brick
  | 'stone'        // cut stone
  | 'wood'         // shanasheel timber, doors
  | 'lattice'      // mashrabiya lattice screen (rendered with cut-out)
  | 'roof'         // flat roof surface
  | 'ground'       // packed earth / dust
  | 'cobble'       // stone paving
  | 'tile'         // glazed tile
  | 'metal'        // corrugated / painted metal
  | 'fabric'       // awnings, rugs
  | 'concrete'
  | 'water'
  | 'sand'
  | 'glass'
  | 'invisible';   // collision only (blockers, spawn roofs)

export interface MapBlock {
  min: Vec3;
  max: Vec3;
  material: MaterialId;
  /** Optional free-form tag for tooling/tests (e.g. 'stairs', 'balcony', 'spawn-roof'). */
  tag?: string;
  /** Decorative only — not part of collision. Default false. */
  noCollide?: boolean;
  /** Texture tiling override (repeat per metre). */
  uvScale?: number;
  /** Tint multiplier applied by the renderer. */
  tint?: [number, number, number];
}

export type PropKind =
  | 'palm'
  | 'lantern'
  | 'table'
  | 'chair'
  | 'rug'
  | 'awning'
  | 'pot'
  | 'crate'
  | 'barrel'
  | 'sign'
  | 'door'
  | 'window'
  | 'arch'
  | 'teapot'
  | 'bicycle'
  | 'sacks'
  | 'cloth_line'
  | 'shanasheel'
  | 'fountain'
  | 'bench'
  | 'antenna'
  | 'ac_unit'
  | 'satellite_dish'
  | 'water_tank'
  | 'flag';

export interface MapProp {
  kind: PropKind;
  pos: Vec3;
  /** Rotation around Y (radians). */
  yaw?: number;
  scale?: number;
  /** Text for signs (Arabic strings welcome). */
  text?: string;
  /** Adds a collision box derived from the prop's footprint. Default depends on kind. */
  collide?: boolean;
  tint?: [number, number, number];
}

export interface SpawnPoint {
  pos: Vec3;
  yaw: number;
}

export interface MapLight {
  kind: 'point' | 'spot';
  pos: Vec3;
  color: [number, number, number];
  intensity: number;
  range: number;
  /** Spot lights only: direction and cone angle (radians). */
  dir?: Vec3;
  angle?: number;
}

export interface MapZone {
  id: string;
  kind: 'domination' | 'hardpoint' | 'spawn_protect' | 'out_of_bounds';
  box: AABB;
  team?: Team;
  label?: string;
}

export interface Atmosphere {
  /** Named preset for the client's sky/lighting rig. */
  timeOfDay: 'dawn' | 'morning' | 'noon' | 'afternoon' | 'golden' | 'dusk' | 'night';
  /** Normalised direction TO the sun. */
  sunDir: Vec3;
  sunColor: [number, number, number];
  sunIntensity: number;
  skyTop: [number, number, number];
  skyHorizon: [number, number, number];
  ambientColor: [number, number, number];
  ambientIntensity: number;
  fogColor: [number, number, number];
  /** Exponential fog density (0 = none). */
  fogDensity: number;
  exposure: number;
  /** Ambient soundscape id for the audio system. */
  ambience: string;
  /** Dust/particle density hint 0..1. */
  dust: number;
}

export interface MapDef {
  id: string;
  name: string;
  nameAr: string;
  location: string;
  locationAr: string;
  description: string;
  descriptionAr: string;
  /** Playable bounds; players outside are killed after a grace period. */
  bounds: AABB;
  /** Y below which players die. */
  killZ: number;
  atmosphere: Atmosphere;
  blocks: MapBlock[];
  props: MapProp[];
  lights: MapLight[];
  zones: MapZone[];
  spawns: Record<Team, SpawnPoint[]> & { neutral: SpawnPoint[] };
  /** Recommended nav grid cell size for this map (m). */
  navCell: number;
  /** Accent palette used by UI (loading screen, cards). */
  palette: { primary: string; secondary: string; accent: string };
  /** Author notes for reviewers. */
  notes?: string;
}

export interface MapSummary {
  id: string;
  name: string;
  nameAr: string;
  location: string;
  locationAr: string;
  description: string;
  descriptionAr: string;
  palette: MapDef['palette'];
}

export function summarizeMap(map: MapDef): MapSummary {
  return {
    id: map.id,
    name: map.name,
    nameAr: map.nameAr,
    location: map.location,
    locationAr: map.locationAr,
    description: map.description,
    descriptionAr: map.descriptionAr,
    palette: map.palette,
  };
}

/** Collision boxes of a map (blocks that are not decorative). */
export function collisionBlocks(map: MapDef): MapBlock[] {
  return map.blocks.filter((b) => !b.noCollide);
}
