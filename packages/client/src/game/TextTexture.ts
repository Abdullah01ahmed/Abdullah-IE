/**
 * Canvas-drawn text textures (shop signs, name tags). Arabic is drawn with
 * direction 'rtl' and the bundled Noto Kufi / Naskh fonts so shaping and
 * ligatures are correct. Degrades to `null` where a 2D canvas is unavailable
 * (jsdom tests, headless NullEngine) so callers simply skip the texture.
 */
import { DynamicTexture, Texture, type Scene } from '@babylonjs/core';
import '@fontsource/noto-kufi-arabic/400.css';
import '@fontsource/noto-kufi-arabic/700.css';
import '@fontsource/noto-naskh-arabic/400.css';

export const KUFI = '"Noto Kufi Arabic", "Segoe UI", sans-serif';
export const NASKH = '"Noto Naskh Arabic", "Segoe UI", serif';
export const LATIN = '"Segoe UI", Roboto, Arial, sans-serif';

let probe: boolean | null = null;

/** True when this environment can produce a 2D canvas context. */
export function canvas2dAvailable(): boolean {
  if (probe !== null) return probe;
  try {
    if (typeof document === 'undefined') return (probe = false);
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    probe = !!c.getContext('2d');
  } catch {
    probe = false;
  }
  return probe;
}

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export function isArabic(text: string): boolean {
  return ARABIC_RE.test(text);
}

let fontsReady: Promise<void> | null = null;

/** Wait (bounded) for the Arabic web fonts so sign textures shape correctly. */
export function ensureFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
  if (!fonts || typeof fonts.load !== 'function') return (fontsReady = Promise.resolve());
  const loads = [
    fonts.load('700 32px "Noto Kufi Arabic"', 'بغداد'),
    fonts.load('400 32px "Noto Kufi Arabic"', 'بغداد'),
    fonts.load('400 32px "Noto Naskh Arabic"', 'بغداد'),
  ].map((p) => p.catch(() => undefined));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2500));
  fontsReady = Promise.race([Promise.all(loads).then(() => undefined), timeout]);
  return fontsReady;
}

export interface TextTextureOptions {
  text: string;
  width: number;
  height: number;
  /** CSS font family; defaults by script. */
  family?: string;
  weight?: number | string;
  /** Font size in px; defaults to fit the height. */
  fontSize?: number;
  color?: string;
  /** Background fill; null = transparent. */
  background?: string | null;
  /** Optional outline colour drawn behind the glyphs. */
  outline?: string | null;
  /** Optional frame/border colour. */
  border?: string | null;
  padding?: number;
  /** Force a direction; defaults from the script. */
  rtl?: boolean;
}

/**
 * Draw text on a canvas and wrap it in a DynamicTexture. Returns null when the
 * environment has no 2D canvas. The texture is not mip-mapped (crisp text).
 */
export function createTextTexture(scene: Scene, name: string, opts: TextTextureOptions): DynamicTexture | null {
  if (!canvas2dAvailable()) return null;
  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rtl = opts.rtl ?? isArabic(opts.text);
  const pad = opts.padding ?? Math.round(opts.height * 0.12);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, opts.width, opts.height);
  } else {
    ctx.clearRect(0, 0, opts.width, opts.height);
  }
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = Math.max(2, opts.height * 0.04);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, opts.width - ctx.lineWidth, opts.height - ctx.lineWidth);
  }
  const family = opts.family ?? (rtl ? KUFI : LATIN);
  let size = opts.fontSize ?? Math.floor((opts.height - pad * 2) * 0.72);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.direction = rtl ? 'rtl' : 'ltr';
  // Shrink to fit the width.
  for (;;) {
    ctx.font = `${opts.weight ?? 700} ${size}px ${family}`;
    if (ctx.measureText(opts.text).width <= opts.width - pad * 2 || size <= 8) break;
    size = Math.floor(size * 0.9);
  }
  const x = opts.width / 2;
  const y = opts.height / 2;
  if (opts.outline) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = opts.outline;
    ctx.lineWidth = Math.max(2, size * 0.12);
    ctx.strokeText(opts.text, x, y);
  }
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.fillText(opts.text, x, y);
  const tex = new DynamicTexture(name, canvas, scene, false, Texture.TRILINEAR_SAMPLINGMODE);
  tex.hasAlpha = !opts.background;
  tex.update(false);
  return tex;
}
