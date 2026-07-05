import type { GameClient } from '../net/common/GameClient';
import { reportMetric } from './metrics';
import { telemetry } from './telemetry';
import type { GameWorld } from '../GameWorld';
import type { Direction } from '../player';

/**
 * Server-confirmed stepping with ONE-STEP LOOKAHEAD. The server queues
 * exactly one premature move (Game::playerMove → setNextWalkTask), so
 * while a direction is held we keep one move banked server-side: the
 * step pipeline never waits a confirmation round-trip between tiles,
 * which removes receive-jitter (mobile Wi-Fi batching) from the walk
 * cadence entirely. Confirmations are attributed to outstanding sends
 * via the world's selfSteps counter — with two in flight, position
 * snapshots alone can't tell how many landed.
 *
 * Conservative per the Codex review: at most 2 outstanding (executing +
 * server-queued), the lookahead only goes out PREQUEUE_AFTER_MS after
 * the previous send (never tick-spam — the server replaces its single
 * queued task), and a timeout flushes the whole pipeline so a blocked
 * step doesn't leave a stale queued move walking the wrong way.
 *
 * Input is pulled, not pushed: `getHeldDirection` is sampled every tick,
 * which composes the joystick and keyboard with plain `??` at the call
 * site and avoids juggling two event streams.
 */
export interface WalkControllerOptions {
  client: GameClient;
  world: GameWorld;
  /** Currently held direction across all input devices, or null. */
  getHeldDirection: () => Direction | null;
  /**
   * How long to wait for the oldest outstanding step before assuming it
   * was rejected (blocked tile, CancelWalk) and flushing the pipeline.
   * 7.6 step durations at base speed are ~300–500 ms.
   */
  stepTimeoutMs?: number;
  tickMs?: number;
}

export interface WalkControllerHandle {
  destroy(): void;
  /**
   * The server cancelled the walk (0xB5): flush the pipeline now instead
   * of waiting out the step timeout, and briefly stop re-sending.
   * `dir` is the facing from the packet — the direction that hit the
   * wall; without it the suppression falls back to the last sent
   * direction, which can be a newer lookahead the player already turned
   * to (and must not be stalled).
   */
  cancel(dir?: Direction | null): void;
}

/** Executing + one server-queued lookahead. Never more. */
const MAX_OUTSTANDING = 2;
/** Minimum spacing between a send and its lookahead follow-up. */
const PREQUEUE_AFTER_MS = 140;
/**
 * Send-quiet window after a server cancel. A joystick held into a wall
 * would otherwise loop send→0xB5→send at tick cadence (the 800ms step
 * timeout used to rate-limit that naturally). Lifted early when the held
 * direction changes — turning away from the wall must feel instant.
 */
const CANCEL_SUPPRESS_MS = 250;

export function createWalkController(opts: WalkControllerOptions): WalkControllerHandle {
  const stepTimeoutMs = opts.stepTimeoutMs ?? 800;
  // 25ms: sends must leave within a frame of becoming eligible.
  const tickMs = opts.tickMs ?? 25;

  // Outstanding sends, oldest first. expectedStep is the world selfSteps
  // value at which this send's confirmation has landed.
  let sent: Array<{ sentAt: number; expectedStep: number; deadline: number }> = [];
  let lastSentAt = 0;
  let lastSentDir: Direction | null = null;
  let suppressUntil = 0;
  let suppressedDir: Direction | null = null;

  const tick = (): void => {
    const { client, world } = opts;
    if (client.getState() !== 'in_game') {
      sent = [];
      return;
    }
    const now = performance.now();

    // Attribute confirmations (possibly several after a Wi-Fi batch).
    while (sent.length > 0 && world.selfSteps >= sent[0].expectedStep) {
      reportMetric('step', now - sent[0].sentAt);
      sent.shift();
      // The queued lookahead only starts walking now — give it a full
      // window from this confirmation, not from its (early) send time.
      if (sent.length > 0) {
        sent[0].deadline = Math.max(sent[0].deadline, now + stepTimeoutMs);
      }
    }
    // The oldest send timing out means it was rejected or lost — flush
    // everything: a queued lookahead behind a blocked step would walk
    // somewhere we no longer want.
    if (sent.length > 0 && now > sent[0].deadline) {
      telemetry('walk-timeout', { outstanding: sent.length });
      sent = [];
    }

    const dir = opts.getHeldDirection();
    if (dir === null) return;
    if (now < suppressUntil) {
      if (dir === suppressedDir) return;
      suppressUntil = 0;
    }
    if (sent.length >= MAX_OUTSTANDING) return;
    if (sent.length > 0 && now - lastSentAt < PREQUEUE_AFTER_MS) return;

    try {
      client.send(client.getProtocol().movement.buildMove(dir));
      telemetry('walk-send', { dir, outstanding: sent.length });
    } catch (e) {
      // A throw here means the state flipped mid-tick (defensive — the
      // state check above runs in the same synchronous tick). Don't let
      // it kill the interval.
      console.warn('[jamera] walk send failed:', e instanceof Error ? e.message : e);
      return;
    }
    sent.push({
      sentAt: now,
      // This send's step lands after every earlier outstanding one.
      expectedStep: world.selfSteps + sent.length + 1,
      deadline: now + stepTimeoutMs,
    });
    lastSentAt = now;
    lastSentDir = dir;
  };

  const timer = setInterval(tick, tickMs);

  return {
    destroy: () => clearInterval(timer),
    cancel: (dir?: Direction | null) => {
      telemetry('walk-cancel', { outstanding: sent.length });
      sent = [];
      suppressedDir = dir ?? lastSentDir;
      suppressUntil = performance.now() + CANCEL_SUPPRESS_MS;
    },
  };
}
