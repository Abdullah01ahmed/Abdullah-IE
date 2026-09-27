/**
 * Snapshot buffer for remote players. Remote entities are rendered in the past
 * (serverNow - INTERP_DELAY_MS) by interpolating between the two surrounding
 * snapshots; when the buffer runs dry the last pose is extrapolated along its
 * velocity for a bounded time and then held.
 *
 * Pure data + math (no Babylon) so it is unit-testable.
 */
import { lerp, lerpAngle, stanceFromCode, type PlayerSnap, type Stance, type Team, type WeaponId } from '@tra/shared';

/** Longest extrapolation applied when snapshots stop arriving (ms). */
export const MAX_EXTRAPOLATION_MS = 100;
/** Samples older than this (relative to the newest) are dropped (ms). */
const KEEP_MS = 1000;

export interface RemotePose {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  stance: Stance;
  alive: boolean;
  ads: boolean;
  sprinting: boolean;
  reloading: boolean;
  onGround: boolean;
  weaponIndex: 0 | 1;
  weaponId: WeaponId;
  hp: number;
  team: Team;
  /** True when the pose was extrapolated past the newest snapshot. */
  extrapolated: boolean;
}

export function createRemotePose(): RemotePose {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
    stance: 'stand', alive: true, ads: false, sprinting: false, reloading: false, onGround: true,
    weaponIndex: 0, weaponId: 'dijla7', hp: 100, team: 'tigris', extrapolated: false,
  };
}

interface Sample {
  t: number;
  s: PlayerSnap;
}

export class InterpolationBuffer {
  private readonly players = new Map<number, Sample[]>();
  private newestTime = -Infinity;

  /** Record one snapshot's player list at server time `t` (ms). */
  push(t: number, players: readonly PlayerSnap[]): void {
    if (t > this.newestTime) this.newestTime = t;
    for (const s of players) {
      let arr = this.players.get(s.id);
      if (!arr) this.players.set(s.id, (arr = []));
      const last = arr[arr.length - 1];
      if (last && t <= last.t) {
        // Out-of-order or duplicate: replace only an exact duplicate time.
        if (t === last.t) arr[arr.length - 1] = { t, s };
        continue;
      }
      arr.push({ t, s });
      // Trim history.
      const cutoff = t - KEEP_MS;
      let drop = 0;
      while (drop < arr.length - 2 && arr[drop + 1].t < cutoff) drop++;
      if (drop > 0) arr.splice(0, drop);
    }
  }

  ids(): number[] {
    return [...this.players.keys()];
  }

  has(id: number): boolean {
    return this.players.has(id);
  }

  /** Newest raw snapshot for a player (null if unknown). */
  latest(id: number): PlayerSnap | null {
    const arr = this.players.get(id);
    return arr && arr.length ? arr[arr.length - 1].s : null;
  }

  /** Server time of the newest sample for a player (or -Infinity). */
  latestTime(id: number): number {
    const arr = this.players.get(id);
    return arr && arr.length ? arr[arr.length - 1].t : -Infinity;
  }

  remove(id: number): void {
    this.players.delete(id);
  }

  clear(): void {
    this.players.clear();
    this.newestTime = -Infinity;
  }

  /**
   * Compute the pose of `id` at `renderTime`. Returns false when the player has
   * no samples. Positions/angles interpolate; discrete fields switch at the
   * midpoint between samples.
   */
  sample(id: number, renderTime: number, out: RemotePose): boolean {
    const arr = this.players.get(id);
    if (!arr || arr.length === 0) return false;
    const first = arr[0];
    const last = arr[arr.length - 1];
    if (renderTime <= first.t || arr.length === 1) {
      copySnap(first.s, out);
      out.extrapolated = false;
      return true;
    }
    if (renderTime >= last.t) {
      copySnap(last.s, out);
      const dt = Math.min(renderTime - last.t, MAX_EXTRAPOLATION_MS) / 1000;
      if (dt > 0 && out.alive) {
        out.x += out.vx * dt;
        out.y += out.vy * dt;
        out.z += out.vz * dt;
        out.extrapolated = true;
      } else {
        out.extrapolated = false;
      }
      return true;
    }
    // Binary search for the bracketing pair.
    let lo = 0;
    let hi = arr.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].t <= renderTime) lo = mid;
      else hi = mid;
    }
    const a = arr[lo];
    const b = arr[hi];
    const span = b.t - a.t;
    const f = span > 0 ? (renderTime - a.t) / span : 1;
    const nearer = f < 0.5 ? a.s : b.s;
    copySnap(nearer, out);
    // A respawn teleports; do not sweep across the map between the two poses.
    if (a.s.alive !== b.s.alive) {
      out.extrapolated = false;
      return true;
    }
    out.x = lerp(a.s.p[0], b.s.p[0], f);
    out.y = lerp(a.s.p[1], b.s.p[1], f);
    out.z = lerp(a.s.p[2], b.s.p[2], f);
    out.vx = lerp(a.s.v[0], b.s.v[0], f);
    out.vy = lerp(a.s.v[1], b.s.v[1], f);
    out.vz = lerp(a.s.v[2], b.s.v[2], f);
    out.yaw = lerpAngle(a.s.yaw, b.s.yaw, f);
    out.pitch = lerp(a.s.pitch, b.s.pitch, f);
    out.extrapolated = false;
    return true;
  }
}

function copySnap(s: PlayerSnap, out: RemotePose): void {
  out.x = s.p[0];
  out.y = s.p[1];
  out.z = s.p[2];
  out.vx = s.v[0];
  out.vy = s.v[1];
  out.vz = s.v[2];
  out.yaw = s.yaw;
  out.pitch = s.pitch;
  out.stance = stanceFromCode(s.st);
  out.alive = s.alive === 1;
  out.ads = s.ads === 1;
  out.sprinting = s.spr === 1;
  out.reloading = s.rl === 1;
  out.onGround = s.g === 1;
  out.weaponIndex = s.w;
  out.weaponId = s.wid;
  out.hp = s.hp;
  out.team = s.team;
}
