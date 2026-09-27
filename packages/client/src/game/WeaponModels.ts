/**
 * Procedural weapon models. Both weapons are original designs built from
 * boxes and cylinders with PBR materials (gun metal, polymer, wood accents).
 *
 * Weapon space: +Z is the barrel direction, +Y up, +X right; the origin sits
 * at the rear of the receiver above the grip so poses can be authored around
 * the shooter's hand.
 */
import { Color3, Mesh, MeshBuilder, PBRMaterial, TransformNode, Vector3, type Scene } from '@babylonjs/core';
import type { WeaponId } from '@tra/shared';
import { solidPbr } from './Materials';

export type WeaponDetail = 'full' | 'simple';

export interface WeaponModel {
  id: WeaponId;
  root: TransformNode;
  meshes: Mesh[];
  /** Muzzle position (child of root). */
  muzzle: TransformNode;
  /** Ejection port position (child of root). */
  ejectPort: TransformNode;
  /** Detachable magazine (animated during reloads). */
  magazine: Mesh | null;
  /** Local point that must sit on the view axis when aiming down sights. */
  sightPoint: Vector3;
  /** Local rest position of the magazine (for reload animation). */
  magazineRest: Vector3;
  dispose(): void;
}

export class WeaponMaterials {
  readonly metal: PBRMaterial;
  readonly darkMetal: PBRMaterial;
  readonly polymer: PBRMaterial;
  readonly wood: PBRMaterial;
  readonly brass: PBRMaterial;
  readonly redDot: PBRMaterial;
  readonly glass: PBRMaterial;

  constructor(scene: Scene) {
    this.metal = solidPbr(scene, 'wpn_metal', '#3a3d42', 0.42, 0.92);
    this.darkMetal = solidPbr(scene, 'wpn_darkmetal', '#24262a', 0.5, 0.9);
    this.polymer = solidPbr(scene, 'wpn_polymer', '#1d1e20', 0.72, 0.05);
    this.wood = solidPbr(scene, 'wpn_wood', '#6b4326', 0.55, 0);
    this.brass = solidPbr(scene, 'wpn_brass', '#b8923f', 0.35, 0.95);
    this.redDot = solidPbr(scene, 'wpn_reddot', '#ff2a1a', 0.3, 0, new Color3(1.6, 0.15, 0.08));
    this.glass = solidPbr(scene, 'wpn_glass', '#8fb3c8', 0.05, 0);
    this.glass.alpha = 0.35;
  }

  dispose(): void {
    for (const m of [this.metal, this.darkMetal, this.polymer, this.wood, this.brass, this.redDot, this.glass]) m.dispose(true, false);
  }
}

class Part {
  readonly meshes: Mesh[] = [];
  constructor(readonly scene: Scene, readonly root: TransformNode, readonly renderingGroupId: number) {}

  private add(m: Mesh, mat: PBRMaterial, x: number, y: number, z: number): Mesh {
    m.parent = this.root;
    m.position.set(x, y, z);
    m.material = mat;
    m.isPickable = false;
    m.renderingGroupId = this.renderingGroupId;
    m.receiveShadows = false;
    this.meshes.push(m);
    return m;
  }

  box(name: string, w: number, h: number, d: number, mat: PBRMaterial, x: number, y: number, z: number): Mesh {
    return this.add(MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene), mat, x, y, z);
  }

  /** Cylinder along +Z. */
  tube(name: string, diameter: number, length: number, mat: PBRMaterial, x: number, y: number, z: number, tessellation = 12): Mesh {
    const m = this.add(MeshBuilder.CreateCylinder(name, { diameter, height: length, tessellation }, this.scene), mat, x, y, z);
    m.rotation.x = Math.PI / 2;
    return m;
  }

  /** Cylinder along +X. */
  pin(name: string, diameter: number, length: number, mat: PBRMaterial, x: number, y: number, z: number): Mesh {
    const m = this.add(MeshBuilder.CreateCylinder(name, { diameter, height: length, tessellation: 8 }, this.scene), mat, x, y, z);
    m.rotation.z = Math.PI / 2;
    return m;
  }
}

