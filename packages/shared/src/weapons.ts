/**
 * Weapon definitions. All weapons are original designs; names reference Iraqi
 * geography (Dijla = Tigris, Shatt = Shatt al-Arab) rather than real firearms.
 */

export type WeaponClass = 'ar' | 'smg' | 'lmg' | 'shotgun' | 'dmr' | 'sniper' | 'pistol';

export type WeaponId = 'dijla7' | 'shatt9';

export interface RecoilDef {
  /** Vertical kick per shot (degrees). */
  vertical: number;
  /** Horizontal kick per shot (degrees, symmetric random). */
  horizontal: number;
  /** Fraction of vertical kick applied as a persistent aim offset the player must control (rest is visual). */
  persistent: number;
  /** Recovery speed of the visual kick (degrees/s). */
  recovery: number;
  /** Additional vertical kick multiplier when hip firing. */
  hipMult: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  nameAr: string;
  cls: WeaponClass;
  description: string;
  /** Body damage at close range. */
  damage: number;
  headshotMult: number;
  /** Distance (m) where falloff starts. */
  falloffStart: number;
  /** Distance (m) where falloff ends (minimum damage beyond). */
  falloffEnd: number;
  /** Damage multiplier at and beyond falloffEnd. */
  minDamageMult: number;
  rpm: number;
  automatic: boolean;
  magSize: number;
  reserve: number;
  /** Reload time (s) with rounds remaining (tactical). */
  reloadTime: number;
  /** Reload time (s) from empty. */
  reloadEmptyTime: number;
  /** Seconds to enter ADS. */
  adsTime: number;
  /** Hip fire spread (degrees, cone half-angle). */
  spreadHip: number;
  /** ADS spread (degrees). */
  spreadAds: number;
  /** Added spread while moving at full walk speed (degrees). */
  spreadMove: number;
  /** Added spread while airborne (degrees). */
  spreadAir: number;
  recoil: RecoilDef;
  /** Maximum hitscan range (m). */
  range: number;
  /** Movement speed multiplier while holding this weapon. */
  moveSpeedMult: number;
  /** Seconds to switch to this weapon. */
  switchTime: number;
  /** Pellets per shot (shotguns). */
  pellets: number;
  /** Time (s) for the fire sound to reach "far" attenuation — used by bots' hearing and audio. */
  loudness: number;
  /** Weapon level required to unlock (progression; 1 = default). */
  unlockLevel: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  dijla7: {
    id: 'dijla7',
    name: 'Dijla-7',
    nameAr: 'دجلة-7',
    cls: 'ar',
    description: 'A balanced 5.56 assault rifle. Controllable recoil and reliable damage at range.',
    damage: 30,
    headshotMult: 1.5,
    falloffStart: 26,
    falloffEnd: 48,
    minDamageMult: 0.72,
    rpm: 690,
    automatic: true,
    magSize: 30,
    reserve: 90,
    reloadTime: 2.05,
    reloadEmptyTime: 2.55,
    adsTime: 0.26,
    spreadHip: 2.6,
    spreadAds: 0.12,
    spreadMove: 1.1,
    spreadAir: 3.0,
    recoil: { vertical: 0.5, horizontal: 0.26, persistent: 0.55, recovery: 9, hipMult: 1.25 },
    range: 220,
    moveSpeedMult: 0.96,
    switchTime: 0.5,
    pellets: 1,
    loudness: 1.0,
    unlockLevel: 1,
  },
  shatt9: {
    id: 'shatt9',
    name: 'Shatt-9',
    nameAr: 'شط-9',
    cls: 'smg',
    description: 'A compact 9mm submachine gun. Fast handling and a high rate of fire; falls off quickly at range.',
    damage: 24,
    headshotMult: 1.4,
    falloffStart: 13,
    falloffEnd: 30,
    minDamageMult: 0.62,
    rpm: 880,
    automatic: true,
    magSize: 32,
    reserve: 96,
    reloadTime: 1.7,
    reloadEmptyTime: 2.1,
    adsTime: 0.2,
    spreadHip: 2.0,
    spreadAds: 0.28,
    spreadMove: 0.7,
    spreadAir: 2.4,
    recoil: { vertical: 0.4, horizontal: 0.42, persistent: 0.45, recovery: 11, hipMult: 1.1 },
    range: 160,
    moveSpeedMult: 1.02,
    switchTime: 0.4,
    pellets: 1,
    loudness: 0.85,
    unlockLevel: 1,
  },
};

export const WEAPON_IDS: readonly WeaponId[] = ['dijla7', 'shatt9'];

export const DEFAULT_LOADOUT: { primary: WeaponId; secondary: WeaponId } = {
  primary: 'dijla7',
  secondary: 'shatt9',
};

export function isWeaponId(v: unknown): v is WeaponId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(WEAPONS, v);
}

export function getWeapon(id: WeaponId): WeaponDef {
  return WEAPONS[id];
}

/** Seconds between shots. */
export function fireInterval(def: WeaponDef): number {
  return 60 / def.rpm;
}

/** Damage for a hit at `dist` metres. */
export function damageAtDistance(def: WeaponDef, dist: number, headshot: boolean): number {
  let mult = 1;
  if (dist > def.falloffStart) {
    const span = Math.max(0.001, def.falloffEnd - def.falloffStart);
    const t = Math.min(1, (dist - def.falloffStart) / span);
    mult = 1 + (def.minDamageMult - 1) * t;
  }
  const dmg = def.damage * mult * (headshot ? def.headshotMult : 1);
  return Math.round(dmg);
}

/** Cone half-angle (degrees) for a shot given the shooter's state. */
export function shotSpreadDeg(def: WeaponDef, ads: number, moveFraction: number, airborne: boolean, stance: 'stand' | 'crouch' | 'slide'): number {
  let s = def.spreadHip + (def.spreadAds - def.spreadHip) * ads;
  s += def.spreadMove * moveFraction * (1 - 0.6 * ads);
  if (airborne) s += def.spreadAir;
  if (stance === 'crouch') s *= 0.85;
  if (stance === 'slide') s *= 1.3;
  return s;
}
