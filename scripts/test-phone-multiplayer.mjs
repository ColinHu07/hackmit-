#!/usr/bin/env node
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { createPlayServer } from '../bridge/play-server.mjs';

const HELP = `Usage: node scripts/test-phone-multiplayer.mjs [options]

  --rooms N       Concurrent four-player rooms, 1–10 (default: 5)
  --duration N    Seconds of simultaneous movement, 1–120 (default: 5)
  --url URL       Test this existing ws(s):// or http(s):// server
                  Without this option, use an isolated local ephemeral port.
  --origin URL    Browser Origin header for a restricted remote server
  --timeout N     Timeout per expected event in milliseconds (default: 15000)
  --help          Show this help

Creates temporary rooms, checks movement, actions, isolation, reconnection,
and departure, then leaves the rooms and closes every client. No photos or
model requests are sent. The 10-room limit keeps one run below the default
single-IP admission burst; repeated remote runs may need time to replenish.
This is a repeatable multiplayer smoke/load sample, not a capacity benchmark.
`;

function optionsFrom(args) {
  const options = { rooms: 5, duration: 5, timeout: 15000 };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!['--rooms', '--duration', '--url', '--origin', '--timeout'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    options[flag.slice(2)] = ['--rooms', '--duration', '--timeout'].includes(flag) ? Number(value) : value;
  }
  for (const [key, min, max] of [['rooms', 1, 10], ['duration', 1, 120], ['timeout', 1000, 120000]]) {
    if (!Number.isInteger(options[key]) || options[key] < min || options[key] > max) throw new Error(`--${key} must be an integer from ${min} to ${max}.`);
  }
  if (options.url) {
    const url = new URL(options.url);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('--url needs a ws(s):// or http(s):// address without credentials or a fragment.');
    if (url.pathname === '/') url.pathname = '/play';
    options.url = url.href;
  }
  if (options.origin) {
    const url = new URL(options.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== options.origin) throw new Error('--origin needs an exact http(s) browser origin, without a trailing slash.');
  }
  return options;
}

class PlayerClient {
  constructor(url, label, options, metrics, clients) {
    this.label = label;
    this.timeout = options.timeout;
    this.metrics = metrics;
    this.history = [];
    this.waiters = new Set();
    this.sequence = 0;
    this.failure = null;
    this.expectedClose = false;
    this.ws = new WebSocket(url, options.origin ? { origin: options.origin } : {});
    clients.add(this);
    this.ws.on('message', raw => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'error') throw new Error(`${label}: server returned ${message.code}: ${message.message}`);
        if (message.type === 'snapshot') {
          metrics.snapshots++;
          metrics.bytes += raw.length;
          this.latestSnapshot = message.snapshot;
          this.validateSnapshot?.(message.snapshot);
        }
        const entry = { message, sequence: ++this.sequence, received: performance.now() };
        this.history.push(entry);
        if (this.history.length > 400) this.history.shift();
        for (const waiter of this.waiters) {
          if (entry.sequence > waiter.after && waiter.match(message)) {
            this.waiters.delete(waiter);
            clearTimeout(waiter.timer);
            waiter.resolve(entry);
          }
        }
      } catch (error) { this.fail(error); }
    });
    this.ws.on('error', error => this.fail(new Error(`${label}: ${error.message}`)));
    this.ws.on('close', (code, reason) => {
      if (!this.expectedClose) this.fail(new Error(`${label}: unexpected disconnect ${code} ${reason.toString()}`));
    });
  }

  fail(error) {
    this.failure ??= error;
    for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(this.failure); }
    this.waiters.clear();
  }

  async open() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try { await once(this.ws, 'open', { signal: controller.signal }); }
    catch (error) { throw this.failure ?? new Error(`${this.label}: opening WebSocket failed: ${error.message}`); }
    finally { clearTimeout(timer); }
    return this;
  }

  send(message) {
    if (this.failure) throw this.failure;
    assert.equal(this.ws.readyState, WebSocket.OPEN, `${this.label}: client must be connected`);
    this.ws.send(JSON.stringify(message));
  }

  next(match, description, after = this.sequence) {
    if (this.failure) return Promise.reject(this.failure);
    const found = this.history.find(entry => entry.sequence > after && match(entry.message));
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = { match, after, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`${this.label}: timed out waiting for ${description}`));
      }, this.timeout);
      this.waiters.add(waiter);
    });
  }

  snapshot(match, description, after = this.sequence) {
    return this.next(message => message.type === 'snapshot' && match(message.snapshot), description, after);
  }

  async enter(entry) {
    const response = this.next(message => message.type === 'welcome', 'room welcome');
    this.send(entry);
    this.membership = (await response).message;
    return this.membership;
  }

  async close() {
    this.expectedClose = true;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`${this.label}: connection closed before the expected event`));
    }
    this.waiters.clear();
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const closed = once(this.ws, 'close').then(([code]) => code);
    const timer = setTimeout(() => this.ws.terminate(), 2000);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close(1000, 'Multiplayer test completed');
    else this.ws.terminate();
    try { return await closed; }
    finally { clearTimeout(timer); }
  }
}

