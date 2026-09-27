/**
 * Lighting and atmosphere for a map: gradient sky + sun sprite, directional sun
 * with cascaded shadows, hemispheric ambient, a tiny procedural reflection
 * cube for PBR, exponential fog, the post-processing chain (FXAA, bloom, ACES
 * tone mapping, exposure, vignette, colour curves), optional SSAO and ambient
 * dust motes. Everything derives from MapDef.atmosphere and the quality
 * profile, and can be re-tuned live through applyQuality().
 */
import {
  AbstractMesh,
  CascadedShadowGenerator,
  Color3,
  Color4,
  ColorCurves,
  Constants,
  DefaultRenderingPipeline,
  DirectionalLight,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  NullEngine,
  ParticleSystem,
  RawCubeTexture,
  SSAO2RenderingPipeline,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
  type AbstractEngine,
  type Camera,
  type RawTexture,
} from '@babylonjs/core';
import type { Atmosphere } from '@tra/shared';
import { createRawRgbaTexture } from './Materials';
import type { QualityProfile } from './quality';
import { generateEnvironmentFaces, generateSkyGradient, generateSoftDisc, generateSunSprite } from './textures';

export interface EnvironmentOptions {
  /** MSAA sample count for the post-process render targets (0/1 = off). */
  msaa: number;
}

/** Rendering group that gets its depth cleared before drawing (first-person view model). */
export const VIEWMODEL_RENDER_GROUP = 2;

export class Environment {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphericLight;
  shadows: ShadowGenerator | null = null;

