/**
 * Shared shapes for the motion algorithms. Three strategies render a
 * creature's tile-to-tile movement, each in its own module:
 *
 * - `playout.ts` — fixed render delay over confirmed tiles; jitter-proof,
 *   but glides are capped at the delay (self's fallback, and the source
 *   of truth every strategy reconciles against).
 * - `forward.ts` — forward glide over the true step duration from each
 *   confirmed tile; right for every creature the client doesn't control.
 * - `prewalk.ts` — client-side prediction from the moment a walk packet
 *   leaves; right for SELF, where waiting for confirmation reads as lag.
 */

export interface RenderPos { x: number; y: number }

export interface PlaybackSample {
  x: number;
  y: number;
  z: number;
  at: number;
  /** Expected duration of the step INTO this tile (absent on seeds). */
  stepMs?: number;
}

export interface PlaybackState extends RenderPos { moving: boolean }
