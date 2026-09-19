import { normalizeDegrees, type Orientation, type WorldAnchor } from './PseudoWorldAnchor';

const DEG_TO_RAD = Math.PI / 180;
const VIEWPORT_CENTER = 300;

/**
 * Transfer a rendered horizontal locomotion offset into the angular anchor
 * before starting relocation. The caller supplies display pixels, including
 * apparent-size scaling, and can then reset local horizontal motion to zero
 * without moving the creature on screen. Pitch and anchor metadata stay intact.
 */
export function relocationStart(
  anchor: WorldAnchor,
  head: Orientation,
  horizontalFov: number,
  screenOffsetX: number,
): WorldAnchor {
  const unchanged = { ...anchor };
  if (
    !Number.isFinite(anchor.yaw) ||
    !Number.isFinite(anchor.pitch) ||
    !Number.isFinite(anchor.confidence) ||
    !Number.isFinite(head.yaw) ||
    !Number.isFinite(head.pitch) ||
    !Number.isFinite(horizontalFov) ||
    horizontalFov <= 0 ||
    horizontalFov >= 180 ||
    !Number.isFinite(screenOffsetX) ||
    screenOffsetX === 0
  ) return unchanged;

  const tangentHalfFov = Math.tan(horizontalFov * DEG_TO_RAD / 2);
  const focalLength = VIEWPORT_CENTER / tangentHalfFov;
  if (!Number.isFinite(focalLength) || focalLength <= 0) return unchanged;

  const headYaw = normalizeDegrees(head.yaw);
  const delta = normalizeDegrees(normalizeDegrees(anchor.yaw) - headYaw) * DEG_TO_RAD;
  const cosine = Math.cos(delta);
  const offset = screenOffsetX / focalLength;
  if (!Number.isFinite(offset)) return unchanged;

  // Equivalent to atan(tan(delta) + offset) in front of the viewer. Retaining
  // cosine's sign keeps anchors behind the viewer in their original hemisphere
  // instead of folding them into the display through tangent's periodicity.
  const relocatedDelta = Math.atan2(Math.sin(delta) + offset * cosine, cosine);
  return { ...anchor, yaw: normalizeDegrees(headYaw + relocatedDelta / DEG_TO_RAD) };
}
