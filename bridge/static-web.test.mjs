import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createPlayServer } from './play-server.mjs';

async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'bondimals-web-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const webRoot = join(directory, 'dist');
  await mkdir(join(webRoot, 'assets'), { recursive: true });
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>Bondimals</title>');
  await writeFile(join(webRoot, 'assets', 'index-AbC123_x.js'), 'export const game = true;');
  await writeFile(join(webRoot, 'pet.glb'), Buffer.from([1, 2, 3, 4]));
  await writeFile(join(directory, 'secret.txt'), 'outside the build');
  await writeFile(join(webRoot, '.env'), 'private configuration');
  await symlink(join(directory, 'secret.txt'), join(webRoot, 'escape.txt'));
  const app = createPlayServer({ webRoot, ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  async function connect(path = '/play') {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + path);
    await once(socket, 'open');
    return socket;
  }
  return { app, webRoot, origin, connect };
}

function rawGet(origin, path) {
  return new Promise((resolve, reject) => {
    const call = request(origin, { path }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    call.on('error', reject);
    call.end();
  });
}

function nextMessage(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('message', onMessage); reject(new Error(`Missing ${type}`)); }, 3000);
    function onMessage(data) {
      const message = JSON.parse(data.toString());
      if (message.type !== type) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(message);
    }
    socket.on('message', onMessage);
  });
}

test('web build and game APIs share an origin with appropriate MIME types and caching', async t => {
  const { origin, connect } = await setup(t);
  const shell = await fetch(origin + '/?room=ABC234');
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(shell.headers.get('cache-control'), 'no-cache');
  assert.match(await shell.text(), /Bondimals/);
  const asset = await fetch(origin + '/assets/index-AbC123_x.js');
  assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(await asset.text(), 'export const game = true;');
  const unchanged = await fetch(origin + '/assets/index-AbC123_x.js', { headers: { 'if-none-match': asset.headers.get('etag') } });
  assert.equal(unchanged.status, 304);
  const model = await fetch(origin + '/pet.glb');
  assert.equal(model.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(model.headers.get('cache-control'), 'no-cache');
  assert.deepEqual([...new Uint8Array(await model.arrayBuffer())], [1, 2, 3, 4]);
  const head = await fetch(origin + '/pet.glb', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '4');
  assert.equal(await head.text(), '');
  for (const path of ['/missing.js', '/assets', '/play', '/nearby', '/verify']) {
    const response = await fetch(origin + path, { headers: { accept: 'text/html' } });
    assert.equal(response.status, 404, `${path} does not return the app shell`);
    await response.text();
  }
  assert.equal((await fetch(origin + '/verify', { method: 'OPTIONS' })).status, 204);
  const invalidEvidence = await fetch(origin + '/verify', { method: 'POST', body: '{}' });
  assert.equal(invalidEvidence.status, 400);
  assert.equal((await invalidEvidence.json()).error, 'The photo request is invalid.');
  const nearby = await connect('/nearby');
  const ready = nextMessage(nearby, 'discovery_ready');
  nearby.send(JSON.stringify({ type: 'discover', name: 'Nearby tester' }));
  assert.ok((await ready).selfId);
});

test('static serving rejects encoded traversal, dotfiles, and symlinks outside the build', async t => {
  const { origin } = await setup(t);
  for (const path of [
    '/../secret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt',
    '/assets/../../secret.txt', '/.env', '/%2eenv', '/escape.txt',
    '/%5c..%5csecret.txt', '/%00secret.txt',
  ]) {
    const response = await rawGet(origin, path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body.includes('outside the build'), false);
    assert.equal(response.body.includes('private configuration'), false);
  }
  assert.equal((await rawGet(origin, '/%GG')).status, 400);
});

test('health reports active multiplayer counts without player identities or session secrets', async t => {
  const { origin, connect } = await setup(t);
  const a = await connect();
  let welcome = nextMessage(a, 'welcome');
  a.send(JSON.stringify({ type: 'create', name: 'Private player' }));
  const first = await welcome;
  const b = await connect();
  welcome = nextMessage(b, 'welcome');
  b.send(JSON.stringify({ type: 'join', roomCode: first.roomCode, name: 'Another player' }));
  await welcome;
  const c = await connect();
  welcome = nextMessage(c, 'welcome');
  c.send(JSON.stringify({ type: 'create', name: 'Separate room' }));
  await welcome;
  const idle = await connect();
  assert.equal(idle.readyState, WebSocket.OPEN);
  const health = await (await fetch(origin + '/health?check=1')).json();
  assert.deepEqual(health, {
    ok: true, service: 'bondimals-play', rooms: 2, activeRooms: 2,
    players: 3, connections: 4, maxPlayersPerRoom: 4, maxRooms: 500, maxConnections: 1200,
  });
  for (const secret of [first.playerToken, first.playerId, first.roomCode, 'Private player']) {
    assert.equal(JSON.stringify(health).includes(secret), false);
  }
  const closed = once(c, 'close');
  c.close();
  await closed;
  const after = await (await fetch(origin + '/health')).json();
  assert.equal(after.players, 2);
  assert.equal(after.activeRooms, 1);
  assert.equal(after.rooms, 2, 'a disconnected room remains reserved during the rejoin grace period');
});

test('static serving is opt-in and a missing build fails with a useful startup error', async t => {
  const { origin, webRoot } = await setup(t, { webRoot: undefined });
  const response = await fetch(origin + '/');
  assert.equal(response.status, 404);
  await response.text();
  assert.throws(() => createPlayServer({ webRoot: join(webRoot, 'missing') }), /npm run build:phone/);
});
