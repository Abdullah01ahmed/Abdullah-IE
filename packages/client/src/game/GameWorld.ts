/**
 * GameWorld: owns the Babylon engine and scene for the lifetime of the app,
 * builds every per-match system on loadMatch (materials → environment → map →
 * effects → view model → remote players → local player → audio) and tears
 * them down on unloadMatch. Drives the render loop, routes snapshots and
 * events, applies settings live and survives GPU context loss.
 *
 * Settings that need an engine restart (msaa sample count for the back
 * buffer, WebGPU vs WebGL2) are read when the engine is created; everything
 * else is applied live in applySettings().
 */
import {
  AbstractEngine,
  Camera,
  Color4,
  Engine,
  FreeCamera,
  Scene,
  Vector3,
  WebGPUEngine,
} from '@babylonjs/core';
import {
  DEFAULT_LOADOUT,
  buildCollisionWorld,
  getMapOrDefault,
  traceShot,
  type CollisionWorld,
  type GameEvent,
  type InputCmd,
  type MapDef,
  type MatchResults,
  type MatchStartInfo,
  type RoomState,
  type Snapshot,
  type Team,
  type WeaponId,
} from '@tra/shared';
import { useStore } from '../state/store';
import type { ClientSettings } from '../state/settings';
import { GameAudio } from './Audio';
import { Effects } from './Effects';
import { Environment } from './Environment';
import { InputManager } from './Input';
import { LocalPlayer } from './LocalPlayer';
import { MapRenderer } from './MapRenderer';
import { MaterialLibrary } from './Materials';
import { prepareProps } from './Props';
import { RemotePlayers } from './RemotePlayers';
import { ViewModel } from './ViewModel';
import { deriveQuality, type QualityProfile } from './quality';
import type { GameWorldDeps, IGameWorld } from './types';

export interface GameWorldOptions {
  /** Test hook: supply the engine (e.g. a NullEngine) instead of creating one from the canvas. */
  engineFactory?: (canvas: HTMLCanvasElement, settings: ClientSettings) => Promise<AbstractEngine>;
  /**
   * Upper bound on the shader warm-up wait at the end of loadMatch (ms). Shaders
   * that are still compiling simply skip a frame or two; a headless engine never
   * reports ready at all, so tests pass 0.
   */
  readyTimeoutMs?: number;
}

const DEFAULT_READY_TIMEOUT_MS = 6000;

interface MatchSystems {
  info: MatchStartInfo;
  selfId: number;
  map: MapDef;
  world: CollisionWorld;
  materials: MaterialLibrary;
  environment: Environment;
  mapRenderer: MapRenderer;
  effects: Effects;
  viewModel: ViewModel;
  remotes: RemotePlayers;
  local: LocalPlayer;
  input: InputManager;
  selfTeam: Team | null;
  ended: boolean;
}

/** How long to wait for the browser to restore a lost context before restarting the engine (ms). */
const CONTEXT_RESTORE_GRACE_MS = 3000;

export class GameWorld implements IGameWorld {
  private canvas: HTMLCanvasElement | null = null;
  private engine: AbstractEngine | null = null;
  private scene: Scene | null = null;
  private camera: FreeCamera | null = null;
  private match: MatchSystems | null = null;
  private loading: { info: MatchStartInfo; selfId: number; room: RoomState } | null = null;
  private lastRoom: RoomState | null = null;
  private readonly audio = new GameAudio();
  private settings: ClientSettings;
  private quality: QualityProfile;
  private paused = false;
  private lockListeners = new Set<(locked: boolean) => void>();
  private unsubscribeStore: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastFrame = 0;
  private fpsTimer = 0;
  private contextLostTimer: ReturnType<typeof setTimeout> | null = null;
  private restartedOnce = false;
  private renderLoopRunning = false;
  private readonly frameFn = () => this.frame();
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();

  constructor(
    private readonly deps: GameWorldDeps,
    private readonly options: GameWorldOptions = {},
  ) {
    this.settings = useStore.getState().settings;
    this.quality = deriveQuality(this.settings.graphics);
  }

