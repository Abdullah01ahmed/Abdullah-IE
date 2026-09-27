/**
 * Remote players: snapshot buffering + interpolation (100 ms in the past),
 * procedural characters with locomotion / stance / aim / death animation,
 * simplified weapon models in hand, team-mate name tags and footstep audio.
 */
import { Color3, Mesh, MeshBuilder, StandardMaterial, Vector3, type Scene } from '@babylonjs/core';
import {
  INTERP_DELAY_MS,
  MOVEMENT,
  eyeHeight,
  floorHeightAt,
  type CollisionWorld,
  type GameEvent,
  type HitTarget,
  type RoomState,
  type Snapshot,
  type Team,
  type Vec3,
  type WeaponId,
} from '@tra/shared';
import type { GameAudio } from './Audio';
import { CharacterMaterials, HIPS_REST_Y, buildCharacter, resetPose, type CharacterRig } from './Characters';
import type { Environment } from './Environment';
import { InterpolationBuffer, createRemotePose, type RemotePose } from './Interpolation';
import { createTextTexture } from './TextTexture';
import { WeaponMaterials, buildWeaponModel, type WeaponModel } from './WeaponModels';

/** Rendering group for name tags (depth cleared → visible through walls). */
const TAG_RENDER_GROUP = 1;
const NAME_TAG_MAX_DIST = 45;
const DEATH_FALL_TIME = 0.55;
const DEATH_HOLD_TIME = 3;
const DEATH_SINK_TIME = 1.2;

interface RemoteEntry {
  id: number;
  name: string;
  team: Team;
  rig: CharacterRig;
  weapons: Partial<Record<WeaponId, WeaponModel>>;
  activeWeapon: WeaponId | null;
  pose: RemotePose;
  hasPose: boolean;
  phase: number;
  stepDistance: number;
  lastX: number;
  lastZ: number;
  crouch: number;
  aim: number;
  /** Death animation clock (-1 = alive). */
  deathT: number;
  deathDir: Vector3;
  reloadT: number;
  nameTag: Mesh | null;
  tagMat: StandardMaterial | null;
  visible: boolean;
}

export class RemotePlayers {
  readonly buffer = new InterpolationBuffer();
  private readonly entries = new Map<number, RemoteEntry>();
  private readonly charMats: CharacterMaterials;
  private readonly weaponMats: WeaponMaterials;
  private selfTeam: Team | null = null;
  private room: RoomState | null = null;
  private readonly tmpVec: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly targetList: HitTarget[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    private readonly env: Environment | null,
    private readonly audio: GameAudio | null,
    private readonly selfId: number,
  ) {
    this.charMats = new CharacterMaterials(scene);
    this.weaponMats = new WeaponMaterials(scene);
    scene.setRenderingAutoClearDepthStencil(TAG_RENDER_GROUP, true, true, false);
  }

  // ---------------------------------------------------------------------------
  // Room / snapshots / events
  // ---------------------------------------------------------------------------

  /** Create/remove entries to match the room; refresh names and teams. */
  syncRoom(room: RoomState): void {
    this.room = room;
    const self = room.players.find((p) => p.id === this.selfId);
    this.selfTeam = self?.team ?? null;
    const seen = new Set<number>();
    for (const p of room.players) {
      if (p.id === this.selfId) continue;
      seen.add(p.id);
      const e = this.entries.get(p.id);
      if (!e) {
        this.entries.set(p.id, this.createEntry(p.id, p.name, p.team));
      } else if (e.team !== p.team || e.name !== p.name) {
        // Team/name changed: rebuild the character.
        this.destroyEntry(e);
        this.entries.set(p.id, this.createEntry(p.id, p.name, p.team));
      }
    }
    for (const [id, e] of this.entries) {
      if (!seen.has(id)) {
        this.destroyEntry(e);
        this.entries.delete(id);
        this.buffer.remove(id);
      }
    }
    this.refreshNameTags();
  }

  onSnapshot(snap: Snapshot): void {
    this.buffer.push(snap.st, snap.players.filter((p) => p.id !== this.selfId));
    // A player present in snapshots but not (yet) in the room gets a placeholder entry.
    for (const p of snap.players) {
      if (p.id === this.selfId || this.entries.has(p.id)) continue;
      const rp = this.room?.players.find((r) => r.id === p.id);
      this.entries.set(p.id, this.createEntry(p.id, rp?.name ?? `Player ${p.id}`, p.team));
    }
  }

