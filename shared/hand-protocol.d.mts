export interface HandPoint { x: number; y: number; z: number }
export interface CameraPreviewFrame { mime: 'image/jpeg'; width: number; height: number; jpeg: string }
export interface HandFrame {
  v: 1; type: 'hands'; source: 'glasses-camera'; streamId: string; seq: number;
  capturedAtMs: number; width: number; height: number;
  coordinateSpace: 'image-top-left'; mirrored: false;
  hands: { id: string; score: number; points: HandPoint[] }[];
  preview?: CameraPreviewFrame;
}
export const MAX_FRAME_AGE_MS: number;
export const MAX_CLOCK_LEAD_MS: number;
export function validHandFrame(value: unknown, now?: number): value is HandFrame;