const playerIn = (snapshot, id) => snapshot.players.find(player => player.id === id);
const sameTarget = (player, target) => player?.targetX === target.x && player?.targetZ === target.z;
const roster = snapshot => snapshot.players.map(player => player.id).sort();
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];

async function run(options) {
  let app;
  let stopping = false;
  const clients = new Set();
  const metrics = { snapshots: 0, bytes: 0, commandLatency: [] };
  const started = performance.now();
  try {
    let url = options.url;
    if (!url) {
      app = createPlayServer();
      const listening = once(app.server, 'listening');
      app.server.listen(0, '127.0.0.1');
      await listening;
      url = `ws://127.0.0.1:${app.server.address().port}/play`;
    }
    console.log(`Testing ${options.rooms * 4} simultaneous players across ${options.rooms} rooms (${options.url ? 'explicit remote/server URL' : 'isolated local server'}).`);
    const connect = label => {
      if (stopping) throw new Error('Test cleanup has started.');
      return new PlayerClient(url, label, options, metrics, clients).open();
    };
    const rooms = await Promise.all(Array.from({ length: options.rooms }, async (_, index) => {
      const room = { index, players: [], ids: new Set() };
      for (let slot = 0; slot < 4; slot++) {
        const client = await connect(`Room ${index + 1}, player ${slot + 1}`);
        const name = `Test ${index + 1}-${slot + 1}`;
        const session = await client.enter(slot === 0 ? { type: 'create', name } : { type: 'join', name, roomCode: room.code });
        room.code ??= session.roomCode;
        room.ids.add(session.playerId);
        room.players.push(client);
      }
      const validate = snapshot => {
        assert.equal(snapshot.roomCode, room.code, 'snapshots must stay in their own room');
        assert.ok(snapshot.players.every(player => room.ids.has(player.id)), 'another room’s player leaked into a snapshot');
        assert.equal(new Set(roster(snapshot)).size, snapshot.players.length, 'a roster contains duplicate IDs');
        for (const client of room.players) assert.ok(!JSON.stringify(snapshot).includes(client.membership.playerToken), 'a private player token leaked into a snapshot');
      };
      room.validate = validate;
      for (const client of room.players) client.validateSnapshot = validate;
      await Promise.all(room.players.map(async client => {
        const { message } = await client.snapshot(snapshot => snapshot.players.length === 4 && snapshot.players.every(player => player.connected), 'four-player roster');
        assert.deepEqual(roster(message.snapshot), [...room.ids].sort());
      }));
      return room;
    }));
    const memberships = rooms.flatMap(room => room.players.map(client => client.membership));
    assert.equal(new Set(rooms.map(room => room.code)).size, options.rooms, 'room codes must be distinct');
    assert.equal(new Set(memberships.map(session => session.playerId)).size, options.rooms * 4, 'player IDs must be distinct');
    assert.equal(new Set(memberships.map(session => session.playerToken)).size, options.rooms * 4, 'rejoin tokens must be distinct');
    console.log('PASS: distinct memberships and matching four-player rosters.');

    async function moveRoom(room, targets, checkMotion = false) {
      const sequences = room.players.map(client => client.sequence);
      const before = room.players.map(client => playerIn(client.latestSnapshot, client.membership.playerId));
      const sent = performance.now();
      room.players.forEach((client, slot) => client.send({ type: 'move', ...targets[slot] }));
      await Promise.all(room.players.map(async (observer, observerIndex) => {
        const { message, received } = await observer.snapshot(snapshot => room.players.every((client, slot) => sameTarget(playerIn(snapshot, client.membership.playerId), targets[slot])), 'all authoritative movement targets', sequences[observerIndex]);
        metrics.commandLatency.push(received - sent);
        if (checkMotion) {
          room.players.forEach((client, slot) => {
            const player = playerIn(message.snapshot, client.membership.playerId);
            const traveled = Math.hypot(player.x - before[slot].x, player.z - before[slot].z);
            const destinationDistance = Math.hypot(targets[slot].x - before[slot].x, targets[slot].z - before[slot].z);
            assert.ok(traveled <= 2 * (received - sent) / 1000 + 0.25, 'a client destination must use server movement speed');
            assert.ok(traveled < destinationDistance, 'a client destination must not teleport the player');
          });
        }
      }));
    }

    await Promise.all(rooms.map(room => moveRoom(room, room.players.map((_, slot) => ({ x: slot % 2 ? -2.5 : 2.5, z: -2 + room.index * 0.3 })), true)));
    const sustainedStarted = performance.now();
    const initialSnapshots = metrics.snapshots;
    const initialBytes = metrics.bytes;
    for (let round = 0; performance.now() - sustainedStarted < options.duration * 1000; round++) {
      await Promise.all(rooms.map(room => moveRoom(room, room.players.map((_, slot) => ({
        x: ((round + slot) % 2 ? -1 : 1) * (1.5 + room.index * 0.05),
        z: ((round + slot) % 3 - 1) * (1 + room.index * 0.05),
      })))));
      await delay(200);
    }
    const sustainedSeconds = (performance.now() - sustainedStarted) / 1000;
    const sustainedSnapshots = metrics.snapshots - initialSnapshots;
    const sustainedBytes = metrics.bytes - initialBytes;
    console.log(`PASS: room-isolated, server-authoritative movement during ${sustainedSeconds.toFixed(1)}s of concurrent activity.`);

    await Promise.all(rooms.map(async room => {
      await moveRoom(room, room.players.map(() => ({ x: 0, z: 0 })));
      await Promise.all(room.players.map(client => client.snapshot(snapshot => snapshot.players.every(player => Math.hypot(player.x, player.z) < 0.05), 'players gathering')));
      const waveSeen = room.players.map(client => client.snapshot(snapshot => playerIn(snapshot, room.players[0].membership.playerId)?.action?.kind === 'wave', 'shared wave'));
      room.players[0].send({ type: 'action', action: 'wave' });
      const waves = await Promise.all(waveSeen);
      const actions = waves.map(({ message }) => playerIn(message.snapshot, room.players[0].membership.playerId).action);
      actions.forEach(action => assert.deepEqual(action, actions[0], 'all observers must receive the same wave timing'));
      assert.ok(waves.every(({ message }) => message.snapshot.quest.waved), 'nearby wave quest must synchronize');
      const playSeen = room.players.map(client => client.snapshot(snapshot => snapshot.players.every(player => player.action?.kind === 'play'), 'cooperative play'));
      room.players[1].send({ type: 'action', action: 'play' });
      const plays = await Promise.all(playSeen);
      const expectedStarts = plays[0].message.snapshot.players.map(player => player.action.startedAt);
      assert.equal(new Set(expectedStarts).size, 1, 'cooperative actions must start together');
      plays.forEach(({ message }) => {
        assert.equal(message.snapshot.bond, 1, 'one play must award exactly one shared bond');
        assert.deepEqual(message.snapshot.players.map(player => player.action.startedAt), expectedStarts);
      });
    }));
    console.log('PASS: synchronized waves, cooperative actions, and shared rewards.');

    await Promise.all(rooms.map(async room => {
      const original = room.players[0];
      const saved = original.membership;
      const disconnected = room.players.slice(1).map(client => client.snapshot(snapshot => playerIn(snapshot, saved.playerId)?.connected === false, 'disconnected player reservation'));
      assert.equal(await original.close(), 1000, 'disconnect should close cleanly');
      await Promise.all(disconnected);
      const resumed = await connect(`Room ${room.index + 1}, reconnected player`);
      resumed.validateSnapshot = room.validate;
      const session = await resumed.enter({ type: 'join', roomCode: room.code, name: `Test ${room.index + 1}-1`, playerToken: saved.playerToken });
      assert.equal(session.playerId, saved.playerId, 'reconnection must retain the player ID');
      assert.equal(session.playerToken, saved.playerToken, 'reconnection must retain the player token');
      assert.equal(session.snapshot.bond, 1, 'reconnection must retain earned room progress');
      room.players[0] = resumed;
      await Promise.all(room.players.map(client => client.snapshot(snapshot => snapshot.players.length === 4 && snapshot.players.every(player => player.connected), 'restored four-player roster')));
      // A peer watches each explicit departure before closing the last socket.
      for (let slot = 3; slot > 0; slot--) {
        const leaving = room.players[slot];
        const departure = resumed.snapshot(snapshot => !playerIn(snapshot, leaving.membership.playerId) && snapshot.players.length === slot, 'released player slot');
        leaving.send({ type: 'leave' });
        await departure;
        assert.equal(await leaving.close(), 1000, 'departure should close cleanly');
      }
      resumed.send({ type: 'leave' });
      assert.equal(await resumed.close(), 1000, 'last departure should close cleanly');
    }));
    for (const client of clients) if (client.failure) throw client.failure;
    console.log('PASS: token reconnection retains identity; departures release slots and all sockets close cleanly.');
    console.log(`RESULT: ${options.rooms * 4} concurrent players, ${options.rooms} rooms; ${((performance.now() - started) / 1000).toFixed(1)}s total.`);
    console.log(`Movement observation latency: p50 ${percentile(metrics.commandLatency, 0.5).toFixed(1)} ms, p95 ${percentile(metrics.commandLatency, 0.95).toFixed(1)} ms (${metrics.commandLatency.length} client observations; local monotonic clock).`);
    console.log(`Activity sample: ${sustainedSnapshots} snapshots, ${(sustainedSnapshots / sustainedSeconds).toFixed(1)} snapshots/s total, ${(sustainedSnapshots / sustainedSeconds / (options.rooms * 4)).toFixed(1)} snapshots/s/client, ${(sustainedBytes / sustainedSeconds / 1024).toFixed(1)} KiB/s payload total.`);
    console.log('These measurements cover this run and machine/network only; they do not establish production capacity.');
  } finally {
    stopping = true;
    await Promise.allSettled([...clients].map(async client => {
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify({ type: 'leave' }));
      await client.close();
    }));
    await app?.close();
  }
}

try {
  const options = optionsFrom(process.argv.slice(2));
  if (options.help) console.log(HELP);
  else await run(options);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
