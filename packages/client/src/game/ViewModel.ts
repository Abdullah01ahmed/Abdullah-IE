/**
 * First-person view model: the local player's weapon (and gloved hands) parented
 * to the camera and drawn in its own rendering group with a cleared depth
 * buffer so it never clips into walls. Handles pose blending (hip / ADS /
 * sprint / lowered), sway, bob, breathing, recoil, reload and switch
 * animations, and exposes muzzle/eject transforms for effects.
 *
 * FOV note: the model is rendered by the main camera, so it shares the world
 * FOV (a wider FOV shows a little more of the weapon, as in most shooters).
 */
import { Color3, MeshBuilder, PBRMaterial, TransformNode, Vector3, type Camera, type Mesh, type Scene } from '@babylonjs/core';
import { WEAPONS, type Team, type WeaponId } from '@tra/shared';
import { VIEWMODEL_RENDER_GROUP } from './Environment';
import { solidPbr } from './Materials';
import { WeaponMaterials, buildWeaponModel, type WeaponModel } from './WeaponModels';

export type ReloadCue = 'out' | 'in' | 'rack';

export interface ViewModelState {
  dt: number;
  /** 0 hip … 1 aimed. */
  ads: number;
  sprinting: boolean;
  /** Horizontal speed (m/s). */
  speed: number;
  onGround: boolean;
  /** Mouse motion this frame (counts). */
  mouseDx: number;
  mouseDy: number;
  alive: boolean;
  reduceShake: boolean;
}

interface Pose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

const HIP: Pose = { x: 0.17, y: -0.175, z: 0.34, rx: 0, ry: -0.04, rz: 0.03 };
const SPRINT: Pose = { x: 0.12, y: -0.2, z: 0.3, rx: -0.45, ry: -0.55, rz: 0.35 };
const LOWERED: Pose = { x: 0.16, y: -0.5, z: 0.3, rx: 0.9, ry: -0.1, rz: 0.1 };
const ADS_DISTANCE = 0.24;

function mixPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.rx = a.rx + (b.rx - a.rx) * t;
  out.ry = a.ry + (b.ry - a.ry) * t;
  out.rz = a.rz + (b.rz - a.rz) * t;
  return out;
}

export class ViewModel {
  readonly root: TransformNode;
  private readonly weapons: Record<WeaponId, WeaponModel>;
  private readonly mats: WeaponMaterials;
  private readonly handMat: PBRMaterial;
  private readonly sleeveMat: PBRMaterial;
  private readonly hands: Mesh[] = [];
  private active: WeaponId;
  private pendingSwitch: WeaponId | null = null;

  private sprintBlend = 0;
  private lowerBlend = 0;
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private time = 0;
  private recoilBack = 0;
  private recoilUp = 0;
  private recoilSide = 0;
  private landDip = 0;
  private landVel = 0;

  private reloadT = -1;
  private reloadDur = 1;
  private reloadEmpty = false;
  private reloadCuesFired = 0;
  private switchT = -1;
  private switchDur = 1;

  private readonly adsPose: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  private readonly poseA: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  private readonly poseB: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

  /** Reload audio cues (out / in / rack) fired at the matching animation moments. */
  onReloadCue: ((cue: ReloadCue) => void) | null = null;

  constructor(
    private readonly scene: Scene,
    camera: Camera,
    loadout: [WeaponId, WeaponId],
  ) {
    this.mats = new WeaponMaterials(scene);
    this.root = new TransformNode('viewmodel', scene);
    this.root.parent = camera;
    this.weapons = {
      dijla7: buildWeaponModel(scene, 'dijla7', this.mats, 'full', VIEWMODEL_RENDER_GROUP),
      shatt9: buildWeaponModel(scene, 'shatt9', this.mats, 'full', VIEWMODEL_RENDER_GROUP),
    };
    for (const w of Object.values(this.weapons)) {
      w.root.parent = this.root;
      w.root.setEnabled(false);
    }
    this.handMat = solidPbr(scene, 'vm_glove', '#3a3a3c', 0.85);
    this.sleeveMat = solidPbr(scene, 'vm_sleeve', '#1e4f5c', 0.9);
    this.active = loadout[0];
    this.buildHands();
    this.weapons[this.active].root.setEnabled(true);
    this.placeHands(this.active);
    this.computeAdsPose(this.active);
  }

