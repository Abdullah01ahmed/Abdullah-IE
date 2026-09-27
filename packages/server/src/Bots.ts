/**
 * Bot brains. A BotBrain turns what the bot can perceive into the same
 * InputCmd a human client would send; the match feeds that command through the
 * ordinary simulation pipeline, so a bot can never do anything a human cannot.
 *
 * Information discipline: the match hands the brain the poses of every other
 * participant, but the brain only ever acts on what `perceive()` admits —
 * enemies inside the profile's field of view and awareness range with a clear
 * line of sight, plus gunfire within hearing range. Everything else is kept
 * out of the brain's memory, so there are no wall-hacks by construction.
 */
import {
  BTN,
  DEG2RAD,
  MOVEMENT,
  TICK_DT,
  WEAPONS,
  angleDelta,
  anglesFromDirection,
  buildNavGrid,
  clamp,
  eyeHeight,
  eyePosition,
  findPath,
  largestComponent,
  lineOfSight,
  mulberry32,
  nearestNode,
  smoothPath,
  v3distXZ,
  wrapAngle,
  type BotProfile,
  type CollisionWorld,
  type InputCmd,
  type MapDef,
  type NavGrid,
  type NavNode,
  type PlayerSimState,
  type Stance,
  type Team,
  type Vec3,
} from '@tra/shared';

/** Pose of another participant as the match knows it (filtered by perception before use). */
export interface BotObservation {
  id: number;
  team: Team;
  pos: Vec3;
  stance: Stance;
  alive: boolean;
}

/** A shot fired this tick by some other participant. */
export interface BotSound {
  id: number;
  team: Team;
  pos: Vec3;
}

export interface BotSenses {
  timeMs: number;
  self: PlayerSimState;
  others: readonly BotObservation[];
  shots: readonly BotSound[];
}

interface Waypoint {
  pos: Vec3;
  /** The link into this waypoint requires a jump/mantle. */
  jump: boolean;
}

interface TargetMemory {
  id: number;
  pos: Vec3;
  stance: Stance;
  /** Last time the target was actually seen (ms). */
  seenAt: number;
  /** Time the target first became visible in the current sighting (ms). */
  sightingStart: number;
  visible: boolean;
}

type MoveMode = 'roam' | 'engage' | 'hunt' | 'hold' | 'investigate' | 'cover';

const THINK_INTERVAL_MS = 100;
const MEMORY_MS = 4000;
const HEARING_MEMORY_MS = 5000;
const AIM_REROLL_MS = 250;
const WAYPOINT_REACH = 0.45;
const ROAM_TIMEOUT_MS = 20_000;
const REPATH_MS = 3000;
const STUCK_CHECK_MS = 1000;
const STUCK_DISTANCE = 0.3;
const COVER_SEARCH_RADIUS = 12;
const COVER_MAX_MS = 6000;
const HOLD_MS = 2000;
const INVESTIGATE_STOP = 6;
/** Bots still fire briefly at a target that just broke line of sight. */
const FIRE_GRACE_MS = 250;
/** Maximum angular error (rad) between the aim and the target before the bot pulls the trigger. */
const FIRE_CONE = 8 * DEG2RAD;

const navCache = new Map<string, { grid: NavGrid; roam: NavNode[] }>();

/** Nav grid for a map, built once per process (bots on the same map share it). */
export function getNavGrid(map: MapDef, world: CollisionWorld): NavGrid {
  return getNav(map, world).grid;
}

function getNav(map: MapDef, world: CollisionWorld): { grid: NavGrid; roam: NavNode[] } {
  let entry = navCache.get(map.id);
  if (!entry) {
    const grid = buildNavGrid(map, world);
    const main = largestComponent(grid);
    // Roaming destinations: well-connected nodes of the main walkable component.
    const roam = grid.nodes.filter((n) => main.has(n.id) && n.links.length >= 4);
    entry = { grid, roam };
    navCache.set(map.id, entry);
  }
  return entry;
}

