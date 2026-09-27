/** Console logger for the main process; every line is tagged so it is easy to find in Electron's output. */
const PREFIX = '[tra-desktop]';

export const log = {
  info: (...args: unknown[]): void => console.log(PREFIX, ...args),
  warn: (...args: unknown[]): void => console.warn(PREFIX, ...args),
  error: (...args: unknown[]): void => console.error(PREFIX, ...args),
};
