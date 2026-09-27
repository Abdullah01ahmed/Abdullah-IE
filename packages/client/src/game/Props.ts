/**
 * Procedural prop meshes for the Old Baghdad set: palms, lanterns, tea-house
 * furniture, market clutter, rooftop hardware, shanasheel bays, signs…
 * Every prop is built from primitives with PBR materials (solid colours from a
 * shared palette or textured map materials) so nothing needs an asset file.
 *
 * A prop build returns a root TransformNode; the map renderer instances
 * repeated props from the first build of each kind.
 */
import {
  Color3,
  Material,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  Quaternion,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  Vector4,
  type Scene,
} from '@babylonjs/core';
import type { MaterialId, PropKind } from '@tra/shared';
import { MATERIAL_SPECS, MaterialLibrary, createRawRgbaTexture, solidPbr } from './Materials';
import { createTextTexture, ensureFonts } from './TextTexture';
import { generateFrond } from './textures';

export interface PropBuild {
  root: TransformNode;
  /** Real meshes created (shadow casters / instancing sources). */
  meshes: Mesh[];
  /** Dynamic lights owned by the prop (lanterns). */
  lights: PointLight[];
}

export interface PropRequest {
  kind: PropKind;
  text?: string;
  tint?: [number, number, number];
}

/** Map materials a prop kind draws from (prepared before building). */
export const PROP_MATERIALS: Partial<Record<PropKind, MaterialId[]>> = {
  crate: ['wood'],
  table: ['wood'],
  chair: ['wood'],
  bench: ['wood'],
  door: ['wood'],
  window: ['wood', 'lattice'],
  shanasheel: ['wood', 'lattice'],
  rug: ['fabric'],
  awning: ['fabric'],
  cloth_line: ['fabric'],
  fountain: ['tile', 'water', 'stone'],
  water_tank: ['metal'],
  ac_unit: ['metal'],
  barrel: ['metal', 'wood'],
  sign: ['wood'],
};

/** Shared solid materials for props (one set per scene/match). */
export class PropPalette {
  readonly darkWood: PBRMaterial;
  readonly wood: PBRMaterial;
  readonly brass: PBRMaterial;
  readonly iron: PBRMaterial;
  readonly paintedMetal: PBRMaterial;
  readonly rust: PBRMaterial;
  readonly terracotta: PBRMaterial;
  readonly burlap: PBRMaterial;
  readonly clothWhite: PBRMaterial;
  readonly clothRed: PBRMaterial;
  readonly clothBlue: PBRMaterial;
  readonly clothGreen: PBRMaterial;
  readonly rope: PBRMaterial;
  readonly lanternGlass: PBRMaterial;
  readonly plastic: PBRMaterial;
  readonly palmTrunk: PBRMaterial;
  readonly frond: PBRMaterial;
  readonly rubber: PBRMaterial;
  readonly stoneLight: PBRMaterial;
  readonly tigris: PBRMaterial;
  readonly euphrates: PBRMaterial;
  readonly waterFallback: PBRMaterial;
  private readonly tinted = new Map<string, PBRMaterial>();
  private readonly all: Material[] = [];
  private readonly textures: Texture[] = [];

  constructor(private readonly scene: Scene) {
    const mk = (name: string, color: string, rough: number, metal = 0, emissive?: Color3): PBRMaterial => {
      const m = solidPbr(scene, `prop_${name}`, color, rough, metal, emissive);
      this.all.push(m);
      return m;
    };
    this.darkWood = mk('darkWood', '#4a3220', 0.65);
    this.wood = mk('wood', '#7a5230', 0.6);
    this.brass = mk('brass', '#b08d47', 0.35, 0.9);
    this.iron = mk('iron', '#3b3b3d', 0.5, 0.85);
    this.paintedMetal = mk('paintedMetal', '#6f7f82', 0.5, 0.6);
    this.rust = mk('rust', '#7a4a2c', 0.85, 0.4);
    this.terracotta = mk('terracotta', '#a8623a', 0.85);
    this.burlap = mk('burlap', '#b39a6e', 0.95);
    this.clothWhite = mk('clothWhite', '#e8dfcc', 0.9);
    this.clothRed = mk('clothRed', '#9b3a2f', 0.9);
    this.clothBlue = mk('clothBlue', '#2d5f8a', 0.9);
    this.clothGreen = mk('clothGreen', '#4d7a3c', 0.9);
    this.rope = mk('rope', '#a89468', 0.95);
    this.lanternGlass = mk('lanternGlass', '#ffd9a0', 0.3, 0, new Color3(1.0, 0.55, 0.2).scale(1.6));
    this.plastic = mk('plastic', '#d9d6cc', 0.55);
    this.palmTrunk = mk('palmTrunk', '#6b5236', 0.9);
    this.rubber = mk('rubber', '#1e1e1e', 0.9);
    this.stoneLight = mk('stoneLight', '#bdb09a', 0.8);
    this.tigris = mk('tigris', '#1f5f6b', 0.85);
    this.euphrates = mk('euphrates', '#b4562a', 0.85);
    this.waterFallback = mk('water', '#2a5a66', 0.1);
    this.waterFallback.alpha = 0.85;

    const frondTex = createRawRgbaTexture(scene, 'prop_frond', generateFrond(64, 256), 64, 256, { mips: true, clamp: true });
    frondTex.hasAlpha = true;
    this.textures.push(frondTex);
    this.frond = new PBRMaterial('prop_frond', scene);
    this.frond.albedoTexture = frondTex;
    this.frond.useAlphaFromAlbedoTexture = true;
    this.frond.transparencyMode = Material.MATERIAL_ALPHATEST;
    this.frond.alphaCutOff = 0.5;
    this.frond.backFaceCulling = false;
    this.frond.twoSidedLighting = true;
    this.frond.roughness = 0.75;
    this.frond.metallic = 0;
    this.frond.maxSimultaneousLights = 8;
    this.all.push(this.frond);
  }

