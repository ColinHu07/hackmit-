import type { EvidenceQuestId } from './play-protocol';

/** Game authentication is never sent to the camera app. */
export interface GlassesOwnerAuth { roomCode: string; playerToken: string }
export interface GlassesPairing { code: string; expiresAt: number }
export type GlassesCaptureKind = 'photo' | 'clip';
export type GlassesCameraCommand =
  | { id: string; kind: GlassesCaptureKind; questId: EvidenceQuestId }
  | { id: string; kind: 'cancel'; requestId: string };
export type GlassesCameraResult =
  | { requestId: string; status: 'ready'; photoDataUrl: string }
  | { requestId: string; status: 'ready'; frames: string[]; durationSeconds: number }
  | { requestId: string; status: 'error'; error: string };
export interface GlassesCameraStatus {
  paired: boolean;
  connected: boolean;
  requestId: string | null;
  status: 'idle' | 'capturing' | 'ready' | 'error';
  error?: string;
  photoDataUrl?: string;
  frames?: string[];
  durationSeconds?: number;
}
