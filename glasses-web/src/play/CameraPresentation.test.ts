import { describe, expect, it } from 'vitest';
import { cameraAvailability, recordingPreview } from './CameraPresentation';
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
