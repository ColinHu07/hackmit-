import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import WebSocket from 'ws';
import { createPlayServer } from '../bridge/play-server.mjs';

const phoneRoot = fileURLToPath(new URL('../companion-web', import.meta.url));

function message(socket, command, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('message', receive); reject(new Error(`Missing ${type}`)); }, 3000);
    function receive(data) {
      const value = JSON.parse(data.toString());
      if (value.type !== type && value.type !== 'error') return;
      clearTimeout(timeout);
      socket.off('message', receive);
      if (value.type === 'error') reject(new Error(value.message));
      else resolve(value);
    }
    socket.on('message', receive);
    socket.send(JSON.stringify(command));
  });
}

test('shared web proxy joins the existing server, preserves origin checks, and never creates local rooms', async t => {
  const allowedOrigin = 'https://friends.example';
  const upstream = createPlayServer({ allowedOrigins: [allowedOrigin] });
  upstream.server.listen(0, '127.0.0.1');
  await once(upstream.server, 'listening');
  const upstreamUrl = `http://127.0.0.1:${upstream.server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), 'bondimals-proxy-'));
  await writeFile(join(directory, 'index.html'), '<title>Team web game</title>');
  const previous = process.env.PLAY_UPSTREAM_URL;
  process.env.PLAY_UPSTREAM_URL = upstreamUrl.replace('http:', 'ws:') + '/play';
  let web;
  const sockets = [];
  t.after(async () => {
    sockets.forEach(socket => socket.terminate());
    await upstream.close();
    if (web) await new Promise(resolve => web.httpServer.close(resolve));
    await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.PLAY_UPSTREAM_URL;
    else process.env.PLAY_UPSTREAM_URL = previous;
  });
  web = await preview({
    root: phoneRoot,
    mode: 'test',
    build: { outDir: directory },
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
    logLevel: 'silent',
  });
  const webUrl = `http://127.0.0.1:${web.httpServer.address().port}`;
  async function connect(url) {
    const socket = new WebSocket(url.replace('http:', 'ws:'), { origin: allowedOrigin, handshakeTimeout: 3000 });
    sockets.push(socket);
    await once(socket, 'open');
    return socket;
  }
  assert.match(await (await fetch(webUrl)).text(), /Team web game/);
  const direct = await connect(upstreamUrl + '/play');
  const host = await message(direct, { type: 'create', name: 'Direct player' }, 'welcome');
  const proxied = await connect(webUrl + '/play');
  const friend = await message(proxied, { type: 'join', roomCode: host.roomCode, name: 'Web player' }, 'welcome');
  assert.deepEqual(friend.snapshot.players.map(player => player.name), ['Direct player', 'Web player']);
  assert.ok(friend.snapshot.players.some(player => player.id === host.playerId));
  const remoteHealth = await (await fetch(upstreamUrl + '/health')).json();
  assert.equal(remoteHealth.players, 2);
  assert.deepEqual(await (await fetch(webUrl + '/health')).json(), remoteHealth);
  const nearby = await connect(webUrl + '/nearby');
  assert.ok((await message(nearby, { type: 'discover', name: 'Nearby player' }, 'discovery_ready')).selfId);
  const evidence = await fetch(webUrl + '/verify', { method: 'POST', headers: { origin: allowedOrigin }, body: '{}' });
  assert.equal(evidence.status, 400);
  assert.match((await evidence.json()).error, /invalid/);
  await new Promise((resolve, reject) => {
    const denied = new WebSocket(webUrl.replace('http:', 'ws:') + '/play', { origin: 'https://wrong.example', handshakeTimeout: 3000 });
    sockets.push(denied);
    denied.on('open', () => reject(new Error('The upstream origin restriction was bypassed')));
    denied.on('error', error => { try { assert.match(error.message, /403/); resolve(); } catch (cause) { reject(cause); } });
  });
  await upstream.close();
  const unavailable = await fetch(webUrl + '/health', { signal: AbortSignal.timeout(3000) });
  assert.equal(unavailable.status, 500, 'an offline team server must not fall back to a separate local server');
});
