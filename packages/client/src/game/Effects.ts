/**
 * Visual effects: muzzle flashes, ejected shells, tracers, material-coloured
 * impact puffs, bullet-hole decals and player hit feedback. Everything is
 * pooled and capped by the quality profile so a full-auto firefight never
 * allocates per shot.
 */
import {
  Color3,
  Color4,
  Constants,
  CreateDecal,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  Quaternion,
  SolidParticleSystem,
  StandardMaterial,
  Vector3,
  type RawTexture,
  type Scene,
  type SolidParticle,
} from '@babylonjs/core';
import { floorHeightAt, queryBoxes, type AABB, type CollisionWorld, type WeaponId, type WorldBox } from '@tra/shared';
import { createRawRgbaTexture, solidPbr } from './Materials';
import { VIEWMODEL_RENDER_GROUP } from './Environment';
import type { QualityProfile } from './quality';
import { generateBulletHole, generateSoftDisc } from './textures';

/** Particle puff colours and behaviour per surface family. */
interface ImpactStyle {
  color: Color4;
  color2: Color4;
  size: number;
  speed: number;
  sparks: boolean;
}

const IMPACT_STYLES: Record<string, ImpactStyle> = {
  brick: { color: new Color4(0.8, 0.64, 0.46, 0.9), color2: new Color4(0.7, 0.55, 0.4, 0.5), size: 0.09, speed: 2.2, sparks: false },
  brick_dark: { color: new Color4(0.6, 0.45, 0.34, 0.9), color2: new Color4(0.5, 0.38, 0.3, 0.5), size: 0.09, speed: 2.2, sparks: false },
  plaster: { color: new Color4(0.92, 0.88, 0.8, 0.9), color2: new Color4(0.85, 0.8, 0.72, 0.5), size: 0.1, speed: 2.0, sparks: false },
  plaster_worn: { color: new Color4(0.88, 0.8, 0.68, 0.9), color2: new Color4(0.75, 0.62, 0.48, 0.5), size: 0.1, speed: 2.0, sparks: false },
  stone: { color: new Color4(0.7, 0.66, 0.58, 0.9), color2: new Color4(0.55, 0.52, 0.46, 0.5), size: 0.08, speed: 2.6, sparks: false },
  cobble: { color: new Color4(0.6, 0.56, 0.5, 0.9), color2: new Color4(0.45, 0.42, 0.38, 0.5), size: 0.08, speed: 2.6, sparks: false },
  concrete: { color: new Color4(0.62, 0.62, 0.6, 0.9), color2: new Color4(0.5, 0.5, 0.48, 0.5), size: 0.08, speed: 2.4, sparks: false },
  roof: { color: new Color4(0.75, 0.66, 0.54, 0.9), color2: new Color4(0.6, 0.52, 0.42, 0.5), size: 0.1, speed: 1.8, sparks: false },
  ground: { color: new Color4(0.66, 0.55, 0.4, 0.85), color2: new Color4(0.55, 0.45, 0.32, 0.4), size: 0.13, speed: 1.6, sparks: false },
  sand: { color: new Color4(0.84, 0.74, 0.56, 0.85), color2: new Color4(0.7, 0.6, 0.45, 0.4), size: 0.14, speed: 1.5, sparks: false },
  wood: { color: new Color4(0.5, 0.33, 0.18, 0.95), color2: new Color4(0.36, 0.24, 0.13, 0.6), size: 0.05, speed: 3.2, sparks: false },
  lattice: { color: new Color4(0.45, 0.3, 0.17, 0.95), color2: new Color4(0.36, 0.24, 0.13, 0.6), size: 0.05, speed: 3.0, sparks: false },
  metal: { color: new Color4(1, 0.85, 0.5, 1), color2: new Color4(1, 0.5, 0.15, 0.8), size: 0.03, speed: 5.0, sparks: true },
  tile: { color: new Color4(0.7, 0.8, 0.85, 0.9), color2: new Color4(0.3, 0.45, 0.6, 0.5), size: 0.05, speed: 3.0, sparks: false },
  glass: { color: new Color4(0.85, 0.92, 0.95, 0.9), color2: new Color4(0.7, 0.8, 0.9, 0.4), size: 0.04, speed: 3.5, sparks: false },
  fabric: { color: new Color4(0.75, 0.7, 0.6, 0.7), color2: new Color4(0.6, 0.55, 0.5, 0.3), size: 0.07, speed: 1.5, sparks: false },
  water: { color: new Color4(0.8, 0.9, 0.95, 0.8), color2: new Color4(0.5, 0.7, 0.8, 0.3), size: 0.1, speed: 2.5, sparks: false },
  player: { color: new Color4(0.42, 0.1, 0.07, 0.9), color2: new Color4(0.3, 0.07, 0.05, 0.4), size: 0.07, speed: 1.6, sparks: false },
};
const DEFAULT_IMPACT = IMPACT_STYLES.stone;

