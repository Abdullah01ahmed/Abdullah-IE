/** Scoreboard ordering and grouping helpers (pure). */
import type { ScoreEntry, Team } from '@tra/shared';

export interface ScoreLike {
  name: string;
  kills: number;
  deaths: number;
  score: number;
}

/**
 * Sort for display: score desc, then kills desc, then deaths asc, then name
 * (case-insensitive) so ties are stable and predictable.
 */
export function sortScoreEntries<T extends ScoreLike>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    b.score - a.score ||
    b.kills - a.kills ||
    a.deaths - b.deaths ||
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

export function teamEntries(players: readonly ScoreEntry[], team: Team): ScoreEntry[] {
  return sortScoreEntries(players.filter((p) => p.team === team));
}

export type PingQuality = 'good' | 'ok' | 'bad';

export function pingQuality(ms: number): PingQuality {
  if (ms < 60) return 'good';
  if (ms < 120) return 'ok';
  return 'bad';
}
