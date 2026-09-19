import { AnimationMixer, LoopOnce, LoopRepeat } from 'three';
import type { AnimationAction, AnimationClip, Object3D } from 'three';
import type { CreatureAction, Reaction } from '../interaction/CreatureSession';

type ClipName = 'idle' | CreatureAction;
const clipNames = new Set<ClipName>(['idle', 'pet', 'feed', 'play']);
const fadeSeconds = 0.18;

/** Optional authored GLB clips. The renderer supplies motion for missing reactions. */
export class CharacterClips {
  private readonly mixer: AnimationMixer | null;
  private readonly actions = new Map<ClipName, AnimationAction>();
  private readonly fading = new Map<AnimationAction, number>();
  private current: AnimationAction | null = null;
  private lastReactionKey: string | null = null;
  private reactionElapsed = 0;
  private reactionDuration: number | null = null;
  private reducedMotionActive = false;
  private disposed = false;

  constructor(private readonly root: Object3D, clips: AnimationClip[]) {
    const recognized = clips.filter((clip) => clipNames.has(clip.name.trim().toLowerCase() as ClipName)
      && clip.tracks.length > 0 && Number.isFinite(clip.duration) && clip.duration > 0);
    this.mixer = recognized.length ? new AnimationMixer(root) : null;
    for (const clip of recognized) {
      const name = clip.name.trim().toLowerCase() as ClipName;
      if (!this.actions.has(name)) this.actions.set(name, this.mixer!.clipAction(clip));
    }
  }

  hasReaction(action: CreatureAction): boolean {
    return !this.disposed && this.actions.has(action);
  }

  /** Returns true while a clip contributes motion, including a fade back to rest. */
  update(deltaSeconds: number, reaction: Reaction | null, reducedMotion: boolean): boolean {
    if (this.disposed || !this.mixer) return false;
    const key = reaction ? `${reaction.action}:${reaction.startedAt}` : null;
    if (reducedMotion) {
      if (!this.reducedMotionActive) {
        this.mixer.stopAllAction();
        this.current = null;
        this.fading.clear();
        this.reactionDuration = null;
        this.reactionElapsed = 0;
      }
      // Consume events while motion is disabled so they do not replay on resume.
      if (key !== null) this.lastReactionKey = key;
      this.reducedMotionActive = true;
      return false;
    }
    const resumed = this.reducedMotionActive;
    this.reducedMotionActive = false;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;

    if (reaction && key !== this.lastReactionKey) {
      this.lastReactionKey = key;
      const action = this.actions.get(reaction.action);
      if (action && Number.isFinite(reaction.duration) && reaction.duration > 0) {
        this.reactionElapsed = 0;
        this.reactionDuration = reaction.duration;
        this.transition(action, reaction.duration);
      } else {
        this.reactionDuration = null;
        this.transition(this.actions.get('idle') ?? null);
      }
    } else if (!reaction || resumed) {
      this.reactionDuration = null;
      this.transition(this.actions.get('idle') ?? null);
    }

    this.mixer.update(delta);
    for (const [action, remaining] of this.fading) {
      if (remaining <= delta) {
        action.stop();
        this.fading.delete(action);
      } else {
        this.fading.set(action, remaining - delta);
      }
    }

    if (this.reactionDuration !== null) {
      this.reactionElapsed += delta;
      if (this.reactionElapsed >= this.reactionDuration) {
        this.reactionDuration = null;
        this.transition(this.actions.get('idle') ?? null);
      }
    }
    return this.current !== null || this.fading.size > 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer?.stopAllAction();
    this.mixer?.uncacheRoot(this.root);
    this.actions.clear();
    this.fading.clear();
    this.current = null;
  }

  private transition(next: AnimationAction | null, duration?: number): void {
    if (next === this.current && duration === undefined) return;
    const previous = this.current;
    this.current = next;

    if (next) {
      this.fading.delete(next);
      next.reset().setEffectiveWeight(1);
      next.setLoop(duration === undefined ? LoopRepeat : LoopOnce, duration === undefined ? Infinity : 1);
      next.clampWhenFinished = duration !== undefined;
      next.setEffectiveTimeScale(duration === undefined ? 1 : next.getClip().duration / duration);
      next.play();
      if (next !== previous) next.fadeIn(fadeSeconds);
    }
    if (previous && previous !== next) {
      previous.fadeOut(fadeSeconds);
      this.fading.set(previous, fadeSeconds);
    }
  }
}
