import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { validHandFrame } from '../shared/hand-protocol.mjs';

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A single private demo room. Optional camera previews are forwarded without recording. */
export function createRelay({ room, publisherToken, viewerToken, now = Date.now }) {
  let publisher = null;
  const viewers = new Set();
  let lastSeq = -1;
  let streamId = null;
  let previewRequested = false;
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.writeHead(request.url === '/health' ? 200 : 404);
    response.end(JSON.stringify(request.url === '/health' ? { ok: true, service: 'bondimals-landmarks' } : { error: 'not found' }));
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 98_304, perMessageDeflate: false });
  const send = (ws, message) => {
    // Drop stale data instead of queueing it behind a slow connection.
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 32_768) ws.send(JSON.stringify(message));
  };
  const broadcast = message => { for (const viewer of viewers) send(viewer, message); };
  const updatePreviewDemand = () => {
    const requested = [...viewers].some(viewer => viewer.preview);
    if (requested === previewRequested) return;
    previewRequested = requested;
    if (publisher) send(publisher, { type: 'preview-demand', enabled: requested });
  };
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
  }, 15_000);
  heartbeat.unref();
  wss.on('connection', ws => {
    ws.alive = true;
    ws.preview = false;
    ws.on('pong', () => { ws.alive = true; });
    let role = null;
    let lastMessageAt = -Infinity;
    const authTimeout = setTimeout(() => ws.close(1008, 'Pairing required'), 5000);
    ws.on('message', (data, binary) => {
      if (binary) { ws.close(1008, 'JSON frames only'); return; }
      let message;
      try { message = JSON.parse(data.toString()); } catch { ws.close(1008, 'Invalid JSON'); return; }
      if (!role) {
        if (message?.type !== 'hello' || message.room !== room || !['publisher', 'viewer'].includes(message.role)
          || !same(message.token, message.role === 'publisher' ? publisherToken : viewerToken)) {
          ws.close(1008, 'Pairing rejected'); return;
        }
        if (message.role === 'publisher' && publisher) { ws.close(1008, 'Camera already paired'); return; }
        if (message.role === 'viewer' && viewers.size >= 8) { ws.close(1008, 'Room full'); return; }
        clearTimeout(authTimeout);
        role = message.role;
        if (role === 'publisher') { publisher = ws; streamId = null; lastSeq = -1; }
        else viewers.add(ws);
        send(ws, { type: 'ready', role, cameraConnected: !!publisher, ...(role === 'publisher' ? { previewRequested } : {}) });
        if (role === 'publisher') broadcast({ type: 'camera', connected: true });
        return;
      }
      if (role === 'viewer' && message?.type === 'preview' && typeof message.enabled === 'boolean') {
        ws.preview = message.enabled; updatePreviewDemand(); return;
      }
      if (role !== 'publisher') { ws.close(1008, 'Viewer cannot publish'); return; }
      if (!validHandFrame(message, now())) return;
      if (streamId && message.streamId !== streamId) { ws.close(1008, 'Reconnect for a new stream'); return; }
      if (message.seq <= lastSeq || now() - lastMessageAt < 40) return;
      streamId = message.streamId;
      lastSeq = message.seq;
      lastMessageAt = now();
      const { preview, ...landmarks } = message;
      for (const viewer of viewers) send(viewer, viewer.preview ? message : landmarks);
    });
    ws.on('close', () => {
      clearTimeout(authTimeout);
      viewers.delete(ws);
      updatePreviewDemand();
      if (publisher === ws) { publisher = null; streamId = null; lastSeq = -1; broadcast({ type: 'camera', connected: false }); }
    });
    ws.on('error', () => {});
  });
  return {
    server,
    close: async () => {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
    },
  };
}
