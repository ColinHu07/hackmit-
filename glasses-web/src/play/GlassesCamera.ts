import type { EvidenceQuestId } from '../../../shared/play-protocol';
import type { Membership } from '../../../companion-web/src/RoomClient';

export interface CaptureStatus {
  paired: boolean;
  /** The phone bridge is polling; this does not prove the glasses camera is live. */
  connected: boolean;
  /** A fresh heartbeat reports actual glasses frames, not just a paired phone. */
  cameraReady?: boolean;
  /** Fresh phone connection can start an on-demand capture without holding the display. */
  captureAvailable?: boolean;
  cameraState?: 'ready' | 'starting' | 'permission' | 'paused' | 'error' | 'idle';
  cameraMessage?: string;
  status: 'idle' | 'capturing' | 'ready' | 'error';
  requestId: string | null;
  questId?: EvidenceQuestId;
  kind?: 'photo' | 'clip';
  captureAt?: number;
  error?: string;
  photoDataUrl?: string;
  frames?: string[];
  durationSeconds?: number;
  previewDataUrl?: string;
  previewAt?: number;
  sequence?: number;
  elapsedSeconds?: number;
}
interface Pairing { code: string; expiresAt: number }

/** A temporary transport failure that a caller may retry with the same session. */
export class CameraConnectionError extends Error {
  constructor() {
    super('Connection interrupted while checking your capture. Try again to reconnect.');
    this.name = 'CameraConnectionError';
  }
}

export function isCameraConnectionError(error: unknown): error is CameraConnectionError {
  return error instanceof CameraConnectionError;
}

function interruptedConnection(error: unknown): boolean {
  return error instanceof TypeError || (error !== null && typeof error === 'object'
    && 'name' in error && ['TypeError', 'TimeoutError', 'AbortError'].includes(String(error.name)));
}

/** Camera commands use the current game membership without replacing its socket. */
export class GlassesCamera {
  private pending: { key: string; promise: Promise<unknown> } | null = null;
  private pairing: { session: string; value: Pairing } | null = null;
  private captures = new Map<string, { session: string; questId: EvidenceQuestId }>();
  private generation = 0;
  private captureRevision = 0;

  constructor(private readonly endpoint: () => string, private readonly membership: () => Membership | null) {}

  get sessionKey(): string {
    const member = this.membership();
    return member ? `${this.generation}|${this.endpoint()}|${member.roomCode}|${member.playerToken}` : '';
  }

  reset(): void { this.generation++; this.captureRevision++; this.pairing = null; this.captures.clear(); this.pending = null; }

  get origin(): string {
    const url = new URL(this.endpoint());
    if (url.protocol === 'wss:') url.protocol = 'https:';
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use the game server’s HTTPS address.');
    return url.origin;
  }

