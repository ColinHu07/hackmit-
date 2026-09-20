import type { EvidenceQuestId, PlaySnapshot } from '../../shared/play-protocol';

type EvidenceSnapshot = Pick<PlaySnapshot, 'players' | 'quests'>;
export function evidenceReadiness(quest: EvidenceQuestId, snapshot: EvidenceSnapshot | null,
  playerId: string | undefined, connected: boolean) {
  const local = snapshot?.players.find(player => player.id === playerId && player.connected);
  const progress = playerId && snapshot?.quests[playerId];
  if (!connected || !local || !progress) return { ready: false, message: 'Connect to your shared server before submitting. Your recorded clip stays on this device.' };
  if (progress.photoVerification[quest] === 'approved') return { ready: false, message: 'This quest is already verified.' };
  if (progress.photoVerification[quest] === 'pending') return { ready: false, message: 'Server received your evidence. Waiting for Meta’s grading result…' };
  const minimum = quest === 'touchGrass' ? 1 : quest === 'squadCircle' ? 3 : 2;
  const count = snapshot!.players.filter(player => player.connected).length;
  if (count < minimum) return { ready: false, message: `Keep at least ${minimum} players connected in this pen to submit. Currently ${count}/${minimum} are here.` };
  return { ready: true, message: minimum === 1 ? 'Ready. Record or submit your saved clip for grading.'
    : 'Your group is in the pen. Record or submit your saved clip — no movement or in-game action needed.' };
}
