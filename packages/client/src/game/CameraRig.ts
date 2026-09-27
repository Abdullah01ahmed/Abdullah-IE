/**
 * First-person camera kinematics: view angles from mouse look and recoil, eye
 * height easing between stances, head bob, landing dip, camera shake,
 * reconciliation smoothing and FOV handling (horizontal FOV setting → Babylon's
 * vertical FOV, ADS zoom). Pure math, driven once per frame.
 */
import { DEG2RAD, MOVEMENT, clamp, damp, eyeHeight, type Stance } from '@tra/shared';

/** Mouse sensitivity is expressed in the classic "0.022° per count" convention. */
export const DEGREES_PER_COUNT = 0.022;
export const MAX_PITCH = 89 * DEG2RAD;
/** FOV multiplier when fully aimed down sights. */
export const ADS_FOV_MULT = 0.78;

export interface RigInput {
  dt: number;
  /** Predicted feet position. */
  x: number;
  y: number;
  z: number;
  stance: Stance;
  /** Horizontal speed (m/s). */
  speed: number;
  /** Lateral (strafe) speed relative to the view, +right (m/s). */
  lateralSpeed: number;
  onGround: boolean;
  /** 0 = hip, 1 = fully aimed. */
  ads: number;
  sprinting: boolean;
  /** Downward speed at the moment of landing this frame (0 if none). */
  landedSpeed: number;
  reduceShake: boolean;
  /** Horizontal field of view (degrees). */
  hfovDeg: number;
  aspect: number;
}

export interface RigOutput {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** Vertical FOV in radians. */
  fov: number;
}

export function verticalFov(hfovDeg: number, aspect: number): number {
  const h = hfovDeg * DEG2RAD;
  return 2 * Math.atan(Math.tan(h / 2) / Math.max(0.1, aspect));
}

export class CameraRig {
  /** Authoritative view yaw (radians): mouse look + persistent recoil. */
  yaw = 0;
  /** Authoritative view pitch (radians, positive = down). */
  pitch = 0;

  private eye = MOVEMENT.eyeHeightStand;
  private bobPhase = 0;
  private bobAmp = 0;
  private dip = 0;
  private dipVel = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private recoilRecovery = 10 * DEG2RAD;
  private shake = 0;
  private shakeT = 0;
  private offX = 0;
  private offY = 0;
  private offZ = 0;
  private roll = 0;
  /** Smoothed ADS blend used for FOV/bob so a cancelled ADS still eases back. */
  private adsBlend = 0;

