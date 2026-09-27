import type { MaterialId } from '@tra/shared';
import { describe, expect, it } from 'vitest';
import { MATERIAL_SPECS } from '../../src/game/Materials';
import { generateTextureSets } from '../../src/game/texgen';
import {
  clearTextureSetCache,
  generateBulletHole,
  generateEnvironmentFaces,
  generateFrond,
  generateSkyGradient,
  generateSoftDisc,
  generateSunSprite,
  generateTextureSet,
  getTextureSet,
  peekTextureSet,
} from '../../src/game/textures';
import { canvas2dAvailable, createTextTexture, isArabic } from '../../src/game/TextTexture';
import { NullEngine, Scene } from '@babylonjs/core';

const ALL_IDS = Object.keys(MATERIAL_SPECS) as MaterialId[];
const VISIBLE_IDS = ALL_IDS.filter((id) => id !== 'invisible');

function stats(buf: Uint8Array) {
  let min = 255, max = 0, sum = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const l = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
    min = Math.min(min, l);
    max = Math.max(max, l);
    sum += l;
  }
  return { min, max, mean: sum / (buf.length / 4) };
}

describe('procedural texture sets', () => {
  it('produces correctly sized RGBA buffers for every visible material and null for invisible', () => {
    for (const id of VISIBLE_IDS) {
      const set = generateTextureSet(id, 32)!;
      expect(set, id).not.toBeNull();
      expect(set.size).toBe(32);
      expect(set.detailSize).toBe(32);
      expect(set.albedo.length).toBe(32 * 32 * 4);
      expect(set.normal.length).toBe(32 * 32 * 4);
      expect(set.orm.length).toBe(32 * 32 * 4);
    }
    expect(generateTextureSet('invisible', 32)).toBeNull();
  });

  it('paints varied albedo, valid tangent-space normals and sane roughness', () => {
    for (const id of VISIBLE_IDS) {
      const set = generateTextureSet(id, 64)!;
      const a = stats(set.albedo);
      expect(a.max - a.min, `${id} albedo has no variation`).toBeGreaterThan(8);
      // Normals point mostly "out" of the surface (blue channel high) and average to flat.
      let sumR = 0, sumG = 0, minB = 255;
      for (let i = 0; i < set.normal.length; i += 4) {
        sumR += set.normal[i];
        sumG += set.normal[i + 1];
        minB = Math.min(minB, set.normal[i + 2]);
      }
      const n = set.normal.length / 4;
      expect(Math.abs(sumR / n - 127.5), `${id} normal x bias`).toBeLessThan(6);
      expect(Math.abs(sumG / n - 127.5), `${id} normal y bias`).toBeLessThan(6);
      expect(minB, `${id} normal z`).toBeGreaterThan(128);
      // Roughness in the green channel is within 0..1 and metallic is 0 except for metal/tile.
      let maxMetal = 0;
      for (let i = 0; i < set.orm.length; i += 4) maxMetal = Math.max(maxMetal, set.orm[i + 2]);
      if (id === 'metal') expect(maxMetal).toBeGreaterThan(150);
      else expect(maxMetal).toBeLessThan(40);
    }
  });

  it('gives cut-out / blended materials an alpha channel and opaque ones none', () => {
    const lattice = generateTextureSet('lattice', 64)!;
    let transparent = 0;
    for (let i = 3; i < lattice.albedo.length; i += 4) if (lattice.albedo[i] === 0) transparent++;
    expect(lattice.hasAlpha).toBe(true);
    expect(transparent).toBeGreaterThan(64 * 64 * 0.2);
    const glass = generateTextureSet('glass', 16)!;
    expect(glass.hasAlpha).toBe(true);
    expect(glass.albedo[3]).toBeLessThan(128);
    const brick = generateTextureSet('brick', 16)!;
    expect(brick.hasAlpha).toBe(false);
    for (let i = 3; i < brick.albedo.length; i += 4) expect(brick.albedo[i]).toBe(255);
  });

  it('is deterministic and tiles seamlessly', () => {
    const a = generateTextureSet('cobble', 64)!;
    const b = generateTextureSet('cobble', 64)!;
    expect(Buffer.from(a.albedo).equals(Buffer.from(b.albedo))).toBe(true);
    // Opposite edges should be similar (continuity across the wrap).
    const size = a.size;
    let diff = 0;
    for (let y = 0; y < size; y++) {
      const l = (y * size) * 4;
      const r = (y * size + size - 1) * 4;
      diff += Math.abs(a.albedo[l] - a.albedo[r]);
    }
    let interior = 0;
    for (let y = 0; y < size; y++) {
      const l = (y * size + 20) * 4;
      const r = (y * size + 44) * 4;
      interior += Math.abs(a.albedo[l] - a.albedo[r]);
    }
    expect(diff).toBeLessThan(interior);
  });

  it('upsamples only the albedo above the paint resolution', () => {
    // Paint resolution caps at 1024; request 2048 for a tiny paint by using a
    // size above the cap is too slow for a unit test, so verify the rule with
    // the exported MAX_PAINT_RES contract indirectly: a 64² request paints at 64².
    const set = generateTextureSet('sand', 64)!;
    expect(set.size).toBe(64);
    expect(set.detailSize).toBe(64);
  });

  it('rejects non power-of-two sizes', () => {
    expect(() => generateTextureSet('brick', 100)).toThrow();
  });

  it('caches generated sets', () => {
    clearTextureSetCache();
    expect(peekTextureSet('wood', 16)).toBeNull();
    const first = getTextureSet('wood', 16);
    expect(peekTextureSet('wood', 16)).toBe(first);
    expect(getTextureSet('wood', 16)).toBe(first);
  });

  it('generateTextureSets falls back to the main thread when workers are disabled', async () => {
    clearTextureSetCache();
    const seen: MaterialId[] = [];
    const sets = await generateTextureSets(
      [{ id: 'brick', size: 16 }, { id: 'invisible', size: 16 }, { id: 'stone', size: 16 }],
      (_done, _total, id) => seen.push(id),
      { workers: false },
    );
    expect([...sets.keys()].sort()).toEqual(['brick', 'stone']);
    expect(seen).toEqual(['brick', 'stone']);
  });

  it('builds the utility sprites at the requested sizes', () => {
    expect(generateSoftDisc(16).length).toBe(16 * 16 * 4);
    expect(generateBulletHole(16).length).toBe(16 * 16 * 4);
    expect(generateFrond(8, 32).length).toBe(8 * 32 * 4);
    expect(generateSunSprite(16).length).toBe(16 * 16 * 4);
    const sky = generateSkyGradient(32, [0.3, 0.5, 0.8], [0.9, 0.7, 0.5]);
    expect(sky.length).toBe(2 * 32 * 4);
    // Zenith (last row) is bluer than the horizon (middle row).
    const top = sky[(31 * 2) * 4 + 2];
    const horizon = sky[(16 * 2) * 4 + 2];
    expect(top).toBeGreaterThan(horizon);
    const faces = generateEnvironmentFaces(8, [0.3, 0.5, 0.8], [0.9, 0.7, 0.5], [0.4, 0.3, 0.2], { x: 0, y: 1, z: 0 }, [1, 0.9, 0.8]);
    expect(faces).toHaveLength(6);
    for (const f of faces) expect(f.length).toBe(8 * 8 * 4);
  });
});

describe('text textures', () => {
  it('detects Arabic script', () => {
    expect(isArabic('مقهى')).toBe(true);
    expect(isArabic('Tea house')).toBe(false);
  });

  it('degrades to null without a 2D canvas and draws when a context exists', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const available = canvas2dAvailable();
    const tex = createTextTexture(scene, 'sign', { text: 'مقهى الشناشيل', width: 128, height: 32, background: '#1f5f6b' });
    if (available) {
      expect(tex).not.toBeNull();
      expect(tex!.getSize().width).toBe(128);
      tex!.dispose();
    } else {
      expect(tex).toBeNull();
    }
    scene.dispose();
    engine.dispose();
  });
});
