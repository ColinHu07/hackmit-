import type { EvidenceQuestId, PlaySnapshot } from '../../shared/play-protocol';

type EvidenceSnapshot = Pick<PlaySnapshot, 'players' | 'quests' | 'dap' | 'squad'>;
export function evidenceReadiness(quest: EvidenceQuestId, snapshot: EvidenceSnapshot | null,
  playerId: string | undefined, connected: boolean) {
  const result = { ready: false, message: '', action: '' as '' | 'dap' | 'squad' | 'meet', label: '', canStart: false };
  const local = snapshot?.players.find(player => player.id === playerId);
  const progress = playerId && snapshot?.quests[playerId];
  if (!connected || !local || !progress) return { ...result, message: 'Connect to your shared server before submitting. Your recorded clip stays on this device.' };
  if (progress.photoVerification[quest] === 'approved') return { ...result, message: 'This quest is already verified.' };
  if (progress.photoVerification[quest] === 'pending') return { ...result, message: 'Your group’s evidence is being graded. The result will appear below.' };
  if (quest === 'dapHandshake' ? progress.dapHandshakeReady : progress[quest]) {
    return { ...result, ready: true, message: 'In-game step complete. Submit your saved clip below to get a grading result.' };
  }
  const peers = snapshot!.players.filter(player => player.connected && player.id !== playerId);
  const near = peers.some(player => Math.hypot(player.x - local.x, player.z - local.z) <= 1.5);
  if (quest === 'touchGrass') return { ...result, message: 'First, move your pet one world-unit using the arrows, tapping the ground, or walking. Then submit your saved clip.' };
  if (quest === 'meetFriend') return { ...result, action: 'meet' as const, label: 'Meet in the middle', canStart: peers.length > 0,
    message: peers.length ? 'First, bring both pets close together. Both players can tap Meet in the middle, then submit the clip.' : 'First, have your friend open the app on this same server, then bring both pets close together.' };
  if (quest === 'squadCircle') return { ...result, action: 'squad' as const, label: 'Ready for squad circle',
    canStart: peers.length >= 2 && !snapshot!.squad.ready.includes(local.id),
    message: peers.length < 2 ? 'First, gather at least three connected pets. Everyone must ready up for the circle before submitting.'
      : 'First, gather the pets close together and have everyone tap Ready for squad circle. Your saved clip can be submitted afterward.' };
  const offer = snapshot!.dap.pending.find(item => item.from === local.id || item.to === local.id);
  return { ...result, action: 'dap' as const, label: offer?.to === local.id ? 'Accept dap step' : offer?.from === local.id ? 'Waiting for friend…' : 'Start dap step',
    canStart: near && !local.action && offer?.from !== local.id,
    message: !peers.length ? 'First, have your friend open the app on this same server. Both pets must be close, and both players must start the dap step.'
      : !near ? 'First, bring both pets close together. Then both players tap Start dap step within 8 seconds. Your saved clip can be submitted afterward.'
        : offer?.from === local.id ? 'Dap offered. Your friend must tap Accept dap step on their device within 8 seconds.'
          : offer?.to === local.id ? 'Your friend offered a dap. Tap Accept dap step now, then submit your saved clip.'
            : 'First, both players tap Start dap step within 8 seconds. Then submit your saved clip — no need to record again.' };
}
