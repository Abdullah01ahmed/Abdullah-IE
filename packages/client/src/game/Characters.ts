/**
 * Procedural humanoid characters (~1.8 m) with team uniforms:
 *  - Tigris: deep teal/blue uniform, sand webbing, helmet + shemagh silhouette.
 *  - Euphrates: rust/orange-brown uniform, olive vest, cap + sleeve badges.
 * Both read clearly against the warm map palette. The rig exposes joints so
 * RemotePlayers can animate locomotion, stance, aim and death procedurally.
 */
import { Mesh, MeshBuilder, PBRMaterial, TransformNode, type Scene } from '@babylonjs/core';
import type { Team } from '@tra/shared';
import { solidPbr } from './Materials';

export interface TeamMaterials {
  uniform: PBRMaterial;
  accent: PBRMaterial;
  headgear: PBRMaterial;
  cloth: PBRMaterial;
  skin: PBRMaterial;
  boots: PBRMaterial;
  gloves: PBRMaterial;
  badge: PBRMaterial;
}

export class CharacterMaterials {
  readonly tigris: TeamMaterials;
  readonly euphrates: TeamMaterials;
  private readonly all: PBRMaterial[] = [];

  constructor(scene: Scene) {
    const mk = (name: string, color: string, rough: number, metal = 0) => {
      const m = solidPbr(scene, `char_${name}`, color, rough, metal);
      this.all.push(m);
      return m;
    };
    this.tigris = {
      uniform: mk('t_uniform', '#1e4f5c', 0.85),
      accent: mk('t_webbing', '#b9a16e', 0.9),
      headgear: mk('t_helmet', '#24363b', 0.6),
      cloth: mk('t_shemagh', '#d9d1bd', 0.95),
      skin: mk('t_skin', '#8d6a4a', 0.7),
      boots: mk('t_boots', '#2a221c', 0.6),
      gloves: mk('t_gloves', '#33393b', 0.8),
      badge: mk('t_badge', '#e8dfc6', 0.7),
    };
    this.euphrates = {
      uniform: mk('e_uniform', '#9a4a26', 0.85),
      accent: mk('e_vest', '#55603a', 0.9),
      headgear: mk('e_cap', '#3f3325', 0.7),
      cloth: mk('e_cloth', '#c9b08a', 0.95),
      skin: mk('e_skin', '#7a5a40', 0.7),
      boots: mk('e_boots', '#2a221c', 0.6),
      gloves: mk('e_gloves', '#3a2e24', 0.8),
      badge: mk('e_badge', '#e0c060', 0.5, 0.3),
    };
  }

  for(team: Team): TeamMaterials {
    return team === 'tigris' ? this.tigris : this.euphrates;
  }

  dispose(): void {
    for (const m of this.all) m.dispose(true, false);
    this.all.length = 0;
  }
}

export interface Limb {
  /** Joint node (rotate this). */
  joint: TransformNode;
  /** Second joint (elbow/knee). */
  lower: TransformNode;
}

export interface CharacterRig {
  root: TransformNode;
  /** Hips: vertical offset for crouch/slide. */
  hips: TransformNode;
  torso: TransformNode;
  head: TransformNode;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  /** Attachment for the weapon (right hand). */
  handR: TransformNode;
  meshes: Mesh[];
  dispose(): void;
}

export const CHARACTER_HEIGHT = 1.8;
const HIP_Y = 0.92;
const UPPER_LEG = 0.44;
const LOWER_LEG = 0.44;
const TORSO_H = 0.52;
const UPPER_ARM = 0.28;
const LOWER_ARM = 0.27;

function capsule(scene: Scene, name: string, radius: number, length: number, mat: PBRMaterial, parent: TransformNode, meshes: Mesh[]): Mesh {
  const m = MeshBuilder.CreateCapsule(name, { radius, height: length, tessellation: 8, subdivisions: 1, capSubdivisions: 3 }, scene);
  m.parent = parent;
  // Hang from the joint: capsule centre sits half a length below the joint.
  m.position.y = -length / 2;
  m.material = mat;
  m.isPickable = false;
  meshes.push(m);
  return m;
}

