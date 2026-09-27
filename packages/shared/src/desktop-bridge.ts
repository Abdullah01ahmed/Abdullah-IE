/**
 * Contract between the Electron preload script (which exposes `window.tra`)
 * and the renderer. The client falls back to a browser implementation when
 * `window.tra` is absent (development in a plain browser tab).
 */
import type { MatchSettings } from './protocol';

export interface HostServerOptions {
  port: number;
  password?: string;
  serverName?: string;
  /** Initial lobby settings. */
  settings?: Partial<MatchSettings>;
}

export interface HostServerResult {
  ok: boolean;
  port?: number;
  /** Machine-readable error (e.g. 'PORT_IN_USE', 'NOT_AVAILABLE', 'SPAWN_FAILED'). */
  error?: string;
  message?: string;
  lanAddresses?: string[];
}

export interface ServerStatus {
  running: boolean;
  port: number | null;
  pid?: number;
}

export interface DesktopBridge {
  /** True inside Electron. */
  isElectron: boolean;
  /** App version string. */
  version: string;
  /** 'win32' | 'linux' | 'darwin' | 'browser'. */
  platform: string;

  loadSettings(): Promise<unknown | null>;
  saveSettings(data: unknown): Promise<void>;
  loadProfile(): Promise<unknown | null>;
  saveProfile(data: unknown): Promise<void>;

  /** Start the embedded server process. Resolves once it is listening (or failed). */
  startServer(opts: HostServerOptions): Promise<HostServerResult>;
  stopServer(): Promise<void>;
  serverStatus(): Promise<ServerStatus>;
  /** Subscribe to server log lines; returns an unsubscribe function. */
  onServerLog(cb: (line: string) => void): () => void;
  /** Subscribe to server exit; returns an unsubscribe function. */
  onServerExit(cb: (info: { code: number | null }) => void): () => void;

  /** IPv4 addresses of this machine's network interfaces (for the host screen). */
  getLanAddresses(): Promise<string[]>;

  setFullscreen(on: boolean): Promise<void>;
  toggleFullscreen(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  quit(): Promise<void>;
  openExternal(url: string): Promise<void>;
  getUserDataPath(): Promise<string>;
}

declare global {
  interface Window {
    tra?: DesktopBridge;
  }
}

export const BRIDGE_CHANNELS = {
  settingsLoad: 'tra:settings:load',
  settingsSave: 'tra:settings:save',
  profileLoad: 'tra:profile:load',
  profileSave: 'tra:profile:save',
  serverStart: 'tra:server:start',
  serverStop: 'tra:server:stop',
  serverStatus: 'tra:server:status',
  serverLog: 'tra:server:log',
  serverExit: 'tra:server:exit',
  lanAddresses: 'tra:net:lan-addresses',
  setFullscreen: 'tra:window:set-fullscreen',
  toggleFullscreen: 'tra:window:toggle-fullscreen',
  isFullscreen: 'tra:window:is-fullscreen',
  quit: 'tra:app:quit',
  openExternal: 'tra:app:open-external',
  userDataPath: 'tra:app:user-data-path',
} as const;
