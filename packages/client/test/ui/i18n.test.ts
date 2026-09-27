import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import { ar } from '../../src/i18n/ar';
import { interpolate, t, translate } from '../../src/i18n';
import { useStore } from '../../src/state/store';
import { TIP_COUNT } from '../../src/ui/logic/constants';
import { GAME_ACTIONS } from '../../src/state/settings';

describe('i18n dictionaries', () => {
  it('ar has every key of en and vice versa', () => {
    const enKeys = Object.keys(en).sort();
    const arKeys = Object.keys(ar).sort();
    const missingInAr = enKeys.filter((k) => !(k in ar));
    const extraInAr = arKeys.filter((k) => !(k in en));
    expect(missingInAr).toEqual([]);
    expect(extraInAr).toEqual([]);
  });

  it('has no empty strings', () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), `en.${k}`).not.toBe('');
    for (const [k, v] of Object.entries(ar)) expect(v.trim(), `ar.${k}`).not.toBe('');
  });

  it('keeps the same placeholders in both languages', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(ar[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('covers every tip index, action and difficulty', () => {
    for (let i = 0; i < TIP_COUNT; i++) expect(en).toHaveProperty(`tip.${i}`);
    for (const a of GAME_ACTIONS) expect(en).toHaveProperty(`action.${a}`);
    for (const d of ['easy', 'normal', 'hard', 'extreme']) expect(en).toHaveProperty(`difficulty.${d}`);
  });

  it('uses Western digits in Arabic strings', () => {
    for (const [k, v] of Object.entries(ar)) expect(v, `ar.${k}`).not.toMatch(/[٠-٩]/);
  });
});

describe('interpolation and t()', () => {
  it('replaces {name} placeholders and leaves unknown ones', () => {
    expect(interpolate('Hi {name}, port {port}', { name: 'Ali', port: 27600 })).toBe('Hi Ali, port 27600');
    expect(interpolate('Keep {x}', {})).toBe('Keep {x}');
    expect(interpolate('No params {x}')).toBe('No params {x}');
  });

  it('translates per language and follows the store language', () => {
    expect(translate('en', 'menu.host')).toBe(en['menu.host']);
    expect(translate('ar', 'menu.host')).toBe(ar['menu.host']);
    useStore.getState().updateSettings((s) => ({ ...s, language: 'ar' }));
    expect(t('menu.host')).toBe(ar['menu.host']);
    expect(document.documentElement.dir).toBe('rtl');
    useStore.getState().updateSettings((s) => ({ ...s, language: 'en' }));
    expect(t('lobby.countdown', { n: 5 })).toBe('Match starts in 5');
    expect(document.documentElement.dir).toBe('ltr');
  });
});
