import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraConnectionError, GlassesCamera, isCameraConnectionError, type CaptureStatus } from './GlassesCamera';
import type { Membership } from '../../../companion-web/src/RoomClient';

const member = (): Membership => ({ roomCode: 'ABCDEF', playerToken: 'a'.repeat(48), playerId: 'one', name: 'Explorer' });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const ready = (requestId: string): CaptureStatus => ({ paired: true, connected: true, status: 'ready', requestId, photoDataUrl: 'data:image/jpeg;base64,/9j/' });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('GlassesCamera session and capture ownership', () => {
  it.each(['wss://game.example/play', 'https://game.example/play'])('preserves HTTPS for %s and sends explicit JSON acceptance', async endpoint => {
    const fetcher = vi.fn().mockResolvedValue(json({ paired: false, connected: false, requestId: null, status: 'idle' }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => endpoint, member);
    await client.status();
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://game.example/glasses/status');
    expect(options.headers.accept).toBe('application/json');
    expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body)).toEqual({ roomCode: 'ABCDEF', playerToken: 'a'.repeat(48) });
  });

  it('coalesces duplicate pairing requests and reuses an unclaimed unexpired code', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    const first = client.pair(), duplicate = client.pair();
    expect(first).toBe(duplicate);
    resolve(json({ code: 'ABCD2345', expiresAt: Date.now() + 60_000 }));
    await first;
    await client.pair();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('binds review and submission to the quest that requested this capture', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ requestId: 'capture-1' }))
      .mockResolvedValueOnce(json(ready('capture-1')))
      .mockResolvedValueOnce(json({ verified: true, reason: 'Hand touching grass.' }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    await client.capture('photo', 'touchGrass');
    const evidence = await client.status();
    expect(evidence.questId).toBe('touchGrass');
    await expect(client.submit('meetFriend', evidence)).rejects.toThrow('different quest');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(client.submit('touchGrass', evidence)).resolves.toMatchObject({ verified: true });
    expect(JSON.parse(fetcher.mock.calls[2]![1].body).questId).toBe('touchGrass');
  });

  it('recovers a server-held clip after the display page is recreated, then waits for explicit submission', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ ...ready('saved-clip'), questId: 'meetFriend', kind: 'clip', frames: ['data:image/jpeg;base64,/9j/'], durationSeconds: 6 }))
      .mockResolvedValueOnce(json({ verified: true, reason: 'Wave visible.' }));
    vi.stubGlobal('fetch', fetcher);
    const reopened = new GlassesCamera(() => 'wss://game.example/play', member);
    const evidence = await reopened.status();
    expect(evidence.questId).toBe('meetFriend');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(reopened.submit('touchGrass', evidence)).rejects.toThrow('different quest');
    await expect(reopened.submit('meetFriend', evidence)).resolves.toMatchObject({ verified: true });
  });

  it('does not recover an unknown quest or replace a newer locally requested capture', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ ...ready('invalid'), questId: 'unknownQuest' }))
      .mockResolvedValueOnce(json({ requestId: 'new' }))
      .mockResolvedValueOnce(json({ ...ready('old'), questId: 'touchGrass' }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    expect((await client.status()).questId).toBeUndefined();
    await client.capture('clip', 'meetFriend');
    const old = await client.status();
    expect(old.questId).toBeUndefined();
    await expect(client.submit('touchGrass', old)).rejects.toThrow('different quest');
  });

  it('recovers a replacement accepted by the server when its HTTP response was lost', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ requestId: 'old' }))
      .mockRejectedValueOnce(new TypeError('Network interrupted'))
      .mockResolvedValueOnce(json({ ...ready('replacement'), questId: 'meetFriend', kind: 'clip' }))
      .mockResolvedValueOnce(json({ verified: true }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    await client.capture('photo', 'touchGrass');
    await expect(client.capture('clip', 'meetFriend')).rejects.toBeInstanceOf(CameraConnectionError);
    const recovered = await client.status();
    expect(recovered.questId).toBe('meetFriend');
    await expect(client.submit('meetFriend', recovered)).resolves.toMatchObject({ verified: true });
  });

  it('cannot restore a status response from before an explicit discard', async () => {
    let finishStatus!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishStatus = resolve; }))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    const stale = client.status();
    await client.discard();
    finishStatus(json({ ...ready('discarded'), questId: 'touchGrass' }));
    const evidence = await stale;
    expect(evidence.questId).toBeUndefined();
    await expect(client.submit('touchGrass', evidence)).rejects.toThrow('different quest');
  });

  it('explicitly replaces an existing cached code when the phone needs pairing recovery', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ code: 'ABCD2345', expiresAt: Date.now() + 60_000 }))
      .mockResolvedValueOnce(json({ code: 'WXYZ6789', expiresAt: Date.now() + 60_000 }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    expect((await client.pair()).code).toBe('ABCD2345');
    expect((await client.pair(true)).code).toBe('WXYZ6789');
    expect((await client.pair()).code).toBe('WXYZ6789');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not submit a ready result for an unknown or replaced request', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ requestId: 'old' }))
      .mockResolvedValueOnce(json({ requestId: 'new' }))
      .mockResolvedValueOnce(json(ready('old')));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    await client.capture('photo', 'touchGrass');
    await client.capture('clip', 'meetFriend');
    const evidence = await client.status();
    expect(evidence.questId).toBeUndefined();
    await expect(client.submit('touchGrass', evidence)).rejects.toThrow('different quest');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('rejects an in-flight response after membership changes', async () => {
    let resolve!: (value: Response) => void;
    let membership = member();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; })));
    const client = new GlassesCamera(() => 'wss://game.example/play', () => membership);
    const request = client.capture('photo', 'touchGrass');
    membership = { ...membership, playerToken: 'b'.repeat(48) };
    resolve(json({ requestId: 'old-player-capture' }));
    await expect(request).rejects.toThrow('session changed');
  });

  it('invalidates old response and old pairing code when the play connection resets', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }))
      .mockResolvedValueOnce(json({ code: 'ABCD5678', expiresAt: Date.now() + 60_000 }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    const old = client.pair();
    client.reset();
    resolve(json({ code: 'ABCD2345', expiresAt: Date.now() + 60_000 }));
    await expect(old).rejects.toThrow('session changed');
    expect((await client.pair()).code).toBe('ABCD5678');
  });

  it('deduplicates an identical capture and rejects conflicting mutations until it completes', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    const first = client.capture('photo', 'touchGrass');
    expect(client.capture('photo', 'touchGrass')).toBe(first);
    await expect(client.capture('clip', 'dapHandshake')).rejects.toThrow('Wait');
    await expect(client.pair()).rejects.toThrow('Wait');
    resolve(json({ requestId: 'one' }));
    await first;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('lets verification finish within the server deadline instead of the shorter control deadline', async () => {
    const timeouts = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn().mockResolvedValueOnce(json({ requestId: 'capture-1' }))
      .mockResolvedValueOnce(json(ready('capture-1')))
      .mockResolvedValueOnce(json({ verified: false, reason: 'No grass visible.' }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    await client.capture('photo', 'touchGrass');
    await client.submit('touchGrass', await client.status());
    expect(timeouts).toHaveBeenLastCalledWith(45_000);
  });

  it.each([
    ['network failure', () => new TypeError('Failed to fetch')],
    ['request timeout', () => new DOMException('The operation timed out.', 'TimeoutError')],
    ['request abort', () => new DOMException('The operation was aborted.', 'AbortError')],
  ])('normalizes %s without automatically repeating a capture', async (_name, failure) => {
    const fetcher = vi.fn().mockRejectedValue(failure());
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    const error = await client.capture('clip', 'meetFriend').catch(error => error);
    expect(isCameraConnectionError(error)).toBe(true);
    expect(error.message).toBe('Connection interrupted while checking your capture. Try again to reconnect.');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['network interruption', () => new TypeError('Failed to fetch')],
    ['body timeout', () => new DOMException('The operation timed out.', 'TimeoutError')],
    ['body abort', () => new DOMException('The operation was aborted.', 'AbortError')],
  ])('preserves capture ownership after a %s while downloading evidence', async (_name, failure) => {
    const broken = json(ready('one'));
    vi.spyOn(broken, 'json').mockRejectedValue(failure());
    const fetcher = vi.fn().mockResolvedValueOnce(json({ requestId: 'one' }))
      .mockResolvedValueOnce(broken)
      .mockResolvedValueOnce(json(ready('one')))
      .mockResolvedValueOnce(json({ verified: true }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    await client.capture('photo', 'touchGrass');
    await expect(client.status()).rejects.toBeInstanceOf(CameraConnectionError);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const evidence = await client.status();
    expect(evidence.questId).toBe('touchGrass');
    await expect(client.submit('touchGrass', evidence)).resolves.toMatchObject({ verified: true });
  });

  it.each([429, 502, 503, 504])('normalizes HTTP %s even when the tunnel returns HTML', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<html>Temporarily unavailable</html>', { status }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    await expect(client.status()).rejects.toBeInstanceOf(CameraConnectionError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 409])('keeps semantic HTTP %s errors nonretryable', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'This request is not allowed.' }, status)));
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    const error = await client.status().catch(error => error);
    expect(isCameraConnectionError(error)).toBe(false);
    expect(error.message).toBe('This request is not allowed.');
  });

  it('does not disguise rejected credentials as transient if their error body is interrupted', async () => {
    const rejected = json({ error: 'Pair again.' }, 401);
    vi.spyOn(rejected, 'json').mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rejected));
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    const error = await client.status().catch(error => error);
    expect(isCameraConnectionError(error)).toBe(false);
  });

  it('keeps malformed successful JSON nonretryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{invalid JSON', { status: 200 })));
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    const error = await client.status().catch(error => error);
    expect(isCameraConnectionError(error)).toBe(false);
    expect(error.message).toContain('unreadable response');
  });

  it('does not offer transport recovery for a request whose game session changed', async () => {
    let reject!: (reason: unknown) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((_resolve, fail) => { reject = fail; }));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    const request = client.status();
    client.reset();
    reject(new TypeError('Failed to fetch'));
    const error = await request.catch(error => error);
    expect(isCameraConnectionError(error)).toBe(false);
    expect(error.message).toContain('session changed');
  });

  it('allows longer evidence downloads and a caller-bounded remaining deadline', async () => {
    const timeouts = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn().mockResolvedValueOnce(json({ requestId: 'one' }))
      .mockResolvedValueOnce(json({ ...ready('one'), frames: Array(12).fill('data:image/jpeg;base64,/9j/'), durationSeconds: 6 }))
      .mockResolvedValueOnce(json(ready('one')));
    vi.stubGlobal('fetch', fetcher);
    const client = new GlassesCamera(() => 'wss://game.example/play', member);
    await client.capture('clip', 'meetFriend');
    expect(timeouts).toHaveBeenLastCalledWith(15_000);
    expect((await client.status()).frames).toHaveLength(12);
    expect(timeouts).toHaveBeenLastCalledWith(45_000);
    await client.status(7_000);
    expect(timeouts).toHaveBeenLastCalledWith(7_000);
  });
});
