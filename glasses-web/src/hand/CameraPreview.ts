import type { HandFrame } from './CameraHands';

/** Desktop-only, low-bandwidth monitor. It never paints into the glasses canvas. */
export class CameraPreview {
  private epoch = 0;
  private decoding = false;
  private receivedAt = -Infinity;
  private enabled = false;
  private readonly context: CanvasRenderingContext2D;
  constructor(private readonly canvas: HTMLCanvasElement, private readonly status: HTMLElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Camera preview canvas unavailable');
    this.context = context;
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.clear();
  }
  clear(): void {
    this.epoch += 1;
    this.receivedAt = -Infinity;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.hidden = true;
    this.status.textContent = this.enabled ? 'Waiting for glasses camera…' : 'Camera preview is off.';
  }
  async ingest(frame: HandFrame): Promise<void> {
    if (!this.enabled || !frame.preview || this.decoding) return;
    const epoch = this.epoch;
    this.decoding = true;
    let bitmap: ImageBitmap | undefined;
    try {
      const bytes = Uint8Array.from(atob(frame.preview.jpeg), char => char.charCodeAt(0));
      bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      if (epoch !== this.epoch || !this.enabled || Date.now() - frame.capturedAtMs > 1500) return;
      if (bitmap.width !== frame.preview.width || bitmap.height !== frame.preview.height) return;
      this.canvas.width = bitmap.width; this.canvas.height = bitmap.height;
      this.context.drawImage(bitmap, 0, 0);
      for (const hand of frame.hands) {
        this.context.strokeStyle = '#d8ffa5'; this.context.lineWidth = 1;
        for (const chain of [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12], [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17]]) {
          this.context.beginPath();
          chain.forEach((index, i) => {
            const point = hand.points[index]!;
            if (i === 0) this.context.moveTo(point.x * bitmap!.width, point.y * bitmap!.height);
            else this.context.lineTo(point.x * bitmap!.width, point.y * bitmap!.height);
          });
          this.context.stroke();
        }
        hand.points.forEach((point, index) => {
          this.context.fillStyle = index === 8 ? '#fff' : '#d8ffa5';
          this.context.beginPath(); this.context.arc(point.x * bitmap!.width, point.y * bitmap!.height, index === 8 ? 3 : 1.5, 0, Math.PI * 2); this.context.fill();
        });
      }
      this.canvas.hidden = false;
      this.receivedAt = performance.now();
      this.status.textContent = `Glasses camera · ${frame.hands.length} hand${frame.hands.length === 1 ? '' : 's'} · live preview`;
    } catch { if (epoch === this.epoch) this.status.textContent = 'Camera preview could not decode a frame.'; }
    finally { bitmap?.close(); this.decoding = false; }
  }
  expire(now: number): void {
    if (!this.canvas.hidden && now - this.receivedAt > 1500) this.clear();
  }
}
