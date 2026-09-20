import { CameraConnectionError, isCameraConnectionError } from './GlassesCamera';

interface RecoveryOptions {
  isCurrent: () => boolean;
  canRead?: () => boolean;
  onRetry?: () => void;
  budgetMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

/** Retry only a read. Never issue another capture, discard, or grade request. */
export async function recoverCapture<T>(read: (timeoutMs: number) => Promise<T>, options: RecoveryOptions): Promise<T | null> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const deadline = now() + (options.budgetMs ?? 90_000);
  let attempts = 0;
  let lastError: unknown;
  while (options.isCurrent()) {
    const remaining = deadline - now();
    if (remaining <= 0) throw lastError ?? new CameraConnectionError();
    if (options.canRead?.() !== false) {
      try {
        const result = await read(Math.min(45_000, remaining));
        if (!options.isCurrent()) return null;
        // Submit/Discard can begin while a long evidence download is in flight.
        // Never repaint that older snapshot over the user's mutation.
        if (options.canRead?.() !== false) return result;
      } catch (error) {
        if (!options.isCurrent()) return null;
        if (!isCameraConnectionError(error)) throw error;
        lastError = error;
      }
    }
    if (!options.isCurrent()) return null;
    options.onRetry?.();
    await wait(Math.max(0, Math.min(500 * 2 ** Math.min(attempts++, 3), 3000, deadline - now())));
  }
  return null;
}
