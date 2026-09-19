import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { placeAnchor, projectAnchor, type AnchorProjection } from '../anchor/PseudoWorldAnchor';
import { AnchorTravel } from '../anchor/AnchorTravel';
import { relocationStart } from '../anchor/RelocationBearing';
import { NovaRenderer } from './NovaRenderer';

const { draw } = vi.hoisted(() => ({ draw: vi.fn() }));

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  return {
    ...three,
    WebGLRenderer: class {
      private pixelRatio = 1;
      setPixelRatio(value: number): void { this.pixelRatio = value; }
      getPixelRatio(): number { return this.pixelRatio; }
      setSize(): void {}
      setClearColor(): void {}
      render = draw;
      dispose(): void {}
      forceContextLoss(): void {}
    },
  };
});

const projection: AnchorProjection = {
  visible: true, x: 300, y: 300, deltaYaw: 0, deltaPitch: 0, confidence: 1,
};

describe('NovaRenderer', () => {
  const preference = { matches: false };
  let renderer: NovaRenderer;

  beforeEach(() => {
    preference.matches = false;
    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => preference });
    renderer = new NovaRenderer({} as HTMLCanvasElement);
    renderer.ready = true;
    draw.mockClear();
  });

  afterEach(() => {
    renderer.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([60, 90, 120])('draws every visible animation update at %s Hz', (refreshRate) => {
    renderer.moveTo(100);
    for (let frame = 0; frame < 10; frame++) renderer.render(frame / refreshRate, projection, null);
    expect(draw).toHaveBeenCalledTimes(10);
  });

  it('continues tracking fractional-pixel head movements under reduced motion', () => {
    preference.matches = true;
    renderer.render(0, projection, null);
    renderer.render(1 / 120, { ...projection, x: 300.001, y: 299.999 }, null);
    expect(draw).toHaveBeenCalledTimes(2);
    const scene = draw.mock.calls[1]![0] as import('three').Scene;
    const anchor = scene.children.find(child => child.type === 'Group');
    expect(anchor?.position.x).toBeCloseTo(0.001, 6);
    expect(anchor?.position.y).toBeCloseTo(0.001, 6);
  });

  it('avoids duplicate draws for unchanged reduced-motion frames', () => {
    preference.matches = true;
    renderer.render(0, projection, null);
    renderer.render(1 / 60, projection, null);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('clears once when the animal becomes hidden and draws when it returns', () => {
    renderer.render(0, projection, null);
    renderer.render(1 / 60, { ...projection, visible: false }, null);
    renderer.render(2 / 60, { ...projection, visible: false }, null);
    expect(draw).toHaveBeenCalledTimes(2);
    renderer.render(3 / 60, projection, null);
    expect(draw).toHaveBeenCalledTimes(3);
  });

  it('redraws size changes under reduced motion while preserving the projected anchor', () => {
    preference.matches = true;
    const offsetProjection = { ...projection, x: 345, y: 280 };
    renderer.render(0, offsetProjection, null);
    const scene = draw.mock.calls[0]![0] as import('three').Scene;
    const anchor = scene.children.find(child => child.type === 'Group')!;
    expect(anchor.scale.toArray()).toEqual([1, 1, 1]);
    renderer.render(1 / 60, { ...offsetProjection, scale: 2 }, null);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(anchor.scale.toArray()).toEqual([2, 2, 2]);
    expect(anchor.position.toArray()).toEqual([45, 20, 0]);
    renderer.render(2 / 60, { ...offsetProjection, scale: 0.5 }, null);
    expect(draw).toHaveBeenCalledTimes(3);
    expect(anchor.scale.toArray()).toEqual([0.5, 0.5, 0.5]);
    renderer.render(3 / 60, { ...offsetProjection, scale: 0.5 }, null);
    expect(draw).toHaveBeenCalledTimes(3);
  });

  it.each([[NaN, 1], [Infinity, 1], [0, 1], [-2, 1], [0.1, 0.25], [8, 3]])(
    'keeps render scale %s safe at %s', (scale, expected) => {
      renderer.render(0, { ...projection, scale }, null);
      const scene = draw.mock.calls[0]![0] as import('three').Scene;
      const anchor = scene.children.find(child => child.type === 'Group')!;
      expect(anchor.scale.toArray()).toEqual([expected, expected, expected]);
    },
  );

  it('projects walking and jumping offsets at the same scale as the rendered animal', () => {
    renderer.moveTo(100);
    renderer.render(0, projection, null);
    for (let frame = 1; frame <= 15; frame++) renderer.render(frame / 60, projection, null);
    expect(renderer.jump()).toBe(true);
    for (let frame = 16; frame <= 42; frame++) renderer.render(frame / 60, projection, null);
    const unitTarget = renderer.interactionProjection(projection);
    expect(unitTarget.x).toBeGreaterThan(projection.x);
    expect(unitTarget.y).toBeLessThan(projection.y);
    for (const scale of [0.5, 2]) {
      const scaledProjection = { ...projection, scale };
      renderer.render(42 / 60, scaledProjection, null);
      const target = renderer.interactionProjection(scaledProjection);
      expect(target.x - projection.x).toBeCloseTo((unitTarget.x - projection.x) * scale);
      expect(projection.y - target.y).toBeCloseTo((projection.y - unitTarget.y) * scale);
      const scene = draw.mock.lastCall![0] as import('three').Scene;
      const anchor = scene.children.find(child => child.type === 'Group')!;
      const creature = anchor.children[0]!;
      scene.updateMatrixWorld(true);
      const worldPosition = creature.position.clone().applyMatrix4(anchor.matrixWorld);
      expect(target.x).toBeCloseTo(worldPosition.x + 300);
      expect(target.y).toBeCloseTo(300 - worldPosition.y);
      expect(target.scale).toBe(scale);
    }
  });

  it.each([0.5, 1, 2])('starts an anchor run without snapping a walking jump at scale %s', scale => {
    const orientation = { yaw: 0, pitch: 0 };
    const anchor = placeAnchor(orientation);
    const initialProjection = { ...projectAnchor(anchor, orientation, 60, 60), scale };
    renderer.moveTo(100);
    renderer.render(0, initialProjection, null);
    for (let frame = 1; frame <= 12; frame++) renderer.render(frame / 60, initialProjection, null);
    renderer.jump();
    for (let frame = 13; frame <= 30; frame++) renderer.render(frame / 60, initialProjection, null);
    const before = renderer.interactionProjection(initialProjection);
    expect(before.x).toBeGreaterThan(initialProjection.x);
    expect(before.y).toBeLessThan(initialProjection.y);

    const offset = renderer.takeTravelOffset();
    const start = relocationStart(anchor, orientation, 60, offset * scale);
    const destination = placeAnchor({ yaw: 20, pitch: 0 });
    const travel = new AnchorTravel(anchor);
    travel.request(start, destination);
    const requested = travel.update(0);
    const startProjection = { ...projectAnchor(requested.anchor!, orientation, 60, 60), scale };
    renderer.render(30 / 60, startProjection, null, undefined, {
      active: requested.travelling, speed: 0, velocityX: 0, velocityY: 0, distanceDelta: 0,
    });
    const after = renderer.interactionProjection(startProjection);
    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
    expect(startProjection.x).not.toBeCloseTo(projectAnchor(destination, orientation, 60, 60).x, 2);
    expect(renderer.jump()).toBe(false);

    // Relocation must not freeze a jump when the animal leaves the viewport.
    for (let frame = 31; frame <= 120; frame++) renderer.render(frame / 60, { ...startProjection, visible: false }, null, undefined, {
      active: true, speed: 90, velocityX: 90, velocityY: 0, distanceDelta: 1.5,
    });
    renderer.render(121 / 60, startProjection, null);
    expect(renderer.interactionProjection(startProjection).x).toBeCloseTo(startProjection.x, 8);
    expect(renderer.interactionProjection(startProjection).y).toBeCloseTo(startProjection.y, 8);
    expect(renderer.jump()).toBe(true);
  });

  it('animates running feet and facing when only the outer anchor is moving', async () => {
    const model = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
    model.add(mesh);
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue({
      scene: model, animations: [],
    } as unknown as Awaited<ReturnType<GLTFLoader['loadAsync']>>);
    await renderer.load();
    const strideWeights = () => Object.entries(mesh.morphTargetDictionary!)
      .filter(([name]) => name.startsWith('stride'))
      .map(([, index]) => mesh.morphTargetInfluences![index]!);
    renderer.render(0, projection, null);
    for (let frame = 1; frame <= 15; frame++) renderer.render(frame / 60, { ...projection, x: 300 + frame * 1.5 }, null, undefined, {
      active: true, speed: 90, velocityX: 90, velocityY: 0, distanceDelta: 1.5,
    });
    const firstStep = strideWeights();
    expect(firstStep).toHaveLength(6);
    expect(Math.max(...firstStep)).toBeGreaterThan(0.5);
    const scene = draw.mock.lastCall![0] as THREE.Scene;
    const anchor = scene.children.find(child => child.type === 'Group')!;
    const creature = anchor.children[0]!;
    expect(creature.position.x).toBe(0);
    expect(creature.rotation.y).toBeGreaterThan(1.4);
    for (let frame = 16; frame <= 21; frame++) renderer.render(frame / 60, { ...projection, x: 300 + frame * 1.5 }, null, undefined, {
      active: true, speed: 90, velocityX: 90, velocityY: 0, distanceDelta: 1.5,
    });
    expect(strideWeights()).not.toEqual(firstStep);

    // Arrival fades the step and turns Nova back toward the viewer.
    for (let frame = 22; frame <= 120; frame++) renderer.render(frame / 60, projection, null, undefined, {
      active: false, speed: 0, velocityX: 0, velocityY: 0, distanceDelta: 0,
    });
    expect(Math.max(...strideWeights())).toBeLessThan(0.000001);
    expect(creature.rotation.y).toBeCloseTo(0, 6);
    preference.matches = true;
    renderer.render(121 / 60, projection, null, undefined, {
      active: true, speed: 90, velocityX: -90, velocityY: 0, distanceDelta: 20,
    });
    expect(strideWeights()).toEqual([0, 0, 0, 0, 0, 0]);
    expect(creature.rotation.y).toBe(0);
  });
});