/** Aim point on a target: upper chest, drifting toward the neck for skilled bots. */
function aimPointOf(pos: Vec3, stance: Stance, skill: number): Vec3 {
  return { x: pos.x, y: pos.y + eyeHeight(stance) - 0.4 + 0.3 * skill, z: pos.z };
}

function chestOf(pos: Vec3, stance: Stance): Vec3 {
  return { x: pos.x, y: pos.y + eyeHeight(stance) - 0.35, z: pos.z };
}

export interface BotBrainOptions {
  id: number;
  team: Team;
  profile: BotProfile;
  seed: number;
  map: MapDef;
  world: CollisionWorld;
}

export class BotBrain {
  readonly id: number;
  readonly team: Team;
  profile: BotProfile;
  private readonly rng: () => number;
  private readonly world: CollisionWorld;
  private readonly grid: NavGrid;
  private readonly roamNodes: NavNode[];
  private readonly mapCentre: Vec3;
  private readonly mapRadius: number;
  /** 0 (easy) .. 1 (extreme), derived from the profile's reaction time. */
  private skill: number;

  // View
  private yaw = 0;
  private pitch = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;

  // Perception / engagement
  private memory = new Map<number, TargetMemory>();
  private target: TargetMemory | null = null;
  private reactionDue = Infinity;
  private engageStart = 0;
  private aimErrYaw = 0;
  private aimErrPitch = 0;
  private aimRerollAt = 0;
  private heard: { pos: Vec3; at: number } | null = null;
  private lastSighting: { pos: Vec3; at: number } | null = null;

  // Firing
  private shotsInBurst = 0;
  private burstPauseUntil = 0;
  private firing = false;

  // Movement
  private mode: MoveMode = 'roam';
  private modeSince = 0;
  private path: Waypoint[] | null = null;
  private pathIndex = 0;
  private goalNodeId = -1;
  private goalSetAt = 0;
  private repathAt = 0;
  private bannedGoal = -1;
  private radial = 0;
  private strafe = 0;
  private strafeUntil = 0;
  private crouchUntil = 0;
  private coverRollAt = 0;
  private coverEnemyPos: Vec3 | null = null;
  private holdUntil = 0;
  private huntDecided = false;

  // Stuck detection & button pulses
  /** The bot's position as of the current think (planning reads it before act() runs). */
  private selfPos: Vec3 = { x: 0, y: 0, z: 0 };
  private stuckCheckAt = 0;
  private stuckCheckPos: Vec3 = { x: 0, y: 0, z: 0 };
  private stuckCount = 0;
  private jumpPulseTicks = 0;
  private jumpReleaseTicks = 0;
  private switchPulse = false;
  private nextThinkAt = 0;
  private wantMove = false;

