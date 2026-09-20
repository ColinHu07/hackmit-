import * as THREE from 'three';
import { followingCamera, screenMovement, walkingPlayer } from './WalkingView';
import { meadowTexture, pawTexture } from './MeadowTexture';
import { meadowDetails } from './MeadowDetails';
import { SmoothWalk } from './SmoothWalk';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { SoftGait } from '../../glasses-web/src/rendering/SoftGait';
import { SoftHead } from '../../glasses-web/src/rendering/SoftHead';
import { SoftJump } from '../../glasses-web/src/rendering/SoftJump';
import { GroundContact } from '../../glasses-web/src/rendering/GroundContact';
import { SoftPaws } from './SoftPaws';
import { samplePetAction } from './PetActionPose';
import { advancePetStage, makePlayDance, samplePlayDance, spacePets, type PlayDance } from './PlayChoreography';
import type { WeatherKind } from './LocalWeather';
import type { WalkingPose } from './WalkingTracker';
import type { PlayPlayer, PlaySnapshot } from '../../shared/play-protocol';
import { PLAY_WORLD_LIMIT } from '../../shared/play-protocol';

const PET_EXTENT = 1.5;
const SLOT_COLORS = [0x759582, 0xd58e70, 0x8177a8, 0xd3aa5c] as const;

interface NearbyPet {
  id: string;
  name: string;
  distanceMeters: number;
  uncertain: boolean;
}