  /** Solid material for an arbitrary tint (cached). */
  tintedCloth(tint: [number, number, number]): PBRMaterial {
    const key = tint.join(',');
    let m = this.tinted.get(key);
    if (!m) {
      m = solidPbr(this.scene, `prop_tint_${key}`, new Color3(tint[0], tint[1], tint[2]), 0.9);
      this.tinted.set(key, m);
      this.all.push(m);
    }
    return m;
  }

  dispose(): void {
    for (const m of this.all) m.dispose(true, false);
    for (const t of this.textures) t.dispose();
    this.all.length = 0;
    this.tinted.clear();
  }
}

export interface PropContext {
  scene: Scene;
  palette: PropPalette;
  materials: MaterialLibrary;
  /** Materials created for a single prop (sign text) are registered here for disposal. */
  ownedMaterials: Material[];
  ownedTextures: Texture[];
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

class Builder {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  readonly lights: PointLight[] = [];

  constructor(readonly ctx: PropContext, name: string) {
    this.root = new TransformNode(`prop_${name}`, ctx.scene);
  }

  private add(mesh: Mesh, mat: Material | null, x: number, y: number, z: number): Mesh {
    mesh.parent = this.root;
    mesh.position.set(x, y, z);
    if (mat) mesh.material = mat;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    this.meshes.push(mesh);
    return mesh;
  }

  box(name: string, w: number, h: number, d: number, mat: Material | null, x = 0, y = 0, z = 0): Mesh {
    return this.add(MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.ctx.scene), mat, x, y, z);
  }

  /** Box textured with a tiling map material (UVs in metres). */
  texBox(name: string, w: number, h: number, d: number, matId: MaterialId, x = 0, y = 0, z = 0, fallback?: Material): Mesh {
    const mat = this.ctx.materials.get(matId) ?? fallback ?? this.ctx.palette.wood;
    const s = MATERIAL_SPECS[matId].uvScale;
    // Babylon box face order: +Z, -Z, +X, -X, +Y, -Y.
    const faceUV = [
      new Vector4(0, 0, w * s, h * s),
      new Vector4(0, 0, w * s, h * s),
      new Vector4(0, 0, d * s, h * s),
      new Vector4(0, 0, d * s, h * s),
      new Vector4(0, 0, w * s, d * s),
      new Vector4(0, 0, w * s, d * s),
    ];
    return this.add(MeshBuilder.CreateBox(name, { width: w, height: h, depth: d, faceUV }, this.ctx.scene), mat, x, y, z);
  }

  cylinder(name: string, diameterTop: number, diameterBottom: number, height: number, mat: Material | null, x = 0, y = 0, z = 0, tessellation = 16): Mesh {
    return this.add(MeshBuilder.CreateCylinder(name, { diameterTop, diameterBottom, height, tessellation }, this.ctx.scene), mat, x, y, z);
  }

  sphere(name: string, diameter: number, mat: Material | null, x = 0, y = 0, z = 0, segments = 12): Mesh {
    return this.add(MeshBuilder.CreateSphere(name, { diameter, segments }, this.ctx.scene), mat, x, y, z);
  }

  torus(name: string, diameter: number, thickness: number, mat: Material | null, x = 0, y = 0, z = 0, tessellation = 24): Mesh {
    return this.add(MeshBuilder.CreateTorus(name, { diameter, thickness, tessellation }, this.ctx.scene), mat, x, y, z);
  }

  plane(name: string, w: number, h: number, mat: Material | null, x = 0, y = 0, z = 0, doubleSided = true): Mesh {
    const m = this.add(MeshBuilder.CreatePlane(name, { width: w, height: h, sideOrientation: doubleSided ? Mesh.DOUBLESIDE : Mesh.FRONTSIDE }, this.ctx.scene), mat, x, y, z);
    return m;
  }

