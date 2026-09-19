/** Perspective size relative to a reference distance; never infer depth from head tilt. */
export const REFERENCE_DISTANCE_METERS = 2;

export function distanceScale(distanceMeters: number, referenceMeters = REFERENCE_DISTANCE_METERS): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0
    || !Number.isFinite(referenceMeters) || referenceMeters <= 0) return 1;
  return Math.max(0.25, Math.min(3, referenceMeters / distanceMeters));
}

/** Keep every render and input path on the same bounded scale. */
export function projectionScale(scale?: number): number {
  return scale !== undefined && Number.isFinite(scale) && scale > 0
    ? Math.max(0.25, Math.min(3, scale)) : 1;
}
