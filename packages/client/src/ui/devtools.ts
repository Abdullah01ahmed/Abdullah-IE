/**
 * Exposes the store and session on `window.__tra` for development and for the
 * E2E suite, which reads state through it. Never enabled in a plain production
 * run unless the page is opened with `?e2e` in the query string.
 */
import { useStore } from '../state/store';
import { session } from '../session/Session';

declare global {
  interface Window {
    __tra?: { store: typeof useStore; session: typeof session };
  }
}

export function shouldExposeDevtools(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === 'test' || location.search.includes('e2e');
}

export function exposeDevtools(): void {
  if (shouldExposeDevtools()) window.__tra = { store: useStore, session };
}
