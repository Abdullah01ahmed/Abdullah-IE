/**
 * Payload shapes that travel over the bridge channels but are private to the
 * desktop package (the renderer only ever sees plain strings / the shared
 * DesktopBridge types).
 */

/**
 * One server log line. `seq` increases monotonically for the lifetime of the
 * main process so the preload can merge the buffered history it fetches on
 * subscription with the live stream without duplicating or reordering lines.
 */
export interface ServerLogEntry {
  seq: number;
  line: string;
}
