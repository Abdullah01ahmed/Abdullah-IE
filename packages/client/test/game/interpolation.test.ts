import type { PlayerSnap } from '@tra/shared';
import { describe, expect, it } from 'vitest';
import { InterpolationBuffer, MAX_EXTRAPOLATION_MS, createRemotePose } from '../../src/game/Interpolation';

function snap(id: number, x: number, z: number, extra: Partial<PlayerSnap> = {}): PlayerSnap {
  return {
    id,
    p: [x, 0, z],
    v: [2, 0, 0],
    yaw: 0,
    pitch: 0,
    st: 0,
    w: 0,
    wid: 'dijla7',
    hp: 100,
    alive: 1,
    ads: 0,
    spr: 0,
    rl: 0,
    g: 1,
    team: 'tigris',
    ...extra,
  };
}

describe('InterpolationBuffer', () => {
  it('interpolates position and angles between the two surrounding snapshots', () => {
    const buf = new InterpolationBuffer();
    buf.push(1000, [snap(7, 0, 0, { yaw: 0, pitch: 0.2 })]);
    buf.push(1050, [snap(7, 2, 4, { yaw: 1, pitch: 0.4 })]);
    const pose = createRemotePose();
    expect(buf.sample(7, 1025, pose)).toBe(true);
    expect(pose.x).toBeCloseTo(1, 6);
    expect(pose.z).toBeCloseTo(2, 6);
    expect(pose.yaw).toBeCloseTo(0.5, 6);
    expect(pose.pitch).toBeCloseTo(0.3, 6);
    expect(pose.extrapolated).toBe(false);
  });

  it('takes the shortest path when interpolating yaw across ±π', () => {
    const buf = new InterpolationBuffer();
    buf.push(0, [snap(1, 0, 0, { yaw: Math.PI - 0.1 })]);
    buf.push(100, [snap(1, 0, 0, { yaw: -Math.PI + 0.1 })]);
    const pose = createRemotePose();
    buf.sample(1, 50, pose);
    expect(Math.abs(Math.abs(pose.yaw) - Math.PI)).toBeLessThan(1e-6);
  });

  it('switches discrete fields (stance, weapon) at the midpoint', () => {
    const buf = new InterpolationBuffer();
    buf.push(0, [snap(1, 0, 0, { st: 0, wid: 'dijla7' })]);
    buf.push(100, [snap(1, 1, 0, { st: 1, wid: 'shatt9' })]);
    const pose = createRemotePose();
    buf.sample(1, 40, pose);
    expect(pose.stance).toBe('stand');
    expect(pose.weaponId).toBe('dijla7');
    buf.sample(1, 60, pose);
    expect(pose.stance).toBe('crouch');
    expect(pose.weaponId).toBe('shatt9');
  });

  it('extrapolates along the velocity for at most MAX_EXTRAPOLATION_MS, then holds', () => {
    const buf = new InterpolationBuffer();
    buf.push(0, [snap(1, 0, 0, { v: [4, 0, 0] })]);
    buf.push(50, [snap(1, 0.2, 0, { v: [4, 0, 0] })]);
    const pose = createRemotePose();
    buf.sample(1, 100, pose);
    expect(pose.extrapolated).toBe(true);
    expect(pose.x).toBeCloseTo(0.2 + 4 * 0.05, 6);
    buf.sample(1, 50 + MAX_EXTRAPOLATION_MS + 500, pose);
    expect(pose.x).toBeCloseTo(0.2 + 4 * (MAX_EXTRAPOLATION_MS / 1000), 6);
  });

  it('holds the first sample before the buffer starts and reports unknown players', () => {
    const buf = new InterpolationBuffer();
    const pose = createRemotePose();
    expect(buf.sample(9, 10, pose)).toBe(false);
    buf.push(100, [snap(9, 3, 3)]);
    expect(buf.sample(9, 10, pose)).toBe(true);
    expect(pose.x).toBe(3);
    expect(pose.extrapolated).toBe(false);
  });

  it('does not sweep across a respawn teleport', () => {
    const buf = new InterpolationBuffer();
    buf.push(0, [snap(1, 0, 0, { alive: 0 })]);
    buf.push(100, [snap(1, 30, 30, { alive: 1 })]);
    const pose = createRemotePose();
    buf.sample(1, 30, pose);
    expect(pose.x).toBe(0);
    expect(pose.alive).toBe(false);
    buf.sample(1, 70, pose);
    expect(pose.x).toBe(30);
    expect(pose.alive).toBe(true);
  });

  it('trims history older than a second and removes players', () => {
    const buf = new InterpolationBuffer();
    for (let t = 0; t <= 3000; t += 50) buf.push(t, [snap(1, t / 1000, 0)]);
    const pose = createRemotePose();
    // A sample well inside the trimmed window is still exact.
    buf.sample(1, 2500, pose);
    expect(pose.x).toBeCloseTo(2.5, 6);
    // Very old times clamp to the oldest kept sample (≥ 2 s ago) rather than t=0.
    buf.sample(1, 0, pose);
    expect(pose.x).toBeGreaterThan(1.5);
    buf.remove(1);
    expect(buf.sample(1, 2500, pose)).toBe(false);
    expect(buf.ids()).toEqual([]);
  });

  it('ignores out-of-order snapshots and replaces exact duplicates', () => {
    const buf = new InterpolationBuffer();
    buf.push(100, [snap(1, 1, 0)]);
    buf.push(50, [snap(1, 99, 0)]);
    buf.push(100, [snap(1, 2, 0)]);
    const pose = createRemotePose();
    buf.sample(1, 100, pose);
    expect(pose.x).toBe(2);
    expect(buf.latest(1)?.p[0]).toBe(2);
  });
});