  // ---------------------------------------------------------------------------
  // Engine lifecycle
  // ---------------------------------------------------------------------------

  async attach(canvas: HTMLCanvasElement): Promise<void> {
    if (this.engine) return;
    this.canvas = canvas;
    this.settings = useStore.getState().settings;
    this.quality = deriveQuality(this.settings.graphics);
    const engine = await this.createEngine(canvas, this.settings);
    this.engine = engine;
    engine.setHardwareScalingLevel(1 / this.settings.graphics.renderScale);
    engine.onContextLostObservable.add(() => this.onContextLost());
    engine.onContextRestoredObservable.add(() => this.onContextRestored());

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.02, 0.02, 0.03, 1);
    scene.skipPointerMovePicking = true;
    scene.autoClear = true;
    scene.autoClearDepthAndStencil = true;
    this.scene = scene;
    const camera = new FreeCamera('player', new Vector3(0, 1.6, 0), scene);
    camera.minZ = 0.05;
    camera.maxZ = 700;
    camera.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
    camera.inputs.clear();
    scene.activeCamera = camera;
    this.camera = camera;

    this.unsubscribeStore = useStore.subscribe((state, prev) => {
      if (state.settingsRevision !== prev.settingsRevision) this.applySettings(state.settings);
      if (state.paused !== prev.paused) this.setPaused(state.paused);
      if (state.hud.hitmarker !== prev.hud.hitmarker && state.hud.hitmarker) {
        this.audio.hitmarker(state.hud.hitmarker.kill, state.hud.hitmarker.headshot);
      }
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    }
    this.audio.setVolumes(this.settings.audio);
    this.clearCanvas();
  }

  private async createEngine(canvas: HTMLCanvasElement, settings: ClientSettings): Promise<AbstractEngine> {
    if (this.options.engineFactory) return this.options.engineFactory(canvas, settings);
    const g = settings.graphics;
    if (g.webgpu) {
      try {
        if (await WebGPUEngine.IsSupportedAsync) {
          const e = new WebGPUEngine(canvas, { antialias: g.msaa > 0, adaptToDeviceRatio: false, powerPreference: 'high-performance' });
          await e.initAsync();
          return e;
        }
      } catch (err) {
        console.warn('[tra] WebGPU unavailable, falling back to WebGL2', err);
      }
    }
    return new Engine(canvas, g.msaa > 0, { preserveDrawingBuffer: false, stencil: true, powerPreference: 'high-performance', antialias: g.msaa > 0 }, false);
  }

  private onContextLost(): void {
    console.warn('[tra] GPU context lost');
    if (this.contextLostTimer) clearTimeout(this.contextLostTimer);
    this.contextLostTimer = setTimeout(() => {
      this.contextLostTimer = null;
      void this.restartEngine();
    }, CONTEXT_RESTORE_GRACE_MS);
  }

  private onContextRestored(): void {
    console.info('[tra] GPU context restored');
    if (this.contextLostTimer) {
      clearTimeout(this.contextLostTimer);
      this.contextLostTimer = null;
    }
  }

  /** Full engine rebuild after an unrecoverable context loss (attempted once). */
  private async restartEngine(): Promise<void> {
    if (this.restartedOnce || !this.canvas) return;
    this.restartedOnce = true;
    console.warn('[tra] restarting the render engine');
    const current = this.match ? { info: this.match.info, selfId: this.match.selfId, room: this.lastRoom } : null;
    const canvas = this.canvas;
    this.disposeEngine();
    try {
      await this.attach(canvas);
      if (current && current.room) await this.loadMatch(current.info, current.selfId, current.room, () => undefined);
    } catch (err) {
      console.error('[tra] engine restart failed', err);
    }
  }

  private disposeEngine(): void {
    this.unloadMatch();
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.stopLoop();
    this.scene?.dispose();
    this.scene = null;
    this.camera = null;
    this.engine?.dispose();
    this.engine = null;
  }

  dispose(): void {
    if (this.contextLostTimer) clearTimeout(this.contextLostTimer);
    this.contextLostTimer = null;
    this.disposeEngine();
    this.audio.dispose();
    this.lockListeners.clear();
    this.canvas = null;
  }

