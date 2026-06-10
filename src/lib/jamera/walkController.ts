import type { GameClient } from '../net/common/GameClient';
import type { GameWorld } from '../GameWorld';
import type { Direction } from '../player';

/**
 * Server-confirmed stepping: send one move packet, then wait until the
 * server's Move* response lands (visible as the world's player position
 * changing) before sending the next — no client-side prediction, so a
 * rejected step (CancelWalk) needs no rollback; the player simply
 * doesn't move and the timeout below re-arms the next attempt.
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
   * How long to wait for the server to confirm a step before assuming
   * it was rejected (blocked tile, CancelWalk) and allowing the next
   * attempt. 7.6 step durations at base speed are ~300–500 ms.
   */
  stepTimeoutMs?: number;
  tickMs?: number;
}

export interface WalkControllerHandle {
  destroy(): void;
}

export function createWalkController(opts: WalkControllerOptions): WalkControllerHandle {
  const stepTimeoutMs = opts.stepTimeoutMs ?? 800;
  const tickMs = opts.tickMs ?? 60;

  let pending: { x: number; y: number; z: number; deadline: number } | null = null;

  const tick = (): void => {
    const { client, world } = opts;
    if (client.getState() !== 'in_game') {
      pending = null;
      return;
    }

    if (pending) {
      const moved =
        world.playerX !== pending.x ||
        world.playerY !== pending.y ||
        world.playerZ !== pending.z;
      if (moved) {
        pending = null; // server confirmed the step
      } else if (performance.now() > pending.deadline) {
        pending = null; // rejected or lost — allow another attempt
      } else {
        return; // still waiting on the server
      }
    }

    const dir = opts.getHeldDirection();
    if (dir === null) return;

    try {
      client.send(client.getProtocol().movement.buildMove(dir));
    } catch (e) {
      // A throw here means the state flipped mid-tick (defensive — the
      // state check above runs in the same synchronous tick). Don't let
      // it kill the interval.
      console.warn('[jamera] walk send failed:', e instanceof Error ? e.message : e);
      return;
    }
    pending = {
      x: world.playerX,
      y: world.playerY,
      z: world.playerZ,
      deadline: performance.now() + stepTimeoutMs,
    };
  };

  const timer = setInterval(tick, tickMs);

  return {
    destroy: () => clearInterval(timer),
  };
}
