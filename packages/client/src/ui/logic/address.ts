/**
 * Join-screen address validation (thin, message-producing layer over
 * net/Connection's parseAddress) and the recent-address list.
 */
import { DEFAULT_PORT } from '@tra/shared';
import { parseAddress } from '../../net/Connection';
import { RECENT_ADDRESSES_MAX, sanitizeRecentAddresses } from '../../state/settings';
import type { TKey } from '../../i18n';

export type AddressValidation =
  | { ok: true; host: string; port: number; normalized: string }
  | { ok: false; key: TKey };

export function validateAddress(input: string): AddressValidation {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, key: 'address.empty' };
  const parsed = parseAddress(trimmed, DEFAULT_PORT);
  if (!parsed) {
    // Distinguish "port out of range" from a malformed host so the message can help.
    const portMatch = trimmed.match(/:(\d{1,6})$/);
    if (portMatch) {
      const port = Number(portMatch[1]);
      if (!(port >= 1 && port <= 65535)) return { ok: false, key: 'address.port' };
    }
    return { ok: false, key: 'address.invalid' };
  }
  return { ok: true, host: parsed.host, port: parsed.port, normalized: `${parsed.host}:${parsed.port}` };
}

/** Prepend `address` to the recent list (deduplicated, capped). */
export function rememberAddress(recent: readonly string[], address: string): string[] {
  return sanitizeRecentAddresses([address, ...recent]).slice(0, RECENT_ADDRESSES_MAX);
}
