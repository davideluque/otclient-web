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
}

/** Executing + one server-queued lookahead. Never more. */
const MAX_OUTSTANDING = 2;
/** Minimum spacing between a send and its lookahead follow-up. */
const PREQUEUE_AFTER_MS = 140;

export function createWalkController(opts: WalkControllerOptions): WalkControllerHandle {
  const stepTimeoutMs = opts.stepTimeoutMs ?? 800;
  // 25ms: sends must leave within a frame of becoming eligible.
  const tickMs = opts.tickMs ?? 25;

  // Outstanding sends, oldest first. expectedStep is the world selfSteps
  // value at which this send's confirmation has landed.
  let sent: Array<{ sentAt: number; expectedStep: number; deadline: number }> = [];
  let lastSentAt = 0;

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
  };

  const timer = setInterval(tick, tickMs);

  return {
    destroy: () => clearInterval(timer),
  };
}
