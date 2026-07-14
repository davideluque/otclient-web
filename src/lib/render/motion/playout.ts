import type { PlaybackSample, PlaybackState, RenderPos } from './types';

/**
 * Playout buffer (fixed render delay), the FPS-netcode entity-
 * interpolation pattern Codex recommended over latest-target pursuit:
 * confirmed tiles are buffered as timestamped samples and rendered
 * RENDER_DELAY_MS in the past. Each glide is timed to FINISH exactly at
 * its sample's (delayed) arrival time. Wi-Fi delivery jitter smaller
 * than the delay reorders nothing on screen — motion plays back as one
 * continuous stream instead of stalling and sprinting.
 */
export const RENDER_DELAY_MS = 180;
/** Buffered samples per creature — enough to ride out a delivery burst. */
const MAX_SAMPLES = 8;

/**
 * Glide duration bounds. The right duration is the creature's ACTUAL
 * step cadence (Tibia paces ~400ms/tile at base speed, faster with
 * hastes/levels, plus network jitter) — a fixed value either finishes
 * early (visible stop-start between steps) or rubber-bands. The playout
 * cadence is measured from confirmation intervals (EMA), so continuous
 * walking renders as one unbroken scroll.
 */
export const STEP_GLIDE_DEFAULT_MS = 380;
export const STEP_GLIDE_MIN_MS = 150;
export const STEP_GLIDE_MAX_MS = 650;

/**
 * Exponential moving average of a creature's step cadence. Exported for
 * tests. Per the Codex review, only samples in the plausible
 * SERVER-step-duration band feed the estimate — anything longer is
 * network arrival jitter or a standing pause, anything shorter is a
 * delivery burst; neither says how fast the creature walks.
 */
export function nextStepEma(prevEma: number, sampleMs: number): number {
  if (sampleMs < STEP_GLIDE_MIN_MS || sampleMs > 500) return prevEma;
  return Math.max(STEP_GLIDE_MIN_MS, Math.min(STEP_GLIDE_MAX_MS, prevEma * 0.75 + sampleMs * 0.25));
}

/**
 * Append a confirmed tile to a creature's playout buffer. Same-floor
 * steps queue behind the render delay and glide; a FLOOR CHANGE flushes
 * the buffer to a single backdated sample instead — floor changes are
 * teleports, never glides. The camera and the floor stack snap to the
 * new floor the moment the world publishes it, so playing out the
 * pre-change samples rendered the creature at old-floor coordinates
 * under the new stack for RENDER_DELAY_MS — the "standing behind the
 * stairs, then moved in front" transient on every stair climb.
 */
export function appendPlaybackSample(
  p: { samples: PlaybackSample[]; cadence: number; lastArrivalAt?: number },
  next: { x: number; y: number; z: number; at: number },
  stepMs: number,
): void {
  const last = p.samples[p.samples.length - 1];
  if (last && last.x === next.x && last.y === next.y && last.z === next.z) return;
  // Cadence intervals come from TRUE arrival times: the flush below
  // backdates its sample's render schedule by RENDER_DELAY_MS, and
  // measuring the next step against that would inflate the EMA by the
  // render delay (review catch on #299).
  const prevArrivalAt = p.lastArrivalAt ?? last?.at;
  p.lastArrivalAt = next.at;
  if (last && last.z !== next.z) {
    p.samples.length = 0;
    p.samples.push({ x: next.x, y: next.y, z: next.z, at: next.at - RENDER_DELAY_MS });
    return;
  }
  if (last && prevArrivalAt !== undefined) p.cadence = nextStepEma(p.cadence, next.at - prevArrivalAt);
  p.samples.push({ x: next.x, y: next.y, z: next.z, at: next.at, stepMs });
  if (p.samples.length > MAX_SAMPLES) p.samples.shift();
}

/**
 * State on the buffered timeline at delayed time `t`. A segment cannot
 * exceed RENDER_DELAY_MS: anything longer would begin before the endpoint
 * sample had arrived and make the next render jump retroactively into the
 * step. Discontinuities hold and snap at the sample timestamp.
 */
export function playbackStateAt(
  samples: ReadonlyArray<PlaybackSample>,
  cadenceMs: number,
  t: number,
): PlaybackState {
  if (samples.length === 0) return { x: 0, y: 0, moving: false };
  if (t >= samples[samples.length - 1].at) {
    const last = samples[samples.length - 1];
    return { x: last.x, y: last.y, moving: false };
  }
  // Find the segment [a, b] with a.at <= t < b.at.
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1].at > t) i--;
  const b = samples[i];
  const a = i > 0 ? samples[i - 1] : b;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const discontinuity = b.z !== a.z || Math.abs(dx) > 1 || Math.abs(dy) > 1;
  if (discontinuity) return { x: a.x, y: a.y, moving: false };
  const duration = Math.min(cadenceMs, RENDER_DELAY_MS, Math.max(1, b.at - a.at));
  const startAt = b.at - duration;
  const u = Math.min(1, Math.max(0, (t - startAt) / duration));
  return {
    x: a.x + dx * u,
    y: a.y + dy * u,
    moving: (dx !== 0 || dy !== 0) && t >= startAt && t < b.at,
  };
}

export function playbackPosAt(
  samples: ReadonlyArray<PlaybackSample>,
  cadenceMs: number,
  t: number,
): RenderPos {
  const { x, y } = playbackStateAt(samples, cadenceMs, t);
  return { x, y };
}