  // ---------------------------------------------------------------------------
  // Match lifecycle
  // ---------------------------------------------------------------------------

  async loadMatch(info: MatchStartInfo, selfId: number, room: RoomState, onProgress: (progress: number, label: string) => void): Promise<void> {
    if (!this.engine || !this.scene || !this.camera || !this.canvas) throw new Error('GameWorld.attach() must complete before loadMatch()');
    if (this.match) this.unloadMatch();
    this.loading = { info, selfId, room };
    this.lastRoom = room;
    const scene = this.scene;
    const engine = this.engine;
    const camera = this.camera;
    const settings = useStore.getState().settings;
    this.settings = settings;
    this.quality = deriveQuality(settings.graphics);
    const q = this.quality;
    const map = getMapOrDefault(info.mapId);
    const world = buildCollisionWorld(map);
    const cancelled = () => this.loading?.info !== info;

    onProgress(0.03, 'Preparing materials');
    const materials = new MaterialLibrary(scene, { textureSize: q.textureSize, anisotropy: q.anisotropy });
    const fontsReady = prepareProps();
    await materials.prepare(MapRenderer.usedMaterials(map), (done, total) => onProgress(0.03 + (done / total) * 0.45, 'Generating materials'));
    if (cancelled()) {
      materials.dispose();
      return;
    }
    await fontsReady;

    onProgress(0.5, 'Lighting');
    const environment = new Environment(scene, engine, camera, map.atmosphere, q, { msaa: settings.graphics.msaa });
    onProgress(0.55, 'Building the map');
    const mapRenderer = new MapRenderer(scene, map, materials, environment, q);
    await nextFrame();
    if (cancelled()) {
      mapRenderer.dispose();
      environment.dispose();
      materials.dispose();
      return;
    }

    onProgress(0.78, 'Weapons and characters');
    const effects = new Effects(scene, world, q);
    const self = room.players.find((p) => p.id === selfId);
    const loadout = self?.loadout ?? DEFAULT_LOADOUT;
    const viewModel = new ViewModel(scene, camera, [loadout.primary, loadout.secondary]);
    viewModel.setTeam(self?.team ?? null);
    const remotes = new RemotePlayers(scene, world, environment, this.audio, selfId);
    remotes.syncRoom(room);

    const input = new InputManager(this.canvas, settings.controls.bindings, settings.controls);
    input.onLockChange = (locked) => {
      for (const cb of this.lockListeners) cb(locked);
    };
    input.onGesture = () => this.audio.resume();
    input.onCanvasClick = () => {
      if (!this.paused && this.match && !this.match.ended) this.requestPointerLock();
    };

    const local = new LocalPlayer({
      scene,
      camera,
      world,
      input,
      viewModel,
      effects,
      audio: this.audio,
      remotes,
      sendInputs: (cmds: InputCmd[]) => this.deps.sendInputs(cmds),
      serverNow: () => this.deps.serverNow(),
      matchSeed: info.seed,
      selfId,
      friendlyFire: info.settings.friendlyFire,
      inputBlocked: () => this.inputBlocked(),
      aspect: () => engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()),
    });

    this.match = {
      info, selfId, map, world, materials, environment, mapRenderer, effects, viewModel, remotes, local, input,
      selfTeam: self?.team ?? null, ended: false,
    };
    this.loading = null;

    onProgress(0.9, 'Compiling shaders');
    engine.setHardwareScalingLevel(1 / settings.graphics.renderScale);
    this.audio.setVolumes(settings.audio);
    this.audio.startAmbience(map.atmosphere.ambience);
    await waitForSceneReady(scene, this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
    if (this.match?.info !== info) return; // unloaded while waiting
    onProgress(1, 'Ready');
    this.lastFrame = performance.now();
    this.startLoop();
  }

