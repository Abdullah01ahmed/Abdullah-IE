/**
 * Global client state (zustand). Readable from React (hooks) and from plain
 * game code (`useStore.getState()` / `useStore.subscribe`).
 */
import { create } from 'zustand';
import {
  DEFAULT_LOADOUT,
  MAX_HEALTH,
  type Loadout,
  type MatchResults,
  type MatchStartInfo,
  type RoomState,
  type ScoreboardState,
  type Team,
  type WeaponId,
  type AnnouncementKind,
} from '@tra/shared';
import { DEFAULT_SETTINGS, mergeSettings, type ClientSettings } from './settings';
import { getBridge } from '../platform/bridge';

export type Screen =
  | 'menu'
  | 'host'
  | 'join'
  | 'lobby'
  | 'loading'
  | 'match'
  | 'results'
  | 'settings'
  | 'loadout';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface ConnectionInfo {
  status: ConnectionStatus;
  /** host:port the user typed / we connected to. */
  address: string;
  error: { code: string; message: string } | null;
  ping: number;
  quality: 'good' | 'ok' | 'bad';
}

export interface KillFeedEntry {
  id: number;
  killerId: number;
  killerName: string;
  killerTeam: Team;
  victimId: number;
  victimName: string;
  victimTeam: Team;
  weapon: WeaponId | 'fall' | 'world' | 'melee';
  headshot: boolean;
  time: number;
}

export interface DamageIndicator {
  id: number;
  /** World-space yaw (radians) pointing from the player towards the attacker. */
  yaw: number;
  amount: number;
  time: number;
}

export interface Hitmarker {
  time: number;
  kill: boolean;
  headshot: boolean;
}

export interface Announcement {
  kind: AnnouncementKind;
  team?: Team;
  time: number;
}

export interface HudState {
  health: number;
  maxHealth: number;
  alive: boolean;
  respawnIn: number;
  ammo: number;
  reserve: number;
  weaponIndex: 0 | 1;
  weaponId: WeaponId;
  reloading: boolean;
  ads: boolean;
  sprinting: boolean;
  selfTeam: Team | null;
  teamScore: number;
  enemyScore: number;
  scoreLimit: number;
  timeLeftSec: number;
  killFeed: KillFeedEntry[];
  hitmarker: Hitmarker | null;
  damageIndicators: DamageIndicator[];
  announcement: Announcement | null;
  fps: number;
  /** Yaw of the local camera (radians), published by the game for the compass/indicators. */
  yaw: number;
  /** Player who last killed us (for the death screen). */
  killedBy: { id: number; name: string; weapon: string } | null;
}

export interface ChatMessage {
  id: number;
  from: number;
  name: string;
  team: Team;
  text: string;
  time: number;
}

export interface HostingState {
  starting: boolean;
  running: boolean;
  port: number | null;
  lanAddresses: string[];
  error: string | null;
  log: string[];
}

export interface LoadingState {
  progress: number;
  label: string;
}

export const DEFAULT_HUD: HudState = {
  health: MAX_HEALTH,
  maxHealth: MAX_HEALTH,
  alive: true,
  respawnIn: 0,
  ammo: 0,
  reserve: 0,
  weaponIndex: 0,
  weaponId: 'dijla7',
  reloading: false,
  ads: false,
  sprinting: false,
  selfTeam: null,
  teamScore: 0,
  enemyScore: 0,
  scoreLimit: 0,
  timeLeftSec: 0,
  killFeed: [],
  hitmarker: null,
  damageIndicators: [],
  announcement: null,
  fps: 0,
  yaw: 0,
  killedBy: null,
};

export interface AppState {
  screen: Screen;
  previousScreen: Screen;
  connection: ConnectionInfo;
  selfId: number | null;
  room: RoomState | null;
  match: MatchStartInfo | null;
  scoreboard: ScoreboardState | null;
  results: MatchResults | null;
  hud: HudState;
  paused: boolean;
  scoreboardOpen: boolean;
  chatOpen: boolean;
  chat: ChatMessage[];
  settings: ClientSettings;
  settingsLoaded: boolean;
  hosting: HostingState;
  loading: LoadingState;
  loadout: Loadout;
  /** Bumps whenever settings change so game systems can react. */
  settingsRevision: number;

  // ---- actions --------------------------------------------------------------
  setScreen(screen: Screen): void;
  goBack(): void;
  setConnection(patch: Partial<ConnectionInfo>): void;
  setSelfId(id: number | null): void;
  setRoom(room: RoomState | null): void;
  setMatch(match: MatchStartInfo | null): void;
  setScoreboard(board: ScoreboardState | null): void;
  setResults(results: MatchResults | null): void;
  setHud(patch: Partial<HudState>): void;
  pushKillFeed(entry: Omit<KillFeedEntry, 'id' | 'time'>): void;
  pushDamageIndicator(yaw: number, amount: number): void;
  setHitmarker(kill: boolean, headshot: boolean): void;
  setAnnouncement(kind: AnnouncementKind, team?: Team): void;
  setPaused(paused: boolean): void;
  setScoreboardOpen(open: boolean): void;
  setChatOpen(open: boolean): void;
  pushChat(msg: Omit<ChatMessage, 'id' | 'time'>): void;
  hydrateSettings(saved: unknown): void;
  updateSettings(updater: (s: ClientSettings) => ClientSettings): void;
  setHosting(patch: Partial<HostingState>): void;
  setLoading(progress: number, label: string): void;
  setLoadout(loadout: Loadout): void;
  resetMatchState(): void;
  resetSession(): void;
}

