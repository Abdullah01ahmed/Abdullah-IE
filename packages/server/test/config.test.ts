import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_SETTINGS, DEFAULT_PORT, TEAM_SIZE } from '@tra/shared';
import { ConfigError, USAGE, parseConfig } from '../src/config';

describe('parseConfig', () => {
  it('applies defaults', () => {
    const c = parseConfig([]);
    expect(c.host).toBe('0.0.0.0');
    expect(c.port).toBe(DEFAULT_PORT);
    expect(c.password).toBeUndefined();
    expect(c.dedicated).toBe(false);
    expect(c.logLevel).toBe('info');
    expect(c.help).toBe(false);
    expect(c.settings.mapId).toBe('shanasheel');
    expect(c.settings.mode).toBe('tdm');
    expect(c.settings.bots).toEqual(DEFAULT_MATCH_SETTINGS.bots);
    expect(c.settings.mapRotation).toEqual(DEFAULT_MATCH_SETTINGS.mapRotation);
  });

  it('parses every flag', () => {
    const c = parseConfig([
      '--host', '127.0.0.1', '--port', '27601', '--password', 'hunter2', '--name', ' My Server ', '--map', 'test_arena',
      '--mode', 'tdm', '--dedicated', '--bots', 'fixed', '--bots-tigris', '9', '--bots-euphrates=2', '--bot-difficulty', 'hard',
      '--score-limit', '50', '--time-limit', '120', '--respawn-delay', '5', '--friendly-fire', '--replace-bots', 'false', '--log-level', 'debug',
    ]);
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(27601);
    expect(c.password).toBe('hunter2');
    expect(c.serverName).toBe('My Server');
    expect(c.dedicated).toBe(true);
    expect(c.logLevel).toBe('debug');
    expect(c.settings.mapId).toBe('test_arena');
    expect(c.settings.mapRotation).toEqual(['test_arena']);
    expect(c.settings.bots).toEqual({ mode: 'fixed', tigris: TEAM_SIZE, euphrates: 2, difficulty: 'hard', replaceWithHumans: false });
    expect(c.settings.scoreLimit).toBe(50);
    expect(c.settings.timeLimitSec).toBe(120);
    expect(c.settings.respawnDelaySec).toBe(5);
    expect(c.settings.friendlyFire).toBe(true);
  });

  it('clamps numeric settings to SETTINGS_LIMITS', () => {
    const c = parseConfig(['--score-limit', '1', '--time-limit', '99999', '--respawn-delay', '-3']);
    expect(c.settings.scoreLimit).toBe(5);
    expect(c.settings.timeLimitSec).toBe(3600);
    expect(c.settings.respawnDelaySec).toBe(0);
  });

  it('reads TRA_* environment variables, with flags taking precedence', () => {
    const c = parseConfig(['--port', '3'], { TRA_PORT: '1234', TRA_DEDICATED: '1', TRA_BOTS: 'none', TRA_NAME: 'Env Server' });
    expect(c.port).toBe(3);
    expect(c.dedicated).toBe(true);
    expect(c.settings.bots.mode).toBe('none');
    expect(c.serverName).toBe('Env Server');
  });

  it('rejects invalid values', () => {
    expect(() => parseConfig(['--map', 'nowhere'])).toThrow(ConfigError);
    expect(() => parseConfig(['--bots', 'many'])).toThrow(ConfigError);
    expect(() => parseConfig(['--port', 'abc'])).toThrow(ConfigError);
    expect(() => parseConfig(['--mode', 'dom'])).toThrow(ConfigError);
    expect(() => parseConfig(['--unknown'])).toThrow(ConfigError);
    expect(() => parseConfig(['--port'])).toThrow(ConfigError);
    expect(() => parseConfig(['--log-level', 'loud'])).toThrow(ConfigError);
    expect(() => parseConfig(['stray'])).toThrow(ConfigError);
  });

  it('recognises --help and documents the flags', () => {
    expect(parseConfig(['--help']).help).toBe(true);
    for (const flag of ['--port', '--password', '--dedicated', '--bots', '--bot-difficulty', '--score-limit', '--time-limit', '--respawn-delay', '--friendly-fire', '--replace-bots', '--log-level']) {
      expect(USAGE).toContain(flag);
    }
  });
});