  unloadMatch(): void {
    this.loading = null;
    const m = this.match;
    if (!m) return;
    this.match = null;
    this.stopLoop();
    m.input.dispose();
    m.local.dispose();
    m.remotes.dispose();
    m.viewModel.dispose();
    m.effects.dispose();
    m.mapRenderer.dispose();
    m.environment.dispose();
    m.materials.dispose();
    this.audio.stopAmbience();
    this.audio.setIndoor(false);
    if (this.camera) {
      this.camera.position.set(0, 1.6, 0);
      this.camera.rotation.set(0, 0, 0);
    }
    this.clearCanvas();
  }

  onRoom(room: RoomState): void {
    this.lastRoom = room;
    const m = this.match;
    if (!m) return;
    m.remotes.syncRoom(room);
    const self = room.players.find((p) => p.id === m.selfId);
    const team = self?.team ?? null;
    if (team !== m.selfTeam) {
      m.selfTeam = team;
      m.viewModel.setTeam(team);
    }
  }

  onSnapshot(snap: Snapshot): void {
    const m = this.match;
    if (!m) return;
    m.local.onSnapshot(snap);
    m.remotes.onSnapshot(snap);
    for (const e of snap.events) this.handleEvent(m, e);
  }

  onMatchEnd(_results: MatchResults): void {
    const m = this.match;
    if (!m) return;
    m.ended = true;
    m.local.setFrozen(true);
    m.input.setEnabled(false);
    m.input.exitPointerLock();
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  private handleEvent(m: MatchSystems, e: GameEvent): void {
    switch (e.e) {
      case 'fire': {
        if (e.id === m.selfId) break;
        const origin = this.tmpA.set(e.o[0], e.o[1], e.o[2]);
        const dir = this.tmpB.set(e.d[0], e.d[1], e.d[2]);
        const muzzle = m.remotes.muzzleOf(e.id, this.tmpC) ? this.tmpC : origin;
        m.effects.muzzleFlash(muzzle, dir, e.w, false);
        const hit = traceShot(m.world, { x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z }, 200, []);
        const end = hit.kind === 'none' ? hit.end : hit.point;
        m.effects.tracer(muzzle, this.tmpA.set(end.x, end.y, end.z));
        this.audio.gunshot(e.w, { x: e.o[0], y: e.o[1], z: e.o[2] });
        break;
      }
      case 'impact': {
        if (m.local.isRecentOwnImpact(e.p[0], e.p[1], e.p[2], performance.now())) break;
        m.effects.impact(this.tmpA.set(e.p[0], e.p[1], e.p[2]), this.tmpB.set(e.n[0], e.n[1], e.n[2]), e.m);
        break;
      }
      case 'dmg':
        if (e.to === m.selfId) {
          this.audio.damageTaken(e.amt);
          m.local.rig.kick(0, 0, 0, 10, this.settings.graphics.reduceCameraShake ? 0.1 : 0.25);
        }
        break;
      case 'announce': {
        const own = e.team ? e.team === m.selfTeam : true;
        this.audio.announce(e.k, own);
        break;
      }
      case 'death':
      case 'spawn':
      case 'reload':
      case 'switch':
        if (e.id !== m.selfId) m.remotes.onEvent(e);
        break;
      case 'footstep':
        // Remote footsteps are derived locally from interpolated motion.
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Input / pause / pointer lock
  // ---------------------------------------------------------------------------

  private inputBlocked(): boolean {
    const s = useStore.getState();
    const m = this.match;
    return this.paused || s.chatOpen || !m || m.ended || !m.input.isLocked;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    const m = this.match;
    if (!m) return;
    if (paused) {
      m.input.setEnabled(false);
      m.input.exitPointerLock();
    } else if (!m.ended) {
      m.input.setEnabled(true);
    }
  }

  requestPointerLock(): void {
    const m = this.match;
    if (!m || this.paused || m.ended) return;
    m.input.setEnabled(true);
    m.input.requestPointerLock();
    this.audio.resume();
  }

  isPointerLocked(): boolean {
    return this.match?.input.isLocked ?? false;
  }

  onPointerLock(cb: (locked: boolean) => void): () => void {
    this.lockListeners.add(cb);
    return () => this.lockListeners.delete(cb);
  }

  // ---------------------------------------------------------------------------
  // Settings / resize
  // ---------------------------------------------------------------------------

  applySettings(settings: ClientSettings): void {
    this.settings = settings;
    const q = deriveQuality(settings.graphics);
    const prevQ = this.quality;
    this.quality = q;
    this.engine?.setHardwareScalingLevel(1 / settings.graphics.renderScale);
    this.audio.setVolumes(settings.audio);
    const m = this.match;
    if (!m) return;
    m.input.setBindings(settings.controls.bindings, settings.controls);
    m.environment.applyQuality(q);
    m.mapRenderer.applyQuality(q);
    m.effects.applyQuality(q);
    if (prevQ.anisotropy !== q.anisotropy) m.materials.setAnisotropy(q.anisotropy);
    // textureQuality / msaa / webgpu: picked up on the next match load / engine creation.
  }

  resize(): void {
    this.engine?.resize();
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  private startLoop(): void {
    if (!this.engine || this.renderLoopRunning) return;
    this.renderLoopRunning = true;
    this.engine.runRenderLoop(this.frameFn);
  }

  private stopLoop(): void {
    if (!this.engine || !this.renderLoopRunning) return;
    this.renderLoopRunning = false;
    this.engine.stopRenderLoop(this.frameFn);
  }

  private clearCanvas(): void {
    const engine = this.engine;
    const scene = this.scene;
    if (!engine || !scene) return;
    engine.clear(scene.clearColor, true, true, true);
  }

  /** One frame: advance every system and render. Tests call it directly with an explicit clock. */
  frame(now: number = performance.now()): void {
    const m = this.match;
    const engine = this.engine;
    const scene = this.scene;
    const camera = this.camera;
    if (!m || !engine || !scene || !camera) return;
    const maxFps = this.settings.graphics.maxFps;
    if (maxFps > 0 && now - this.lastFrame < 1000 / maxFps - 0.5) return;
    const dt = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    m.local.update(dt);
    m.remotes.update(dt, this.deps.serverNow(), camera.position);
    m.effects.update(dt);
    m.materials.update(dt);
    m.mapRenderer.update(dt, camera.position);
    m.environment.update(camera.position);

    // Audio listener follows the camera.
    const fwd = camera.getDirection(Vector3.Forward());
    const up = camera.getDirection(Vector3.Up());
    this.audio.setListener(
      { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      { x: fwd.x, y: fwd.y, z: fwd.z },
      { x: up.x, y: up.y, z: up.z },
    );

    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.25) {
      this.fpsTimer = 0;
      const store = useStore.getState();
      const fps = this.settings.graphics.showFps ? Math.round(engine.getFps()) : 0;
      if (store.hud.fps !== fps) store.setHud({ fps });
    }
    scene.render();
  }

  /** Diagnostics for tests. */
  get debug() {
    const m = this.match;
    return {
      hasMatch: !!m,
      scene: this.scene,
      engine: this.engine,
      remoteCount: m?.remotes.count ?? 0,
      localState: m?.local.state ?? null,
      activeWeapon: m?.viewModel.activeWeapon ?? null,
      staticMeshes: m?.mapRenderer.staticMeshes.length ?? 0,
      activeWeaponId: (m?.local.state?.weapons[m.local.state.weaponIndex].id ?? null) as WeaponId | null,
      activeTracers: m?.effects.activeTracers ?? 0,
      activeDecals: m?.effects.activeDecals ?? 0,
      viewModelVisible: m?.viewModel.root.isEnabled() ?? false,
      localAlive: m?.local.isAlive ?? false,
      inputBlocked: m ? this.inputBlocked() : true,
      appliedRenderScale: this.settings.graphics.renderScale,
      shadowsEnabled: !!m?.environment.shadows,
    };
  }
}

/** Resolve when the scene's materials/textures are ready, or after `timeoutMs`. */
function waitForSceneReady(scene: Scene, timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0 || scene.isReady()) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      console.info('[tra] shader warm-up still running; continuing');
      finish();
    }, timeoutMs);
    scene.executeWhenReady(finish);
  });
}

/** Yield to the event loop so the loading screen can paint between heavy steps. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
