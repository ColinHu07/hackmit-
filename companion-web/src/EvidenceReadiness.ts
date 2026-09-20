import type { EvidenceQuestId, PlaySnapshot } from '../../shared/play-protocol';

type EvidenceSnapshot = Pick<PlaySnapshot, 'players' | 'quests'>;
export function evidenceReadiness(quest: EvidenceQuestId, snapshot: EvidenceSnapshot | null,
  playerId: string | undefined, connected: boolean) {
  const local = snapshot?.players.find(player => player.id === playerId && player.connected);
  const progress = playerId && snapshot?.quests[playerId];
  if (!connected || !local || !progress) return { ready: false, message: 'Connect to your shared server before submitting. Your recorded clip stays on this device.' };
  const cooldown = local.survival?.questCooldowns?.[quest] ?? 0;
  if (cooldown > 0) return { ready: false, message: `Quest complete ✓ Play again in ${Math.ceil(cooldown / 1000)}s (demo cooldown).` };
  if (progress.photoVerification[quest] === 'pending') return { ready: false, message: 'Your clip was received. Grading your submission…' };
  const minimum = quest === 'touchGrass' ? 1 : quest === 'squadCircle' ? 3 : 2;
  const count = snapshot!.players.filter(player => player.connected).length;
  if (count < minimum) return { ready: false, message: `Keep at least ${minimum} players connected in this pen to submit. Currently ${count}/${minimum} are here.` };
  const others = snapshot!.players.filter(player => player.connected && player.id !== playerId)
    .map(player => player.survival?.questCooldowns?.[quest] ?? 0).sort((a, b) => a - b);
  const groupCooldown = minimum === 1 ? 0 : minimum === 2 ? others[0]! : Math.max(...others);
  if (groupCooldown > 0) return { ready: false, message: `Your group can repeat this quest in ${Math.ceil(groupCooldown / 1000)}s.` };
  return { ready: true, message: minimum === 1 ? 'Ready. Record or submit your saved clip for grading.'
    : 'Your group is in the pen. Record or submit your saved clip — no movement or in-game action needed.' };
}
