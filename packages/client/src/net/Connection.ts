/**
 * Typed WebSocket connection to a Twin Rivers server, with ping-based clock
 * synchronisation.
 */
import { DEFAULT_PORT, PING_INTERVAL_MS, decode, encode, type C2S, type S2C } from '@tra/shared';

export interface CloseInfo {
  code: number;
  reason: string;
  /** True when the close was requested locally. */
  local: boolean;
}

type Listeners = {
  open: Set<() => void>;
  close: Set<(info: CloseInfo) => void>;
  error: Set<(err: Error) => void>;
  message: Set<(msg: S2C) => void>;
};

export interface ParsedAddress {
  host: string;
  port: number;
}

/**
 * Parse user input such as "192.168.1.10", "192.168.1.10:27600",
 * "[fe80::1]:27600", "example.com" or "ws://host:port".
 */
export function parseAddress(input: string, defaultPort = DEFAULT_PORT): ParsedAddress | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^wss?:\/\//i, '').replace(/\/.*$/, '');
  // IPv6 in brackets
  const m6 = s.match(/^\[([0-9a-f:]+)\](?::(\d{1,5}))?$/i);
  if (m6) {
    const port = m6[2] ? Number(m6[2]) : defaultPort;
    return validPort(port) ? { host: `[${m6[1]}]`, port } : null;
  }
  // Bare IPv6 without port
  if (s.includes(':') && s.split(':').length > 2) {
    return { host: `[${s}]`, port: defaultPort };
  }
  const m = s.match(/^([^:\s]+)(?::(\d{1,5}))?$/);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : defaultPort;
  if (!validPort(port)) return null;
  return { host: m[1], port };
}

function validPort(p: number): boolean {
  return Number.isInteger(p) && p >= 1 && p <= 65535;
}

export function buildWsUrl(addr: ParsedAddress): string {
  return `ws://${addr.host}:${addr.port}`;
}

export class Connection {
  readonly url: string;
  private ws: WebSocket | null = null;
  private listeners: Listeners = { open: new Set(), close: new Set(), error: new Set(), message: new Set() };
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedLocally = false;
  private opened = false;

  /** Smoothed round-trip time (ms). */
  rtt = 0;
  /** Best (lowest-RTT) estimate of serverTime - performance.now(). */
  private clockOffset = 0;
  private bestRtt = Infinity;
  private samples = 0;

  constructor(url: string) {
    this.url = url;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** True once at least one pong has been received. */
  get synced(): boolean {
    return this.samples > 0;
  }

  /** Estimated current server time (ms on the server's clock). */
  serverNow(): number {
    return performance.now() + this.clockOffset;
  }

  connect(timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => {
        if (!this.opened) {
          try { ws.close(); } catch { /* ignore */ }
          reject(new Error('TIMEOUT'));
        }
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        this.opened = true;
        this.startPing();
        for (const l of this.listeners.open) l();
        resolve();
      };
      ws.onerror = () => {
        const err = new Error(this.opened ? 'SOCKET_ERROR' : 'CONNECT_FAILED');
        for (const l of this.listeners.error) l(err);
        if (!this.opened) {
          clearTimeout(timer);
          reject(err);
        }
      };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        this.stopPing();
        const info: CloseInfo = { code: ev.code, reason: ev.reason, local: this.closedLocally };
        if (!this.opened) reject(new Error('CONNECT_FAILED'));
        for (const l of this.listeners.close) l(info);
      };
      ws.onmessage = (ev) => {
        const msg = decode<S2C>(ev.data as string | ArrayBuffer);
        if (!msg) return;
        if (msg.t === 'pong') {
          this.onPong(msg.cs, msg.st);
        }
        for (const l of this.listeners.message) l(msg);
      };
    });
  }

  send(msg: C2S): boolean {
    if (!this.isOpen) return false;
    try {
      this.ws!.send(encode(msg));
      return true;
    } catch {
      return false;
    }
  }

  close(code = 1000, reason = 'client closed'): void {
    this.closedLocally = true;
    this.stopPing();
    try { this.ws?.close(code, reason); } catch { /* ignore */ }
  }

  on<K extends keyof Listeners>(event: K, fn: Listeners[K] extends Set<infer F> ? F : never): () => void {
    (this.listeners[event] as Set<unknown>).add(fn);
    return () => (this.listeners[event] as Set<unknown>).delete(fn);
  }

  off<K extends keyof Listeners>(event: K, fn: Listeners[K] extends Set<infer F> ? F : never): void {
    (this.listeners[event] as Set<unknown>).delete(fn);
  }

  /** Send a ping immediately (also sent automatically every PING_INTERVAL_MS). */
  ping(): void {
    this.send({ t: 'ping', cs: performance.now() });
  }

  private startPing(): void {
    this.stopPing();
    this.ping();
    // A quick burst at the start converges the clock estimate fast.
    setTimeout(() => this.ping(), 150);
    setTimeout(() => this.ping(), 400);
    this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private onPong(cs: number, st: number): void {
    const now = performance.now();
    const rtt = Math.max(0, now - cs);
    this.rtt = this.samples === 0 ? rtt : this.rtt * 0.8 + rtt * 0.2;
    this.samples++;
    // Offset estimate from this sample; prefer the lowest-RTT sample (most
    // accurate), but let the estimate drift slowly toward new samples so a
    // one-off lucky sample does not pin a stale offset forever.
    const offset = st + rtt / 2 - now;
    if (rtt <= this.bestRtt * 1.05 || this.samples <= 3) {
      this.bestRtt = Math.min(this.bestRtt, rtt);
      this.clockOffset = this.samples <= 1 ? offset : this.clockOffset * 0.5 + offset * 0.5;
    } else {
      this.clockOffset = this.clockOffset * 0.95 + offset * 0.05;
      // Slowly forget the best RTT so a changed network path is re-learned.
      this.bestRtt = this.bestRtt * 1.02 + 0.5;
    }
  }
}
