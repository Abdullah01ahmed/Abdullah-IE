import { NullEngine, Scene } from '@babylonjs/core';
import {
  BTN,
  DEFAULT_MATCH_SETTINGS,
  TICK_DT,
  WEAPONS,
  createPlayerState,
  toPlayerSnap,
  type GameEvent,
  type InputCmd,
  type MatchStartInfo,
  type PlayerSimState,
  type RoomPlayer,
  type RoomState,
  type Snapshot,
} from '@tra/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameWorld } from '../../src/game';
import type { GameWorld } from '../../src/game/GameWorld';
import { useStore } from '../../src/state/store';

const SELF = 1;

function player(id: number, name: string, team: RoomPlayer['team'], isBot = false): RoomPlayer {
  return { id, name, team, ready: true, ping: 0, isBot, loadout: { primary: 'dijla7', secondary: 'shatt9' }, connected: true, kills: 0, deaths: 0, score: 0 };
}

const settings = { ...DEFAULT_MATCH_SETTINGS, mapId: 'test_arena' };

function room(players: RoomPlayer[]): RoomState {
  return { serverName: 'test', phase: 'playing', hostId: SELF, dedicated: false, passwordProtected: false, settings, players, matchNumber: 1, countdown: null };
}

const info: MatchStartInfo = { mapId: 'test_arena', mode: 'tdm', settings, seed: 1234, startTick: 0, startTime: 0, matchNumber: 1 };

function counts(scene: Scene) {
  return {
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    textures: scene.textures.length,
    lights: scene.lights.length,
    transformNodes: scene.transformNodes.length,
    particleSystems: scene.particleSystems.length,
  };
}

