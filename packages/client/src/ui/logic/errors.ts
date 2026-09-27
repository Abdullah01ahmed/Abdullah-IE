/** Human-readable, localised messages for connection/session error codes. */
import { REJECT_MESSAGES } from '@tra/shared';
import type { TFn, TKey } from '../../i18n';
import { en } from '../../i18n/en';

const CLIENT_CODES = ['INVALID_ADDRESS', 'CONNECT_FAILED', 'TIMEOUT', 'DISCONNECTED', 'HOST_FAILED'] as const;

const KNOWN_CODES: ReadonlySet<string> = new Set([...Object.keys(REJECT_MESSAGES), ...CLIENT_CODES]);

export function errorKeyForCode(code: string): TKey {
  const key = `error.${code}`;
  return KNOWN_CODES.has(code) && key in en ? (key as TKey) : 'error.UNKNOWN';
}

/**
 * Localised message for a connection error. Known codes get the translated
 * text (with the address interpolated where relevant). For HOST_FAILED the
 * server/bridge message is specific (port in use, spawn failure) and is
 * appended so it is not lost.
 */
export function errorMessage(t: TFn, error: { code: string; message: string }, address: string): string {
  const key = errorKeyForCode(error.code);
  const base = t(key, { address: address || '—' });
  if (error.code === 'HOST_FAILED' && error.message && error.message !== base) return `${base} ${error.message}`;
  if (key === 'error.UNKNOWN' && error.message) return error.message;
  return base;
}