  onEvent(e: GameEvent): void {
    switch (e.e) {
      case 'death': {
        const entry = this.entries.get(e.id);
        if (entry && entry.deathT < 0) this.startDeath(entry);
        break;
      }
      case 'spawn': {
        const entry = this.entries.get(e.id);
        if (entry) this.revive(entry);
        break;
      }
      case 'reload': {
        const entry = this.entries.get(e.id);
        if (entry) {
          entry.reloadT = 0;
          this.audio?.reload(e.w, 'out', this.posOf(entry));
        }
        break;
      }
      case 'switch': {
        const entry = this.entries.get(e.id);
        if (entry) this.audio?.weaponSwitch(this.posOf(entry));
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Currently rendered pose of a player (null if unknown). */
  poseOf(id: number): RemotePose | null {
    const e = this.entries.get(id);
    return e && e.hasPose ? e.pose : null;
  }

  teamOf(id: number): Team | null {
    return this.entries.get(id)?.team ?? null;
  }

  /** Hit targets for local shot tracing: alive players at their rendered poses. */
  targets(includeTeam: boolean): HitTarget[] {
    this.targetList.length = 0;
    for (const e of this.entries.values()) {
      if (!e.hasPose || !e.pose.alive) continue;
      if (!includeTeam && this.selfTeam && e.team === this.selfTeam) continue;
      this.targetList.push({ id: e.id, pos: { x: e.pose.x, y: e.pose.y, z: e.pose.z }, stance: e.pose.stance });
    }
    return this.targetList;
  }

  /** World-space muzzle of a player's held weapon (falls back to eye height). */
  muzzleOf(id: number, out: Vector3): boolean {
    const e = this.entries.get(id);
    if (!e || !e.hasPose) return false;
    const w = e.activeWeapon ? e.weapons[e.activeWeapon] : null;
    if (w) {
      w.muzzle.computeWorldMatrix(true);
      out.copyFrom(w.muzzle.getAbsolutePosition());
    } else {
      out.set(e.pose.x, e.pose.y + eyeHeight(e.pose.stance) - 0.1, e.pose.z);
    }
    return true;
  }

  private posOf(e: RemoteEntry): Vec3 {
    this.tmpVec.x = e.pose.x;
    this.tmpVec.y = e.pose.y + 1;
    this.tmpVec.z = e.pose.z;
    return this.tmpVec;
  }

  // ---------------------------------------------------------------------------
  // Entries
  // ---------------------------------------------------------------------------

  private createEntry(id: number, name: string, team: Team): RemoteEntry {
    const rig = buildCharacter(this.scene, team, this.charMats, `${id}`);
    rig.root.setEnabled(false);
    for (const m of rig.meshes) this.env?.addShadowCaster(m);
    const entry: RemoteEntry = {
      id,
      name,
      team,
      rig,
      weapons: {},
      activeWeapon: null,
      pose: createRemotePose(),
      hasPose: false,
      phase: Math.random() * Math.PI * 2,
      stepDistance: 0,
      lastX: 0,
      lastZ: 0,
      crouch: 0,
      aim: 0,
      deathT: -1,
      deathDir: new Vector3(0, 0, 1),
      reloadT: -1,
      nameTag: null,
      tagMat: null,
      visible: false,
    };
    return entry;
  }

  private destroyEntry(e: RemoteEntry): void {
    for (const w of Object.values(e.weapons)) {
      if (!w) continue;
      for (const m of w.meshes) this.env?.removeShadowCaster(m);
      w.dispose();
    }
    for (const m of e.rig.meshes) this.env?.removeShadowCaster(m);
    e.rig.dispose();
    this.disposeTag(e);
  }

  private disposeTag(e: RemoteEntry): void {
    if (e.nameTag) {
      const tex = e.tagMat?.diffuseTexture;
      e.nameTag.dispose();
      e.tagMat?.dispose();
      tex?.dispose();
      e.nameTag = null;
      e.tagMat = null;
    }
  }

  private refreshNameTags(): void {
    for (const e of this.entries.values()) {
      const wantTag = !!this.selfTeam && e.team === this.selfTeam;
      if (wantTag && !e.nameTag) this.createTag(e);
      else if (!wantTag && e.nameTag) this.disposeTag(e);
    }
  }

  private createTag(e: RemoteEntry): void {
    const tex = createTextTexture(this.scene, `tag_${e.id}`, {
      text: e.name,
      width: 256,
      height: 64,
      color: e.team === 'tigris' ? '#9fe3f0' : '#ffc79a',
      background: null,
      outline: 'rgba(0,0,0,0.85)',
      weight: 700,
    });
    if (!tex) return;
    const mat = new StandardMaterial(`tag_${e.id}`, this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = Color3.White();
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    const plane = MeshBuilder.CreatePlane(`tag_${e.id}`, { width: 0.8, height: 0.2 }, this.scene);
    plane.material = mat;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.renderingGroupId = TAG_RENDER_GROUP;
    plane.isPickable = false;
    plane.parent = e.rig.root;
    plane.position.y = 2.05;
    e.nameTag = plane;
    e.tagMat = mat;
  }

  private ensureWeapon(e: RemoteEntry, id: WeaponId): void {
    if (e.activeWeapon === id) return;
    for (const w of Object.values(e.weapons)) if (w) w.root.setEnabled(false);
    let w = e.weapons[id];
    if (!w) {
      w = buildWeaponModel(this.scene, id, this.weaponMats, 'simple');
      w.root.parent = e.rig.handR;
      // Held pose: grip in the right hand, barrel forward.
      w.root.position.set(0, 0.02, 0.06);
      w.root.rotation.set(0, 0, 0);
      for (const m of w.meshes) {
        m.receiveShadows = false;
        this.env?.addShadowCaster(m);
      }
      e.weapons[id] = w;
    }
    w.root.setEnabled(true);
    e.activeWeapon = id;
  }

  private startDeath(e: RemoteEntry): void {
    e.deathT = 0;
    const sp = Math.hypot(e.pose.vx, e.pose.vz);
    if (sp > 0.5) e.deathDir.set(e.pose.vx / sp, 0, e.pose.vz / sp);
    else e.deathDir.set(Math.sin(e.pose.yaw), 0, Math.cos(e.pose.yaw)).scaleInPlace(-1);
  }

  private revive(e: RemoteEntry): void {
    e.deathT = -1;
    e.reloadT = -1;
    resetPose(e.rig);
    for (const m of e.rig.meshes) m.visibility = 1;
    e.rig.root.setEnabled(true);
  }

  // ---------------------------------------------------------------------------
  // Frame update
  // ---------------------------------------------------------------------------

  update(dt: number, serverNow: number, cameraPos: Vector3): void {
    const renderTime = serverNow - INTERP_DELAY_MS;
    for (const e of this.entries.values()) {
      const had = e.hasPose;
      e.hasPose = this.buffer.sample(e.id, renderTime, e.pose);
      if (!e.hasPose) {
        if (e.rig.root.isEnabled()) e.rig.root.setEnabled(false);
        continue;
      }
      if (!had) {
        e.lastX = e.pose.x;
        e.lastZ = e.pose.z;
      }
      // Snapshot says dead but no death event yet (join in progress): start the fall.
      if (!e.pose.alive && e.deathT < 0) this.startDeath(e);
      if (e.pose.alive && e.deathT >= 0 && e.pose.hp > 0) this.revive(e);
      if (!e.rig.root.isEnabled()) e.rig.root.setEnabled(true);

      const rig = e.rig;
      rig.root.position.set(e.pose.x, e.pose.y, e.pose.z);
      rig.root.rotation.y = e.pose.yaw;
      this.ensureWeapon(e, e.pose.weaponId);

      if (e.deathT >= 0) {
        this.animateDeath(e, dt);
        continue;
      }

      // Locomotion.
      const dx = e.pose.x - e.lastX;
      const dz = e.pose.z - e.lastZ;
      e.lastX = e.pose.x;
      e.lastZ = e.pose.z;
      const moved = Math.hypot(dx, dz);
      const speed = dt > 0 ? Math.min(moved / dt, MOVEMENT.sprintSpeed * 1.3) : 0;
      const walk = Math.min(1.4, speed / MOVEMENT.walkSpeed);
      if (e.pose.onGround && walk > 0.05) {
        e.phase += dt * (6.5 + walk * 3.5);
        e.stepDistance += moved;
        const stride = e.pose.sprinting ? 0.98 : e.pose.stance === 'crouch' ? 0.55 : 0.74;
        if (e.stepDistance >= stride) {
          e.stepDistance = 0;
          this.footstep(e);
        }
      } else {
        e.stepDistance = 0;
      }
      const targetCrouch = e.pose.stance === 'crouch' ? 1 : e.pose.stance === 'slide' ? 1.3 : 0;
      e.crouch += (targetCrouch - e.crouch) * Math.min(1, dt * 12);
      const targetAim = e.pose.ads ? 1 : e.pose.sprinting ? -1 : 0;
      e.aim += (targetAim - e.aim) * Math.min(1, dt * 10);
      this.animateBody(e, walk, dt);

      // Name tag distance fade.
      if (e.nameTag) {
        const d = Vector3.Distance(cameraPos, rig.root.position);
        const vis = d > NAME_TAG_MAX_DIST ? 0 : d > NAME_TAG_MAX_DIST - 10 ? (NAME_TAG_MAX_DIST - d) / 10 : 1;
        e.nameTag.visibility = vis;
        e.nameTag.isVisible = vis > 0.01;
      }
    }
  }

  private animateBody(e: RemoteEntry, walk: number, dt: number): void {
    const rig = e.rig;
    const p = e.pose;
    const swing = Math.sin(e.phase) * (0.55 + walk * 0.3) * Math.min(1, walk * 1.5);
    const kneeBend = Math.max(0, -Math.sin(e.phase)) * 0.9 * Math.min(1, walk);
    const kneeBend2 = Math.max(0, Math.sin(e.phase)) * 0.9 * Math.min(1, walk);
    const crouch = Math.min(1, e.crouch);
    const slide = Math.max(0, e.crouch - 1) / 0.3;

    // Legs: swing while moving, bend while crouching, stretch forward in a slide.
    rig.legL.joint.rotation.x = swing + crouch * 0.9 + slide * -0.8;
    rig.legR.joint.rotation.x = -swing + crouch * 0.9 + slide * -1.1;
    rig.legL.lower.rotation.x = -(kneeBend + crouch * 1.5) + slide * 0.9;
    rig.legR.lower.rotation.x = -(kneeBend2 + crouch * 1.5) + slide * 0.6;
    // Hips drop with crouch / slide; a subtle bounce while walking.
    const bounce = Math.abs(Math.cos(e.phase)) * 0.03 * Math.min(1, walk) * (1 - crouch);
    rig.hips.position.y = HIPS_REST_Y - crouch * 0.36 - slide * 0.3 + bounce;
    rig.hips.position.z = slide * -0.15;

    // Torso: forward lean when crouching/sprinting, back when sliding, and aim pitch.
    const sprintLean = p.sprinting ? 0.22 : 0;
    rig.torso.rotation.x = p.pitch * 0.45 + crouch * 0.25 + sprintLean - slide * 0.6;
    rig.head.rotation.x = p.pitch * 0.5 - crouch * 0.15;

    // Arms: hold the weapon. aim = 1 shoulders it, 0 low ready, -1 sprint carry.
    const aim = e.aim;
    const pump = Math.sin(e.phase) * 0.25 * Math.min(1, walk) * (aim < 0 ? 1 : 0.2);
    const shoulder = aim > 0 ? -1.45 - p.pitch : aim < 0 ? -0.6 + aim * 0.2 : -1.0 - p.pitch * 0.6;
    rig.armR.joint.rotation.x = shoulder + pump;
    rig.armR.joint.rotation.z = aim > 0 ? 0.15 : 0.35;
    rig.armR.lower.rotation.x = aim > 0 ? -0.35 : -0.9;
    rig.armL.joint.rotation.x = shoulder - 0.1 - pump;
    rig.armL.joint.rotation.z = aim > 0 ? -0.25 : -0.5;
    rig.armL.lower.rotation.x = aim > 0 ? -0.6 : -1.2;
    rig.armL.joint.rotation.y = aim > 0 ? 0.5 : 0.7;

    // Weapon orientation follows the shoulder: forward when aiming, angled down otherwise.
    const w = e.activeWeapon ? e.weapons[e.activeWeapon] : null;
    if (w) {
      w.root.rotation.x = -(shoulder + Math.PI / 2) + (aim < 0 ? 0.6 : 0.1);
      w.root.rotation.z = 0;
      if (e.reloadT >= 0) {
        e.reloadT += dt;
        const t = e.reloadT;
        // Tilt the weapon and drop/replace the magazine over ~1.8 s.
        w.root.rotation.z = Math.sin(Math.min(1, t / 1.8) * Math.PI) * 0.5;
        if (w.magazine) {
          const drop = t < 0.6 ? t / 0.6 : t < 1.3 ? 1 : Math.max(0, 1 - (t - 1.3) / 0.4);
          w.magazine.position.y = w.magazineRest.y - drop * 0.18;
          w.magazine.isVisible = !(t >= 0.6 && t < 1.3);
        }
        if (t > 1.8) {
          e.reloadT = -1;
          if (w.magazine) {
            w.magazine.position.copyFrom(w.magazineRest);
            w.magazine.isVisible = true;
          }
          this.audio?.reload(e.pose.weaponId, 'in', this.posOf(e));
        }
      }
    }
  }

  private animateDeath(e: RemoteEntry, dt: number): void {
    const rig = e.rig;
    e.deathT += dt;
    const t = e.deathT;
    resetPose(rig);
    rig.root.rotation.y = e.pose.yaw;
    // Fall toward the movement direction: rotate about the horizontal axis
    // perpendicular to it, from upright to flat.
    const fall = Math.min(1, t / DEATH_FALL_TIME);
    const angle = (1 - Math.pow(1 - fall, 3)) * (Math.PI / 2);
    // Express the fall in root space: forward direction in local coordinates.
    const localDirX = e.deathDir.x * Math.cos(-e.pose.yaw) - e.deathDir.z * Math.sin(-e.pose.yaw);
    const localDirZ = e.deathDir.x * Math.sin(-e.pose.yaw) + e.deathDir.z * Math.cos(-e.pose.yaw);
    rig.hips.rotation.x = angle * localDirZ;
    rig.hips.rotation.z = -angle * localDirX;
    rig.hips.position.y = HIPS_REST_Y * (1 - fall) + 0.2 * fall;
    // Limbs relax.
    rig.armL.joint.rotation.z = -0.5 * fall;
    rig.armR.joint.rotation.z = 0.5 * fall;
    rig.legL.joint.rotation.x = 0.2 * fall;
    rig.legR.joint.rotation.x = -0.1 * fall;
    const w = e.activeWeapon ? e.weapons[e.activeWeapon] : null;
    if (w) w.root.rotation.x = 0.4;
    if (e.nameTag) e.nameTag.isVisible = false;
    if (t > DEATH_HOLD_TIME) {
      const s = Math.min(1, (t - DEATH_HOLD_TIME) / DEATH_SINK_TIME);
      rig.root.position.y = e.pose.y - s * 0.8;
      const vis = 1 - s;
      for (const m of rig.meshes) m.visibility = vis;
      if (w) for (const m of w.meshes) m.visibility = vis;
      if (s >= 1) rig.root.setEnabled(false);
    }
  }

  private footstep(e: RemoteEntry): void {
    if (!this.audio) return;
    const floor = floorHeightAt(this.world, { x: e.pose.x, y: e.pose.y + 0.1, z: e.pose.z }, 0.3, 0.2);
    const material = floor.box?.material ?? 'cobble';
    this.tmpVec.x = e.pose.x;
    this.tmpVec.y = e.pose.y;
    this.tmpVec.z = e.pose.z;
    this.audio.footstep(material, this.tmpVec, e.pose.sprinting);
  }

  get count(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const e of this.entries.values()) this.destroyEntry(e);
    this.entries.clear();
    this.buffer.clear();
    this.charMats.dispose();
    this.weaponMats.dispose();
  }
}
