import { useEffect, useState } from 'react';

/**
 * A coarse ticking clock (performance.now()) for expiring transient HUD items.
 * Only rerenders while `active`; inactive consumers hold the last value.
 */
export function useClock(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    setNow(performance.now());
    const id = setInterval(() => setNow(performance.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}
