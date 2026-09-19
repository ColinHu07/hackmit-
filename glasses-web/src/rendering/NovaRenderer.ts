import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AnchorProjection } from '../anchor/PseudoWorldAnchor';
import { projectionScale } from '../anchor/ViewingDistance';
import type { HandResponse } from '../hand/PettingGesture';
import type { Reaction } from '../interaction/CreatureSession';
import { CharacterClips } from './CharacterClips';
import { NovaMotion } from './NovaMotion';
import { SoftHead } from './SoftHead';
import { SoftGait } from './SoftGait';
import { SoftJump } from './SoftJump';
import { sampleJumpPose } from './JumpPose';
import { NovaLocomotion, NOVA_LOCOMOTION_SETTINGS } from './NovaLocomotion';
import { GroundContact } from './GroundContact';

/** Anchor travel expressed in the same scene units as local locomotion. */
export interface AnchorRunMotion {
  active: boolean;
  speed: number;
  velocityX: number;
  velocityY: number;
  distanceDelta: number;
}

/** User-supplied GLB, normalized once; reactions never move the saved anchor. */
export class NovaRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-300, 300, 300, -300, 0.1, 1000);
  private readonly anchor = new THREE.Group();
  private readonly creature = new THREE.Group();
  private readonly effects = new THREE.Group();
  private readonly hearts: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly treat: THREE.Mesh;
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly motion = new NovaMotion();
  private readonly locomotion = new NovaLocomotion();
  private readonly softHeads: SoftHead[] = [];
  private readonly softGaits: SoftGait[] = [];
  private readonly softJumps: SoftJump[] = [];
  private groundContact: GroundContact | undefined;
  private readonly shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly textures = new Set<THREE.Texture>();
  private clips: CharacterClips | undefined;
  private travelYaw = 0;
  private gaitStrength = 0;
  private anchorStride = 0;
  private footY = -68;
  private disposed = false;
  private lastFrame = '';
  private lastTime: number | undefined;
  ready = false;
  facing = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: 'low-power' });
    // Keep input/projection coordinates at 600² while supersampling the image.
    this.renderer.setPixelRatio(this.displayPixelRatio());
    this.renderer.setSize(600, 600, false);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.camera.position.set(0, 0, 400);
    this.scene.add(new THREE.HemisphereLight(0xe3eaf0, 0x776354, 1.8));
    const key = new THREE.DirectionalLight(0xfff4eb, 2.3);
    key.position.set(-100, 160, 220);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xd6e1eb, 1.1);
    rim.position.set(150, 60, -90);
    this.scene.add(rim);
    this.scene.add(this.anchor);
    this.anchor.add(this.creature, this.effects);

    // Feathered contact cue, without the old hard purple disk under the feet.
    // An additive display cannot darken the real floor; this stays a subtle cue.
    const shadowSize = 64;
    const shadowPixels = new Uint8Array(shadowSize * shadowSize * 4);
    for (let y = 0; y < shadowSize; y++) {
      for (let x = 0; x < shadowSize; x++) {
        const radius = Math.hypot((x + 0.5) / shadowSize * 2 - 1, (y + 0.5) / shadowSize * 2 - 1);
        const index = (y * shadowSize + x) * 4;
        shadowPixels[index] = shadowPixels[index + 1] = shadowPixels[index + 2] = 255;
        shadowPixels[index + 3] = Math.round(255 * Math.exp(-radius * radius * 3.5) * (1 - THREE.MathUtils.smoothstep(radius, 0.75, 1)));
      }
    }
    const shadowTexture = new THREE.DataTexture(shadowPixels, shadowSize, shadowSize, THREE.RGBAFormat);
    shadowTexture.magFilter = THREE.LinearFilter;
    shadowTexture.minFilter = THREE.LinearFilter;
    shadowTexture.needsUpdate = true;
    this.textures.add(shadowTexture);
    const shadowGeometry = new THREE.PlaneGeometry(2, 2);
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x978a7e, map: shadowTexture, transparent: true, opacity: 0.22, depthWrite: false });
    this.shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    this.shadow.scale.set(44, 5, 1);
    this.anchor.add(this.shadow);
    this.geometries.add(shadowGeometry);
    this.materials.add(shadowMaterial);

    const heart = new THREE.Shape();
    heart.moveTo(0, -5);
    heart.bezierCurveTo(-15, 4, -8, 16, 0, 8);
    heart.bezierCurveTo(8, 16, 15, 4, 0, -5);
    const geometry = new THREE.ShapeGeometry(heart);
    this.geometries.add(geometry);
    for (let i = 0; i < 5; i++) {
      const pink = new THREE.MeshBasicMaterial({ color: 0xffc4e4, side: THREE.DoubleSide, transparent: true, depthWrite: false });
      this.materials.add(pink);
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

  private displayPixelRatio(): number {
    // 1.5× improves native display edges too; the 2× cap bounds mobile fill cost.
    return Math.min(2, Math.max(1.5, window.devicePixelRatio || 1));
  }

  async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/nova.glb`);
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!object.geometry.getAttribute('normal')) object.geometry.computeVertexNormals();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        // GLTFLoader sets vertexColors from COLOR_0; retain the supplied palette/material.
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) {
            if (this.disposed) value.dispose();
            else this.textures.add(value);
          }
        }
      }
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
    this.footY = -size.y * scale / 2;
    // Normalize a parent so authored root animation tracks retain their own transforms.
    const normalized = new THREE.Group();
    normalized.scale.setScalar(scale);
    normalized.position.copy(center).multiplyScalar(-scale);
    normalized.add(gltf.scene);
    this.creature.add(normalized);
    this.clips = new CharacterClips(gltf.scene, gltf.animations);
    if (gltf.animations.length === 0) {
      gltf.scene.traverse((object) => {
        if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh)
          && !object.geometry.morphAttributes.position?.length) {
          this.softHeads.push(new SoftHead(object));
          this.softGaits.push(new SoftGait(object));
          this.softJumps.push(new SoftJump(object));
        }
      });
    }
    // Keep the lowest animated foot on the floor, including body tilt and foot swings.
    this.groundContact = new GroundContact(this.creature, this.footY);
    this.ready = true;
  }

  moveTo(localX: number): boolean {
    if (this.motionPreference.matches || !Number.isFinite(localX)) return false;
    this.locomotion.moveTo(localX);
    return true;
  }
  jump(): boolean { return !this.motionPreference.matches && this.locomotion.jump(); }
  runAround(): boolean {
    if (this.motionPreference.matches) return false;
    this.locomotion.runAround();
    return true;
  }
  stop(): void { this.locomotion.stop(); }
  /** Caller transfers this displacement into the angular anchor in the same frame. */
  takeTravelOffset(): number {
    const offset = this.locomotion.rebaseHorizontal();
    this.creature.position.x -= offset;
    this.effects.position.x -= offset;
    this.shadow.position.x -= offset;
    return offset;
  }
  get reducedMotion(): boolean { return this.motionPreference.matches; }
  resetLocomotion(): void {
    this.locomotion.reset();
    this.travelYaw = 0;
    this.gaitStrength = 0;
    this.anchorStride = 0;
    this.lastFrame = '';
  }

  interactionProjection(projection: AnchorProjection): AnchorProjection {
    const scale = projectionScale(projection.scale);
    const x = projection.x + this.creature.position.x * scale;
    const y = projection.y - this.creature.position.y * scale;
    return { ...projection, x, y, visible: projection.visible && x >= 0 && x <= 600 && y >= 0 && y <= 600 };
  }

  render(time: number, projection: AnchorProjection, reaction: Reaction | null, hand?: HandResponse, travel?: AnchorRunMotion): void {
    if (this.disposed) return;
    const pixelRatio = this.displayPixelRatio();
    if (this.renderer.getPixelRatio() !== pixelRatio) {
      this.renderer.setPixelRatio(pixelRatio);
      this.lastFrame = '';
    }
    const delta = this.lastTime === undefined ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;
    const reducedMotion = this.motionPreference.matches;
    const active = reaction && time >= reaction.startedAt && time - reaction.startedAt < reaction.duration ? reaction : null;
    const visible = this.ready && projection.visible && projection.confidence > 0;
    if (reducedMotion) this.locomotion.reset();
    const movement = this.locomotion.update(delta, (visible || !!travel?.active) && !reducedMotion);
    const jumpPose = sampleJumpPose(movement, reducedMotion);
    const travelSpeed = !reducedMotion && travel?.active ? travel.speed : 0;
    const movementSpeed = Math.max(Math.abs(movement.velocityX), travelSpeed);
    const speed = Math.min(1, movementSpeed / NOVA_LOCOMOTION_SETTINGS.maxSpeed);
    if (!reducedMotion && travel) this.anchorStride += travel.distanceDelta;
    const blend = 1 - Math.exp(-12 * delta);
    const targetYaw = speed > 0.06
      ? travelSpeed > 0 && travel ? Math.atan2(travel.velocityX, -travel.velocityY) : movement.facing * Math.PI / 2 : 0;
    const yawDifference = Math.atan2(Math.sin(targetYaw - this.travelYaw), Math.cos(targetYaw - this.travelYaw));
    this.travelYaw += yawDifference * blend;
    // Gait phase follows travelled distance; speed should not shrink every step.
    const stepping = Math.min(1, movementSpeed / 25);
    this.gaitStrength += (stepping - this.gaitStrength) * blend;
    this.motion.update(delta, visible ? hand : undefined);
    this.clips?.update(delta, active, reducedMotion);
    const frame = `${visible}:${projection.x}:${projection.y}:${projectionScale(projection.scale)}:${this.facing}:${reducedMotion}:${active?.action}:${active?.startedAt}`;
    // Follow every display refresh: holding animated frames makes head tracking
    // and walking stutter. Only unchanged hidden/reduced-motion frames are static.
    if (frame === this.lastFrame && (!visible || reducedMotion)) return;
    this.lastFrame = frame;
    this.anchor.visible = visible;
    this.anchor.position.set(projection.x - 300, 300 - projection.y, 0);
    this.anchor.scale.setScalar(projectionScale(projection.scale));
    const authoredReaction = active && this.clips?.hasReaction(active.action);
    const pose = this.motion.sample(time, authoredReaction ? null : active, reducedMotion);
    pose.pitch += jumpPose.pitch;
    pose.headBow += jumpPose.headBow;
    pose.roll -= reducedMotion ? 0 : movement.velocityX / NOVA_LOCOMOTION_SETTINGS.maxSpeed * 0.025;
    this.creature.scale.setScalar(1);
    this.creature.rotation.set(pose.pitch, this.facing + pose.yaw + (reducedMotion ? 0 : this.travelYaw), pose.roll);
    this.softJumps.forEach(jump => jump.set(jumpPose.crouch, 0));
    this.softHeads.forEach((head, index) => head.set(pose.headTilt, pose.headBow, this.softJumps[index]?.torsoPitch ?? 0));
    this.softGaits.forEach(gait => gait.set(movement.strideDistance + this.anchorStride, reducedMotion ? 0 : this.gaitStrength * jumpPose.gait));
    // During flight the root follows gravity. Measuring untucked soles avoids
    // moving the entire body down to cancel the feet folding upward.
    const lowest = this.groundContact?.lowestY() ?? this.footY * pose.scaleY;
    this.softJumps.forEach(jump => jump.set(jumpPose.crouch, jumpPose.tuck));
    this.creature.position.set(movement.x + pose.x, this.footY + movement.height - lowest, 0);
    this.effects.position.copy(this.creature.position);
    this.shadow.position.set(movement.x + pose.x, this.footY - 1, -85);
    this.shadow.scale.set(44 * (1 + movement.height / 140), 5, 1);
    this.shadow.material.opacity = 0.22 / (1 + movement.height / 28);
    this.effects.visible = !!active;
    this.treat.visible = active?.action === 'feed';
    this.hearts.forEach((heart) => { heart.visible = !!active && active.action !== 'feed'; });
    if (active) {
      const elapsed = time - active.startedAt;
      const t = elapsed / active.duration;
      this.hearts.forEach((heart, i) => {
        const phase = THREE.MathUtils.clamp((elapsed - i * 0.13) / (active.duration - i * 0.13), 0, 1);
        heart.position.set((i - 2) * 23 + (reducedMotion ? 0 : Math.sin(phase * Math.PI * 2 + i) * 6), 65 + (reducedMotion ? 0 : phase * 55), 90);
        heart.scale.setScalar(reducedMotion ? 0.7 : Math.sin(phase * Math.PI) * 0.85);
        heart.material.opacity = reducedMotion ? 1 : Math.min(1, phase * 8) * (1 - phase);
      });
      this.treat.position.set(reducedMotion ? 28 : 28 * (1 - t), 14 + (reducedMotion ? 0 : Math.sin(t * Math.PI) * 14), 90);
      this.treat.scale.setScalar(reducedMotion ? 1 : Math.min(1, t * 10) * Math.max(0, 1 - Math.max(0, t - 0.5) / 0.35));
      this.treat.rotation.y = reducedMotion ? 0 : t * 5;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clips?.dispose();
    for (const texture of this.textures) texture.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
