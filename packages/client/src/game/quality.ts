/**
 * Maps the user-facing graphics settings onto the concrete numbers the render
 * systems consume (shadow map sizes, particle caps, texture sizes…). Keeping
 * the mapping in one place makes the presets easy to tune and to test.
 */
import type { MaterialId } from '@tra/shared';
import type { GraphicsSettings, Quality3, ShadowQuality } from '../state/settings';

export interface ShadowProfile {
  mapSize: number;
  cascades: number;
  /** 'pcf' = percentage-closer filtering; 'contact' = contact-hardening (PCSS-like). */
  filter: 'pcf' | 'contact';
  quality: 'low' | 'medium' | 'high';
}

export interface QualityProfile {
  /** Base texture size for material sets (see textureSizeFor for per-material caps). */
  textureSize: number;
  anisotropy: number;
  shadows: ShadowProfile | null;
  ssao: boolean;
  bloom: boolean;
  fxaa: boolean;
  renderScale: number;
  /** Ambient dust motes emitted per second at atmosphere.dust = 1. */
  dustRate: number;
  /** Particles per impact puff. */
  impactParticles: number;
  maxDecals: number;
  maxShells: number;
  maxTracers: number;
  /** Total dynamic point/spot lights kept enabled (nearest to the camera). */
  maxDynamicLights: number;
}

export const TEXTURE_SIZES: Record<Quality3, number> = { low: 512, medium: 1024, high: 2048 };

const SHADOW_PROFILES: Record<ShadowQuality, ShadowProfile | null> = {
  off: null,
  low: { mapSize: 1024, cascades: 2, filter: 'pcf', quality: 'low' },
  medium: { mapSize: 2048, cascades: 3, filter: 'pcf', quality: 'medium' },
  high: { mapSize: 2048, cascades: 4, filter: 'pcf', quality: 'high' },
  ultra: { mapSize: 4096, cascades: 4, filter: 'contact', quality: 'high' },
};

const PARTICLE_PROFILES: Record<Quality3, Pick<QualityProfile, 'dustRate' | 'impactParticles' | 'maxDecals' | 'maxShells' | 'maxTracers'>> = {
  low: { dustRate: 12, impactParticles: 8, maxDecals: 24, maxShells: 24, maxTracers: 12 },
  medium: { dustRate: 30, impactParticles: 14, maxDecals: 48, maxShells: 48, maxTracers: 20 },
  high: { dustRate: 60, impactParticles: 22, maxDecals: 64, maxShells: 64, maxTracers: 32 },
};

export function deriveQuality(g: GraphicsSettings): QualityProfile {
  return {
    textureSize: TEXTURE_SIZES[g.textureQuality],
    anisotropy: g.anisotropy,
    shadows: SHADOW_PROFILES[g.shadows],
    ssao: g.ssao,
    bloom: g.bloom,
    fxaa: g.fxaa,
    renderScale: g.renderScale,
    maxDynamicLights: 8,
    ...PARTICLE_PROFILES[g.particles],
  };
}

/**
 * Materials that cover large, close-up surfaces get the full size; secondary
 * materials are capped at 1024 so a 'high' set does not exhaust VRAM
 * (a 2048² RGBA set with mips is ~64 MB per material).
 */
const FULL_SIZE_MATERIALS: ReadonlySet<MaterialId> = new Set<MaterialId>([
  'brick', 'brick_dark', 'plaster', 'plaster_worn', 'stone', 'cobble', 'wood', 'ground',
]);

export function textureSizeFor(id: MaterialId, base: number): number {
  return FULL_SIZE_MATERIALS.has(id) ? base : Math.min(base, 1024);
}
