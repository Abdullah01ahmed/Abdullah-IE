import { FreeCamera, MeshBuilder, NullEngine, PBRMaterial, Scene, Vector3 } from '@babylonjs/core';
import { shanasheel, testArena, type MapDef } from '@tra/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Environment } from '../../src/game/Environment';
import { MapRenderer } from '../../src/game/MapRenderer';
import { MaterialLibrary } from '../../src/game/Materials';
import { deriveQuality } from '../../src/game/quality';
import { DEFAULT_SETTINGS } from '../../src/state/settings';

function counts(scene: Scene) {
  return {
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    textures: scene.textures.length,
    lights: scene.lights.length,
    transformNodes: scene.transformNodes.length,
    particleSystems: scene.particleSystems.length,
  };
}

const quality = deriveQuality({ ...DEFAULT_SETTINGS.graphics, textureQuality: 'low', shadows: 'medium', ssao: true, particles: 'low' });

describe('MapRenderer under NullEngine', () => {
  let engine: NullEngine;
  let scene: Scene;
  let camera: FreeCamera;

  beforeEach(() => {
    engine = new NullEngine({ renderWidth: 64, renderHeight: 64, textureSize: 64, deterministicLockstep: false, lockstepMaxSteps: 1 });
    scene = new Scene(engine);
    camera = new FreeCamera('cam', new Vector3(0, 1.6, -10), scene);
    // Warm up the shared PBR lookup texture so it is part of the baseline.
    const warm = MeshBuilder.CreateBox('warm', { size: 1 }, scene);
    warm.material = new PBRMaterial('warm', scene);
    scene.render();
    warm.material.dispose();
    warm.dispose();
  });

  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  async function buildAndCheck(map: MapDef) {
    const base = counts(scene);
    const materials = new MaterialLibrary(scene, { textureSize: 64, anisotropy: 4, texgen: { workers: false } });
    const used = MapRenderer.usedMaterials(map);
    await materials.prepare(used);
    for (const id of used) expect(materials.get(id), id).not.toBeNull();

    const env = new Environment(scene, engine, camera, map.atmosphere, quality, { msaa: 0 });
    const renderer = new MapRenderer(scene, map, materials, env, quality);

    const visibleBlocks = map.blocks.filter((b) => b.material !== 'invisible');
    const materialCount = new Set(visibleBlocks.map((b) => b.material)).size;
    expect(renderer.staticMeshes.length).toBeGreaterThanOrEqual(materialCount);
    // One mesh per material per 16 m chunk: never more than materials × chunks.
    const bounds = map.bounds;
    const chunks = Math.ceil((bounds.max.x - bounds.min.x) / 16 + 1) * Math.ceil((bounds.max.z - bounds.min.z) / 16 + 1);
    expect(renderer.staticMeshes.length).toBeLessThanOrEqual(materialCount * chunks);
    // Six quads of four vertices per visible block.
    expect(renderer.staticVertexCount).toBe(visibleBlocks.length * 24);
    expect(renderer.hasVertexColors()).toBe(true);
    for (const m of renderer.staticMeshes) {
      expect(m.material).not.toBeNull();
      expect(m.receiveShadows).toBe(true);
      expect(m.isWorldMatrixFrozen).toBe(true);
    }
    expect(renderer.propCount).toBe(map.props.length);

    scene.render();
    renderer.update(0.5, camera.position);
    materials.update(0.016);
    env.update(camera.position);
    scene.render();

    renderer.dispose();
    env.dispose();
    materials.dispose();
    expect(counts(scene)).toEqual(base);
  }

  it('builds and tears down the shanasheel map without leaking', async () => {
    await buildAndCheck(shanasheel);
  });

  it('builds and tears down the test arena without leaking', async () => {
    await buildAndCheck(testArena);
  });

  it('builds every prop kind (instancing repeats) and disposes cleanly', async () => {
    const kinds = [
      'palm', 'lantern', 'table', 'chair', 'rug', 'awning', 'pot', 'crate', 'barrel', 'sign', 'door', 'window', 'arch', 'teapot',
      'bicycle', 'sacks', 'cloth_line', 'shanasheel', 'fountain', 'bench', 'antenna', 'ac_unit', 'satellite_dish', 'water_tank', 'flag',
    ] as const;
    const props = kinds.flatMap((kind, i) => [
      { kind, pos: { x: i * 3 - 30, y: 0, z: 5 }, yaw: 0.3, text: kind === 'sign' ? 'مقهى الشناشيل' : undefined },
      { kind, pos: { x: i * 3 - 30, y: 0, z: -5 }, yaw: 1.2, scale: 1.2, text: kind === 'sign' ? 'مقهى الشناشيل' : undefined },
    ]);
    const map: MapDef = {
      ...testArena,
      props,
      lights: [
        { kind: 'point', pos: { x: 0, y: 3, z: 0 }, color: [1, 0.8, 0.5], intensity: 2, range: 8 },
        { kind: 'spot', pos: { x: 2, y: 4, z: 0 }, color: [1, 1, 1], intensity: 3, range: 10, dir: { x: 0, y: -1, z: 0 }, angle: 1 },
      ],
    };
    const base = counts(scene);
    const materials = new MaterialLibrary(scene, { textureSize: 64, anisotropy: 4, texgen: { workers: false } });
    await materials.prepare(MapRenderer.usedMaterials(map));
    const renderer = new MapRenderer(scene, map, materials, null, quality);
    expect(renderer.propCount).toBe(props.length);
    // Lanterns contribute lights; the map lights do too.
    expect(renderer.lightCount).toBe(2 + 2);
    // Nearest-light culling keeps the enabled count within budget.
    renderer.update(1, new Vector3(0, 1, 0));
    const enabled = scene.lights.filter((l) => l.isEnabled()).length;
    expect(enabled).toBeLessThanOrEqual(quality.maxDynamicLights - 2);
    scene.render();
    renderer.dispose();
    materials.dispose();
    expect(counts(scene)).toEqual(base);
  });
});
