import { expect, it } from 'vitest';
import { evidenceReadiness } from './EvidenceReadiness';
import type { PlaySnapshot, PlayPlayer, PlayerQuests } from '../../shared/play-protocol';

function fixture(): Pick<PlaySnapshot, 'players' | 'quests' | 'dap' | 'squad'> {
  const quests: PlayerQuests = { touchGrass: false, meetFriend: false, dapHandshake: false,
    dapHandshakeReady: false, squadCircle: false, raidBoss: false, photoVerification: {} };
  const players = [
    { id: 'a', connected: true, x: 0, z: 0, action: null },
    { id: 'b', connected: true, x: 0.5, z: 0, action: null },
  ] as PlayPlayer[];
  return { players, quests: { a: quests }, dap: { pending: [] }, squad: { ready: [], minPlayers: 3 } };
}
it('explains the handshake prerequisite before allowing clip submission', () => {
  const state = evidenceReadiness('dapHandshake', fixture(), 'a', true);
  expect(state.ready).toBe(false);
  expect(state.canStart).toBe(true);
  expect(state.message).toContain('both players');
  expect(state.message).toContain('no need to record again');
});
it('lets the invited player accept while the sender waits', () => {
  const snapshot = fixture();
  const offered = { ...snapshot, dap: { pending: [{ from: 'a', to: 'b', expiresAt: Date.now() + 8000 }] } };
  expect(evidenceReadiness('dapHandshake', offered, 'a', true).canStart).toBe(false);
  const incoming = { ...snapshot, dap: { pending: [{ from: 'b', to: 'a', expiresAt: Date.now() + 8000 }] } };
  expect(evidenceReadiness('dapHandshake', incoming, 'a', true).label).toBe('Accept dap step');
  expect(evidenceReadiness('dapHandshake', incoming, 'a', true).canStart).toBe(true);
});
it('unlocks the saved clip after the server confirms the mutual dap', () => {
  const snapshot = fixture(); snapshot.quests.a!.dapHandshakeReady = true;
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).ready).toBe(true);
  snapshot.quests.a!.photoVerification.dapHandshake = 'pending';
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).ready).toBe(false);
  snapshot.quests.a!.photoVerification.dapHandshake = 'rejected';
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).ready).toBe(true);
  snapshot.quests.a!.photoVerification.dapHandshake = 'approved';
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).message).toBe('This quest is already verified.');
});
it('requires proximity and a live connection before starting the dap', () => {
  const snapshot = fixture(); snapshot.players[1]!.x = 10;
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', true).canStart).toBe(false);
  expect(evidenceReadiness('dapHandshake', snapshot, 'a', false).message).toContain('Connect');
});
it('gives actionable instructions for each other in-game requirement', () => {
  const snapshot = fixture();
  expect(evidenceReadiness('touchGrass', snapshot, 'a', true).message).toContain('one world-unit');
  expect(evidenceReadiness('meetFriend', snapshot, 'a', true).action).toBe('meet');
  expect(evidenceReadiness('squadCircle', snapshot, 'a', true).canStart).toBe(false);
});
