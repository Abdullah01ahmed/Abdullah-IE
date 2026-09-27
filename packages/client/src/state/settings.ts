/**
 * Client settings (graphics, audio, controls, language). Persisted through the
 * desktop bridge (userData/settings.json in Electron, localStorage in a browser).
 */

export type Language = 'en' | 'ar';

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high' | 'ultra';
export type Quality3 = 'low' | 'medium' | 'high';

export interface GraphicsSettings {
  preset: GraphicsPreset;
  /** Render resolution scale (0.5–1.5). */
  renderScale: number;
  shadows: ShadowQuality;
  ssao: boolean;
  bloom: boolean;
  fxaa: boolean;
  msaa: 0 | 2 | 4 | 8;
  textureQuality: Quality3;
  particles: Quality3;
  anisotropy: 1 | 4 | 8 | 16;
  /** Horizontal field of view in degrees (60–120). */
  fov: number;
  vsync: boolean;
  /** 0 = unlimited. */
  maxFps: number;
  reduceCameraShake: boolean;
  showFps: boolean;
  /** Prefer WebGPU when available. */
  webgpu: boolean;
}

export interface AudioSettings {
  master: number;
  effects: number;
  music: number;
  ui: number;
  announcer: number;
}

export type GameAction =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'crouch' | 'sprint'
  | 'fire' | 'ads' | 'reload' | 'switch' | 'weapon1' | 'weapon2'
  | 'melee' | 'lethal' | 'tactical' | 'interact'
  | 'scoreboard' | 'pause' | 'chat';

export const GAME_ACTIONS: readonly GameAction[] = [
  'forward', 'back', 'left', 'right', 'jump', 'crouch', 'sprint',
  'fire', 'ads', 'reload', 'switch', 'weapon1', 'weapon2',
  'melee', 'lethal', 'tactical', 'interact', 'scoreboard', 'pause', 'chat',
];

/**
 * Bindings use KeyboardEvent.code values ('KeyW', 'Space', 'ShiftLeft'),
 * 'Mouse0'..'Mouse4' for mouse buttons and 'WheelUp'/'WheelDown'.
 */
export interface ControlSettings {
  /** Hip-fire sensitivity (degrees per mouse count × 0.022 style multiplier). */
  sensitivity: number;
  /** Multiplier applied while aiming down sights. */
  adsSensitivityMult: number;
  invertY: boolean;
  toggleAds: boolean;
  toggleCrouch: boolean;
  toggleSprint: boolean;
  bindings: Record<GameAction, string[]>;
}

export interface ClientSettings {
  version: number;
  language: Language;
  playerName: string;
  graphics: GraphicsSettings;
  audio: AudioSettings;
  controls: ControlSettings;
  lastJoinAddress: string;
  lastHostPort: number;
  lastServerName: string;
}

export const SETTINGS_VERSION = 1;

export const DEFAULT_BINDINGS: Record<GameAction, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  sprint: ['ShiftLeft'],
  fire: ['Mouse0'],
  ads: ['Mouse2'],
  reload: ['KeyR'],
  switch: ['KeyQ', 'WheelDown', 'WheelUp'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  melee: ['KeyV', 'Mouse1'],
  lethal: ['KeyG'],
  tactical: ['KeyF'],
  interact: ['KeyE'],
  scoreboard: ['Tab'],
  pause: ['Escape'],
  chat: ['KeyT', 'Enter'],
};

type PresetValues = Pick<GraphicsSettings, 'renderScale' | 'shadows' | 'ssao' | 'bloom' | 'fxaa' | 'msaa' | 'textureQuality' | 'particles' | 'anisotropy'>;

export const GRAPHICS_PRESETS: Record<Exclude<GraphicsPreset, 'custom'>, PresetValues> = {
  low: { renderScale: 0.8, shadows: 'off', ssao: false, bloom: false, fxaa: true, msaa: 0, textureQuality: 'low', particles: 'low', anisotropy: 1 },
  medium: { renderScale: 1, shadows: 'low', ssao: false, bloom: true, fxaa: true, msaa: 0, textureQuality: 'medium', particles: 'medium', anisotropy: 4 },
  high: { renderScale: 1, shadows: 'medium', ssao: true, bloom: true, fxaa: true, msaa: 4, textureQuality: 'high', particles: 'high', anisotropy: 8 },
  ultra: { renderScale: 1, shadows: 'ultra', ssao: true, bloom: true, fxaa: true, msaa: 8, textureQuality: 'high', particles: 'high', anisotropy: 16 },
};

export const DEFAULT_SETTINGS: ClientSettings = {
  version: SETTINGS_VERSION,
  language: 'en',
  playerName: '',
  graphics: {
    preset: 'high',
    ...GRAPHICS_PRESETS.high,
    fov: 90,
    vsync: true,
    maxFps: 0,
    reduceCameraShake: false,
    showFps: false,
    webgpu: true,
  },
  audio: { master: 0.8, effects: 0.8, music: 0.5, ui: 0.7, announcer: 0.8 },
  controls: {
    sensitivity: 5,
    adsSensitivityMult: 0.8,
    invertY: false,
    toggleAds: false,
    toggleCrouch: false,
    toggleSprint: false,
    bindings: DEFAULT_BINDINGS,
  },
  lastJoinAddress: '127.0.0.1',
  lastHostPort: 27600,
  lastServerName: '',
};

