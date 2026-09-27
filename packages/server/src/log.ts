/**
 * Minimal levelled logger. Every line is prefixed with "[tra-server]" so the
 * Electron launcher (which pipes the server's stdout into the host screen) can
 * tell server log lines apart from the READY/ERROR handshake lines.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

export function isLogLevel(v: unknown): v is LogLevel {
  return typeof v === 'string' && (LOG_LEVELS as readonly string[]).includes(v);
}

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export const PREFIX = '[tra-server]';

export function createLogger(level: LogLevel, out: { write(line: string): void } = consoleSink): Logger {
  const min = LEVEL_RANK[level];
  const emit = (lvl: LogLevel, msg: string): void => {
    if (LEVEL_RANK[lvl] < min) return;
    out.write(`${PREFIX} ${lvl.toUpperCase()} ${msg}`);
  };
  return {
    debug: (m) => emit('debug', m),
    info: (m) => emit('info', m),
    warn: (m) => emit('warn', m),
    error: (m) => emit('error', m),
  };
}

const consoleSink = {
  write(line: string): void {
    if (line.includes(' ERROR ')) process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  },
};

/** Logger that discards everything (tests). */
export const silentLogger: Logger = createLogger('silent');