  /** Thin cylinder from a to b (poles, bars, rope). */
  bar(name: string, a: Vector3, b: Vector3, diameter: number, mat: Material | null, tessellation = 8): Mesh {
    const len = Vector3.Distance(a, b);
    const mid = a.add(b).scale(0.5);
    const m = this.add(MeshBuilder.CreateCylinder(name, { diameter, height: len, tessellation }, this.ctx.scene), mat, mid.x, mid.y, mid.z);
    const dir = b.subtract(a).normalize();
    // Cylinder axis is +Y; rotate it onto dir.
    m.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, new Quaternion());
    return m;
  }

  light(name: string, x: number, y: number, z: number, color: Color3, intensity: number, range: number): PointLight {
    const l = new PointLight(name, new Vector3(x, y, z), this.ctx.scene);
    l.parent = this.root;
    l.diffuse = color;
    l.specular = color.scale(0.6);
    l.intensity = intensity;
    l.range = range;
    l.shadowEnabled = false;
    this.lights.push(l);
    return l;
  }

  finish(): PropBuild {
    return { root: this.root, meshes: this.meshes, lights: this.lights };
  }
}

// ---------------------------------------------------------------------------
// Prop kinds
// ---------------------------------------------------------------------------

function palm(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'palm');
  const p = ctx.palette;
  // Tapered, slightly leaning trunk in segments with ring bulges.
  const segments = 5;
  const segH = 1.15;
  let x = 0, z = 0;
  for (let i = 0; i < segments; i++) {
    const y = i * segH + segH / 2;
    x += 0.04 * i;
    z += 0.02;
    const dBottom = 0.42 - i * 0.045;
    const dTop = dBottom - 0.04;
    const seg = b.cylinder(`trunk${i}`, dTop, dBottom, segH, p.palmTrunk, x, y, z, 10);
    seg.rotation.z = -0.03 * i;
    b.torus(`ring${i}`, dBottom * 1.05, 0.05, p.palmTrunk, x, y - segH * 0.3, z, 10);
  }
  const top = new Vector3(x + 0.1, segments * segH, z);
  b.sphere('crown', 0.5, p.palmTrunk, top.x, top.y - 0.15, top.z, 8);
  // Fronds: alpha planes radiating out and drooping.
  const count = 11;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + (i % 2) * 0.15;
    const droop = 0.55 + (i % 3) * 0.18;
    const len = 2.6 + (i % 2) * 0.4;
    const f = b.plane(`frond${i}`, 0.7, len, p.frond, top.x, top.y, top.z);
    f.position.addInPlace(new Vector3(Math.sin(ang) * 0.25, 0.1, Math.cos(ang) * 0.25));
    f.rotationQuaternion = Quaternion.RotationYawPitchRoll(ang, -(Math.PI / 2 - droop), 0);
    // The plane is centred on its origin: shift it half a length along its own
    // up axis so the base sits at the crown.
    const along = new Vector3(0, len / 2, 0);
    along.rotateByQuaternionToRef(f.rotationQuaternion, along);
    f.position.addInPlace(along);
    f.receiveShadows = false;
  }
  return b.finish();
}

function lantern(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'lantern');
  const p = ctx.palette;
  b.cylinder('base', 0.2, 0.24, 0.04, p.brass, 0, 0.02, 0, 8);
  b.cylinder('glass', 0.16, 0.16, 0.3, p.lanternGlass, 0, 0.21, 0, 8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.bar(`rib${i}`, new Vector3(Math.sin(a) * 0.09, 0.04, Math.cos(a) * 0.09), new Vector3(Math.sin(a) * 0.09, 0.38, Math.cos(a) * 0.09), 0.012, p.brass, 6);
  }
  b.cylinder('cap', 0.05, 0.24, 0.08, p.brass, 0, 0.4, 0, 8);
  b.torus('ring', 0.08, 0.012, p.brass, 0, 0.48, 0, 12).rotation.x = Math.PI / 2;
  b.light('lantern_light', 0, 0.22, 0, new Color3(1.0, 0.62, 0.3), 2.2, 6);
  return b.finish();
}

function table(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'table');
  const p = ctx.palette;
  b.cylinder('top', 0.9, 0.9, 0.05, ctx.materials.get('wood') ?? p.wood, 0, 0.73, 0, 20);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.cylinder(`leg${i}`, 0.05, 0.05, 0.7, p.darkWood, Math.sin(a) * 0.32, 0.35, Math.cos(a) * 0.32, 8);
  }
  b.torus('brace', 0.6, 0.025, p.darkWood, 0, 0.25, 0, 16);
  // Tea glasses on the table.
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    b.cylinder(`glass${i}`, 0.05, 0.035, 0.09, p.plastic, Math.sin(a) * 0.22, 0.8, Math.cos(a) * 0.22, 8);
  }
  return b.finish();
}

