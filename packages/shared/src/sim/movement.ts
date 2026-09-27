/**
 * Deterministic first-person movement. Identical code runs on the client
 * (prediction) and the server (authority).
 *
 * The player is an axis-aligned box (capsule approximation). Each tick:
 *  1. read intent (stance, sprint, jump, slide)
 *  2. accelerate on the ground / in the air
 *  3. sweep X, Z, then Y separately against the world, with step-up for stairs
 *     and mantling for low ledges
 */
import { MOVEMENT, type MovementParams } from '../constants';
import { BTN } from '../types';
import { clamp } from '../math';
import type { AABB, InputCmd, PlayerSimState, Stance } from '../types';
import { WEAPONS } from '../weapons';
import { overlapsWorld, type CollisionWorld } from './collision';
import { capsuleHeight, playerAABB } from './player';

export interface MoveResult {
  /** Landed on the ground this tick with at least this downward speed (m/s). */
  landedSpeed: number;
  /** Distance travelled on the XZ plane this tick (m). */
  moved: number;
  /** A mantle over a ledge was performed. */
  mantled: boolean;
  /** Started sliding this tick. */
  slideStarted: boolean;
  /** Jumped this tick. */
  jumped: boolean;
}

const SKIN = 0.001;
const tmpBox: AABB = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };

function fits(world: CollisionWorld, x: number, y: number, z: number, stance: Stance): boolean {
  const r = MOVEMENT.capsuleRadius;
  const h = capsuleHeight(stance);
  tmpBox.min.x = x - r + SKIN; tmpBox.min.y = y + SKIN; tmpBox.min.z = z - r + SKIN;
  tmpBox.max.x = x + r - SKIN; tmpBox.max.y = y + h - SKIN; tmpBox.max.z = z + r - SKIN;
  return !overlapsWorld(world, tmpBox);
}

/**
 * Move along one axis by `delta`, stopping at the first solid box. Returns the
 * actually applied delta. Uses a binary search on the box test — robust,
 * deterministic and cheap for the box counts of a compact map.
 */
function sweepAxis(world: CollisionWorld, pos: { x: number; y: number; z: number }, axis: 'x' | 'y' | 'z', delta: number, stance: Stance): number {
  if (delta === 0) return 0;
  const start = pos[axis];
  pos[axis] = start + delta;
  if (fits(world, pos.x, pos.y, pos.z, stance)) return delta;
  // Binary search the largest fitting fraction.
  let lo = 0;
  let hi = delta;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    pos[axis] = start + mid;
    if (fits(world, pos.x, pos.y, pos.z, stance)) lo = mid; else hi = mid;
  }
  pos[axis] = start + lo;
  return lo;
}

/** Sweep horizontally with step-up: if blocked, try stepping up to `stepHeight` first. */
function sweepHorizontal(world: CollisionWorld, s: PlayerSimState, dx: number, dz: number, stepHeight: number): { hitX: boolean; hitZ: boolean } {
  const pos = s.pos;
  let hitX = false;
  let hitZ = false;
  const tryAxis = (axis: 'x' | 'z', d: number): boolean => {
    if (d === 0) return false;
    const applied = sweepAxis(world, pos, axis, d, s.stance);
    if (Math.abs(applied - d) < 1e-6) return false;
    const remaining = d - applied;
    // Blocked: try to step up, move the remainder, then settle back down.
    if (stepHeight > 0) {
      const ox = pos.x, oy = pos.y, oz = pos.z;
      const up = sweepAxis(world, pos, 'y', stepHeight, s.stance);
      if (up > 0.001) {
        const fwd = sweepAxis(world, pos, axis, remaining, s.stance);
        if (fwd > 1e-4) {
          // Settle onto whatever is below (the step) — never below the start height.
          sweepAxis(world, pos, 'y', -up, s.stance);
          return fwd < remaining - 1e-6;
        }
      }
      pos.x = ox; pos.y = oy; pos.z = oz;
    }
    return true;
  };
  hitX = tryAxis('x', dx);
  hitZ = tryAxis('z', dz);
  return { hitX, hitZ };
}

/**
 * Step the player one tick. Mutates and returns `s`. Dead players are not moved.
 */
