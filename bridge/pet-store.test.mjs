import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPetStore } from './pet-store.mjs';

test('food inventory and survival points persist across store restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bondimals-pet-'));
  let clock = 1_800_000_000_000;
  const token = 'a'.repeat(48);
  const first = createPetStore(join(directory, 'pets.sqlite'), () => clock);
  const initial = first.ensure(token, 'Alex');
  assert.deepEqual(initial.inventory, { berry: 3, kibble: 2, treat: 1 });
  const fed = first.feed(token, 'kibble');
  assert.equal(fed.inventory.kibble, 1);
  assert.equal(fed.points, 7);
  assert.equal(fed.health, 100);
  clock += 2 * 3_600_000;
  const afterTime = first.profile(token);
  assert.equal(afterTime.survivalHours, 2);
  assert.equal(afterTime.points, 9);
  assert.ok(afterTime.hunger < fed.hunger);
  first.close();

  const second = createPetStore(join(directory, 'pets.sqlite'), () => clock);
  assert.equal(second.profile(token).inventory.kibble, 1);
  assert.equal(second.profile(token).points, 9);
  second.close();
  rmSync(directory, { recursive: true, force: true });
});

test('feeding refuses empty inventory instead of creating food', () => {
  let clock = 1_800_000_000_000;
  const store = createPetStore(':memory:', () => clock);
  const token = 'b'.repeat(48);
  store.ensure(token, 'Blair');
  store.feed(token, 'treat');
  assert.throws(() => store.feed(token, 'treat'), error => error.code === 'treat_cooldown');
  clock += 3_600_000;
  assert.throws(() => store.feed(token, 'treat'), error => error.code === 'food_empty');
  store.close();
});

test('happiness increases with each bite, once only, and cooldown survives restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kith-bites-'));
  const file = join(directory, 'pets.sqlite');
  const token = 'c'.repeat(48);
  const start = 1_800_000_000_000;
  let clock = start;
  let store = createPetStore(file, () => clock);
  store.ensure(token, 'Bites');
  const fed = store.feed(token, 'berry');
  assert.equal(fed.happiness, 70);
  assert.equal(fed.inventory.berry, 2);
  assert.equal(fed.treatCooldownMs, 3_600_000);
  clock = start + .4 * 6200;
  assert.equal(store.profile(token).happiness, 70);
  clock = start + .49 * 6200;
  assert.equal(store.profile(token).happiness, 70.84);
  assert.equal(store.profile(token).happiness, 70.84);
  store.close();
  store = createPetStore(file, () => clock);
  assert.equal(store.profile(token).happiness, 70.84);
  assert.throws(() => store.feed(token, 'berry'), error => error.code === 'treat_cooldown');
  clock = start + .55 * 6200;
  assert.equal(store.profile(token).happiness, 71.8);
  clock = start + .61 * 6200;
  assert.equal(store.profile(token).happiness, 73);
  clock = start + 15_000;
  assert.equal(store.profile(token).happiness, 73);
  assert.equal(store.profile(token).treatCooldownMs, 3_585_000);
  clock = start + 3_600_000;
  assert.equal(store.profile(token).treatCooldownMs, 0);
  assert.equal(store.feed(token, 'berry').happiness, 33);
  assert.equal(store.profile(token).inventory.berry, 1);
  store.close(); rmSync(directory, { recursive: true, force: true });
});


test('happiness falls one point per minute and polling does not reset the clock', () => {
  let clock = 1_800_000_000_000;
  const store = createPetStore(':memory:', () => clock);
  const token = 'd'.repeat(48);
  store.ensure(token, 'Minute');
  for (let i = 0; i < 59; i++) { clock += 1000; assert.equal(store.profile(token).happiness, 70); }
  clock += 1000;
  assert.equal(store.profile(token).happiness, 69);
  clock += 60_000;
  assert.equal(store.profile(token).happiness, 68);
  clock += 100 * 60_000;
  assert.equal(store.profile(token).happiness, 0);
  store.close();
});

test('one-hour boost persists, blocks all feeding, and expires back to minute decay', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kith-boost-'));
  const file = join(directory, 'pets.sqlite');
  const start = 1_800_000_000_000;
  let clock = start;
  let store = createPetStore(file, () => clock);
  const token = 'e'.repeat(48);
  store.ensure(token, 'Boost');
  store.feed(token, 'berry');
  clock = start + 89_999;
  assert.equal(store.profile(token).happiness, 73);
  clock++;
  assert.equal(store.profile(token).happiness, 72);
  store.close();
  store = createPetStore(file, () => clock);
  clock = start + 3_599_999;
  for (const food of ['berry', 'kibble', 'treat']) {
    assert.throws(() => store.feed(token, food), error => error.code === 'treat_cooldown');
  }
  assert.equal(store.profile(token).inventory.berry, 2);
  clock++;
  assert.equal(store.profile(token).happiness, 33);
  assert.equal(store.profile(token).treatCooldownMs, 0);
  clock += 59_999;
  assert.equal(store.profile(token).happiness, 33);
  clock++;
  assert.equal(store.profile(token).happiness, 32);
  store.close(); rmSync(directory, { recursive: true, force: true });
});

test('feeding partway through a minute preserves the elapsed decay fraction', () => {
  const start = 1_800_000_000_000;
  let clock = start;
  const store = createPetStore(':memory:', () => clock);
  const token = 'f'.repeat(48);
  store.ensure(token, 'Fraction');
  clock += 30_000;
  store.feed(token, 'berry');
  clock += 44_999;
  assert.equal(store.profile(token).happiness, 73);
  clock++;
  assert.equal(store.profile(token).happiness, 72);
  store.close();
});

test('offline catch-up splits elapsed time at the end of the boost', () => {
  let clock = 1_800_000_000_000;
  const store = createPetStore(':memory:', () => clock);
  const token = '1'.repeat(48);
  store.ensure(token, 'Offline');
  store.feed(token, 'berry');
  clock += 3_660_000;
  assert.equal(store.profile(token).happiness, 32);
  assert.equal(store.profile(token).happiness, 32);
  store.close();
});
