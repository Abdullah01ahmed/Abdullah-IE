import { DEG2RAD, MOVEMENT } from '@tra/shared';
import { describe, expect, it } from 'vitest';
import { ADS_FOV_MULT, CameraRig, DEGREES_PER_COUNT, MAX_PITCH, verticalFov, type RigInput, type RigOutput } from '../../src/game/CameraRig';

function input(over: Partial<RigInput> = {}): RigInput {
  return {
    dt: 1 / 60, x: 0, y: 0, z: 0, stance: 'stand', speed: 0, lateralSpeed: 0, onGround: true, ads: 0, sprinting: false,
    landedSpeed: 0, reduceShake: false, hfovDeg: 90, aspect: 16 / 9, ...over,
  };
}

function run(rig: CameraRig, inp: RigInput, frames: number): RigOutput {
  const out: RigOutput = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 0 };
  for (let i = 0; i < frames; i++) rig.update(inp, out);
  return out;
}

describe('CameraRig', () => {
  it('converts horizontal FOV to vertical FOV for the aspect ratio', () => {
    // 90° horizontal at 16:9 ≈ 58.7° vertical; at 1:1 they are equal.
    expect(verticalFov(90, 16 / 9) / DEG2RAD).toBeCloseTo(58.72, 1);
    expect(verticalFov(90, 1) / DEG2RAD).toBeCloseTo(90, 6);
  });

  it('applies mouse look with the 0.022°/count convention, ADS multiplier and invert-Y', () => {
    const rig = new CameraRig();
    rig.addLook(100, 50, 5, 1, false);
    expect(rig.yaw).toBeCloseTo(100 * 5 * DEGREES_PER_COUNT * DEG2RAD, 9);
    expect(rig.pitch).toBeCloseTo(50 * 5 * DEGREES_PER_COUNT * DEG2RAD, 9);
    const rig2 = new CameraRig();
    rig2.addLook(100, 50, 5, 0.5, true);
    expect(rig2.yaw).toBeCloseTo(rig.yaw / 2, 9);
    expect(rig2.pitch).toBeCloseTo(-rig.pitch / 2, 9);
  });

  it('clamps pitch to ±89°', () => {
    const rig = new CameraRig();
    rig.addLook(0, 100000, 5, 1, false);
    expect(rig.pitch).toBe(MAX_PITCH);
    rig.addLook(0, -200000, 5, 1, false);
    expect(rig.pitch).toBe(-MAX_PITCH);
  });

  it('is still at rest: eye at standing height, no bob, base FOV', () => {
    const rig = new CameraRig();
    const out = run(rig, input(), 60);
    expect(out.y).toBeCloseTo(MOVEMENT.eyeHeightStand, 3);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(0, 6);
    expect(out.fov).toBeCloseTo(verticalFov(90, 16 / 9), 6);
  });

  it('eases the eye height to the crouch height within the crouch transition', () => {
    const rig = new CameraRig();
    run(rig, input(), 30);
    const mid = run(rig, input({ stance: 'crouch' }), 3);
    expect(mid.y).toBeLessThan(MOVEMENT.eyeHeightStand);
    expect(mid.y).toBeGreaterThan(MOVEMENT.eyeHeightCrouch);
    const done = run(rig, input({ stance: 'crouch' }), Math.ceil(MOVEMENT.crouchTransition * 60) + 2);
    expect(done.y).toBeCloseTo(MOVEMENT.eyeHeightCrouch, 3);
  });

  it('bobs while moving, less with reduced camera shake, and settles when stopped', () => {
    const moving = input({ speed: MOVEMENT.walkSpeed, sprinting: false });
    const rig = new CameraRig();
    let maxDev = 0;
    for (let i = 0; i < 120; i++) {
      const out = run(rig, moving, 1);
      maxDev = Math.max(maxDev, Math.abs(out.y - MOVEMENT.eyeHeightStand));
    }
    expect(maxDev).toBeGreaterThan(0.005);
    const rigCalm = new CameraRig();
    let maxDevCalm = 0;
    for (let i = 0; i < 120; i++) {
      const out = run(rigCalm, { ...moving, reduceShake: true }, 1);
      maxDevCalm = Math.max(maxDevCalm, Math.abs(out.y - MOVEMENT.eyeHeightStand));
    }
    expect(maxDevCalm).toBeLessThan(maxDev * 0.5);
    const rest = run(rig, input(), 120);
    expect(rest.y).toBeCloseTo(MOVEMENT.eyeHeightStand, 3);
  });

  it('zooms the FOV toward 0.78× when aiming', () => {
    const rig = new CameraRig();
    const out = run(rig, input({ ads: 1 }), 120);
    expect(out.fov).toBeCloseTo(verticalFov(90, 16 / 9) * ADS_FOV_MULT, 4);
  });

  it('splits recoil into a persistent aim offset and a recovering visual kick', () => {
    const rig = new CameraRig();
    const kick = -2 * DEG2RAD;
    rig.kick(kick, 0, 0.55, 9, 0);
    expect(rig.pitch).toBeCloseTo(kick * 0.55, 9);
    const first = run(rig, input(), 1);
    // Visual pitch includes (most of) the remaining 45 % right after the kick.
    expect(first.pitch).toBeLessThan(rig.pitch);
    const later = run(rig, input(), 120);
    expect(later.pitch).toBeCloseTo(rig.pitch, 4);
  });

  it('eases out a reconciliation offset within ~120 ms', () => {
    const rig = new CameraRig();
    run(rig, input(), 10);
    rig.addSmoothOffset(0.5, 0, 0);
    const soon = run(rig, input(), 1);
    expect(soon.x).toBeGreaterThan(0.25);
    const after = run(rig, input(), 8); // 9 frames ≈ 150 ms in total
    expect(Math.abs(after.x)).toBeLessThan(0.02);
  });

  it('dips on landing and recovers', () => {
    const rig = new CameraRig();
    run(rig, input(), 30);
    const dip = run(rig, input({ landedSpeed: 8 }), 4);
    expect(dip.y).toBeLessThan(MOVEMENT.eyeHeightStand - 0.01);
    const recovered = run(rig, input(), 120);
    expect(recovered.y).toBeCloseTo(MOVEMENT.eyeHeightStand, 2);
  });
});