interface Flash {
  mesh: Mesh;
  life: number;
  maxLife: number;
}

interface Tracer {
  mesh: Mesh;
  from: Vector3;
  dir: Vector3;
  length: number;
  head: number;
  speed: number;
  active: boolean;
}

interface DecalEntry {
  mesh: Mesh;
  age: number;
}

const SHELL_LIFE = 1.5;
const DECAL_LIFE = 20;
const DECAL_FADE = 5;
const TRACER_SPEED = 260;
const TRACER_STREAK = 2.4;

export class Effects {
  private readonly flashes: Flash[] = [];
  private readonly flashMat: StandardMaterial;
  private readonly flashLightFp: PointLight;
  private readonly flashLightWorld: PointLight;
  private flashLightFpLife = 0;
  private flashLightWorldLife = 0;

  private shells: SolidParticleSystem | null = null;
  private readonly shellMat;
  private shellCursor = 0;
  private shellsAlive = 0;

  private readonly tracers: Tracer[] = [];
  private readonly tracerMat: StandardMaterial;

  private readonly puffs: ParticleSystem[] = [];
  private readonly sparks: ParticleSystem[] = [];
  private puffCursor = 0;
  private sparkCursor = 0;

  private readonly decals: DecalEntry[] = [];
  private readonly decalMat: StandardMaterial;
  private readonly decalSource: Mesh;