  private buildHands(): void {
    const mk = (name: string): Mesh => {
      const fist = MeshBuilder.CreateBox(name, { width: 0.075, height: 0.085, depth: 0.1 }, this.scene);
      fist.material = this.handMat;
      fist.renderingGroupId = VIEWMODEL_RENDER_GROUP;
      fist.isPickable = false;
      fist.receiveShadows = false;
      fist.parent = this.root;
      const sleeve = MeshBuilder.CreateCylinder(`${name}_sleeve`, { diameter: 0.085, height: 0.2, tessellation: 10 }, this.scene);
      sleeve.material = this.sleeveMat;
      sleeve.renderingGroupId = VIEWMODEL_RENDER_GROUP;
      sleeve.isPickable = false;
      sleeve.receiveShadows = false;
      sleeve.parent = fist;
      sleeve.position.set(0, -0.06, -0.12);
      sleeve.rotation.x = -1.1;
      this.hands.push(fist, sleeve);
      return fist;
    };
    mk('vm_hand_r');
    mk('vm_hand_l');
  }

  private placeHands(id: WeaponId): void {
    const [right, , left] = this.hands;
    const w = this.weapons[id].root;
    right.parent = w;
    left.parent = w;
    if (id === 'dijla7') {
      right.position.set(0.0, -0.06, -0.02);
      left.position.set(-0.01, -0.02, 0.4);
    } else {
      right.position.set(0.0, -0.05, -0.04);
      left.position.set(-0.01, -0.03, 0.2);
    }
    right.rotation.set(0.3, 0, 0);
    left.rotation.set(0.1, 0, 0.4);
  }

