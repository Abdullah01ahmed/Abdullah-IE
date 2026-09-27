/**
 * Hitscan tracing against the world and player hitboxes.
 */
import { rayAABB, raySphere } from '../math';
import type { Stance, TraceHit, Vec3 } from '../types';
import { raycastWorld, type CollisionWorld } from './collision';
import { playerHitboxes } from './player';

export interface HitTarget {
  id: number;
  pos: Vec3;
  stance: Stance;
}

/**
 * Trace a shot. `targets` are the candidate players (already excluding the
 * shooter and, when friendly fire is off, team-mates). Returns the nearest hit.
 */
export function traceShot(
  world: CollisionWorld,
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  targets: readonly HitTarget[],
): TraceHit {
  const worldHit = raycastWorld(world, origin, dir, maxDist);
  let limit = worldHit ? worldHit.t : maxDist;
  let best: TraceHit | null = null;
  for (const tgt of targets) {
    const hb = playerHitboxes(tgt.pos, tgt.stance);
    // Head first (it can protrude above the body box).
    const th = raySphere(origin, dir, hb.head.center, hb.head.radius, limit);
    if (th !== null && th < limit) {
      limit = th;
      best = {
        kind: 'player',
        id: tgt.id,
        headshot: true,
        dist: th,
        point: { x: origin.x + dir.x * th, y: origin.y + dir.y * th, z: origin.z + dir.z * th },
      };
      continue;
    }
    const tb = rayAABB(origin, dir, hb.body, limit);
    if (tb && tb.t < limit) {
      limit = tb.t;
      best = {
        kind: 'player',
        id: tgt.id,
        headshot: false,
        dist: tb.t,
        point: { x: origin.x + dir.x * tb.t, y: origin.y + dir.y * tb.t, z: origin.z + dir.z * tb.t },
      };
    }
  }
  if (best) return best;
  if (worldHit) {
    return {
      kind: 'world',
      point: worldHit.point,
      normal: worldHit.normal,
      dist: worldHit.t,
      material: worldHit.box.material,
      blockIndex: worldHit.box.index,
    };
  }
  return { kind: 'none', end: { x: origin.x + dir.x * maxDist, y: origin.y + dir.y * maxDist, z: origin.z + dir.z * maxDist } };
}
