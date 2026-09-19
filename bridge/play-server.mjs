import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { attachNearbyDiscovery } from './nearby-discovery.mjs';
import { createServer as createGameServer } from '../backend/server.mjs';
import {
  PLAY_ACTION_DURATION, PLAY_FRIEND_DISTANCE, PLAY_MAX_MESSAGE_BYTES,
  PLAY_ROOM_ALPHABET, PLAY_TICK_MS, parsePlayMessage,
} from '../shared/play-protocol.mjs';

/** Ephemeral, server-authoritative two-person playground; no account or camera data. */
export function createPlayServer(options = {}) {
  const tickMs = options.tickMs ?? PLAY_TICK_MS;
  const rejoinGraceMs = options.rejoinGraceMs ?? 30_000;
  const roomIdleMs = options.roomIdleMs ?? 10 * 60_000;
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  const interactionTtlMs = options.interactionTtlMs ?? 15_000;
  const displayGrantTtlMs = options.displayGrantTtlMs ?? 60_000;
  const maxRooms = options.maxRooms ?? 500;
  const maxConnections = options.maxConnections ?? 1200;
  const origins = new Set(options.allowedOrigins ?? []);
  const rooms = new Map();
  const connections = new Set();
  const addresses = new Map();
  const displayGrants = new Map();
  const game = createGameServer({ database: options.database ?? ':memory:', origin: options.allowedOrigins ?? [] });
  let closing = false;

  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ ok: true, service: 'bondimals-play', rooms: rooms.size }));
    } else if (request.url?.startsWith('/api/v1/')) {
      game.server.emit('request', request, response);
    } else {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not found');
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: PLAY_MAX_MESSAGE_BYTES, perMessageDeflate: false });
  const rejectUpgrade = (socket, status, message) => {
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const consume = (bucket, capacity, ratePerSecond, now = Date.now()) => {
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.at) * ratePerSecond / 1000);
    bucket.at = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };
  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => {});
    const requestPath = request.url?.split('?')[0];
    if (requestPath === '/nearby') return;
    if (requestPath === '/api/v1/live') return game.server.emit('upgrade', request, socket, head);
    if (!['/', '/play', '/ws'].includes(requestPath)) return rejectUpgrade(socket, 404, 'Not Found');
    if (origins.size && !origins.has(request.headers.origin)) return rejectUpgrade(socket, 403, 'Forbidden');
    if (closing || connections.size >= maxConnections) return rejectUpgrade(socket, 503, 'Unavailable');
    // Use the actual socket address; forwarded headers are untrusted. Allow NAT/proxy bursts.
    const address = request.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    let quota = addresses.get(address);
    if (!quota) {
      if (addresses.size >= 5000) return rejectUpgrade(socket, 503, 'Unavailable');
      quota = { tokens: 100, at: now, admissions: { tokens: 60, at: now } };
      addresses.set(address, quota);
    }
    if (!consume(quota, 100, 2, now)) return rejectUpgrade(socket, 429, 'Too Many Requests');
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request, quota));
  });

  function send(ws, message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 128 * 1024) { ws.terminate(); return; }
    ws.send(JSON.stringify(message));
  }
  function fail(ws, code, message) { send(ws, { type: 'error', code, message }); }
  function snapshot(room, now = Date.now()) {
    return {
      roomCode: room.code, serverTime: now, revision: room.revision, space: 'virtual',
      players: [...room.players.values()].sort((a, b) => a.slot - b.slot).map(player => ({
        id: player.id, name: player.name, slot: player.slot,
        x: player.x, z: player.z, targetX: player.targetX, targetZ: player.targetZ,
        yaw: player.yaw, connected: Boolean(player.socket), action: player.action,
      })),
      bond: room.bond, quest: { ...room.quest }, notice: room.notice, interaction: room.interaction,
      ...(room.encounter ? { encounter: {
        kind: 'nearby', dapConfirmed: [...room.encounter.dapConfirmed], dapComplete: room.encounter.dapComplete,
      } } : {}),
    };
  }
  function broadcast(room, now = Date.now()) {
    room.revision += 1;
    const message = { type: 'snapshot', snapshot: snapshot(room, now) };
    for (const player of room.players.values()) send(player.socket, message);
    for (const display of room.displays) send(display, message);
  }
  function closePlayer(player) {
    const ws = player.socket;
    player.socket = null;
    if (ws) ws.session = null;
    return ws;
  }
  function detach(ws, intentional = false) {
    const session = ws.session;
    ws.session = null;
    if (!session) return;
    const { room, player } = session;
    if (player.socket !== ws) return;
    closePlayer(player);
    const now = Date.now();
    room.lastActivity = now;
    player.targetX = player.x;
    player.targetZ = player.z;
    player.action = null;
    if (room.interaction?.status === 'pending') resolveInteraction(room, 'canceled', now);
    if (intentional) {
      room.players.delete(player.id);
      for (const display of room.displays) if (display.displaySession?.player === player) display.close(4002, 'Player left');
      room.notice = `${player.name} left the playground.`;
    } else {
      player.disconnectedAt = now;
      room.notice = `${player.name} disconnected. Their place is saved for a moment.`;
    }
    broadcast(room, now);
  }
  function createRoom() {
    let code;
    do { code = Array.from({ length: 6 }, () => PLAY_ROOM_ALPHABET[randomInt(PLAY_ROOM_ALPHABET.length)]).join(''); }
    while (rooms.has(code));
    const room = {
      code, players: new Map(), bond: 0, quest: { met: false, waved: false, played: false },
      revision: 0, interaction: null, interactionRequests: new Map(), lastInteractionAt: 0, displays: new Set(),
      notice: 'Invite a friend with your room code.', lastActivity: Date.now(), lastPlayAt: 0,
    };
    rooms.set(code, room);
    return room;
  }
  function welcome(ws, room, player) {
    if (player.accountId) room.gameRoomId = game.store.linkPlayRoom(player.accountId, room.code);
    player.socket = ws;
    player.disconnectedAt = null;
    ws.session = { room, player };
    room.lastActivity = Date.now();
    send(ws, { type: 'welcome', protocolVersion: 1, roomCode: room.code, playerId: player.id, playerToken: player.token, snapshot: snapshot(room) });
    broadcast(room);
  }
  function makePlayer(room, name, accountId = null) {
    const slot = [...room.players.values()].some(player => player.slot === 0) ? 1 : 0;
    const x = slot === 0 ? -1.2 : 1.2;
    const player = {
      id: randomUUID(), token: randomBytes(24).toString('hex'), name, slot, accountId,
      x, z: 0, targetX: x, targetZ: 0, yaw: slot === 0 ? Math.PI / 2 : -Math.PI / 2,
      action: null, socket: null, disconnectedAt: null, lastActionAt: 0,
    };
    room.players.set(player.id, player);
    return player;
  }
  function addPlayer(ws, room, name, accountId = null) {
    const player = makePlayer(room, name, accountId);
    if (room.players.size === 2) room.notice = `${name} joined! Bring your pets together.`;
    welcome(ws, room, player);
  }
  function reserveNearbyRoom(names) {
    if (closing || rooms.size >= maxRooms) return null;
    const room = createRoom();
    room.encounter = { dapConfirmed: new Set(), dapComplete: false };
    room.notice = 'You both agreed to meet! Say hello in person and confirm your dap together.';
    return names.map(name => {
      const player = makePlayer(room, name);
      player.disconnectedAt = Date.now();
      return { roomCode: room.code, playerToken: player.token };
    });
  }
  const sameToken = (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const friends = room => [...room.players.values()].filter(player => player.socket);
  function reward(room, actor, target, kind) {
    if (!room.gameRoomId || !actor.accountId || !target.accountId) return;
    try {
      const result = game.store.interact(room.gameRoomId, actor.accountId, target.accountId, kind, randomUUID());
      if (result.event) game.broadcast(room.gameRoomId, result.event);
    } catch (error) {
      // Room action remains valid when a player has reached the reward cooldown or daily cap.
      if (error.status !== 429) throw error;
    }
  }
  function rewardPair(room, players, kind) {
    if (players.length !== 2) return;
    reward(room, players[0], players[1], kind);
    reward(room, players[1], players[0], kind);
  }
  const together = players => players.length === 2 && Math.hypot(players[0].x - players[1].x, players[0].z - players[1].z) <= PLAY_FRIEND_DISTANCE;
  function resolveInteraction(room, status, now) {
    const interaction = room.interaction;
    if (!interaction || interaction.status !== 'pending') return;
    interaction.status = status;
    if (status === 'accepted') {
      interaction.startedAt = now;
      interaction.duration = 1800;
      room.bond += 1;
      room.lastInteractionAt = now;
      const actor = room.players.get(interaction.actorId);
      const target = room.players.get(interaction.targetId);
      let awarded = 0;
      if (room.gameRoomId && actor?.accountId && target?.accountId) {
        for (const [index, [from, to]] of [[actor, target], [target, actor]].entries()) {
          try {
            const result = game.store.interact(room.gameRoomId, from.accountId, to.accountId, 'greet', `${interaction.id}_${index}`);
            if (result.event) game.broadcast(room.gameRoomId, result.event);
            awarded += 1;
          } catch {
            // The shared animation still resolves; the snapshot reports a missing reward.
          }
        }
      }
      interaction.rewardStatus = awarded === 2 ? 'awarded' : actor?.accountId && target?.accountId ? 'unavailable' : 'not_linked';
      room.notice = 'Your pets shared a high five!';
    } else room.notice = status === 'declined' ? 'High five declined.' : status === 'expired' ? 'High five invitation expired.' : 'High five canceled.';
  }
  function setAction(player, kind, now) {
    player.action = { id: randomUUID(), kind, startedAt: now, duration: PLAY_ACTION_DURATION[kind] };
    player.lastActionAt = now;
    player.targetX = player.x;
    player.targetZ = player.z;
  }
  function processMessage(ws, message) {
    const now = Date.now();
    if (message.type === 'attach_display') {
      if (ws.session || ws.displaySession) return fail(ws, 'already_joined', 'This connection is already in a room.');
      const grant = displayGrants.get(message.grant);
      if (!grant || grant.expiresAt <= now || !grant.room.players.has(grant.player.id)) return fail(ws, 'invalid_grant', 'That display code expired. Request a new one on your phone.');
      displayGrants.delete(message.grant);
      grant.room.displays.add(ws);
      ws.displaySession = { room: grant.room, player: grant.player };
      send(ws, { type: 'display_welcome', protocolVersion: 1, roomCode: grant.room.code, playerId: grant.player.id, snapshot: snapshot(grant.room, now) });
      return;
    }
    if (ws.displaySession) return fail(ws, 'display_read_only', 'Use your phone to control this pet.');
    if (message.type === 'create' || message.type === 'join') {
      if (ws.session) return fail(ws, 'already_joined', 'Leave your current room before joining another.');
      if (!consume(ws.quota.admissions, 60, 0.5, now)) return fail(ws, 'rate_limited', 'Too many room requests. Try again shortly.');
      const account = message.accountToken ? game.store.authenticate(message.accountToken) : null;
      if (message.accountToken && !account) return fail(ws, 'invalid_account', 'Your player session expired. Reload and try again.');
      if (message.type === 'create') {
        if (rooms.size >= maxRooms) return fail(ws, 'server_full', 'The playground is full. Try again later.');
        addPlayer(ws, createRoom(), message.name, account?.id);
        return;
      }
      const room = rooms.get(message.roomCode);
      if (!room) return fail(ws, 'room_not_found', 'That room does not exist or has expired.');
      // Reap expired reservations before admission, even between simulation ticks.
      reapPlayers(room, now);
      if (message.playerToken !== undefined) {
        const player = [...room.players.values()].find(candidate => sameToken(candidate.token, message.playerToken));
        if (!player) return fail(ws, 'invalid_token', 'This saved session has expired or belongs to a different room.');
        if (player.accountId && player.accountId !== account?.id) return fail(ws, 'invalid_account', 'This pet belongs to a different player account.');
        if (account && [...room.players.values()].some(candidate => candidate !== player && candidate.accountId === account.id)) return fail(ws, 'already_joined', 'This player account is already in the room.');
        if (!player.accountId && account?.id) player.accountId = account.id;
        const oldSocket = closePlayer(player);
        if (oldSocket) oldSocket.close(4001, 'Session resumed on another connection');
        player.name = message.name;
        room.notice = room.encounter ? `${player.name} joined the meetup.` : `${player.name} is back!`;
        welcome(ws, room, player);
        return;
      }
      if (room.encounter) return fail(ws, 'private_room', 'This nearby playground requires your invitation session.');
      if (room.players.size >= 2) return fail(ws, 'room_full', 'This room has two players. Disconnected places are briefly reserved.');
      if (account && [...room.players.values()].some(player => player.accountId === account.id)) return fail(ws, 'already_joined', 'This player account is already in the room.');
      addPlayer(ws, room, message.name, account?.id);
      return;
    }
    if (message.type === 'leave') { detach(ws, true); return; }
    if (!ws.session) return fail(ws, 'not_joined', 'Create or join a room first.');
    const { room, player } = ws.session;
    room.lastActivity = now;
    if (message.type === 'device_grant') {
      if (displayGrants.size >= 1000) return fail(ws, 'server_full', 'Too many pending display codes.');
      let grant;
      do { grant = Array.from({ length: 8 }, () => PLAY_ROOM_ALPHABET[randomInt(PLAY_ROOM_ALPHABET.length)]).join(''); }
      while (displayGrants.has(grant));
      const expiresAt = now + displayGrantTtlMs;
      displayGrants.set(grant, { room, player, expiresAt });
      send(ws, { type: 'device_grant', grant, expiresAt });
      return;
    }
    if (message.type === 'interaction_invite') {
      const key = `${player.id}:${message.requestId}`;
      const existing = room.interactionRequests.get(key);
      if (existing) {
        if (existing.targetId !== message.targetPlayerId || existing.kind !== message.kind) return fail(ws, 'request_conflict', 'That request ID was used for another invitation.');
        return send(ws, { type: 'snapshot', snapshot: snapshot(room, now) });
      }
      const target = room.players.get(message.targetPlayerId);
      if (!target || target === player || !target.socket) return fail(ws, 'friend_disconnected', 'Your friend must be here to interact.');
      if (room.interaction?.status === 'pending') return fail(ws, 'interaction_busy', 'Answer the current invitation first.');
      if (now - room.lastInteractionAt < 5000) return fail(ws, 'interaction_cooldown', 'Wait a moment before another high five.');
      if (!together(friends(room))) return fail(ws, 'friend_too_far', 'Bring both pets close together.');
      room.interaction = { id: randomUUID(), kind: message.kind, actorId: player.id, targetId: target.id, status: 'pending', expiresAt: now + interactionTtlMs };
      room.interactionRequests.set(key, room.interaction);
      if (room.interactionRequests.size > 128) room.interactionRequests.delete(room.interactionRequests.keys().next().value);
      room.notice = `${player.name} invited ${target.name} to high five.`;
      broadcast(room, now);
      return;
    }
    if (message.type === 'interaction_respond') {
      const interaction = room.interaction;
      if (!interaction || interaction.id !== message.interactionId) return fail(ws, 'interaction_not_found', 'That invitation is no longer active.');
      if (interaction.targetId !== player.id) return fail(ws, 'not_target', 'Only the invited player can answer.');
      if (interaction.status !== 'pending') return send(ws, { type: 'snapshot', snapshot: snapshot(room, now) });
      if (now >= interaction.expiresAt) resolveInteraction(room, 'expired', now);
      else if (!message.accept) resolveInteraction(room, 'declined', now);
      else if (!together(friends(room))) resolveInteraction(room, 'canceled', now);
      else resolveInteraction(room, 'accepted', now);
      broadcast(room, now);
      return;
    }
    if (message.type === 'confirm_dap') {
      if (!room.encounter) return fail(ws, 'not_nearby_encounter', 'This quest is available after accepting a nearby invitation.');
      if (friends(room).length !== 2) return fail(ws, 'friend_disconnected', 'Both people need to be connected to confirm this quest.');
      if (room.encounter.dapComplete || room.encounter.dapConfirmed.has(player.id)) return;
      room.encounter.dapConfirmed.add(player.id);
      if (room.encounter.dapConfirmed.size === 2) {
        room.encounter.dapComplete = true;
        room.bond += 1;
        room.notice = 'You both confirmed your in-person hello! Friendship grew.';
        rewardPair(room, friends(room), 'greet');
      } else room.notice = `${player.name} confirmed your hello. Waiting for the other person to confirm.`;
      broadcast(room, now);
      return;
    }
    if (message.type === 'move') {
      if (player.action?.kind === 'play' && now < player.action.startedAt + player.action.duration) return;
      player.targetX = message.x;
      player.targetZ = message.z;
      player.action = null;
      return;
    }
    if (now - player.lastActionAt < 600 || (player.action && now < player.action.startedAt + player.action.duration)) {
      return fail(ws, 'action_busy', 'Give your pet a moment to finish.');
    }
    const nearby = friends(room);
    if (message.action === 'play') {
      if (!together(nearby)) return fail(ws, 'friend_too_far', 'Bring both connected pets close together to play.');
      if (now - room.lastPlayAt < 5000) return fail(ws, 'play_cooldown', 'Your pets are catching their breath. Try again in a moment.');
      room.lastPlayAt = now;
      room.bond += 1;
      room.quest.met = true;
      room.quest.played = true;
      rewardPair(room, nearby, 'play');
      for (const friend of nearby) {
        const other = nearby.find(candidate => candidate !== friend);
        friend.yaw = Math.atan2(other.x - friend.x, other.z - friend.z);
        setAction(friend, 'play', now);
      }
      room.notice = 'Your pets played together! Friendship grew.';
    } else {
      setAction(player, message.action, now);
      if (player.accountId && message.action === 'feed') game.store.care(player.accountId, 'feed');
      if (message.action === 'wave' && together(nearby)) {
        room.quest.met = true;
        room.quest.waved = true;
        room.notice = `${player.name} waved hello!`;
        reward(room, player, nearby.find(candidate => candidate !== player), 'greet');
      } else room.notice = `${player.name}'s pet ${message.action === 'feed' ? 'is enjoying a snack' : message.action === 'jump' ? 'jumped for joy' : 'waved'}!`;
    }
    broadcast(room, now);
  }

  wss.on('connection', (ws, _request, quota) => {
    connections.add(ws);
    ws.session = null;
    ws.displaySession = null;
    ws.quota = quota;
    ws.alive = true;
    ws.connectedAt = Date.now();
    ws.bucket = { tokens: 40, at: Date.now() };
    ws.strikes = 0;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => { connections.delete(ws); if (ws.displaySession) ws.displaySession.room.displays.delete(ws); detach(ws); });
    ws.on('message', (data, binary) => {
      if (!consume(ws.bucket, 40, 20)) {
        fail(ws, 'rate_limited', 'Too many updates. Please slow down.');
        if (++ws.strikes >= 5) ws.close(1008, 'Rate limit');
        return;
      }
      let message;
      try { message = binary ? null : parsePlayMessage(JSON.parse(data.toString())); }
      catch { message = null; }
      if (!message) {
        fail(ws, 'invalid_message', 'The message is not a supported playground command.');
        if (++ws.strikes >= 5) ws.close(1008, 'Invalid messages');
        return;
      }
      processMessage(ws, message);
    });
  });

  function reapPlayers(room, now) {
    for (const player of room.players.values()) {
      if (!player.socket && player.disconnectedAt !== null && now - player.disconnectedAt >= rejoinGraceMs) {
        room.players.delete(player.id);
        room.notice = `${player.name} left the playground. Invite a friend to join.`;
      }
    }
  }
  let lastTick = Date.now();
  const tick = setInterval(() => {
    const now = Date.now();
    const distance = 2 * Math.min(0.1, Math.max(0, now - lastTick) / 1000);
    lastTick = now;
    for (const room of rooms.values()) {
      reapPlayers(room, now);
      if (room.interaction?.status === 'pending' && now >= room.interaction.expiresAt) resolveInteraction(room, 'expired', now);
      const connected = friends(room);
      if (connected.length === 0 && now - room.lastActivity >= roomIdleMs) { rooms.delete(room.code); continue; }
      for (const player of connected) {
        if (player.action && now >= player.action.startedAt + player.action.duration) player.action = null;
        const dx = player.targetX - player.x, dz = player.targetZ - player.z;
        const remaining = Math.hypot(dx, dz);
        if (remaining > 0.001) {
          player.yaw = Math.atan2(dx, dz);
          const fraction = Math.min(distance / remaining, 1);
          player.x += dx * fraction;
          player.z += dz * fraction;
        }
      }
      if (!room.quest.met && together(connected)) {
        room.quest.met = true;
        room.notice = 'Your pets met! Wave hello or play together.';
      }
      if (connected.length) broadcast(room, now);
    }
  }, tickMs);
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const ws of connections) {
      if (!ws.alive || (!ws.session && !ws.displaySession && now - ws.connectedAt > 30_000)) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
    for (const [address, quota] of addresses) if (now - Math.max(quota.at, quota.admissions.at) > 120_000) addresses.delete(address);
    for (const [code, grant] of displayGrants) if (grant.expiresAt <= now) displayGrants.delete(code);
  }, heartbeatMs);
  tick.unref();
  heartbeat.unref();
  const nearby = attachNearbyDiscovery(server, reserveNearbyRoom, {
    ...options.nearby, allowedOrigins: options.allowedOrigins,
  });

  return {
    server,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(tick);
      clearInterval(heartbeat);
      await nearby.close();
      for (const ws of connections) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await game.close();
      rooms.clear();
      addresses.clear();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8788);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const database = resolve(process.env.BONDIMALS_DB_PATH || '.bondimals-data/game.sqlite');
  mkdirSync(dirname(database), { recursive: true });
  const app = createPlayServer({ allowedOrigins, database });
  app.server.listen(port, host, () => console.log(`Bondimals playground listening on ${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