function chair(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'chair');
  const p = ctx.palette;
  const seatMat = ctx.materials.get('wood') ?? p.wood;
  b.box('seat', 0.44, 0.04, 0.44, seatMat, 0, 0.45, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.cylinder(`leg${sx}${sz}`, 0.035, 0.035, 0.45, p.darkWood, sx * 0.19, 0.225, sz * 0.19, 8);
  }
  b.cylinder('post0', 0.035, 0.035, 0.45, p.darkWood, -0.19, 0.69, -0.2, 8);
  b.cylinder('post1', 0.035, 0.035, 0.45, p.darkWood, 0.19, 0.69, -0.2, 8);
  b.box('back', 0.4, 0.1, 0.03, seatMat, 0, 0.84, -0.2);
  b.box('back2', 0.4, 0.06, 0.03, seatMat, 0, 0.66, -0.2);
  // Woven rush seat hint.
  b.box('rush', 0.38, 0.015, 0.38, p.burlap, 0, 0.475, 0);
  return b.finish();
}

function bench(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'bench');
  const p = ctx.palette;
  b.texBox('plank', 1.8, 0.06, 0.4, 'wood', 0, 0.47, 0);
  b.box('support0', 0.08, 0.44, 0.36, p.darkWood, -0.7, 0.22, 0);
  b.box('support1', 0.08, 0.44, 0.36, p.darkWood, 0.7, 0.22, 0);
  b.box('rail', 1.5, 0.05, 0.05, p.darkWood, 0, 0.2, 0);
  return b.finish();
}

function crate(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'crate');
  const p = ctx.palette;
  b.texBox('body', 0.96, 0.96, 0.96, 'wood', 0, 0.48, 0);
  // Edge battens.
  const t = 0.05;
  for (const [x, z] of [[-0.48, -0.48], [0.48, -0.48], [-0.48, 0.48], [0.48, 0.48]]) b.box(`bat${x}${z}`, t, 1.0, t, p.darkWood, x, 0.5, z);
  for (const y of [0.03, 0.97]) {
    b.box(`bx${y}`, 1.0, t, t, p.darkWood, 0, y, -0.48);
    b.box(`bx2${y}`, 1.0, t, t, p.darkWood, 0, y, 0.48);
    b.box(`bz${y}`, t, t, 1.0, p.darkWood, -0.48, y, 0);
    b.box(`bz2${y}`, t, t, 1.0, p.darkWood, 0.48, y, 0);
  }
  return b.finish();
}

function barrel(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'barrel');
  const p = ctx.palette;
  b.cylinder('body', 0.6, 0.6, 0.95, ctx.materials.get('metal') ?? p.paintedMetal, 0, 0.475, 0, 18);
  for (const y of [0.2, 0.5, 0.8]) b.torus(`hoop${y}`, 0.62, 0.03, p.rust, 0, y, 0, 18);
  b.cylinder('lid', 0.56, 0.56, 0.02, p.rust, 0, 0.96, 0, 18);
  return b.finish();
}

function sacks(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'sacks');
  const p = ctx.palette;
  const s0 = b.sphere('sack0', 0.8, p.burlap, -0.25, 0.28, -0.15, 10);
  s0.scaling.set(1.1, 0.7, 1);
  const s1 = b.sphere('sack1', 0.8, p.burlap, 0.3, 0.26, 0.2, 10);
  s1.scaling.set(1, 0.65, 1.15);
  const s2 = b.sphere('sack2', 0.75, p.burlap, 0.02, 0.62, 0, 10);
  s2.scaling.set(1.05, 0.62, 1);
  s2.rotation.y = 0.6;
  for (const s of [s0, s1, s2]) b.torus(`tie_${s.name}`, 0.12, 0.02, p.rope, s.position.x, s.position.y + 0.26, s.position.z, 8);
  return b.finish();
}

function pot(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'pot');
  const p = ctx.palette;
  b.cylinder('foot', 0.3, 0.26, 0.08, p.terracotta, 0, 0.04, 0, 14);
  b.cylinder('belly_lo', 0.58, 0.3, 0.26, p.terracotta, 0, 0.21, 0, 14);
  b.cylinder('belly_hi', 0.4, 0.58, 0.24, p.terracotta, 0, 0.46, 0, 14);
  b.cylinder('neck', 0.32, 0.4, 0.1, p.terracotta, 0, 0.63, 0, 14);
  b.torus('lip', 0.36, 0.05, p.terracotta, 0, 0.69, 0, 14);
  // Dry palm leaves in the pot.
  for (let i = 0; i < 4; i++) {
    const a = i * 1.6;
    const f = b.plane(`leaf${i}`, 0.25, 0.9, p.frond, Math.sin(a) * 0.05, 1.05, Math.cos(a) * 0.05);
    f.rotationQuaternion = Quaternion.RotationYawPitchRoll(a, -0.4 + (i % 2) * 0.2, 0);
    f.receiveShadows = false;
  }
  return b.finish();
}

