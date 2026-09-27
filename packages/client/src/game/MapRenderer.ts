/**
 * Turns a MapDef into renderable geometry:
 *  - every visible block becomes six quads with world-aligned UVs (so brick
 *    courses line up across walls and nothing stretches), merged into one
 *    mesh per material per 16 m chunk (few draw calls, frustum-cullable);
 *  - per-block tint and a subtle brightness variation are baked into vertex
 *    colours;
 *  - props are procedural (Props.ts), instanced when repeated;
 *  - map lights and lantern lights form a pool of which only the N nearest
 *    to the camera are enabled.
 */
import {
  Color3,
  InstancedMesh,
  Light,
  Mesh,
  PointLight,
  SpotLight,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  type Material,
  type Scene,
  type Texture,
} from '@babylonjs/core';
import { hashSeed, type MapBlock, type MapDef, type MaterialId } from '@tra/shared';
import type { Environment } from './Environment';
import { MaterialLibrary } from './Materials';
import { PROP_MATERIALS, PropPalette, buildProp, type PropBuild, type PropContext } from './Props';
import type { QualityProfile } from './quality';

/** Chunk size (m) for splitting merged geometry. */
const CHUNK = 16;
/** Materials whose blocks do not cast shadows (transparent). */
const NON_CASTERS: ReadonlySet<MaterialId> = new Set<MaterialId>(['glass', 'water', 'invisible']);

interface FaceDef {
  n: [number, number, number];
  /** Screen-right and screen-up axes when looking at the face from outside. */
  r: [number, number, number];
  u: [number, number, number];
}

// Corners are emitted counter-clockwise as seen from the normal side (Babylon
// front faces). Right/up axes: r = up × (-n) for vertical faces with up = +Y;
// horizontal faces use +Z as "up".
const FACES: FaceDef[] = [
  { n: [1, 0, 0], r: [0, 0, 1], u: [0, 1, 0] },
  { n: [-1, 0, 0], r: [0, 0, -1], u: [0, 1, 0] },
  { n: [0, 0, 1], r: [-1, 0, 0], u: [0, 1, 0] },
  { n: [0, 0, -1], r: [1, 0, 0], u: [0, 1, 0] },
  { n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, 1] },
  { n: [0, -1, 0], r: [-1, 0, 0], u: [0, 0, 1] },
];

class GeometryAccumulator {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  addBlock(b: MapBlock, uvScale: number, tint: [number, number, number]): void {
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    const hx = (b.max.x - b.min.x) / 2;
    const hy = (b.max.y - b.min.y) / 2;
    const hz = (b.max.z - b.min.z) / 2;
    for (const f of FACES) {
      const base = this.positions.length / 3;
      // Face centre and half extents along its right/up axes.
      const fcx = cx + f.n[0] * hx;
      const fcy = cy + f.n[1] * hy;
      const fcz = cz + f.n[2] * hz;
      const hr = Math.abs(f.r[0]) * hx + Math.abs(f.r[1]) * hy + Math.abs(f.r[2]) * hz;
      const hu = Math.abs(f.u[0]) * hx + Math.abs(f.u[1]) * hy + Math.abs(f.u[2]) * hz;
      // BL, BR, TR, TL in the (right, up) basis.
      const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [sr, su] of corners) {
        const px = fcx + f.r[0] * hr * sr + f.u[0] * hu * su;
        const py = fcy + f.r[1] * hr * sr + f.u[1] * hu * su;
        const pz = fcz + f.r[2] * hr * sr + f.u[2] * hu * su;
        this.positions.push(px, py, pz);
        this.normals.push(f.n[0], f.n[1], f.n[2]);
        // World-aligned UVs: project the world position on the face axes.
        this.uvs.push((px * f.r[0] + py * f.r[1] + pz * f.r[2]) * uvScale, (px * f.u[0] + py * f.u[1] + pz * f.u[2]) * uvScale);
        this.colors.push(tint[0], tint[1], tint[2], 1);
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  toMesh(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = new Float32Array(this.positions);
    vd.normals = new Float32Array(this.normals);
    vd.uvs = new Float32Array(this.uvs);
    vd.colors = new Float32Array(this.colors);
    vd.indices = this.vertexCount > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices);
    vd.applyToMesh(mesh, false);
    return mesh;
  }
}

interface PooledLight {
  light: Light;
  position: Vector3;
  distSq: number;
}

interface PropInstanceGroup {
  build: PropBuild;
  count: number;
}

export class MapRenderer {
  /** Merged static meshes (decal targets, shadow casters). */
  readonly staticMeshes: Mesh[] = [];
  readonly root: TransformNode;
  private readonly propRoot: TransformNode;
  private readonly palette: PropPalette;
  private readonly propBuilds: PropBuild[] = [];
  private readonly propInstances: InstancedMesh[] = [];
  private readonly propRoots: TransformNode[] = [];
  private readonly ownedMaterials: Material[] = [];
  private readonly ownedTextures: Texture[] = [];
  private readonly lightPool: PooledLight[] = [];
  private readonly prototypes = new Map<string, PropInstanceGroup>();
  private lightTimer = 0;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    readonly map: MapDef,
    private readonly materials: MaterialLibrary,
    private readonly env: Environment | null,
    private quality: QualityProfile,
  ) {
    this.root = new TransformNode('map', scene);
    this.propRoot = new TransformNode('props', scene);
    this.propRoot.parent = this.root;
    this.palette = new PropPalette(scene);
    this.buildGeometry();
    this.buildProps();
    this.buildLights();
  }

