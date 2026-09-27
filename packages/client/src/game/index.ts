/**
 * Game world factory. The Babylon.js implementation lives in ./GameWorld.ts.
 */
import { GameWorld, type GameWorldOptions } from './GameWorld';
import type { GameWorldDeps, IGameWorld } from './types';

export function createGameWorld(deps: GameWorldDeps, options?: GameWorldOptions): IGameWorld {
  return new GameWorld(deps, options);
}

export type { IGameWorld, GameWorldDeps } from './types';
export type { GameWorldOptions } from './GameWorld';
