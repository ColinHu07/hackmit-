import * as THREE from 'three';

interface CreatureProjection {
  visible: boolean;
  x: number;
  y: number;
  confidence: number;
}

const DISPLAY_SIZE = 600;

/** A small, original geometry creature on the display's unlit black background. */
export class NovaRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-300, 300, 300, -300, 0.1, 1_000);
  private readonly anchor = new THREE.Group();
  private readonly creature = new THREE.Group();
  private readonly eyes: THREE.Group[] = [];
  private readonly star = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    // Allow construction errors to reach the app's friendly WebGL fallback.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: true,
      powerPreference: 'low-power',
    });
    // The display is exactly 600 × 600; avoid allocating a larger Retina buffer.
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(DISPLAY_SIZE, DISPLAY_SIZE, false);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.camera.position.set(0, 0, 400);

    this.scene.add(new THREE.HemisphereLight(0xf4eeff, 0x5a367a, 2.2));
    const keyLight = new THREE.DirectionalLight(0xfff4eb, 3.1);
    keyLight.position.set(-100, 150, 220);
    this.scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xadcaff, 2);
    rimLight.position.set(150, 30, -70);
    this.scene.add(rimLight);

    this.scene.add(this.anchor);
    this.anchor.add(this.creature);
    this.buildCreature();
    this.anchor.visible = false;
    this.renderer.render(this.scene, this.camera);
  }

  render(elapsedSeconds: number, projection: CreatureProjection): void {
    if (this.disposed) return;

    this.anchor.visible = projection.visible
      && projection.confidence > 0
      && Number.isFinite(projection.x)
      && Number.isFinite(projection.y);
    // Projection uses top-left screen coordinates; Three's camera uses Y-up.
    this.anchor.position.set(projection.x - DISPLAY_SIZE / 2, DISPLAY_SIZE / 2 - projection.y, 0);

    const time = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
    const breath = this.reducedMotion ? 0 : Math.sin(time * 1.8);
    this.creature.position.y = this.reducedMotion ? 0 : Math.sin(time * 1.35) * 2.5;
    this.creature.scale.set(1 - breath * 0.009, 1 + breath * 0.014, 1);
    this.creature.rotation.set(0, this.reducedMotion ? 0 : Math.sin(time * 0.7) * 0.045,
      this.reducedMotion ? 0 : Math.sin(time * 0.9) * 0.016);

    const blinkPhase = time % 5.6;
    const blink = !this.reducedMotion && blinkPhase >= 5.05 && blinkPhase <= 5.35
      ? Math.max(0.08, 1 - Math.sin(((blinkPhase - 5.05) / 0.3) * Math.PI))
      : 1;
    for (const eye of this.eyes) eye.scale.y = blink;

    this.star.rotation.z = this.reducedMotion ? 0 : Math.sin(time * 1.3) * 0.06;
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

  private buildCreature(): void {
    const lavender = this.material({ color: 0xa887ef, roughness: 0.53 });
    const lightLavender = this.material({ color: 0xbba3f5, roughness: 0.58 });
    const earPink = this.material({ color: 0xf4c7e5, roughness: 0.7 });
    const cream = this.material({ color: 0xf4e8ff, roughness: 0.72 });
    const blush = this.material({ color: 0xf6a7cc, roughness: 0.7 });
    const ink = this.material({ color: 0x17132c, roughness: 0.16, metalness: 0.08 });
    const white = this.material({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.2 });
    const mint = this.material({
      color: 0xd5ffb6,
      emissive: 0xacec73,
      emissiveIntensity: 0.22,
      roughness: 0.44,
    });

    // Shared geometry keeps this tiny scene inexpensive on a wearable browser.
    const sphere = this.geometry(new THREE.SphereGeometry(1, 40, 28));
    const ellipsoid = (
      parent: THREE.Object3D,
      material: THREE.Material,
      position: [number, number, number],
      scale: [number, number, number],
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(sphere, material);
      mesh.position.set(...position);
      mesh.scale.set(...scale);
      parent.add(mesh);
      return mesh;
    };

    for (const side of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(side * 23, 32, -1);
      ear.rotation.z = side * -0.25;
      this.creature.add(ear);
      ellipsoid(ear, lavender, [0, 0, 0], [10, 23, 8]);
      ellipsoid(ear, earPink, [0, 4, 6], [5.1, 13.2, 2]);

      const arm = ellipsoid(this.creature, lavender, [side * 34, -8, 0], [8, 12.5, 8]);
      arm.rotation.z = side * 0.3;
      ellipsoid(this.creature, lightLavender, [side * 17, -33, 9], [12, 7, 13]);
    }

    ellipsoid(this.creature, lavender, [0, 0, 0], [37, 36, 29]);
    // The chest follows the front curve of the body without a surrounding plate.
    ellipsoid(this.creature, cream, [0, -15, 25], [15.5, 12, 4.5]);

    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 12.5, 8, 27.5);
      this.creature.add(eye);
      this.eyes.push(eye);
      ellipsoid(eye, ink, [0, 0, 0], [4.5, 6.1, 3.3]);
      ellipsoid(eye, white, [-1.2, 2.1, 2.85], [1.4, 1.65, 0.65]);
      ellipsoid(eye, white, [1.3, -1.9, 3], [0.65, 0.7, 0.35]);
      ellipsoid(this.creature, blush, [side * 23, -1, 22.8], [5.4, 2.4, 1.5]);
    }

    const smileCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-4, -3, 29.5),
      new THREE.Vector3(-2, -5, 29.8),
      new THREE.Vector3(0, -4, 30),
      new THREE.Vector3(2, -5, 29.8),
      new THREE.Vector3(4, -3, 29.5),
    ]);
    this.creature.add(new THREE.Mesh(this.geometry(new THREE.TubeGeometry(smileCurve, 24, 0.7, 8, false)), ink));

    // A little four-point sprout is Nova's own identifying feature.
    const starShape = new THREE.Shape();
    starShape.moveTo(0, 10);
    starShape.lineTo(3, 3);
    starShape.lineTo(8, 0);
    starShape.lineTo(3, -3);
    starShape.lineTo(0, -9);
    starShape.lineTo(-3, -3);
    starShape.lineTo(-8, 0);
    starShape.lineTo(-3, 3);
    starShape.closePath();
    const starGeometry = this.geometry(new THREE.ExtrudeGeometry(starShape, {
      depth: 2,
      bevelEnabled: true,
      bevelThickness: 1,
      bevelSize: 0.8,
      bevelSegments: 2,
      steps: 1,
    }));
    this.star.position.set(0, 48, 6);
    this.star.add(new THREE.Mesh(starGeometry, mint));
    this.creature.add(this.star);
  }

  private material(parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial(parameters);
    this.materials.add(material);
    return material;
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }
}
