import type { CaptureStatus } from './GlassesCamera';

export function cameraAvailability(state: CaptureStatus): { ready: boolean; title: string; message: string } {
  if (!state.paired) return { ready: false, title: 'Connect your camera', message: 'Open Camera setup once to link Kith Camera on your paired iPhone.' };
  if (!state.connected) return { ready: false, title: 'Phone camera relay offline', message: 'Open Kith Camera on your iPhone and keep it open. Your camera is linked, but the phone is not responding.' };
  if (state.captureAvailable) return { ready: true, title: 'Ready to capture', message: 'Camera connected. It starts when you choose Photo or Record 6s and stops after the capture.' };
  if (state.cameraReady) return { ready: true, title: 'Glasses camera ready', message: 'Your glasses camera is live.' };
  const titles = { starting: 'Starting glasses camera', permission: 'Camera permission needed', paused: 'Glasses camera paused', error: 'Camera needs attention', idle: 'Waiting for glasses camera', ready: 'Waiting for fresh camera frames' };
  return { ready: false, title: titles[state.cameraState ?? 'idle'], message: state.cameraMessage || 'Open Kith Camera on your iPhone and keep the app open. Update the phone app if it still shows Camera 5 or earlier.' };
}

/** Only the requested clip can paint its capture view. Never load a remote URL. */
export function recordingPreview(state: CaptureStatus, requestId: string): { image: string; sequence: number; remaining: number } | null {
  if (state.status !== 'capturing' || state.requestId !== requestId || !state.previewDataUrl
    || state.previewDataUrl.length > 140_000 || !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(state.previewDataUrl)
    || !Number.isInteger(state.sequence) || state.sequence! < 1
    || !Number.isFinite(state.elapsedSeconds) || state.elapsedSeconds! < 0 || state.elapsedSeconds! > 11) return null;
  return { image: state.previewDataUrl, sequence: state.sequence!, remaining: Math.max(0, Math.ceil(6 - state.elapsedSeconds!)) };
}
