import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassesCamera, type CaptureStatus } from './GlassesCamera';
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
});
