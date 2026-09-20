import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { attachNearbyDiscovery } from './nearby-discovery.mjs';
import { createStaticWebHandler } from './static-web.mjs';
import { createQuestPhotoVerifier, PHOTO_VERIFICATION_QUESTS, validateEvidence } from './quest-verification.mjs';
import {
  PLAY_ACTION_DURATION, PLAY_FRIEND_DISTANCE, PLAY_MAX_MESSAGE_BYTES,
  PLAY_MAX_PLAYERS, PLAY_ROOM_ALPHABET, PLAY_TICK_MS, PLAY_WORLD_LIMIT, parsePlayMessage,
} from '../shared/play-protocol.mjs';

/** Ephemeral, server-authoritative four-person playground; no account or camera data. */
export function createPlayServer(options = {}) {
  const tickMs = options.tickMs ?? PLAY_TICK_MS;
  const rejoinGraceMs = options.rejoinGraceMs ?? 30_000;
  const roomIdleMs = options.roomIdleMs ?? 10 * 60_000;
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  const maxRooms = options.maxRooms ?? 500;
  const maxConnections = options.maxConnections ?? 1200;
  const serveWeb = options.webRoot ? createStaticWebHandler(options.webRoot) : null;
  const origins = new Set(options.allowedOrigins ?? []);
  const rooms = new Map();
  let publicLobbyCode = null;
  const connections = new Set();
  const addresses = new Map();
  const photoVerifier = options.photoVerifier ?? createQuestPhotoVerifier(options.meta);
  let closing = false;

  function writeJson(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
  }
  function cors(request, response) {
    const origin = request.headers.origin;
    if (origins.size && !origins.has(origin)) return false;
    if (!origin) return true;
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
    response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type');
    return true;
  }
  async function readJson(request, limit = 5_700_000) {
    const declared = Number(request.headers['content-length'] ?? 0);
    if (!Number.isFinite(declared) || declared > limit) throw new Error('Photo upload is too large.');
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > limit) throw new Error('Photo upload is too large.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('The photo request was unreadable.'); }
  }
  async function verifyQuestPhoto(request, response) {
    if (!cors(request, response)) return writeJson(response, 403, { error: 'Photo verification is not allowed from this site.' });
    let input;
    try { input = await readJson(request); }
    catch (cause) { return writeJson(response, 400, { error: cause instanceof Error ? cause.message : 'The photo request was unreadable.' }); }
    const { roomCode, playerToken, questId, photoDataUrl, frames, durationSeconds } = input ?? {};
    if (typeof roomCode !== 'string' || typeof playerToken !== 'string' || typeof questId !== 'string'
      || !/^[A-Z0-9]{6}$/.test(roomCode) || !/^[a-f0-9]{48}$/.test(playerToken) || !Object.hasOwn(PHOTO_VERIFICATION_QUESTS, questId)) {
      return writeJson(response, 400, { error: 'The photo request is invalid.' });
    }
    const room = rooms.get(roomCode);
    const player = room && [...room.players.values()].find(candidate => sameToken(candidate.token, playerToken));
    if (!room || !player) return writeJson(response, 401, { error: 'This quest session has expired.' });
    if (!(questId === 'dapHandshake' ? player.quests.dapHandshakeReady : player.quests[questId])) return writeJson(response, 409, { error: 'Finish the in-game part of this quest before sending a photo.' });
    try { validateEvidence({ questId, photoDataUrl, frames, durationSeconds }); }
    catch (cause) { return writeJson(response, 400, { error: cause.message }); }
    const group = player.evidenceGroups[questId] ?? [player.id];
    const participants = group.map(id => room.players.get(id));
    if (participants.some(peer => !peer?.socket || !(questId === 'dapHandshake' ? peer.quests.dapHandshakeReady : peer.quests[questId]))) return writeJson(response, 409, { error: 'Keep the original quest participants connected while submitting evidence.' });
    if (participants.every(peer => peer.quests.photoVerification[questId] === 'approved')) return writeJson(response, 200, { verified: true, reason: 'This quest evidence was already approved.' });
    if (participants.some(peer => peer.quests.photoVerification[questId] === 'pending')) return writeJson(response, 409, { error: 'Your group already has evidence being checked.' });
    const now = Date.now();
    const attempts = player.verificationAttempts[questId] ??= { tokens: 3, at: now };
    if (!consume(attempts, 3, 0.05, now)) return writeJson(response, 429, { error: 'Please wait a moment before submitting more evidence.' });
    const previous = participants.map(peer => peer.quests.photoVerification[questId] ?? 'required');
    participants.forEach((peer, index) => { if (previous[index] !== 'approved') peer.quests.photoVerification[questId] = 'pending'; });
    broadcast(room);
    try {
      const result = await photoVerifier.verify({ questId, ...(photoDataUrl ? { photoDataUrl } : { frames, durationSeconds }), participantCount: participants.length });
      // An old request cannot approve a new room membership or a different quest group.
      if (rooms.get(room.code) !== room || participants.some(peer => room.players.get(peer.id) !== peer || !peer.socket)) {
        participants.forEach((peer, index) => { peer.quests.photoVerification[questId] = previous[index]; });
        return writeJson(response, 409, { error: 'The group changed during verification. Reconnect and submit again.' });
      }
      participants.forEach((peer, index) => { peer.quests.photoVerification[questId] = previous[index] === 'approved' || result.verified ? 'approved' : 'rejected'; });
      if (result.verified && questId === 'dapHandshake') {
        participants.forEach(peer => { peer.quests.dapHandshake = true; });
        room.bond += 1;
      }
      room.notice = result.verified ? `Camera evidence approved for ${PHOTO_VERIFICATION_QUESTS[questId].label}.` : result.reason;
      broadcast(room);
      return writeJson(response, 200, result);
    } catch (cause) {
      participants.forEach((peer, index) => { peer.quests.photoVerification[questId] = previous[index]; });
      broadcast(room);
      return writeJson(response, photoVerifier.configured ? 502 : 503, { error: cause instanceof Error ? cause.message : 'Verification is unavailable.' });
    }
  }

  const server = createServer((request, response) => {
    const path = request.url?.split('?')[0];
    if (path === '/verify' && request.method === 'OPTIONS') {
      if (!cors(request, response)) return writeJson(response, 403, { error: 'Photo verification is not allowed from this site.' });
      response.writeHead(204); response.end(); return;
    }
    if (path === '/verify' && request.method === 'POST') { void verifyQuestPhoto(request, response); return; }
    if (request.method === 'GET' && path === '/health') {
      let players = 0;
      let activeRooms = 0;
      for (const room of rooms.values()) {
        const active = [...room.players.values()].filter(player => player.socket?.readyState === WebSocket.OPEN).length;
        players += active;
        if (active) activeRooms++;
      }
      writeJson(response, 200, {
        ok: true, service: 'bondimals-play', rooms: rooms.size, activeRooms,
        players, connections: connections.size,
        maxPlayersPerRoom: PLAY_MAX_PLAYERS, maxRooms, maxConnections,
      });
    } else if (serveWeb) {
      void serveWeb(request, response);
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
      roomCode: room.code, serverTime: now, worldLimit: PLAY_WORLD_LIMIT,
      players: [...room.players.values()].sort((a, b) => a.slot - b.slot).map(player => ({
        id: player.id, name: player.name, slot: player.slot,
        x: player.x, z: player.z, targetX: player.targetX, targetZ: player.targetZ,
        yaw: player.yaw, connected: Boolean(player.socket), action: player.action,
      })),
      bond: room.bond,
      quests: Object.fromEntries([...room.players.values()].map(player => [player.id, { ...player.quests }])),
      squad: { ready: [...room.squadReady], minPlayers: 3 },
      dap: { pending: [...room.dapRequests.entries()].map(([from, offer]) => ({ from, to: offer.to, expiresAt: offer.expiresAt })) },
      raid: {
        state: room.raid?.state ?? 'waiting', ready: [...room.raidReady],
        participants: room.raid?.participants ?? [], minPlayers: 3,
        health: room.raid?.health ?? 0, maxHealth: room.raid?.maxHealth ?? 0,
        endsAt: room.raid?.endsAt ?? null,
      },
      quest: { ...room.quest }, notice: room.notice,
      ...(room.code === publicLobbyCode ? { publicLobby: true } : {}),
      ...(room.encounter ? { encounter: {
        kind: 'nearby', dapConfirmed: [...room.encounter.dapConfirmed], dapComplete: room.encounter.dapComplete,
      } } : {}),
    };
  }
  function broadcast(room, now = Date.now()) {
    const message = { type: 'snapshot', snapshot: snapshot(room, now) };
    for (const player of room.players.values()) send(player.socket, message);
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
    clearDapsFor(room, player.id);
    room.squadReady.clear(); room.raidReady.clear();
    if (intentional) {
      room.players.delete(player.id);
      room.squadReady.delete(player.id);
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
      code, players: new Map(), bond: 0, quest: { met: false, waved: false, played: false }, squadReady: new Set(), raidReady: new Set(), raid: null, dapRequests: new Map(),
      notice: 'Invite a friend with your room code.', lastActivity: Date.now(), lastPlayAt: 0,
    };
    rooms.set(code, room);
    return room;
  }
  function welcome(ws, room, player) {
    player.socket = ws;
    player.disconnectedAt = null;
    ws.session = { room, player };
    room.lastActivity = Date.now();
    send(ws, { type: 'welcome', roomCode: room.code, playerId: player.id, playerToken: player.token, snapshot: snapshot(room) });
    broadcast(room);
  }
  function makePlayer(room, name) {
    const slot = [0, 1, 2, 3].find(candidate => ![...room.players.values()].some(player => player.slot === candidate));
    const starts = [[-1.2, 0], [1.2, 0], [0, -1.2], [0, 1.2]];
    const [x, z] = starts[slot];
    const player = {
      id: randomUUID(), token: randomBytes(24).toString('hex'), name, slot,
      x, z, targetX: x, targetZ: z, yaw: Math.atan2(-x, -z),
      action: null, socket: null, disconnectedAt: null, lastActionAt: 0,
      evidenceGroups: {}, verificationAttempts: {}, movedForGrass: 0, quests: { touchGrass: false, meetFriend: false, squadCircle: false, raidBoss: false, dapHandshake: false, dapHandshakeReady: false, photoVerification: {} },
    };
    room.players.set(player.id, player);
    return player;
  }
  function addPlayer(ws, room, name) {
    const player = makePlayer(room, name);
    room.squadReady.clear(); room.raidReady.clear();
    if (room.players.size === 2) room.notice = `${name} joined the pen! Duo quests are now live.`;
    else if (room.players.size >= 3) room.notice = `${name} joined the pen! Squad quest and raid party are ready.`;
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
  const neighboringPlayers = (player, players) => players.filter(candidate => candidate !== player && Math.hypot(player.x - candidate.x, player.z - candidate.z) <= PLAY_FRIEND_DISTANCE);
  function clearDapsFor(room, playerId) {
    room.dapRequests.delete(playerId);
    for (const [from, offer] of room.dapRequests) if (offer.to === playerId) room.dapRequests.delete(from);
  }
  function reapDaps(room, now) {
    for (const [from, offer] of room.dapRequests) {
      const requester = room.players.get(from);
      const partner = room.players.get(offer.to);
      if (offer.expiresAt <= now || !requester?.socket || !partner?.socket) room.dapRequests.delete(from);
    }
  }
  const clustered = players => players.length >= 3 && players.every(player => players.every(other => player === other || Math.hypot(player.x - other.x, player.z - other.z) <= PLAY_FRIEND_DISTANCE));
  function completeSquadQuest(room, players, now) {
    if (players.length < 3) return false;
    if (!players.every(player => room.squadReady.has(player.id))) return false;
    if (!clustered(players)) return false;
    const newlyCompleted = players.filter(player => !player.quests.squadCircle);
    for (const player of newlyCompleted) {
      player.quests.squadCircle = true;
      player.evidenceGroups.squadCircle = players.map(peer => peer.id);
      player.quests.photoVerification.squadCircle = 'required';
    }
    room.squadReady.clear();
    room.bond += 3;
    room.notice = 'Squad gathered! Record a group cheer to verify the real-world circle.';
    broadcast(room, now);
    return true;
  }
  function setAction(player, kind, now) {
    player.action = { id: randomUUID(), kind, startedAt: now, duration: PLAY_ACTION_DURATION[kind] };
    player.lastActionAt = now;
    player.targetX = player.x;
    player.targetZ = player.z;
  }
  function startRaid(room, players, now) {
    const maxHealth = 8 + players.length * 2;
    room.raid = { state: 'active', participants: players.map(player => player.id), health: maxHealth, maxHealth, endsAt: now + 45_000 };
    room.raidReady.clear();
    room.notice = 'Mossback wakes! Use Wave, Treat, Jump, or Play together to calm the tangled guardian.';
  }
  function failRaid(room, message) {
    room.raid = null;
    room.raidReady.clear();
    room.notice = message;
  }
  function damageRaid(room, player, action, now) {
    const raid = room.raid;
    if (raid?.state !== 'active' || !raid.participants.includes(player.id)) return false;
    const damage = action === 'play' ? 2 : 1;
    raid.health = Math.max(0, raid.health - damage);
    if (raid.health === 0) {
      raid.state = 'defeated';
      raid.endsAt = null;
      for (const id of raid.participants) {
        const participant = room.players.get(id);
        if (participant) participant.quests.raidBoss = true;
      }
      room.bond += 5;
      room.notice = 'Mossback is calm! Every raider earned a Mossback Leaf and five shared moments.';
    } else room.notice = `${player.name}'s ${action === 'feed' ? 'treat' : action} calmed Mossback. ${raid.health}/${raid.maxHealth} calm points remain.`;
    return true;
  }
  function processMessage(ws, message) {
    const now = Date.now();
    if (message.type === 'create' || message.type === 'join' || message.type === 'lobby') {
      if (ws.session) return fail(ws, 'already_joined', 'Leave your current room before joining another.');
      if (!consume(ws.quota.admissions, 60, 0.5, now)) return fail(ws, 'rate_limited', 'Too many room requests. Try again shortly.');
      if (message.type === 'create') {
        if (rooms.size >= maxRooms) return fail(ws, 'server_full', 'The playground is full. Try again later.');
        addPlayer(ws, createRoom(), message.name);
        return;
      }
      let room;
      if (message.type === 'lobby') {
        room = rooms.get(publicLobbyCode);
        if (!room) {
          if (rooms.size >= maxRooms) return fail(ws, 'server_full', 'The playground is full. Try again later.');
          room = createRoom();
          publicLobbyCode = room.code;
          room.notice = 'Friends using this server appear here automatically.';
        }
      } else room = rooms.get(message.roomCode);
      if (!room) return fail(ws, 'room_not_found', 'That room does not exist or has expired.');
      // Reap expired reservations before admission, even between simulation ticks.
      reapPlayers(room, now);
      if (message.playerToken !== undefined) {
        const player = [...room.players.values()].find(candidate => sameToken(candidate.token, message.playerToken));
        if (!player) return fail(ws, 'invalid_token', 'This saved session has expired or belongs to a different room.');
        const oldSocket = closePlayer(player);
        if (oldSocket) oldSocket.close(4001, 'Session resumed on another connection');
        player.name = message.name;
        room.notice = room.encounter ? `${player.name} joined the meetup.` : `${player.name} is back!`;
        welcome(ws, room, player);
        return;
      }
      if (room.encounter) return fail(ws, 'private_room', 'This nearby playground requires your invitation session.');
      if (room.players.size >= PLAY_MAX_PLAYERS) return fail(ws, 'room_full', room.code === publicLobbyCode
        ? 'This server’s shared playground is full (4 players). Try again when someone leaves.'
        : 'This pen already has four players. Start another pen for a new squad.');
      addPlayer(ws, room, message.name);
      return;
    }
    if (message.type === 'leave') { detach(ws, true); return; }
    if (!ws.session) return fail(ws, 'not_joined', 'Create or join a room first.');
    const { room, player } = ws.session;
    room.lastActivity = now;
    if (message.type === 'ready_squad_quest') {
      const connected = friends(room);
      if (connected.every(peer => peer.quests.squadCircle)) return fail(ws, 'squad_complete', 'This whole squad has already gathered.');
      if (connected.length < 3) return fail(ws, 'squad_locked', 'The squad quest unlocks when three pets are in the pen.');
      if (!clustered(connected)) return fail(ws, 'squad_too_far', 'Bring the whole squad close together before you ready up.');
      room.squadReady.add(player.id);
      if (!completeSquadQuest(room, connected, now)) {
        room.notice = `${player.name} is ready. Waiting for the rest of the squad.`;
        broadcast(room, now);
      }
      return;
    }
    if (message.type === 'ready_raid') {
      const connected = friends(room);
      if (player.quests.raidBoss) return fail(ws, 'raid_complete', 'You already calmed Mossback in this pen.');
      if (room.raid?.state === 'active') return fail(ws, 'raid_active', 'Mossback is already awake. Help your squad calm it.');
      if (room.raid?.state === 'defeated') return fail(ws, 'raid_defeated', 'Mossback is already calm in this pen.');
      if (connected.length < 3) return fail(ws, 'raid_locked', 'The raid needs three connected pets in the pen.');
      if (!connected.every(candidate => candidate.quests.squadCircle)) return fail(ws, 'raid_needs_squad', 'Complete the squad circle together before calling Mossback.');
      if (!clustered(connected)) return fail(ws, 'raid_too_far', 'Gather the whole squad close together before calling Mossback.');
      room.raidReady.add(player.id);
      if (connected.every(candidate => room.raidReady.has(candidate.id))) startRaid(room, connected, now);
      else room.notice = `${player.name} is ready to call Mossback. Waiting for the squad.`;
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
      } else room.notice = `${player.name} confirmed your hello. Waiting for the other person to confirm.`;
      broadcast(room, now);
      return;
    }
    if (message.type === 'heading') {
      if (!player.action && Math.hypot(player.targetX - player.x, player.targetZ - player.z) < 0.05) player.yaw = message.yaw;
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
    const connectedPlayers = friends(room);
    reapDaps(room, now);
    if (message.action === 'dap') {
      if (player.quests.dapHandshakeReady && !player.quests.dapHandshake) return fail(ws, 'dap_needs_camera', 'Record and submit your handshake clip to finish this quest.');
      if (player.quests.dapHandshake) return fail(ws, 'dap_complete', 'You already completed the Dap up quest in this pen.');
      const partner = neighboringPlayers(player, connectedPlayers)
        .filter(candidate => !candidate.quests.dapHandshakeReady)
        .sort((a, b) => {
          const aOffered = room.dapRequests.get(a.id)?.to === player.id ? 1 : 0;
          const bOffered = room.dapRequests.get(b.id)?.to === player.id ? 1 : 0;
          return bOffered - aOffered || Math.hypot(player.x - a.x, player.z - a.z) - Math.hypot(player.x - b.x, player.z - b.z);
        })[0];
      if (!partner) return fail(ws, 'dap_too_far', 'Bring a pet who still needs this quest close together to dap up.');
      const reciprocal = room.dapRequests.get(partner.id);
      if (reciprocal?.to === player.id && reciprocal.expiresAt > now) {
        room.dapRequests.delete(partner.id);
        room.dapRequests.delete(player.id);
        player.quests.dapHandshakeReady = true;
        partner.quests.dapHandshakeReady = true;
        for (const peer of [player, partner]) {
          peer.evidenceGroups.dapHandshake = [player.id, partner.id];
          peer.quests.photoVerification.dapHandshake = 'required';
        }
        player.yaw = Math.atan2(partner.x - player.x, partner.z - player.z);
        partner.yaw = Math.atan2(player.x - partner.x, player.z - partner.z);
        setAction(player, 'dap', now);
        setAction(partner, 'dap', now);
        room.notice = `${player.name} and ${partner.name} dapped up! Record your real handshake to verify the duo quest.`;
      } else {
        room.dapRequests.set(player.id, { to: partner.id, expiresAt: now + 8_000 });
        room.notice = `${player.name} offered a dap to ${partner.name}. They have a few seconds to dap back.`;
      }
      broadcast(room, now);
      return;
    }
    if (message.action === 'play') {
      const playmates = [player, ...connectedPlayers.filter(friend => friend !== player && Math.hypot(player.x - friend.x, player.z - friend.z) <= PLAY_FRIEND_DISTANCE)];
      if (playmates.length < 2) return fail(ws, 'friend_too_far', 'Bring another connected pet close together to play.');
      if (now - room.lastPlayAt < 5000) return fail(ws, 'play_cooldown', 'Your pets are catching their breath. Try again in a moment.');
      room.lastPlayAt = now;
      room.bond += 1;
      room.quest.met = true;
      room.quest.played = true;
      for (const friend of playmates) {
        const other = playmates.find(candidate => candidate !== friend);
        friend.yaw = Math.atan2(other.x - friend.x, other.z - friend.z);
        setAction(friend, 'play', now);
      }
      if (!damageRaid(room, player, message.action, now)) room.notice = 'Your pets played together! Friendship grew.';
    } else {
      setAction(player, message.action, now);
      if (message.action === 'wave' && neighboringPlayers(player, connectedPlayers).length) {
        room.quest.met = true;
        room.quest.waved = true;
        room.notice = `${player.name} waved hello!`;
      } else room.notice = `${player.name}'s pet ${message.action === 'feed' ? 'is enjoying a snack' : message.action === 'jump' ? 'jumped for joy' : 'waved'}!`;
      damageRaid(room, player, message.action, now);
    }
    broadcast(room, now);
  }

  wss.on('connection', (ws, _request, quota) => {
    connections.add(ws);
    ws.session = null;
    ws.quota = quota;
    ws.alive = true;
    ws.connectedAt = Date.now();
    ws.bucket = { tokens: 40, at: Date.now() };
    ws.strikes = 0;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => { connections.delete(ws); detach(ws); });
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
        room.squadReady.delete(player.id);
        clearDapsFor(room, player.id);
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
      reapDaps(room, now);
      const connected = friends(room);
      if (connected.length === 0 && now - room.lastActivity >= roomIdleMs) { rooms.delete(room.code); continue; }
      if (room.raid?.state === 'active') {
        const participants = room.raid.participants.map(id => room.players.get(id));
        if (participants.some(player => !player?.socket)) failRaid(room, 'Mossback settled back into the meadow when a raider left. Gather again to retry.');
        else if (room.raid.endsAt !== null && now >= room.raid.endsAt) failRaid(room, 'Mossback wandered back to its lanterns. The squad can gather and try again.');
      }
      for (const player of connected) {
        if (player.action && now >= player.action.startedAt + player.action.duration) player.action = null;
        const dx = player.targetX - player.x, dz = player.targetZ - player.z;
        const remaining = Math.hypot(dx, dz);
        if (remaining > 0.001) {
          player.yaw = Math.atan2(dx, dz);
          const fraction = Math.min(distance / remaining, 1);
          player.x += dx * fraction;
          player.z += dz * fraction;
          player.movedForGrass += Math.hypot(dx * fraction, dz * fraction);
          if (!player.quests.touchGrass && player.movedForGrass >= 1) {
            player.quests.touchGrass = true;
            player.quests.photoVerification.touchGrass = 'required';
            room.notice = `${player.name} touched grass! Add a photo to verify this quest.`;
          }
        }
      }
      for (const player of connected) {
        if (neighboringPlayers(player, connected).length) {
          if (!player.quests.meetFriend) {
            const partner = neighboringPlayers(player, connected)[0];
            player.evidenceGroups.meetFriend = [player.id, partner.id];
            player.quests.photoVerification.meetFriend = 'required';
            room.notice = `${player.name} met another pet. Capture your real hello to finish the quest.`;
          }
          player.quests.meetFriend = true;
          room.quest.met = true;
        }
      }
      if (connected.length) broadcast(room, now);
    }
  }, tickMs);
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const ws of connections) {
      if (!ws.alive || (!ws.session && now - ws.connectedAt > 30_000)) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
    for (const [address, quota] of addresses) if (now - Math.max(quota.at, quota.admissions.at) > 120_000) addresses.delete(address);
  }, heartbeatMs);
  tick.unref();
  heartbeat.unref();
  const nearbyService = attachNearbyDiscovery(server, reserveNearbyRoom, {
    ...options.nearby, allowedOrigins: options.allowedOrigins,
  });

  return {
    server,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(tick);
      clearInterval(heartbeat);
      await nearbyService.close();
      for (const ws of connections) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      rooms.clear();
      addresses.clear();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8788);
  const webRoot = process.env.WEB_ROOT || (process.argv.includes('--web') ? fileURLToPath(new URL('../companion-web/dist/', import.meta.url)) : undefined);
  const host = process.env.HOST || (webRoot ? '0.0.0.0' : '127.0.0.1');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const app = createPlayServer({ allowedOrigins, webRoot });
  app.server.listen(port, host, () => console.log(`Bondimals ${webRoot ? 'web game and playground' : 'playground'} listening on http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
