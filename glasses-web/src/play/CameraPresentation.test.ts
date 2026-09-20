import { describe, expect, it } from 'vitest';
import { cameraAvailability, capturePresentation, recordingPreview } from './CameraPresentation';
import type { CaptureStatus } from './GlassesCamera';

const linked: CaptureStatus = { paired: true, connected: true, status: 'idle', requestId: null };
describe('camera readiness and scoped recording feedback', () => {
  it('does not confuse a link or polling phone with a live camera', () => {
    expect(cameraAvailability(linked).ready).toBe(false);
    expect(cameraAvailability({ ...linked, connected: false, cameraReady: true }).ready).toBe(false);
    expect(cameraAvailability({ ...linked, cameraReady: true }).ready).toBe(true);
    expect(cameraAvailability({ ...linked, connected: false }).title).toContain('offline');
  });
  it('surfaces the physical camera error instead of sending the user back to pairing', () => {
    const feedback = cameraAvailability({ ...linked, cameraState: 'permission', cameraMessage: 'Allow camera in Meta AI.' });
    expect(feedback.title).toBe('Camera permission needed');
    expect(feedback.message).toBe('Allow camera in Meta AI.');
  });
  it('permits an explicitly supported on-demand camera without claiming it is streaming', () => {
    expect(cameraAvailability({ ...linked, captureAvailable: true, cameraReady: false, cameraState: 'idle' })).toMatchObject({ ready: true, title: 'Ready to capture' });
    expect(cameraAvailability({ ...linked, connected: false, captureAvailable: true }).ready).toBe(false);
    expect(cameraAvailability({ ...linked, cameraState: 'idle' }).ready).toBe(false);
  });
  it('counts down only from valid frames for the active recording', () => {
    const state: CaptureStatus = { ...linked, status: 'capturing', requestId: 'recording', sequence: 3, elapsedSeconds: 2.2, previewDataUrl: 'data:image/jpeg;base64,/9j/' };
    expect(recordingPreview(state, 'recording')).toMatchObject({ remaining: 4, sequence: 3 });
    expect(recordingPreview(state, 'different')).toBeNull();
    expect(recordingPreview({ ...state, status: 'ready' }, 'recording')).toBeNull();
    expect(recordingPreview({ ...state, previewDataUrl: 'https://external.example/image' }, 'recording')).toBeNull();
    expect(recordingPreview({ ...state, elapsedSeconds: NaN }, 'recording')).toBeNull();
    expect(recordingPreview({ ...state, sequence: -1 }, 'recording')).toBeNull();
  });
});

describe('camera startup, recording and saving phases', () => {
  const capture: CaptureStatus = { ...linked, status: 'capturing', requestId: 'clip', cameraReady: false, cameraState: 'idle' };
  const recording: CaptureStatus = { ...capture, cameraReady: true, cameraState: 'ready', sequence: 3,
    elapsedSeconds: 2.2, previewDataUrl: 'data:image/jpeg;base64,/9j/' };

  it('keeps startup separate from the six-second clip and waits for actual recording progress', () => {
    expect(capturePresentation(capture, 'clip', 'clip')).toMatchObject({ stage: 'starting', clock: 'Preparing camera', preview: null });
    expect(capturePresentation({ ...capture, cameraReady: true, cameraState: 'ready' }, 'clip', 'clip'))
      .toMatchObject({ stage: 'starting', clock: 'Waiting for frames', preview: null });
    expect(capturePresentation({ ...capture, cameraState: 'starting', cameraMessage: 'Meta is connecting the glasses.' }, 'clip', 'clip').message)
      .toBe('Meta is connecting the glasses.');
  });

  it('shows a countdown only from real preview elapsed time, never request age', () => {
    expect(capturePresentation({ ...recording, captureAt: Date.now() - 30_000 }, 'clip', 'clip'))
      .toMatchObject({ stage: 'recording', clock: '● REC · 4s', preview: { sequence: 3, remaining: 4 } });
    expect(capturePresentation({ ...recording, elapsedSeconds: 6.1 }, 'clip', 'clip'))
      .toMatchObject({ stage: 'recording', clock: 'Finishing clip', preview: { remaining: 0 } });
    expect(capturePresentation({ ...capture, cameraReady: true, cameraState: 'ready' }, 'clip', 'clip', true))
      .toMatchObject({ stage: 'recording', clock: 'Recording', preview: null });
  });

  it('identifies saving only after observed recording, and drops previews when the camera closes', () => {
    expect(capturePresentation(capture, 'clip', 'clip', true)).toMatchObject({ stage: 'saving', clock: 'Saving capture', preview: null });
    expect(capturePresentation({ ...recording, cameraReady: false, cameraState: 'starting' }, 'clip', 'clip', true))
      .toMatchObject({ stage: 'saving', clock: 'Saving capture', preview: null });
    expect(capturePresentation(capture, 'clip', 'clip').stage).toBe('starting');
  });

  it('reports disconnect, permission and camera failures instead of retaining a recording countdown', () => {
    expect(capturePresentation({ ...recording, connected: false }, 'clip', 'clip', true))
      .toMatchObject({ stage: 'reconnecting', clock: 'Reconnecting', preview: null });
    expect(capturePresentation({ ...recording, cameraState: 'permission', cameraMessage: 'Allow camera access.' }, 'clip', 'clip', true))
      .toMatchObject({ stage: 'permission', message: 'Allow camera access.', preview: null });
    expect(capturePresentation({ ...recording, cameraState: 'paused' }, 'clip', 'clip', true))
      .toMatchObject({ stage: 'paused', clock: 'Paused', preview: null });
    expect(capturePresentation({ ...recording, cameraState: 'error', cameraMessage: 'Meta startup timed out.' }, 'clip', 'clip', true))
      .toMatchObject({ stage: 'error', message: 'Meta startup timed out.', preview: null });
  });

  it('does not borrow progress from another request or invent a photo recording timer', () => {
    expect(capturePresentation(recording, 'another-clip', 'clip', true))
      .toMatchObject({ stage: 'reconnecting', clock: 'Checking capture', preview: null });
    expect(capturePresentation(recording, 'clip', 'photo'))
      .toMatchObject({ stage: 'starting', clock: 'Taking photo', preview: null });
  });

  it('shows the saved result even after the camera closes and preserves terminal errors', () => {
    expect(capturePresentation({ ...capture, connected: false, status: 'ready' }, 'clip', 'clip', true))
      .toMatchObject({ stage: 'ready', clock: 'Saved', preview: null });
    expect(capturePresentation({ ...capture, status: 'error', error: 'No camera image arrived.' }, 'clip', 'clip'))
      .toMatchObject({ stage: 'error', message: 'No camera image arrived.', clock: 'Not recording' });
  });
});
