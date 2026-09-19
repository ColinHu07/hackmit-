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
  const contactX = Math.max(-12, Math.min(12, Number.isFinite(reachX) ? reachX : 0));
  const contactY = Math.max(-6, Math.min(8, Number.isFinite(reachY) ? reachY : 0));
  // Breathing and leaning rotate a full-size body; they never compress its shape.
  pose.pitch = Math.sin(time * Math.PI * 2 / 3.8) * 0.006;
  pose.x = contactX * 0.15;
  pose.yaw = contactX * 0.005;
  pose.roll = -contactX * 0.0015;
  pose.headTilt = Math.sin(time * 0.9) * 0.008 - contactX * 0.0025;
  pose.headBow = -contactY * 0.0015;
  const t = reaction && reaction.duration > 0 ? (time - reaction.startedAt) / reaction.duration : -1;
  if (!reaction || t < 0 || t >= 1) return pose;
  // Ease into contact and release it completely before the session returns to idle.
  const envelope = smooth(t / 0.14) * (1 - smooth((t - 0.65) / 0.35));
  if (reaction.action === 'pet') {
    const nuzzle = Math.sin(t * Math.PI * 2);
    // A continuous direction avoids a pop when a stroke crosses the face. With
    // the Pet button (no contact position), Nova offers a small cheek nuzzle.
    const direction = Math.tanh(1.8 - contactX * 0.6);
    pose.headTilt += direction * (0.042 + nuzzle * 0.008) * envelope;
    pose.headBow += (0.03 + (1 - Math.cos(t * Math.PI * 2)) * 0.008) * envelope;
    pose.roll += direction * 0.018 * envelope;
    pose.yaw -= direction * 0.018 * envelope;
  } else if (reaction.action === 'feed') {
    const chew = (1 - Math.cos(t * Math.PI * 10)) * 0.5;
    pose.headBow += (0.025 + chew * 0.105) * envelope;
    pose.pitch += 0.025 * envelope;
  } else {
    // Locomotion owns actual translation and gravity. This layer only poses the body.
    pose.pitch -= 0.02 * envelope;
    pose.headTilt += Math.sin(t * Math.PI * 2) * 0.035 * envelope;
  }
  return pose;
}

/** Analytic critically damped springs preserve momentum through hand movement.
 * Their exact solution remains stable across frame rates and long frame gaps.
 */
export class NovaMotion {
  private reachX = 0;
  private reachY = 0;
  private velocityX = 0;
  private velocityY = 0;
  update(delta: number, hand?: HandResponse): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    const targetX = hand?.near && Number.isFinite(hand.reachX) ? Math.max(-12, Math.min(12, hand.reachX)) : 0;
    const targetY = hand?.near && Number.isFinite(hand.reachY) ? Math.max(-6, Math.min(8, hand.reachY)) : 0;
    const frequency = 12;
    const decay = Math.exp(-frequency * delta);
    if (decay === 0) {
      this.reachX = targetX; this.reachY = targetY;
      this.velocityX = 0; this.velocityY = 0;
      return;
    }
    const offsetX = this.reachX - targetX, offsetY = this.reachY - targetY;
    const momentumX = this.velocityX + frequency * offsetX;
    const momentumY = this.velocityY + frequency * offsetY;
    this.reachX = targetX + (offsetX + momentumX * delta) * decay;
    this.reachY = targetY + (offsetY + momentumY * delta) * decay;
    this.velocityX = (this.velocityX - frequency * momentumX * delta) * decay;
    this.velocityY = (this.velocityY - frequency * momentumY * delta) * decay;
  }
  sample(time: number, reaction: Reaction | null, reducedMotion: boolean): NovaPose {
    return sampleNovaPose(time, reaction, this.reachX, this.reachY, reducedMotion);
  }
}
