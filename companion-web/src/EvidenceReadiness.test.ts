import { expect, it } from 'vitest';
import { evidenceReadiness } from './EvidenceReadiness';
import type { PlaySnapshot, PlayPlayer, PlayerQuests } from '../../shared/play-protocol';

function fixture(): Pick<PlaySnapshot, 'players' | 'quests'> {
  const quests: PlayerQuests = { touchGrass: false, meetFriend: false, dapHandshake: false,
    dapHandshakeReady: false, squadCircle: false, raidBoss: false, photoVerification: {} };
  return { players: [
    { id: 'a', connected: true, x: -10, z: 0, action: null },
    { id: 'b', connected: true, x: 10, z: 0, action: null },
  ] as PlayPlayer[], quests: { a: quests } };
}
it('unlocks both duo submissions by presence alone, even with pets far apart', () => {
  for (const quest of ['dapHandshake', 'meetFriend'] as const) {
    expect(evidenceReadiness(quest, fixture(), 'a', true).ready).toBe(true);
  }
});
it('does not count disconnected pets toward the minimum', () => {
  const snapshot = fixture(); snapshot.players[1]!.connected = false;
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).ready).toBe(false);
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', false).message).toContain('Connect');
});
it('allows solo evidence without walking and squad evidence without readying up', () => {
  const snapshot = fixture();
  expect(evidenceReadiness('touchGrass', snapshot, 'a', true).ready).toBe(true);
  expect(evidenceReadiness('squadCircle', snapshot, 'a', true).ready).toBe(false);
  snapshot.players.push({ ...snapshot.players[1]!, id: 'c' });
  expect(evidenceReadiness('squadCircle', snapshot, 'a', true).ready).toBe(true);
});
it('shows server receipt during grading and permits retry after rejection', () => {
  const snapshot = fixture();
  snapshot.quests.a!.photoVerification.dapHandshake = 'pending';
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).message).toContain('Server received');
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).ready).toBe(false);
  snapshot.quests.a!.photoVerification.dapHandshake = 'rejected';
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).ready).toBe(true);
  snapshot.quests.a!.photoVerification.dapHandshake = 'approved';
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).message).toBe('This quest is already verified.');
});
