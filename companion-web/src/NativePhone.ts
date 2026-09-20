import type { LocationFix } from './LocationDiscovery';

declare global {
  interface Window {
    bondimalsNative?: { version: number; serverURL: string };
    webkit?: { messageHandlers?: { bondimals?: { postMessage(message: object): void } } };
  }
}
export const isNativePhone = () => window.bondimalsNative?.version === 1;
export function nativeCommand(command: string, extra: object = {}): void {
  window.webkit?.messageHandlers?.bondimals?.postMessage({ command, ...extra });
}
export interface NativeEvent {
  type: 'evidence' | 'active' | 'location' | 'heading' | 'paused' | 'unavailable' | 'status' | 'recording';
  requestId?: string; frames?: string[]; durationSeconds?: number;
  latitude?: number; longitude?: number; accuracy?: number; timestamp?: number;
  degrees?: number; reference?: 'true' | 'magnetic'; message?: string;
}
export function onNativeEvent(callback: (event: NativeEvent) => void): () => void {
  const receive = (event: Event) => callback((event as CustomEvent<NativeEvent>).detail);
  window.addEventListener('bondimals-native', receive);
  return () => window.removeEventListener('bondimals-native', receive);
}
export function nativeFix(event: NativeEvent): LocationFix | null {
  const { latitude, longitude, accuracy, timestamp } = event;
  if (event.type !== 'location' || typeof latitude !== 'number' || typeof longitude !== 'number'
    || typeof accuracy !== 'number' || typeof timestamp !== 'number'
    || ![latitude, longitude, accuracy, timestamp].every(Number.isFinite)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0
    || Date.now() - timestamp > 20_000 || timestamp > Date.now() + 5000) return null;
  return { latitude, longitude, accuracy, timestamp };
}
/** Native location never uses the web permission prompt or stores a location history. */
export class NativeLocation {
  private unsubscribe?: () => void;
  constructor(private readonly callbacks: {
    fix(fix: LocationFix): void; status(message: string): void;
    unavailable(message: string): void; paused(): void;
  }) {}
  start(): void {
    this.stop();
    this.unsubscribe = onNativeEvent(event => {
      const fix = nativeFix(event);
      if (fix) this.callbacks.fix(fix);
      if (event.type === 'status') this.callbacks.status(event.message ?? 'Finding your location…');
      if (event.type === 'unavailable') { this.stop(); this.callbacks.unavailable(event.message ?? 'Location is unavailable.'); }
      if (event.type === 'paused') { this.stop(); this.callbacks.paused(); }
    });
    nativeCommand('startLocation', { purpose: 'discovery' });
  }
  stop(): void {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    nativeCommand('stopLocation', { purpose: 'discovery' });
  }
}

export function prepareNativeClip(): Promise<{ frames: string[]; durationSeconds: number }> {
  return new Promise((resolve, reject) => {
    const requestId = `clip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error('Preparing the clip timed out. Please retry.')); }, 25_000);
    const unsubscribe = onNativeEvent(event => {
      if (event.type !== 'evidence' || event.requestId !== requestId) return;
      clearTimeout(timeout); unsubscribe();
      if (!Array.isArray(event.frames) || event.frames.length < 3 || event.frames.length > 12
        || !event.frames.every(frame => typeof frame === 'string' && frame.startsWith('data:image/jpeg;base64,'))
        || !Number.isFinite(event.durationSeconds)) reject(new Error(event.message ?? 'Could not prepare this clip.'));
      else resolve({ frames: event.frames, durationSeconds: event.durationSeconds! });
    });
    nativeCommand('prepareQuestClip', { requestId });
  });
}
