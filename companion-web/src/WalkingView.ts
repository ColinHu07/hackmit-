/** Follow behind the pet so its position stays centered and forward stays up. */
export function followingCamera(yaw: number, x = 0, z = 0, pitch = 0): [number, number, number] {
  const elevation = Math.atan2(13, 10) + Math.max(-0.3, Math.min(0.3, pitch));
  const radius = Math.hypot(13, 10), horizontal = Math.cos(elevation) * radius;
  return [x - Math.sin(yaw) * horizontal, Math.sin(elevation) * radius, z - Math.cos(yaw) * horizontal];
}

/** Convert screen-space arrows into the shared world's coordinates. */
export function screenMovement(yaw: number, right: number, down: number): [number, number] {
  return [-Math.cos(yaw) * right - Math.sin(yaw) * down, Math.sin(yaw) * right - Math.cos(yaw) * down];
}
import type { PlayPlayer } from '../../shared/play-protocol';
import type { WalkingPose } from './WalkingTracker';

/** Connected players share server positions. Local translation is only used
 * while offline; compass changes can never replace a shared position. */
export function walkingPlayer(player: PlayPlayer | undefined, pose: WalkingPose, predictMovement: boolean): PlayPlayer {
  const base = player ?? { id: 'local-walk', name: '', slot: 0, ...pose, targetX: pose.x, targetZ: pose.z, connected: true, action: null };
  return predictMovement
    ? { ...base, ...pose, targetX: pose.x, targetZ: pose.z }
    : { ...base, yaw: pose.yaw };
}