function waterTank(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'water_tank');
  const p = ctx.palette;
  const metal = ctx.materials.get('metal') ?? p.paintedMetal;
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) b.box(`leg${x}${z}`, 0.06, 0.4, 0.06, p.iron, x, 0.2, z);
  b.box('frame0', 1.0, 0.05, 0.05, p.iron, 0, 0.4, -0.45);
  b.box('frame1', 1.0, 0.05, 0.05, p.iron, 0, 0.4, 0.45);
  b.cylinder('tank', 1.1, 1.1, 0.75, metal, 0, 0.8, 0, 20);
  b.cylinder('lid', 0.35, 0.35, 0.06, p.plastic, 0, 1.2, 0, 12);
  b.bar('pipe', new Vector3(0.4, 0.42, 0.3), new Vector3(0.4, -0.05, 0.3), 0.05, p.plastic, 8);
  return b.finish();
}

function acUnit(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'ac_unit');
  const p = ctx.palette;
  b.box('body', 0.8, 0.5, 0.6, p.plastic, 0, 0.25, 0);
  const grille = b.plane('grille', 0.7, 0.4, p.iron, 0, 0.25, 0.301, false);
  grille.rotation.y = Math.PI;
  b.cylinder('fan', 0.34, 0.34, 0.02, p.rubber, 0, 0.25, 0.3, 16).rotation.x = Math.PI / 2;
  b.box('bracket0', 0.05, 0.05, 0.7, p.rust, -0.3, 0.02, 0);
  b.box('bracket1', 0.05, 0.05, 0.7, p.rust, 0.3, 0.02, 0);
  return b.finish();
}

function antenna(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'antenna');
  const p = ctx.palette;
  b.cylinder('mast', 0.03, 0.04, 2.5, p.paintedMetal, 0, 1.25, 0, 8);
  for (let i = 0; i < 4; i++) {
    const y = 1.4 + i * 0.28;
    const w = 0.9 - i * 0.15;
    b.box(`el${i}`, w, 0.02, 0.02, p.paintedMetal, 0, y, 0);
  }
  b.box('boom', 0.03, 0.03, 0.9, p.paintedMetal, 0, 1.8, 0);
  return b.finish();
}

function satelliteDish(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'satellite_dish');
  const p = ctx.palette;
  b.cylinder('post', 0.05, 0.05, 0.5, p.paintedMetal, 0, 0.25, 0, 8);
  const dish = b.cylinder('dish', 0.85, 0.7, 0.05, p.plastic, 0, 0.6, 0.05, 24);
  dish.rotationQuaternion = Quaternion.RotationYawPitchRoll(0, -0.9, 0);
  b.bar('arm', new Vector3(0, 0.45, 0.15), new Vector3(0, 0.3, 0.55), 0.025, p.paintedMetal, 6);
  b.box('lnb', 0.06, 0.06, 0.12, p.rubber, 0, 0.3, 0.58);
  return b.finish();
}

function bicycle(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'bicycle');
  const p = ctx.palette;
  const r = 0.33;
  for (const x of [-0.55, 0.55]) {
    const wheel = b.torus(`wheel${x}`, r * 2, 0.04, p.rubber, x, r, 0, 24);
    wheel.rotation.x = Math.PI / 2;
    const hub = b.cylinder(`hub${x}`, 0.06, 0.06, 0.06, p.iron, x, r, 0, 8);
    hub.rotation.z = Math.PI / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI;
      b.bar(`spoke${x}${i}`, new Vector3(x + Math.cos(a) * r, r + Math.sin(a) * r, 0), new Vector3(x - Math.cos(a) * r, r - Math.sin(a) * r, 0), 0.006, p.iron, 4);
    }
  }
  const tube = p.paintedMetal;
  const A = new Vector3(0.55, r, 0);
  const B = new Vector3(0.12, 0.55, 0);
  const C = new Vector3(-0.12, 0.85, 0);
  const D = new Vector3(0.4, 0.9, 0);
  const E = new Vector3(-0.55, r, 0);
  b.bar('down', A, B, 0.03, tube);
  b.bar('seat', B, C, 0.03, tube);
  b.bar('top', C, D, 0.03, tube);
  b.bar('fork', D, A, 0.03, tube);
  b.bar('stay0', E, B, 0.025, tube);
  b.bar('stay1', E, C, 0.025, tube);
  const saddle = b.box('saddle', 0.25, 0.05, 0.12, p.rubber, -0.15, 0.95, 0);
  saddle.rotation.z = 0.1;
  b.bar('bars', new Vector3(0.42, 0.98, -0.25), new Vector3(0.42, 0.98, 0.25), 0.025, tube);
  b.bar('stem', D, new Vector3(0.42, 0.98, 0), 0.025, tube);
  return b.finish();
}

