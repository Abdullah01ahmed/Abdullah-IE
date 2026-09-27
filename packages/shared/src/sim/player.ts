/**
 * Player state construction, hitboxes and snapshot (de)serialisation helpers.
 */
import { HITBOX, MAX_HEALTH, MOVEMENT } from '../constants';
import { round3 } from '../math';
import type { AABB, PlayerSimState, PlayerSnap, Stance, Team, Vec3, WeaponState } from '../types';
import { STANCE_CODE, STANCE_FROM_CODE } from '../types';
import { WEAPONS, type WeaponId } from '../weapons';

export function createWeaponState(id: WeaponId): WeaponState {
  const def = WEAPONS[id];
  return { id, ammo: def.magSize, reserve: def.reserve, cooldown: 0, reload: 0, shotIndex: 0, triggerHeld: false };
}

export function createPlayerState(pos: Vec3, yaw: number, primary: WeaponId, secondary: WeaponId): PlayerSimState {
  return {
    pos: { x: pos.x, y: pos.y, z: pos.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    stance: 'stand',
    onGround: false,
    sprinting: false,
    slideTime: 0,
    jumpLock: false,
    airTime: 0,
    ads: 0,
    weaponIndex: 0,
    weapons: [createWeaponState(primary), createWeaponState(secondary)],
    switchTime: 0,
    switchHeld: false,
    health: MAX_HEALTH,
    alive: true,
    regenDelay: 0,
    speedMult: 1,
  };
}

export function clonePlayerState(s: PlayerSimState): PlayerSimState {
  return {
    ...s,
    pos: { ...s.pos },
    vel: { ...s.vel },
    weapons: [{ ...s.weapons[0] }, { ...s.weapons[1] }],
  };
}

/** Copy `from` into `into` without allocating new objects. */
export function assignPlayerState(into: PlayerSimState, from: PlayerSimState): PlayerSimState {
  into.pos.x = from.pos.x; into.pos.y = from.pos.y; into.pos.z = from.pos.z;
  into.vel.x = from.vel.x; into.vel.y = from.vel.y; into.vel.z = from.vel.z;
  into.yaw = from.yaw;
  into.pitch = from.pitch;
  into.stance = from.stance;
  into.onGround = from.onGround;
  into.sprinting = from.sprinting;
  into.slideTime = from.slideTime;
  into.jumpLock = from.jumpLock;
  into.airTime = from.airTime;
  into.ads = from.ads;
  into.weaponIndex = from.weaponIndex;
  Object.assign(into.weapons[0], from.weapons[0]);
  Object.assign(into.weapons[1], from.weapons[1]);
  into.switchTime = from.switchTime;
  into.switchHeld = from.switchHeld;
  into.health = from.health;
  into.alive = from.alive;
  into.regenDelay = from.regenDelay;
  into.speedMult = from.speedMult;
  return into;
}

export function capsuleHeight(stance: Stance): number {
  return stance === 'stand' ? MOVEMENT.standHeight : MOVEMENT.crouchHeight;
}

export function eyeHeight(stance: Stance): number {
  switch (stance) {
    case 'stand': return MOVEMENT.eyeHeightStand;
    case 'crouch': return MOVEMENT.eyeHeightCrouch;
    case 'slide': return MOVEMENT.eyeHeightSlide;
  }
}

/** World-space eye position for a player state. */
export function eyePosition(s: { pos: Vec3; stance: Stance }): Vec3 {
  return { x: s.pos.x, y: s.pos.y + eyeHeight(s.stance), z: s.pos.z };
}

/** Player's collision box (feet at pos.y). */
export function playerAABB(pos: Vec3, stance: Stance, out?: AABB): AABB {
  const r = MOVEMENT.capsuleRadius;
  const h = capsuleHeight(stance);
  if (out) {
    out.min.x = pos.x - r; out.min.y = pos.y; out.min.z = pos.z - r;
    out.max.x = pos.x + r; out.max.y = pos.y + h; out.max.z = pos.z + r;
    return out;
  }
  return { min: { x: pos.x - r, y: pos.y, z: pos.z - r }, max: { x: pos.x + r, y: pos.y + h, z: pos.z + r } };
}

export interface Hitboxes {
  body: AABB;
  head: { center: Vec3; radius: number };
}

/** Body box and head sphere used for hit detection. */
export function playerHitboxes(pos: Vec3, stance: Stance): Hitboxes {
  const hw = HITBOX.bodyHalfWidth;
  const eye = eyeHeight(stance);
  const headCenterY = pos.y + eye - HITBOX.headCentreBelowEye;
  const bodyTop = headCenterY - HITBOX.headRadius * 0.6;
  return {
    body: { min: { x: pos.x - hw, y: pos.y, z: pos.z - hw }, max: { x: pos.x + hw, y: bodyTop, z: pos.z + hw } },
    head: { center: { x: pos.x, y: headCenterY, z: pos.z }, radius: HITBOX.headRadius },
  };
}

export function isReloading(s: PlayerSimState): boolean {
  return s.weapons[s.weaponIndex].reload > 0;
}

export function activeWeapon(s: PlayerSimState): WeaponState {
  return s.weapons[s.weaponIndex];
}

/** Compact wire form for remote players. */
export function toPlayerSnap(id: number, team: Team, s: PlayerSimState): PlayerSnap {
  return {
    id,
    p: [round3(s.pos.x), round3(s.pos.y), round3(s.pos.z)],
    v: [round3(s.vel.x), round3(s.vel.y), round3(s.vel.z)],
    yaw: round3(s.yaw),
    pitch: round3(s.pitch),
    st: STANCE_CODE[s.stance],
    w: s.weaponIndex,
    wid: s.weapons[s.weaponIndex].id,
    hp: Math.round(s.health),
    alive: s.alive ? 1 : 0,
    ads: s.ads > 0.5 ? 1 : 0,
    spr: s.sprinting ? 1 : 0,
    rl: isReloading(s) ? 1 : 0,
    g: s.onGround ? 1 : 0,
    team,
  };
}

export function stanceFromCode(code: number): Stance {
  return STANCE_FROM_CODE[code] ?? 'stand';
}
