/**
 * Derive the loadout screen's comparison bars from WeaponDef numbers. Bars are
 * normalised against fixed reference ranges (not against each other) so a
 * future weapon roster keeps the same scale.
 */
import type { WeaponDef } from '@tra/shared';
import type { TKey } from '../../i18n';

export interface WeaponStat {
  key: TKey;
  /** 0..1 fill for the bar. */
  value: number;
  /** Short numeric label shown next to the bar. */
  display: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0.04, v));

export function weaponStats(def: WeaponDef): WeaponStat[] {
  const damage = clamp01(def.damage / 60);
  const fireRate = clamp01(def.rpm / 1100);
  const range = clamp01(def.falloffEnd / 80);
  // Handling: faster ADS and reload = higher. Reference: 0.5 s ADS, 3.5 s reload = 0.
  const handling = clamp01(1 - (0.5 * (def.adsTime / 0.5) + 0.5 * (def.reloadTime / 3.5)));
  const mobility = clamp01((def.moveSpeedMult - 0.8) / 0.3);
  return [
    { key: 'loadout.stat.damage', value: damage, display: String(def.damage) },
    { key: 'loadout.stat.fireRate', value: fireRate, display: String(def.rpm) },
    { key: 'loadout.stat.range', value: range, display: `${def.falloffEnd}m` },
    { key: 'loadout.stat.handling', value: handling, display: `${Math.round(handling * 100)}` },
    { key: 'loadout.stat.mobility', value: mobility, display: `${Math.round(def.moveSpeedMult * 100)}%` },
  ];
}