function fountain(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'fountain');
  const p = ctx.palette;
  const tile = ctx.materials.get('tile') ?? p.stoneLight;
  const stone = ctx.materials.get('stone') ?? p.stoneLight;
  const water = ctx.materials.get('water') ?? p.waterFallback;
  b.cylinder('basin', 2.8, 2.8, 0.7, stone, 0, 0.35, 0, 8);
  b.cylinder('rim', 2.9, 2.9, 0.12, tile, 0, 0.76, 0, 8);
  b.cylinder('inner', 2.5, 2.5, 0.6, tile, 0, 0.5, 0, 8);
  const surface = MeshBuilder.CreateDisc('water', { radius: 1.22, tessellation: 24 }, ctx.scene);
  surface.parent = b.root;
  surface.position.set(0, 0.68, 0);
  surface.rotation.x = Math.PI / 2;
  surface.material = water;
  surface.isPickable = false;
  surface.receiveShadows = true;
  b.meshes.push(surface);
  b.cylinder('column', 0.28, 0.36, 0.9, stone, 0, 1.1, 0, 8);
  b.cylinder('bowl', 0.9, 0.5, 0.18, tile, 0, 1.55, 0, 8);
  b.sphere('finial', 0.16, p.brass, 0, 1.72, 0, 8);
  return b.finish();
}

function flag(ctx: PropContext, tint?: [number, number, number]): PropBuild {
  const b = new Builder(ctx, 'flag');
  const p = ctx.palette;
  b.cylinder('pole', 0.05, 0.07, 3, p.paintedMetal, 0, 1.5, 0, 8);
  b.sphere('finial', 0.1, p.brass, 0, 3.02, 0, 8);
  const mat = tint ? p.tintedCloth(tint) : p.clothRed;
  const cloth = b.plane('cloth', 1.2, 0.7, mat, 0.62, 2.55, 0);
  cloth.rotation.y = 0.15;
  return b.finish();
}

function clothLine(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'cloth_line');
  const p = ctx.palette;
  const a = new Vector3(-2, 0.55, 0);
  const c = new Vector3(2, 0.55, 0);
  b.bar('rope', a, c, 0.015, p.rope, 6);
  const fabric = ctx.materials.get('fabric');
  const mats = [fabric ?? p.clothRed, p.clothWhite, p.clothBlue, p.clothWhite, p.clothGreen];
  for (let i = 0; i < 5; i++) {
    const x = -1.5 + i * 0.75;
    const h = 0.45 + (i % 2) * 0.15;
    const w = 0.4 + (i % 3) * 0.1;
    const cl = b.plane(`cloth${i}`, w, h, mats[i % mats.length], x, 0.55 - h / 2, 0.02 * (i % 2));
    cl.rotation.y = (i % 2 ? 1 : -1) * 0.08;
    cl.receiveShadows = false;
  }
  return b.finish();
}

function awning(ctx: PropContext, tint?: [number, number, number]): PropBuild {
  const b = new Builder(ctx, 'awning');
  const p = ctx.palette;
  const fabric = tint ? p.tintedCloth(tint) : ctx.materials.get('fabric') ?? p.clothRed;
  const sheet = b.box('sheet', 3.0, 0.02, 2.0, fabric, 0, 0, 0);
  sheet.rotation.x = 0.25;
  sheet.position.y = -0.25;
  // Scalloped front edge.
  for (let i = 0; i < 6; i++) {
    const s = b.plane(`scallop${i}`, 0.5, 0.18, fabric, -1.25 + i * 0.5, -0.58, 0.98);
    s.receiveShadows = false;
  }
  b.cylinder('pole0', 0.04, 0.04, 2.2, p.darkWood, -1.4, -1.6, 0.95, 8);
  b.cylinder('pole1', 0.04, 0.04, 2.2, p.darkWood, 1.4, -1.6, 0.95, 8);
  return b.finish();
}

function rug(ctx: PropContext, tint?: [number, number, number]): PropBuild {
  const b = new Builder(ctx, 'rug');
  const p = ctx.palette;
  const main = tint ? p.tintedCloth(tint) : null;
  if (main) b.box('rug', 2.0, 0.02, 3.2, main, 0, 0.01, 0);
  else b.texBox('rug', 2.0, 0.02, 3.2, 'fabric', 0, 0.01, 0, p.clothRed);
  // Border and fringe.
  b.box('border0', 2.0, 0.022, 0.12, p.clothWhite, 0, 0.011, 1.54);
  b.box('border1', 2.0, 0.022, 0.12, p.clothWhite, 0, 0.011, -1.54);
  return b.finish();
}

