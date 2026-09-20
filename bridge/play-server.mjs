import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { attachNearbyDiscovery } from './nearby-discovery.mjs';
import { createStaticWebHandler } from './static-web.mjs';
import { createQuestPhotoVerifier, PHOTO_VERIFICATION_QUESTS, validateEvidence } from './quest-verification.mjs';
import { createPetStore } from './pet-store.mjs';
import { createGlassesCameraBridge } from './glasses-camera.mjs';
import { QUEST_REWARD } from '../shared/quest-rewards.mjs';
import {
  PLAY_ACTION_DURATION, PLAY_FRIEND_DISTANCE, PLAY_MAX_MESSAGE_BYTES, PLAY_WORLD_LIMIT,
  PLAY_MAX_PLAYERS, PLAY_ROOM_ALPHABET, PLAY_TICK_MS, parsePlayMessage,
} from '../shared/play-protocol.mjs';

/** Server-authoritative playground with separately authenticated, transient camera previews. */
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
  const petStore = options.petStore ?? createPetStore(options.database ?? ':memory:', options.now);
  const verificationJobs = new Map();
  const activeVerifications = new Set();
  const verificationNow = options.verification?.now ?? Date.now;
  const verificationTimeoutMs = options.verification?.timeoutMs ?? 35_000;
  const verificationTtlMs = options.verification?.resultTtlMs ?? 5 * 60_000;
  const verificationReconnectMs = options.verification?.reconnectGraceMs ?? 2 * 60_000;
  const maxVerificationJobs = options.verification?.maxJobs ?? 1000;
  const maxActiveVerifications = options.verification?.maxConcurrent ?? 4;
  const validSubmissionId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
  let closing = false;

  function writeJson(response, status, body) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
  }
  function cors(request, response) {
    const origin = request.headers.origin;
    if (origins.size && !origins.has(origin)) return false;
    if (!origin) return true;
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type, authorization');
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
  function sweepVerifications() {
    const now = verificationNow();
    for (const [key, job] of verificationJobs) {
      if (job.status !== 'pending' && (now - job.finishedAt >= verificationTtlMs
        || rooms.get(job.room.code) !== job.room || job.room.players.get(job.owner.id) !== job.owner)) verificationJobs.delete(key);
    }
  }
  function verificationStatus(job) {
    return { submissionId: job.id, questId: job.questId, status: job.status, ...job.result };
  }
  function currentVerification(owner, captureRequestId) {
    sweepVerifications();
    let latest;
    for (const job of verificationJobs.values()) if (job.owner === owner && job.captureRequestId === captureRequestId) latest = job;
    return latest ? verificationStatus(latest) : null;
  }
  function hasRetainedVerification(player, now) {
    if ([...activeVerifications].some(attempt => attempt.asynchronous && attempt.participants.includes(player))) return true;
    if (player.disconnectedAt === null || now - player.disconnectedAt >= verificationReconnectMs) return false;
    return [...verificationJobs.values()].some(job => job.owner === player && job.status !== 'pending'
      && verificationNow() - job.finishedAt < verificationTtlMs);
  }
  async function verificationLookup(request, response) {
    if (!cors(request, response)) return writeJson(response, 403, { error: 'Quest verification is not allowed from this site.' });
    let input;
    try { input = await readJson(request, 20_000); }
    catch (cause) { return writeJson(response, 400, { error: cause.message }); }
    const { roomCode, playerToken, questId, submissionId } = input ?? {};
    if (typeof roomCode !== 'string' || !/^[A-Z0-9]{6}$/.test(roomCode)
      || typeof playerToken !== 'string' || !/^[a-f0-9]{48}$/.test(playerToken)
      || !validSubmissionId(submissionId) || typeof questId !== 'string' || !Object.hasOwn(PHOTO_VERIFICATION_QUESTS, questId)) {
      return writeJson(response, 400, { error: 'The verification status request is invalid.' });
    }
    const room = rooms.get(roomCode);
    const player = room && [...room.players.values()].find(candidate => sameToken(candidate.token, playerToken));
    if (!player || !player.socket) return writeJson(response, 401, { error: 'Reconnect to the game to check this submission.' });
    const at = Date.now();
    const quota = player.verificationStatusQuota ??= { tokens: 20, at };
    if (!consume(quota, 20, 4, at)) return writeJson(response, 429, { error: 'Please wait before checking this submission again.' });
    sweepVerifications();
    const job = verificationJobs.get(`${player.id}:${submissionId}`);
    if (!job || job.owner !== player || job.questId !== questId) return writeJson(response, 404, { error: 'This submission was not found or has expired.' });
    return writeJson(response, job.status === 'pending' ? 202 : 200, verificationStatus(job));
  }
  async function verifyQuestPhoto(request, response) {
    if (!cors(request, response)) return writeJson(response, 403, { error: 'Photo verification is not allowed from this site.' });
    let input;
    try { input = await readJson(request); }
    catch (cause) { return writeJson(response, 400, { error: cause instanceof Error ? cause.message : 'The photo request was unreadable.' }); }
    const { roomCode, playerToken, questId, submissionId, captureRequestId } = input ?? {};
    let { photoDataUrl, frames, durationSeconds } = input ?? {};
    if (typeof roomCode !== 'string' || typeof playerToken !== 'string' || typeof questId !== 'string'
      || !/^[A-Z0-9]{6}$/.test(roomCode) || !/^[a-f0-9]{48}$/.test(playerToken) || !Object.hasOwn(PHOTO_VERIFICATION_QUESTS, questId)) {
      return writeJson(response, 400, { error: 'The photo request is invalid.' });
    }
    const room = rooms.get(roomCode);
    const player = room && [...room.players.values()].find(candidate => sameToken(candidate.token, playerToken));
    if (!room || !player) return writeJson(response, 401, { error: 'This quest session has expired.' });
    if (!player.socket) return writeJson(response, 409, { error: 'Reconnect to the pen before submitting evidence.' });
    const asynchronous = submissionId !== undefined;
    sweepVerifications();
    if (asynchronous) {
      if (!validSubmissionId(submissionId) || !validSubmissionId(captureRequestId)
        || photoDataUrl !== undefined || frames !== undefined || durationSeconds !== undefined) {
        return writeJson(response, 400, { error: 'Submit the saved capture with a valid submission ID.' });
      }
      const existing = verificationJobs.get(`${player.id}:${submissionId}`);
      if (existing) {
        if (existing.owner !== player || existing.questId !== questId || existing.captureRequestId !== captureRequestId) {
          return writeJson(response, 409, { error: 'This submission ID already belongs to a different capture or quest.' });
        }
        return writeJson(response, existing.status === 'pending' ? 202 : 200, verificationStatus(existing));
      }
      if (verificationJobs.size >= maxVerificationJobs) return writeJson(response, 503, { error: 'Quest submission storage is busy. Please retry shortly.' });
      const saved = glassesCamera.readyEvidence(player, captureRequestId, questId);
      if (!saved) return writeJson(response, 409, { error: 'This saved capture is unavailable or belongs to a different quest. Capture again.' });
      ({ photoDataUrl, frames, durationSeconds } = saved);
    } else if (captureRequestId !== undefined) return writeJson(response, 400, { error: 'A saved capture requires a submission ID.' });
    try { validateEvidence({ questId, photoDataUrl, frames, durationSeconds }); }
    catch (cause) { return writeJson(response, 400, { error: cause.message }); }
    const remaining = petStore.questCooldown(player.token, questId);
    if (remaining > 0) return writeJson(response, 409, { error: `Quest ready again in ${Math.ceil(remaining / 1000)}s.`, retryAfterMs: remaining });
    const minimum = PHOTO_VERIFICATION_QUESTS[questId].minPeople;
    const connected = [...room.players.values()].filter(peer => peer.socket);
    if (connected.length < minimum) return writeJson(response, 409, { error: `Keep at least ${minimum} players connected in this pen while submitting evidence.` });
    // Freeze the submission group, not a prior movement/action group. A duo
    // uses the submitter and one connected partner; a squad uses the full pen.
    const others = connected.filter(peer => peer.id !== player.id).sort((a, b) => petStore.questCooldown(a.token, questId) - petStore.questCooldown(b.token, questId) || a.slot - b.slot);
    const participants = minimum === 1 ? [player] : minimum === 2 ? [player, others[0]] : [player, ...others];
    const groupCooldown = Math.max(...participants.map(peer => petStore.questCooldown(peer.token, questId)));
    if (groupCooldown > 0) return writeJson(response, 409, { error: `Your group can repeat this quest in ${Math.ceil(groupCooldown / 1000)}s.`, retryAfterMs: groupCooldown });
    if (participants.some(peer => peer.quests.photoVerification[questId] === 'pending')) return writeJson(response, 409, { error: 'Your group already has evidence being checked.' });
    if (activeVerifications.size >= maxActiveVerifications) return writeJson(response, 503, { error: 'Quest grading is busy. Please retry shortly.' });
    const now = Date.now();
    const attempts = player.verificationAttempts[questId] ??= { tokens: 3, at: now };
    if (!consume(attempts, 3, 0.05, now)) return writeJson(response, 429, { error: 'Please wait a moment before submitting more evidence.' });
    const previous = participants.map(peer => peer.quests.photoVerification[questId] ?? 'required');
    const job = asynchronous ? { id: submissionId, captureRequestId, owner: player, room, questId,
      status: 'pending', result: {}, finishedAt: null } : null;
    if (job) verificationJobs.set(`${player.id}:${submissionId}`, job);
    participants.forEach(peer => { peer.quests.photoVerification[questId] = 'pending'; });
    broadcast(room);
    const attempt = { participants, asynchronous, controller: new AbortController() };
    activeVerifications.add(attempt);
    const grade = async () => {
      let timer;
      try {
        const deadline = new Promise((_, reject) => {
          const fail = () => reject(new Error(closing ? 'The game server is restarting. Please retry.' : 'Quest grading timed out. Please retry.'));
          attempt.controller.signal.addEventListener('abort', fail, { once: true });
          timer = setTimeout(() => attempt.controller.abort(), verificationTimeoutMs);
          timer.unref();
        });
        const result = await Promise.race([deadline, photoVerifier.verify({ questId,
          ...(photoDataUrl ? { photoDataUrl } : { frames, durationSeconds }), participantCount: participants.length },
        { signal: attempt.controller.signal })]);
        // An old request cannot approve a new room membership or a different quest group.
        if (closing || rooms.get(room.code) !== room || participants.some(peer => room.players.get(peer.id) !== peer || (!asynchronous && !peer.socket))) {
          throw Object.assign(new Error('The group changed during verification. Reconnect and submit again.'), { status: 409 });
        }
        const rewards = result.verified ? petStore.completeQuest(participants.map(peer => peer.token), questId) : [];
        participants.forEach(peer => { peer.quests.photoVerification[questId] = result.verified ? 'approved' : 'rejected'; });
        if (result.verified) {
          participants.forEach(peer => {
            peer.quests[questId] = true;
            if (questId === 'dapHandshake') peer.quests.dapHandshakeReady = true;
            peer.evidenceGroups[questId] = participants.map(member => member.id);
          });
          if (questId === 'dapHandshake') room.bond += 1;
        }
        room.notice = result.verified ? `Quest complete! Each pet earned +${QUEST_REWARD.happiness} happiness, +${QUEST_REWARD.berries} berries and +${QUEST_REWARD.points} points.` : result.reason;
        broadcast(room);
        return { status: 200, body: { ...result, ...(result.verified ? { reward: rewards[0] } : {}) } };
      } catch (cause) {
        participants.forEach((peer, index) => { peer.quests.photoVerification[questId] = previous[index]; });
        broadcast(room);
        return { status: cause?.status ?? (cause?.code === 'quest_cooldown' ? 409 : photoVerifier.configured ? 502 : 503),
          body: { error: cause instanceof Error ? cause.message : 'Verification is unavailable.', ...(cause?.retryAfterMs ? { retryAfterMs: cause.retryAfterMs } : {}) } };
      } finally {
        clearTimeout(timer);
        activeVerifications.delete(attempt);
      }
    };
    const completion = grade();
    if (job) {
      void completion.then(result => {
        job.status = result.status === 200 ? 'complete' : 'error';
        job.result = result.body;
        job.finishedAt = verificationNow();
      });
      return writeJson(response, 202, verificationStatus(job));
    }
    const result = await completion;
    return writeJson(response, result.status, result.body);
  }

  const glassesCamera = createGlassesCameraBridge({
    ...options.glassesCamera, now: options.glassesCamera?.now ?? options.now ?? Date.now,
    writeJson, readJson,
    getVerificationStatus: currentVerification,
    // Native DAT requests have no browser Origin; browser calls retain the allowlist.
    cors: (request, response) => !request.headers.origin || cors(request, response),
    resolveOwner(roomCode, playerToken) {
      const room = rooms.get(roomCode);
      const player = room && [...room.players.values()].find(candidate => sameToken(candidate.token, playerToken));
      return player ?? null;
    },
    isOwnerConnected: player => player.socket?.readyState === WebSocket.OPEN,
  });
  const server = createServer((request, response) => {
    if (glassesCamera.handle(request, response)) return;
    const path = request.url?.split('?')[0];
    if (path === '/api/admin/pet' && request.method === 'OPTIONS') {
      if (!cors(request, response)) return writeJson(response, 403, { error: 'Origin not allowed.' });
      response.writeHead(204); response.end(); return;
    }
    if (path === '/api/admin/pet' && request.method === 'POST') {
      void (async () => {
        try {
          if (!cors(request, response)) return writeJson(response, 403, { error: 'Origin not allowed.' });
          const input = await readJson(request, 20_000);
          if (typeof input?.playerToken !== 'string' || !/^[a-f0-9]{48}$/.test(input.playerToken)) return writeJson(response, 401, { error: 'Valid player token required.' });
          const room = rooms.get(input.roomCode);
          const player = room && [...room.players.values()].find(peer => sameToken(peer.token, input.playerToken));
          if (!player?.socket) return writeJson(response, 401, { error: 'Connect your pet before using admin controls.' });
          if (Object.values(player.quests.photoVerification).includes('pending')) return writeJson(response, 409, { error: 'Wait for quest grading to finish before changing your pet.' });
          const profile = petStore.adminUpdate(player.token, input.changes);
          broadcast(room);
          writeJson(response, 200, profile);
        } catch (cause) { writeJson(response, 400, { error: cause.message }); }
      })();
      return;
    }
    if (path === '/api/pet' && request.method === 'GET') {
      const url = new URL(request.url, 'http://localhost');
      const token = url.searchParams.get('playerToken');
      if (!token || !/^[a-f0-9]{48}$/.test(token)) return writeJson(response, 401, { error: 'Valid player token required.' });
      const profile = petStore.profile(token);
      return profile ? writeJson(response, 200, profile) : writeJson(response, 404, { error: 'Pet profile not found.' });
    }
    if (path === '/api/inventory/feed' && request.method === 'POST') {
      void (async () => {
        try {
          if (!cors(request, response)) return writeJson(response, 403, { error: 'Inventory access is not allowed from this site.' });
          const input = await readJson(request, 20_000);
          return writeJson(response, 200, petStore.feed(input?.playerToken, input?.food));
        } catch (cause) { return writeJson(response, cause.code === 'food_empty' ? 409 : cause.code === 'treat_cooldown' ? 429 : 400, { error: cause.message, ...(cause.retryAfterMs ? { retryAfterMs: cause.retryAfterMs } : {}) }); }
      })();
      return;
    }
    if (['/verify', '/verify/status'].includes(path) && request.method === 'OPTIONS') {
      if (!cors(request, response)) return writeJson(response, 403, { error: 'Photo verification is not allowed from this site.' });
      response.writeHead(204); response.end(); return;
    }
    if (path === '/verify' && request.method === 'POST') { void verifyQuestPhoto(request, response); return; }
    if (path === '/verify/status' && request.method === 'POST') { void verificationLookup(request, response); return; }
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
        survival: petStore.profile(player.token),
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
  function closePlayer(player, preserveCamera = false) {
    if (preserveCamera) glassesCamera.disconnect(player);
    else glassesCamera.revoke(player);
    player.headingLocked = false;
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
    closePlayer(player, !intentional);
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
    glassesCamera.resume(player);
    room.lastActivity = Date.now();
    send(ws, { type: 'welcome', roomCode: room.code, playerId: player.id, playerToken: player.token, snapshot: snapshot(room) });
    broadcast(room);
  }
  function makePlayer(room, name, savedToken) {
    const slot = [0, 1, 2, 3].find(candidate => ![...room.players.values()].some(player => player.slot === candidate));
    const starts = [[-1.2, 0], [1.2, 0], [0, -1.2], [0, 1.2]];
    const [x, z] = starts[slot];
    const player = {
      id: randomUUID(), token: savedToken ?? randomBytes(24).toString('hex'), name, slot,
      x, z, targetX: x, targetZ: z, yaw: Math.atan2(-x, -z), headingLocked: false,
      action: null, socket: null, disconnectedAt: null, lastActionAt: 0,
      evidenceGroups: {}, verificationAttempts: {}, movedForGrass: 0, quests: { touchGrass: false, meetFriend: false, squadCircle: false, raidBoss: false, dapHandshake: false, dapHandshakeReady: false, photoVerification: {} },
    };
    petStore.ensure(player.token, name);
    room.players.set(player.id, player);
    return player;
  }
  function addPlayer(ws, room, name, savedToken) {
    const player = makePlayer(room, name, savedToken);
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
  function awardAction(player, action) {
    const points = { wave: 1, feed: 4, jump: 1, play: 3, dap: 2 }[action] ?? 0;
    if (points) petStore.award(player.token, `action:${player.id}:${randomUUID()}`, points, `action_${action}`);
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
        if (!player) {
          // The public room is ephemeral, but a saved pet and its food are not.
          if (message.type === 'lobby'
            && ![...rooms.values()].some(other => [...other.players.values()].some(peer => sameToken(peer.token, message.playerToken)))
            && petStore.profile(message.playerToken)) {
            if (room.players.size >= PLAY_MAX_PLAYERS) return fail(ws, 'room_full', 'The shared playground is full. Try again when someone leaves.');
            addPlayer(ws, room, message.name, message.playerToken);
            return;
          }
          return fail(ws, 'invalid_token', 'This saved session has expired or belongs to a different room.');
        }
        // A display reload can arrive before its old TCP socket closes. The
        // same token may recover only its current explicit capture/review;
        // an ordinary active replacement still revokes an idle camera binding.
        const oldSocket = closePlayer(player, player.socket?.readyState !== WebSocket.OPEN
          || glassesCamera.hasRecoverableCapture(player));
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
      if (message.lock !== undefined) {
        player.headingLocked = message.lock;
        player.yaw = message.yaw;
      } else if (!player.action && Math.hypot(player.targetX - player.x, player.targetZ - player.z) < 0.05) player.yaw = message.yaw;
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
      if (playmates.some(friend => friend.action?.kind === 'play' && now < friend.action.startedAt + friend.action.duration)) {
        return fail(ws, 'action_busy', 'Let your friends finish their dance first.');
      }
      room.lastPlayAt = now;
      room.bond += 1;
      room.quest.met = true;
      room.quest.played = true;
      for (const friend of playmates) {
        setAction(friend, 'play', now);
      }
      playmates.forEach(peer => awardAction(peer, 'play'));
      if (!damageRaid(room, player, message.action, now)) room.notice = 'Your pets played together! Friendship grew.';
    } else {
      if (message.action === 'feed') {
        try { petStore.feed(player.token, 'berry'); }
        catch (cause) { return fail(ws, cause.code ?? 'feed_failed', cause.message); }
      }
      setAction(player, message.action, now);
      awardAction(player, message.action);
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
      // Capture and grading can outlast a display disconnect. Only an already
      // authorized request/review extends this exact player's rejoin window.
      if (!player.socket && player.disconnectedAt !== null && now - player.disconnectedAt >= rejoinGraceMs
        && !glassesCamera.hasRetainedCapture(player) && !hasRetainedVerification(player, now)) {
        glassesCamera.revoke(player);
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
          if (!player.headingLocked) player.yaw = Math.atan2(dx, dz);
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
    // Release expired result metadata and its room/player references even when
    // nobody makes another submission or status request.
    sweepVerifications();
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
      for (const attempt of activeVerifications) attempt.controller.abort();
      verificationJobs.clear();
      glassesCamera.close();
      clearInterval(tick);
      clearInterval(heartbeat);
      await nearbyService.close();
      for (const ws of connections) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      rooms.clear();
      addresses.clear();
      if (!options.petStore) petStore.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8788);
  const webRoot = process.env.WEB_ROOT || (process.argv.includes('--web') ? fileURLToPath(new URL('../companion-web/dist/', import.meta.url)) : undefined);
  const host = process.env.HOST || (webRoot ? '0.0.0.0' : '127.0.0.1');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const database = resolve(process.env.BONDIMALS_DB_PATH || '.bondimals-data/game.sqlite');
  mkdirSync(dirname(database), { recursive: true });
  const app = createPlayServer({ allowedOrigins, webRoot, database });
  app.server.listen(port, host, () => console.log(`Kith ${webRoot ? 'web game and playground' : 'playground'} listening on http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
