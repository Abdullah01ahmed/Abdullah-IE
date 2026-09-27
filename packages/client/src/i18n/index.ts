/**
 * Localisation. Two dictionaries (en, ar) keyed by the English key set, an
 * ICU-lite `{name}` interpolation, a plain `t()` for non-React code and a
 * `useT()` hook that re-renders when the language setting changes.
 *
 * Numbers are always rendered with Western digits (no locale formatting), as
 * the game's HUD and scoreboards are read at a glance in both languages.
 */
import { useMemo } from 'react';
import { useStore } from '../state/store';
import type { Language } from '../state/settings';
import { en } from './en';
import { ar } from './ar';

export type TKey = keyof typeof en;
export type TParams = Record<string, string | number>;
export type TFn = (key: TKey, params?: TParams) => string;

export const LANGUAGES: readonly Language[] = ['en', 'ar'];
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', ar: 'العربية' };

const DICTS: Record<Language, Record<TKey, string>> = { en, ar };

/** Replace `{name}` placeholders; unknown placeholders are left in place. */
export function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function translate(lang: Language, key: TKey, params?: TParams): string {
  const dict = DICTS[lang] ?? en;
  const template = dict[key] ?? en[key] ?? key;
  return interpolate(template, params);
}

export function currentLanguage(): Language {
  return useStore.getState().settings.language;
}

/** Translate using the language currently in the store (for non-React code). */
export function t(key: TKey, params?: TParams): string {
  return translate(currentLanguage(), key, params);
}

export function isRtl(lang: Language): boolean {
  return lang === 'ar';
}

/** Pick the localised variant of bilingual game data (map / weapon / mode names). */
export function bi(lang: Language, english: string, arabic: string): string {
  return lang === 'ar' ? arabic : english;
}

export function useLang(): Language {
  return useStore((s) => s.settings.language);
}

/** Returns a `t` function bound to the active language; re-renders on change. */
export function useT(): TFn {
  const lang = useLang();
  return useMemo<TFn>(() => (key, params) => translate(lang, key, params), [lang]);
}

export { en, ar };