  constructor(opts: BotBrainOptions) {
    this.id = opts.id;
    this.team = opts.team;
    this.profile = opts.profile;
    this.skill = skillOf(opts.profile);
    this.rng = mulberry32(opts.seed);
    this.world = opts.world;
    const nav = getNav(opts.map, opts.world);
    this.grid = nav.grid;
    this.roamNodes = nav.roam;
    const b = opts.map.bounds;
    this.mapCentre = { x: (b.min.x + b.max.x) / 2, y: 0, z: (b.min.z + b.max.z) / 2 };
    this.mapRadius = Math.max(1, Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) / 2);
  }

  setProfile(profile: BotProfile): void {
    this.profile = profile;
    this.skill = skillOf(profile);
  }

  /** Called when the bot's body (re)spawns: forget the previous life. */
  onSpawn(state: PlayerSimState): void {
    this.yaw = state.yaw;
    this.pitch = 0;
    this.recoilPitch = this.recoilYaw = 0;
    this.memory.clear();
    this.target = null;
    this.reactionDue = Infinity;
    this.heard = null;
    this.shotsInBurst = 0;
    this.burstPauseUntil = 0;
    this.firing = false;
    this.mode = 'roam';
    this.path = null;
    this.goalNodeId = -1;
    this.goalSetAt = 0;
    this.repathAt = 0;
    this.radial = this.strafe = 0;
    this.crouchUntil = 0;
    this.coverEnemyPos = null;
    this.stuckCount = 0;
    this.stuckCheckAt = 0;
    this.jumpPulseTicks = this.jumpReleaseTicks = 0;
    this.switchPulse = false;
    this.nextThinkAt = 0;
  }

  /**
   * The bot's own shot was resolved by the match: apply the view kick the way a
   * client would, minus the part the bot "controls" (recoilControl).
   */
  onOwnShot(kickPitch: number, kickYaw: number, persistent: number): void {
    const uncontrolled = 1 - this.profile.recoilControl;
    this.recoilPitch += kickPitch * persistent * uncontrolled;
    this.recoilYaw += kickYaw * persistent * uncontrolled;
    this.shotsInBurst++;
  }

  /** Produce this tick's input. Dead bots hold still. */
  think(senses: BotSenses, seq: number): InputCmd {
    const self = senses.self;
    if (!self.alive) {
      return { seq, moveX: 0, moveY: 0, yaw: this.yaw, pitch: this.pitch, buttons: 0, time: senses.timeMs };
    }
    const now = senses.timeMs;
    this.selfPos.x = self.pos.x; this.selfPos.y = self.pos.y; this.selfPos.z = self.pos.z;
    if (now >= this.nextThinkAt) {
      this.nextThinkAt = now + THINK_INTERVAL_MS;
      this.perceive(senses);
      this.decide(senses);
    }
    return this.act(senses, seq);
  }

  // ---------------------------------------------------------------------------
  // Perception
  // ---------------------------------------------------------------------------

  private perceive(senses: BotSenses): void {
    const { self, others, shots, timeMs: now } = senses;
    const p = this.profile;
    const eye = eyePosition(self);
    const fx = Math.sin(self.yaw);
    const fz = Math.cos(self.yaw);
    const cosHalfFov = Math.cos((p.fovDeg / 2) * DEG2RAD);

    for (const m of this.memory.values()) m.visible = false;

    for (const o of others) {
      if (!o.alive || o.team === this.team) continue;
      const chest = chestOf(o.pos, o.stance);
      const dx = chest.x - eye.x;
      const dz = chest.z - eye.z;
      const dist = Math.hypot(dx, chest.y - eye.y, dz);
      if (dist > p.awarenessRange) continue;
      const horiz = Math.hypot(dx, dz);
      // Enemies at arm's length are noticed regardless of facing (footsteps, peripheral vision).
      const inFov = horiz < 2.5 || (horiz > 1e-6 && (dx * fx + dz * fz) / horiz >= cosHalfFov);
      if (!inFov) continue;
      const visible = lineOfSight(this.world, eye, chest) || lineOfSight(this.world, eye, { x: o.pos.x, y: o.pos.y + eyeHeight(o.stance), z: o.pos.z });
      if (!visible) continue;
      let mem = this.memory.get(o.id);
      if (!mem) {
        mem = { id: o.id, pos: { ...o.pos }, stance: o.stance, seenAt: now, sightingStart: now, visible: true };
        this.memory.set(o.id, mem);
      } else {
        // A fresh sighting after the memory went stale restarts the reaction clock.
        if (now - mem.seenAt > MEMORY_MS / 4) mem.sightingStart = now;
        mem.pos.x = o.pos.x; mem.pos.y = o.pos.y; mem.pos.z = o.pos.z;
        mem.stance = o.stance;
        mem.seenAt = now;
        mem.visible = true;
      }
      this.lastSighting = { pos: { ...o.pos }, at: now };
    }

    // Forget targets not seen for a while.
    for (const [id, m] of this.memory) if (now - m.seenAt > MEMORY_MS) this.memory.delete(id);

    // Hearing: enemy gunfire within range becomes something to investigate.
    for (const s of shots) {
      if (s.team === this.team) continue;
      if (v3distXZ(s.pos, self.pos) > p.hearingRange) continue;
      if (!this.heard || now - this.heard.at > 500) this.heard = { pos: { ...s.pos }, at: now };
    }

    // Target selection: visible first, then most recently seen, then nearest.
    let best: TargetMemory | null = null;
    let bestScore = -Infinity;
    for (const m of this.memory.values()) {
      const score = (m.visible ? 1000 : 0) - (now - m.seenAt) * 0.01 - v3distXZ(m.pos, self.pos);
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (best !== this.target) {
      this.target = best;
      if (best) {
        this.reactionDue = best.sightingStart + (p.reactionTime + this.rng() * p.reactionJitter) * 1000;
        this.engageStart = this.reactionDue;
        this.aimRerollAt = 0;
        this.huntDecided = false;
      } else {
        this.reactionDue = Infinity;
      }
    } else if (best && best.visible && best.sightingStart > this.engageStart) {
      // Same enemy re-acquired after being lost: react again.
      this.reactionDue = best.sightingStart + (p.reactionTime + this.rng() * p.reactionJitter) * 1000;
      this.engageStart = this.reactionDue;
      this.aimRerollAt = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Decisions (10 Hz)
  // ---------------------------------------------------------------------------

  private decide(senses: BotSenses): void {
    const { self, timeMs: now } = senses;
    const p = this.profile;
    const target = this.target;
    const visible = !!target && target.visible;

    // Cover: hurt and the profile says so → break line of sight and wait for regen.
    if (self.health < 50 && target && this.mode !== 'cover' && now >= this.coverRollAt) {
      this.coverRollAt = now + 1000;
      if (this.rng() < p.coverUse) {
        const node = this.findCoverNode(self, target.pos, target.stance);
        if (node) {
          this.setMode('cover', now);
          this.coverEnemyPos = { ...target.pos };
          this.setGoal(node, now, false);
          if (this.skill >= 0.6) this.crouchUntil = Infinity;
          return;
        }
      }
    }

    if (this.mode === 'cover') {
      const arrived = !this.path;
      const done = self.health >= 90 || now - this.modeSince > COVER_MAX_MS;
      const threatened = visible && v3distXZ(target.pos, self.pos) < 6;
      if (done || threatened) {
        this.crouchUntil = 0;
        this.coverEnemyPos = null;
        this.setMode(visible ? 'engage' : 'roam', now);
      } else {
        if (arrived && this.skill >= 0.6) this.crouchUntil = Infinity;
        return;
      }
    }

    if (visible) {
      if (this.mode !== 'engage') {
        this.setMode('engage', now);
        this.path = null;
        // Skilled bots sometimes take a knee when trading at range.
        if (this.skill >= 0.6 && v3distXZ(target.pos, self.pos) > 12 && this.rng() < 0.3) this.crouchUntil = now + 1000 + this.rng() * 1000;
      }
      this.decideEngageMovement(self, target, now);
      return;
    }

    if (target) {
      // Target remembered but out of sight: push to the last known position or hold.
      if (!this.huntDecided) {
        this.huntDecided = true;
        if (this.rng() < 0.4 + 0.6 * p.aggression) {
          this.setMode('hunt', now);
          const node = nearestNode(this.grid, target.pos, 4);
          if (node) this.setGoal(node, now, false);
        } else {
          this.setMode('hold', now);
          this.holdUntil = now + HOLD_MS;
          this.path = null;
        }
      } else if (this.mode === 'hunt' && !this.path) {
        // Arrived where the enemy was last seen and found nothing.
        this.memory.delete(target.id);
        this.target = null;
        this.setMode('roam', now);
      } else if (this.mode === 'hold' && now > this.holdUntil) {
        this.setMode('roam', now);
      }
      return;
    }

    if (this.heard && now - this.heard.at < HEARING_MEMORY_MS && this.mode !== 'investigate') {
      const node = nearestNode(this.grid, this.heard.pos, 4);
      if (node && v3distXZ(this.heard.pos, self.pos) > INVESTIGATE_STOP) {
        this.setMode('investigate', now);
        this.setGoal(node, now, false);
        return;
      }
      this.heard = null;
    }
    if (this.mode === 'investigate') {
      if (!this.path || !this.heard || now - this.heard.at > HEARING_MEMORY_MS) {
        this.heard = null;
        this.setMode('roam', now);
      } else {
        return;
      }
    }

    if (this.mode !== 'roam') this.setMode('roam', now);
    if (!this.path || now - this.goalSetAt > ROAM_TIMEOUT_MS) this.pickRoamGoal(self, now);
  }

  private setMode(mode: MoveMode, now: number): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.modeSince = now;
    this.radial = 0;
    this.strafe = 0;
    if (mode !== 'cover' && this.crouchUntil === Infinity) this.crouchUntil = 0;
  }

  private decideEngageMovement(self: PlayerSimState, target: TargetMemory, now: number): void {
    const p = this.profile;
    const dist = v3distXZ(target.pos, self.pos);
    if (dist > p.preferredRange * 1.3) this.radial = 1;
    else if (dist < p.preferredRange * 0.6 && this.rng() < 1 - p.aggression) this.radial = -1;
    else if (dist > p.preferredRange * 0.6 && dist < p.preferredRange * 1.3) this.radial = 0;
    // Strafing: more frequent and wider at higher difficulty.
    if (now >= this.strafeUntil) {
      const chance = 0.25 + 0.75 * this.skill;
      if (this.rng() < chance) {
        const amp = 0.4 + 0.6 * this.skill;
        this.strafe = (this.rng() < 0.5 ? -1 : 1) * amp;
      } else {
        this.strafe = 0;
      }
      this.strafeUntil = now + 400 + this.rng() * 600;
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  private pickRoamGoal(self: PlayerSimState, now: number): void {
    const p = this.profile;
    if (this.roamNodes.length === 0) return;
    let best: NavNode | null = null;
    let bestScore = -Infinity;
    const sighting = this.lastSighting && now - this.lastSighting.at < 15_000 ? this.lastSighting.pos : null;
    for (let i = 0; i < 16; i++) {
      const n = this.roamNodes[Math.floor(this.rng() * this.roamNodes.length)];
      if (n.id === this.bannedGoal) continue;
      const fromSelf = v3distXZ(n.pos, self.pos);
      if (fromSelf < 6) continue;
      let score = -(v3distXZ(n.pos, this.mapCentre) / this.mapRadius) * (0.6 + 0.4 * p.aggression);
      if (sighting) score -= (v3distXZ(n.pos, sighting) / this.mapRadius) * p.aggression;
      score += this.rng() * 0.3;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    if (best) this.setGoal(best, now, this.rng() < p.flanking);
  }

  /** Path to `goal`; with `flank` the direct corridor is penalised so the route swings wide. */
  private setGoal(goal: NavNode, now: number, flank: boolean): void {
    this.goalNodeId = goal.id;
    this.goalSetAt = now;
    this.repathAt = now + REPATH_MS;
    this.path = this.buildPath(goal, flank);
    this.pathIndex = 0;
  }

  private buildPath(goal: NavNode, flank: boolean): Waypoint[] | null {
    const start = nearestNode(this.grid, this.selfPos, 4);
    if (!start) return null;
    let avoid: ((n: NavNode) => number) | undefined;
    if (flank) {
      const ax = start.pos.x, az = start.pos.z;
      const bx = goal.pos.x - ax, bz = goal.pos.z - az;
      const len2 = bx * bx + bz * bz;
      const corridor = Math.max(3, Math.sqrt(len2) * 0.25);
      avoid = (n) => {
        if (len2 < 1e-6) return 0;
        const t = clamp(((n.pos.x - ax) * bx + (n.pos.z - az) * bz) / len2, 0, 1);
        const px = ax + bx * t - n.pos.x;
        const pz = az + bz * t - n.pos.z;
        // Only the middle of the corridor is penalised, so the ends stay reachable.
        return t > 0.15 && t < 0.85 && Math.hypot(px, pz) < corridor ? 8 : 0;
      };
    }
    const raw = findPath(this.grid, start.id, goal.id, avoid);
    if (!raw) return null;
    const jumpInto = new Set<number>();
    for (let i = 1; i < raw.length; i++) {
      const link = raw[i - 1].links.find((l) => l.to === raw[i].id);
      if (link?.jump) jumpInto.add(raw[i].id);
    }
    const smooth = smoothPath(this.grid, raw, this.world);
    const wps = smooth.map((n) => ({ pos: n.pos, jump: jumpInto.has(n.id) }));
    // The first node is where we already stand.
    return wps.length > 1 ? wps.slice(1) : wps;
  }

  private findCoverNode(self: PlayerSimState, enemyPos: Vec3, enemyStance: Stance): NavNode | null {
    const enemyEye = { x: enemyPos.x, y: enemyPos.y + eyeHeight(enemyStance), z: enemyPos.z };
    const g = this.grid;
    const r = Math.ceil(COVER_SEARCH_RADIUS / g.cell);
    const cx = Math.floor((self.pos.x - g.origin.x) / g.cell);
    const cz = Math.floor((self.pos.z - g.origin.z) / g.cell);
    let best: NavNode | null = null;
    let bestDist = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0 || x >= g.cols || z >= g.rows) continue;
        const ids = g.column.get(z * g.cols + x);
        if (!ids) continue;
        for (const id of ids) {
          const n = g.nodes[id];
          if (Math.abs(n.pos.y - self.pos.y) > 2.5) continue;
          const d = v3distXZ(n.pos, self.pos);
          if (d >= bestDist || d < 1) continue;
          if (v3distXZ(n.pos, enemyPos) < 3) continue;
          const eye = { x: n.pos.x, y: n.pos.y + MOVEMENT.eyeHeightStand, z: n.pos.z };
          if (lineOfSight(this.world, enemyEye, eye)) continue;
          best = n;
          bestDist = d;
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Per-tick actuation
  // ---------------------------------------------------------------------------

  private act(senses: BotSenses, seq: number): InputCmd {
    const { self, timeMs: now } = senses;
    const p = this.profile;
    const dt = TICK_DT;
    const target = this.target;
    const engaging = !!target && now >= this.reactionDue && (target.visible || now - target.seenAt < FIRE_GRACE_MS);
    let buttons = 0;
    let moveX = 0;
    let moveY = 0;

    // ---- Movement direction (world space) ----------------------------------
    let dirX = 0;
    let dirZ = 0;
    if (this.mode === 'engage' && target) {
      const tx = target.pos.x - self.pos.x;
      const tz = target.pos.z - self.pos.z;
      const len = Math.hypot(tx, tz);
      if (len > 1e-3) {
        const ux = tx / len, uz = tz / len;
        dirX = ux * this.radial + uz * this.strafe;
        dirZ = uz * this.radial - ux * this.strafe;
      }
    } else if (this.path) {
      this.followPath(self, now);
      const wp = this.path?.[this.pathIndex];
      if (wp) {
        const dx = wp.pos.x - self.pos.x;
        const dz = wp.pos.z - self.pos.z;
        const len = Math.hypot(dx, dz);
        if (len > 1e-3) { dirX = dx / len; dirZ = dz / len; }
        if (wp.jump && len < 1.2 && self.onGround && this.jumpPulseTicks === 0 && this.jumpReleaseTicks === 0) this.jumpPulseTicks = 2;
      }
    }
    const moving = Math.hypot(dirX, dirZ) > 0.05;
    this.wantMove = moving;

    // ---- Stuck detection ------------------------------------------------------
    if (now - this.stuckCheckAt >= STUCK_CHECK_MS) {
      if (this.stuckCheckAt > 0 && this.wantMove && v3distXZ(self.pos, this.stuckCheckPos) < STUCK_DISTANCE) {
        this.stuckCount++;
        if (this.jumpPulseTicks === 0) this.jumpPulseTicks = 2;
        if (this.stuckCount >= 2) {
          this.bannedGoal = this.goalNodeId;
          this.path = null;
          this.stuckCount = 0;
          if (this.mode !== 'engage') this.setMode('roam', now);
        }
      } else {
        this.stuckCount = 0;
      }
      this.stuckCheckAt = now;
    }
    this.stuckCheckPos.x = self.pos.x; this.stuckCheckPos.y = self.pos.y; this.stuckCheckPos.z = self.pos.z;

    // ---- Aim --------------------------------------------------------------------
    let desiredYaw: number;
    let desiredPitch = 0;
    if (target && (engaging || now < this.reactionDue || this.mode === 'hold' || this.mode === 'hunt')) {
      // Track the (last known) target. Aim error settles over aimSettleTime and is re-rolled periodically.
      if (now >= this.aimRerollAt) {
        this.aimRerollAt = now + AIM_REROLL_MS;
        const age = clamp((now - this.engageStart) / (p.aimSettleTime * 1000), 0, 1);
        const err = engaging ? p.aimErrorDeg + (p.aimErrorSettledDeg - p.aimErrorDeg) * age : p.aimErrorDeg;
        const ang = this.rng() * Math.PI * 2;
        const mag = Math.sqrt(this.rng()) * err * DEG2RAD;
        this.aimErrYaw = Math.cos(ang) * mag;
        this.aimErrPitch = Math.sin(ang) * mag;
      }
      const eye = eyePosition(self);
      const ap = aimPointOf(target.pos, target.stance, this.skill);
      const a = anglesFromDirection({ x: ap.x - eye.x, y: ap.y - eye.y, z: ap.z - eye.z });
      desiredYaw = a.yaw + this.aimErrYaw;
      desiredPitch = a.pitch + this.aimErrPitch;
    } else if (this.mode === 'cover' && this.coverEnemyPos && !moving) {
      const eye = eyePosition(self);
      desiredYaw = anglesFromDirection({ x: this.coverEnemyPos.x - eye.x, y: 0, z: this.coverEnemyPos.z - eye.z }).yaw;
    } else if (moving) {
      desiredYaw = Math.atan2(dirX, dirZ);
    } else {
      // Idle: slow scan so a waiting bot still notices movement around it.
      desiredYaw = this.yaw + Math.sin(now * 0.0008) * 0.02;
    }
    // Recoil pushes the view; the uncontrolled part recovers at the weapon's rate.
    const wdef = WEAPONS[self.weapons[self.weaponIndex].id];
    const recover = wdef.recoil.recovery * DEG2RAD * dt;
    this.recoilPitch = approach(this.recoilPitch, 0, recover);
    this.recoilYaw = approach(this.recoilYaw, 0, recover);
    const maxTurn = p.turnSpeedDeg * DEG2RAD * dt;
    this.yaw = wrapAngle(this.yaw + clamp(angleDelta(this.yaw, desiredYaw + this.recoilYaw), -maxTurn, maxTurn));
    this.pitch = clamp(this.pitch + clamp(desiredPitch + this.recoilPitch - this.pitch, -maxTurn, maxTurn), -1.4, 1.4);

    // ---- Weapons ------------------------------------------------------------------
    const w = self.weapons[self.weaponIndex];
    const other = self.weapons[1 - self.weaponIndex];
    const outOfAmmo = w.ammo === 0 && w.reserve === 0;
    if (outOfAmmo && other.ammo + other.reserve > 0 && self.switchTime <= 0) {
      if (!this.switchPulse) { buttons |= BTN.SWITCH; this.switchPulse = true; }
    } else {
      this.switchPulse = false;
    }
    const visibleNow = !!target && target.visible;
    const wantReload = w.reserve > 0 && w.reload === 0 && (w.ammo === 0 || (!visibleNow && w.ammo < wdef.magSize * 0.25));
    if (wantReload) buttons |= BTN.RELOAD;

    let fire = false;
    if (engaging && target && !wantReload && w.ammo > 0 && self.switchTime <= 0) {
      const eye = eyePosition(self);
      const ap = aimPointOf(target.pos, target.stance, this.skill);
      const a = anglesFromDirection({ x: ap.x - eye.x, y: ap.y - eye.y, z: ap.z - eye.z });
      const off = Math.hypot(angleDelta(this.yaw, a.yaw), a.pitch - this.pitch);
      if (off < FIRE_CONE) {
        if (now < this.burstPauseUntil) {
          fire = false;
        } else if (this.shotsInBurst >= p.burstLength) {
          this.burstPauseUntil = now + p.burstPause * 1000;
          this.shotsInBurst = 0;
        } else {
          fire = true;
        }
      }
      if (p.usesAds && v3distXZ(target.pos, self.pos) > 8) buttons |= BTN.ADS;
    }
    if (!fire && this.firing) this.shotsInBurst = 0;
    this.firing = fire;
    if (fire) buttons |= BTN.FIRE;

    // ---- Movement relative to the (possibly turning) view ----------------------------
    if (moving) {
      const sinY = Math.sin(this.yaw);
      const cosY = Math.cos(this.yaw);
      moveY = clamp(dirX * sinY + dirZ * cosY, -1, 1);
      moveX = clamp(dirX * cosY - dirZ * sinY, -1, 1);
      if (this.mode !== 'engage' && p.sprints && !engaging && !wantReload && moveY > 0.5) buttons |= BTN.SPRINT;
    }
    if (now < this.crouchUntil && (this.mode !== 'engage' || !moving)) buttons |= BTN.CROUCH;

    // ---- Button pulses -------------------------------------------------------------------
    if (this.jumpPulseTicks > 0) {
      buttons |= BTN.JUMP;
      this.jumpPulseTicks--;
      if (this.jumpPulseTicks === 0) this.jumpReleaseTicks = 6;
    } else if (this.jumpReleaseTicks > 0) {
      this.jumpReleaseTicks--;
    }

    return { seq, moveX, moveY, yaw: this.yaw, pitch: this.pitch, buttons, time: now };
  }

  private followPath(self: PlayerSimState, now: number): void {
    if (!this.path) return;
    while (this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex];
      const d = v3distXZ(wp.pos, self.pos);
      if (d < WAYPOINT_REACH && Math.abs(wp.pos.y - self.pos.y) < 1.2) this.pathIndex++;
      else break;
    }
    if (this.pathIndex >= this.path.length) {
      this.path = null;
      return;
    }
    if (now >= this.repathAt && this.goalNodeId >= 0) {
      // Periodic re-plan keeps the route valid after pushes, falls and detours.
      this.repathAt = now + REPATH_MS;
      const goal = this.grid.nodes[this.goalNodeId];
      const fresh = this.buildPath(goal, false);
      if (fresh) { this.path = fresh; this.pathIndex = 0; }
    }
  }
}

function approach(v: number, to: number, step: number): number {
  if (v < to) return Math.min(to, v + step);
  if (v > to) return Math.max(to, v - step);
  return v;
}

/** Normalised skill 0..1 from the profile (easy → 0, extreme → 1). */
function skillOf(p: BotProfile): number {
  return clamp((0.75 - p.reactionTime) / (0.75 - 0.17), 0, 1);
}
