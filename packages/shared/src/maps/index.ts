import type { MapDef, MapSummary } from '../map/schema';
import { summarizeMap } from '../map/schema';
import { testArena } from './test-arena';
import { shanasheel } from './shanasheel';

/** All maps known to the build, keyed by id. */
export const MAPS: Record<string, MapDef> = {
  [shanasheel.id]: shanasheel,
  [testArena.id]: testArena,
};

/** Maps offered in the lobby (excludes test maps). */
export const PLAYABLE_MAP_IDS: readonly string[] = [shanasheel.id];

export function getMap(id: string): MapDef | undefined {
  return MAPS[id];
}

export function getMapOrDefault(id: string): MapDef {
  return MAPS[id] ?? shanasheel;
}

export function listPlayableMaps(): MapSummary[] {
  return PLAYABLE_MAP_IDS.map((id) => summarizeMap(MAPS[id]));
}

export { testArena, shanasheel };
