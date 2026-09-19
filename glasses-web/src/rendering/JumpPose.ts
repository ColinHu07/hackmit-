import { NOVA_LOCOMOTION_SETTINGS as settings, type NovaLocomotionState } from './NovaLocomotion';

export interface JumpPose {
  crouch: number;
  tuck: number;
  pitch: number;
  headBow: number;
  gait: number;
}

const ease = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (10 + t * (-15 + t * 6));
};

/** Pose the joints around the physics arc; never scale or replace that arc. */
export function sampleJumpPose(movement: Pick<NovaLocomotionState, 'jumpPhase' | 'jumpPhaseTime'>, reducedMotion = false): JumpPose {
  const pose: JumpPose = { crouch: 0, tuck: 0, pitch: 0, headBow: 0, gait: 1 };
  if (reducedMotion || movement.jumpPhase === 'idle') return pose;
  const time = Math.max(0, Number.isFinite(movement.jumpPhaseTime) ? movement.jumpPhaseTime : 0);
  if (movement.jumpPhase === 'anticipation') {
    const phase = time / settings.anticipationDuration;
    // Load the hind legs, then push them straight before the soles leave the floor.
    pose.crouch = ease(phase / 0.6) * (1 - ease((phase - 0.6) / 0.4));
    pose.headBow = pose.crouch * 0.035;
  } else if (movement.jumpPhase === 'airborne') {
    const flightDuration = 2 * settings.jumpSpeed / settings.gravity;
    const phase = time / flightDuration;
    // Fold the feet after takeoff and reach back toward the floor before contact.
    pose.tuck = ease((phase - 0.05) / 0.28) * (1 - ease((phase - 0.56) / 0.34));
    const extension = ease(phase / 0.12) * (1 - ease((phase - 0.24) / 0.32));
    const reach = ease((phase - 0.5) / 0.18) * (1 - ease((phase - 0.8) / 0.2));
    pose.pitch = -0.045 * extension + 0.035 * reach;
    pose.headBow = -0.035 * extension + 0.02 * reach;
    // A running jump keeps its planted step into takeoff, then eases that pose
    // out. Restore the same foot phase before contact so landing can continue
    // stepping without a snap or sliding through a stationary two-foot pose.
    pose.gait = 1 - ease(phase / 0.16) + ease((phase - 0.75) / 0.2);
  } else {
    const phase = time / settings.landingDuration;
    // Contact starts at the extended pose. Bend *after* impact and recover more
    // slowly, rather than snapping immediately into a fully crouched mesh.
    pose.crouch = 0.85 * ease(phase / 0.28) * (1 - ease((phase - 0.28) / 0.72));
    pose.headBow = 0.065 * ease(phase / 0.4) * (1 - ease((phase - 0.4) / 0.6));
  }
  return pose;
}