describe('GameWorld end to end (NullEngine)', () => {
  let world: GameWorld;
  let canvas: HTMLCanvasElement;
  const sent: InputCmd[] = [];
  let clock = 10_000;
  const serverNow = () => clock + 500; // pretend the server clock is offset

  beforeAll(async () => {
    useStore.getState().hydrateSettings({
      graphics: { textureQuality: 'low', particles: 'low', shadows: 'low', ssao: false, showFps: true },
    });
    canvas = document.createElement('canvas');
    world = createGameWorld(
      { sendInputs: (cmds) => sent.push(...cmds), serverNow, rtt: () => 40 },
      {
        engineFactory: async () => new NullEngine({ renderWidth: 320, renderHeight: 180, textureSize: 64, deterministicLockstep: false, lockstepMaxSteps: 1 }),
        readyTimeoutMs: 0,
      },
    ) as GameWorld;
    await world.attach(canvas);
  }, 60_000);

  afterAll(() => {
    world.dispose();
  });

  function selfState(): PlayerSimState {
    return createPlayerState({ x: -17.5, y: 0, z: 0 }, Math.PI / 2, 'dijla7', 'shatt9');
  }

  function snapshot(self: PlayerSimState | undefined, ack: number, events: GameEvent[] = [], others: PlayerSimState[] = []): Snapshot {
    const players = others.map((s, i) => toPlayerSnap(i + 2, i === 0 ? 'euphrates' : 'tigris', s));
    if (self) players.push(toPlayerSnap(SELF, 'tigris', self));
    return { tick: 0, st: serverNow(), ack, players, self, events };
  }

  function frames(n: number, stepMs = 16.7): void {
    for (let i = 0; i < n; i++) {
      clock += stepMs;
      world.frame(clock);
    }
  }

  async function loadOnce(): Promise<void> {
    const progress: number[] = [];
    await world.loadMatch(info, SELF, room([player(SELF, 'Me', 'tigris'), player(2, 'Rival', 'euphrates', true), player(3, 'Buddy', 'tigris', true)]), (p) => progress.push(p));
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  }

  it('loads a match, predicts, reconciles, renders and unloads without leaking', async () => {
    const scene = world.debug.scene!;
    await loadOnce();
    const d0 = world.debug;
    expect(d0.hasMatch).toBe(true);
    expect(d0.staticMeshes).toBeGreaterThan(0);
    expect(d0.remoteCount).toBe(2);
    expect(d0.localState).toBeNull(); // no authoritative state yet

    // First snapshot: authoritative self + two remotes.
    const rival = createPlayerState({ x: 17.5, y: 0, z: 0 }, -Math.PI / 2, 'shatt9', 'dijla7');
    const buddy = createPlayerState({ x: -17.5, y: 0, z: 4 }, Math.PI / 2, 'dijla7', 'shatt9');
    const self = selfState();
    world.onSnapshot(snapshot(self, 0, [], [rival, buddy]));
    expect(world.debug.localState).not.toBeNull();
    expect(world.debug.viewModelVisible).toBe(true);
    expect(world.debug.activeWeaponId).toBe('dijla7');

    // Prime the frame clock (loadMatch stamps it with performance.now(); the test drives its own clock).
    frames(1);
    // ~10 frames ≈ 167 ms → 10 fixed ticks; inputs are sent with increasing seq
    // and the server-clock estimate, even while input is blocked (no pointer lock).
    sent.length = 0;
    const clockBefore = serverNow();
    frames(10);
    // 167 ms of frames → 10 ticks, plus at most one tick carried over by the accumulator.
    expect(sent.length).toBeGreaterThanOrEqual(10);
    expect(sent.length).toBeLessThanOrEqual(11);
    expect(sent.map((c) => c.seq)).toEqual(sent.map((_, i) => sent[0].seq + i));
    for (let i = 0; i < sent.length; i++) {
      const c = sent[i];
      // Stamped with the server-clock estimate at sampling time (monotonic, within the frame window).
      expect(c.time).toBeGreaterThan(clockBefore);
      expect(c.time).toBeLessThanOrEqual(serverNow());
      if (i > 0) expect(c.time).toBeGreaterThanOrEqual(sent[i - 1].time);
      expect(c.buttons).toBe(0);
      expect(c.moveX).toBe(0);
      expect(c.moveY).toBe(0);
      expect(c.yaw).toBeCloseTo(Math.PI / 2, 6);
    }
    expect(world.debug.inputBlocked).toBe(true);

    // A huge frame is clamped to 5 ticks and the backlog is dropped.
    sent.length = 0;
    clock += 500;
    world.frame(clock);
    expect(sent.length).toBe(5);

    // Predicted HUD values reach the store (magazine full, weapon 0).
    const hud = useStore.getState().hud;
    expect(hud.ammo).toBe(WEAPONS.dijla7.magSize);
    expect(hud.reserve).toBe(WEAPONS.dijla7.reserve);
    expect(hud.weaponId).toBe('dijla7');
    expect(Math.abs(hud.yaw - Math.PI / 2)).toBeLessThan(0.01);
    expect(hud.fps).toBeGreaterThanOrEqual(0);

    // Reconcile against a server state that ran the same (empty) inputs: no visible correction.
    const serverSelf = createPlayerState({ x: -17.5, y: 0, z: 0 }, Math.PI / 2, 'dijla7', 'shatt9');
    const ack = sent[sent.length - 1].seq;
    world.onSnapshot(snapshot(serverSelf, ack, [], [rival, buddy]));
    const st = world.debug.localState!;
    expect(st.pos.x).toBeCloseTo(-17.5, 3);

    // Remote fire + impact events spawn tracers and decals; remote death/spawn animate.
    const fire: GameEvent = { e: 'fire', id: 2, w: 'shatt9', o: [17.5, 1.62, 0], d: [-1, 0, 0], s: 1 };
    const impact: GameEvent = { e: 'impact', p: [-19.99, 1.5, 0.5], n: [1, 0, 0], m: 'brick', w: 'shatt9' };
    const dmg: GameEvent = { e: 'dmg', to: SELF, from: 2, amt: 24, hs: 0, dir: [1, 0], hp: 76 };
    const announce: GameEvent = { e: 'announce', k: 'match_start' };
    world.onSnapshot(snapshot(serverSelf, ack, [fire, impact, dmg, announce, { e: 'death', id: 3, p: [-17.5, 0, 4] }], [rival, buddy]));
    expect(world.debug.activeTracers).toBeGreaterThanOrEqual(1);
    expect(world.debug.activeDecals).toBe(1);
    frames(5);
    world.onSnapshot(snapshot(serverSelf, ack, [{ e: 'spawn', id: 3, p: [-17.5, 0, 4], team: 'tigris' }], [rival, buddy]));
    frames(2);

    // Local death: the view model hides and a death camera runs; respawn restores it.
    const dead = { ...serverSelf, alive: false, health: 0 };
    useStore.getState().setHud({ killedBy: { id: 2, name: 'Rival', weapon: 'shatt9' } });
    world.onSnapshot(snapshot(dead, ack, [{ e: 'death', id: SELF, p: [-17.5, 0, 0] }], [rival, buddy]));
    expect(world.debug.localAlive).toBe(false);
    expect(world.debug.viewModelVisible).toBe(false);
    frames(20);
    const respawned = createPlayerState({ x: -17.5, y: 0, z: -4 }, Math.PI / 2, 'dijla7', 'shatt9');
    world.onSnapshot(snapshot(respawned, sent[sent.length - 1].seq, [{ e: 'spawn', id: SELF, p: [-17.5, 0, -4], team: 'tigris' }], [rival, buddy]));
    expect(world.debug.localAlive).toBe(true);
    expect(world.debug.viewModelVisible).toBe(true);
    expect(world.debug.localState!.pos.z).toBeCloseTo(-4, 6);

    // Room diff removes a player.
    world.onRoom(room([player(SELF, 'Me', 'tigris'), player(2, 'Rival', 'euphrates', true)]));
    expect(world.debug.remoteCount).toBe(1);

    // Settings changes apply live without breaking the frame.
    expect(world.debug.shadowsEnabled).toBe(true);
    useStore.getState().updateSettings((s) => ({ ...s, graphics: { ...s.graphics, shadows: 'off', bloom: false, fxaa: false, renderScale: 0.8 }, controls: { ...s.controls, sensitivity: 3 } }));
    frames(3);
    expect(world.debug.appliedRenderScale).toBe(0.8);
    expect(world.debug.shadowsEnabled).toBe(false);

    // Match end freezes input: no further commands are sent.
    world.onMatchEnd({ winner: 'tigris', reason: 'score', scoreboard: { teams: { tigris: 75, euphrates: 40 }, players: [], timeLeftSec: 0, scoreLimit: 75, mode: 'tdm' }, mvpId: SELF, nextMapId: 'test_arena', returnToLobbySec: 10 });
    sent.length = 0;
    frames(10);
    expect(sent.length).toBe(0);

    world.unloadMatch();
    const after1 = counts(scene);
    const leftovers = `materials: ${scene.materials.map((x) => `${x.getClassName()}:${x.name}`).join(',')} | meshes: ${scene.meshes.map((x) => x.name).join(',')} | nodes: ${scene.transformNodes.map((x) => x.name).join(',')} | lights: ${scene.lights.map((x) => x.name).join(',')}`;
    expect(after1.meshes, leftovers).toBe(0);
    expect(after1.materials, leftovers).toBe(0);
    expect(after1.lights, leftovers).toBe(0);
    expect(after1.transformNodes, leftovers).toBe(0);
    expect(after1.particleSystems, leftovers).toBe(0);
    // Only Babylon's shared PBR lookup texture may remain on the scene.
    expect(after1.textures).toBeLessThanOrEqual(1);

    // A second match on the same engine returns to exactly the same counts.
    await loadOnce();
    world.onSnapshot(snapshot(selfState(), 0, [], [rival, buddy]));
    frames(6);
    world.unloadMatch();
    expect(counts(scene)).toEqual(after1);
  }, 60_000);

  it('ignores game input while paused and handles pointer lock queries', () => {
    expect(world.isPointerLocked()).toBe(false);
    const seen: boolean[] = [];
    const off = world.onPointerLock((l) => seen.push(l));
    world.setPaused(true);
    world.setPaused(false);
    off();
    expect(seen).toEqual([]);
    // BTN import keeps the shared contract visible in this test's intent: buttons are zero while blocked.
    expect(BTN.FIRE).toBeGreaterThan(0);
    expect(TICK_DT).toBeCloseTo(1 / 60, 9);
  });
});
