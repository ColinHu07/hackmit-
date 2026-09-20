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
  const store = createPetStore(':memory:');
  const token = 'b'.repeat(48);
  store.ensure(token, 'Blair');
  store.feed(token, 'treat');
  assert.throws(() => store.feed(token, 'treat'), error => error.code === 'food_empty');
  store.close();
});
