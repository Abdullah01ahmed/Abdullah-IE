/** Small formatting helpers shared by HUD and screens (Western digits only). */

/** Seconds → "m:ss" / "mm:ss" (clamped at zero, whole seconds). */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Parse a user-typed integer, or return null when it is not a whole number. */
export function parseIntStrict(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}
