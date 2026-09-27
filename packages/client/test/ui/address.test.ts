import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT } from '@tra/shared';
import { rememberAddress, validateAddress } from '../../src/ui/logic/address';
import { RECENT_ADDRESSES_MAX, sanitizeRecentAddresses } from '../../src/state/settings';

describe('validateAddress', () => {
  it('rejects empty input with the empty-address message', () => {
    expect(validateAddress('')).toEqual({ ok: false, key: 'address.empty' });
    expect(validateAddress('   ')).toEqual({ ok: false, key: 'address.empty' });
  });

  it('accepts a bare IPv4 and applies the default port', () => {
    expect(validateAddress('192.168.1.20')).toEqual({ ok: true, host: '192.168.1.20', port: DEFAULT_PORT, normalized: `192.168.1.20:${DEFAULT_PORT}` });
  });

  it('accepts host:port, host names and ws:// prefixes', () => {
    expect(validateAddress(' 192.168.1.20:27601 ')).toMatchObject({ ok: true, port: 27601 });
    expect(validateAddress('arena.example.com:5000')).toMatchObject({ ok: true, host: 'arena.example.com', port: 5000 });
    expect(validateAddress('ws://10.0.0.5:27600/')).toMatchObject({ ok: true, host: '10.0.0.5', port: 27600 });
  });

  it('accepts bracketed IPv6', () => {
    expect(validateAddress('[fe80::1]:27600')).toMatchObject({ ok: true, host: '[fe80::1]', port: 27600 });
  });

  it('reports an out-of-range port distinctly from a malformed host', () => {
    expect(validateAddress('10.0.0.1:99999')).toEqual({ ok: false, key: 'address.port' });
    expect(validateAddress('10.0.0.1:0')).toEqual({ ok: false, key: 'address.port' });
    expect(validateAddress('not an address')).toEqual({ ok: false, key: 'address.invalid' });
    expect(validateAddress('host:port')).toEqual({ ok: false, key: 'address.invalid' });
  });
});

describe('recent addresses', () => {
  it('prepends, deduplicates and caps the list', () => {
    let list: string[] = [];
    for (let i = 0; i < 7; i++) list = rememberAddress(list, `10.0.0.${i}:27600`);
    expect(list).toHaveLength(RECENT_ADDRESSES_MAX);
    expect(list[0]).toBe('10.0.0.6:27600');
    list = rememberAddress(list, '10.0.0.4:27600');
    expect(list[0]).toBe('10.0.0.4:27600');
    expect(list.filter((a) => a === '10.0.0.4:27600')).toHaveLength(1);
  });

  it('sanitises persisted data', () => {
    expect(sanitizeRecentAddresses(['a', 3, '', ' b ', 'a', null])).toEqual(['a', 'b']);
    expect(sanitizeRecentAddresses('nope')).toEqual([]);
  });
});
