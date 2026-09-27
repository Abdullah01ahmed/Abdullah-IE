/**
 * CLI entry point. Used both as the embedded server the Electron app forks
 * ("Host match") and as a stand-alone dedicated server. (The build script adds
 * the `#!/usr/bin/env node` banner to the bundle.)
 *
 * Handshake with the launcher (stdout, one line each):
 *   TRA_SERVER_READY port=<port>                 listening
 *   TRA_SERVER_ERROR code=<CODE> message=<text>  fatal startup error, exit code 2
 */
import { ConfigError, USAGE, parseConfig, type ServerConfig } from './config';
import { GameServer, ServerStartError, type ServerErrorCode } from './Server';
import { createLogger } from './log';

function printError(code: ServerErrorCode, message: string): void {
  process.stdout.write(`TRA_SERVER_ERROR code=${code} message=${message.replace(/\s+/g, ' ').trim()}\n`);
}

async function main(argv: string[]): Promise<void> {
  let config: ServerConfig;
  try {
    config = parseConfig(argv, process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n\n${USAGE}`);
      printError('UNKNOWN', err.message);
      process.exit(2);
    }
    throw err;
  }
  if (config.help) {
    process.stdout.write(USAGE);
    return;
  }

  const log = createLogger(config.logLevel);
  const server = new GameServer({
    host: config.host,
    port: config.port,
    password: config.password,
    serverName: config.serverName,
    dedicated: config.dedicated,
    settings: config.settings,
    log,
  });

  try {
    const port = await server.listen();
    log.info(`${config.serverName}${config.dedicated ? ' (dedicated)' : ''} — map ${config.settings.mapId}, mode ${config.settings.mode}, bots ${config.settings.bots.mode}`);
    process.stdout.write(`TRA_SERVER_READY port=${port}\n`);
  } catch (err) {
    const code: ServerErrorCode = err instanceof ServerStartError ? err.code : 'UNKNOWN';
    const message = err instanceof Error ? err.message : String(err);
    log.error(`failed to start: ${message}`);
    printError(code, message);
    process.exit(2);
  }

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`received ${signal}, shutting down`);
    // If a client never acknowledges the close handshake, leave anyway.
    setTimeout(() => process.exit(0), 2000).unref();
    server.close().then(() => process.exit(0), () => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main(process.argv.slice(2)).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[tra-server] ERROR ${err instanceof Error ? err.stack ?? message : message}\n`);
  printError('UNKNOWN', message);
  process.exit(2);
});
