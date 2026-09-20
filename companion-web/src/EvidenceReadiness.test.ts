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
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).message).toContain('Grading your submission');
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).ready).toBe(false);
  snapshot.quests.a!.photoVerification.dapHandshake = 'rejected';
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).ready).toBe(true);
  snapshot.quests.a!.photoVerification.dapHandshake = 'approved';
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).ready).toBe(true);
});

it('counts down server cooldowns and permits another completion at zero', () => {
  const snapshot = fixture();
  snapshot.quests.a!.photoVerification.meetFriend = 'approved';
  snapshot.players[0]!.survival = { questCooldowns: { meetFriend: 59_001 } } as PlayPlayer['survival'];
  expect(evidenceReadiness('meetFriend', snapshot, 'a', true)).toEqual({ ready: false, message: 'Quest complete ✓ Play again in 60s (demo cooldown).' });
  snapshot.players[0]!.survival!.questCooldowns!.meetFriend = 0;
  expect(evidenceReadiness('meetFriend', snapshot, 'a', true).ready).toBe(true);
});
it('waits for a partner cooldown but can use another available partner', () => {
  const snapshot = fixture();
  snapshot.players[1]!.survival = { questCooldowns: { meetFriend: 30_000 } } as PlayPlayer['survival'];
  expect(evidenceReadiness('meetFriend', snapshot, 'a', true).message).toContain('30s');
  snapshot.players.push({ id: 'c', connected: true } as PlayPlayer);
  expect(evidenceReadiness('meetFriend', snapshot, 'a', true).ready).toBe(true);
});
