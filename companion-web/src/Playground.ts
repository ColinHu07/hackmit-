import * as THREE from 'three';
import { startingCamera } from './WalkingView';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { SoftGait } from '../../glasses-web/src/rendering/SoftGait';
import { SoftHead } from '../../glasses-web/src/rendering/SoftHead';
import type { WeatherKind } from './LocalWeather';
import type { WalkingPose } from './WalkingTracker';
import type { PlayPlayer, PlaySnapshot } from '../../shared/play-protocol';

const WORLD_LIMIT = 3;
const PET_EXTENT = 1.5;
const SLOT_COLORS = [0x759582, 0xd58e70] as const;

interface NearbyPet {
  id: string;
  name: string;
  distanceMeters: number;
  uncertain: boolean;
}

interface PetVisual {
  root: THREE.Group;
  body: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  hearts: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>[];
  treat: THREE.Group;
  heads: SoftHead[];
  gaits: SoftGait[];
  playerId: string | null;
  distance: number;
  gaitStrength: number;
  yaw: number;
}

/** Shared room coordinates, or an illustrative arrangement of nearby pets. */
export class Playground {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 70);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.02);
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly pets: PetVisual[] = [];
  private readonly target: THREE.Group;
  private readonly ball: THREE.Group;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly shadowTexture: THREE.CanvasTexture;
  private readonly flowers = new THREE.Group();
  private readonly weatherParticles = new THREE.Group();
  private weatherKind: WeatherKind = 'unknown';
  private groundMaterial = new THREE.MeshStandardMaterial({ color: 0xc5d5a8, transparent: true, opacity: 0.65, roughness: 1 });
  private snapshot: PlaySnapshot | null = null;
  private localPlayerId: string | null = null;
  private nearby: NearbyPet[] | null = null;
  private onSelectNearby: ((peerId: string) => void) | undefined;
  private snapshotReceivedAt = 0;
  private walkingPose: WalkingPose | null = null;
  private enabled = false;
  private disposed = false;
  private visible = true;
  private contextLost = false;
  private frame = 0;
  private previousFrame = 0;
  private pointer: { id: number; x: number; y: number; time: number; dragged: boolean } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onMove: (x: number, z: number) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.setClearColor(0xecf0e6, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera.position.set(0, 13, 10);
    this.camera.lookAt(0, 0, 0);

    this.shadowTexture = this.makeShadowTexture();
    this.buildIsland();
    this.scene.add(this.flowers, this.weatherParticles);
    const dropGeometry = new THREE.SphereGeometry(0.022, 4, 4);
    const dropMaterial = new THREE.MeshBasicMaterial({ color: 0xd5e9ff, transparent: true, opacity: 0.65 });
    for (let i = 0; i < 100; i++) {
      const drop = this.mesh(dropGeometry, dropMaterial);
      drop.position.set(Math.sin(i * 17.13) * 4, (i % 23) / 23 * 6, Math.cos(i * 9.17) * 4);
      this.weatherParticles.add(drop);
    }
    this.setWeather('unknown');
    this.target = this.buildTarget();
    this.scene.add(this.target);
    this.ball = this.buildBall();
    this.scene.add(this.ball);
    this.scene.add(new THREE.HemisphereLight(0xfffbec, 0x869477, 2.6));
    const sun = new THREE.DirectionalLight(0xfff2cf, 3.2);
    sun.position.set(-3, 9, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 24;
    sun.shadow.normalBias = 0.035;
    sun.shadow.bias = -0.00015;
    sun.shadow.radius = 3;
    this.scene.add(sun);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry?.isIntersecting ?? false;
      this.refreshAnimation();
    });
    this.intersectionObserver.observe(canvas);
    this.resize();
    this.refreshAnimation();
  }

  setWeather(kind: WeatherKind): void {
    this.weatherKind = kind;
    this.flowers.visible = kind === 'sunny';
    this.weatherParticles.visible = kind === 'rain' || kind === 'snow';
    this.groundMaterial.color.set(kind === 'snow' ? 0xe3edf3 : kind === 'rain' ? 0x8fa7a6 : kind === 'night' ? 0x79849c : 0xc5d5a8);
    for (const drop of this.weatherParticles.children) drop.scale.set(1, kind === 'rain' ? 9 : 1.8, 1);
    this.renderer.toneMappingExposure = kind === 'night' ? 0.72 : kind === 'rain' ? 0.92 : 1.12;
  }

  setWalkingPose(pose: WalkingPose | null, initialHeading = false): void {
    this.walkingPose = pose ? { ...pose } : null;
    if (pose && initialHeading) {
      const pet = this.snapshot ? this.pets.find(pet => pet.playerId === this.localPlayerId) : this.pets[0];
      if (pet) { pet.yaw = pose.yaw; pet.body.rotation.y = pose.yaw; }
      this.camera.position.set(...startingCamera(pose.yaw));
    }
    if (!pose) this.camera.position.set(0, 13, 10);
    this.camera.lookAt(0, 0, 0);
  }

  async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/nova.glb`);
    // Build the shared playground pair and two discovery visitors once. Each
    // has independent morph geometry, reused as nearby people come and go.
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) this.trackMesh(object);
    });
    if (this.disposed) {
      this.disposeResources();
      return;
    }
    for (let slot = 0; slot < 4; slot++) this.pets.push(this.buildPet(gltf.scene, slot));
    this.update(this.snapshot, this.localPlayerId);
  }

  update(snapshot: PlaySnapshot | null, localPlayerId: string | null): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    this.localPlayerId = localPlayerId;
    this.snapshotReceivedAt = performance.now();
    if (snapshot) {
      this.nearby = null;
      this.onSelectNearby = undefined;
      this.setEnabled(this.enabled);
    } else if (this.nearby !== null) {
      this.updateNearbyPets();
      return;
    }
    const players = snapshot?.players ?? [];
    for (let index = 0; index < this.pets.length; index++) {
      const pet = this.pets[index]!;
      const player = index < 2 ? players.find((candidate) => candidate.slot === index) : undefined;
      const isPreview = !snapshot && index === 0;
      pet.root.visible = isPreview || Boolean(player?.connected);
      if (isPreview) {
        pet.playerId = null;
        if (!this.walkingPose) { pet.root.position.set(0, 0.035, 0); pet.yaw = Math.PI; }
      } else if (player && pet.playerId !== player.id) {
        pet.playerId = player.id;
        pet.root.position.set(player.x, 0.035, player.z);
        pet.yaw = player.yaw;
        pet.distance = 0;
        pet.gaitStrength = 0;
      }
      pet.ring.material.opacity = player?.id === localPlayerId ? 0.82 : 0.46;
      pet.ring.scale.setScalar(player?.id === localPlayerId ? 1.08 : 1);
    }
    this.refreshAnimation();
  }

  /** Illustrative discovery positions; these are not bearings or AR anchors. */
  setNearby(peers: NearbyPet[] | null, onSelect?: (peerId: string) => void): void {
    if (this.disposed) return;
    this.nearby = peers === null ? null : peers.filter((peer, index) =>
      peers.findIndex((candidate) => candidate.id === peer.id) === index).slice(0, 3);
    this.onSelectNearby = peers === null ? undefined : onSelect;
    this.pointer = null;
    this.target.visible = false;
    this.ball.visible = false;
    this.setEnabled(this.enabled);
    if (this.nearby !== null) {
      this.snapshot = null;
      this.localPlayerId = null;
      this.updateNearbyPets();
    } else {
      this.update(this.snapshot, this.localPlayerId);
    }
  }

  private updateNearbyPets(): void {
    if (this.nearby === null) return;
    const remaining = new Map(this.nearby.map((peer) => [peer.id, peer]));
    // Keep each visitor in the same slot when distance updates reorder the list.
    for (let index = 1; index < this.pets.length; index++) {
      const pet = this.pets[index]!;
      if (pet.playerId && remaining.has(pet.playerId)) remaining.delete(pet.playerId);
      else pet.playerId = null;
    }
    const unassigned = remaining.values();
    for (let index = 0; index < this.pets.length; index++) {
      const pet = this.pets[index]!;
      if (index === 0) {
        pet.playerId = null;
        pet.root.visible = true;
        if (!this.walkingPose) { pet.root.position.set(0, 0.035, 0); pet.yaw = Math.PI; }
      } else {
        pet.playerId ??= unassigned.next().value?.id ?? null;
        const peer = this.nearby.find((candidate) => candidate.id === pet.playerId);
        pet.root.visible = Boolean(peer);
        // A fixed semicircle avoids implying GPS can place a pet precisely.
        const angle = index * Math.PI / 3 - Math.PI / 6;
        pet.root.position.set(Math.cos(angle) * 2.65, 0.035, -Math.sin(angle) * 2.65);
        pet.yaw = Math.atan2(-pet.root.position.x, -pet.root.position.z);
        pet.ring.material.opacity = peer?.uncertain ? 0.3 : 0.65;
      }
      if (index === 0) pet.ring.material.opacity = 0.82;
      pet.ring.scale.setScalar(index === 0 ? 1.08 : 1);
      pet.distance = 0;
      pet.gaitStrength = 0;
    }
    this.refreshAnimation();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.canvas.style.cursor = enabled ? (this.nearby !== null ? 'pointer' : 'crosshair') : 'default';
    if (!enabled) this.target.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.disposeResources();
    this.scene.traverse((object) => {
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    this.scene.clear();
    this.renderer.dispose();
  }

  private trackMesh(mesh: THREE.Mesh): void {
    this.geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      this.materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) this.textures.add(value);
      }
    }
  }

  private mesh<G extends THREE.BufferGeometry, M extends THREE.Material>(geometry: G, material: M): THREE.Mesh<G, M> {
    const mesh = new THREE.Mesh(geometry, material);
    this.trackMesh(mesh);
    return mesh;
  }

  private material(color: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
  }

  private makeShadowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(42,61,40,0.48)');
      gradient.addColorStop(0.45, 'rgba(42,61,40,0.24)');
      gradient.addColorStop(1, 'rgba(42,61,40,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    this.textures.add(texture);
    return texture;
  }

  private buildIsland(): void {
    const fadeCanvas = document.createElement('canvas');
    fadeCanvas.width = fadeCanvas.height = 128;
    const context = fadeCanvas.getContext('2d');
    if (context) {
      const fade = context.createRadialGradient(64, 64, 20, 64, 64, 64);
      fade.addColorStop(0, '#fff');
      fade.addColorStop(0.65, '#888');
      fade.addColorStop(1, '#000');
      context.fillStyle = fade;
      context.fillRect(0, 0, 128, 128);
    }
    const alpha = new THREE.CanvasTexture(fadeCanvas);
    this.textures.add(alpha);
    this.groundMaterial.alphaMap = alpha;
    this.groundMaterial.depthWrite = false;
    const lawn = this.mesh(new THREE.CircleGeometry(5.5, 80), this.groundMaterial);
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.y = 0.001;
    lawn.receiveShadow = true;
    this.scene.add(lawn);
    const underside = this.mesh(new THREE.PlaneGeometry(10.8, 10.8), new THREE.MeshBasicMaterial({
      map: this.shadowTexture, transparent: true, opacity: 0.21, depthWrite: false,
    }));
    underside.rotation.x = -Math.PI / 2;
    underside.position.y = -0.87;
    this.scene.add(underside);

    // Quiet markings make the board easy to read without drawing a literal grid.
    for (const radius of [1.05, 2.3]) {
      const marking = this.mesh(new THREE.RingGeometry(radius, radius + 0.018, 72), new THREE.MeshBasicMaterial({
        color: 0xf8f8e8, transparent: true, opacity: 0.3, depthWrite: false,
      }));
      marking.rotation.x = -Math.PI / 2;
      marking.position.y = 0.009;
      this.scene.add(marking);
    }
    const stoneMaterial = this.material(0xdbdbc7);
    const grassMaterial = this.material(0x8da77b);
    const flowerMaterial = this.material(0xfff3ce);
    const flowerCenterMaterial = this.material(0xd7b768);
    const stoneGeometry = new THREE.DodecahedronGeometry(1, 0);
    const bladeGeometry = new THREE.ConeGeometry(0.05, 0.24, 4);
    const flowerGeometry = new THREE.SphereGeometry(0.047, 6, 4);
    // Deterministic placement means the same shared place appears on every device.
    for (let index = 0; index < 30; index++) {
      const side = index % 4;
      const along = -2.9 + Math.floor(index / 4) * 0.82;
      const edge = 3.45 + Math.sin(index * 3.7) * 0.09;
      const x = side === 0 ? -edge : side === 1 ? edge : along;
      const z = side === 2 ? -edge : side === 3 ? edge : along;
      if (index % 5 === 0) {
        const stone = this.mesh(stoneGeometry, stoneMaterial);
        stone.position.set(x, 0.09, z);
        stone.scale.set(0.17 + (index % 3) * 0.025, 0.11, 0.13);
        stone.rotation.set(0.2, index, 0.15);
        stone.castShadow = true;
        this.scene.add(stone);
      } else {
        for (let bladeIndex = 0; bladeIndex < 3; bladeIndex++) {
          const blade = this.mesh(bladeGeometry, grassMaterial);
          blade.position.set(x + (bladeIndex - 1) * 0.06, 0.09, z + bladeIndex * 0.018);
          blade.rotation.z = (bladeIndex - 1) * -0.25;
          blade.scale.y = 0.7 + ((index + bladeIndex) % 4) * 0.15;
          this.scene.add(blade);
        }
        if (index % 3 === 0) {
          const flower = new THREE.Group();
          for (let petal = 0; petal < 5; petal++) {
            const sphere = this.mesh(flowerGeometry, flowerMaterial);
            sphere.position.set(Math.cos(petal * Math.PI * 0.4) * 0.06, 0, Math.sin(petal * Math.PI * 0.4) * 0.06);
            sphere.scale.y = 0.4;
            flower.add(sphere);
          }
          flower.add(this.mesh(new THREE.SphereGeometry(0.035, 6, 4), flowerCenterMaterial));
          flower.position.set(x, 0.2, z);
          flower.scale.setScalar(1.6);
          this.flowers.add(flower);
        }
      }
    }
  }

  private buildTarget(): THREE.Group {
    const target = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: 0x536f60, opacity: 0.65, transparent: true, depthWrite: false });
    const ring = this.mesh(new THREE.RingGeometry(0.23, 0.255, 36), material);
    ring.rotation.x = -Math.PI / 2;
    target.add(ring);
    const dot = this.mesh(new THREE.CircleGeometry(0.035, 12), material);
    dot.rotation.x = -Math.PI / 2;
    target.add(dot);
    target.position.y = 0.026;
    target.visible = false;
    return target;
  }

  private buildBall(): THREE.Group {
    const ball = new THREE.Group();
    ball.add(this.mesh(new THREE.SphereGeometry(0.15, 16, 12), this.material(0xe9ae75)));
    const stripe = this.mesh(new THREE.TorusGeometry(0.148, 0.016, 6, 24), this.material(0xfff5da));
    stripe.rotation.x = 0.6;
    ball.add(stripe);
    ball.visible = false;
    return ball;
  }

  private heartGeometry(): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.6);
    shape.bezierCurveTo(-1.1, 0.1, -0.8, 0.95, -0.3, 0.8);
    shape.bezierCurveTo(-0.1, 0.78, 0, 0.63, 0, 0.5);
    shape.bezierCurveTo(0, 0.63, 0.1, 0.78, 0.3, 0.8);
    shape.bezierCurveTo(0.8, 0.95, 1.1, 0.1, 0, -0.6);
    return new THREE.ShapeGeometry(shape, 10);
  }

  private buildPet(source: THREE.Group, slot: number): PetVisual {
    const root = new THREE.Group();
    const body = new THREE.Group();
    const model = clone(source);
    const heads: SoftHead[] = [];
    const gaits: SoftGait[] = [];
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry = object.geometry.clone();
      if (!object.geometry.getAttribute('normal')) object.geometry.computeVertexNormals();
      this.trackMesh(object);
      object.castShadow = true;
      object.receiveShadow = false;
      if (!(object instanceof THREE.SkinnedMesh) && !object.geometry.morphAttributes.position?.length) {
        heads.push(new SoftHead(object));
        gaits.push(new SoftGait(object));
      }
    });
    const bounds = new THREE.Box3().setFromObject(source);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = PET_EXTENT / Math.max(size.x, size.y, size.z);
    const normalized = new THREE.Group();
    normalized.scale.setScalar(scale);
    normalized.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    normalized.add(model);
    body.add(normalized);
    root.add(body);
    const ring = this.mesh(new THREE.RingGeometry(0.45, 0.49, 64), new THREE.MeshBasicMaterial({
      color: SLOT_COLORS[slot === 0 ? 0 : 1], opacity: 0.72, transparent: true, depthWrite: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.009;
    root.add(ring);
    const shadow = this.mesh(new THREE.PlaneGeometry(1.35, 1.1), new THREE.MeshBasicMaterial({
      map: this.shadowTexture, transparent: true, opacity: 0.75, depthWrite: false,
    }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.004;
    root.add(shadow);
    const hearts = Array.from({ length: 4 }, () => {
      const heart = this.mesh(this.heartGeometry(), new THREE.MeshBasicMaterial({
        color: 0xd79380, side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false,
      }));
      heart.scale.setScalar(0.1);
      root.add(heart);
      return heart;
    });
    const treat = new THREE.Group();
    const fruit = this.mesh(new THREE.SphereGeometry(0.115, 12, 10), this.material(0xedb965));
    fruit.scale.y = 0.85;
    treat.add(fruit);
    const leaf = this.mesh(new THREE.SphereGeometry(0.045, 8, 6), this.material(0x6f9162));
    leaf.scale.set(0.65, 0.4, 1.6);
    leaf.position.set(0.035, 0.09, 0);
    leaf.rotation.x = -0.4;
    treat.add(leaf);
    root.add(treat);
    this.scene.add(root);
    return { root, body, ring, shadow, hearts, treat, heads, gaits, playerId: null, distance: 0, gaitStrength: 0, yaw: Math.PI };
  }

  private resize = (): void => {
    if (this.disposed || this.contextLost) return;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const aspect = width / height;
    const halfHeight = Math.max(4.15, 5.6 / aspect);
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || !event.isPrimary || event.button !== 0) return;
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), dragged: false };
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.pointer?.id === event.pointerId
      && Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y) > 12) this.pointer.dragged = true;
  };

  private onPointerCancel = (): void => { this.pointer = null; };

  private onPointerUp = (event: PointerEvent): void => {
    const pointer = this.pointer;
    this.pointer = null;
    if (!this.enabled || !pointer || pointer.dragged || pointer.id !== event.pointerId || (!this.snapshot && this.nearby === null)
      || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 12
      || performance.now() - pointer.time > 600) return;
    const rectangle = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(
      (event.clientX - rectangle.left) / rectangle.width * 2 - 1,
      -(event.clientY - rectangle.top) / rectangle.height * 2 + 1,
    ), this.camera);
    if (this.nearby !== null) {
      const visiblePets = this.pets.filter((pet) => pet.root.visible);
      const hit = this.raycaster.intersectObjects(visiblePets.map((pet) => pet.body), true)[0];
      let object: THREE.Object3D | null = hit?.object ?? null;
      while (object) {
        const visitor = visiblePets.find((pet) => pet.body === object);
        if (visitor?.playerId) {
          this.onSelectNearby?.(visitor.playerId);
          break;
        }
        object = object.parent;
      }
      return;
    }
    const point = this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    if (!point || Math.abs(point.x) > 3.7 || Math.abs(point.z) > 3.7) return;
    this.onMove(THREE.MathUtils.clamp(point.x, -WORLD_LIMIT, WORLD_LIMIT), THREE.MathUtils.clamp(point.z, -WORLD_LIMIT, WORLD_LIMIT));
  };

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.refreshAnimation();
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    this.resize();
    this.refreshAnimation();
  };

  private onVisibilityChange = (): void => { this.refreshAnimation(); };

  private refreshAnimation(): void {
    const shouldAnimate = !this.disposed && !this.contextLost && this.visible && !document.hidden;
    if (!shouldAnimate) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.previousFrame = 0;
    } else if (!this.frame) {
      this.frame = requestAnimationFrame(this.animate);
    }
  }

  private animate = (now: number): void => {
    this.frame = 0;
    if (this.disposed || this.contextLost || !this.visible || document.hidden) return;
    const delta = this.previousFrame ? Math.min((now - this.previousFrame) / 1000, 0.08) : 0.016;
    this.previousFrame = now;
    const reducedMotion = this.motionPreference.matches;
    const serverTime = (this.snapshot?.serverTime ?? now) + (this.snapshot ? now - this.snapshotReceivedAt : 0);
    for (let index = 0; index < this.pets.length; index++) {
      const pet = this.pets[index]!;
      if (!pet.root.visible) continue;
      let player = this.snapshot?.players.find((candidate) => candidate.id === pet.playerId);
      if (this.walkingPose && ((!this.snapshot && index === 0) || player?.id === this.localPlayerId)) {
        const pose = this.walkingPose;
        player = player ? { ...player, yaw: pose.yaw } : {
          id: 'local-walk', name: '', slot: 0, ...pose, targetX: pose.x, targetZ: pose.z,
          connected: true, action: null,
        };
      }
      this.animatePet(pet, player, delta, now / 1000, serverTime, reducedMotion);
    }
    const local = this.snapshot?.players.find((player) => player.id === this.localPlayerId);
    this.target.visible = this.enabled && Boolean(local?.connected)
      && Boolean(local && Math.hypot(local.targetX - local.x, local.targetZ - local.z) > 0.18);
    if (local && this.target.visible) {
      this.target.position.set(local.targetX, 0.026, local.targetZ);
      this.target.scale.setScalar(reducedMotion ? 1 : 1 + Math.sin(now / 220) * 0.05);
    }
    this.animateBall(serverTime, reducedMotion);
    if (this.weatherParticles.visible && !reducedMotion) {
      for (const drop of this.weatherParticles.children) {
        drop.position.y -= delta * (this.weatherKind === 'rain' ? 5 : 0.65);
        if (drop.position.y < 0) drop.position.y = 6;
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.refreshAnimation();
  };

  private animatePet(pet: PetVisual, player: PlayPlayer | undefined, delta: number, seconds: number, serverTime: number, reducedMotion: boolean): void {
    let speed = 0;
    if (player) {
      const dx = player.x - pet.root.position.x;
      const dz = player.z - pet.root.position.z;
      const blend = reducedMotion ? 1 : 1 - Math.exp(-15 * delta);
      const travel = Math.hypot(dx, dz) * blend;
      speed = travel / delta;
      pet.root.position.x += dx * blend;
      pet.root.position.z += dz * blend;
      pet.distance += travel * 142 / PET_EXTENT;
      const yawDelta = Math.atan2(Math.sin(player.yaw - pet.yaw), Math.cos(player.yaw - pet.yaw));
      pet.yaw += yawDelta * (reducedMotion ? 1 : 1 - Math.exp(-10 * delta));
    }
    pet.gaitStrength = THREE.MathUtils.lerp(pet.gaitStrength, reducedMotion ? 0 : Math.min(speed * 0.9, 1), 1 - Math.exp(-12 * delta));
    const action = player?.action;
    const progress = action ? THREE.MathUtils.clamp((serverTime - action.startedAt) / Math.max(1, action.duration), 0, 1) : 1;
    const active = Boolean(action && serverTime >= action.startedAt && progress < 1);
    const envelope = active ? Math.sin(progress * Math.PI) : 0;
    let lift = 0;
    let tilt = reducedMotion ? 0 : Math.sin(seconds * 1.7) * 0.018;
    let bow = 0;
    let yaw = pet.yaw;
    if (!reducedMotion && active && action) {
      if (action.kind === 'wave') tilt += Math.sin(progress * Math.PI * 7) * 0.12 * envelope;
      if (action.kind === 'feed') bow = Math.sin(progress * Math.PI * 4) * 0.14 * envelope;
      if (action.kind === 'jump') lift = Math.sin(progress * Math.PI) * 0.7;
      if (action.kind === 'play') {
        lift = Math.abs(Math.sin(progress * Math.PI * 3)) * 0.26;
        const friend = this.snapshot?.players.find((candidate) => candidate.id !== player?.id && candidate.connected);
        if (friend) yaw = Math.atan2(friend.x - pet.root.position.x, friend.z - pet.root.position.z);
        tilt += Math.sin(progress * Math.PI * 6) * 0.055;
      }
    }
    pet.body.position.y = lift + (reducedMotion ? 0 : Math.sin(pet.distance / 36 * Math.PI * 4) * 0.014 * pet.gaitStrength);
    pet.body.rotation.set(0, yaw, tilt * 0.25);
    for (const head of pet.heads) head.set(tilt, bow);
    for (const gait of pet.gaits) gait.set(pet.distance, pet.gaitStrength);
    pet.shadow.material.opacity = 0.72 - lift * 0.4;
    pet.shadow.scale.setScalar(1 - lift * 0.22);
    pet.treat.visible = active && action?.kind === 'feed';
    if (pet.treat.visible) {
      pet.treat.position.set(Math.sin(yaw) * 0.57, 0.52 + envelope * 0.35, Math.cos(yaw) * 0.57);
      pet.treat.scale.setScalar(reducedMotion ? 1 : 1 - progress * 0.65);
    }
    for (let index = 0; index < pet.hearts.length; index++) {
      const heart = pet.hearts[index]!;
      heart.visible = active && action?.kind !== 'jump' && (reducedMotion ? index === 0 : true);
      if (!heart.visible) continue;
      const phase = reducedMotion ? 0.4 : (progress * 1.6 + index * 0.24) % 1;
      heart.material.opacity = Math.sin(phase * Math.PI) * envelope * 0.9;
      heart.position.set((index - 1.5) * 0.22, 1.45 + phase * 0.75, 0);
      heart.quaternion.copy(this.camera.quaternion);
      heart.scale.setScalar(0.095 + Math.sin(phase * Math.PI) * 0.035);
    }
  }

  private animateBall(serverTime: number, reducedMotion: boolean): void {
    const player = this.snapshot?.players.find((candidate) => candidate.connected && candidate.action?.kind === 'play'
      && candidate.action.startedAt <= serverTime && candidate.action.startedAt + candidate.action.duration > serverTime);
    const action = player?.action;
    this.ball.visible = Boolean(player && action);
    if (!player || !action) return;
    const friend = this.snapshot?.players.find((candidate) => candidate.id !== player.id && candidate.connected);
    const progress = (serverTime - action.startedAt) / action.duration;
    const between = reducedMotion ? 0.5 : (Math.sin(progress * Math.PI * 4 - Math.PI / 2) + 1) / 2;
    this.ball.position.set(
      THREE.MathUtils.lerp(player.x, friend?.x ?? player.x + 0.8, between),
      0.17 + (reducedMotion ? 0 : Math.abs(Math.sin(progress * Math.PI * 4)) * 0.32),
      THREE.MathUtils.lerp(player.z, friend?.z ?? player.z + 0.5, between),
    );
    this.ball.rotation.z = reducedMotion ? 0 : progress * Math.PI * 6;
  }

  private disposeResources(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
  }
}
