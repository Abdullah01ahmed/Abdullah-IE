/**
 * Babylon material library for map materials: turns generated texture sets
 * into PBR materials (albedo + normal + packed ORM) with the right alpha mode
 * and tiling defaults, and offers small helpers for solid-colour PBR used by
 * props, characters and weapons.
 *
 * Lifetime: one library per loaded match. Disposing it releases every texture
 * and material it created (CPU-side generated sets stay in textures.ts' cache).
 */
import { Color3, Constants, Material, PBRMaterial, RawTexture, Texture, type Scene } from '@babylonjs/core';
import type { MaterialId } from '@tra/shared';
import { generateTextureSets, type TexGenOptions, type TexProgress } from './texgen';
import { textureSizeFor } from './quality';
import type { TextureSet } from './textures';

export type AlphaMode = 'opaque' | 'cutout' | 'blend';

export interface MaterialSpec {
  /** Texture repeats per metre (1 / tile size). */
  uvScale: number;
  alpha: AlphaMode;
  /** Slow UV scroll for water. */
  animated?: boolean;
  /** Draw both sides (thin cut-out screens). */
  twoSided?: boolean;
}

export const MATERIAL_SPECS: Record<MaterialId, MaterialSpec> = {
  brick: { uvScale: 1, alpha: 'opaque' },
  brick_dark: { uvScale: 1, alpha: 'opaque' },
  plaster: { uvScale: 0.5, alpha: 'opaque' },
  plaster_worn: { uvScale: 0.5, alpha: 'opaque' },
  stone: { uvScale: 0.5, alpha: 'opaque' },
  wood: { uvScale: 1, alpha: 'opaque' },
  lattice: { uvScale: 2, alpha: 'cutout', twoSided: true },
  roof: { uvScale: 0.5, alpha: 'opaque' },
  ground: { uvScale: 1 / 3, alpha: 'opaque' },
  cobble: { uvScale: 0.5, alpha: 'opaque' },
  tile: { uvScale: 1, alpha: 'opaque' },
  metal: { uvScale: 1, alpha: 'opaque' },
  fabric: { uvScale: 1, alpha: 'opaque' },
  concrete: { uvScale: 0.5, alpha: 'opaque' },
  water: { uvScale: 0.25, alpha: 'blend', animated: true },
  sand: { uvScale: 1 / 3, alpha: 'opaque' },
  glass: { uvScale: 1, alpha: 'blend' },
  invisible: { uvScale: 1, alpha: 'opaque' },
};

export interface MaterialLibraryOptions {
  /** Base texture size (per-material caps apply, see quality.ts). */
  textureSize: number;
  anisotropy: number;
  /** Passed through to the texture generator (tests disable workers). */
  texgen?: TexGenOptions;
}

/** Number of lights a world material may be lit by (sun + sky + 6 nearest point lights). */
export const MAX_MATERIAL_LIGHTS = 8;

/** Upload an RGBA8 buffer as a wrapping, mip-mapped texture. */
export function createRawRgbaTexture(scene: Scene, name: string, data: Uint8Array, width: number, height: number, opts: { mips?: boolean; linear?: boolean; anisotropy?: number; clamp?: boolean } = {}): RawTexture {
  const tex = new RawTexture(
    data,
    width,
    height,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    opts.mips ?? true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
  );
  tex.name = name;
  tex.wrapU = tex.wrapV = opts.clamp ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
  if (opts.linear) tex.gammaSpace = false;
  if (opts.anisotropy) tex.anisotropicFilteringLevel = opts.anisotropy;
  return tex;
}

/** Solid-colour PBR material (props, characters, weapons). */
export function solidPbr(scene: Scene, name: string, color: Color3 | string, roughness = 0.7, metallic = 0, emissive?: Color3 | string): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = typeof color === 'string' ? Color3.FromHexString(color) : color;
  m.roughness = roughness;
  m.metallic = metallic;
  if (emissive) m.emissiveColor = typeof emissive === 'string' ? Color3.FromHexString(emissive) : emissive;
  m.maxSimultaneousLights = MAX_MATERIAL_LIGHTS;
  m.enableSpecularAntiAliasing = true;
  return m;
}

