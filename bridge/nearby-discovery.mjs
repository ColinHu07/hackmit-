import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import {
  NEARBY_LOCATION_FRESH_MS, NEARBY_MAX_ACCURACY_METERS, NEARBY_MAX_MESSAGE_BYTES,
  NEARBY_RADIUS_METERS, NEARBY_REQUEST_TTL_MS, distanceMeters, parseNearbyMessage,
} from '../shared/nearby-protocol.mjs';

/** Location is transient opt-in presence, never persisted, logged, or broadcast. */
export function attachNearbyDiscovery(server, reserveRoom, options = {}) {
  const radius = options.radiusMeters ?? NEARBY_RADIUS_METERS;
  const freshMs = options.freshMs ?? NEARBY_LOCATION_FRESH_MS;
  const requestTtlMs = options.requestTtlMs ?? NEARBY_REQUEST_TTL_MS;
  const origins = new Set(options.allowedOrigins ?? []);
  const connections = new Map();
  const requests = new Map();
  const addresses = new Map();
  let closing = false;
  const wss = new WebSocketServer({ noServer: true, maxPayload: NEARBY_MAX_MESSAGE_BYTES, perMessageDeflate: false });
  const consume = (bucket, capacity, rate, now = Date.now()) => {
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.at) * rate / 1000);
    bucket.at = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };
  function send(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 128 * 1024) { ws.terminate(); return; }
    ws.send(JSON.stringify(message));
  }
  const fail = (ws, code, message) => send(ws, { type: 'error', code, message });
  const fresh = (ws, now) => ws.location && now - ws.location.timestamp <= freshMs && now - ws.location.receivedAt <= freshMs;
  const eligible = (ws, now) => ws.active && !ws.paired && fresh(ws, now) && ws.location.accuracy <= NEARBY_MAX_ACCURACY_METERS && ws.readyState === WebSocket.OPEN;
  const closeEnough = (a, b, now) => a !== b && eligible(a, now) && eligible(b, now) && distanceMeters(a.location, b.location) <= radius;

  function closeRequest(request, reason) {
    requests.delete(request.id);
    for (const ws of [request.from, request.to]) {
      if (ws.pendingRequest === request.id) ws.pendingRequest = null;
      send(ws, { type: 'request_closed', requestId: request.id, reason });
    }
  }
  function clearPresence(ws, reason) {
    ws.active = false;
    ws.location = null;
    const request = requests.get(ws.pendingRequest);
    if (request) closeRequest(request, reason);
  }
  function reap(now) {
    for (const ws of connections.values()) {
      if (ws.location && !fresh(ws, now)) ws.location = null;
    }
    for (const request of requests.values()) {
      if (request.expiresAt <= now) closeRequest(request, 'The invitation expired.');
      else if (!closeEnough(request.from, request.to, now)) closeRequest(request, 'Nearby availability changed. Try again when both location estimates are fresh.');
    }
  }
  function broadcast(now = Date.now()) {
    reap(now);
    for (const ws of connections.values()) {
      if (!ws.registered) continue;
      const peers = eligible(ws, now) ? [...connections.values()]
        .filter(peer => closeEnough(ws, peer, now))
        .map(peer => ({ peer, distance: distanceMeters(ws.location, peer.location) }))
        .sort((a, b) => a.distance - b.distance || a.peer.id.localeCompare(b.peer.id))
        .slice(0, 8)
        .map(({ peer, distance }) => ({
          id: peer.id, name: peer.name, distanceMeters: Math.round(distance / 5) * 5,
          uncertain: distance + ws.location.accuracy + peer.location.accuracy > radius,
        })) : [];
      const notice = !ws.active ? 'Nearby discovery is paused.'
        : !ws.location ? 'Waiting for a fresh location estimate.'
        : ws.location.accuracy > NEARBY_MAX_ACCURACY_METERS ? 'Your location estimate is too broad. Move outdoors for a more accurate estimate.'
        : peers.length ? 'Approximate nearby pets. Confirm a hello together in person.'
        : `No discoverable pets estimated within ${radius} meters yet.`;
      send(ws, { type: 'nearby', peers, accuracy: ws.location?.accuracy ?? null, notice });
    }
  }

  function processMessage(ws, message) {
    const now = Date.now();
    reap(now);
    if (message.type === 'pause') {
      clearPresence(ws, 'Nearby discovery was paused.');
      broadcast(now);
      return;
    }
    if (message.type === 'discover') {
      if (ws.paired) return fail(ws, 'already_matched', 'This discovery session has already joined a playground.');
      ws.name = message.name;
      ws.registered = true;
      ws.active = true;
      send(ws, { type: 'discovery_ready', selfId: ws.id });
      broadcast(now);
      return;
    }
    if (!ws.active || ws.paired) return fail(ws, 'not_discovering', 'Start nearby discovery before sharing a location or meeting someone.');
    if (message.type === 'location') {
      if (now - message.timestamp > freshMs || message.timestamp - now > 30_000) {
        return fail(ws, 'invalid_location_time', 'The location estimate is too old or has an invalid time.');
      }
      if (message.timestamp <= ws.lastLocationTimestamp) {
        return fail(ws, 'outdated_location', 'A newer location estimate has already been received.');
      }
      ws.lastLocationTimestamp = message.timestamp;
      ws.location = { latitude: message.latitude, longitude: message.longitude, accuracy: message.accuracy, timestamp: message.timestamp, receivedAt: now };
      broadcast(now);
      return;
    }
    if (message.type === 'meet') {
      if (!consume(ws.invites, 5, 0.2, now)) return fail(ws, 'rate_limited', 'Please give people a moment before inviting again.');
      const peer = connections.get(message.peerId);
      if (!peer || !closeEnough(ws, peer, now)) return fail(ws, 'peer_unavailable', 'That pet is no longer nearby with a fresh location estimate.');
      if (ws.pendingRequest || peer.pendingRequest) return fail(ws, 'request_pending', 'One of you already has a pending invitation.');
      const request = { id: randomUUID(), from: ws, to: peer, expiresAt: now + requestTtlMs };
      requests.set(request.id, request);
      ws.pendingRequest = peer.pendingRequest = request.id;
      send(ws, { type: 'meet_sent', requestId: request.id, peerId: peer.id, name: peer.name, expiresAt: request.expiresAt });
      send(peer, { type: 'meet_request', requestId: request.id, peerId: ws.id, name: ws.name, expiresAt: request.expiresAt });
      broadcast(now);
      return;
    }
    const request = requests.get(message.requestId);
    if (!request || (request.to !== ws && request.from !== ws)) return fail(ws, 'request_unavailable', 'That invitation is no longer available.');
    if (!message.accept) {
      closeRequest(request, request.from === ws ? 'The invitation was canceled.' : 'The invitation was declined.');
      broadcast(now);
      return;
    }
    if (request.to !== ws) return fail(ws, 'invalid_response', 'Only the invited person can accept this invitation.');
    if (request.expiresAt <= now || !closeEnough(request.from, request.to, now)) {
      closeRequest(request, 'Nearby availability changed. Please try again.');
      broadcast(now);
      return;
    }
    const memberships = reserveRoom([request.from.name, request.to.name]);
    if (!memberships) {
      closeRequest(request, 'The playground is full. Please try again shortly.');
      return;
    }
    requests.delete(request.id);
    [request.from, request.to].forEach((participant, index) => {
      participant.pendingRequest = null;
      participant.paired = true;
      clearPresence(participant, 'You joined a playground.');
      send(participant, { type: 'matched', ...memberships[index] });
    });
    broadcast(now);
  }

  function upgrade(request, socket, head) {
    if (request.url?.split('?')[0] !== '/nearby') return;
    socket.on('error', () => {});
    const reject = (status, reason) => socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    if (origins.size && !origins.has(request.headers.origin)) return reject(403, 'Forbidden');
    if (closing || connections.size >= (options.maxConnections ?? 200)) return reject(503, 'Unavailable');
    const address = request.socket.remoteAddress ?? 'unknown';
    let quota = addresses.get(address);
    if (!quota) {
      if (addresses.size >= 2000) return reject(503, 'Unavailable');
      quota = { tokens: 60, at: Date.now() };
      addresses.set(address, quota);
    }
    if (!consume(quota, 60, 2)) return reject(429, 'Too Many Requests');
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  }
  server.on('upgrade', upgrade);
  wss.on('connection', ws => {
    Object.assign(ws, {
      id: randomUUID(), name: '', registered: false, active: false, paired: false,
      location: null, lastLocationTimestamp: -Infinity, pendingRequest: null,
      alive: true, connectedAt: Date.now(), strikes: 0,
      bucket: { tokens: 30, at: Date.now() }, invites: { tokens: 5, at: Date.now() },
    });
    connections.set(ws.id, ws);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearPresence(ws, 'The other person stopped sharing nearby presence.');
      connections.delete(ws.id);
      if (!closing) broadcast();
    });
    ws.on('message', (data, binary) => {
      if (!consume(ws.bucket, 30, 5)) {
        fail(ws, 'rate_limited', 'Too many discovery updates. Please slow down.');
        if (++ws.strikes >= 5) ws.close(1008, 'Rate limit');
        return;
      }
      let message;
      try { message = binary ? null : parseNearbyMessage(JSON.parse(data.toString())); } catch { message = null; }
      if (!message) {
        fail(ws, 'invalid_message', 'The message is not a supported discovery command.');
        if (++ws.strikes >= 5) ws.close(1008, 'Invalid messages');
        return;
      }
      processMessage(ws, message);
    });
  });
  const tick = setInterval(broadcast, options.tickMs ?? 1000);
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const ws of connections.values()) {
      if (!ws.alive || (!ws.registered && now - ws.connectedAt > 30_000)) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
    for (const [address, quota] of addresses) if (now - quota.at > 120_000) addresses.delete(address);
  }, options.heartbeatMs ?? 20_000);
  tick.unref();
  heartbeat.unref();
  return {
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(tick);
      clearInterval(heartbeat);
      server.off('upgrade', upgrade);
      for (const ws of connections.values()) { clearPresence(ws, 'The server is stopping.'); ws.terminate(); }
      await new Promise(resolve => wss.close(resolve));
      requests.clear();
      connections.clear();
      addresses.clear();
    },
  };
}
