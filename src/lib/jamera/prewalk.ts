import { Direction } from '../player';
import type { PlaybackState } from './renderer';

/**
 * Client-side walk prediction for SELF (classic Tibia/OTClient pre-walk).
 *
 * The playout buffer renders confirmed motion RENDER_DELAY_MS in the past
 * and caps every glide at that delay, so a character whose real step
 * duration exceeds it (a low-level character walks ~680 ms/tile) slides
 * for 180 ms and then stands waiting for the next confirmation — the
 * step–pause–step stutter. Prediction removes the wait: the glide starts
 * the moment the walk packet leaves, over the step duration the server
 * will actually take (expectedStepMs), and the confirmation merely
 * validates it afterwards.
 *
 * The module is a pure state machine over timestamped predicted steps so
 * the timing rules are unit-testable. It never touches the world or the
 * network; the walk controller feeds sends in, the renderer samples
 * positions out, and anything unexpected — mismatched confirmation,
 * server push, floor change, cancel, timeout — flushes the whole chain
 * so rendering falls back to the server-confirmed playout buffer.
 */

/**
 * Most unconfirmed predictions in flight. Mirrors the walk controller's
 * MAX_OUTSTANDING: one step executing plus one banked server-side.
 */
export const PREWALK_MAX_PENDING = 2;

/**
 * How long past a predicted step's end to keep waiting for its
 * confirmation before writing the prediction off. Mirrors the walk
 * controller's step timeout: by then the send was rejected or lost.
 */
export const PREWALK_CONFIRM_GRACE_MS = 800;

/**
 * When a confirmation catches a predicted glide lagging (see
 * compressLaggingGlide), the remainder finishes within this window.
 */
export const PREWALK_CATCHUP_MS = 120;

const DIR_DELTA: Record<Direction, { dx: number; dy: number }> = {
  [Direction.North]: { dx: 0, dy: -1 },
  [Direction.East]: { dx: 1, dy: 0 },
  [Direction.South]: { dx: 0, dy: 1 },
  [Direction.West]: { dx: -1, dy: 0 },
};

export interface PrewalkStep {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  z: number;
  /** When the glide into (toX, toY) begins. */
  startAt: number;
  /** Expected duration of the glide (the server's step duration). */
  stepMs: number;
  /** The server echoed this step back (0x65–0x68 row update landed). */
  confirmed: boolean;
}

export interface PrewalkState {
  /** Oldest first. Contiguous: each step starts where the previous ends. */
  steps: PrewalkStep[];
  /** Arrival time of the newest confirmation — times the playout handoff. */
  lastConfirmedAt: number;
}

export function createPrewalk(): PrewalkState {
  return { steps: [], lastConfirmedAt: 0 };
}

export function flushPrewalk(pw: PrewalkState): void {
  pw.steps.length = 0;
}

/**
 * Predict the step a just-sent walk packet will cause. `anchor` is the
 * server-confirmed position, used only when the chain is empty; otherwise
 * the step continues from the previous prediction's target. Chained steps
 * begin when their predecessor's glide ends — while a direction is held
 * the sends run ahead of the steps (the controller banks one server-side),
 * and animating from send time would cross tiles faster than the server
 * walks them.
 */
export function beginStep(
  pw: PrewalkState,
  anchor: { x: number; y: number; z: number },
  dir: Direction,
  now: number,
  stepMs: number,
): void {
  pruneFinishedConfirmed(pw, now);
  if (pw.steps.filter((s) => !s.confirmed).length >= PREWALK_MAX_PENDING) return;
  const last = pw.steps[pw.steps.length - 1];
  const fromX = last ? last.toX : anchor.x;
  const fromY = last ? last.toY : anchor.y;
  const z = last ? last.z : anchor.z;
  const { dx, dy } = DIR_DELTA[dir];
  pw.steps.push({
    fromX,
    fromY,
    toX: fromX + dx,
    toY: fromY + dy,
    z,
    startAt: last ? Math.max(now, last.startAt + last.stepMs) : now,
    stepMs,
    confirmed: false,
  });
}

/**
 * Attribute a self position change (world.selfSteps increment) to the
 * oldest pending prediction. A match keeps the animation running
 * untouched — the confirmation only marks the step safe. Anything else
 * (server push, floor change, rejected-then-rerouted walk) flushes: the
 * playout buffer already renders those correctly, and a stale prediction
 * on top of them would show the player somewhere the server disagrees
 * with. Returns whether the prediction matched.
 */
export function confirmStep(
  pw: PrewalkState,
  pos: { x: number; y: number; z: number },
  now: number,
): boolean {
  const step = pw.steps.find((s) => !s.confirmed);
  if (!step || step.toX !== pos.x || step.toY !== pos.y || step.z !== pos.z) {
    flushPrewalk(pw);
    return false;
  }
  step.confirmed = true;
  pw.lastConfirmedAt = now;
  compressLaggingGlide(pw, step, now);
  return true;
}

