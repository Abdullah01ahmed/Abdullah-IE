/**
 * Game world factory. The Babylon.js implementation lives in ./GameWorld.ts.
 * Until it exists this module exports a null world so the UI can be developed.
 */
import type { MatchResults, MatchStartInfo, RoomState, Snapshot } from '@tra/shared';
import type { ClientSettings } from '../state/settings';
import type { GameWorldDeps, IGameWorld } from './types';

class NullGameWorld implements IGameWorld {
  constructor(private deps: GameWorldDeps) {}
  async attach(_canvas: HTMLCanvasElement): Promise<void> {}
  async loadMatch(_info: MatchStartInfo, _selfId: number, _room: RoomState, onProgress: (p: number, l: string) => void): Promise<void> {
    onProgress(1, 'ready');
    void this.deps;
  }
  onRoom(_room: RoomState): void {}
  onSnapshot(_snap: Snapshot): void {}
  onMatchEnd(_results: MatchResults): void {}
  unloadMatch(): void {}
  setPaused(_paused: boolean): void {}
  applySettings(_settings: ClientSettings): void {}
  requestPointerLock(): void {}
  resize(): void {}
  dispose(): void {}
}

export function createGameWorld(deps: GameWorldDeps): IGameWorld {
  return new NullGameWorld(deps);
}

export type { IGameWorld, GameWorldDeps } from './types';
