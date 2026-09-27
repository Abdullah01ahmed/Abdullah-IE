import { BTN, TICK_DT, buildCollisionWorld, clonePlayerState, createPlayerState, simulateStep, stepWeapons, testArena, type InputCmd, type PlayerSimState } from '@tra/shared';
import { describe, expect, it } from 'vitest';
import { Predictor, applyCommand, type TickIntent } from '../../src/game/Prediction';

const world = buildCollisionWorld(testArena);

function intentAt(i: number): TickIntent {
  return {
    moveX: i % 50 > 40 ? 1 : 0,
    moveY: i % 30 < 20 ? 1 : 0,
    yaw: 0.3 + i * 0.01,
    pitch: Math.sin(i * 0.05) * 0.3,
    buttons: (i % 70 === 5 ? BTN.JUMP : 0) | (i > 100 && i < 160 ? BTN.SPRINT : 0) | (i > 40 && i < 70 ? BTN.FIRE : 0) | (i === 90 ? BTN.SWITCH : 0),
  };
}

function runAll(initial: PlayerSimState, n: number): PlayerSimState {
  const s = clonePlayerState(initial);
  for (let i = 1; i <= n; i++) {
    const it = intentAt(i);
    const cmd: InputCmd = { seq: i, ...it, time: i * 16 };
    simulateStep(s, cmd, world, TICK_DT);
    stepWeapons(s, cmd, TICK_DT);
  }
  return s;
}

describe('Predictor', () => {
  const initial = createPlayerState({ x: -10, y: 0, z: -10 }, 0.3, 'dijla7', 'shatt9');

  it('assigns increasing sequence numbers and keeps pending inputs until acknowledged', () => {
    const p = new Predictor(world, initial);
    const a = p.step(intentAt(1), 10);
    const b = p.step(intentAt(2), 26);
    expect(a.cmd.seq).toBe(1);
    expect(b.cmd.seq).toBe(2);
    expect(b.cmd.time).toBe(26);
    expect(p.pending.map((c) => c.seq)).toEqual([1, 2]);
    p.reconcile(clonePlayerState(p.state), 1);
    expect(p.pending.map((c) => c.seq)).toEqual([2]);
  });

  it('prediction + replay after a partial ack equals running every input in one go', () => {
    const N = 200;
    const p = new Predictor(world, initial);
    for (let i = 1; i <= N; i++) p.step(intentAt(i), i * 16);
    // The "server" processed the first 120 inputs from the same initial state.
    const serverState = runAll(initial, 120);
    const correction = p.reconcile(serverState, 120);
    expect(correction.replayed).toBe(N - 120);
    expect(correction.error).toBeLessThan(1e-9);
    const expected = runAll(initial, N);
    expect(p.state).toEqual(expected);
  });

  it('reports the position error when the server disagrees, and adopts the corrected state', () => {
    const p = new Predictor(world, initial);
    for (let i = 1; i <= 30; i++) p.step({ moveX: 0, moveY: 1, yaw: 0, pitch: 0, buttons: 0 }, i * 16);
    const server = runAll(initial, 0);
    // Server has the player somewhere else entirely (e.g. it rejected the movement).
    server.pos.x = -5;
    server.pos.z = 5;
    const before = { ...p.state.pos };
    const c = p.reconcile(server, 30);
    expect(c.replayed).toBe(0);
    expect(c.error).toBeCloseTo(Math.hypot(before.x - -5, before.y - 0, before.z - 5), 6);
    expect(p.state.pos.x).toBe(-5);
    expect(p.state.pos.z).toBe(5);
    expect(c.dx).toBeCloseTo(before.x - -5, 6);
  });

  it('reset adopts a state wholesale and drops pending inputs', () => {
    const p = new Predictor(world, initial);
    for (let i = 1; i <= 5; i++) p.step(intentAt(i), i * 16);
    const spawn = createPlayerState({ x: 5, y: 0, z: 5 }, 1, 'shatt9', 'dijla7');
    p.reset(spawn);
    expect(p.pending).toHaveLength(0);
    expect(p.state.pos).toEqual(spawn.pos);
    expect(p.state.weapons[0].id).toBe('shatt9');
    expect(p.seq).toBe(5); // sequence keeps counting across respawns
  });

  it('applyCommand reports fire events and consumes ammo', () => {
    const s = clonePlayerState(initial);
    const r = applyCommand(s, { seq: 1, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: BTN.FIRE, time: 0 }, world);
    expect(r.events.some((e) => e.kind === 'fire')).toBe(true);
    expect(s.weapons[0].ammo).toBe(initial.weapons[0].ammo - 1);
  });
});
