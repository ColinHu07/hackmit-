import type { HandResponse } from '../hand/PettingGesture';
import type { Reaction } from '../interaction/CreatureSession';

export interface NovaPose {
  x: number; y: number;
  pitch: number; yaw: number; roll: number;
  scaleX: number; scaleY: number; scaleZ: number;
  headTilt: number; headBow: number;
}

const smooth = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Local offsets only: the saved direction anchor is never animated. */
export function sampleNovaPose(time: number, reaction: Reaction | null, reachX = 0, reachY = 0, reducedMotion = false): NovaPose {
  const pose: NovaPose = { x: 0, y: 0, pitch: 0, yaw: 0, roll: 0, scaleX: 1, scaleY: 1, scaleZ: 1, headTilt: 0, headBow: 0 };
  if (reducedMotion) return pose;
  const breath = Math.sin(time * Math.PI * 2 / 3.8) * 0.012;
  pose.scaleX -= breath * 0.35;
  pose.scaleY += breath;
  pose.scaleZ -= breath * 0.35;
  pose.x = reachX * 0.55;
  pose.y = reachY * 0.3;
  pose.yaw = reachX * 0.012;
  pose.roll = -reachX * 0.004;
  pose.headTilt = Math.sin(time * 0.9) * 0.025 - reachX * 0.011;
  const t = reaction ? (time - reaction.startedAt) / reaction.duration : -1;
  if (!reaction || t < 0 || t >= 1) return pose;
  // Ease into contact and release it completely before the session returns to idle.
  const envelope = smooth(t / 0.14) * (1 - smooth((t - 0.65) / 0.35));
  if (reaction.action === 'pet') {
    const nuzzle = Math.sin(t * Math.PI * 4);
    pose.headTilt += (0.18 + nuzzle * 0.055) * envelope;
    pose.headBow = (0.09 + (1 - Math.cos(t * Math.PI * 6)) * 0.025) * envelope;
    pose.roll += (0.045 + nuzzle * 0.025) * envelope;
    pose.x -= 4 * envelope;
    pose.scaleX += 0.035 * envelope;
    pose.scaleY -= 0.045 * envelope;
  } else if (reaction.action === 'feed') {
    const chew = (1 - Math.cos(t * Math.PI * 10)) * 0.5;
    pose.headBow = (0.08 + chew * 0.18) * envelope;
    pose.pitch = 0.055 * envelope;
    pose.scaleY -= chew * 0.025 * envelope;
    pose.scaleX += chew * 0.012 * envelope;
  } else {
    const anticipation = Math.sin(Math.PI * Math.min(t / 0.18, 1));
    // Locomotion owns actual translation and gravity. This layer only poses the body.
    pose.scaleY -= anticipation * 0.08;
    pose.scaleX += anticipation * 0.04;
    pose.headTilt += Math.sin(t * Math.PI * 2) * 0.1 * envelope;
  }
  return pose;
}

/** Exponential smoothing gives the same reach at 30, 60, or 120 Hz. */
export class NovaMotion {
  private reachX = 0;
  private reachY = 0;
  update(delta: number, hand?: HandResponse): void {
    const blend = 1 - Math.exp(-12 * Math.max(0, delta));
    this.reachX += ((hand?.near ? hand.reachX : 0) - this.reachX) * blend;
    this.reachY += ((hand?.near ? hand.reachY : 0) - this.reachY) * blend;
    if (Math.abs(this.reachX) < 0.001) this.reachX = 0;
    if (Math.abs(this.reachY) < 0.001) this.reachY = 0;
  }
  sample(time: number, reaction: Reaction | null, reducedMotion: boolean): NovaPose {
    return sampleNovaPose(time, reaction, this.reachX, this.reachY, reducedMotion);
  }
}
