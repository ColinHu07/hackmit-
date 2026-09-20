import { describe, expect, it, vi } from 'vitest';
import { CameraConnectionError } from './GlassesCamera';
import { recoverCapture } from './CaptureRecovery';

describe('capture recovery after the glasses display returns', () => {
  it('retries a dropped status request and retrieves the same recording without mutation', async () => {
    const clip = { requestId: 'same-recording', status: 'ready' };
    const read = vi.fn().mockRejectedValueOnce(new CameraConnectionError()).mockResolvedValueOnce(clip);
    const onRetry = vi.fn();
    await expect(recoverCapture(read, { isCurrent: () => true, onRetry, wait: async () => {} })).resolves.toBe(clip);
    expect(read).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledOnce();
  });
  it('waits for the game connection before requesting authenticated evidence', async () => {
    let online = false;
    const read = vi.fn().mockResolvedValue({ status: 'ready' });
    await recoverCapture(read, { isCurrent: () => true, canRead: () => online, wait: async () => { online = true; } });
    expect(read).toHaveBeenCalledOnce();
  });
  it('does not retry or repaint after the user leaves the view or changes session', async () => {
    let active = true;
    const read = vi.fn().mockRejectedValue(new CameraConnectionError());
    await expect(recoverCapture(read, { isCurrent: () => active, wait: async () => { active = false; } })).resolves.toBeNull();
    expect(read).toHaveBeenCalledOnce();
    const late = vi.fn().mockImplementation(async () => { active = false; return { status: 'ready' }; });
    active = true;
    await expect(recoverCapture(late, { isCurrent: () => active })).resolves.toBeNull();
  });
  it('bounds connection retries and caps each download by the remaining deadline', async () => {
    let time = 0;
    const read = vi.fn().mockRejectedValue(new CameraConnectionError());
    await expect(recoverCapture(read, { isCurrent: () => true, budgetMs: 1200, now: () => time, wait: async delay => { time += delay; } })).rejects.toBeInstanceOf(CameraConnectionError);
    expect(read.mock.calls.map(([timeout]) => timeout)).toEqual([1200, 700]);
    expect(time).toBe(1200);
  });
  it('leaves expired authorization and invalid capture errors actionable', async () => {
    const expired = new Error('This camera pairing expired.');
    const read = vi.fn().mockRejectedValue(expired);
    await expect(recoverCapture(read, { isCurrent: () => true })).rejects.toBe(expired);
    expect(read).toHaveBeenCalledOnce();
  });
  it('does not repaint a ready snapshot downloaded while Submit or Discard starts', async () => {
    let canRead = true;
    let finishRead!: (value: object) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }))
      .mockResolvedValueOnce({ status: 'idle' });
    const recovery = recoverCapture(read, { isCurrent: () => true, canRead: () => canRead,
      wait: async () => { canRead = true; } });
    canRead = false;
    finishRead({ status: 'ready', requestId: 'discarded' });
    await expect(recovery).resolves.toEqual({ status: 'idle' });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