/**
 * Drift correction. A confirmation means the server FINISHED this step;
 * a predicted glide still scheduled to run well past it was built from
 * an overestimated duration (wrong ground guess, a haste, a server
 * pacing quirk) — and because every later step chains on this one's
 * end, the error would compound until the character walked seconds
 * behind the world, then snapped. Compress the remainder instead: keep
 * the currently rendered position fixed (same interpolation fraction
 * at `now`), pull the glide's end in to a short catch-up window, and
 * shift the chained steps up by the time saved. Underestimated
 * durations need no counterpart — the chain rests at its tail and the
 * next send re-anchors to the send clock.
 */
function compressLaggingGlide(pw: PrewalkState, step: PrewalkStep, now: number): void {
  const end = step.startAt + step.stepMs;
  // A glide the confirmation beat entirely (delivery burst, chained
  // route tail) keeps its chained start — pulling it to `now` would
  // overlap the previous, still-running glide — and dashes the tile in
  // one window from there.
  const targetEnd = Math.max(now, step.startAt) + PREWALK_CATCHUP_MS;
  if (end <= targetEnd) return; // glide on time — the healthy case
  const shift = end - targetEnd;
  if (now > step.startAt) {
    // Mid-glide: solve startAt'/stepMs' so the interpolation fraction at
    // `now` is unchanged (the character must not jump) while the glide
    // ends at targetEnd. u < 1 because now < end.
    const u = (now - step.startAt) / step.stepMs;
    step.startAt = (now - u * targetEnd) / (1 - u);
  }
  step.stepMs = targetEnd - step.startAt;
  for (let k = pw.steps.indexOf(step) + 1; k < pw.steps.length; k++) {
    pw.steps[k].startAt -= shift;
  }
}

/**
 * Per-frame maintenance, called before sampling. Two jobs:
 *
 * - Expire: a pending step whose confirmation is PREWALK_CONFIRM_GRACE_MS
 *   overdue was rejected or lost — flush so rendering snaps back to the
 *   server's position (the walk controller times its pipeline out on the
 *   same clock).
 * - Hand off: once every step is confirmed and played out, keep resting
 *   on the final tile for `handoffDelayMs` (the render delay) past both
 *   the glide's end and the confirmation's arrival, then drop the chain.
 *   By then the playout buffer's delayed timeline has settled on the
 *   same tile, so the fallback swap is invisible.
 */
export function settlePrewalk(pw: PrewalkState, now: number, handoffDelayMs: number): void {
  pruneFinishedConfirmed(pw, now);
  if (pw.steps.length === 0) return;
  const pending = pw.steps.find((s) => !s.confirmed);
  if (pending) {
    if (now > pending.startAt + pending.stepMs + PREWALK_CONFIRM_GRACE_MS) flushPrewalk(pw);
    return;
  }
  const last = pw.steps[pw.steps.length - 1];
  const end = last.startAt + last.stepMs;
  if (now >= Math.max(end, pw.lastConfirmedAt) + handoffDelayMs) flushPrewalk(pw);
}

/**
 * Predicted render state at wall-clock `now` (prediction renders live,
 * not on the delayed playout timeline), or null when nothing is
 * predicted and the caller should fall back to the playout buffer.
 */
export function prewalkStateAt(pw: PrewalkState, now: number): PlaybackState | null {
  if (pw.steps.length === 0) return null;
  let i = pw.steps.length - 1;
  while (i > 0 && pw.steps[i].startAt > now) i--;
  const s = pw.steps[i];
  if (now < s.startAt) return { x: s.fromX, y: s.fromY, moving: false };
  const u = (now - s.startAt) / s.stepMs;
  if (u >= 1) return { x: s.toX, y: s.toY, moving: false };
  return {
    x: s.fromX + (s.toX - s.fromX) * u,
    y: s.fromY + (s.toY - s.fromY) * u,
    moving: true,
  };
}

/**
 * The step whose glide spans `now`, or null while resting (before the
 * first glide, between a finished chain and its handoff, or empty).
 * Callers derive the character's facing from it — the server only
 * turns the creature at confirmation, a step too late to look right.
 */
export function prewalkActiveStep(pw: PrewalkState, now: number): PrewalkStep | null {
  if (pw.steps.length === 0) return null;
  let i = pw.steps.length - 1;
  while (i > 0 && pw.steps[i].startAt > now) i--;
  const s = pw.steps[i];
  if (now < s.startAt || now >= s.startAt + s.stepMs) return null;
  return s;
}

/**
 * Drop confirmed steps that finished animating, keeping at least one so
 * the chain remembers where it rests (and where the next step continues
 * from). Without this, a long held walk would hit PREWALK_MAX_PENDING's
 * companion bound — the array itself — and stall new predictions behind
 * fully-done ones.
 */
function pruneFinishedConfirmed(pw: PrewalkState, now: number): void {
  while (
    pw.steps.length > 1
    && pw.steps[0].confirmed
    && now >= pw.steps[0].startAt + pw.steps[0].stepMs
  ) {
    pw.steps.shift();
  }
}