export class MaterialLibrary {
  private readonly materials = new Map<MaterialId, PBRMaterial>();
  private readonly textures: RawTexture[] = [];
  private readonly animated: PBRMaterial[] = [];
  private disposed = false;

  constructor(private readonly scene: Scene, private readonly opts: MaterialLibraryOptions) {}

  /** Generate texture sets and build materials for the given ids. */
  async prepare(ids: Iterable<MaterialId>, onProgress?: TexProgress): Promise<void> {
    const wanted = [...new Set(ids)].filter((id) => id !== 'invisible' && !this.materials.has(id));
    if (!wanted.length) return;
    const sets = await generateTextureSets(
      wanted.map((id) => ({ id, size: textureSizeFor(id, this.opts.textureSize) })),
      onProgress,
      this.opts.texgen,
    );
    if (this.disposed) return;
    for (const id of wanted) {
      const set = sets.get(id);
      if (set) this.materials.set(id, this.buildMaterial(set));
    }
  }

  private buildMaterial(set: TextureSet): PBRMaterial {
    const spec = MATERIAL_SPECS[set.id];
    const aniso = this.opts.anisotropy;
    const albedo = createRawRgbaTexture(this.scene, `${set.id}_albedo`, set.albedo, set.size, set.size, { anisotropy: aniso });
    const normal = createRawRgbaTexture(this.scene, `${set.id}_normal`, set.normal, set.detailSize, set.detailSize, { linear: true, anisotropy: aniso });
    const orm = createRawRgbaTexture(this.scene, `${set.id}_orm`, set.orm, set.detailSize, set.detailSize, { linear: true, anisotropy: aniso });
    this.textures.push(albedo, normal, orm);

    const m = new PBRMaterial(`mat_${set.id}`, this.scene);
    m.albedoTexture = albedo;
    m.bumpTexture = normal;
    // The generator writes OpenGL-layout normals with +v pointing up the
    // texture; in Babylon's left-handed frame that needs both axes flipped.
    m.invertNormalMapX = true;
    m.invertNormalMapY = true;
    m.metallicTexture = orm;
    m.useAmbientOcclusionFromMetallicTextureRed = true;
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useMetallnessFromMetallicTextureBlue = true;
    m.metallic = 1;
    m.roughness = 1;
    m.maxSimultaneousLights = MAX_MATERIAL_LIGHTS;
    m.enableSpecularAntiAliasing = true;
    m.useHorizonOcclusion = true;
    m.useRadianceOcclusion = true;
    if (spec.alpha === 'cutout') {
      albedo.hasAlpha = true;
      m.useAlphaFromAlbedoTexture = true;
      m.transparencyMode = Material.MATERIAL_ALPHATEST;
      m.alphaCutOff = 0.5;
    } else if (spec.alpha === 'blend') {
      albedo.hasAlpha = true;
      m.useAlphaFromAlbedoTexture = true;
      m.transparencyMode = Material.MATERIAL_ALPHABLEND;
      m.useSpecularOverAlpha = true;
    }
    if (spec.twoSided) {
      m.backFaceCulling = false;
      m.twoSidedLighting = true;
    }
    if (spec.animated) this.animated.push(m);
    return m;
  }

  /** Material for a map material id, or null for 'invisible' / not prepared. */
  get(id: MaterialId): PBRMaterial | null {
    return this.materials.get(id) ?? null;
  }

  has(id: MaterialId): boolean {
    return this.materials.has(id);
  }

  uvScale(id: MaterialId): number {
    return MATERIAL_SPECS[id].uvScale;
  }

  /** Advance animated materials (water ripple scroll). */
  update(dt: number): void {
    for (const m of this.animated) {
      const bump = m.bumpTexture as Texture | null;
      if (!bump) continue;
      bump.uOffset = (bump.uOffset + dt * 0.012) % 1;
      bump.vOffset = (bump.vOffset + dt * 0.008) % 1;
    }
  }

  setAnisotropy(level: number): void {
    for (const t of this.textures) t.anisotropicFilteringLevel = level;
  }

  dispose(): void {
    this.disposed = true;
    for (const m of this.materials.values()) m.dispose(true, false);
    this.materials.clear();
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
    this.animated.length = 0;
  }
}