export function simulateStep(
  s: PlayerSimState,
  input: InputCmd,
  world: CollisionWorld,
  dt: number,
  params: Readonly<MovementParams> = MOVEMENT,
): MoveResult {
  const result: MoveResult = { landedSpeed: 0, moved: 0, mantled: false, slideStarted: false, jumped: false };
  if (!s.alive) {
    s.vel.x = s.vel.y = s.vel.z = 0;
    return result;
  }

  s.yaw = input.yaw;
  s.pitch = clamp(input.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);

  const b = input.buttons;
  const wantCrouch = (b & BTN.CROUCH) !== 0;
  const wantSprint = (b & BTN.SPRINT) !== 0;
  const wantJump = (b & BTN.JUMP) !== 0;
  const wantAds = (b & BTN.ADS) !== 0;
  const wantFire = (b & BTN.FIRE) !== 0;
  const moveX = clamp(input.moveX, -1, 1);
  const moveY = clamp(input.moveY, -1, 1);
  const moving = Math.abs(moveX) > 0.01 || Math.abs(moveY) > 0.01;

  const weapon = WEAPONS[s.weapons[s.weaponIndex].id];
  const reloading = s.weapons[s.weaponIndex].reload > 0;

  // ---- Stance & sprint -----------------------------------------------------
  const wasSliding = s.stance === 'slide';
  const horizSpeed = Math.hypot(s.vel.x, s.vel.z);

  // Sprint: forward input, on ground (or continuing in air), not ADS/firing/reloading.
  const canSprint = moveY > 0.3 && !wantAds && !wantFire && !reloading && !wasSliding;
  s.sprinting = wantSprint && canSprint && (s.onGround || s.sprinting);

  if (wasSliding) {
    s.slideTime -= dt;
    if (s.slideTime <= 0 || !s.onGround || horizSpeed < 1.2) {
      s.slideTime = 0;
      s.stance = wantCrouch ? 'crouch' : 'stand';
      // Stand up only if there is headroom.
      if (s.stance === 'stand' && !fits(world, s.pos.x, s.pos.y, s.pos.z, 'stand')) s.stance = 'crouch';
    }
  } else if (wantCrouch) {
    if (s.stance === 'stand' && s.sprinting && s.onGround && horizSpeed >= params.slideMinSpeed) {
      // Start a slide in the direction of travel.
      s.stance = 'slide';
      s.slideTime = params.slideDuration;
      const dirX = s.vel.x / horizSpeed;
      const dirZ = s.vel.z / horizSpeed;
      s.vel.x = dirX * params.slideSpeed;
      s.vel.z = dirZ * params.slideSpeed;
      s.sprinting = false;
      result.slideStarted = true;
    } else if (s.stance === 'stand') {
      s.stance = 'crouch';
    }
  } else if (s.stance === 'crouch') {
    if (fits(world, s.pos.x, s.pos.y, s.pos.z, 'stand')) s.stance = 'stand';
  }

  // ---- ADS blend -----------------------------------------------------------
  const adsTarget = wantAds && !s.sprinting && s.stance !== 'slide' && s.switchTime <= 0 ? 1 : 0;
  const adsRate = dt / Math.max(0.05, weapon.adsTime);
  s.ads = adsTarget > s.ads ? Math.min(1, s.ads + adsRate) : Math.max(0, s.ads - adsRate * 1.4);

  // ---- Desired horizontal velocity ------------------------------------------
  const sinY = Math.sin(s.yaw);
  const cosY = Math.cos(s.yaw);
  // forward = (sin, cos); right = (cos, -sin)
  let wishX = moveX * cosY + moveY * sinY;
  let wishZ = -moveX * sinY + moveY * cosY;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1) { wishX /= wishLen; wishZ /= wishLen; }

  let maxSpeed: number;
  if (s.stance === 'crouch') maxSpeed = params.crouchSpeed;
  else if (s.sprinting) maxSpeed = params.sprintSpeed;
  else maxSpeed = params.walkSpeed;
  maxSpeed *= weapon.moveSpeedMult * s.speedMult;
  maxSpeed *= 1 + (params.adsSpeedMult - 1) * s.ads;
  if (moveY < -0.01 && !s.sprinting) maxSpeed *= params.backpedalMult;
  else if (Math.abs(moveX) > 0.01 && Math.abs(moveY) < 0.01) maxSpeed *= params.strafeMult;

  const wasOnGround = s.onGround;

  if (s.stance === 'slide') {
    // Slides decay with friction and accept only slight steering.
    const sp = Math.hypot(s.vel.x, s.vel.z);
    if (sp > 0) {
      const drop = params.slideFriction * dt;
      const ns = Math.max(0, sp - drop);
      s.vel.x *= ns / sp;
      s.vel.z *= ns / sp;
    }
    s.vel.x += wishX * params.groundAccel * 0.15 * dt;
    s.vel.z += wishZ * params.groundAccel * 0.15 * dt;
  } else if (s.onGround) {
    if (wishLen > 0.01) {
      // Accelerate toward the wish velocity (no separate friction while steering,
      // so top speed is exactly maxSpeed and direction changes feel crisp).
      const targetX = wishX * maxSpeed;
      const targetZ = wishZ * maxSpeed;
      const ax = targetX - s.vel.x;
      const az = targetZ - s.vel.z;
      const al = Math.hypot(ax, az);
      const maxStep = params.groundAccel * dt;
      if (al <= maxStep) { s.vel.x = targetX; s.vel.z = targetZ; }
      else { s.vel.x += (ax / al) * maxStep; s.vel.z += (az / al) * maxStep; }
    } else {
      // Decelerate to a stop.
      const sp = Math.hypot(s.vel.x, s.vel.z);
      if (sp > 0) {
        const ns = Math.max(0, sp - params.groundFriction * dt);
        s.vel.x *= ns / sp;
        s.vel.z *= ns / sp;
      }
    }
  } else {
    // Air control: limited acceleration, capped speed.
    if (wishLen > 0.01) {
      // Air steering may redirect but never add speed beyond what the player
      // already had (or their ground max speed, whichever is larger).
      const sp0 = Math.hypot(s.vel.x, s.vel.z);
      s.vel.x += wishX * params.airAccel * dt;
      s.vel.z += wishZ * params.airAccel * dt;
      const sp = Math.hypot(s.vel.x, s.vel.z);
      const cap = Math.max(maxSpeed, Math.min(sp0, params.airSpeedCap));
      if (sp > cap) { s.vel.x *= cap / sp; s.vel.z *= cap / sp; }
    }
  }

  // ---- Jump ----------------------------------------------------------------
  if (!wantJump) s.jumpLock = false;
  const canJump = (s.onGround || s.airTime < params.coyoteTime) && s.stance !== 'slide';
  if (wantJump && !s.jumpLock && canJump) {
    s.vel.y = params.jumpVelocity;
    s.onGround = false;
    s.jumpLock = true;
    s.airTime = params.coyoteTime; // consume coyote time
    result.jumped = true;
    if (s.stance === 'crouch' && fits(world, s.pos.x, s.pos.y, s.pos.z, 'stand')) s.stance = 'stand';
  }

  // ---- Gravity -------------------------------------------------------------
  if (!s.onGround) s.vel.y -= params.gravity * dt;
  else if (s.vel.y < 0) s.vel.y = 0;

  // ---- Integrate with collision --------------------------------------------
  const startX = s.pos.x;
  const startZ = s.pos.z;
  const dx = s.vel.x * dt;
  const dz = s.vel.z * dt;
  // Step-up while on the ground, or a generous "mantle" step while airborne and
  // not rising fast (lets players pull themselves onto low ledges).
  const stepH = s.onGround ? params.stepHeight : s.vel.y <= 2.5 ? params.mantleHeight - (s.airTime > 0 ? 0 : 0) : 0;
  const beforeY = s.pos.y;
  const { hitX, hitZ } = sweepHorizontal(world, s, dx, dz, stepH);
  if (!s.onGround && s.pos.y > beforeY + 0.05) {
    // Mantled onto a ledge while airborne: kill downward velocity so we don't
    // immediately fall back through the sweep.
    result.mantled = true;
    if (s.vel.y < 0) s.vel.y = 0;
  }
  if (hitX) s.vel.x = 0;
  if (hitZ) s.vel.z = 0;

  // Vertical
  const dy = s.vel.y * dt;
  const appliedY = sweepAxis(world, s.pos, 'y', dy, s.stance);
  if (dy < 0 && appliedY > dy + 1e-6) {
    // Landed
    if (!wasOnGround) result.landedSpeed = -s.vel.y;
    s.onGround = true;
    s.vel.y = 0;
  } else if (dy > 0 && appliedY < dy - 1e-6) {
    // Head bump
    s.vel.y = 0;
  } else if (dy < 0) {
    s.onGround = false;
  } else if (dy === 0) {
    // Standing still vertically: probe for ground beneath.
    const probe = sweepAxis(world, s.pos, 'y', -0.02, s.stance);
    if (probe > -0.02 + 1e-6) {
      s.onGround = true;
    } else {
      s.onGround = false;
    }
    // undo the probe movement (we only wanted to know)
    s.pos.y -= probe;
  }
  // Ground stickiness: if we were on the ground and now hover slightly (stairs
  // down), snap down within step height.
  if (wasOnGround && !s.onGround && s.vel.y <= 0 && !result.jumped) {
    const snap = sweepAxis(world, s.pos, 'y', -params.stepHeight, s.stance);
    if (snap > -params.stepHeight + 1e-6) {
      s.onGround = true;
      s.vel.y = 0;
    } else {
      s.pos.y -= snap;
    }
  }

  if (s.onGround) s.airTime = 0; else s.airTime += dt;

  result.moved = Math.hypot(s.pos.x - startX, s.pos.z - startZ);
  if (s.stance === 'slide' && result.moved < 0.001 && s.slideTime > 0) {
    s.slideTime = 0;
    s.stance = 'crouch';
  }

  // ---- Kill Z --------------------------------------------------------------
  if (s.pos.y < world.killZ) {
    s.health = 0;
    s.alive = false;
  }

  return result;
}

/** Utility: does a player at pos/stance overlap the world? */
export function playerFits(world: CollisionWorld, pos: { x: number; y: number; z: number }, stance: Stance): boolean {
  return fits(world, pos.x, pos.y, pos.z, stance);
}

/** Utility for tests/tools: capsule AABB at a pose. */
export function playerBoxAt(pos: { x: number; y: number; z: number }, stance: Stance): AABB {
  return playerAABB(pos, stance);
}

/** Current maximum horizontal speed for the given state (for spread and animation). */
export function moveFraction(s: PlayerSimState, params: Readonly<MovementParams> = MOVEMENT): number {
  const sp = Math.hypot(s.vel.x, s.vel.z);
  return clamp(sp / params.walkSpeed, 0, 1.5);
}
