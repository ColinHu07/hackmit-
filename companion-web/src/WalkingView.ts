/** Follow behind the pet so its position stays centered and forward stays up. */
export function followingCamera(yaw: number, x = 0, z = 0): [number, number, number] {
  return [x - Math.sin(yaw) * 10, 13, z - Math.cos(yaw) * 10];
}

/** Convert screen-space arrows into the shared world's coordinates. */
export function screenMovement(yaw: number, right: number, down: number): [number, number] {
  return [-Math.cos(yaw) * right - Math.sin(yaw) * down, Math.sin(yaw) * right - Math.cos(yaw) * down];
}
import type { PlayPlayer } from '../../shared/play-protocol';
import type { WalkingPose } from './WalkingTracker';

/** Local steps render immediately, including with a stale or absent server.
 * Compass-only mode changes facing without overriding server movement. */
export function walkingPlayer(player: PlayPlayer | undefined, pose: WalkingPose, predictMovement: boolean): PlayPlayer {
  const base = player ?? { id: 'local-walk', name: '', slot: 0, ...pose, targetX: pose.x, targetZ: pose.z, connected: true, action: null };
  return predictMovement
    ? { ...base, ...pose, targetX: pose.x, targetZ: pose.z }
    : { ...base, yaw: pose.yaw };
}
