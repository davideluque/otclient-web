import type { PlaybackSample, PlaybackState } from './types';
import { STEP_GLIDE_DEFAULT_MS } from './playout';

/**
 * Bounds for a computed (speed-based) step duration. The ceiling covers
 * the slowest real case — an NPC (base speed 110) crossing swamp — while
 * keeping a glitched speed/ground value from freezing a creature
 * mid-tile; the floor keeps an extreme haste from reading as a teleport.
 */
export const FORWARD_STEP_MIN_MS = 100;
export const FORWARD_STEP_MAX_MS = 2500;

/**
 * The server's step duration (otserv Creature::getStepDuration):
 * 1000 × groundSpeed / creatureSpeed, doubled on diagonals. This is the
 * time a creature really spends per tile, so it is the glide duration
 * that renders NPCs ambling and hasted players sprinting — the arrival
 * cadence can't say that (an NPC's think-pauses swamp it).
 */
export function expectedStepMs(creatureSpeed: number, groundSpeed: number, diagonal: boolean): number {
  if (creatureSpeed <= 0) return STEP_GLIDE_DEFAULT_MS;
  const ground = groundSpeed > 0 ? groundSpeed : 150;
  const dur = ((1000 * ground) / creatureSpeed) * (diagonal ? 2 : 1);
  return Math.max(FORWARD_STEP_MIN_MS, Math.min(FORWARD_STEP_MAX_MS, Math.round(dur)));
}

/**
 * OTClient-style forward glide, used for every creature but self: the
 * step into sample `b` animates over [b.at, b.at + b.stepMs), i.e. the
 * creature leaves its old tile when the move packet plays and takes its
 * TRUE step duration to cross — an ambling NPC ambles instead of
 * standing then dashing the tile in RENDER_DELAY_MS. Only already-known
 * samples feed the glide, so nothing ever jumps retroactively; a
 * follow-up sample arriving early cuts the glide short at its own
 * timestamp. Discontinuities snap.
 */
export function forwardStateAt(
  samples: ReadonlyArray<PlaybackSample>,
  t: number,
): PlaybackState {
  if (samples.length === 0) return { x: 0, y: 0, moving: false };
  // Latest sample at or before t — the step currently animating.
  let i = samples.length - 1;
  while (i > 0 && samples[i].at > t) i--;
  const b = samples[i];
  if (i === 0 || t < b.at) return { x: b.x, y: b.y, moving: false };
  const a = samples[i - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const step = (dx !== 0 || dy !== 0) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && b.z === a.z;
  if (!step) return { x: b.x, y: b.y, moving: false };
  let duration = b.stepMs ?? STEP_GLIDE_DEFAULT_MS;
  if (i + 1 < samples.length) {
    duration = Math.min(duration, Math.max(1, samples[i + 1].at - b.at));
  }
  const u = Math.min(1, (t - b.at) / duration);
  return {
    x: a.x + dx * u,
    y: a.y + dy * u,
    moving: u < 1,
  };
}
