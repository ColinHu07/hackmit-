import type { CaptureStatus } from './GlassesCamera';

export function cameraAvailability(state: CaptureStatus): { ready: boolean; title: string; message: string } {
  if (!state.paired) return { ready: false, title: 'Connect your camera', message: 'Open Camera setup once to link Kith Camera on your paired iPhone.' };
  if (!state.connected) return { ready: false, title: 'Phone camera relay offline', message: 'Open Kith Camera on your iPhone and keep it open. Your camera is linked, but the phone is not responding.' };
  if (state.captureAvailable) return { ready: true, title: 'Ready to capture', message: 'Choose Photo or Record clip to start the camera. A clip records for six seconds after the camera is ready, then saves.' };
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

export interface CapturePresentation {
  stage: 'starting' | 'permission' | 'recording' | 'saving' | 'reconnecting' | 'paused' | 'error' | 'ready';
  title: string;
  message: string;
  clock: string;
  preview: ReturnType<typeof recordingPreview>;
}

/** Preparation and upload are separate from the recording's reported elapsed time. */
export function capturePresentation(state: CaptureStatus, requestId: string, kind: 'photo' | 'clip', sawRecording = false): CapturePresentation {
  const result = (stage: CapturePresentation['stage'], title: string, clock: string, message: string,
    preview: CapturePresentation['preview'] = null): CapturePresentation => ({ stage, title, clock, message, preview });
  if (state.requestId !== requestId) return result('reconnecting', 'Checking your capture', 'Checking capture',
    'Waiting for the status of this requested capture.');
  if (state.status === 'ready') return result('ready', 'Capture saved', 'Saved', 'Your capture is ready to review and submit.');
  if (state.status === 'error') return result('error', 'Capture could not finish', 'Not recording',
    state.error || state.cameraMessage || 'Check Kith Camera on your iPhone and try again.');
  if (!state.paired || !state.connected) return result('reconnecting', 'Reconnecting to your camera', 'Reconnecting',
    'Checking your requested capture. Keep Kith Camera open on your iPhone.');
  if (state.cameraState === 'permission') return result('permission', 'Camera permission needed', 'Permission needed',
    state.cameraMessage || 'Allow camera access in Meta AI on your iPhone, then return to Kith Camera.');
  if (state.cameraState === 'paused') return result('paused', 'Glasses camera paused', 'Paused',
    state.cameraMessage || 'Keep Kith Camera open on your iPhone to finish this capture.');
  if (state.cameraState === 'error') return result('error', 'Camera needs attention', 'Not recording',
    state.cameraMessage || 'Check Kith Camera on your iPhone and try again.');
  const preview = kind === 'clip' && state.cameraReady !== false ? recordingPreview(state, requestId) : null;
  if (preview) return result('recording', 'Recording from your glasses', preview.remaining ? `● REC · ${preview.remaining}s` : 'Finishing clip',
    'Keep the action in view. The countdown follows recorded camera frames.', preview);
  if (sawRecording && (state.cameraReady === false || state.cameraState === 'idle')) return result('saving',
    'Finishing your capture', 'Saving capture', 'The camera is finishing and sending your capture. Saving takes extra time after recording.');
  if (sawRecording) return result('recording', 'Waiting for recording progress', 'Recording',
    'Waiting for the latest recording progress. Keep the action in view.');
  if (state.cameraReady) return result('starting', kind === 'clip' ? 'Waiting for recording progress' : 'Taking your photo',
    kind === 'clip' ? 'Waiting for frames' : 'Taking photo', kind === 'clip'
      ? 'The camera is ready. Waiting for recorded frames before showing the six-second countdown.'
      : 'The camera is ready. Waiting for your glasses photo.');
  return result('starting', 'Starting glasses camera', 'Preparing camera', state.cameraMessage
    || (kind === 'clip' ? 'Starting the camera comes first. The clip records for six seconds once the camera is ready.'
      : 'Starting the glasses camera before taking your photo.'));
}