function dijla7(scene: Scene, mats: WeaponMaterials, detail: WeaponDetail, group: number): WeaponModel {
  const root = new TransformNode('wpn_dijla7', scene);
  const p = new Part(scene, root, group);
  const full = detail === 'full';
  // Receiver and upper rail.
  p.box('receiver', 0.07, 0.085, 0.32, mats.metal, 0, 0.02, 0.1);
  p.box('rail', 0.03, 0.02, 0.3, mats.darkMetal, 0, 0.072, 0.1);
  // Handguard with wood panels and vent slots.
  p.box('handguard', 0.062, 0.07, 0.28, mats.wood, 0, 0.015, 0.42);
  p.box('handguard_top', 0.05, 0.03, 0.28, mats.metal, 0, 0.062, 0.42);
  if (full) {
    for (let i = 0; i < 5; i++) p.box(`vent${i}`, 0.066, 0.012, 0.03, mats.darkMetal, 0, 0.035, 0.31 + i * 0.05);
    p.box('gas_block', 0.03, 0.045, 0.04, mats.darkMetal, 0, 0.05, 0.6);
  }
  // Barrel and muzzle brake.
  p.tube('barrel', 0.022, 0.32, mats.darkMetal, 0, 0.03, 0.72);
  p.tube('brake', 0.034, 0.07, mats.metal, 0, 0.03, 0.9);
  if (full) p.box('front_sight', 0.008, 0.05, 0.008, mats.darkMetal, 0, 0.075, 0.62);
  // Magazine: two boxes to suggest the curve.
  const mag = p.box('magazine', 0.05, 0.13, 0.075, mats.polymer, 0, -0.085, 0.16);
  const magLower = MeshBuilder.CreateBox('magazine_lower', { width: 0.05, height: 0.1, depth: 0.075 }, scene);
  magLower.parent = mag;
  magLower.position.set(0, -0.1, 0.02);
  magLower.rotation.x = -0.25;
  magLower.material = mats.polymer;
  magLower.renderingGroupId = group;
  magLower.isPickable = false;
  p.meshes.push(magLower);
  // Grip, trigger guard, stock.
  const grip = p.box('grip', 0.035, 0.11, 0.05, mats.polymer, 0, -0.07, -0.03);
  grip.rotation.x = 0.3;
  if (full) p.box('trigger_guard', 0.01, 0.01, 0.07, mats.darkMetal, 0, -0.045, 0.06);
  p.box('stock', 0.045, 0.06, 0.26, mats.wood, 0, 0.005, -0.19);
  p.box('butt', 0.05, 0.11, 0.03, mats.polymer, 0, 0, -0.33);
  if (full) {
    // Charging handle and ejection port.
    p.pin('charging', 0.012, 0.04, mats.darkMetal, 0.05, 0.045, 0.02);
    p.box('eject_port', 0.002, 0.03, 0.06, mats.darkMetal, 0.036, 0.03, 0.12);
    // Reflex-style sight hood with a red dot behind a small glass.
    p.box('hood_l', 0.004, 0.035, 0.05, mats.darkMetal, -0.016, 0.1, 0.05);
    p.box('hood_r', 0.004, 0.035, 0.05, mats.darkMetal, 0.016, 0.1, 0.05);
    p.box('hood_top', 0.036, 0.004, 0.05, mats.darkMetal, 0, 0.119, 0.05);
    p.box('hood_base', 0.03, 0.012, 0.05, mats.darkMetal, 0, 0.088, 0.05);
    const glass = p.box('sight_glass', 0.026, 0.026, 0.002, mats.glass, 0, 0.102, 0.07);
    glass.receiveShadows = false;
    p.box('reticle', 0.003, 0.003, 0.002, mats.redDot, 0, 0.102, 0.06);
    p.box('rear_iron', 0.02, 0.012, 0.006, mats.darkMetal, 0, 0.09, -0.02);
  }
  const muzzle = new TransformNode('muzzle', scene);
  muzzle.parent = root;
  muzzle.position.set(0, 0.03, 0.94);
  const eject = new TransformNode('eject', scene);
  eject.parent = root;
  eject.position.set(0.045, 0.035, 0.12);
  return {
    id: 'dijla7',
    root,
    meshes: p.meshes,
    muzzle,
    ejectPort: eject,
    magazine: mag,
    magazineRest: mag.position.clone(),
    sightPoint: new Vector3(0, 0.102, 0.05),
    dispose: () => root.dispose(false, false),
  };
}