function door(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'door');
  const p = ctx.palette;
  b.texBox('leaf', 1.0, 2.2, 0.06, 'wood', 0, 1.1, 0);
  b.box('frame_l', 0.1, 2.3, 0.12, p.darkWood, -0.55, 1.15, 0);
  b.box('frame_r', 0.1, 2.3, 0.12, p.darkWood, 0.55, 1.15, 0);
  b.box('frame_t', 1.2, 0.12, 0.12, p.darkWood, 0, 2.26, 0);
  // Panels and studs.
  b.box('panel0', 0.7, 0.8, 0.02, p.darkWood, 0, 1.6, 0.04);
  b.box('panel1', 0.7, 0.6, 0.02, p.darkWood, 0, 0.6, 0.04);
  for (let i = 0; i < 6; i++) b.sphere(`stud${i}`, 0.04, p.iron, -0.35 + (i % 3) * 0.35, 1.1 + Math.floor(i / 3) * 0.4 - 0.2, 0.05, 6);
  b.torus('knocker', 0.14, 0.02, p.brass, 0.3, 1.05, 0.07, 12);
  return b.finish();
}

function windowProp(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'window');
  const p = ctx.palette;
  const lattice = ctx.materials.get('lattice');
  b.box('frame_l', 0.08, 1.2, 0.1, p.darkWood, -0.5, 0.6, 0);
  b.box('frame_r', 0.08, 1.2, 0.1, p.darkWood, 0.5, 0.6, 0);
  b.box('frame_t', 1.08, 0.08, 0.1, p.darkWood, 0, 1.2, 0);
  b.box('sill', 1.2, 0.08, 0.2, p.stoneLight, 0, 0.02, 0.05);
  const screen = b.plane('screen', 0.92, 1.1, lattice ?? p.darkWood, 0, 0.6, 0.02);
  if (lattice) {
    // Lattice repeats: 0.5 m tile → scale UVs so the pattern is not stretched.
    const uv = screen.getVerticesData('uv');
    if (uv) {
      for (let i = 0; i < uv.length; i += 2) {
        uv[i] *= 0.92 * 2;
        uv[i + 1] *= 1.1 * 2;
      }
      screen.setVerticesData('uv', uv);
    }
  }
  return b.finish();
}

function arch(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'arch');
  const p = ctx.palette;
  const stone = ctx.materials.get('stone') ?? p.stoneLight;
  b.box('pier_l', 0.3, 2.0, 0.5, stone, -1.05, 1.0, 0);
  b.box('pier_r', 0.3, 2.0, 0.5, stone, 1.05, 1.0, 0);
  b.box('cap_l', 0.4, 0.12, 0.6, p.stoneLight, -1.05, 2.06, 0);
  b.box('cap_r', 0.4, 0.12, 0.6, p.stoneLight, 1.05, 2.06, 0);
  // Pointed arch from voussoir blocks along two arcs.
  const n = 7;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const ang = (t * Math.PI) / 2.2;
      const cx = -side * 0.35;
      const r = 1.4;
      const x = cx + side * Math.cos(ang) * r;
      const y = 2.1 + Math.sin(ang) * r * 0.85;
      const v = b.box(`vouss${side}${i}`, 0.34, 0.3, 0.5, stone, x, y, 0);
      v.rotation.z = side * (ang - Math.PI / 2);
    }
  }
  return b.finish();
}

function teapot(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'teapot');
  const p = ctx.palette;
  const body = b.sphere('body', 0.18, p.brass, 0, 0.1, 0, 12);
  body.scaling.y = 0.85;
  b.cylinder('lid', 0.06, 0.1, 0.03, p.brass, 0, 0.18, 0, 10);
  b.sphere('knob', 0.03, p.brass, 0, 0.2, 0, 6);
  b.bar('spout', new Vector3(0.08, 0.09, 0), new Vector3(0.16, 0.17, 0), 0.025, p.brass, 6);
  const handle = b.torus('handle', 0.1, 0.012, p.brass, -0.1, 0.11, 0, 12);
  handle.rotation.x = Math.PI / 2;
  handle.rotation.z = Math.PI / 2;
  return b.finish();
}