  private computeAdsPose(id: WeaponId): void {
    const sp = this.weapons[id].sightPoint;
    this.adsPose.x = -sp.x;
    this.adsPose.y = -sp.y;
    this.adsPose.z = ADS_DISTANCE - sp.z;
    this.adsPose.rx = 0;
    this.adsPose.ry = 0;
    this.adsPose.rz = 0;
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  setTeam(team: Team | null): void {
    this.sleeveMat.albedoColor = Color3.FromHexString(team === 'euphrates' ? '#9a4a26' : '#1e4f5c');
  }

  get activeWeapon(): WeaponId {
    return this.active;
  }

  /** Recoil kick for a fired shot. */
  onFire(weapon: WeaponId): void {
    const def = WEAPONS[weapon];
    this.recoilBack = Math.min(0.06, this.recoilBack + (weapon === 'dijla7' ? 0.028 : 0.02));
    this.recoilUp = Math.min(0.12, this.recoilUp + def.recoil.vertical * 0.09);
    this.recoilSide += (Math.random() - 0.5) * def.recoil.horizontal * 0.05;
  }

  onReloadStart(weapon: WeaponId, empty: boolean): void {
    const def = WEAPONS[weapon];
    this.reloadT = 0;
    this.reloadDur = empty ? def.reloadEmptyTime : def.reloadTime;
    this.reloadEmpty = empty;
    this.reloadCuesFired = 0;
  }

  onReloadCancel(): void {
    if (this.reloadT < 0) return;
    this.reloadT = -1;
    const w = this.weapons[this.active];
    if (w.magazine) {
      w.magazine.position.copyFrom(w.magazineRest);
      w.magazine.isVisible = true;
    }
  }

  /** The simulation switched to `next`; play lower/raise over the weapon's switch time. */
  onSwitchStart(next: WeaponId): void {
    if (next === this.active && this.switchT < 0) return;
    this.onReloadCancel();
    this.pendingSwitch = next;
    this.switchT = 0;
    this.switchDur = Math.max(0.15, WEAPONS[next].switchTime);
  }

  /** Force the shown weapon (respawn / reconciliation). */
  setWeapon(id: WeaponId): void {
    if (id === this.active) return;
    this.onReloadCancel();
    this.weapons[this.active].root.setEnabled(false);
    this.active = id;
    this.weapons[id].root.setEnabled(true);
    this.placeHands(id);
    this.computeAdsPose(id);
    this.pendingSwitch = null;
    this.switchT = -1;
  }

  onLanded(speed: number): void {
    this.landVel -= Math.min(0.5, speed * 0.05);
  }

  setVisible(visible: boolean): void {
    this.root.setEnabled(visible);
  }

  // ---------------------------------------------------------------------------
  // Queries for effects
  // ---------------------------------------------------------------------------

  muzzleWorld(out: Vector3): Vector3 {
    const m = this.weapons[this.active].muzzle;
    m.computeWorldMatrix(true);
    return out.copyFrom(m.getAbsolutePosition());
  }

  ejectWorld(out: Vector3): Vector3 {
    const e = this.weapons[this.active].ejectPort;
    e.computeWorldMatrix(true);
    return out.copyFrom(e.getAbsolutePosition());
  }

  /** Weapon-space axes in world space (right, up, forward). */
  weaponAxes(right: Vector3, up: Vector3, forward: Vector3): void {
    const w = this.weapons[this.active].root;
    w.computeWorldMatrix(true);
    const m = w.getWorldMatrix();
    Vector3.TransformNormalToRef(Vector3.RightReadOnly, m, right);
    Vector3.TransformNormalToRef(Vector3.UpReadOnly, m, up);
    Vector3.TransformNormalToRef(Vector3.LeftHandedForwardReadOnly, m, forward);
    right.normalize();
    up.normalize();
    forward.normalize();
  }

  // ---------------------------------------------------------------------------
  // Frame update
  // ---------------------------------------------------------------------------

  update(s: ViewModelState): void {
    const dt = Math.min(0.1, s.dt);
    this.time += dt;
    const shake = s.reduceShake ? 0.35 : 1;

    // Blends.
    const sprintTarget = s.sprinting && this.switchT < 0 && this.reloadT < 0 ? 1 : 0;
    this.sprintBlend += (sprintTarget - this.sprintBlend) * Math.min(1, dt * 9);
    let lowerTarget = s.alive ? 0 : 1;
    if (this.switchT >= 0) {
      this.switchT += dt;
      const half = this.switchDur / 2;
      if (this.pendingSwitch && this.switchT >= half) {
        // Swap models at the bottom of the lower/raise arc.
        const next = this.pendingSwitch;
        this.pendingSwitch = null;
        this.weapons[this.active].root.setEnabled(false);
        this.active = next;
        this.weapons[next].root.setEnabled(true);
        this.placeHands(next);
        this.computeAdsPose(next);
      }
      lowerTarget = this.switchT < half ? 1 : 0;
      if (this.switchT >= this.switchDur) this.switchT = -1;
    }
    this.lowerBlend += (lowerTarget - this.lowerBlend) * Math.min(1, dt * (lowerTarget ? 14 : 9));

    // Sway lags behind mouse motion.
    const swayK = (1 - s.ads * 0.85) * shake;
    this.swayX += (-s.mouseDx * 0.0009 * swayK - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (-s.mouseDy * 0.0009 * swayK - this.swayY) * Math.min(1, dt * 10);
    this.swayX = Math.max(-0.06, Math.min(0.06, this.swayX));
    this.swayY = Math.max(-0.06, Math.min(0.06, this.swayY));

    // Bob with movement.
    const walk = s.onGround ? Math.min(1.4, s.speed / 4.8) : 0;
    const bobTarget = walk * (s.sprinting ? 0.02 : 0.012) * (1 - s.ads * 0.8) * shake;
    this.bobAmp += (bobTarget - this.bobAmp) * Math.min(1, dt * 8);
    if (walk > 0.05) this.bobPhase += dt * (s.sprinting ? 11 : 8.5);
    const bobX = Math.sin(this.bobPhase) * this.bobAmp;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * this.bobAmp * 0.8;

    // Breathing.
    const breathe = Math.sin(this.time * 1.4) * 0.0018 * (1 - s.ads * 0.6);

    // Recoil recovery and landing spring.
    this.recoilBack *= Math.exp(-dt * 16);
    this.recoilUp *= Math.exp(-dt * 13);
    this.recoilSide *= Math.exp(-dt * 12);
    this.landVel += (-this.landDip * 200 - this.landVel * 16) * dt;
    this.landDip += this.landVel * dt;

    // Base pose: hip ↔ ADS ↔ sprint ↔ lowered.
    const p = mixPose(HIP, this.adsPose, s.ads, this.poseA);
    mixPose(p, SPRINT, this.sprintBlend * (1 - s.ads), this.poseB);
    mixPose(this.poseB, LOWERED, this.lowerBlend, this.poseA);
    const pose = this.poseA;

    // Reload animation: tilt, drop mag, insert, (rack).
    let relRx = 0, relRz = 0, relY = 0, relZ = 0;
    const w = this.weapons[this.active];
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      const t = Math.min(1, this.reloadT / this.reloadDur);
      const tilt = Math.sin(Math.min(1, t / 0.15) * Math.PI * 0.5) * (t > 0.85 ? Math.max(0, 1 - (t - 0.85) / 0.15) : 1);
      relRx = 0.3 * tilt;
      relRz = 0.35 * tilt;
      relY = -0.03 * tilt;
      if (w.magazine) {
        let drop = 0;
        let visible = true;
        if (t < 0.15) drop = 0;
        else if (t < 0.4) drop = (t - 0.15) / 0.25;
        else if (t < 0.55) visible = false;
        else if (t < 0.78) drop = 1 - (t - 0.55) / 0.23;
        w.magazine.isVisible = visible;
        w.magazine.position.set(w.magazineRest.x, w.magazineRest.y - drop * 0.22, w.magazineRest.z + drop * 0.04);
        w.magazine.rotation.x = drop * 0.4;
      }
      if (this.reloadEmpty && t > 0.86 && t < 0.94) relZ = -0.025;
      // Audio cues.
      if (this.reloadCuesFired === 0 && t >= 0.15) { this.reloadCuesFired = 1; this.onReloadCue?.('out'); }
      if (this.reloadCuesFired === 1 && t >= 0.72) { this.reloadCuesFired = 2; this.onReloadCue?.('in'); }
      if (this.reloadCuesFired === 2 && this.reloadEmpty && t >= 0.87) { this.reloadCuesFired = 3; this.onReloadCue?.('rack'); }
      if (t >= 1) {
        this.reloadT = -1;
        if (w.magazine) {
          w.magazine.position.copyFrom(w.magazineRest);
          w.magazine.rotation.x = 0;
          w.magazine.isVisible = true;
        }
      }
    }

    const r = this.root;
    r.position.set(
      pose.x + this.swayX * 0.5 + bobX + this.recoilSide * 0.3,
      pose.y + this.swayY * 0.4 + bobY + breathe + this.landDip * 0.4 + relY,
      pose.z - this.recoilBack + relZ,
    );
    r.rotation.set(
      pose.rx + this.swayY * 1.2 - this.recoilUp - this.landDip * 0.8 + relRx,
      pose.ry + this.swayX * 1.2 + this.recoilSide,
      pose.rz + this.swayX * 0.6 + relRz,
    );
  }

  dispose(): void {
    for (const h of this.hands) h.dispose();
    this.hands.length = 0;
    for (const w of Object.values(this.weapons)) w.dispose();
    this.handMat.dispose(true, false);
    this.sleeveMat.dispose(true, false);
    this.mats.dispose();
    this.root.dispose();
  }
}
