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
  verification?: VerificationStatus;
}
interface Pairing { code: string; expiresAt: number }

export interface VerificationStatus {
  submissionId: string;
  questId: EvidenceQuestId;
  status: 'pending' | 'complete' | 'error';
  verified?: boolean;
  reason?: string;
  error?: string;
  retryAfterMs?: number;
  reward?: unknown;
}
export interface VerificationResult {
  submissionId: string;
  questId: EvidenceQuestId;
  verified: boolean;
  reason: string;
  reward?: unknown;
}
export interface SubmissionOptions {
  onProgress?: (state: 'pending' | 'reconnecting') => void;
  canRead?: () => boolean;
  isCurrent?: () => boolean;
  budgetMs?: number;
}
interface SubmissionRecord {
  session: string;
  captureRequestId: string;
  questId: EvidenceQuestId;
  submissionId: string;
  state?: VerificationStatus;
}
const submissionIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function verificationState(value: VerificationStatus, questId: EvidenceQuestId, submissionId?: string): VerificationStatus {
  if (!value || !submissionIdPattern.test(value.submissionId) || value.questId !== questId
    || (submissionId !== undefined && value.submissionId !== submissionId)
    || !['pending', 'complete', 'error'].includes(value.status)
    || (value.status === 'complete' && (typeof value.verified !== 'boolean' || typeof value.reason !== 'string'))
    || (value.status === 'error' && typeof value.error !== 'string')) {
    throw new Error('The quest check returned an invalid response. Reconnect and check this quest again.');
  }
  return value;
}
class CameraResponseError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** A temporary transport failure that a caller may retry with the same session. */
export class CameraConnectionError extends Error {
  constructor(message = 'Connection interrupted while checking your capture. Try again to reconnect.') {
    super(message);
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
  private submissions = new Map<string, SubmissionRecord>();
  private generation = 0;
  private captureRevision = 0;

  constructor(private readonly endpoint: () => string, private readonly membership: () => Membership | null) {}

  get sessionKey(): string {
    const member = this.membership();
    return member ? `${this.generation}|${this.endpoint()}|${member.roomCode}|${member.playerToken}` : '';
  }

  reset(): void { this.generation++; this.captureRevision++; this.pairing = null; this.captures.clear(); this.submissions.clear(); this.pending = null; }

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
    const connectionError = () => new CameraConnectionError(path.startsWith('/verify')
      ? 'Connection interrupted while checking your quest. Return to this quest to check the result.' : undefined);
    const options: RequestInit = {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...extra, roomCode: member.roomCode, playerToken: member.playerToken }),
      signal: AbortSignal.timeout(timeoutMs), cache: 'no-store', redirect: 'error',
    };
    let response: Response;
    try { response = await fetch(url, options); }
    catch (error) {
      currentSession();
      if (interruptedConnection(error)) throw connectionError();
      throw error;
    }
    currentSession();
    // Tunnel and rate-limit responses may contain HTML rather than our JSON.
    if ([408, 429, 500, 502, 503, 504].includes(response.status)) throw connectionError();
    let result;
    try { result = await response.json(); }
    catch (error) {
      currentSession();
      // Body downloads share the request deadline. Preserve transport failures
      // without treating malformed successful JSON or rejected credentials as transient.
      if (response.ok && interruptedConnection(error)) throw connectionError();
      throw new Error('Camera bridge returned an unreadable response. Check the game server address.');
    }
    currentSession();
    if (!response.ok) throw new CameraResponseError(result?.error || 'Camera bridge unavailable.', response.status);
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
      this.captureRevision++; this.captures.clear(); this.submissions.clear();
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
    if (revision !== this.captureRevision) return { ...state, questId: undefined, verification: undefined };
    // A display interruption can destroy the page. Recover only the authenticated
    // server's current request, never a locally replaced request or another quest.
    if (state.requestId && state.questId && ['touchGrass', 'meetFriend', 'dapHandshake', 'squadCircle'].includes(state.questId)
      && ['capturing', 'ready', 'error'].includes(state.status) && this.captures.size === 0 && !this.pending) {
      this.captures.set(state.requestId, { session: this.sessionKey, questId: state.questId });
    }
    const known = state.requestId ? this.captures.get(state.requestId) : null;
    const questId = known?.session === this.sessionKey ? known.questId : undefined;
    let verification: VerificationStatus | undefined;
    if (questId && state.requestId && state.verification) {
      const value = verificationState(state.verification, questId);
      const existing = this.submissions.get(state.requestId);
      // A status response begun before a manual retry cannot replace its new ID.
      if (!existing || existing.submissionId === value.submissionId) {
        const record = existing ?? { session: this.sessionKey, captureRequestId: state.requestId,
          questId, submissionId: value.submissionId };
        record.state = value; this.submissions.set(state.requestId, record);
        verification = value;
      }
    }
    return { ...state, questId, verification };
  }
  capture(kind: 'photo' | 'clip', questId: EvidenceQuestId): Promise<{ requestId: string }> {
    return this.mutate(`capture:${kind}:${questId}`, async () => {
      // A lost HTTP response must not leave an older request blocking recovery.
      this.captureRevision++; this.captures.clear(); this.submissions.clear();
      const result = await this.request<{ requestId: string }>('/glasses/capture', { kind, questId });
      if (!result.requestId) throw new Error('The camera did not accept this capture. Try again.');
      this.captures.clear();
      this.captures.set(result.requestId, { session: this.sessionKey, questId });
      return result;
    });
  }
  discard(): Promise<unknown> {
    return this.mutate('discard', async () => {
      this.captureRevision++; this.captures.clear(); this.submissions.clear();
      const result = await this.request('/glasses/discard');
      this.captures.clear();
      return result;
    });
  }
  submit(questId: EvidenceQuestId, evidence: CaptureStatus, options: SubmissionOptions = {}): Promise<VerificationResult> {
    const known = evidence.requestId ? this.captures.get(evidence.requestId) : null;
    if (evidence.status !== 'ready' || known?.session !== this.sessionKey || known.questId !== questId
      || evidence.questId !== questId || (!evidence.photoDataUrl && !evidence.frames?.length)) {
      return Promise.reject(new Error('This capture belongs to a different quest or game session. Capture again.'));
    }
    return this.mutate(`submit:${evidence.requestId}`, async () => {
      let record = this.submissions.get(evidence.requestId!);
      const existing = record && record.session === this.sessionKey && record.state?.status !== 'error';
      if (!existing) {
        record = { session: this.sessionKey, captureRequestId: evidence.requestId!, questId, submissionId: crypto.randomUUID() };
        this.submissions.set(evidence.requestId!, record);
      }
      // The stable ID survives a lost acknowledgement or a polling deadline.
      // Only a new explicit Submit after a terminal error creates another ID.
      return this.waitForSubmission(record!, options, !existing, true);
    });
  }

  resumeSubmission(verification: VerificationStatus, options: SubmissionOptions = {}): Promise<VerificationResult> {
    const record = [...this.submissions.values()].find(candidate => candidate.session === this.sessionKey
      && candidate.submissionId === verification.submissionId && candidate.questId === verification.questId);
    if (!record) return Promise.reject(new Error('This quest check belongs to another capture or game session.'));
    return this.mutate(`submit:${record.captureRequestId}`, () => this.waitForSubmission(record, options, false, false));
  }

  private async waitForSubmission(record: SubmissionRecord, options: SubmissionOptions, send: boolean,
    mayResend: boolean): Promise<VerificationResult> {
    const deadline = Date.now() + (options.budgetMs ?? 90_000);
    const assertCurrent = () => {
      if (record.session !== this.sessionKey || this.submissions.get(record.captureRequestId) !== record
        || options.isCurrent?.() === false) throw new Error('Return to this quest to check its submission.');
    };
    while (true) {
      assertCurrent();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new CameraConnectionError('Connection interrupted while retrieving the Muse result. Reopen this quest or select Submit again to reconnect.');
      let progress: 'pending' | 'reconnecting' = 'reconnecting';
      if (options.canRead?.() !== false) {
        try {
          const value = await this.request<VerificationStatus>(send ? '/verify' : '/verify/status', {
            questId: record.questId, submissionId: record.submissionId,
            ...(send ? { captureRequestId: record.captureRequestId } : {}),
          }, Math.min(15_000, remaining));
          assertCurrent();
          const state = verificationState(value, record.questId, record.submissionId);
          record.state = state;
          send = false;
          if (state.status === 'complete') return { submissionId: state.submissionId, questId: state.questId,
            verified: state.verified!, reason: state.reason!, ...(state.reward !== undefined ? { reward: state.reward } : {}) };
          if (state.status === 'error') throw new Error(state.error);
          progress = 'pending';
        } catch (error) {
          assertCurrent();
          if (!send && mayResend && !record.state && error instanceof CameraResponseError && error.status === 404) {
            // An unacknowledged request may never have reached the server. Its
            // same-ID retry is safe because the server deduplicates the job.
            send = true;
          } else if (isCameraConnectionError(error)) {
            // Check for an accepted job before considering any same-ID resend.
            send = false;
          } else throw error;
        }
      }
      assertCurrent();
      options.onProgress?.(progress);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(1500, deadline - Date.now()))));
    }
  }
}
