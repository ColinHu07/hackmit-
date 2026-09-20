// The supplied scan projects the right eye's paint onto the cheek beneath it.
// Repair that small surface region in source coordinates after simplification.
// Keep the eyeball, pupil, catchlight, geometry and alpha untouched.
export function repairCharacterEye(positions, colors) {
  const result = colors.slice();
  const samples = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const [x, y, z] = positions.subarray(i * 3, i * 3 + 3);
    const [r, g, b] = colors.subarray(i * 4, i * 4 + 3);
    if (x > -0.2 && x < 0.05 && y > 0.5 && y < 0.62 && z > 0.4
        && r > 0.5 && g / r > 0.15 && g / r < 0.36 && b / r < 0.1) samples.push(i);
  }
  if (samples.length < 8) throw new Error('Cannot find the supplied character’s orange cheek palette.');
  for (let i = 0; i < positions.length / 3; i++) {
    const [x, y, z] = positions.subarray(i * 3, i * 3 + 3);
    if (x < -0.18 || x > 0.025 || y < 0.5 || y > 0.595 || z < 0.4) continue;
    // The diagonal crease separates the protruding eyeball from the cheek.
    let blend = Math.max(0, Math.min(1, (z - y + 0.087) / 0.006));
    blend = blend * blend * (3 - 2 * blend);
    // Feather back into the cream muzzle rather than painting over its edge.
    blend *= Math.max(0, Math.min(1, (0.535 - z) / 0.015));
    if (!blend) continue;
    const nearest = samples.map(j => ({
      j,
      distance: (positions[j * 3] - x) ** 2 + (positions[j * 3 + 1] - y) ** 2
        + (positions[j * 3 + 2] - z) ** 2,
    })).sort((a, b) => a.distance - b.distance).slice(0, 8);
    const rgb = [0, 0, 0];
    let total = 0;
    for (const { j, distance } of nearest) {
      const weight = 1 / (distance + 0.00001);
      total += weight;
      for (let channel = 0; channel < 3; channel++) rgb[channel] += colors[j * 4 + channel] * weight;
    }
    for (let channel = 0; channel < 3; channel++) {
      result[i * 4 + channel] = colors[i * 4 + channel] * (1 - blend) + rgb[channel] / total * blend;
    }
  }
  return result;
}