function shanasheel(ctx: PropContext): PropBuild {
  const b = new Builder(ctx, 'shanasheel');
  const p = ctx.palette;
  const wood = ctx.materials.get('wood') ?? p.wood;
  const lattice = ctx.materials.get('lattice') ?? p.darkWood;
  const w = 2.4, d = 1.1, h = 2.6;
  // Floor with carved corbels beneath.
  b.texBox('floor', w, 0.12, d, 'wood', 0, 0.06, d / 2);
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + 0.2 + i * ((w - 0.4) / 3);
    const c = b.box(`corbel${i}`, 0.12, 0.35, 0.8, p.darkWood, x, -0.2, d * 0.45);
    c.rotation.x = 0.35;
  }
  // Posts.
  for (const [x, z] of [[-w / 2 + 0.06, d - 0.06], [w / 2 - 0.06, d - 0.06], [-w / 2 + 0.06, 0.06], [w / 2 - 0.06, 0.06]]) {
    b.box(`post${x}${z}`, 0.12, h, 0.12, p.darkWood, x, h / 2, z);
  }
  // Lattice screens: front and both sides, with a solid dado at the bottom.
  const dado = 0.7;
  const scr = (name: string, width: number, x: number, z: number, yaw: number) => {
    b.box(`${name}_dado`, width, dado, 0.05, wood, x, 0.12 + dado / 2, z).rotation.y = yaw;
    const s = b.plane(`${name}_screen`, width - 0.1, h - dado - 0.45, lattice, x, 0.12 + dado + (h - dado - 0.45) / 2, z);
    s.rotation.y = yaw;
    const uv = s.getVerticesData('uv');
    if (uv) {
      for (let i = 0; i < uv.length; i += 2) {
        uv[i] *= (width - 0.1) * 2;
        uv[i + 1] *= (h - dado - 0.45) * 2;
      }
      s.setVerticesData('uv', uv);
    }
    b.box(`${name}_rail`, width, 0.08, 0.06, p.darkWood, x, h - 0.3, z).rotation.y = yaw;
  };
  scr('front', w, 0, d - 0.03, 0);
  scr('left', d, -w / 2 + 0.03, d / 2, Math.PI / 2);
  scr('right', d, w / 2 - 0.03, d / 2, Math.PI / 2);
  // Cornice / roof.
  b.texBox('roof', w + 0.3, 0.1, d + 0.2, 'wood', 0, h + 0.05, d / 2 + 0.05);
  b.box('cornice', w + 0.4, 0.14, 0.14, p.darkWood, 0, h - 0.05, d + 0.1);
  return b.finish();
}

function sign(ctx: PropContext, text: string | undefined, tint?: [number, number, number]): PropBuild {
  const b = new Builder(ctx, 'sign');
  const p = ctx.palette;
  const label = text && text.trim() ? text.trim() : 'مقهى';
  b.texBox('board', 1.6, 0.5, 0.06, 'wood', 0, 0, 0);
  b.box('trim_t', 1.66, 0.04, 0.08, p.brass, 0, 0.26, 0);
  b.box('trim_b', 1.66, 0.04, 0.08, p.brass, 0, -0.26, 0);
  const bg = tint ? `rgb(${Math.round(tint[0] * 255)},${Math.round(tint[1] * 255)},${Math.round(tint[2] * 255)})` : '#1f5f6b';
  const tex = createTextTexture(ctx.scene, `sign_${label}`, {
    text: label,
    width: 512,
    height: 160,
    color: '#f4e9d0',
    background: bg,
    border: '#c9a24a',
    weight: 700,
  });
  if (tex) {
    ctx.ownedTextures.push(tex);
    const mat = new StandardMaterial(`sign_${label}`, ctx.scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.emissiveColor = new Color3(0.35, 0.35, 0.35);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mat.backFaceCulling = true;
    ctx.ownedMaterials.push(mat);
    const face = b.plane('face', 1.5, 0.44, mat, 0, 0, 0.032, false);
    // Babylon planes face -Z; flip so the text reads from +Z (the prop's front).
    face.rotation.y = Math.PI;
    face.receiveShadows = false;
  }
  return b.finish();
}

/** Build a prop of the given kind. Returns null for unknown kinds. */
export function buildProp(ctx: PropContext, req: PropRequest): PropBuild | null {
  switch (req.kind) {
    case 'palm': return palm(ctx);
    case 'lantern': return lantern(ctx);
    case 'table': return table(ctx);
    case 'chair': return chair(ctx);
    case 'bench': return bench(ctx);
    case 'crate': return crate(ctx);
    case 'barrel': return barrel(ctx);
    case 'sacks': return sacks(ctx);
    case 'pot': return pot(ctx);
    case 'water_tank': return waterTank(ctx);
    case 'ac_unit': return acUnit(ctx);
    case 'antenna': return antenna(ctx);
    case 'satellite_dish': return satelliteDish(ctx);
    case 'bicycle': return bicycle(ctx);
    case 'fountain': return fountain(ctx);
    case 'flag': return flag(ctx, req.tint);
    case 'cloth_line': return clothLine(ctx);
    case 'awning': return awning(ctx, req.tint);
    case 'rug': return rug(ctx, req.tint);
    case 'door': return door(ctx);
    case 'window': return windowProp(ctx);
    case 'arch': return arch(ctx);
    case 'teapot': return teapot(ctx);
    case 'shanasheel': return shanasheel(ctx);
    case 'sign': return sign(ctx, req.text, req.tint);
  }
}

/** Warm up fonts used by sign textures (no-op where unsupported). */
export function prepareProps(): Promise<void> {
  return ensureFonts();
}