function box(scene: Scene, name: string, w: number, h: number, d: number, mat: PBRMaterial, parent: TransformNode, meshes: Mesh[], x = 0, y = 0, z = 0): Mesh {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.parent = parent;
  m.position.set(x, y, z);
  m.material = mat;
  m.isPickable = false;
  meshes.push(m);
  return m;
}

function limb(scene: Scene, name: string, parent: TransformNode, x: number, y: number, z: number, upperLen: number, lowerLen: number, radius: number, upperMat: PBRMaterial, lowerMat: PBRMaterial, meshes: Mesh[]): Limb {
  const joint = new TransformNode(`${name}_joint`, scene);
  joint.parent = parent;
  joint.position.set(x, y, z);
  capsule(scene, `${name}_upper`, radius, upperLen, upperMat, joint, meshes);
  const lower = new TransformNode(`${name}_lower`, scene);
  lower.parent = joint;
  lower.position.y = -upperLen;
  capsule(scene, `${name}_lower`, radius * 0.85, lowerLen, lowerMat, lower, meshes);
  return { joint, lower };
}

/** Build a character facing +Z with its feet at the root origin. */
export function buildCharacter(scene: Scene, team: Team, mats: CharacterMaterials, name: string): CharacterRig {
  const m = mats.for(team);
  const meshes: Mesh[] = [];
  const root = new TransformNode(`char_${name}`, scene);
  const hips = new TransformNode('hips', scene);
  hips.parent = root;
  hips.position.y = HIP_Y;

  // Legs hang from the hips.
  const legL = limb(scene, 'legL', hips, -0.11, 0, 0, UPPER_LEG, LOWER_LEG, 0.075, m.uniform, m.uniform, meshes);
  const legR = limb(scene, 'legR', hips, 0.11, 0, 0, UPPER_LEG, LOWER_LEG, 0.075, m.uniform, m.uniform, meshes);
  for (const l of [legL, legR]) box(scene, 'boot', 0.11, 0.08, 0.24, m.boots, l.lower, meshes, 0, -LOWER_LEG - 0.02, 0.04);

  // Torso above the hips.
  const torso = new TransformNode('torso', scene);
  torso.parent = hips;
  torso.position.y = 0.02;
  box(scene, 'pelvis', 0.34, 0.16, 0.22, m.uniform, torso, meshes, 0, 0.06, 0);
  box(scene, 'chest', 0.4, TORSO_H - 0.1, 0.24, m.uniform, torso, meshes, 0, 0.14 + (TORSO_H - 0.1) / 2, 0);
  if (team === 'tigris') {
    // Sand webbing: chest rig and belt.
    box(scene, 'rig', 0.3, 0.2, 0.27, m.accent, torso, meshes, 0, 0.38, 0);
    box(scene, 'belt', 0.42, 0.06, 0.26, m.accent, torso, meshes, 0, 0.14, 0);
    for (let i = 0; i < 3; i++) box(scene, `pouch${i}`, 0.07, 0.09, 0.05, m.accent, torso, meshes, -0.1 + i * 0.1, 0.4, 0.145);
  } else {
    // Olive vest over the uniform.
    box(scene, 'vest', 0.42, 0.34, 0.27, m.accent, torso, meshes, 0, 0.36, 0);
    box(scene, 'pouch_l', 0.1, 0.1, 0.05, m.accent, torso, meshes, -0.09, 0.28, 0.15);
    box(scene, 'pouch_r', 0.1, 0.1, 0.05, m.accent, torso, meshes, 0.09, 0.28, 0.15);
  }
  // Shoulders and arms.
  const shoulderY = 0.14 + TORSO_H - 0.1 - 0.03;
  const armL = limb(scene, 'armL', torso, -0.25, shoulderY, 0, UPPER_ARM, LOWER_ARM, 0.055, m.uniform, m.uniform, meshes);
  const armR = limb(scene, 'armR', torso, 0.25, shoulderY, 0, UPPER_ARM, LOWER_ARM, 0.055, m.uniform, m.uniform, meshes);
  for (const a of [armL, armR]) {
    box(scene, 'glove', 0.08, 0.09, 0.09, m.gloves, a.lower, meshes, 0, -LOWER_ARM - 0.02, 0);
    if (team === 'euphrates') box(scene, 'badge', 0.02, 0.07, 0.07, m.badge, a.joint, meshes, a === armL ? -0.05 : 0.05, -0.1, 0);
  }
  const handR = new TransformNode('handR', scene);
  handR.parent = armR.lower;
  handR.position.set(0, -LOWER_ARM - 0.02, 0.04);

  // Head and headgear.
  const neckY = shoulderY + 0.06;
  const head = new TransformNode('head', scene);
  head.parent = torso;
  head.position.y = neckY;
  const skull = MeshBuilder.CreateSphere('skull', { diameter: 0.23, segments: 10 }, scene);
  skull.parent = head;
  skull.position.y = 0.14;
  skull.scaling.set(0.92, 1.05, 1);
  skull.material = m.skin;
  skull.isPickable = false;
  meshes.push(skull);
  if (team === 'tigris') {
    // Helmet: a flattened dome sitting on the skull, plus a shemagh around the neck/back.
    const helmet = MeshBuilder.CreateSphere('helmet', { diameter: 0.29, segments: 10, slice: 0.58 }, scene);
    helmet.parent = head;
    helmet.position.y = 0.16;
    helmet.scaling.set(1, 0.85, 1.05);
    helmet.material = m.headgear;
    helmet.isPickable = false;
    meshes.push(helmet);
    box(scene, 'brim', 0.3, 0.02, 0.32, m.headgear, head, meshes, 0, 0.13, 0.02);
    const shemagh = MeshBuilder.CreateTorus('shemagh', { diameter: 0.28, thickness: 0.09, tessellation: 12 }, scene);
    shemagh.parent = head;
    shemagh.position.y = 0.02;
    shemagh.material = m.cloth;
    shemagh.isPickable = false;
    meshes.push(shemagh);
    box(scene, 'shemagh_tail', 0.26, 0.28, 0.04, m.cloth, head, meshes, 0, -0.1, -0.15);
  } else {
    // Field cap with a visor; a light scarf tucked at the neck.
    const cap = MeshBuilder.CreateCylinder('cap', { diameter: 0.25, height: 0.09, tessellation: 12 }, scene);
    cap.parent = head;
    cap.position.y = 0.23;
    cap.material = m.headgear;
    cap.isPickable = false;
    meshes.push(cap);
    box(scene, 'visor', 0.2, 0.015, 0.12, m.headgear, head, meshes, 0, 0.19, 0.16);
    box(scene, 'scarf', 0.3, 0.06, 0.28, m.cloth, head, meshes, 0, 0.0, 0);
  }

  for (const mesh of meshes) mesh.receiveShadows = true;
  return {
    root,
    hips,
    torso,
    head,
    armL,
    armR,
    legL,
    legR,
    handR,
    meshes,
    dispose: () => root.dispose(false, false),
  };
}

/** Reset every joint to the rest pose. */
export function resetPose(rig: CharacterRig): void {
  for (const l of [rig.armL, rig.armR, rig.legL, rig.legR]) {
    l.joint.rotation.setAll(0);
    l.lower.rotation.setAll(0);
  }
  rig.torso.rotation.setAll(0);
  rig.head.rotation.setAll(0);
  rig.hips.position.set(0, HIP_Y, 0);
  rig.root.rotation.setAll(0);
  rig.root.position.y = 0;
}

export const HIPS_REST_Y = HIP_Y;