interface PetVisual {
  root: THREE.Group;
  stage: THREE.Group;
  presented: { x: number; z: number } | null;
  danceDistance: number;
  danceYaw: number;
  danceGait: number;
  body: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  hearts: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>[];
  treat: THREE.Group;
  crumbs: THREE.Mesh[];
  contact: GroundContact;
  jumps: SoftJump[];
  paws: SoftPaws[];
  heads: SoftHead[];
  gaits: SoftGait[];
  playerId: string | null;
  distance: number;
  gaitStrength: number;
  yaw: number;
  motion: SmoothWalk;
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
  private readonly dances = new Map<number, PlayDance>();
  private readonly target: THREE.Group;
  private readonly ball: THREE.Group;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly shadowTexture: THREE.CanvasTexture;
  private readonly flowers = new THREE.Group();
  private readonly weatherParticles = new THREE.Group();
  private readonly meadowTiles: { plants: THREE.Group; flowers: THREE.Group; dx: number; dz: number }[] = [];
  private readonly sun = new THREE.DirectionalLight(0xfff2cf, 3.2);
  private weatherKind: WeatherKind = 'unknown';
  private groundMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  private readonly footprints: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; born: number }[] = [];
  private footprintIndex = 0;
  private trailPosition: THREE.Vector3 | null = null;
  private snapshot: PlaySnapshot | null = null;
  private localPlayerId: string | null = null;
  private nearby: NearbyPet[] | null = null;
  private onSelectNearby: ((peerId: string) => void) | undefined;
  private snapshotReceivedAt = 0;
  private walkingPose: WalkingPose | null = null;
  private viewTilt = { pitch: 0, roll: 0 };
  private renderedTilt = { pitch: 0, roll: 0 };
  private enabled = false;
  private disposed = false;
  private visible = true;
  private contextLost = false;
  private zoomedOut = false;
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
    const paw = pawTexture(); this.textures.add(paw);
    const footprintGeometry = new THREE.PlaneGeometry(0.32, 0.38);
    for (let i = 0; i < 32; i++) {
      const mesh = this.mesh(footprintGeometry, new THREE.MeshBasicMaterial({ map: paw, color: 0x455c35, transparent: true, opacity: 0, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2; mesh.visible = false;
      this.scene.add(mesh); this.footprints.push({ mesh, born: -Infinity });
    }
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
    const sun = this.sun;
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
    this.scene.add(sun, sun.target);

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
    this.flowers.visible = kind !== 'snow';
    this.weatherParticles.visible = kind === 'rain' || kind === 'snow';
    this.groundMaterial.color.set(kind === 'snow' ? 0xe5efff : kind === 'rain' ? 0xa5bfba : kind === 'night' ? 0x9baac5 : 0xffffff);
    for (const footprint of this.footprints) footprint.mesh.material.color.set(kind === 'night' ? 0xf1dba9 : 0x455c35);
    for (const drop of this.weatherParticles.children) drop.scale.set(1, kind === 'rain' ? 9 : 1.8, 1);
    this.renderer.toneMappingExposure = kind === 'night' ? 0.72 : kind === 'rain' ? 0.92 : 1.12;
  }

  private predictWalkingMovement = false;

  setViewTilt(pitch = 0, roll = 0): void {
    if (Number.isFinite(pitch) && Number.isFinite(roll)) this.viewTilt = { pitch, roll };
  }

  /** Expands the orthographic view while nearby discovery is open. */
  setZoomedOut(zoomedOut: boolean): void {
    if (this.zoomedOut === zoomedOut) return;
    this.zoomedOut = zoomedOut;
    this.resize();
  }

  setWalkingPose(pose: WalkingPose | null, initialHeading = false, predictMovement = false): void {
    this.predictWalkingMovement = predictMovement;
    this.walkingPose = pose ? { ...pose } : null;
    if (pose && initialHeading) {
      const pet = this.snapshot ? this.pets.find(pet => pet.playerId === this.localPlayerId) : this.pets[0];
      if (pet) { pet.yaw = pose.yaw; pet.body.rotation.y = pose.yaw; }
    }
    // The render loop owns the follow camera. Sensor/mode changes must not
    // point it back at the world origin after the pet has walked away.
  }

  moveByScreen(right: number, down: number): void {
    const local = this.snapshot?.players.find(player => player.id === this.localPlayerId);
    const pet = this.pets.find(pet => pet.playerId === this.localPlayerId);
    if (!local || !pet || !this.enabled) return;
    const [x, z] = screenMovement(pet.yaw, right, down);
    const limit = this.snapshot?.worldLimit ?? 3;
    this.onMove(THREE.MathUtils.clamp(local.targetX + x, -limit, limit), THREE.MathUtils.clamp(local.targetZ + z, -limit, limit));
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
      const player = players.find((candidate) => candidate.slot === index);
      const isPreview = !snapshot && index === 0;
      pet.root.visible = isPreview || Boolean(player?.connected);
      if (isPreview) {
        pet.playerId = null;
        if (!this.walkingPose) { pet.root.position.set(0, 0.035, 0); pet.yaw = Math.PI; }
      } else if (player && pet.playerId !== player.id) {
        pet.playerId = player.id;
        pet.presented = null;
        pet.stage.position.set(0, 0, 0);
        pet.root.position.set(player.x, 0.035, player.z);
        pet.motion.reset(player.x, player.z);
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
      if (index !== 0 || !this.walkingPose) {
        pet.distance = 0;
        pet.gaitStrength = 0;
      }
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
      if (object instanceof THREE.InstancedMesh) object.dispose();
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
    const grass = meadowTexture(); this.textures.add(grass);
    this.groundMaterial.map = grass;
    // Extend scenery, never reset player coordinates to keep them on the lawn.
    const side = PLAY_WORLD_LIMIT * 2 + 48;
    grass.repeat.set(side / 12, side / 12);
    const lawn = this.mesh(new THREE.PlaneGeometry(side, side), this.groundMaterial);
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

    const details = meadowDetails();
    for (const group of [details.plants, details.flowers]) {
      group.traverse(object => { if (object instanceof THREE.Mesh) this.trackMesh(object); });
    }
    // Repeat deterministic scenery in world coordinates around the camera.
    // Only offscreen tiles change at a boundary; players and footprints stay put.
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const plants = details.plants.clone(), flowers = details.flowers.clone();
      plants.position.set(dx * 20, 0, dz * 20);
      flowers.position.copy(plants.position);
      this.meadowTiles.push({ plants, flowers, dx, dz });
      this.scene.add(plants);
      this.flowers.add(flowers);
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
    const stage = new THREE.Group();
    root.add(stage);
    const body = new THREE.Group();
    const model = clone(source);
    const heads: SoftHead[] = [];
    const gaits: SoftGait[] = [];
    const jumps: SoftJump[] = [];
    const paws: SoftPaws[] = [];
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
        jumps.push(new SoftJump(object));
        paws.push(new SoftPaws(object));
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
    stage.add(body);
    const contact = new GroundContact(body, 0, 0.27);
    const ring = this.mesh(new THREE.RingGeometry(0.45, 0.49, 64), new THREE.MeshBasicMaterial({
      color: SLOT_COLORS[slot] ?? SLOT_COLORS[0], opacity: 0.72, transparent: true, depthWrite: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.009;
    stage.add(ring);
    const shadow = this.mesh(new THREE.PlaneGeometry(1.35, 1.1), new THREE.MeshBasicMaterial({
      map: this.shadowTexture, transparent: true, opacity: 0.75, depthWrite: false,
    }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.004;
    stage.add(shadow);
    const hearts = Array.from({ length: 4 }, () => {
      const heart = this.mesh(this.heartGeometry(), new THREE.MeshBasicMaterial({
        color: 0xd79380, side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false,
      }));
      heart.scale.setScalar(0.1);
      stage.add(heart);
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
    stage.add(treat);
    const crumbs = Array.from({ length: 6 }, () => {
      const crumb = this.mesh(new THREE.IcosahedronGeometry(0.025, 0), this.material(0xedb965));
      crumb.visible = false;
      stage.add(crumb);
      return crumb;
    });
    this.scene.add(root);
    return { root, stage, presented: null, danceDistance: 0, danceYaw: Math.PI, danceGait: 0, body, ring, shadow, hearts, treat, crumbs, contact, jumps, paws, heads, gaits, playerId: null, distance: 0, gaitStrength: 0, yaw: Math.PI, motion: new SmoothWalk() };
  }

  private resize = (): void => {
    if (this.disposed || this.contextLost) return;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const aspect = width / height;
    const halfHeight = Math.max(3.5, 4.4 / aspect) * (this.zoomedOut ? 1.7 : 1);
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
    if (!point) return;
    const limit = this.snapshot?.worldLimit ?? 3;
    this.onMove(THREE.MathUtils.clamp(point.x, -limit, limit), THREE.MathUtils.clamp(point.z, -limit, limit));
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
        player = walkingPlayer(player, this.walkingPose, this.predictWalkingMovement);
      }
      this.animatePet(pet, player, delta, now / 1000, serverTime, reducedMotion);
    }
    this.animateSocialSpacing(serverTime, delta, reducedMotion);
    const followedPet = this.snapshot ? this.pets.find(pet => pet.playerId === this.localPlayerId) : this.pets[0];
    if (followedPet?.root.visible) {
      const { x, z } = followedPet.root.position;
      // Follow the smoothed walking heading. A play animation can turn the body
      // toward a friend without abruptly swinging the whole meadow around.
      const blend = reducedMotion ? 1 : 1 - Math.exp(-8 * delta);
      this.renderedTilt.pitch += (this.viewTilt.pitch - this.renderedTilt.pitch) * blend;
      this.renderedTilt.roll += (this.viewTilt.roll - this.renderedTilt.roll) * blend;
      this.camera.position.set(...followingCamera(followedPet.yaw, x, z, this.renderedTilt.pitch));
      this.camera.lookAt(x, 0, z);
      this.camera.rotateZ(this.renderedTilt.roll);
      this.sun.position.set(x - 3, 9, z + 5);
      this.sun.target.position.set(x, 0, z);
      this.weatherParticles.position.set(x, 0, z);
      const tileX = Math.round(x / 20) * 20, tileZ = Math.round(z / 20) * 20;
      for (const tile of this.meadowTiles) {
        tile.plants.position.set(tileX + tile.dx * 20, 0, tileZ + tile.dz * 20);
        tile.flowers.position.copy(tile.plants.position);
      }
      this.updateFootprints(followedPet, now);
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

  private updateFootprints(pet: PetVisual, now: number): void {
    const position = pet.root.position.clone().add(pet.stage.position).add(pet.body.position);
    position.y = 0;
    const distance = this.trailPosition?.distanceTo(position) ?? 0;
    if (!this.trailPosition || distance > 1.5) this.trailPosition = position.clone();
    else if (distance >= 0.22) {
      const footprint = this.footprints[this.footprintIndex % this.footprints.length]!;
      const side = this.footprintIndex++ % 2 ? 0.17 : -0.17;
      footprint.mesh.position.set(position.x + Math.cos(pet.yaw) * side, 0.015, position.z - Math.sin(pet.yaw) * side);
      footprint.mesh.rotation.set(-Math.PI / 2, 0, -pet.yaw + Math.PI);
      footprint.born = now; this.trailPosition.copy(position);
    }
    for (const footprint of this.footprints) {
      const age = (now - footprint.born) / 1000;
      footprint.mesh.visible = age < 6;
      footprint.mesh.material.opacity = Math.max(0, 0.65 * (1 - age / 6));
    }
  }

  private animatePet(pet: PetVisual, player: PlayPlayer | undefined, delta: number, seconds: number, serverTime: number, reducedMotion: boolean): void {
    let speed = 0;
    if (player) {
      // Reset only when another mode has explicitly placed the pet.
      if (Math.hypot(pet.motion.x - pet.root.position.x, pet.motion.z - pet.root.position.z) > 0.001) {
        pet.motion.reset(pet.root.position.x, pet.root.position.z);
      }
      const travel = pet.motion.advance(player.x, player.z, delta);
      speed = travel / delta;
      pet.root.position.x = pet.motion.x;
      pet.root.position.z = pet.motion.z;
      pet.distance += travel * 142 / PET_EXTENT;
      const yawDelta = Math.atan2(Math.sin(player.yaw - pet.yaw), Math.cos(player.yaw - pet.yaw));
      pet.yaw += yawDelta * (reducedMotion ? 1 : 1 - Math.exp(-6 * delta));
    }
    pet.gaitStrength = THREE.MathUtils.lerp(pet.gaitStrength, reducedMotion ? 0 : Math.min(speed * 1.6, 1), 1 - Math.exp(-8 * delta));
    const action = player?.action;
    const progress = action ? THREE.MathUtils.clamp((serverTime - action.startedAt) / Math.max(1, action.duration), 0, 1) : 1;
    const active = Boolean(action && serverTime >= action.startedAt && progress < 1);
    const envelope = active ? Math.sin(progress * Math.PI) : 0;
    const pose = samplePetAction(active ? action?.kind : undefined, progress, reducedMotion);
    const lift = pose.lift;
    let tilt = reducedMotion ? 0 : Math.sin(seconds * 1.7) * 0.018;
    tilt += pose.tilt;
    let bow = pose.bow;
    const yaw = pet.yaw + pose.turn;
    if (!reducedMotion && active && action) {
      if (action.kind === 'dap') {
        tilt += Math.sin(progress * Math.PI * 8) * 0.1 * envelope;
        bow = Math.sin(progress * Math.PI) * 0.12;
      }
    }
    const stride = pet.distance + pose.stride;
    const stridePhase = stride / 36 * Math.PI * 2;
    const gaitStrength = Math.max(pet.gaitStrength, pose.gait) * (1 - pose.tuck);
    if (!reducedMotion) tilt += Math.sin(stridePhase) * 0.14 * gaitStrength;
    pet.body.position.set(-Math.sin(pet.yaw) * pose.approach, 0, -Math.cos(pet.yaw) * pose.approach);
    pet.body.rotation.set(pose.pitch, yaw, tilt * 0.25, 'YXZ');
    // Measure untucked soles, then fold the feet without cancelling their lift.
    pet.jumps.forEach(jump => jump.set(pose.crouch, 0));
    pet.heads.forEach((head, index) => head.set(tilt, bow, pet.jumps[index]?.torsoPitch ?? 0));
    pet.gaits.forEach(gait => gait.set(stride, gaitStrength));
    pet.paws.forEach(paws => paws.set(pose.wave, pose.hold));
    pet.body.position.y = lift - pet.contact.lowestY();
    pet.jumps.forEach(jump => jump.set(pose.crouch, pose.tuck));
    pet.shadow.position.set(pet.body.position.x, 0.004, pet.body.position.z);
    pet.shadow.material.opacity = 0.72 - lift * 0.4;
    pet.shadow.scale.setScalar(1 - lift * 0.22);
    pet.treat.visible = active && action?.kind === 'feed' && pose.treatScale > 0.001;
    // The snack waits on the ground in front of the viewer-facing pet, then
    // follows the paws to the muzzle. Its location is independent of the turn.
    const snackDistance = THREE.MathUtils.lerp(1.05, 1.2, pose.treatLift);
    const snackHeight = THREE.MathUtils.lerp(0.11, 0.9, pose.treatLift) + pose.chew * 0.012;
    pet.treat.position.set(-Math.sin(pet.yaw) * snackDistance + Math.cos(pet.yaw) * 0.17, snackHeight,
      -Math.cos(pet.yaw) * snackDistance - Math.sin(pet.yaw) * 0.17);
    pet.treat.scale.setScalar(Math.max(0, pose.treatScale));
    pet.treat.rotation.z = pose.chew * 0.08;
    pet.crumbs.forEach((crumb, index) => {
      crumb.visible = !reducedMotion && active && action?.kind === 'feed' && progress > 0.45 && progress < 0.65;
      if (!crumb.visible) return;
      const phase = ((progress - 0.45) * 18 + index / 6) % 1;
      const spread = (index - 2.5) * 0.055 * phase;
      crumb.position.set(pet.treat.position.x + Math.cos(pet.yaw) * spread,
        snackHeight - phase * phase * 0.65, pet.treat.position.z - Math.sin(pet.yaw) * spread);
      crumb.scale.setScalar(1 - phase);
    });
    for (let index = 0; index < pet.hearts.length; index++) {
      const heart = pet.hearts[index]!;
      const joy = action?.kind === 'feed' || action?.kind === 'wave' || action?.kind === 'play' ? pose.joy : envelope;
      heart.visible = active && action?.kind !== 'jump' && joy > 0 && (reducedMotion ? index === 0 : true);
      if (!heart.visible) continue;
      const phase = reducedMotion ? 0.4 : (progress * 1.6 + index * 0.24) % 1;
      heart.material.opacity = Math.sin(phase * Math.PI) * joy * 0.9;
      heart.position.set(pet.body.position.x + (index - 1.5) * 0.22, 1.45 + phase * 0.75, pet.body.position.z);
      heart.quaternion.copy(this.camera.quaternion);
      heart.scale.setScalar(0.095 + Math.sin(phase * Math.PI) * 0.035);
    }
  }

  private animateSocialSpacing(serverTime: number, delta: number, reducedMotion: boolean): void {
    const visible = this.pets.filter(pet => pet.root.visible);
    const snapshotPlayers = this.snapshot?.players ?? [];
    const active = snapshotPlayers.filter(player => player.action?.kind === 'play'
      && player.action.startedAt <= serverTime && serverTime < player.action.startedAt + player.action.duration);
    const starts = new Set(active.map(player => player.action!.startedAt));
    for (const start of this.dances.keys()) if (!starts.has(start)) this.dances.delete(start);
    // Cache the whole group, so a departing friend never reshuffles the others.
    for (const start of starts) if (!this.dances.has(start)) {
      const group = active.filter(player => player.action!.startedAt === start);
      const resting = spacePets(snapshotPlayers.filter(p => p.connected).map(p => ({ id: p.id, slot: p.slot, x: p.x, z: p.z })));
      const members = resting.filter(p => group.some(member => member.id === p.id));
      if (members.length >= 2) this.dances.set(start, makePlayDance(members));
    }
    const dancePositions = new Map<string, { x: number; z: number; center: PlayDance['center']; progress: number }>();
    for (const [start, dance] of this.dances) {
      const action = active.find(player => player.action!.startedAt === start)!.action!;
      const progress = (serverTime - start) / action.duration;
      for (const point of samplePlayDance(dance, progress, reducedMotion)) {
        dancePositions.set(point.id, { ...point, center: dance.center, progress });
      }
    }
    const candidates = visible.map(pet => {
      const slot = this.pets.indexOf(pet);
      const dance = pet.playerId ? dancePositions.get(pet.playerId) : undefined;
      return { id: pet.playerId ?? `preview-${slot}`, slot,
        x: dance?.x ?? pet.root.position.x + pet.body.position.x,
        z: dance?.z ?? pet.root.position.z + pet.body.position.z };
    });
    const previous = visible.flatMap(pet => {
      const slot = this.pets.indexOf(pet);
      return pet.presented ? [{ id: pet.playerId ?? `preview-${slot}`, slot, ...pet.presented }] : [];
    });
    // Include spectators and resting pets in contacts, not just the dancers.
    for (const point of advancePetStage(candidates, previous, delta, reducedMotion)) {
      const pet = this.pets[point.slot]!;
      const dance = pet.playerId ? dancePositions.get(pet.playerId) : undefined;
      pet.stage.position.set(point.x - pet.root.position.x - pet.body.position.x, 0,
        point.z - pet.root.position.z - pet.body.position.z);
      if (dance && !reducedMotion) {
        const dx = pet.presented ? point.x - pet.presented.x : 0;
        const dz = pet.presented ? point.z - pet.presented.z : 0;
        const travel = Math.hypot(dx, dz);
        const speed = travel / Math.max(delta, 0.001);
        if (!pet.presented) pet.danceYaw = pet.yaw;
        pet.danceDistance += travel * 142 / PET_EXTENT;
        pet.danceGait += (Math.min(1, speed * 1.6) - pet.danceGait) * (1 - Math.exp(-14 * delta));
        // Point the feet along actual travel; turn inward when settling to bow.
        let targetYaw = speed > 0.04 ? Math.atan2(dx, dz)
          : Math.atan2(dance.center.x - point.x, dance.center.z - point.z);
        if (dance.progress > 0.96) targetYaw = pet.yaw;
        pet.danceYaw += Math.atan2(Math.sin(targetYaw - pet.danceYaw), Math.cos(targetYaw - pet.danceYaw))
          * (1 - Math.exp(-14 * delta));
        const pose = samplePetAction('play', dance.progress);
        const sway = Math.sin(pet.danceDistance / 36 * Math.PI * 2) * 0.07 * pet.danceGait;
        pet.body.rotation.set(0, pet.danceYaw, (pose.tilt + sway) * 0.25, 'YXZ');
        pet.gaits.forEach(gait => gait.set(pet.danceDistance, pet.danceGait));
        pet.heads.forEach((head, i) => head.set(pose.tilt + sway, pose.bow, pet.jumps[i]?.torsoPitch ?? 0));
        pet.body.position.y = -pet.contact.lowestY();
      } else {
        pet.danceYaw = pet.yaw;
        pet.danceGait = 0;
      }
      pet.presented = { x: point.x, z: point.z };
    }
  }

  private animateBall(serverTime: number, reducedMotion: boolean): void {
    const entry = this.dances.entries().next().value;
    this.ball.visible = !!entry;
    if (!entry) return;
    const [start, dance] = entry;
    // A grounded toy marks the circle; pets run around it instead of through it.
    this.ball.position.set(dance.center.x, 0.15, dance.center.z);
    this.ball.rotation.z = reducedMotion ? 0 : Math.sin((serverTime - start) / 600) * 0.12;
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