function shatt9(scene: Scene, mats: WeaponMaterials, detail: WeaponDetail, group: number): WeaponModel {
  const root = new TransformNode('wpn_shatt9', scene);
  const p = new Part(scene, root, group);
  const full = detail === 'full';
  p.box('receiver', 0.06, 0.075, 0.24, mats.metal, 0, 0.02, 0.06);
  p.box('upper', 0.04, 0.02, 0.22, mats.darkMetal, 0, 0.065, 0.06);
  // Barrel shroud with cooling holes and a stubby barrel.
  const shroud = p.tube('shroud', 0.046, 0.17, mats.darkMetal, 0, 0.03, 0.26);
  if (full) {
    for (let i = 0; i < 4; i++) {
      const hole = p.tube(`hole${i}`, 0.05, 0.012, mats.polymer, 0, 0.03, 0.2 + i * 0.04, 10);
      hole.scaling.set(0.9, 0.9, 1);
    }
  }
  void shroud;
  p.tube('barrel', 0.018, 0.1, mats.darkMetal, 0, 0.03, 0.4);
  p.box('front_sight', 0.008, 0.04, 0.008, mats.darkMetal, 0, 0.065, 0.33);
  // Straight magazine ahead of the grip.
  const mag = p.box('magazine', 0.032, 0.22, 0.055, mats.polymer, 0, -0.12, 0.09);
  p.box('mag_well', 0.04, 0.03, 0.065, mats.metal, 0, -0.03, 0.09);
  // Grip and trigger guard.
  const grip = p.box('grip', 0.032, 0.1, 0.045, mats.polymer, 0, -0.06, -0.05);
  grip.rotation.x = 0.28;
  if (full) p.box('trigger_guard', 0.01, 0.01, 0.06, mats.darkMetal, 0, -0.04, 0.02);
  // Side-folding stock (folded along the right side) and butt plate.
  p.pin('stock_hinge', 0.014, 0.02, mats.darkMetal, 0.04, 0.02, -0.05);
  const stockA = p.box('stock_bar', 0.012, 0.012, 0.24, mats.metal, 0.045, 0.035, -0.17);
  const stockB = p.box('stock_bar2', 0.012, 0.012, 0.24, mats.metal, 0.045, 0.0, -0.17);
  void stockA;
  void stockB;
  p.box('butt_plate', 0.014, 0.07, 0.03, mats.polymer, 0.045, 0.017, -0.3);
  if (full) {
    // Left-side charging handle.
    p.pin('charging', 0.014, 0.04, mats.darkMetal, -0.05, 0.04, 0.1);
    p.box('charging_slot', 0.002, 0.008, 0.08, mats.polymer, -0.031, 0.04, 0.08);
    p.box('eject_port', 0.002, 0.025, 0.05, mats.darkMetal, 0.031, 0.03, 0.08);
    // Rear sight: notch plate.
    p.box('rear_sight', 0.024, 0.014, 0.004, mats.darkMetal, 0, 0.082, -0.04);
    p.box('rear_notch_l', 0.006, 0.01, 0.004, mats.darkMetal, -0.009, 0.092, -0.04);
    p.box('rear_notch_r', 0.006, 0.01, 0.004, mats.darkMetal, 0.009, 0.092, -0.04);
    p.box('safety', 0.004, 0.01, 0.02, mats.brass, -0.032, 0.0, -0.02);
  }
  const muzzle = new TransformNode('muzzle', scene);
  muzzle.parent = root;
  muzzle.position.set(0, 0.03, 0.46);
  const eject = new TransformNode('eject', scene);
  eject.parent = root;
  eject.position.set(0.04, 0.035, 0.08);
  return {
    id: 'shatt9',
    root,
    meshes: p.meshes,
    muzzle,
    ejectPort: eject,
    magazine: mag,
    magazineRest: mag.position.clone(),
    sightPoint: new Vector3(0, 0.087, -0.04),
    dispose: () => root.dispose(false, false),
  };
}

/** Build a weapon model. `renderingGroupId` lets the view model use its own depth range. */
export function buildWeaponModel(scene: Scene, id: WeaponId, mats: WeaponMaterials, detail: WeaponDetail, renderingGroupId = 0): WeaponModel {
  return id === 'dijla7' ? dijla7(scene, mats, detail, renderingGroupId) : shatt9(scene, mats, detail, renderingGroupId);
}