  private async request<T>(path: string, extra: object = {}, timeoutMs = 15_000): Promise<T> {
    const member = this.membership();
    const session = this.sessionKey;
    if (!member) throw new Error('Join the playground first.');
    const currentSession = () => {
      if (this.sessionKey !== session) throw new Error('Your game session changed. Capture again in this playground.');
    };
    const url = new URL(path, this.origin);
    const options: RequestInit = {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...extra, roomCode: member.roomCode, playerToken: member.playerToken }),
      signal: AbortSignal.timeout(timeoutMs), cache: 'no-store', redirect: 'error',
    };
    let response: Response;
    try { response = await fetch(url, options); }
    catch (error) {
      currentSession();
      if (interruptedConnection(error)) throw new CameraConnectionError();
      throw error;
    }
    currentSession();
    // Tunnel and rate-limit responses may contain HTML rather than our JSON.
    if ([429, 502, 503, 504].includes(response.status)) throw new CameraConnectionError();
    let result;
    try { result = await response.json(); }
    catch (error) {
      currentSession();
      // Body downloads share the request deadline. Preserve transport failures
      // without treating malformed successful JSON or rejected credentials as transient.
      if (response.ok && interruptedConnection(error)) throw new CameraConnectionError();
      throw new Error('Camera bridge returned an unreadable response. Check the game server address.');
    }
    currentSession();
    if (!response.ok) throw new Error(result?.error || 'Camera bridge unavailable.');
    if (!result || typeof result !== 'object') throw new Error('Camera bridge returned an invalid response.');
    return result as T;
  }

  private mutate<T>(operation: string, action: () => Promise<T>): Promise<T> {
    const key = `${this.sessionKey}|${operation}`;
    if (this.pending) return this.pending.key === key ? this.pending.promise as Promise<T>
      : Promise.reject(new Error('Wait for the current camera action to finish.'));
    const promise = action().finally(() => { if (this.pending?.promise === promise) this.pending = null; });
    this.pending = { key, promise };
    return promise;
  }

  pair(force = false): Promise<Pairing> {
    if (!force && this.pairing?.session === this.sessionKey && this.pairing.value.expiresAt > Date.now()) return Promise.resolve(this.pairing.value);
    return this.mutate('pair', async () => {
      this.captureRevision++; this.captures.clear();
      const value = await this.request<Pairing>('/glasses/pair');
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(value.code) || !Number.isFinite(value.expiresAt)) throw new Error('The camera pairing code was invalid.');
      this.pairing = { session: this.sessionKey, value };
      this.captures.clear();
      return value;
    });
  }
  async status(timeoutMs = 45_000): Promise<CaptureStatus> {
    const revision = this.captureRevision;
    // A completed clip includes its bounded review frames in this response.
    const state = await this.request<CaptureStatus>('/glasses/status', {}, timeoutMs);
    // A claimed code is one-use; do not show it again after a later disconnect.
    if (state.paired) this.pairing = null;
    if (revision !== this.captureRevision) return { ...state, questId: undefined };
    // A display interruption can destroy the page. Recover only the authenticated
    // server's current request, never a locally replaced request or another quest.
    if (state.requestId && state.questId && ['touchGrass', 'meetFriend', 'dapHandshake', 'squadCircle'].includes(state.questId)
      && ['capturing', 'ready', 'error'].includes(state.status) && this.captures.size === 0 && !this.pending) {
      this.captures.set(state.requestId, { session: this.sessionKey, questId: state.questId });
    }
    const known = state.requestId ? this.captures.get(state.requestId) : null;
    return { ...state, questId: known?.session === this.sessionKey ? known.questId : undefined };
  }
  capture(kind: 'photo' | 'clip', questId: EvidenceQuestId): Promise<{ requestId: string }> {
    return this.mutate(`capture:${kind}:${questId}`, async () => {
      // A lost HTTP response must not leave an older request blocking recovery.
      this.captureRevision++; this.captures.clear();
      const result = await this.request<{ requestId: string }>('/glasses/capture', { kind, questId });
      if (!result.requestId) throw new Error('The camera did not accept this capture. Try again.');
      this.captures.clear();
      this.captures.set(result.requestId, { session: this.sessionKey, questId });
      return result;
    });
  }
  discard(): Promise<unknown> {
    return this.mutate('discard', async () => {
      this.captureRevision++; this.captures.clear();
      const result = await this.request('/glasses/discard');
      this.captures.clear();
      return result;
    });
  }
  submit(questId: EvidenceQuestId, evidence: CaptureStatus): Promise<{ verified: boolean; reason: string }> {
    const known = evidence.requestId ? this.captures.get(evidence.requestId) : null;
    if (evidence.status !== 'ready' || known?.session !== this.sessionKey || known.questId !== questId
      || evidence.questId !== questId || (!evidence.photoDataUrl && !evidence.frames?.length)) {
      return Promise.reject(new Error('This capture belongs to a different quest or game session. Capture again.'));
    }
    return this.mutate(`submit:${evidence.requestId}`, () => this.request('/verify', { questId,
      ...(evidence.photoDataUrl ? { photoDataUrl: evidence.photoDataUrl }
        : { frames: evidence.frames, durationSeconds: evidence.durationSeconds }) }, 45_000));
  }
}
