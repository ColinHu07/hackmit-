/** Presentation coordinates are separate from shared walking destinations. */
export interface StagePoint { id: string; slot: number; x: number; z: number }
export const PET_CLEARANCE = 1.9;
const TAU = Math.PI * 2;
const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t ** 3 * (10 + t * (-15 + 6 * t));
};

/** Stable disc contacts, including coincident pets and non-playing spectators.
 * The mesh is 1.5 units long, including its tail; the extra room covers turns.
 * Never write this visual spacing back into GPS or multiplayer coordinates.
 */
export function spacePets(points: StagePoint[]): StagePoint[] {
  const spaced = points.map(point => ({ ...point })).sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id));
  for (let iteration = 0; iteration < 32; iteration++) {
    let corrected = false;
    for (let i = 0; i < spaced.length; i++) for (let j = i + 1; j < spaced.length; j++) {
      const a = spaced[i]!, b = spaced[j]!;
      let dx = b.x - a.x, dz = b.z - a.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= PET_CLEARANCE - 1e-7) continue;
      if (distance < 1e-8) {
        const angle = (a.slot * 7 + b.slot * 11) * 2.399963229728653;
        dx = Math.sin(angle); dz = Math.cos(angle);
      } else { dx /= distance; dz /= distance; }
      const push = (PET_CLEARANCE - distance + 1e-6) / 2;
      a.x -= dx * push; a.z -= dz * push;
      b.x += dx * push; b.z += dz * push;
      corrected = true;
    }
    if (!corrected) break;
  }
  return spaced;
}

/** Integrate before resolving contact so crossing targets cannot swap bodies. */
export function advancePetStage(targets: StagePoint[], previous: StagePoint[], dt: number, reducedMotion = false): StagePoint[] {
  return spacePets(targets.map(target => {
    const before = previous.find(p => p.id === target.id);
    if (!before || reducedMotion) return target;
    const dx = target.x - before.x, dz = target.z - before.z;
    const delta = Math.max(0, Math.min(0.08, dt));
    const blend = Math.min(1 - Math.exp(-18 * delta), 4 * delta / Math.max(0.0001, Math.hypot(dx, dz)));
    return { ...target, x: before.x + dx * blend, z: before.z + dz * blend };
  }));
}

export interface PlayDance {
  center: { x: number; z: number };
  radius: number;
  members: (StagePoint & { angle: number })[];
}

export function makePlayDance(points: StagePoint[]): PlayDance {
  if (points.length < 2) throw new Error('A play dance needs at least two pets');
  const spaced = spacePets(points);
  const center = { x: spaced.reduce((sum, p) => sum + p.x, 0) / spaced.length,
    z: spaced.reduce((sum, p) => sum + p.z, 0) / spaced.length };
  const ordered = spaced.map(p => ({ ...p, angle: Math.atan2(p.x - center.x, p.z - center.z) }))
    .sort((a, b) => a.angle - b.angle || a.slot - b.slot);
  const step = TAU / spaced.length;
  // Preserve angular order while choosing the formation's least-turning phase.
  const phase = Math.atan2(ordered.reduce((sum, p, i) => sum + Math.sin(p.angle - i * step), 0),
    ordered.reduce((sum, p, i) => sum + Math.cos(p.angle - i * step), 0));
  const radius = (PET_CLEARANCE + 0.25) / (2 * Math.sin(Math.PI / spaced.length));
  return { center, radius, members: ordered.map((p, i) => ({ ...p, angle: phase + i * step })) };
}

/** Step out, chase around a full lap, bow/wave, then step back into safe places. */
export function samplePlayDance(dance: PlayDance, progress: number, reducedMotion = false): StagePoint[] {
  const t = Math.max(0, Math.min(1, progress));
  if (reducedMotion || t === 0 || t === 1) return dance.members.map(({ id, slot, x, z }) => ({ id, slot, x, z }));
  const formation = ease(t / 0.15) * (1 - ease((t - 0.84) / 0.16));
  const orbit = TAU * ease((t - 0.15) / 0.52);
  const points = dance.members.map(member => {
    const x = dance.center.x + Math.sin(member.angle + orbit) * dance.radius;
    const z = dance.center.z + Math.cos(member.angle + orbit) * dance.radius;
    return { id: member.id, slot: member.slot, x: member.x + (x - member.x) * formation,
      z: member.z + (z - member.z) * formation };
  });
  return spacePets(points);
}
