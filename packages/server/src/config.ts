/**
 * Command-line / environment configuration for the server process.
 *
 * Every flag can also be given as an environment variable prefixed with TRA_
 * (e.g. `--score-limit 50` ≡ `TRA_SCORE_LIMIT=50`). Command-line flags win.
 */
import {
  AVAILABLE_MODES,
  BOT_DIFFICULTIES,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_PORT,
  GAME_NAME,
  GAME_VERSION,
  PLAYABLE_MAP_IDS,
  SETTINGS_LIMITS,
  TEAM_SIZE,
  clamp,
  testArena,
  type BotDifficultyId,
  type BotFillMode,
  type GameModeId,
  type MatchSettings,
} from '@tra/shared';
import { isLogLevel, type LogLevel } from './log';

export interface ServerConfig {
  host: string;
  port: number;
  password: string | undefined;
  serverName: string;
  dedicated: boolean;
  logLevel: LogLevel;
  settings: MatchSettings;
  help: boolean;
}

/** Map ids the server accepts: the lobby maps plus the test arena. */
export function isAllowedMapId(id: unknown): id is string {
  return typeof id === 'string' && (PLAYABLE_MAP_IDS.includes(id) || id === testArena.id);
}

export class ConfigError extends Error {}

const FLAG_ENV: Record<string, string> = {
  host: 'TRA_HOST',
  port: 'TRA_PORT',
  password: 'TRA_PASSWORD',
  name: 'TRA_NAME',
  map: 'TRA_MAP',
  mode: 'TRA_MODE',
  dedicated: 'TRA_DEDICATED',
  bots: 'TRA_BOTS',
  'bots-tigris': 'TRA_BOTS_TIGRIS',
  'bots-euphrates': 'TRA_BOTS_EUPHRATES',
  'bot-difficulty': 'TRA_BOT_DIFFICULTY',
  'score-limit': 'TRA_SCORE_LIMIT',
  'time-limit': 'TRA_TIME_LIMIT',
  'respawn-delay': 'TRA_RESPAWN_DELAY',
  'friendly-fire': 'TRA_FRIENDLY_FIRE',
  'replace-bots': 'TRA_REPLACE_BOTS',
  'log-level': 'TRA_LOG_LEVEL',
};

const BOOLEAN_FLAGS = new Set(['dedicated', 'friendly-fire', 'replace-bots', 'help']);

export const USAGE = `${GAME_NAME} server ${GAME_VERSION}

Usage: tra-server [options]

  --host <addr>            Interface to bind (default 0.0.0.0)
  --port <n>               TCP port (default ${DEFAULT_PORT})
  --password <text>        Require this password to join
  --name <text>            Server name shown in the lobby
  --map <id>               Map id (default shanasheel)
  --mode <id>              Game mode (${AVAILABLE_MODES.join('|')})
  --dedicated              No lobby host; matches auto-start
  --bots none|fixed|fill   Bot filling mode (default ${DEFAULT_MATCH_SETTINGS.bots.mode})
  --bots-tigris <n>        Bots on Tigris in fixed mode (0-${TEAM_SIZE})
  --bots-euphrates <n>     Bots on Euphrates in fixed mode (0-${TEAM_SIZE})
  --bot-difficulty <id>    ${BOT_DIFFICULTIES.join('|')} (default ${DEFAULT_MATCH_SETTINGS.bots.difficulty})
  --score-limit <n>        Kills to win (${SETTINGS_LIMITS.scoreLimit.min}-${SETTINGS_LIMITS.scoreLimit.max})
  --time-limit <sec>       Match length in seconds (${SETTINGS_LIMITS.timeLimitSec.min}-${SETTINGS_LIMITS.timeLimitSec.max})
  --respawn-delay <sec>    Respawn delay (${SETTINGS_LIMITS.respawnDelaySec.min}-${SETTINGS_LIMITS.respawnDelaySec.max})
  --friendly-fire [bool]   Team damage on/off (default off)
  --replace-bots [bool]    Joining humans take over bot slots (default on)
  --log-level <level>      debug|info|warn|error|silent (default info)
  --help                   Show this help

Every option can also be set with an environment variable, e.g. TRA_PORT=27601.
On success the server prints "TRA_SERVER_READY port=<port>" to stdout.
`;

/**
 * Parse `argv` (without the node/script prefix) and `env` into a ServerConfig.
 * Throws ConfigError on invalid values.
 */
