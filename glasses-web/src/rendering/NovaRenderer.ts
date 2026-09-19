import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AnchorProjection } from '../anchor/PseudoWorldAnchor';
import type { Reaction } from '../interaction/CreatureSession';

/** User-supplied GLB, normalized once; reactions never move the saved anchor. */
export class NovaRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-300, 300, 300, -300, 0.1, 1000);
  private readonly anchor = new THREE.Group();
  private readonly creature = new THREE.Group();
  private readonly effects = new THREE.Group();
  private readonly hearts: THREE.Mesh[] = [];
  private readonly treat: THREE.Mesh;
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private disposed = false;
  private lastFrame = '';
  ready = false;
  facing = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(600, 600, false);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.camera.position.set(0, 0, 400);
    this.scene.add(new THREE.HemisphereLight(0xf4eeff, 0x423056, 2));
    const key = new THREE.DirectionalLight(0xfff4eb, 3.2);
    key.position.set(-100, 160, 220);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xb9a4ff, 2);
    rim.position.set(150, 60, -90);
    this.scene.add(rim);
    this.scene.add(this.anchor);
    this.anchor.add(this.creature, this.effects);

    const heart = new THREE.Shape();
    heart.moveTo(0, -5);
    heart.bezierCurveTo(-15, 4, -8, 16, 0, 8);
    heart.bezierCurveTo(8, 16, 15, 4, 0, -5);
    const geometry = new THREE.ShapeGeometry(heart);
    this.geometries.add(geometry);
    const pink = new THREE.MeshBasicMaterial({ color: 0xffc4e4, side: THREE.DoubleSide });
    this.materials.add(pink);
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(geometry, pink);
      this.effects.add(mesh);
      this.hearts.push(mesh);
    }
    const treatGeometry = new THREE.IcosahedronGeometry(8, 0);
    const treatMaterial = new THREE.MeshStandardMaterial({ color: 0xffdda0, emissive: 0xffaa33, emissiveIntensity: 0.2 });
    this.geometries.add(treatGeometry);
    this.materials.add(treatMaterial);
    this.treat = new THREE.Mesh(treatGeometry, treatMaterial);
    this.effects.add(this.treat);
    this.anchor.visible = false;
    this.renderer.render(this.scene, this.camera);
  }

  async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/nova.glb`);
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!object.geometry.getAttribute('normal')) object.geometry.computeVertexNormals();
      if (this.disposed) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
        return;
      }
      this.geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) this.materials.add(material);
    });
    if (this.disposed) return;
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const scale = 142 / Math.max(size.x, size.y, size.z);
    gltf.scene.scale.setScalar(scale);
    gltf.scene.position.copy(center).multiplyScalar(-scale);
    this.creature.add(gltf.scene);
    this.ready = true;
  }

  render(time: number, projection: AnchorProjection, reaction: Reaction | null): void {
    if (this.disposed) return;
    const frame = `${this.ready}:${projection.visible}:${projection.x.toFixed(2)}:${projection.y.toFixed(2)}:${this.facing}:${reaction ? time : 'idle'}`;
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    this.anchor.visible = this.ready && projection.visible && projection.confidence > 0;
    this.anchor.position.set(projection.x - 300, 300 - projection.y, 0);
    this.creature.position.set(0, 0, 0);
    this.creature.scale.setScalar(1);
    this.creature.rotation.set(0, this.facing, 0);
    const active = reaction && time - reaction.startedAt < reaction.duration;
    this.effects.visible = !!active;
    this.treat.visible = !!active && reaction.action === 'feed';
    this.hearts.forEach((heart) => { heart.visible = !!active && reaction.action !== 'feed'; });
    if (active) {
      const t = Math.max(0, (time - reaction.startedAt) / reaction.duration);
      const envelope = Math.sin(t * Math.PI);
      if (!this.reducedMotion) {
        if (reaction.action === 'pet') {
          this.creature.rotation.z = Math.sin(t * Math.PI * 4) * 0.1 * envelope;
          this.creature.scale.set(1 + envelope * 0.04, 1 - envelope * 0.03, 1);
        } else if (reaction.action === 'feed') {
          this.creature.rotation.x = Math.sin(t * Math.PI * 6) * 0.12 * envelope;
        } else {
          this.creature.rotation.y += Math.PI * 2 * (t * t * (3 - 2 * t));
          this.creature.position.y = Math.abs(Math.sin(t * Math.PI * 3)) * 24 * envelope;
        }
      }
      this.hearts.forEach((heart, i) => {
        const phase = (t + i * 0.17) % 1;
        heart.position.set((i - 2) * 23, 55 + (this.reducedMotion ? 10 : phase * 55), 90);
        heart.scale.setScalar(this.reducedMotion ? 0.7 : Math.sin(phase * Math.PI) * 0.85);
      });
      this.treat.position.set(28 * (1 - t), -18 + (this.reducedMotion ? 0 : Math.sin(t * Math.PI) * 24), 90);
      this.treat.scale.setScalar(Math.max(0, 1 - Math.max(0, t - 0.55) / 0.35));
      this.treat.rotation.y = t * 5;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
