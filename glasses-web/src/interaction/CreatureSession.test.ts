import { expect, it } from 'vitest';
import { CreatureSession } from './CreatureSession';
it('rejects interactions while out of view without incrementing connection count', () => {
  const session = new CreatureSession();
  expect(session.perform('feed', 0, false).accepted).toBe(false);
  expect(session.bonds).toBe(0);
  expect(session.reaction).toBeNull();
});
it('gives each action a reaction and does not stack repeated activation', () => {
  const session = new CreatureSession();
  expect(session.perform('pet', 0, true).accepted).toBe(true);
  expect(session.perform('pet', 0.1, true).accepted).toBe(false);
  expect(session.bonds).toBe(1);
  expect(session.active(1)?.action).toBe('pet');
  expect(session.active(3)).toBeNull();
  expect(session.perform('feed', 3, true).accepted).toBe(true);
  expect(session.active(6)).toBeNull();
  expect(session.perform('play', 6, true).accepted).toBe(true);
  expect(session.bonds).toBe(3);
  expect(new CreatureSession().bonds).toBe(0);
});