let idCounter = 1;
const nextId = () => idCounter++;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistSettings(settings: ClientSettings): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void getBridge().saveSettings(settings);
  }, 150);
}

export const useStore = create<AppState>()((set, get) => ({
  screen: 'menu',
  previousScreen: 'menu',
  connection: { status: 'idle', address: '', error: null, ping: 0, quality: 'good' },
  selfId: null,
  room: null,
  match: null,
  scoreboard: null,
  results: null,
  hud: { ...DEFAULT_HUD },
  paused: false,
  scoreboardOpen: false,
  chatOpen: false,
  chat: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  settingsLoaded: false,
  hosting: { starting: false, running: false, port: null, lanAddresses: [], error: null, log: [] },
  loading: { progress: 0, label: '' },
  loadout: { ...DEFAULT_LOADOUT },
  settingsRevision: 0,

  setScreen: (screen) => set((s) => (s.screen === screen ? {} : { screen, previousScreen: s.screen })),
  goBack: () => set((s) => ({ screen: s.previousScreen === s.screen ? 'menu' : s.previousScreen, previousScreen: 'menu' })),
  setConnection: (patch) => set((s) => ({ connection: { ...s.connection, ...patch } })),
  setSelfId: (selfId) => set({ selfId }),
  setRoom: (room) => set({ room }),
  setMatch: (match) => set({ match }),
  setScoreboard: (scoreboard) => set({ scoreboard }),
  setResults: (results) => set({ results }),
  setHud: (patch) => set((s) => ({ hud: { ...s.hud, ...patch } })),
  pushKillFeed: (entry) =>
    set((s) => ({
      hud: {
        ...s.hud,
        killFeed: [...s.hud.killFeed.slice(-5), { ...entry, id: nextId(), time: performance.now() }],
      },
    })),
  pushDamageIndicator: (yaw, amount) =>
    set((s) => ({
      hud: {
        ...s.hud,
        damageIndicators: [...s.hud.damageIndicators.slice(-7), { id: nextId(), yaw, amount, time: performance.now() }],
      },
    })),
  setHitmarker: (kill, headshot) => set((s) => ({ hud: { ...s.hud, hitmarker: { time: performance.now(), kill, headshot } } })),
  setAnnouncement: (kind, team) => set((s) => ({ hud: { ...s.hud, announcement: { kind, team, time: performance.now() } } })),
  setPaused: (paused) => set({ paused }),
  setScoreboardOpen: (scoreboardOpen) => set({ scoreboardOpen }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
  pushChat: (msg) => set((s) => ({ chat: [...s.chat.slice(-49), { ...msg, id: nextId(), time: performance.now() }] })),
  hydrateSettings: (saved) => {
    const settings = mergeSettings(saved);
    set((s) => ({ settings, settingsLoaded: true, settingsRevision: s.settingsRevision + 1 }));
    applyDocumentLanguage(settings.language);
  },
  updateSettings: (updater) => {
    const settings = updater(get().settings);
    set((s) => ({ settings, settingsRevision: s.settingsRevision + 1 }));
    applyDocumentLanguage(settings.language);
    persistSettings(settings);
  },
  setHosting: (patch) => set((s) => ({ hosting: { ...s.hosting, ...patch } })),
  setLoading: (progress, label) => set({ loading: { progress, label } }),
  setLoadout: (loadout) => set({ loadout }),
  resetMatchState: () =>
    set({
      hud: { ...DEFAULT_HUD, selfTeam: get().hud.selfTeam },
      scoreboard: null,
      paused: false,
      scoreboardOpen: false,
      chatOpen: false,
    }),
  resetSession: () =>
    set({
      selfId: null,
      room: null,
      match: null,
      scoreboard: null,
      results: null,
      hud: { ...DEFAULT_HUD },
      paused: false,
      scoreboardOpen: false,
      chatOpen: false,
      chat: [],
      loading: { progress: 0, label: '' },
    }),
}));

export function applyDocumentLanguage(language: ClientSettings['language']): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
}

/** Convenience selectors. */
export const selectSelf = (s: AppState) => (s.room && s.selfId != null ? s.room.players.find((p) => p.id === s.selfId) ?? null : null);
export const selectIsHost = (s: AppState) => !!s.room && s.selfId != null && s.room.hostId === s.selfId;
