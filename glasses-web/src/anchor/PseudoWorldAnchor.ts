/** Head orientation in degrees: positive yaw turns right; positive pitch looks up. */
export interface Orientation {
  yaw: number;
  pitch: number;
}

/** A simulated angular world anchor, independent of the current head orientation. */
export interface WorldAnchor {
  id: string;
  yaw: number;
  pitch: number;
  confidence: number;
}

export interface AnchorProjection {
  visible: boolean;
  x: number;
  y: number;
  deltaYaw: number;
  deltaPitch: number;
  confidence: number;
}

const DEFAULT_VIEWPORT = 600;
const DEG_TO_RAD = Math.PI / 180;
const MAX_SCREEN_OFFSET = 4;

/** Normalize an angle to [-180, 180). Non-finite angles safely resolve to zero. */
export function normalizeDegrees(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  // Reduce before adding so even very large finite angles cannot overflow.
  const normalized = (((angle % 360) + 540) % 360) - 180;
  return normalized === 0 ? 0 : normalized;
}

/**
 * Store the current viewing direction. Pitch is physiologically bounded, never
 * wrapped. Invalid orientations produce a disabled anchor instead of NaNs.
 */
export function placeAnchor(
  orientation: Orientation,
  id = 'nova-anchor',
): WorldAnchor {
  const valid = Number.isFinite(orientation.yaw) && Number.isFinite(orientation.pitch);
  return {
    id,
    yaw: normalizeDegrees(orientation.yaw),
    pitch: Number.isFinite(orientation.pitch)
      ? Math.max(-90, Math.min(90, orientation.pitch))
      : 0,
    confidence: valid ? 1 : 0,
  };
}

/**
 * Project an angular anchor into a square display using a perspective mapping.
 * FOV values are full angles in degrees and must be strictly between 0 and 180.
 * Boundaries are visible. Outside the view cone, confidence is zero and screen
 * coordinates are capped to a finite range; the stored anchor is never changed.
 * Invalid numeric inputs return a centered, invisible projection.
 */
export function projectAnchor(
  anchor: WorldAnchor,
  orientation: Orientation,
  horizontalFov: number,
  verticalFov: number,
  viewport = DEFAULT_VIEWPORT,
): AnchorProjection {
  const safeViewport = Number.isFinite(viewport) && viewport > 0 ? viewport : DEFAULT_VIEWPORT;
  const center = safeViewport / 2;
  const hidden: AnchorProjection = {
    visible: false,
    x: center,
    y: center,
    deltaYaw: 0,
    deltaPitch: 0,
    confidence: 0,
  };

  if (
    !Number.isFinite(anchor.yaw) ||
    !Number.isFinite(anchor.pitch) ||
    !Number.isFinite(anchor.confidence) ||
    !Number.isFinite(orientation.yaw) ||
    !Number.isFinite(orientation.pitch) ||
    Math.abs(anchor.pitch) > 90 ||
    Math.abs(orientation.pitch) > 90 ||
    !Number.isFinite(horizontalFov) ||
    !Number.isFinite(verticalFov) ||
    horizontalFov <= 0 ||
    horizontalFov >= 180 ||
    verticalFov <= 0 ||
    verticalFov >= 180 ||
    !Number.isFinite(viewport) ||
    viewport <= 0
  ) {
    return hidden;
  }

  const halfHorizontalFov = horizontalFov / 2;
  const halfVerticalFov = verticalFov / 2;
  const horizontalScale = Math.tan(halfHorizontalFov * DEG_TO_RAD);
  const verticalScale = Math.tan(halfVerticalFov * DEG_TO_RAD);
  // Extremely tiny positive FOVs can underflow during degree conversion.
  if (horizontalScale <= 0 || verticalScale <= 0) return hidden;

  const deltaYaw = normalizeDegrees(normalizeDegrees(anchor.yaw) - normalizeDegrees(orientation.yaw));
  const deltaPitch = anchor.pitch - orientation.pitch;
  const confidence = Math.max(0, Math.min(1, anchor.confidence));
  const visible =
    confidence > 0 &&
    Math.abs(deltaYaw) <= halfHorizontalFov &&
    Math.abs(deltaPitch) <= halfVerticalFov;

  // Directions behind the viewer must not fold back onto the display through
  // tan's periodicity. Skip its singularity, then cap the screen offset.
  const offset = (angle: number, scale: number): number => {
    if (Math.abs(angle) >= 90) return Math.sign(angle) * MAX_SCREEN_OFFSET;
    return Math.max(-MAX_SCREEN_OFFSET, Math.min(MAX_SCREEN_OFFSET, Math.tan(angle * DEG_TO_RAD) / scale));
  };
  const finiteCoordinate = (coordinate: number): number =>
    Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, coordinate));

  return {
    visible,
    x: finiteCoordinate(center + center * offset(deltaYaw, horizontalScale)),
    y: finiteCoordinate(center - center * offset(deltaPitch, verticalScale)),
    deltaYaw,
    deltaPitch,
    confidence: visible ? confidence : 0,
  };
}
