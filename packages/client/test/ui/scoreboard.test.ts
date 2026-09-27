import { describe, expect, it } from 'vitest';
import type { ScoreEntry } from '@tra/shared';
import { pingQuality, sortScoreEntries, teamEntries } from '../../src/ui/logic/scoreboard';

const entry = (id: number, name: string, team: 'tigris' | 'euphrates', kills: number, deaths: number, score: number): ScoreEntry => ({
  id, name, team, kills, deaths, score, ping: 20, isBot: false,
});

describe('sortScoreEntries', () => {
  it('sorts by score, then kills, then fewer deaths, then name', () => {
    const rows = [
      entry(1, 'Zainab', 'tigris', 5, 2, 500),
      entry(2, 'Ali', 'tigris', 7, 1, 700),
      entry(3, 'Omar', 'tigris', 6, 3, 500),
      entry(4, 'Huda', 'tigris', 5, 1, 500),
      entry(5, 'Noor', 'tigris', 5, 1, 500),
    ];
    expect(sortScoreEntries(rows).map((r) => r.name)).toEqual(['Ali', 'Omar', 'Huda', 'Noor', 'Zainab']);
  });

  it('does not mutate the input', () => {
    const rows = [entry(1, 'B', 'tigris', 1, 0, 10), entry(2, 'A', 'tigris', 2, 0, 20)];
    const copy = [...rows];
    sortScoreEntries(rows);
    expect(rows).toEqual(copy);
  });

  it('filters by team', () => {
    const rows = [entry(1, 'A', 'tigris', 1, 0, 10), entry(2, 'B', 'euphrates', 2, 0, 20), entry(3, 'C', 'euphrates', 3, 0, 30)];
    expect(teamEntries(rows, 'euphrates').map((r) => r.name)).toEqual(['C', 'B']);
    expect(teamEntries(rows, 'tigris').map((r) => r.name)).toEqual(['A']);
  });
});

describe('pingQuality', () => {
  it('buckets latency', () => {
    expect(pingQuality(10)).toBe('good');
    expect(pingQuality(59)).toBe('good');
    expect(pingQuality(60)).toBe('ok');
    expect(pingQuality(119)).toBe('ok');
    expect(pingQuality(120)).toBe('bad');
  });
});
