import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createStore } from './store.mjs';

const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
};
const readBody = async request => {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 16_384) { const error = new Error('Request body is too large.'); error.status = 413; throw error; }
  }
  try {
    const value = text ? JSON.parse(text) : {};
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Expected a JSON object.');
    return value;
  }
  catch { const error = new Error('Invalid JSON.'); error.status = 400; throw error; }
};

export function createServer({ database = ':memory:', now, origin } = {}) {
  const store = createStore(database, now);
  const allowedOrigins = new Set(Array.isArray(origin) ? origin : origin ? [origin] : []);
  const sockets = new Map();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname;
      const method = request.method;
      if (request.headers.origin && (!allowedOrigins.size || allowedOrigins.has(request.headers.origin))) {
        response.setHeader('access-control-allow-origin', allowedOrigins.size ? request.headers.origin : '*');
        response.setHeader('access-control-allow-headers', 'authorization, content-type');
        response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
        response.setHeader('vary', 'Origin');
      }
      if (method === 'OPTIONS') return json(response, 204, {});
      if (method === 'GET' && path === '/health') return json(response, 200, { ok: true });
      if (method === 'POST' && path === '/api/v1/players') return json(response, 201, store.createPlayer((await readBody(request)).name));
      const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '')?.[1];
      const actor = store.authenticate(token);
      if (!actor) return json(response, 401, { error: 'Valid bearer token required.' });
      if (method === 'GET' && path === '/api/v1/me') return json(response, 200, store.getProfile(actor.id));
      if (method === 'GET' && path === '/api/v1/me/friends') return json(response, 200, { friends: store.friendships(actor.id) });
      if (method === 'POST' && path === '/api/v1/me/pet/actions') return json(response, 200, store.care(actor.id, (await readBody(request)).action));
      if (method === 'GET' && path === '/api/v1/rooms') return json(response, 200, { rooms: store.listRooms(actor.id) });
      if (method === 'POST' && path === '/api/v1/rooms') return json(response, 201, store.createRoom(actor.id));
      if (method === 'POST' && path === '/api/v1/rooms/join') {
        const room = store.joinRoom(actor.id, (await readBody(request)).inviteCode);
        if (room.event) broadcast(room.roomId, room.event);
        return json(response, 200, room);
      }
      const roomRoute = /^\/api\/v1\/rooms\/([a-f0-9-]+)(?:\/(events|interactions))?$/.exec(path);
      if (roomRoute) {
        const [, roomId, resource] = roomRoute;
        if (method === 'GET' && !resource) return json(response, 200, store.getRoom(roomId, actor.id));
        if (method === 'GET' && resource === 'events') {
          const after = Number(url.searchParams.get('after') ?? 0);
          if (!Number.isSafeInteger(after) || after < 0) return json(response, 400, { error: 'Invalid event cursor.' });
          return json(response, 200, { events: store.listEvents(roomId, actor.id, after) });
        }
        if (method === 'POST' && resource === 'interactions') {
          const body = await readBody(request);
          const result = store.interact(roomId, actor.id, body.targetId, body.kind, body.requestId);
          if (result.event) broadcast(roomId, result.event);
          return json(response, 200, result);
        }
      }
      return json(response, 404, { error: 'Route not found.' });
    } catch (error) {
      return json(response, error.status ?? 500, { error: error.status ? error.message : 'Internal server error.' });
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  function broadcast(roomId, event) {
    for (const socket of sockets.get(roomId) ?? []) if (socket.readyState === 1) socket.send(JSON.stringify(event));
  }
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/api/v1/live' || (allowedOrigins.size && !allowedOrigins.has(request.headers.origin))) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, client => {
      let subscribed;
      const timeout = setTimeout(() => client.close(1008, 'Authenticate first.'), 5000);
      client.once('message', raw => {
        clearTimeout(timeout);
        try {
          const { token, roomId } = JSON.parse(raw.toString());
          const actor = store.authenticate(token);
          if (!actor) throw new Error('Unauthorized.');
          store.getRoom(roomId, actor.id);
          subscribed = roomId;
          if (!sockets.has(roomId)) sockets.set(roomId, new Set());
          sockets.get(roomId).add(client);
          client.send(JSON.stringify({ type: 'ready', roomId }));
        } catch { client.close(1008, 'Unauthorized room subscription.'); }
      });
      client.on('close', () => { clearTimeout(timeout); if (subscribed) sockets.get(subscribed)?.delete(client); });
    });
  });
  return { server, store, broadcast, close: () => new Promise(resolveClose => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    if (server.listening) server.close(() => { store.close(); resolveClose(); });
    else { store.close(); resolveClose(); }
  }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const database = resolve(process.env.BONDIMALS_DB_PATH || '.bondimals-data/game.sqlite');
  mkdirSync(dirname(database), { recursive: true });
  const port = Number(process.env.BONDIMALS_SERVER_PORT || 8790);
  const host = process.env.BONDIMALS_BIND || '127.0.0.1';
  const app = createServer({ database, origin: process.env.BONDIMALS_WEB_ORIGIN });
  app.server.listen(port, host, () => console.log(`Bondimals game server listening on http://${host}:${port}`));
}