/** Apply a preset's values onto graphics settings. */
export function applyGraphicsPreset(g: GraphicsSettings, preset: GraphicsPreset): GraphicsSettings {
  if (preset === 'custom') return { ...g, preset };
  return { ...g, ...GRAPHICS_PRESETS[preset], preset };
}

/** Which preset (if any) exactly matches the given graphics values. */
export function detectPreset(g: GraphicsSettings): GraphicsPreset {
  for (const [name, values] of Object.entries(GRAPHICS_PRESETS) as [Exclude<GraphicsPreset, 'custom'>, PresetValues][]) {
    if ((Object.keys(values) as (keyof PresetValues)[]).every((k) => values[k] === g[k])) return name;
  }
  return 'custom';
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function num(v: unknown, d: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
}

function bool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}

function oneOf<T extends string | number>(v: unknown, allowed: readonly T[], d: T): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : d;
}

/** Validate and merge persisted settings over the defaults (tolerates old/partial data). */
export function mergeSettings(saved: unknown): ClientSettings {
  const d = DEFAULT_SETTINGS;
  if (!isObj(saved)) return structuredClone(d);
  const g = isObj(saved.graphics) ? saved.graphics : {};
  const a = isObj(saved.audio) ? saved.audio : {};
  const c = isObj(saved.controls) ? saved.controls : {};
  const b = isObj(c.bindings) ? c.bindings : {};
  const bindings = { ...DEFAULT_BINDINGS } as Record<GameAction, string[]>;
  for (const action of GAME_ACTIONS) {
    const v = b[action];
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) bindings[action] = v.slice(0, 3);
  }
  const graphics: GraphicsSettings = {
    preset: oneOf(g.preset, ['low', 'medium', 'high', 'ultra', 'custom'] as const, d.graphics.preset),
    renderScale: num(g.renderScale, d.graphics.renderScale, 0.5, 1.5),
    shadows: oneOf(g.shadows, ['off', 'low', 'medium', 'high', 'ultra'] as const, d.graphics.shadows),
    ssao: bool(g.ssao, d.graphics.ssao),
    bloom: bool(g.bloom, d.graphics.bloom),
    fxaa: bool(g.fxaa, d.graphics.fxaa),
    msaa: oneOf(g.msaa, [0, 2, 4, 8] as const, d.graphics.msaa),
    textureQuality: oneOf(g.textureQuality, ['low', 'medium', 'high'] as const, d.graphics.textureQuality),
    particles: oneOf(g.particles, ['low', 'medium', 'high'] as const, d.graphics.particles),
    anisotropy: oneOf(g.anisotropy, [1, 4, 8, 16] as const, d.graphics.anisotropy),
    fov: num(g.fov, d.graphics.fov, 60, 120),
    vsync: bool(g.vsync, d.graphics.vsync),
    maxFps: num(g.maxFps, d.graphics.maxFps, 0, 1000),
    reduceCameraShake: bool(g.reduceCameraShake, d.graphics.reduceCameraShake),
    showFps: bool(g.showFps, d.graphics.showFps),
    webgpu: bool(g.webgpu, d.graphics.webgpu),
  };
  return {
    version: SETTINGS_VERSION,
    language: oneOf(saved.language, ['en', 'ar'] as const, d.language),
    playerName: typeof saved.playerName === 'string' ? saved.playerName.slice(0, 20) : d.playerName,
    graphics,
    audio: {
      master: num(a.master, d.audio.master, 0, 1),
      effects: num(a.effects, d.audio.effects, 0, 1),
      music: num(a.music, d.audio.music, 0, 1),
      ui: num(a.ui, d.audio.ui, 0, 1),
      announcer: num(a.announcer, d.audio.announcer, 0, 1),
    },
    controls: {
      sensitivity: num(c.sensitivity, d.controls.sensitivity, 0.1, 30),
      adsSensitivityMult: num(c.adsSensitivityMult, d.controls.adsSensitivityMult, 0.1, 3),
      invertY: bool(c.invertY, d.controls.invertY),
      toggleAds: bool(c.toggleAds, d.controls.toggleAds),
      toggleCrouch: bool(c.toggleCrouch, d.controls.toggleCrouch),
      toggleSprint: bool(c.toggleSprint, d.controls.toggleSprint),
      bindings,
    },
    lastJoinAddress: typeof saved.lastJoinAddress === 'string' ? saved.lastJoinAddress.slice(0, 120) : d.lastJoinAddress,
    lastHostPort: num(saved.lastHostPort, d.lastHostPort, 1024, 65535),
    lastServerName: typeof saved.lastServerName === 'string' ? saved.lastServerName.slice(0, 40) : d.lastServerName,
  };
}