  private readonly sky: Mesh;
  private readonly sunSprite: Mesh;
  private readonly textures: RawTexture[] = [];
  private envCube: RawCubeTexture | null = null;
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;
  private dust: ParticleSystem | null = null;
  private readonly dustEmitter = new Vector3();
  private readonly casters = new Set<AbstractMesh>();
  private quality: QualityProfile;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly engine: AbstractEngine,
    private readonly camera: Camera,
    readonly atmosphere: Atmosphere,
    quality: QualityProfile,
    private readonly opts: EnvironmentOptions,
  ) {
    this.quality = quality;
    const atm = atmosphere;
    const sunDir = new Vector3(atm.sunDir.x, atm.sunDir.y, atm.sunDir.z).normalize();

    scene.clearColor = new Color4(atm.fogColor[0], atm.fogColor[1], atm.fogColor[2], 1);
    scene.ambientColor = new Color3(atm.ambientColor[0] * 0.25, atm.ambientColor[1] * 0.25, atm.ambientColor[2] * 0.25);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = atm.fogDensity;
    scene.fogColor = new Color3(atm.fogColor[0], atm.fogColor[1], atm.fogColor[2]);
    // The view model is drawn last with a fresh depth buffer so it never clips into walls.
    scene.setRenderingAutoClearDepthStencil(VIEWMODEL_RENDER_GROUP, true, true, true);

    // Sun.
    this.sun = new DirectionalLight('sun', sunDir.scale(-1), scene);
    this.sun.position = sunDir.scale(80);
    this.sun.diffuse = new Color3(atm.sunColor[0], atm.sunColor[1], atm.sunColor[2]);
    this.sun.specular = this.sun.diffuse.clone();
    this.sun.intensity = atm.sunIntensity;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 160;

    // Sky light: sky colour from above, warm bounce from the ground.
    this.hemi = new HemisphericLight('sky', Vector3.Up(), scene);
    this.hemi.diffuse = new Color3(atm.ambientColor[0], atm.ambientColor[1], atm.ambientColor[2]);
    this.hemi.groundColor = new Color3(atm.fogColor[0] * 0.55, atm.fogColor[1] * 0.48, atm.fogColor[2] * 0.4);
    this.hemi.specular = Color3.Black();
    this.hemi.intensity = atm.ambientIntensity * 0.8;

    // Sky dome.
    const skyTex = createRawRgbaTexture(scene, 'sky_gradient', generateSkyGradient(256, atm.skyTop, atm.skyHorizon), 2, 256, { mips: false, clamp: true });
    // Babylon's sphere puts v = 0 at the top; the gradient's row 0 is the nadir.
    skyTex.vScale = -1;
    skyTex.vOffset = 1;
    this.textures.push(skyTex);
    const skyMat = new StandardMaterial('sky', scene);
    skyMat.emissiveTexture = skyTex;
    skyMat.emissiveColor = Color3.White();
    skyMat.diffuseColor = Color3.Black();
    skyMat.specularColor = Color3.Black();
    skyMat.disableLighting = true;
    skyMat.backFaceCulling = false;
    skyMat.fogEnabled = false;
    this.sky = MeshBuilder.CreateSphere('skydome', { diameter: 1800, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    this.sky.material = skyMat;
    this.sky.infiniteDistance = true;
    this.sky.applyFog = false;
    this.sky.isPickable = false;
    this.sky.alwaysSelectAsActiveMesh = true;
    this.sky.doNotSyncBoundingInfo = true;
    skyMat.freeze();

    // Sun sprite: additive billboard far along the sun direction.
    const sunTex = createRawRgbaTexture(scene, 'sun_sprite', generateSunSprite(128), 128, 128, { mips: true, clamp: true });
    sunTex.hasAlpha = true;
    this.textures.push(sunTex);
    const sunMat = new StandardMaterial('sun', scene);
    sunMat.emissiveTexture = sunTex;
    sunMat.opacityTexture = sunTex;
    sunMat.emissiveColor = new Color3(atm.sunColor[0] * 1.6, atm.sunColor[1] * 1.5, atm.sunColor[2] * 1.3);
    sunMat.diffuseColor = Color3.Black();
    sunMat.specularColor = Color3.Black();
    sunMat.disableLighting = true;
    sunMat.alphaMode = Constants.ALPHA_ADD;
    sunMat.fogEnabled = false;
    sunMat.disableDepthWrite = true;
    this.sunSprite = MeshBuilder.CreatePlane('sun_sprite', { size: 90 }, scene);
    this.sunSprite.material = sunMat;
    this.sunSprite.position = sunDir.scale(800);
    this.sunSprite.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.sunSprite.infiniteDistance = true;
    this.sunSprite.applyFog = false;
    this.sunSprite.isPickable = false;
    this.sunSprite.alwaysSelectAsActiveMesh = true;
    sunMat.freeze();

    this.createEnvironmentCube();
    this.createShadows();
    this.createPostProcessing();
    this.createDust();
  }

  // ---------------------------------------------------------------------------
  // Construction helpers
  // ---------------------------------------------------------------------------

  /** Small reflection cube for PBR specular/ambient (skipped on the headless NullEngine, which has no texture upload path). */
  private createEnvironmentCube(): void {
    if (this.engine instanceof NullEngine) return;
    const atm = this.atmosphere;
    try {
      const ground: [number, number, number] = [atm.fogColor[0] * 0.5, atm.fogColor[1] * 0.42, atm.fogColor[2] * 0.32];
      const faces = generateEnvironmentFaces(32, atm.skyTop, atm.skyHorizon, ground, atm.sunDir, atm.sunColor);
      this.envCube = new RawCubeTexture(this.scene, faces, 32, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, true);
      this.scene.environmentTexture = this.envCube;
      this.scene.environmentIntensity = 0.55;
    } catch (e) {
      console.warn('[tra] environment cube unavailable', e);
      this.envCube = null;
    }
  }

  private createShadows(): void {
    const profile = this.quality.shadows;
    this.shadows?.dispose();
    this.shadows = null;
    if (!profile) return;
    let sg: ShadowGenerator;
    if (CascadedShadowGenerator.IsSupported) {
      const csm = new CascadedShadowGenerator(profile.mapSize, this.sun);
      csm.numCascades = profile.cascades;
      csm.lambda = 0.85;
      csm.cascadeBlendPercentage = 0.08;
      csm.shadowMaxZ = 90;
      csm.stabilizeCascades = true;
      csm.depthClamp = true;
      csm.autoCalcDepthBounds = false;
      csm.penumbraDarkness = 0.75;
      csm.bias = 0.004;
      csm.normalBias = 0.03;
      sg = csm;
    } else {
      // Engines without CSM support (NullEngine, WebGL1): plain ortho shadow map.
      sg = new ShadowGenerator(profile.mapSize, this.sun);
      this.sun.autoUpdateExtends = true;
      sg.bias = 0.003;
      sg.normalBias = 0.02;
    }
    if (profile.filter === 'contact') {
      sg.useContactHardeningShadow = true;
      sg.contactHardeningLightSizeUVRatio = 0.06;
    } else {
      sg.usePercentageCloserFiltering = true;
    }
    sg.filteringQuality = profile.quality === 'high' ? ShadowGenerator.QUALITY_HIGH : profile.quality === 'medium' ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
    sg.transparencyShadow = true; // lattice screens cast cut-out shadows
    sg.darkness = 0.15;
    for (const m of this.casters) sg.addShadowCaster(m, false);
    this.shadows = sg;
  }

  private createPostProcessing(): void {
    // `true` also drops the geometry buffer renderer SSAO forced on the scene.
    this.ssao?.dispose(true);
    this.ssao = null;
    this.pipeline?.dispose();
    this.pipeline = null;
    const q = this.quality;
    const atm = this.atmosphere;
    const cameras = [this.camera];
    if (q.ssao) {
      // Created first so its combine pass runs before tone mapping.
      const ssao = new SSAO2RenderingPipeline('tra_ssao', this.scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, cameras, true);
      ssao.radius = 1.1;
      ssao.totalStrength = 1.0;
      ssao.base = 0.12;
      ssao.samples = 12;
      ssao.maxZ = 60;
      ssao.minZAspect = 0.4;
      ssao.expensiveBlur = true;
      ssao.bilateralSamples = 8;
      this.ssao = ssao;
    }
    const p = new DefaultRenderingPipeline('tra_post', true, this.scene, cameras);
    if (this.opts.msaa > 1) p.samples = this.opts.msaa;
    p.fxaaEnabled = q.fxaa;
    p.bloomEnabled = q.bloom;
    p.bloomThreshold = 0.88;
    p.bloomWeight = 0.16;
    p.bloomKernel = 48;
    p.bloomScale = 0.5;
    p.imageProcessingEnabled = true;
    const ip = p.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = atm.exposure;
    ip.contrast = 1.08;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 1.1;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor = new Color4(0.05, 0.03, 0.02, 0);
    ip.vignetteCameraFov = 1.0;
    // Golden-hour grade: a touch more saturation, warm highlights, cooler shadows.
    const curves = new ColorCurves();
    curves.globalSaturation = 12;
    curves.highlightsHue = 40;
    curves.highlightsSaturation = 18;
    curves.highlightsDensity = 8;
    curves.shadowsHue = 215;
    curves.shadowsSaturation = 12;
    curves.shadowsDensity = -6;
    ip.colorCurves = curves;
    ip.colorCurvesEnabled = true;
    this.pipeline = p;
  }

  private createDust(): void {
    this.dust?.dispose();
    this.dust = null;
    const rate = this.quality.dustRate * this.atmosphere.dust;
    if (rate <= 0) return;
    const tex = createRawRgbaTexture(this.scene, 'dust_mote', generateSoftDisc(32, 0.2), 32, 32, { mips: true, clamp: true });
    tex.hasAlpha = true;
    this.textures.push(tex);
    const ps = new ParticleSystem('dust', Math.ceil(rate * 10), this.scene);
    ps.particleTexture = tex;
    ps.emitter = this.dustEmitter;
    ps.minEmitBox = new Vector3(-14, -2, -14);
    ps.maxEmitBox = new Vector3(14, 5, 14);
    ps.direction1 = new Vector3(-0.15, -0.05, -0.15);
    ps.direction2 = new Vector3(0.15, 0.08, 0.15);
    ps.minEmitPower = 0.2;
    ps.maxEmitPower = 0.6;
    ps.minSize = 0.012;
    ps.maxSize = 0.035;
    ps.minLifeTime = 6;
    ps.maxLifeTime = 10;
    ps.emitRate = rate;
    ps.gravity = new Vector3(0, -0.04, 0);
    const c = this.atmosphere.sunColor;
    ps.color1 = new Color4(c[0], c[1] * 0.95, c[2] * 0.85, 0.32);
    ps.color2 = new Color4(1, 0.96, 0.9, 0.22);
    ps.colorDead = new Color4(1, 0.9, 0.8, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.preWarmCycles = 120;
    ps.preWarmStepOffset = 5;
    ps.start();
    this.dust = ps;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Register a shadow caster (kept across shadow rebuilds). */
  addShadowCaster(mesh: AbstractMesh): void {
    this.casters.add(mesh);
    this.shadows?.addShadowCaster(mesh, false);
  }

  removeShadowCaster(mesh: AbstractMesh): void {
    this.casters.delete(mesh);
    this.shadows?.removeShadowCaster(mesh, false);
  }

  /** Re-tune everything that can change at runtime. */
  applyQuality(quality: QualityProfile): void {
    const prev = this.quality;
    this.quality = quality;
    const shadowsChanged = JSON.stringify(prev.shadows) !== JSON.stringify(quality.shadows);
    if (shadowsChanged) this.createShadows();
    if (prev.ssao !== quality.ssao) {
      this.createPostProcessing();
    } else if (this.pipeline) {
      this.pipeline.fxaaEnabled = quality.fxaa;
      this.pipeline.bloomEnabled = quality.bloom;
    }
    if (prev.dustRate !== quality.dustRate) this.createDust();
  }

  /** Per-frame: keep the dust volume around the camera. */
  update(cameraPosition: Vector3): void {
    this.dustEmitter.copyFrom(cameraPosition);
  }

  get postProcessing(): DefaultRenderingPipeline | null {
    return this.pipeline;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dust?.dispose();
    this.ssao?.dispose(true);
    this.pipeline?.dispose();
    this.shadows?.dispose();
    this.casters.clear();
    this.sunSprite.material?.dispose();
    this.sunSprite.dispose();
    this.sky.material?.dispose();
    this.sky.dispose();
    for (const t of this.textures) t.dispose();
    if (this.envCube) {
      if (this.scene.environmentTexture === this.envCube) this.scene.environmentTexture = null;
      this.envCube.dispose();
    }
    this.sun.dispose();
    this.hemi.dispose();
    this.scene.fogMode = Scene.FOGMODE_NONE;
  }
}
