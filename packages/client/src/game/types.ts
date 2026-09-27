/**
 * Interface between the React shell / Session and the 3D game world.
 * `game/index.ts` exports `createGameWorld()` which returns an implementation.
 */
import type { MatchResults, MatchStartInfo, RoomState, Snapshot } from '@tra/shared';
import type { ClientSettings } from '../state/settings';

export interface IGameWorld {
  /** Create the engine on the canvas. Safe to call once. */
  attach(canvas: HTMLCanvasElement): Promise<void>;
  /**
   * Load a match (map, materials, weapon models, audio). Reports progress in
   * [0, 1] through `onProgress`. Resolves when the match is renderable.
   */
  loadMatch(info: MatchStartInfo, selfId: number, room: RoomState, onProgress: (progress: number, label: string) => void): Promise<void>;
  /** Room/lobby state changed (players joined/left, names, teams). */
  onRoom(room: RoomState): void;
  /** Authoritative snapshot from the server. */
  onSnapshot(snap: Snapshot): void;
  /** The match ended; freeze input, keep rendering for the results backdrop. */
  onMatchEnd(results: MatchResults): void;
  /** Leave the match: unload the map and stop simulating (engine stays attached). */
  unloadMatch(): void;
  /** Pause menu open/closed: releases/acquires pointer lock and mutes input. */
  setPaused(paused: boolean): void;
  /** Settings changed (graphics/audio/controls/fov). */
  applySettings(settings: ClientSettings): void;
  /** Request pointer lock (call from a user gesture). */
  requestPointerLock(): void;
  /** Canvas size changed. */
  resize(): void;
  /** Tear down the engine. */
  dispose(): void;
  /**
   * True while the canvas holds pointer lock. During a match the UI shows a
   * "click to resume" overlay when this is false (the UI owns pausing).
   */
  isPointerLocked?(): boolean;
  /** Subscribe to pointer-lock changes; returns an unsubscribe function. */
  onPointerLock?(cb: (locked: boolean) => void): () => void;
}

export interface GameWorldDeps {
  /** Sends input commands and other messages to the server. */
  sendInputs(cmds: import('@tra/shared').InputCmd[]): void;
  /** Estimated server time in ms (from the connection's clock sync). */
  serverNow(): number;
  /** Current round-trip time in ms. */
  rtt(): number;
}
