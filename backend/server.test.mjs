import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server.mjs';
import WebSocket from 'ws';
import { createStore } from './store.mjs';

const directory = mkdtempSync(join(tmpdir(), 'bondimals-test-'));
let clock = 1_800_000_000_000;
const app = createServer({ database: join(directory, 'game.sqlite'), now: () => clock });
let base;
before(async () => {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });

async function api(path, method = 'GET', body, token) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}

test('player rooms, rewards, pet decay, friendship, and authorization', async () => {
  const alice = (await api('/api/v1/players', 'POST', { name: 'Alice' })).data;
  const bob = (await api('/api/v1/players', 'POST', { name: 'Bob' })).data;
  const outsider = (await api('/api/v1/players', 'POST', { name: 'Outsider' })).data;
  assert.equal((await api('/api/v1/me')).status, 401);
  const room = (await api('/api/v1/rooms', 'POST', {}, alice.token)).data;
  assert.equal((await api(`/api/v1/rooms/${room.roomId}`, 'GET', undefined, outsider.token)).status, 403);
  await api('/api/v1/rooms/join', 'POST', { inviteCode: room.inviteCode.toLowerCase() }, bob.token);
  const interaction = await api(`/api/v1/rooms/${room.roomId}/interactions`, 'POST', { targetId: bob.player.id, kind: 'greet', requestId: 'request_001' }, alice.token);
  assert.equal(interaction.status, 200);
  assert.equal(interaction.data.xpEarned, 9);
  assert.equal(interaction.data.actorPet.happiness, 78);
  assert.equal((await api(`/api/v1/rooms/${room.roomId}/interactions`, 'POST', { targetId: bob.player.id, kind: 'greet', requestId: 'request_001' }, alice.token)).data.duplicate, true);
  assert.equal((await api(`/api/v1/rooms/${room.roomId}/interactions`, 'POST', { targetId: bob.player.id, kind: 'greet', requestId: 'request_002' }, alice.token)).status, 429);
  assert.equal((await api('/api/v1/me', 'GET', undefined, alice.token)).data.rewards.interactions, 1);
  assert.equal((await api('/api/v1/me', 'GET', undefined, outsider.token)).data.rewards.interactions, 0);
  assert.equal((await api('/api/v1/me/friends', 'GET', undefined, alice.token)).data.friends[0].count, 1);
  assert.equal((await api(`/api/v1/rooms/${room.roomId}/events`, 'GET', undefined, outsider.token)).status, 403);
  assert.equal((await api(`/api/v1/rooms/${room.roomId}/events`, 'GET', undefined, bob.token)).data.events.at(-1).type, 'interaction');
  clock += 86_400_000;
  const decayed = (await api('/api/v1/me', 'GET', undefined, alice.token)).data.pet;
  assert.equal(decayed.happiness, 66);
  assert.equal(decayed.hunger, 38);
  const fed = (await api('/api/v1/me/pet/actions', 'POST', { action: 'feed' }, alice.token)).data.pet;
  assert.equal(fed.hunger, 13);
});

test('room websocket only accepts a member and broadcasts social activity', async () => {
  const a = (await api('/api/v1/players', 'POST', { name: 'SocketA' })).data;
  const b = (await api('/api/v1/players', 'POST', { name: 'SocketB' })).data;
  const room = (await api('/api/v1/rooms', 'POST', {}, a.token)).data;
  await api('/api/v1/rooms/join', 'POST', { inviteCode: room.inviteCode }, b.token);
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/v1/live');
  await new Promise(resolve => socket.once('open', resolve));
  socket.send(JSON.stringify({ token: b.token, roomId: room.roomId }));
  const ready = await new Promise(resolve => socket.once('message', raw => resolve(JSON.parse(raw.toString()))));
  assert.equal(ready.type, 'ready');
  const eventPromise = new Promise(resolve => socket.once('message', raw => resolve(JSON.parse(raw.toString()))));
  await api(`/api/v1/rooms/${room.roomId}/interactions`, 'POST', { targetId: b.player.id, kind: 'gift', requestId: 'socket_001' }, a.token);
  const event = await eventPromise;
  assert.equal(event.type, 'interaction');
  assert.equal(event.payload.kind, 'gift');
  socket.close();
});

test('SQLite state survives a store restart', () => {
  const filename = join(directory, 'persist.sqlite');
  const first = createStore(filename, () => clock);
  const { player, token } = first.createPlayer('Persistent');
  first.care(player.id, 'feed');
  first.close();
  const second = createStore(filename, () => clock);
  assert.equal(second.authenticate(token).id, player.id);
  assert.equal(second.getProfile(player.id).pet.hunger, 0);
  second.close();
});