export function parseConfig(argv: readonly string[], env: NodeJS.ProcessEnv = {}): ServerConfig {
  const raw = new Map<string, string>();
  for (const [flag, key] of Object.entries(FLAG_ENV)) {
    const v = env[key];
    if (v !== undefined && v !== '') raw.set(flag, v);
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new ConfigError(`Unexpected argument: ${arg}`);
    let flag = arg.slice(2);
    let value: string | undefined;
    const eq = flag.indexOf('=');
    if (eq >= 0) {
      value = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }
    if (flag !== 'help' && !(flag in FLAG_ENV)) throw new ConfigError(`Unknown option: --${flag}`);
    if (value === undefined) {
      const next = argv[i + 1];
      if (BOOLEAN_FLAGS.has(flag)) {
        // Boolean flags take an optional explicit value (--dedicated false).
        if (next !== undefined && /^(true|false|1|0|yes|no|on|off)$/i.test(next)) {
          value = next;
          i++;
        } else {
          value = 'true';
        }
      } else {
        if (next === undefined) throw new ConfigError(`Option --${flag} needs a value`);
        value = next;
        i++;
      }
    }
    raw.set(flag, value);
  }

  const getStr = (flag: string): string | undefined => raw.get(flag);
  const getBool = (flag: string, def: boolean): boolean => {
    const v = raw.get(flag);
    if (v === undefined) return def;
    if (/^(true|1|yes|on)$/i.test(v)) return true;
    if (/^(false|0|no|off)$/i.test(v)) return false;
    throw new ConfigError(`Option --${flag} expects true/false, got "${v}"`);
  };
  const getInt = (flag: string, def: number, min: number, max: number): number => {
    const v = raw.get(flag);
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw new ConfigError(`Option --${flag} expects an integer, got "${v}"`);
    return clamp(n, min, max);
  };
  const getChoice = <T extends string>(flag: string, def: T, choices: readonly T[]): T => {
    const v = raw.get(flag);
    if (v === undefined) return def;
    if (!(choices as readonly string[]).includes(v)) throw new ConfigError(`Option --${flag} must be one of ${choices.join('|')}, got "${v}"`);
    return v as T;
  };

  const mapId = getStr('map') ?? DEFAULT_MATCH_SETTINGS.mapId;
  if (!isAllowedMapId(mapId)) throw new ConfigError(`Unknown map "${mapId}" (available: ${PLAYABLE_MAP_IDS.join(', ')})`);
  const logLevelRaw = getStr('log-level') ?? 'info';
  if (!isLogLevel(logLevelRaw)) throw new ConfigError(`Option --log-level must be debug|info|warn|error|silent, got "${logLevelRaw}"`);

  const settings: MatchSettings = {
    mapId,
    mode: getChoice<GameModeId>('mode', DEFAULT_MATCH_SETTINGS.mode, AVAILABLE_MODES),
    scoreLimit: getInt('score-limit', DEFAULT_MATCH_SETTINGS.scoreLimit, SETTINGS_LIMITS.scoreLimit.min, SETTINGS_LIMITS.scoreLimit.max),
    timeLimitSec: getInt('time-limit', DEFAULT_MATCH_SETTINGS.timeLimitSec, SETTINGS_LIMITS.timeLimitSec.min, SETTINGS_LIMITS.timeLimitSec.max),
    respawnDelaySec: getInt('respawn-delay', DEFAULT_MATCH_SETTINGS.respawnDelaySec, SETTINGS_LIMITS.respawnDelaySec.min, SETTINGS_LIMITS.respawnDelaySec.max),
    friendlyFire: getBool('friendly-fire', DEFAULT_MATCH_SETTINGS.friendlyFire),
    bots: {
      mode: getChoice<BotFillMode>('bots', DEFAULT_MATCH_SETTINGS.bots.mode, ['none', 'fixed', 'fill']),
      tigris: getInt('bots-tigris', DEFAULT_MATCH_SETTINGS.bots.tigris, 0, TEAM_SIZE),
      euphrates: getInt('bots-euphrates', DEFAULT_MATCH_SETTINGS.bots.euphrates, 0, TEAM_SIZE),
      difficulty: getChoice<BotDifficultyId>('bot-difficulty', DEFAULT_MATCH_SETTINGS.bots.difficulty, BOT_DIFFICULTIES),
      replaceWithHumans: getBool('replace-bots', DEFAULT_MATCH_SETTINGS.bots.replaceWithHumans),
    },
    mapRotation: PLAYABLE_MAP_IDS.includes(mapId) ? [...DEFAULT_MATCH_SETTINGS.mapRotation] : [mapId],
  };

  const password = getStr('password');
  return {
    host: getStr('host') ?? '0.0.0.0',
    port: getInt('port', DEFAULT_PORT, 0, 65535),
    password: password && password.length > 0 ? password : undefined,
    serverName: (getStr('name') ?? `${GAME_NAME} server`).trim().slice(0, 40) || `${GAME_NAME} server`,
    dedicated: getBool('dedicated', false),
    logLevel: logLevelRaw,
    settings,
    help: getBool('help', false),
  };
}
