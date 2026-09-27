/**
 * Weapon handling: fire timing, reload/switch timers, deterministic spread and
 * recoil. Shared by client prediction and the server.
 */
import { BTN } from '../types';
import { DEG2RAD, aimDirection, shotRandom, v3cross, v3norm } from '../math';
import type { InputCmd, PlayerSimState, Vec3 } from '../types';
import { WEAPONS, fireInterval, shotSpreadDeg, type WeaponDef } from '../weapons';
import { moveFraction } from './movement';

export type WeaponEvent =
  | { kind: 'fire'; weaponIndex: 0 | 1; shotIndex: number }
  | { kind: 'reload_start'; weaponIndex: 0 | 1 }
  | { kind: 'reload_done'; weaponIndex: 0 | 1 }
  | { kind: 'switch_start'; weaponIndex: 0 | 1 }
  | { kind: 'switch_done'; weaponIndex: 0 | 1 }
  | { kind: 'dry_fire'; weaponIndex: 0 | 1 };

/**
 * Advance weapon timers and handle fire/reload/switch intent for one tick.
 * Mutates `s`; returns the events produced this tick.
 */
export function stepWeapons(s: PlayerSimState, input: InputCmd, dt: number): WeaponEvent[] {
  const events: WeaponEvent[] = [];
  if (!s.alive) return events;
  const b = input.buttons;
  const wantFire = (b & BTN.FIRE) !== 0;
  const wantReload = (b & BTN.RELOAD) !== 0;
  const wantSwitch = (b & BTN.SWITCH) !== 0;
  const wantW1 = (b & BTN.WEAPON1) !== 0;
  const wantW2 = (b & BTN.WEAPON2) !== 0;

  // Tick timers on both weapons (reload continues only on the active weapon).
  for (let i = 0; i < 2; i++) {
    const w = s.weapons[i];
    // Let the cooldown run slightly negative so the remainder carries into the
    // next shot; this keeps the effective rate exactly at `rpm` regardless of
    // tick quantisation.
    w.cooldown -= dt;
    if (w.cooldown < -dt) w.cooldown = -dt;
  }

  // ---- Switching -----------------------------------------------------------
  let targetIndex: 0 | 1 | null = null;
  if (wantW1 && s.weaponIndex !== 0) targetIndex = 0;
  else if (wantW2 && s.weaponIndex !== 1) targetIndex = 1;
  else if (wantSwitch && !s.switchHeld) targetIndex = s.weaponIndex === 0 ? 1 : 0;
  s.switchHeld = wantSwitch;
  if (targetIndex !== null && s.switchTime <= 0) {
    // Cancel any reload on the outgoing weapon.
    s.weapons[s.weaponIndex].reload = 0;
    s.weaponIndex = targetIndex;
    s.switchTime = WEAPONS[s.weapons[targetIndex].id].switchTime;
    s.ads = 0;
    events.push({ kind: 'switch_start', weaponIndex: targetIndex });
  }
  if (s.switchTime > 0) {
    s.switchTime = Math.max(0, s.switchTime - dt);
    if (s.switchTime === 0) events.push({ kind: 'switch_done', weaponIndex: s.weaponIndex });
    // Cannot fire/reload while switching.
    s.weapons[s.weaponIndex].triggerHeld = wantFire;
    return events;
  }

  const w = s.weapons[s.weaponIndex];
  const def = WEAPONS[w.id];

  // ---- Reload --------------------------------------------------------------
  if (w.reload > 0) {
    w.reload = Math.max(0, w.reload - dt);
    if (w.reload === 0) {
      const need = def.magSize - w.ammo;
      const take = Math.min(need, w.reserve);
      w.ammo += take;
      w.reserve -= take;
      events.push({ kind: 'reload_done', weaponIndex: s.weaponIndex });
    }
    w.triggerHeld = wantFire;
    return events;
  }
  const shouldAutoReload = w.ammo === 0 && wantFire && w.reserve > 0;
  if ((wantReload || shouldAutoReload) && w.ammo < def.magSize && w.reserve > 0) {
    w.reload = w.ammo === 0 ? def.reloadEmptyTime : def.reloadTime;
    s.sprinting = false;
    events.push({ kind: 'reload_start', weaponIndex: s.weaponIndex });
    w.triggerHeld = wantFire;
    return events;
  }

  // ---- Fire ----------------------------------------------------------------
  const triggerPulled = wantFire && (def.automatic || !w.triggerHeld);
  if (triggerPulled && w.cooldown <= 0 && !s.sprinting) {
    if (w.ammo > 0) {
      w.ammo -= 1;
      w.cooldown += fireInterval(def);
      w.shotIndex += 1;
      events.push({ kind: 'fire', weaponIndex: s.weaponIndex, shotIndex: w.shotIndex });
    } else if (!w.triggerHeld) {
      events.push({ kind: 'dry_fire', weaponIndex: s.weaponIndex });
      w.cooldown = 0.25;
    }
  }
  w.triggerHeld = wantFire;
  return events;
}

export interface ShotKinematics {
  /** Unit direction of the shot after spread. */
  dir: Vec3;
  /** Recoil kick to apply to the view this shot (radians): pitch up (negative pitch) and yaw. */
  kickPitch: number;
  kickYaw: number;
  /** Cone half-angle that was used (degrees). */
  spreadDeg: number;
}

/**
 * Deterministically derive the shot direction and recoil kick for a fired shot.
 * Both client and server compute the same result from the same seed.
 */
export function computeShot(
  s: PlayerSimState,
  def: WeaponDef,
  shotIndex: number,
  matchSeed: number,
  playerId: number,
): ShotKinematics {
  const rnd = shotRandom(matchSeed, playerId, shotIndex);
  const spreadDeg = shotSpreadDeg(def, s.ads, moveFraction(s), !s.onGround, s.stance);
  const base = aimDirection(s.yaw, s.pitch);
  // Orthonormal basis around the aim direction.
  const upRef = Math.abs(base.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const right = v3norm(v3cross(upRef, base));
  const up = v3cross(base, right);
  // Uniform disc sample inside the cone.
  const ang = rnd() * Math.PI * 2;
  const rad = Math.sqrt(rnd()) * Math.tan(spreadDeg * DEG2RAD);
  const ox = Math.cos(ang) * rad;
  const oy = Math.sin(ang) * rad;
  const dir = v3norm({
    x: base.x + right.x * ox + up.x * oy,
    y: base.y + right.y * ox + up.y * oy,
    z: base.z + right.z * ox + up.z * oy,
  });
  // Recoil: vertical kick with hip multiplier, horizontal random sign/magnitude.
  const hipMult = 1 + (def.recoil.hipMult - 1) * (1 - s.ads);
  const kickPitch = -def.recoil.vertical * hipMult * DEG2RAD * (0.85 + rnd() * 0.3);
  const kickYaw = (rnd() * 2 - 1) * def.recoil.horizontal * DEG2RAD;
  return { dir, kickPitch, kickYaw, spreadDeg };
}