  /** Material ids a map needs (blocks + props), for pre-generation. */
  static usedMaterials(map: MapDef): MaterialId[] {
    const ids = new Set<MaterialId>();
    for (const b of map.blocks) if (b.material !== 'invisible') ids.add(b.material);
    for (const p of map.props) for (const id of PROP_MATERIALS[p.kind] ?? []) ids.add(id);
    return [...ids];
  }

  // ---------------------------------------------------------------------------
  // Blocks
  // ---------------------------------------------------------------------------

  private buildGeometry(): void {
    const groups = new Map<string, { material: MaterialId; acc: GeometryAccumulator; minX: number; minZ: number; maxX: number; maxZ: number }>();
    this.map.blocks.forEach((b, index) => {
      if (b.material === 'invisible') return;
      const uvScale = b.uvScale ?? this.materials.uvScale(b.material);
      // Deterministic ±5 % brightness variation per block breaks up repetition.
      const vary = 0.95 + (hashSeed(index, 17) % 1000) / 10000;
      const t = b.tint ?? [1, 1, 1];
      const tint: [number, number, number] = [t[0] * vary, t[1] * vary, t[2] * vary];
      const cx = Math.floor((b.min.x + b.max.x) / 2 / CHUNK);
      const cz = Math.floor((b.min.z + b.max.z) / 2 / CHUNK);
      const key = `${b.material}:${cx}:${cz}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { material: b.material, acc: new GeometryAccumulator(), minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity }));
      g.acc.addBlock(b, uvScale, tint);
      g.minX = Math.min(g.minX, b.min.x);
      g.minZ = Math.min(g.minZ, b.min.z);
      g.maxX = Math.max(g.maxX, b.max.x);
      g.maxZ = Math.max(g.maxZ, b.max.z);
    });
    const bounds = this.map.bounds;
    const mapArea = (bounds.max.x - bounds.min.x) * (bounds.max.z - bounds.min.z);
    for (const [key, g] of groups) {
      const mesh = g.acc.toMesh(`map_${key}`, this.scene);
      mesh.parent = this.root;
      mesh.material = this.materials.get(g.material);
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      mesh.useVertexColors = true;
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
      // Huge slabs (ground) are always in view: skip their frustum test.
      const area = (g.maxX - g.minX) * (g.maxZ - g.minZ);
      if (area > mapArea * 0.5) mesh.alwaysSelectAsActiveMesh = true;
      if (!NON_CASTERS.has(g.material)) this.env?.addShadowCaster(mesh);
      this.staticMeshes.push(mesh);
    }
  }

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  private buildProps(): void {
    const ctx: PropContext = {
      scene: this.scene,
      palette: this.palette,
      materials: this.materials,
      ownedMaterials: this.ownedMaterials,
      ownedTextures: this.ownedTextures,
    };
    for (const p of this.map.props) {
      const key = `${p.kind}|${p.tint?.join(',') ?? ''}|${p.text ?? ''}`;
      const scale = p.scale ?? 1;
      const yaw = p.yaw ?? 0;
      const proto = this.prototypes.get(key);
      if (!proto) {
        const build = buildProp(ctx, { kind: p.kind, text: p.text, tint: p.tint });
        if (!build) continue;
        build.root.parent = this.propRoot;
        build.root.position.set(p.pos.x, p.pos.y, p.pos.z);
        build.root.rotation.y = yaw;
        build.root.scaling.setAll(scale);
        for (const m of build.meshes) {
          m.computeWorldMatrix(true);
          if (m.material?.needAlphaBlending()) m.receiveShadows = false;
          this.env?.addShadowCaster(m);
        }
        for (const l of build.lights) this.lightPool.push({ light: l, position: l.getAbsolutePosition().clone(), distSq: 0 });
        this.propBuilds.push(build);
        this.prototypes.set(key, { build, count: 1 });
        this.freezeTree(build.root);
        continue;
      }
      // Repeated prop: instance every mesh of the prototype under a new root.
      proto.count++;
      const root = new TransformNode(`prop_${p.kind}_${proto.count}`, this.scene);
      root.parent = this.propRoot;
      root.position.set(p.pos.x, p.pos.y, p.pos.z);
      root.rotation.y = yaw;
      root.scaling.setAll(scale);
      for (const src of proto.build.meshes) {
        const inst = src.createInstance(`${src.name}_i${proto.count}`);
        inst.parent = root;
        inst.position.copyFrom(src.position);
        inst.rotation.copyFrom(src.rotation);
        inst.rotationQuaternion = src.rotationQuaternion ? src.rotationQuaternion.clone() : null;
        inst.scaling.copyFrom(src.scaling);
        inst.isPickable = false;
        this.propInstances.push(inst);
      }
      for (const l of proto.build.lights) {
        const local = l.position;
        const world = Vector3.TransformCoordinates(local, root.computeWorldMatrix(true));
        const clone = new PointLight(`${l.name}_i${proto.count}`, world, this.scene);
        clone.diffuse = l.diffuse.clone();
        clone.specular = l.specular.clone();
        clone.intensity = l.intensity;
        clone.range = l.range;
        clone.shadowEnabled = false;
        clone.parent = this.propRoot;
        this.lightPool.push({ light: clone, position: world.clone(), distSq: 0 });
      }
      this.propRoots.push(root);
      this.freezeTree(root);
    }
  }

  private freezeTree(node: TransformNode): void {
    node.computeWorldMatrix(true);
    node.freezeWorldMatrix();
    for (const child of node.getChildTransformNodes(false)) {
      child.computeWorldMatrix(true);
      child.freezeWorldMatrix();
    }
  }

  // ---------------------------------------------------------------------------
  // Lights
  // ---------------------------------------------------------------------------

  private buildLights(): void {
    for (const l of this.map.lights) {
      const pos = new Vector3(l.pos.x, l.pos.y, l.pos.z);
      const color = new Color3(l.color[0], l.color[1], l.color[2]);
      let light: Light;
      if (l.kind === 'spot') {
        const dir = l.dir ? new Vector3(l.dir.x, l.dir.y, l.dir.z).normalize() : Vector3.Down();
        const spot = new SpotLight(`maplight_${this.lightPool.length}`, pos, dir, l.angle ?? Math.PI / 3, 8, this.scene);
        spot.range = l.range;
        light = spot;
      } else {
        const point = new PointLight(`maplight_${this.lightPool.length}`, pos, this.scene);
        point.range = l.range;
        light = point;
      }
      light.diffuse = color;
      light.specular = color.scale(0.5);
      light.intensity = l.intensity;
      light.shadowEnabled = false;
      light.parent = this.root;
      this.lightPool.push({ light, position: pos.clone(), distSq: 0 });
    }
    // Start with everything off; update() enables the nearest set.
    for (const p of this.lightPool) p.light.setEnabled(false);
  }

  /** Keep only the nearest dynamic lights enabled (sun + sky take two slots). */
  private updateLights(cameraPos: Vector3): void {
    if (!this.lightPool.length) return;
    const budget = Math.max(0, this.quality.maxDynamicLights - 2);
    for (const p of this.lightPool) p.distSq = Vector3.DistanceSquared(p.position, cameraPos);
    this.lightPool.sort((a, b) => a.distSq - b.distSq);
    this.lightPool.forEach((p, i) => {
      const on = i < budget && p.distSq < (p.light.range + 4) ** 2 * 4;
      if (p.light.isEnabled() !== on) p.light.setEnabled(on);
    });
  }

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------

  update(dt: number, cameraPos: Vector3): void {
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.25;
      this.updateLights(cameraPos);
    }
  }

  applyQuality(quality: QualityProfile): void {
    this.quality = quality;
    this.lightTimer = 0;
  }

  /** Total vertex count of the merged static geometry (diagnostics/tests). */
  get staticVertexCount(): number {
    return this.staticMeshes.reduce((n, m) => n + m.getTotalVertices(), 0);
  }

  get propCount(): number {
    return this.propBuilds.length + this.propRoots.length;
  }

  get lightCount(): number {
    return this.lightPool.length;
  }

  /** Vertex buffer kinds present on the merged meshes (tests). */
  hasVertexColors(): boolean {
    return this.staticMeshes.every((m) => m.isVerticesDataPresent(VertexBuffer.ColorKind));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.lightPool) p.light.dispose();
    this.lightPool.length = 0;
    for (const inst of this.propInstances) inst.dispose();
    this.propInstances.length = 0;
    for (const r of this.propRoots) r.dispose();
    this.propRoots.length = 0;
    for (const b of this.propBuilds) {
      for (const m of b.meshes) {
        this.env?.removeShadowCaster(m);
        m.dispose(false, false);
      }
      b.root.dispose();
    }
    this.propBuilds.length = 0;
    this.prototypes.clear();
    for (const m of this.staticMeshes) {
      this.env?.removeShadowCaster(m);
      m.dispose(false, false);
    }
    this.staticMeshes.length = 0;
    for (const m of this.ownedMaterials) m.dispose(true, false);
    this.ownedMaterials.length = 0;
    for (const t of this.ownedTextures) t.dispose();
    this.ownedTextures.length = 0;
    this.palette.dispose();
    this.propRoot.dispose();
    this.root.dispose();
  }
}
