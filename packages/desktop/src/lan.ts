import os from 'node:os';

/**
 * Order in which address families are shown on the host screen: the ranges a
 * home / office LAN actually uses come first, link-local (169.254/16, which
 * only exists when DHCP failed) last.
 */
function rank(address: string): number {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  if (address.startsWith('169.254.')) return 4;
  return 3;
}

/** IPv4 addresses of this machine's non-loopback interfaces, most useful first. */
export function getLanAddresses(): string[] {
  const found: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      // Node < 18.4 reports the family as the number 4; newer versions as 'IPv4'.
      const isV4 = entry.family === 'IPv4' || (entry.family as unknown) === 4;
      if (!isV4 || entry.internal || found.includes(entry.address)) continue;
      found.push(entry.address);
    }
  }
  // Stable sort keeps the OS interface order within a rank.
  return found
    .map((address, index) => ({ address, index, rank: rank(address) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((e) => e.address);
}