  setAngles(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -MAX_PITCH, MAX_PITCH);
  }

  /** Apply mouse motion in counts. */
  addLook(dx: number, dy: number, sensitivity: number, adsMult: number, invertY: boolean): void {
    const k = sensitivity * DEGREES_PER_COUNT * DEG2RAD * adsMult;
    this.yaw += dx * k;
    this.pitch += (invertY ? -dy : dy) * k;
    // Keep yaw bounded so float precision does not degrade over long matches.
    if (this.yaw > Math.PI * 2 || this.yaw < -Math.PI * 2) this.yaw %= Math.PI * 2;
    this.pitch = clamp(this.pitch, -MAX_PITCH, MAX_PITCH);
  }

  /**
   * Recoil kick (radians, from computeShot). `persistent` of the vertical kick
   * moves the real aim; the rest is a visual kick that recovers at
   * `recoveryDegPerSec`. `shakeAmp` adds a short camera shake.
   */
  kick(kickPitch: number, kickYaw: number, persistent: number, recoveryDegPerSec: number, shakeAmp: number): void {
    this.pitch = clamp(this.pitch + kickPitch * persistent, -MAX_PITCH, MAX_PITCH);
    this.yaw += kickYaw * persistent;
    this.recoilPitch += kickPitch * (1 - persistent);
    this.recoilYaw += kickYaw * (1 - persistent);
    this.recoilRecovery = recoveryDegPerSec * DEG2RAD;
    this.shake = Math.min(1, this.shake + shakeAmp);
  }

  /** Add a visual offset that eases out (reconciliation correction). */
  addSmoothOffset(dx: number, dy: number, dz: number): void {
    this.offX += dx;
    this.offY += dy;
    this.offZ += dz;
  }

  /** Drop transient state (respawn). */
  resetMotion(): void {
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.dip = 0;
    this.dipVel = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shake = 0;
    this.offX = this.offY = this.offZ = 0;
    this.roll = 0;
  }

  update(input: RigInput, out: RigOutput): RigOutput {
    const dt = Math.min(0.1, Math.max(0, input.dt));
    const shakeScale = input.reduceShake ? 0.3 : 1;

    // Eye height eases between stances over crouchTransition.
    const targetEye = eyeHeight(input.stance);
    const rate = (MOVEMENT.eyeHeightStand - MOVEMENT.eyeHeightCrouch) / MOVEMENT.crouchTransition;
    const de = targetEye - this.eye;
    this.eye += clamp(de, -rate * dt, rate * dt);

    // ADS blend.
    this.adsBlend = damp(this.adsBlend, input.ads, 18, dt);

    // Head bob driven by ground speed.
    const walking = input.onGround ? clamp(input.speed / MOVEMENT.walkSpeed, 0, 1.5) : 0;
    const targetAmp = walking * (input.sprinting ? 0.03 : 0.018) * (1 - this.adsBlend * 0.8) * shakeScale;
    this.bobAmp = damp(this.bobAmp, targetAmp, 10, dt);
    if (walking > 0.05) this.bobPhase += dt * (input.sprinting ? 11 : 8.5) * clamp(walking, 0.5, 1.5);
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmp;
    const bobX = Math.sin(this.bobPhase) * this.bobAmp * 0.6;

    // Landing dip: a damped spring on the eye height.
    if (input.landedSpeed > 2.5) this.dipVel -= Math.min(0.9, input.landedSpeed * 0.07) * shakeScale;
    this.dipVel += (-this.dip * 260 - this.dipVel * 20) * dt;
    this.dip += this.dipVel * dt;

    // Visual recoil recovers at a constant angular rate (plus a soft tail).
    const rec = this.recoilRecovery * dt;
    this.recoilPitch = approach(this.recoilPitch, 0, rec) * Math.exp(-dt * 4);
    this.recoilYaw = approach(this.recoilYaw, 0, rec) * Math.exp(-dt * 4);

    // Camera shake decays quickly.
    this.shake *= Math.exp(-dt * 14);
    this.shakeT += dt;
    const sp = this.shake * 0.012 * shakeScale;
    const shakePitch = Math.sin(this.shakeT * 61) * sp;
    const shakeYaw = Math.cos(this.shakeT * 47) * sp;

    // Reconciliation offset eases out over ~120 ms.
    const k = Math.exp(-dt * 25);
    this.offX *= k;
    this.offY *= k;
    this.offZ *= k;

    // Strafe lean.
    const targetRoll = -clamp(input.lateralSpeed / MOVEMENT.sprintSpeed, -1, 1) * 0.02 * shakeScale;
    this.roll = damp(this.roll, targetRoll, 8, dt);

    const yaw = this.yaw + this.recoilYaw + shakeYaw;
    const pitch = clamp(this.pitch + this.recoilPitch + shakePitch, -MAX_PITCH, MAX_PITCH);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    out.x = input.x + this.offX + rightX * bobX;
    out.y = input.y + this.offY + this.eye + bobY + this.dip;
    out.z = input.z + this.offZ + rightZ * bobX;
    out.yaw = yaw;
    out.pitch = pitch;
    out.roll = this.roll;
    out.fov = verticalFov(input.hfovDeg, input.aspect) * (1 + (ADS_FOV_MULT - 1) * this.adsBlend);
    return out;
  }
}

function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}
