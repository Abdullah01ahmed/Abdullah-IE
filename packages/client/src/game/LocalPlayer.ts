/**
 * The local player: samples input at a fixed 60 Hz, predicts movement and
 * weapon handling immediately, reconciles against authoritative snapshots,
 * drives the camera rig and the first-person view model, spawns the effects
 * and sounds for its own shots, and publishes predicted HUD values.
 */
import { FreeCamera, Vector3, type Scene } from '@babylonjs/core';
import {
  MOVEMENT,
  TICK_DT,
  WEAPONS,
  computeShot,
  eyeHeight,
  eyePosition,
  floorHeightAt,
  raycastWorld,
  traceShot,
  wrapAngle,
  type CollisionWorld,
  type InputCmd,
  type PlayerSimState,
  type Snapshot,
  type WeaponEvent,
  type WeaponId,
} from '@tra/shared';
import { useStore } from '../state/store';
import type { GameAudio } from './Audio';
import { CameraRig, type RigInput, type RigOutput } from './CameraRig';
import type { Effects } from './Effects';
import type { InputManager } from './Input';
import { Predictor, type TickIntent } from './Prediction';
import type { RemotePlayers } from './RemotePlayers';
import type { ViewModel } from './ViewModel';

/** Corrections below this are ignored (m). */
const CORRECTION_IGNORE = 0.02;
/** Corrections below this are smoothed; larger ones snap (m). */
const CORRECTION_SMOOTH = 1.0;
/** Most simulation ticks processed in one frame; the rest are dropped. */
const MAX_TICKS_PER_FRAME = 5;

export interface LocalPlayerDeps {
  scene: Scene;
  camera: FreeCamera;
  world: CollisionWorld;
  input: InputManager;
  viewModel: ViewModel;
  effects: Effects;
  audio: GameAudio;
  remotes: RemotePlayers;
  sendInputs(cmds: InputCmd[]): void;
  serverNow(): number;
  matchSeed: number;
  selfId: number;
  friendlyFire: boolean;
  /** True when game input must be ignored (paused, chat open, unlocked, match over). */
  inputBlocked(): boolean;
  aspect(): number;
}

