/**
 * Core value types shared by the client, the server and the simulation.
 *
 * Coordinate system: metres, Y up. Yaw is the rotation around Y in radians where
 * yaw = 0 faces +Z and positive yaw turns clockwise seen from above (Babylon.js
 * convention: forward = (sin yaw, 0, cos yaw)). Pitch is in radians and positive
 * pitch looks DOWN (Babylon camera rotation.x convention).
 */
import type { WeaponId } from './weapons';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Compact wire form of a Vec3. */
export type Vec3Tuple = [number, number, number];

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export type Team = 'tigris' | 'euphrates';
export const TEAMS: readonly Team[] = ['tigris', 'euphrates'] as const;

export function otherTeam(team: Team): Team {
  return team === 'tigris' ? 'euphrates' : 'tigris';
}

export type Stance = 'stand' | 'crouch' | 'slide';
export const STANCE_CODE: Record<Stance, number> = { stand: 0, crouch: 1, slide: 2 };
export const STANCE_FROM_CODE: readonly Stance[] = ['stand', 'crouch', 'slide'];

/** Input button bit flags. */
export const BTN = {
  JUMP: 1 << 0,
  CROUCH: 1 << 1,
  SPRINT: 1 << 2,
  FIRE: 1 << 3,
  ADS: 1 << 4,
  RELOAD: 1 << 5,
  /** Switch to the other weapon slot. */
  SWITCH: 1 << 6,
  WEAPON1: 1 << 7,
  WEAPON2: 1 << 8,
  MELEE: 1 << 9,
  LETHAL: 1 << 10,
  TACTICAL: 1 << 11,
  INTERACT: 1 << 12,
} as const;

export type ButtonName = keyof typeof BTN;

/**
 * One tick of player intent. Exactly one InputCmd is applied per simulation tick
 * (TICK_DT). Clients sample input at the tick rate; the server never trusts a
 * client-supplied dt.
 */
export interface InputCmd {
  /** Monotonically increasing per connection, starting at 1. */
  seq: number;
  /** Strafe axis, -1 (left) .. 1 (right). */
  moveX: number;
  /** Forward axis, -1 (back) .. 1 (forward). */
  moveY: number;
  yaw: number;
  pitch: number;
  /** Bitmask of BTN flags. */
  buttons: number;
  /**
   * The client's estimate of the server clock (ms) at the moment the command was
   * sampled. The server uses it (bounded) for lag-compensated hit detection.
   */
  time: number;
}

export interface WeaponState {
  id: WeaponId;
  /** Rounds in the magazine. */
  ammo: number;
  /** Rounds in reserve. */
  reserve: number;
  /** Seconds until the next shot may fire. */
  cooldown: number;
  /** Seconds remaining in the current reload; 0 when not reloading. */
  reload: number;
  /** Total shots fired from this weapon by this player (seeds spread/recoil PRNG). */
  shotIndex: number;
  /** Trigger was held during the previous tick (semi-auto edge detection). */
  triggerHeld: boolean;
}

/**
 * Deterministic per-player simulation state. Client prediction and the server
 * step this exact structure with the same code.
 */
export interface PlayerSimState {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  stance: Stance;
  onGround: boolean;
  sprinting: boolean;
  /** Seconds remaining in the current slide (0 when not sliding). */
  slideTime: number;
  /** Jump button must be released before another jump is accepted. */
  jumpLock: boolean;
  /** Seconds since the player last touched the ground (coyote time / mantling). */
  airTime: number;
  /** 0 = hip fire, 1 = fully aimed down sights. */
  ads: number;
  weaponIndex: 0 | 1;
  weapons: [WeaponState, WeaponState];
  /** Seconds remaining in a weapon switch; the weapon cannot fire while > 0. */
  switchTime: number;
  /** SWITCH button was held last tick (edge detection). */
  switchHeld: boolean;
  health: number;
  alive: boolean;
  /** Seconds until passive health regeneration resumes. */
  regenDelay: number;
  /** Movement speed multiplier from perks/effects (1 = normal). */
  speedMult: number;
}

/** Wire form of a remote player's state inside a snapshot. */
export interface PlayerSnap {
  id: number;
  p: Vec3Tuple;
  v: Vec3Tuple;
  yaw: number;
  pitch: number;
  /** Stance code (see STANCE_CODE). */
  st: number;
  /** Active weapon index. */
  w: 0 | 1;
  /** Active weapon id. */
  wid: WeaponId;
  hp: number;
  alive: 0 | 1;
  ads: 0 | 1;
  spr: 0 | 1;
  /** Reloading. */
  rl: 0 | 1;
  /** On ground. */
  g: 0 | 1;
  team: Team;
}

/** Result of tracing a shot through the world and player hitboxes. */
export type TraceHit =
  | { kind: 'none'; end: Vec3 }
  | { kind: 'world'; point: Vec3; normal: Vec3; dist: number; material: string; blockIndex: number }
  | { kind: 'player'; id: number; point: Vec3; dist: number; headshot: boolean };
