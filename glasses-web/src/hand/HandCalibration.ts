export interface Point { x: number; y: number }
export type Affine = [number, number, number, number, number, number];
export const CALIBRATION_TARGETS: Point[] = [{ x: 230, y: 220 }, { x: 370, y: 220 }, { x: 300, y: 340 }];

/** A calibrated camera-image → display transform at the user's interaction distance. */
export function fitCameraToDisplay(camera: Point[], display = CALIBRATION_TARGETS): Affine | null {
  const [a, b, c] = camera;
  if (!a || !b || !c || camera.length !== 3 || display.length !== 3) return null;
  if ([...camera, ...display].some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const det = a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);
  if (Math.abs(det) < 0.00005) return null;
  const solve = (values: number[]) => {
    const [u = 0, v = 0, w = 0] = values;
    return [
      (u * (b.y - c.y) + v * (c.y - a.y) + w * (a.y - b.y)) / det,
      (u * (c.x - b.x) + v * (a.x - c.x) + w * (b.x - a.x)) / det,
      (u * (b.x * c.y - c.x * b.y) + v * (c.x * a.y - a.x * c.y) + w * (a.x * b.y - b.x * a.y)) / det,
    ];
  };
  const result = [...solve(display.map(p => p.x)), ...solve(display.map(p => p.y))];
  if (result.some(value => !Number.isFinite(value) || Math.abs(value) > 50_000)) return null;
  return result as Affine;
}
export function cameraToDisplay(point: Point, map: Affine): Point {
  return { x: map[0] * point.x + map[1] * point.y + map[2], y: map[3] * point.x + map[4] * point.y + map[5] };
}