  private readonly disposables: { dispose(): void }[] = [];
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly queryBox: AABB = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  private readonly queryOut: WorldBox[] = [];
  private quality: QualityProfile;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    quality: QualityProfile,
  ) {
    this.quality = quality;
    // Shared sprites.
    const disc = createRawRgbaTexture(scene, 'fx_disc', generateSoftDisc(64, 0.25), 64, 64, { mips: true, clamp: true });
    disc.hasAlpha = true;
    const flashTex = createRawRgbaTexture(scene, 'fx_flash', generateSoftDisc(64, 0.05), 64, 64, { mips: true, clamp: true });
    flashTex.hasAlpha = true;
    const holeTex = createRawRgbaTexture(scene, 'fx_hole', generateBulletHole(64), 64, 64, { mips: true, clamp: true });
    holeTex.hasAlpha = true;
    this.disposables.push(disc, flashTex, holeTex);

    // Muzzle flash billboards.
    this.flashMat = new StandardMaterial('fx_flash', scene);
    this.flashMat.emissiveTexture = flashTex;
    this.flashMat.opacityTexture = flashTex;
    this.flashMat.emissiveColor = new Color3(1.6, 1.1, 0.5);
    this.flashMat.diffuseColor = Color3.Black();
    this.flashMat.specularColor = Color3.Black();
    this.flashMat.disableLighting = true;
    this.flashMat.alphaMode = Constants.ALPHA_ADD;
    this.flashMat.disableDepthWrite = true;
    this.flashMat.backFaceCulling = false;
    this.disposables.push(this.flashMat);
    for (let i = 0; i < 6; i++) {
      const m = MeshBuilder.CreatePlane(`fx_flash_${i}`, { size: 1 }, scene);
      m.material = this.flashMat;
      m.billboardMode = Mesh.BILLBOARDMODE_ALL;
      m.isPickable = false;
      m.isVisible = false;
      m.applyFog = false;
      this.flashes.push({ mesh: m, life: 0, maxLife: 0.05 });
      this.disposables.push(m);
    }
    this.flashLightFp = new PointLight('fx_flash_light_fp', Vector3.Zero(), scene);
    this.flashLightWorld = new PointLight('fx_flash_light', Vector3.Zero(), scene);
    for (const l of [this.flashLightFp, this.flashLightWorld]) {
      l.diffuse = new Color3(1, 0.72, 0.4);
      l.specular = new Color3(1, 0.8, 0.5);
      l.range = 7;
      l.intensity = 0;
      l.setEnabled(false);
      l.shadowEnabled = false;
      this.disposables.push(l);
    }

    // Shells.
    this.shellMat = solidPbr(scene, 'fx_brass', '#c9a24a', 0.35, 0.95);
    this.disposables.push(this.shellMat);
    this.buildShells();

    // Tracers.
    this.tracerMat = new StandardMaterial('fx_tracer', scene);
    this.tracerMat.emissiveColor = new Color3(1.8, 1.2, 0.55);
    this.tracerMat.diffuseColor = Color3.Black();
    this.tracerMat.specularColor = Color3.Black();
    this.tracerMat.disableLighting = true;
    this.tracerMat.alpha = 0.85;
    this.tracerMat.alphaMode = Constants.ALPHA_ADD;
    this.tracerMat.disableDepthWrite = true;
    this.disposables.push(this.tracerMat);
    this.buildTracers();

    // Impact puffs and sparks.
    for (let i = 0; i < 10; i++) this.puffs.push(this.makePuff(`fx_puff_${i}`, disc, false));
    for (let i = 0; i < 4; i++) this.sparks.push(this.makePuff(`fx_spark_${i}`, disc, true));

    // Decals.
    this.decalMat = new StandardMaterial('fx_decal', scene);
    this.decalMat.diffuseTexture = holeTex;
    this.decalMat.useAlphaFromDiffuseTexture = true;
    this.decalMat.specularColor = Color3.Black();
    this.decalMat.zOffset = -2;
    this.decalMat.backFaceCulling = true;
    this.disposables.push(this.decalMat);
    // Hidden unit box repositioned onto the hit block for CreateDecal; it gets a
    // material so the scene never has to create its lazy default material for it.
    this.decalSource = MeshBuilder.CreateBox('fx_decal_source', { size: 1 }, scene);
    this.decalSource.material = this.decalMat;
    this.decalSource.isVisible = false;
    this.decalSource.isPickable = false;
    this.disposables.push(this.decalSource);
  }

  // ---------------------------------------------------------------------------
  // Pools
  // ---------------------------------------------------------------------------

  private buildShells(): void {
    this.shells?.dispose();
    const count = this.quality.maxShells;
    const sps = new SolidParticleSystem('fx_shells', this.scene, { updatable: true });
    const proto = MeshBuilder.CreateBox('fx_shell_proto', { width: 0.009, height: 0.009, depth: 0.024 }, this.scene);
    sps.addShape(proto, count);
    proto.dispose();
    const mesh = sps.buildMesh();
    mesh.material = this.shellMat;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    sps.isAlwaysVisible = true;
    sps.computeParticleColor = false;
    sps.computeParticleTexture = false;
    sps.initParticles = () => {
      for (const p of sps.particles) {
        p.alive = false;
        p.isVisible = false;
      }
    };
    sps.updateParticle = (p: SolidParticle) => {
      if (!p.alive) return p;
      const dt = this.scene.getEngine().getDeltaTime() / 1000;
      const props = p.props as { life: number; av: Vector3 };
      props.life -= dt;
      if (props.life <= 0) {
        p.alive = false;
        p.isVisible = false;
        this.shellsAlive--;
        return p;
      }
      p.velocity.y -= 9.8 * dt;
      p.position.addInPlace(p.velocity.scale(dt));
      p.rotation.addInPlace(props.av.scale(dt));
      // Bounce on the floor beneath.
      const floor = floorHeightAt(this.world, p.position, 0.02, 0.05).y;
      if (p.position.y < floor + 0.006 && p.velocity.y < 0) {
        p.position.y = floor + 0.006;
        p.velocity.y *= -0.32;
        p.velocity.x *= 0.55;
        p.velocity.z *= 0.55;
        props.av.scaleInPlace(0.4);
      }
      return p;
    };
    sps.initParticles();
    sps.setParticles();
    this.shells = sps;
    this.shellCursor = 0;
    this.shellsAlive = 0;
  }

  private buildTracers(): void {
    for (const t of this.tracers) t.mesh.dispose();
    this.tracers.length = 0;
    for (let i = 0; i < this.quality.maxTracers; i++) {
      const m = MeshBuilder.CreateCylinder(`fx_tracer_${i}`, { diameter: 0.014, height: 1, tessellation: 5 }, this.scene);
      m.material = this.tracerMat;
      m.isPickable = false;
      m.isVisible = false;
      m.applyFog = false;
      m.rotationQuaternion = new Quaternion();
      this.tracers.push({ mesh: m, from: new Vector3(), dir: new Vector3(), length: 0, head: 0, speed: TRACER_SPEED, active: false });
    }
  }

  private makePuff(name: string, texture: RawTexture, sparks: boolean): ParticleSystem {
    const ps = new ParticleSystem(name, 64, this.scene);
    ps.particleTexture = texture;
    ps.emitter = new Vector3();
    ps.minEmitBox = new Vector3(-0.02, -0.02, -0.02);
    ps.maxEmitBox = new Vector3(0.02, 0.02, 0.02);
    ps.minLifeTime = sparks ? 0.15 : 0.35;
    ps.maxLifeTime = sparks ? 0.4 : 0.9;
    ps.minEmitPower = 1;
    ps.maxEmitPower = 3;
    ps.minAngularSpeed = -2;
    ps.maxAngularSpeed = 2;
    ps.gravity = new Vector3(0, sparks ? -9 : -2.5, 0);
    ps.blendMode = sparks ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 0;
    ps.manualEmitCount = 0;
    ps.addSizeGradient(0, 0.6);
    ps.addSizeGradient(0.4, 1.0);
    ps.addSizeGradient(1, sparks ? 0.2 : 1.6);
    ps.start();
    return ps;
  }

  // ---------------------------------------------------------------------------
  // Triggers
  // ---------------------------------------------------------------------------

  /** Muzzle flash at `pos` facing `dir`. First-person flashes render with the view model. */
  muzzleFlash(pos: Vector3, dir: Vector3, weaponId: WeaponId, firstPerson: boolean): void {
    const f = this.flashes.reduce((best, cur) => (cur.life <= 0 ? cur : best.life <= 0 ? best : cur.life < best.life ? cur : best));
    const size = (weaponId === 'dijla7' ? 0.28 : 0.2) * (0.85 + Math.random() * 0.3);
    f.mesh.position.copyFrom(pos).addInPlace(this.tmpA.copyFrom(dir).scaleInPlace(0.04));
    f.mesh.scaling.setAll(size);
    f.mesh.rotation.z = Math.random() * Math.PI * 2;
    f.mesh.renderingGroupId = firstPerson ? VIEWMODEL_RENDER_GROUP : 0;
    f.mesh.isVisible = true;
    f.maxLife = 0.045;
    f.life = f.maxLife;
    const light = firstPerson ? this.flashLightFp : this.flashLightWorld;
    light.position.copyFrom(pos);
    light.intensity = weaponId === 'dijla7' ? 3.2 : 2.4;
    light.setEnabled(true);
    if (firstPerson) this.flashLightFpLife = 0.05;
    else this.flashLightWorldLife = 0.05;
  }

  /** Eject a shell from `pos` with the weapon's right/up/forward basis. */
  ejectShell(pos: Vector3, right: Vector3, up: Vector3, forward: Vector3): void {
    if (!this.shells) return;
    const p = this.shells.particles[this.shellCursor];
    this.shellCursor = (this.shellCursor + 1) % this.shells.particles.length;
    if (!p.alive) this.shellsAlive++;
    p.alive = true;
    p.isVisible = true;
    p.position.copyFrom(pos);
    const vr = 1.6 + Math.random() * 0.8;
    const vu = 1.4 + Math.random() * 0.8;
    const vf = -0.3 + Math.random() * 0.4;
    p.velocity.set(
      right.x * vr + up.x * vu + forward.x * vf,
      right.y * vr + up.y * vu + forward.y * vf,
      right.z * vr + up.z * vu + forward.z * vf,
    );
    p.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    p.props = { life: SHELL_LIFE, av: new Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30) };
  }

  /** Streak travelling from `from` to `to`. */
  tracer(from: Vector3, to: Vector3): void {
    let t = this.tracers.find((x) => !x.active);
    if (!t) {
      if (!this.tracers.length) return;
      t = this.tracers.reduce((a, b) => (a.head > b.head ? a : b));
    }
    t.from.copyFrom(from);
    t.dir.copyFrom(to).subtractInPlace(from);
    t.length = t.dir.length();
    if (t.length < 0.5) {
      t.active = false;
      t.mesh.isVisible = false;
      return;
    }
    t.dir.scaleInPlace(1 / t.length);
    t.head = 0.4;
    t.active = true;
    t.mesh.isVisible = true;
    Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, t.dir, t.mesh.rotationQuaternion!);
    this.placeTracer(t);
  }

  private placeTracer(t: Tracer): void {
    const tail = Math.max(0, t.head - TRACER_STREAK);
    const head = Math.min(t.length, t.head);
    const len = head - tail;
    const mid = (head + tail) / 2;
    t.mesh.position.copyFrom(t.from).addInPlace(this.tmpA.copyFrom(t.dir).scaleInPlace(mid));
    t.mesh.scaling.set(1, Math.max(0.05, len), 1);
    t.mesh.visibility = Math.min(1, len / TRACER_STREAK);
  }

  /** Surface hit: dust/splinter/spark puff plus a bullet-hole decal on static geometry. */
  impact(point: Vector3, normal: Vector3, material: string): void {
    const style = IMPACT_STYLES[material] ?? DEFAULT_IMPACT;
    this.burst(style.sparks ? this.nextSpark() : this.nextPuff(), point, normal, style, this.quality.impactParticles);
    if (style.sparks) this.burst(this.nextPuff(), point, normal, IMPACT_STYLES.concrete, Math.ceil(this.quality.impactParticles / 3));
    if (material !== 'water' && material !== 'fabric') this.addDecal(point, normal);
  }

  /** Hit feedback on a player: a small dark red puff (no gore). */
  playerHit(point: Vector3, fromDir: Vector3): void {
    this.tmpB.copyFrom(fromDir).scaleInPlace(-1);
    this.burst(this.nextPuff(), point, this.tmpB, IMPACT_STYLES.player, Math.ceil(this.quality.impactParticles * 0.6));
  }

  private nextPuff(): ParticleSystem {
    const ps = this.puffs[this.puffCursor];
    this.puffCursor = (this.puffCursor + 1) % this.puffs.length;
    return ps;
  }

  private nextSpark(): ParticleSystem {
    const ps = this.sparks[this.sparkCursor];
    this.sparkCursor = (this.sparkCursor + 1) % this.sparks.length;
    return ps;
  }

  private burst(ps: ParticleSystem, point: Vector3, normal: Vector3, style: ImpactStyle, count: number): void {
    (ps.emitter as Vector3).copyFrom(point).addInPlace(this.tmpA.copyFrom(normal).scaleInPlace(0.02));
    ps.direction1.set(normal.x - 0.6, normal.y - 0.6, normal.z - 0.6);
    ps.direction2.set(normal.x + 0.6, normal.y + 0.6, normal.z + 0.6);
    ps.minEmitPower = style.speed * 0.4;
    ps.maxEmitPower = style.speed;
    ps.minSize = style.size * 0.6;
    ps.maxSize = style.size * 1.4;
    ps.color1 = style.color;
    ps.color2 = style.color2;
    ps.colorDead = new Color4(style.color2.r, style.color2.g, style.color2.b, 0);
    ps.manualEmitCount = count;
  }

  private addDecal(point: Vector3, normal: Vector3): void {
    const box = this.findBlockFace(point, normal);
    if (!box) return;
    this.decalSource.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
    this.decalSource.scaling.set(Math.max(0.001, box.max.x - box.min.x), Math.max(0.001, box.max.y - box.min.y), Math.max(0.001, box.max.z - box.min.z));
    this.decalSource.computeWorldMatrix(true);
    const size = 0.1 + Math.random() * 0.04;
    const decal = CreateDecal('fx_decal', this.decalSource, {
      position: point,
      normal,
      size: new Vector3(size, size, 0.12),
      angle: Math.random() * Math.PI * 2,
      localMode: false,
    });
    decal.material = this.decalMat;
    decal.isPickable = false;
    decal.receiveShadows = false;
    decal.freezeWorldMatrix();
    this.decals.push({ mesh: decal, age: 0 });
    while (this.decals.length > this.quality.maxDecals) {
      const old = this.decals.shift()!;
      old.mesh.dispose();
    }
  }

  /** Collision box whose face contains `point` with outward normal `normal`. */
  private findBlockFace(point: Vector3, normal: Vector3): WorldBox | null {
    const e = 0.03;
    this.queryBox.min.x = point.x - e; this.queryBox.min.y = point.y - e; this.queryBox.min.z = point.z - e;
    this.queryBox.max.x = point.x + e; this.queryBox.max.y = point.y + e; this.queryBox.max.z = point.z + e;
    const cands = queryBoxes(this.world, this.queryBox, this.queryOut);
    let best: WorldBox | null = null;
    let bestD = e;
    for (const b of cands) {
      // Distance from the point to the candidate's face along the normal.
      let d: number;
      if (normal.x > 0.5) d = Math.abs(point.x - b.max.x);
      else if (normal.x < -0.5) d = Math.abs(point.x - b.min.x);
      else if (normal.y > 0.5) d = Math.abs(point.y - b.max.y);
      else if (normal.y < -0.5) d = Math.abs(point.y - b.min.y);
      else if (normal.z > 0.5) d = Math.abs(point.z - b.max.z);
      else d = Math.abs(point.z - b.min.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Frame update
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) f.mesh.isVisible = false;
      else f.mesh.visibility = f.life / f.maxLife;
    }
    for (const [light, lifeKey] of [[this.flashLightFp, 'flashLightFpLife'], [this.flashLightWorld, 'flashLightWorldLife']] as const) {
      const life = this[lifeKey] - dt;
      this[lifeKey] = life;
      if (life <= 0 && light.isEnabled()) light.setEnabled(false);
      else if (life > 0) light.intensity *= 0.72;
    }
    if (this.shells && this.shellsAlive > 0) this.shells.setParticles();
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.head += t.speed * dt;
      if (t.head - TRACER_STREAK >= t.length) {
        t.active = false;
        t.mesh.isVisible = false;
        continue;
      }
      this.placeTracer(t);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += dt;
      if (d.age >= DECAL_LIFE) {
        d.mesh.dispose();
        this.decals.splice(i, 1);
      } else if (d.age > DECAL_LIFE - DECAL_FADE) {
        d.mesh.visibility = (DECAL_LIFE - d.age) / DECAL_FADE;
      }
    }
  }

  applyQuality(quality: QualityProfile): void {
    const rebuildShells = quality.maxShells !== this.quality.maxShells;
    const rebuildTracers = quality.maxTracers !== this.quality.maxTracers;
    this.quality = quality;
    if (rebuildShells) this.buildShells();
    if (rebuildTracers) this.buildTracers();
    while (this.decals.length > quality.maxDecals) this.decals.shift()!.mesh.dispose();
  }

  get activeDecals(): number {
    return this.decals.length;
  }

  get activeTracers(): number {
    return this.tracers.filter((t) => t.active).length;
  }

  dispose(): void {
    for (const d of this.decals) d.mesh.dispose();
    this.decals.length = 0;
    for (const t of this.tracers) t.mesh.dispose();
    this.tracers.length = 0;
    for (const ps of [...this.puffs, ...this.sparks]) ps.dispose(false);
    this.puffs.length = 0;
    this.sparks.length = 0;
    this.shells?.dispose();
    this.shells = null;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
