/** Lock the camera behind the initial phone bearing; later turns rotate the pet. */
export function startingCamera(yaw: number): [number, number, number] {
  return [-Math.sin(yaw) * 10, 13, -Math.cos(yaw) * 10];
}
