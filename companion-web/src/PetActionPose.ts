import { eatenFraction } from '../../shared/feeding.mjs';
import type { PetActionKind } from '../../shared/play-protocol';

const ease = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (10 + x * (-15 + x * 6));
};
const ramp = (t: number, start: number, end: number) => ease((t - start) / (end - start));
const window = (t: number, a: number, b: number, c: number, d: number) => ramp(t, a, b) * (1 - ramp(t, c, d));

/** Root-relative choreography: multiplayer position and camera heading stay authoritative. */
export function samplePetAction(kind: PetActionKind | undefined, progress: number, reducedMotion = false) {
  const t = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 1;
  const pose = {
    turn: 0, approach: 0, stride: 0, gait: 0, lift: 0, pitch: 0,
    crouch: 0, tuck: 0, tilt: 0, bow: 0, wave: 0, hold: 0,
    treatScale: 0, treatLift: 0, chew: 0, joy: 0,
  };
  if (!kind || t <= 0 || t >= 1) return pose;
  if (reducedMotion) {
    pose.treatScale = kind === 'feed' ? 1 : 0;
    pose.joy = kind === 'wave' || kind === 'feed' ? 0.6 : 0;
    return pose;
  }
  if (kind === 'feed') {
    const outbound = ramp(t, 0.16, 0.32);
    const home = ramp(t, 0.86, 0.98);
    const eating = window(t, 0.35, 0.4, 0.6, 0.66);
    pose.turn = Math.PI * window(t, 0, 0.16, 0.76, 0.86);
    pose.approach = 0.48 * outbound * (1 - home);
    pose.stride = 0.48 * (outbound + home) * 142 / 1.5
      + 12 * (ramp(t, 0, 0.16) + ramp(t, 0.76, 0.86));
    pose.gait = Math.max(window(t, 0.15, 0.19, 0.29, 0.34), window(t, 0.85, 0.89, 0.95, 1),
      0.5 * window(t, 0, 0.03, 0.13, 0.16), 0.5 * window(t, 0.76, 0.78, 0.84, 0.86));
    pose.crouch = 0.8 * window(t, 0.14, 0.24, 0.35, 0.42);
    pose.pitch = 0.12 * window(t, 0.17, 0.3, 0.36, 0.43);
    pose.hold = window(t, 0.34, 0.42, 0.62, 0.68);
    pose.chew = eating * (0.5 + 0.5 * Math.sin((t - 0.4) * Math.PI * 48));
    pose.bow = 0.2 * window(t, 0.27, 0.35, 0.38, 0.44) + 0.045 * pose.chew;
    pose.joy = window(t, 0.61, 0.68, 0.74, 0.81);
    pose.tilt = Math.sin(t * Math.PI * 24) * 0.12 * pose.joy;
    pose.bow -= pose.joy * 0.12;
    pose.treatLift = window(t, 0.35, 0.43, 0.66, 0.72);
    // Three visible bites; the fruit stays full-size until it reaches the mouth.
    pose.treatScale = ramp(t, 0, 0.04) * Math.max(0, 1 - eatenFraction(t));
  } else if (kind === 'wave') {
    pose.turn = Math.PI * window(t, 0, 0.22, 0.8, 1);
    pose.stride = 12 * (ramp(t, 0, 0.22) + ramp(t, 0.8, 1));
    pose.gait = 0.5 * (window(t, 0, 0.04, 0.18, 0.22) + window(t, 0.8, 0.84, 0.96, 1));
    const greeting = window(t, 0.24, 0.34, 0.69, 0.79);
    pose.wave = greeting * (2.15 + Math.sin((t - 0.34) * Math.PI * 14) * 0.35);
    pose.tilt = -0.1 * greeting;
    pose.bow = -0.06 * greeting;
    pose.joy = greeting;
  } else if (kind === 'play') {
    const greeting = window(t, 0.67, 0.72, 0.8, 0.84);
    pose.crouch = 0.45 * window(t, 0.67, 0.72, 0.73, 0.78);
    pose.bow = 0.2 * window(t, 0.67, 0.72, 0.74, 0.79);
    pose.wave = 1.8 * window(t, 0.74, 0.78, 0.81, 0.84);
    pose.tilt = Math.sin(t * Math.PI * 24) * 0.1 * greeting;
    pose.joy = window(t, 0.65, 0.71, 0.89, 1);
  } else if (kind === 'jump') {
    if (t < 0.24) {
      pose.crouch = window(t, 0, 0.14, 0.14, 0.24);
      pose.bow = pose.crouch * 0.07;
    } else if (t < 0.74) {
      const flight = (t - 0.24) / 0.5;
      pose.lift = 4 * 0.65 * flight * (1 - flight);
      pose.tuck = window(flight, 0.02, 0.25, 0.6, 0.96);
      pose.pitch = -0.07 * Math.sin(flight * Math.PI * 2);
      pose.bow = -0.07 * Math.sin(flight * Math.PI);
    } else {
      pose.crouch = 0.9 * window(t, 0.74, 0.81, 0.81, 1);
      pose.bow = 0.09 * window(t, 0.76, 0.85, 0.85, 1);
    }
  }
  return pose;
}
