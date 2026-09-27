/**
 * Access to the desktop bridge (`window.tra`, provided by the Electron preload)
 * with a browser fallback for development in a plain tab.
 */
import type { DesktopBridge, HostServerOptions, HostServerResult, ServerStatus } from '@tra/shared';
import { GAME_VERSION } from '@tra/shared';

const LS_SETTINGS = 'tra.settings';
const LS_PROFILE = 'tra.profile';

function lsGet(key: string): unknown | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function lsSet(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* ignore quota / private mode */
  }
}

const browserBridge: DesktopBridge = {
  isElectron: false,
  version: GAME_VERSION,
  platform: 'browser',
  async loadSettings() { return lsGet(LS_SETTINGS); },
  async saveSettings(data) { lsSet(LS_SETTINGS, data); },
  async loadProfile() { return lsGet(LS_PROFILE); },
  async saveProfile(data) { lsSet(LS_PROFILE, data); },
  async startServer(_opts: HostServerOptions): Promise<HostServerResult> {
    return {
      ok: false,
      error: 'NOT_AVAILABLE',
      message: 'Hosting from inside the game requires the desktop app. Start a server with `npm run dev:server` and join 127.0.0.1 instead.',
    };
  },
  async stopServer() { /* nothing */ },
  async serverStatus(): Promise<ServerStatus> { return { running: false, port: null }; },
  onServerLog() { return () => {}; },
  onServerExit() { return () => {}; },
  async getLanAddresses() { return []; },
  async setFullscreen(on) {
    try {
      if (on) await document.documentElement.requestFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch { /* ignore */ }
  },
  async toggleFullscreen() {
    const on = !document.fullscreenElement;
    await browserBridge.setFullscreen(on);
    return on;
  },
  async isFullscreen() { return !!document.fullscreenElement; },
  async quit() { window.close(); },
  async openExternal(url) { window.open(url, '_blank', 'noopener'); },
  async getUserDataPath() { return 'localStorage'; },
};

export function getBridge(): DesktopBridge {
  return window.tra ?? browserBridge;
}

export const isElectron = (): boolean => !!window.tra?.isElectron;
