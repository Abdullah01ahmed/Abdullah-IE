import { describe, expect, it } from 'vitest';
import { ShadowGenerator, NullEngine, Scene, MeshBuilder, PBRMaterial, RawTexture, Engine, Texture, VertexData, Mesh, CascadedShadowGenerator, DirectionalLight, Vector3, HemisphericLight, DefaultRenderingPipeline, SSAO2RenderingPipeline, FreeCamera, ParticleSystem, SolidParticleSystem, Color3, CreateDecal, StandardMaterial, DynamicTexture, PointLight, Matrix, ImageProcessingConfiguration, TransformNode } from '@babylonjs/core';

describe('babylon nullengine smoke', () => {
  it('builds a scene', async () => {
    const t0 = performance.now();
    const engine = new NullEngine({ renderWidth: 64, renderHeight: 64, textureSize: 64, deterministicLockstep: false, lockstepMaxSteps: 1 });
    const scene = new Scene(engine);
    const base = { m: scene.meshes.length, mat: scene.materials.length, t: scene.textures.length, l: scene.lights.length, ps: scene.particleSystems.length, tn: scene.transformNodes.length };
    console.log('baseline', base, 'className', engine.getClassName(), 'csm', CascadedShadowGenerator.IsSupported);
    const cam = new FreeCamera('c', new Vector3(0, 1, 0), scene);
    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.3), scene);
    new HemisphericLight('h', Vector3.Up(), scene);
    new PointLight('pl', new Vector3(0, 2, 0), scene);
    const csm = new ShadowGenerator(1024, sun);
    csm.usePercentageCloserFiltering = true;
    const data = new Uint8Array(16 * 16 * 4).fill(128);
    const tex = new RawTexture(data, 16, 16, Engine.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    const mat = new PBRMaterial('m', scene);
    mat.albedoTexture = tex;
    const box = MeshBuilder.CreateBox('b', { size: 1 }, scene);
    box.material = mat;
    csm.addShadowCaster(box);
    // thin instances
    const buf = new Float32Array(16 * 3);
    for (let i = 0; i < 3; i++) Matrix.Translation(i, 0, 0).copyToArray(buf, i * 16);
    box.thinInstanceSetBuffer('matrix', buf, 16, true);
    const vd = new VertexData();
    vd.positions = [0,0,0, 1,0,0, 1,1,0, 0,1,0];
    vd.indices = new Uint32Array([0,1,2, 0,2,3]);
    vd.normals = [0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1];
    vd.uvs = [0,0, 1,0, 1,1, 0,1];
    vd.colors = [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1];
    const m2 = new Mesh('merged', scene);
    vd.applyToMesh(m2);
    m2.freezeWorldMatrix();
    m2.alwaysSelectAsActiveMesh = true;
    const pipe = new DefaultRenderingPipeline('p', true, scene, [cam]);
    pipe.fxaaEnabled = true; pipe.bloomEnabled = true; pipe.imageProcessingEnabled = true;
    pipe.imageProcessing.toneMappingEnabled = true; pipe.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    pipe.imageProcessing.vignetteEnabled = true; pipe.imageProcessing.colorCurvesEnabled = true;
    const ssao = new SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [cam], true);
    const ps = new ParticleSystem('ps', 100, scene);
    ps.particleTexture = tex; ps.emitter = new Vector3(0,0,0); ps.start();
    const sps = new SolidParticleSystem('sps', scene);
    sps.addShape(box, 10);
    const spsMesh = sps.buildMesh();
    const decal = CreateDecal('d', box, { position: new Vector3(0, 0, -0.5), normal: new Vector3(0, 0, -1), size: new Vector3(0.1, 0.1, 0.1) });
    scene.setRenderingAutoClearDepthStencil(2, true, true, true);
    box.renderingGroupId = 2;
    const tn = new TransformNode('tn', scene);
    let dynOk = true;
    try { const dt = new DynamicTexture('dt', 64, scene, false); dt.drawText('x', 0, 20, '20px sans', '#fff', '#000'); } catch (e) { dynOk = false; console.log('dyn fail:', (e as Error).message); }
    console.log('dynOk', dynOk, 'ssao', !!ssao, 'spsMesh', !!spsMesh, 'std', !!StandardMaterial, Color3.White().r, 'decal verts', decal.getTotalVertices(), 'tn', !!tn);
    scene.render();
    scene.render();
    console.log('after render ms', (performance.now() - t0).toFixed(0));
    // dispose all our things
    pipe.dispose(); ssao.dispose(); ps.dispose(); sps.dispose(); decal.dispose(); m2.dispose(); box.dispose(); mat.dispose(true, true); csm.dispose(); sun.dispose(); cam.dispose(); tn.dispose();
    scene.lights.slice().forEach((l) => l.dispose());
    const after = { m: scene.meshes.length, mat: scene.materials.length, t: scene.textures.length, l: scene.lights.length, ps: scene.particleSystems.length, tn: scene.transformNodes.length };
    console.log('after', after, 'remaining materials', scene.materials.map((x) => x.name), 'textures', scene.textures.map((x) => x.name));
    scene.dispose();
    engine.dispose();
    expect(true).toBe(true);
  });
});
