import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PHOTO_VERIFICATION_QUESTS, validateEvidence } from './quest-verification.mjs';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROUTES = new Map([
  ['/glasses/pair', 'POST'], ['/glasses/claim', 'POST'],
  ['/glasses/capture', 'POST'], ['/glasses/command', 'GET'],
  ['/glasses/result', 'POST'], ['/glasses/status', 'POST'], ['/glasses/discard', 'POST'],
]);
const failure = (status, message) => Object.assign(new Error(message), { status });

/** Private, memory-only camera commands/evidence. Never verifies or rewards a quest. */
export function createGlassesCameraBridge({ resolveOwner, writeJson, readJson, cors, now = Date.now,
  pairTtlMs = 5 * 60_000, idleTtlMs = 60 * 60_000, evidenceTtlMs = 5 * 60_000,
  cameraFreshMs = 5_000, captureTimeoutMs = 30_000, maxSessions = 1000,
  maxEvidenceBytes = 64 * 1024 * 1024, maxConcurrentUploads = 4,
} = {}) {
  const owners = new Map(), codes = new Map(), tokens = new Map(), addresses = new Map();
  const ownerQuotas = new WeakMap();
  let evidenceBytes = 0, uploading = 0, closed = false;

  function consume(bucket, capacity, perSecond, at) {
    bucket.remaining = Math.min(capacity, bucket.remaining + Math.max(0, at - bucket.at) * perSecond / 1000);
    bucket.at = at;
    if (bucket.remaining < 1) return false;
    bucket.remaining--;
    return true;
  }
  function rateLimit(address, claim, at) {
    let quota = addresses.get(address);
    if (!quota) {
      if (addresses.size >= 5000) throw failure(503, 'Camera pairing is busy. Please retry shortly.');
      quota = { all: { remaining: 240, at }, claim: { remaining: 10, at }, lastAt: at };
      addresses.set(address, quota);
    }
    quota.lastAt = at;
    if (!consume(quota.all, 240, 20, at) || (claim && !consume(quota.claim, 10, 1 / 6, at))) {
      throw failure(429, 'Please wait before sending more camera requests.');
    }
  }
  function ownerLimit(owner, operation, at) {
    let quota = ownerQuotas.get(owner);
    if (!quota) { quota = {}; ownerQuotas.set(owner, quota); }
    const [capacity, rate] = operation === 'pair' ? [3, 1 / 20] : operation === 'capture' ? [3, 0.1] : [20, 4];
    const bucket = quota[operation] ??= { remaining: capacity, at };
    if (!consume(bucket, capacity, rate, at)) throw failure(429, 'Please wait before repeating this camera action.');
  }
  function clearEvidence(session) {
    evidenceBytes -= session.evidenceBytes;
    session.evidenceBytes = 0;
    session.evidence = null;
    session.evidenceAt = null;
  }
  function revoke(owner) {
    const session = owners.get(owner);
    if (!session) return;
    clearEvidence(session);
    if (session.code) codes.delete(session.code);
    if (session.cameraToken) tokens.delete(session.cameraToken);
    owners.delete(owner);
  }
  function cancel(session) {
    // Completed captures still have a native preview to release. A cancel is
    // scoped to that request so it cannot clear a later capture on the phone.
    if (session.requestId) {
      session.command = { id: randomUUID(), kind: 'cancel', requestId: session.requestId };
    }
  }
  function sweep(at = now()) {
    for (const [owner, session] of owners) {
      if (at - session.lastActivity >= idleTtlMs
        || resolveOwner(session.roomCode, session.playerToken) !== owner
        || (!session.cameraToken && at >= session.expiresAt)) {
        revoke(owner); continue;
      }
      if (session.status === 'capturing' && at - session.captureAt >= captureTimeoutMs) {
        cancel(session);
        session.status = 'error';
        session.error = 'The glasses camera did not finish. Check the camera app and try again.';
      }
      if (session.evidenceAt !== null && at - session.evidenceAt >= evidenceTtlMs) {
        cancel(session);
        clearEvidence(session);
        session.status = 'error';
        session.error = 'This camera preview expired. Capture again to review it.';
      }
    }
    for (const [address, quota] of addresses) if (at - quota.lastAt >= 120_000) addresses.delete(address);
  }
  function authenticateOwner(input, operation, at) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || typeof input.roomCode !== 'string' || !/^[A-Z0-9]{6}$/.test(input.roomCode)
      || typeof input.playerToken !== 'string' || !/^[a-f0-9]{48}$/.test(input.playerToken)) {
      throw failure(401, 'A connected game session is required.');
    }
    const owner = resolveOwner(input.roomCode, input.playerToken);
    if (!owner) throw failure(401, 'Reconnect to the game before using the glasses camera.');
    ownerLimit(owner, operation, at);
    const session = owners.get(owner);
    if (session) session.lastActivity = at;
    return { owner, session };
  }
  function authenticateCamera(request, at) {
    const authorization = request.headers.authorization;
    const token = typeof authorization === 'string' ? /^Bearer ([a-f0-9]{48})$/.exec(authorization)?.[1] : null;
    const session = token ? tokens.get(token) : null;
    if (!session || resolveOwner(session.roomCode, session.playerToken) !== session.owner) {
      throw failure(401, 'Camera pairing expired. Pair again from the connected game.');
    }
    if (!consume(session.quota, 10, 3, at)) throw failure(429, 'Please slow down camera polling.');
    session.lastActivity = at;
    return session;
  }
  function connected(session, at) {
    return Boolean(session?.cameraToken && session.lastPoll !== null && at - session.lastPoll <= cameraFreshMs);
  }
  function status(session, at) {
    if (!session) return { paired: false, connected: false, requestId: null, status: 'idle' };
    return { paired: Boolean(session.cameraToken), connected: connected(session, at),
      requestId: session.requestId, status: session.status,
      ...(session.error ? { error: session.error } : {}), ...(session.evidence ?? {}),
    };
  }

  async function dispatch(path, request, response) {
    let uploadSlot = false;
    try {
      if (closed) throw failure(503, 'The camera bridge is shutting down.');
      if (!cors(request, response)) throw failure(403, 'Camera access is not allowed from this site.');
      if (!ROUTES.has(path)) throw failure(404, 'Camera endpoint not found.');
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      if (request.method !== ROUTES.get(path)) throw failure(405, 'Unsupported camera request method.');
      sweep();
      rateLimit(request.socket.remoteAddress ?? 'unknown', path === '/glasses/claim', now());
      let cameraSession;
      if (path === '/glasses/command' || path === '/glasses/result') cameraSession = authenticateCamera(request, now());
      if (path === '/glasses/command') {
        cameraSession.lastPoll = now();
        return writeJson(response, 200, { command: cameraSession.command });
      }
      if (path === '/glasses/result') {
        if (uploading >= maxConcurrentUploads) throw failure(503, 'Camera uploads are busy. Please retry.');
        uploading++; uploadSlot = true;
      }
      const input = await readJson(request, path === '/glasses/result' ? 5_700_000 : 20_000);
      // Reading a request can span a disconnect, re-pair, expiry or cancellation.
      const at = now();
      sweep(at);
      if (path === '/glasses/claim') {
        const code = typeof input?.code === 'string' ? input.code.trim().toUpperCase() : '';
        const session = /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? codes.get(code) : null;
        if (!session || at >= session.expiresAt) throw failure(401, 'Pairing code expired or already used. Generate a new code in the game.');
        codes.delete(code); session.code = null;
        session.cameraToken = randomBytes(24).toString('hex');
        session.lastActivity = at;
        tokens.set(session.cameraToken, session);
        return writeJson(response, 200, { cameraToken: session.cameraToken });
      }
      if (path === '/glasses/result') {
        if (tokens.get(cameraSession.cameraToken) !== cameraSession) throw failure(401, 'Camera pairing expired. Pair again.');
        const session = cameraSession;
        if (session.status !== 'capturing' || input?.requestId !== session.requestId) {
          throw failure(409, 'This capture was canceled, completed or replaced.');
        }
        if (!['ready', 'error'].includes(input.status)) throw failure(400, 'Invalid camera result status.');
        if (input.status === 'error') {
          clearEvidence(session);
          session.error = typeof input.error === 'string'
            ? input.error.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : '';
          session.error ||= 'The glasses camera could not capture this quest. Please retry.';
          session.status = 'error'; session.command = null;
          return writeJson(response, 200, { ok: true });
        }
        if ((session.kind === 'photo' && (typeof input.photoDataUrl !== 'string' || input.frames !== undefined))
          || (session.kind === 'clip' && (!Array.isArray(input.frames) || input.photoDataUrl !== undefined))) {
          throw failure(400, 'Camera evidence does not match the requested capture type.');
        }
        validateEvidence({ questId: session.questId, photoDataUrl: input.photoDataUrl,
          frames: input.frames, durationSeconds: input.durationSeconds });
        const evidence = session.kind === 'photo' ? { photoDataUrl: input.photoDataUrl }
          : { frames: [...input.frames], durationSeconds: input.durationSeconds };
        const bytes = Buffer.byteLength(JSON.stringify(evidence));
        if (evidenceBytes + bytes > maxEvidenceBytes) throw failure(503, 'Camera preview storage is busy. Discard older previews and retry.');
        clearEvidence(session);
        session.evidence = evidence; session.evidenceAt = at;
        session.evidenceBytes = bytes; evidenceBytes += bytes;
        session.command = null; session.status = 'ready'; session.error = null;
        return writeJson(response, 200, { ok: true });
      }
      const operation = path.slice('/glasses/'.length);
      const { owner, session } = authenticateOwner(input, operation, at);
      if (path === '/glasses/pair') {
        if (!session && owners.size >= maxSessions) throw failure(503, 'Camera pairing is full. Please retry later.');
        revoke(owner);
        let code;
        do { code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''); }
        while (codes.has(code));
        const paired = { owner, roomCode: input.roomCode, playerToken: input.playerToken, code,
          expiresAt: at + pairTtlMs, cameraToken: null, lastActivity: at, lastPoll: null,
          status: 'idle', requestId: null, command: null, captureAt: null, kind: null, questId: null,
          evidence: null, evidenceBytes: 0, evidenceAt: null, error: null, quota: { remaining: 10, at },
        };
        owners.set(owner, paired); codes.set(code, paired);
        return writeJson(response, 200, { code, expiresAt: paired.expiresAt });
      }
      if (path === '/glasses/status') return writeJson(response, 200, status(session, at));
      if (path === '/glasses/discard') {
        if (session) {
          cancel(session); clearEvidence(session);
          session.status = 'idle'; session.requestId = null; session.error = null;
        }
        return writeJson(response, 200, { ok: true });
      }
      if (path === '/glasses/capture') {
        if (!connected(session, at)) throw failure(409, 'Open the paired glasses camera app and keep it connected.');
        if (!['photo', 'clip'].includes(input.kind) || !Object.hasOwn(PHOTO_VERIFICATION_QUESTS, input.questId ?? '')) {
          throw failure(400, 'Choose a valid camera quest and capture type.');
        }
        if (PHOTO_VERIFICATION_QUESTS[input.questId].sequence && input.kind !== 'clip') {
          throw failure(400, 'This quest needs a clip to show the motion.');
        }
        if (session.status === 'capturing') throw failure(409, 'A glasses capture is already in progress.');
        clearEvidence(session);
        session.requestId = randomUUID(); session.status = 'capturing'; session.captureAt = at;
        session.kind = input.kind; session.questId = input.questId; session.error = null;
        session.command = { id: session.requestId, kind: input.kind, questId: input.questId };
        return writeJson(response, 200, { requestId: session.requestId });
      }
    } catch (cause) {
      if (!response.destroyed && !response.writableEnded) writeJson(response, cause.status ?? 400,
        { error: cause instanceof Error ? cause.message : 'The camera request could not be completed.' });
    } finally { if (uploadSlot) uploading--; }
  }
  const cleanup = setInterval(() => sweep(), 15_000);
  cleanup.unref();
  return {
    handle(request, response) {
      const path = request.url?.split('?')[0] ?? '';
      if (!path.startsWith('/glasses/')) return false;
      void dispatch(path, request, response);
      return true;
    },
    revoke,
    close() {
      closed = true; clearInterval(cleanup);
      for (const owner of owners.keys()) revoke(owner);
      addresses.clear();
    },
  };
}