export class LocalPlayer {
  readonly rig = new CameraRig();
  private predictor: Predictor | null = null;
  private accumulator = 0;
  private alive = false;
  private everSpawned = false;
  private frozen = false;
  private readonly intent: TickIntent = { moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 };
  private readonly tickInput = { moveX: 0, moveY: 0, buttons: 0 };
  private readonly mouse = { dx: 0, dy: 0 };
  private readonly rigIn: RigInput = {
    dt: 0, x: 0, y: 0, z: 0, stance: 'stand', speed: 0, lateralSpeed: 0, onGround: true, ads: 0, sprinting: false,
    landedSpeed: 0, reduceShake: false, hfovDeg: 90, aspect: 16 / 9,
  };
  private readonly rigOut: RigOutput = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 1 };
  private pendingLanded = 0;
  private stepDistance = 0;
  private indoorTimer = 0;
  private lastYawPublished = NaN;
  private readonly cmdBatch: InputCmd[] = [];
  // Death camera.
  private deathEye = new Vector3();
  private deathT = 0;
  private deathYaw = 0;
  private deathPitch = 0;
  // Scratch vectors.
  private readonly vA = new Vector3();
  private readonly vB = new Vector3();
  private readonly vC = new Vector3();
  private readonly vD = new Vector3();
  private readonly vE = new Vector3();
  private readonly recentImpacts: { x: number; y: number; z: number; t: number }[] = [];

  constructor(private readonly deps: LocalPlayerDeps) {
    deps.viewModel.onReloadCue = (cue) => {
      const id = this.predictor?.state.weapons[this.predictor.state.weaponIndex].id ?? 'dijla7';
      deps.audio.reload(id, cue, null);
    };
  }

  /** Predicted simulation state (null until the first authoritative state). */
  get state(): PlayerSimState | null {
    return this.predictor?.state ?? null;
  }

  get isAlive(): boolean {
    return this.alive;
  }

  /** Stop simulating input (match over) while keeping the camera. */
  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
  }

  /** Recent own-shot impact points, used to skip duplicated server impact events. */
  isRecentOwnImpact(x: number, y: number, z: number, now: number): boolean {
    for (const r of this.recentImpacts) {
      if (now - r.t < 400 && Math.hypot(r.x - x, r.y - y, r.z - z) < 0.2) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Snapshots
  // ---------------------------------------------------------------------------

  onSnapshot(snap: Snapshot): void {
    const self = snap.self;
    if (!self) {
      if (this.alive) this.onDied();
      return;
    }
    if (!this.predictor) {
      this.predictor = new Predictor(this.deps.world, self);
      this.rig.setAngles(self.yaw, self.pitch);
      this.alive = self.alive;
      this.everSpawned = true;
      this.deps.viewModel.setWeapon(self.weapons[self.weaponIndex].id);
      this.deps.viewModel.setVisible(self.alive);
      if (!self.alive) this.onDied();
      return;
    }
    if (self.alive && !this.alive) {
      // Respawn: adopt the server state wholesale.
      this.predictor.reset(self);
      this.rig.setAngles(self.yaw, self.pitch);
      this.rig.resetMotion();
      this.alive = true;
      this.deps.viewModel.setWeapon(self.weapons[self.weaponIndex].id);
      this.deps.viewModel.setVisible(true);
      this.stepDistance = 0;
      return;
    }
    if (!self.alive) {
      // Keep the authoritative (dead) state; nothing to replay.
      this.predictor.reset(self);
      if (this.alive) this.onDied();
      return;
    }
    const c = this.predictor.reconcile(self, snap.ack);
    if (c.error >= CORRECTION_IGNORE) {
      if (c.error < CORRECTION_SMOOTH) this.rig.addSmoothOffset(c.dx, c.dy, c.dz);
      // Larger errors snap: the rig simply follows the corrected state.
    }
    // The server may have refused a switch; make the view model agree.
    const st = this.predictor.state;
    const shownId = st.weapons[st.weaponIndex].id;
    if (st.switchTime <= 0 && this.deps.viewModel.activeWeapon !== shownId) this.deps.viewModel.setWeapon(shownId);
  }

  private onDied(): void {
    this.alive = false;
    this.deps.viewModel.setVisible(false);
    this.deps.input.tracker.releaseAll();
    const s = this.predictor?.state;
    if (s) this.deathEye.set(s.pos.x, s.pos.y + eyeHeight(s.stance), s.pos.z);
    else this.deathEye.copyFrom(this.deps.camera.position);
    this.deathT = 0;
    this.deathYaw = this.rig.yaw;
    this.deathPitch = this.rig.pitch;
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    const settings = useStore.getState().settings;
    const blocked = this.deps.inputBlocked() || this.frozen;
    this.deps.input.tracker.takeMouseDelta(this.mouse);
    if (blocked) {
      this.mouse.dx = 0;
      this.mouse.dy = 0;
    }
    const predictor = this.predictor;
    if (!predictor) {
      this.updateCameraIdle(dt);
      return;
    }
    const state = predictor.state;

    if (this.alive && !blocked) {
      const ads = state.ads > 0.5 ? settings.controls.adsSensitivityMult : 1;
      this.rig.addLook(this.mouse.dx, this.mouse.dy, settings.controls.sensitivity, ads, settings.controls.invertY);
    }

    // Fixed-step simulation. Once the match is over nothing is simulated or
    // sent any more; the camera and view model keep updating for the results
    // backdrop.
    let ticks = 0;
    if (this.frozen) {
      this.accumulator = 0;
    } else {
      this.accumulator += dt;
      ticks = Math.floor(this.accumulator / TICK_DT);
      if (ticks > MAX_TICKS_PER_FRAME) {
        ticks = MAX_TICKS_PER_FRAME;
        this.accumulator = TICK_DT; // drop the backlog
      } else {
        this.accumulator -= ticks * TICK_DT;
      }
    }
    this.cmdBatch.length = 0;
    for (let i = 0; i < ticks; i++) {
      if (blocked || !this.alive) {
        this.tickInput.moveX = 0;
        this.tickInput.moveY = 0;
        this.tickInput.buttons = 0;
      } else {
        this.deps.input.tracker.sample(this.tickInput);
      }
      this.intent.moveX = this.tickInput.moveX;
      this.intent.moveY = this.tickInput.moveY;
      this.intent.buttons = this.tickInput.buttons;
      this.intent.yaw = wrapAngle(this.rig.yaw);
      this.intent.pitch = this.rig.pitch;
      const wasOnGround = state.onGround;
      const result = predictor.step(this.intent, this.deps.serverNow());
      this.cmdBatch.push(result.cmd);
      this.handleWeaponEvents(result.events, state);
      if (result.move.landedSpeed > 0 && !wasOnGround) {
        this.pendingLanded = Math.max(this.pendingLanded, result.move.landedSpeed);
        this.deps.viewModel.onLanded(result.move.landedSpeed);
      }
      this.trackFootsteps(result.move.moved, state);
    }
    if (this.cmdBatch.length) this.deps.sendInputs(this.cmdBatch);

    // Camera.
    const speed = Math.hypot(state.vel.x, state.vel.z);
    const rightX = Math.cos(this.rig.yaw);
    const rightZ = -Math.sin(this.rig.yaw);
    if (this.alive) {
      const ri = this.rigIn;
      ri.dt = dt;
      ri.x = state.pos.x;
      ri.y = state.pos.y;
      ri.z = state.pos.z;
      ri.stance = state.stance;
      ri.speed = speed;
      ri.lateralSpeed = state.vel.x * rightX + state.vel.z * rightZ;
      ri.onGround = state.onGround;
      ri.ads = state.ads;
      ri.sprinting = state.sprinting;
      ri.landedSpeed = this.pendingLanded;
      ri.reduceShake = settings.graphics.reduceCameraShake;
      ri.hfovDeg = settings.graphics.fov;
      ri.aspect = this.deps.aspect();
      this.pendingLanded = 0;
      const out = this.rig.update(ri, this.rigOut);
      const cam = this.deps.camera;
      cam.position.set(out.x, out.y, out.z);
      cam.rotation.set(out.pitch, out.yaw, out.roll);
      cam.fov = out.fov;
    } else {
      this.updateDeathCamera(dt, settings.graphics.fov);
    }

    // View model.
    this.deps.viewModel.update({
      dt,
      ads: state.ads,
      sprinting: state.sprinting,
      speed,
      onGround: state.onGround,
      mouseDx: this.mouse.dx,
      mouseDy: this.mouse.dy,
      alive: this.alive,
      reduceShake: settings.graphics.reduceCameraShake,
    });

    // Indoor detection for reverb (every 250 ms).
    this.indoorTimer -= dt;
    if (this.indoorTimer <= 0) {
      this.indoorTimer = 0.25;
      const eye = eyePosition(state);
      const hit = raycastWorld(this.deps.world, eye, { x: 0, y: 1, z: 0 }, 7);
      this.deps.audio.setIndoor(hit !== null);
    }

    this.publishHud(state);
  }

  private updateCameraIdle(dt: number): void {
    // Before the first authoritative state: a slow drift above the map centre.
    this.deathT += dt;
    const cam = this.deps.camera;
    cam.position.set(Math.sin(this.deathT * 0.1) * 6, 6, Math.cos(this.deathT * 0.1) * 6);
    cam.rotation.set(0.45, this.deathT * 0.1 + Math.PI, 0);
  }

  private updateDeathCamera(dt: number, hfov: number): void {
    this.deathT += dt;
    const t = Math.min(1, this.deathT / 2.5);
    const rise = 0.5 * (1 - Math.pow(1 - t, 3));
    const cam = this.deps.camera;
    cam.position.set(this.deathEye.x, this.deathEye.y + rise, this.deathEye.z);
    // Look toward the killer when we know where they are.
    const killer = useStore.getState().hud.killedBy;
    const pose = killer ? this.deps.remotes.poseOf(killer.id) : null;
    let targetYaw = this.deathYaw;
    let targetPitch = this.deathPitch + 0.15;
    if (pose) {
      const dx = pose.x - cam.position.x;
      const dy = pose.y + 1.4 - cam.position.y;
      const dz = pose.z - cam.position.z;
      targetYaw = Math.atan2(dx, dz);
      targetPitch = -Math.atan2(dy, Math.hypot(dx, dz));
    }
    const k = Math.min(1, dt * 3);
    this.deathYaw += wrapAngle(targetYaw - this.deathYaw) * k;
    this.deathPitch += (targetPitch - this.deathPitch) * k;
    cam.rotation.set(this.deathPitch, this.deathYaw, 0);
    this.rigIn.hfovDeg = hfov;
    this.rigIn.aspect = this.deps.aspect();
    cam.fov = 2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / Math.max(0.1, this.rigIn.aspect));
  }

  // ---------------------------------------------------------------------------
  // Weapon events (predicted)
  // ---------------------------------------------------------------------------

  private handleWeaponEvents(events: WeaponEvent[], state: PlayerSimState): void {
    for (const e of events) {
      switch (e.kind) {
        case 'fire':
          this.fire(state, e.shotIndex);
          break;
        case 'dry_fire':
          this.deps.audio.dryFire(null);
          break;
        case 'reload_start': {
          const w = state.weapons[e.weaponIndex];
          this.deps.viewModel.onReloadStart(w.id, w.ammo === 0);
          break;
        }
        case 'switch_start': {
          const id = state.weapons[e.weaponIndex].id;
          this.deps.viewModel.onSwitchStart(id);
          this.deps.audio.weaponSwitch(null);
          break;
        }
        default:
          break;
      }
    }
  }

  private fire(state: PlayerSimState, shotIndex: number): void {
    const weaponId: WeaponId = state.weapons[state.weaponIndex].id;
    const def = WEAPONS[weaponId];
    const shot = computeShot(state, def, shotIndex, this.deps.matchSeed, this.deps.selfId);
    const settings = useStore.getState().settings;
    this.rig.kick(shot.kickPitch, shot.kickYaw, def.recoil.persistent, def.recoil.recovery, settings.graphics.reduceCameraShake ? 0.12 : 0.35);
    this.deps.viewModel.onFire(weaponId);
    this.deps.audio.gunshot(weaponId, null);

    // Trace against the world and the enemies as we see them.
    const eye = eyePosition(state);
    const targets = this.deps.remotes.targets(this.deps.friendlyFire);
    const hit = traceShot(this.deps.world, eye, shot.dir, def.range, targets);

    const muzzle = this.deps.viewModel.muzzleWorld(this.vA);
    const dir = this.vB.set(shot.dir.x, shot.dir.y, shot.dir.z);
    this.deps.effects.muzzleFlash(muzzle, dir, weaponId, true);
    const end = this.vC;
    if (hit.kind === 'none') end.set(hit.end.x, hit.end.y, hit.end.z);
    else end.set(hit.point.x, hit.point.y, hit.point.z);
    this.deps.effects.tracer(muzzle, end);
    if (hit.kind === 'world') {
      const n = this.vD.set(hit.normal.x, hit.normal.y, hit.normal.z);
      this.deps.effects.impact(end, n, hit.material);
      this.recentImpacts.push({ x: end.x, y: end.y, z: end.z, t: performance.now() });
      if (this.recentImpacts.length > 24) this.recentImpacts.shift();
    } else if (hit.kind === 'player') {
      this.deps.effects.playerHit(end, dir);
    }
    // Shell ejection from the port, out to the right.
    const eject = this.deps.viewModel.ejectWorld(this.vE);
    const right = this.vD;
    const up = this.vC;
    const fwd = this.vB;
    this.deps.viewModel.weaponAxes(right, up, fwd);
    this.deps.effects.ejectShell(eject, right, up, fwd);
  }

  private trackFootsteps(moved: number, state: PlayerSimState): void {
    if (!state.onGround || !this.alive) {
      this.stepDistance = 0;
      return;
    }
    this.stepDistance += moved;
    const stride = state.sprinting ? 0.98 : state.stance === 'crouch' ? 0.55 : 0.74;
    if (this.stepDistance < stride) return;
    this.stepDistance = 0;
    const floor = floorHeightAt(this.deps.world, { x: state.pos.x, y: state.pos.y + 0.1, z: state.pos.z }, MOVEMENT.capsuleRadius, 0.2);
    this.deps.audio.footstep(floor.box?.material ?? 'cobble', null, state.sprinting);
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  /** Publish predicted values into the store, only when something changed. */
  private publishHud(state: PlayerSimState): void {
    const store = useStore.getState();
    const hud = store.hud;
    const w = state.weapons[state.weaponIndex];
    const yaw = Math.round(wrapAngle(this.rig.yaw) * 200) / 200;
    const ads = state.ads > 0.5;
    const reloading = w.reload > 0;
    const patch: Partial<typeof hud> = {};
    let changed = false;
    if (yaw !== this.lastYawPublished && Math.abs(yaw - hud.yaw) > 0.004) {
      patch.yaw = yaw;
      this.lastYawPublished = yaw;
      changed = true;
    }
    if (hud.ads !== ads) { patch.ads = ads; changed = true; }
    if (hud.sprinting !== state.sprinting) { patch.sprinting = state.sprinting; changed = true; }
    if (hud.ammo !== w.ammo) { patch.ammo = w.ammo; changed = true; }
    if (hud.reserve !== w.reserve) { patch.reserve = w.reserve; changed = true; }
    if (hud.reloading !== reloading) { patch.reloading = reloading; changed = true; }
    if (hud.weaponIndex !== state.weaponIndex) { patch.weaponIndex = state.weaponIndex; changed = true; }
    if (hud.weaponId !== w.id) { patch.weaponId = w.id; changed = true; }
    if (changed) store.setHud(patch);
  }

  dispose(): void {
    this.deps.viewModel.onReloadCue = null;
    this.predictor = null;
  }
}
