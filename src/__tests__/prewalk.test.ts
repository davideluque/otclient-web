import { describe, expect, it } from 'vitest';
import {
  PREWALK_CATCHUP_MS,
  PREWALK_CONFIRM_GRACE_MS,
  beginStep,
  confirmSelfMoves,
  confirmStep,
  createPrewalk,
  flushPrewalk,
  prewalkActiveStep,
  prewalkStateAt,
  settlePrewalk,
  type PrewalkState,
} from '../lib/jamera/prewalk';
import { Direction } from '../lib/player';
import { RENDER_DELAY_MS } from '../lib/jamera/renderer';

const ANCHOR = { x: 100, y: 200, z: 7 };

/** A level-1 character's real step duration — well past RENDER_DELAY_MS. */
const SLOW_STEP_MS = 680;

function heldWalkEast(pw: PrewalkState, now: number, count: number): void {
  for (let i = 0; i < count; i++) beginStep(pw, ANCHOR, Direction.East, now, SLOW_STEP_MS);
}

describe('beginStep + prewalkStateAt', () => {
  it('glides from the send instant over the expected step duration', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    expect(prewalkStateAt(pw, 1000)).toEqual({ x: 100, y: 200, moving: true });
    const mid = prewalkStateAt(pw, 1000 + SLOW_STEP_MS / 2);
    expect(mid?.x).toBeCloseTo(100.5, 5);
    expect(mid?.moving).toBe(true);
    expect(prewalkStateAt(pw, 1000 + SLOW_STEP_MS)).toEqual({ x: 101, y: 200, moving: false });
  });

  it('returns null with nothing predicted — callers fall back to playout', () => {
    expect(prewalkStateAt(createPrewalk(), 1000)).toBeNull();
  });

  it('chains a banked lookahead step at the previous glide END, not its send time', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    // The controller banks the second send 140ms after the first.
    beginStep(pw, ANCHOR, Direction.East, 1140, SLOW_STEP_MS);
    // Still crossing the first tile.
    expect(prewalkStateAt(pw, 1500)?.x).toBeLessThan(101);
    // The second glide begins exactly where and when the first lands.
    const boundary = prewalkStateAt(pw, 1000 + SLOW_STEP_MS);
    expect(boundary?.x).toBe(101);
    const second = prewalkStateAt(pw, 1000 + SLOW_STEP_MS * 1.5);
    expect(second?.x).toBeCloseTo(101.5, 5);
    expect(second?.moving).toBe(true);
  });

  it('a held slow walk renders as continuous motion (the stutter regression)', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    beginStep(pw, ANCHOR, Direction.East, 1140, SLOW_STEP_MS);
    // Sample the whole two-step span: never idle, x strictly advances.
    let prevX = prewalkStateAt(pw, 1000)!.x;
    for (let t = 1050; t < 1000 + 2 * SLOW_STEP_MS; t += 50) {
      const s = prewalkStateAt(pw, t)!;
      expect(s.moving).toBe(true);
      expect(s.x).toBeGreaterThan(prevX);
      prevX = s.x;
    }
  });

  it('caps pending predictions at the pipeline depth', () => {
    const pw = createPrewalk();
    heldWalkEast(pw, 1000, 3);
    expect(pw.steps).toHaveLength(2);
  });

  it('walking each cardinal direction lands one tile over', () => {
    const cases: Array<[Direction, number, number]> = [
      [Direction.North, 100, 199],
      [Direction.East, 101, 200],
      [Direction.South, 100, 201],
      [Direction.West, 99, 200],
    ];
    for (const [dir, x, y] of cases) {
      const pw = createPrewalk();
      beginStep(pw, ANCHOR, dir, 1000, SLOW_STEP_MS);
      expect(prewalkStateAt(pw, 1000 + SLOW_STEP_MS)).toEqual({ x, y, moving: false });
    }
  });
});

describe('confirmStep', () => {
  it('a matching confirmation marks the step and leaves the glide untouched', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    const mid = prewalkStateAt(pw, 1300);
    expect(confirmStep(pw, { x: 101, y: 200, z: 7 }, 1700)).toBe(true);
    expect(prewalkStateAt(pw, 1300)).toEqual(mid);
  });

  it('confirms pipelined steps oldest-first', () => {
    const pw = createPrewalk();
    heldWalkEast(pw, 1000, 2);
    expect(confirmStep(pw, { x: 101, y: 200, z: 7 }, 1700)).toBe(true);
    expect(confirmStep(pw, { x: 102, y: 200, z: 7 }, 2400)).toBe(true);
    expect(pw.steps.every((s) => s.confirmed)).toBe(true);
  });

  it('a mismatched position flushes the chain (snap to the server)', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    expect(confirmStep(pw, { x: 100, y: 201, z: 7 }, 1700)).toBe(false);
    expect(prewalkStateAt(pw, 1700)).toBeNull();
  });

  it('a floor change flushes even when x/y match (stairs move you)', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    expect(confirmStep(pw, { x: 101, y: 200, z: 6 }, 1700)).toBe(false);
    expect(pw.steps).toHaveLength(0);
  });

  it('a self move with nothing predicted flushes (server push while resting)', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    confirmStep(pw, { x: 101, y: 200, z: 7 }, 1700);
    // The push arrives after the walk fully confirmed — chain still holds
    // the resting step, but no pending prediction explains the move.
    expect(confirmStep(pw, { x: 101, y: 199, z: 7 }, 1900)).toBe(false);
    expect(prewalkStateAt(pw, 1900)).toBeNull();
  });
});

describe('confirmStep catch-up (duration drift correction)', () => {
  it('an on-time confirmation (glide already ended) leaves the timing alone', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    confirmStep(pw, { x: 101, y: 200, z: 7 }, 1000 + SLOW_STEP_MS + 40);
    expect(pw.steps[0]).toMatchObject({ startAt: 1000, stepMs: SLOW_STEP_MS });
  });

  it('an early confirmation compresses the rest of the glide without moving the character', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    // The server finished the step at 1450 — our 680ms guess was ~230ms
    // too slow (wrong ground, a haste). The rendered position at the
    // confirmation instant must not jump…
    const u = 450 / SLOW_STEP_MS;
    confirmStep(pw, { x: 101, y: 200, z: 7 }, 1450);
    expect(prewalkStateAt(pw, 1450)?.x).toBeCloseTo(100 + u, 5);
    // …but the remainder finishes within the catch-up window instead of
    // dragging the lag into every chained step.
    expect(prewalkStateAt(pw, 1450 + PREWALK_CATCHUP_MS))
      .toEqual({ x: 101, y: 200, moving: false });
  });

  it('chained steps shift up by the time the compression saved', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    beginStep(pw, ANCHOR, Direction.East, 1140, SLOW_STEP_MS); // starts at 1680
    confirmStep(pw, { x: 101, y: 200, z: 7 }, 1300);
    // First glide now ends at 1300 + 120 = 1420; the lookahead follows
    // immediately instead of waiting out the stale 1680.
    expect(pw.steps[1].startAt).toBe(1420);
    expect(prewalkStateAt(pw, 1420 + SLOW_STEP_MS / 2)?.x).toBeCloseTo(101.5, 5);
  });

  it('a confirmation beating the glide start dashes the tile in the window', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    beginStep(pw, ANCHOR, Direction.East, 1140, SLOW_STEP_MS);
    // Both confirmations arrive in one delivery burst at 1500.
    confirmStep(pw, { x: 101, y: 200, z: 7 }, 1500);
    confirmStep(pw, { x: 102, y: 200, z: 7 }, 1500);
    // The second glide hadn't started; it dashes from its own tile and
    // the whole chain is done a window later, not at the stale 2360.
    expect(prewalkStateAt(pw, 1500 + 2 * PREWALK_CATCHUP_MS))
      .toEqual({ x: 102, y: 200, moving: false });
  });
});

describe('prewalkActiveStep', () => {
  it('exposes the in-flight step and null while resting', () => {
    const pw = createPrewalk();
    expect(prewalkActiveStep(pw, 1000)).toBeNull();
    beginStep(pw, ANCHOR, Direction.North, 1000, SLOW_STEP_MS);
    expect(prewalkActiveStep(pw, 1300)).toMatchObject({ toX: 100, toY: 199 });
    expect(prewalkActiveStep(pw, 1000 + SLOW_STEP_MS)).toBeNull();
  });
});

describe('confirmSelfMoves (batched confirmations)', () => {
  it('attributes a delivery burst oldest-first when the final position agrees', () => {
    const pw = createPrewalk();
    heldWalkEast(pw, 1000, 2);
    confirmSelfMoves(pw, 2, { x: 102, y: 200, z: 7 }, 2400);
    expect(pw.steps.every((s) => s.confirmed)).toBe(true);
    expect(prewalkStateAt(pw, 1300)?.moving).toBe(true);
  });

  it('flushes when the final position disagrees with the chain', () => {
    const pw = createPrewalk();
    heldWalkEast(pw, 1000, 2);
    confirmSelfMoves(pw, 2, { x: 101, y: 201, z: 7 }, 2400);
    expect(prewalkStateAt(pw, 2400)).toBeNull();
  });

  it('flushes when the burst outnumbers the pending pipeline (unexplained move)', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    confirmSelfMoves(pw, 2, { x: 102, y: 200, z: 7 }, 2400);
    expect(prewalkStateAt(pw, 2400)).toBeNull();
  });

  it('a single confirmation behaves exactly like confirmStep', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    confirmSelfMoves(pw, 1, { x: 101, y: 200, z: 7 }, 1700);
    expect(pw.steps[0].confirmed).toBe(true);
  });
});

describe('settlePrewalk', () => {
  it('expires a prediction whose confirmation never arrives', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    const deadline = 1000 + SLOW_STEP_MS + PREWALK_CONFIRM_GRACE_MS;
    settlePrewalk(pw, deadline, RENDER_DELAY_MS);
    expect(pw.steps).toHaveLength(1);
    settlePrewalk(pw, deadline + 1, RENDER_DELAY_MS);
    expect(pw.steps).toHaveLength(0);
  });

  it('hands off to the playout buffer only after the delayed timeline settles', () => {
    const pw = createPrewalk();
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    const confirmedAt = 1000 + SLOW_STEP_MS + 40;
    confirmStep(pw, { x: 101, y: 200, z: 7 }, confirmedAt);
    // Confirmed and played out, but the playout buffer is still gliding
    // toward the tile on its delayed timeline — keep resting here.
    settlePrewalk(pw, confirmedAt + RENDER_DELAY_MS - 1, RENDER_DELAY_MS);
    expect(prewalkStateAt(pw, confirmedAt + RENDER_DELAY_MS - 1))
      .toEqual({ x: 101, y: 200, moving: false });
    settlePrewalk(pw, confirmedAt + RENDER_DELAY_MS, RENDER_DELAY_MS);
    expect(prewalkStateAt(pw, confirmedAt + RENDER_DELAY_MS)).toBeNull();
  });

  it('a held walk never stalls behind fully-confirmed finished steps', () => {
    const pw = createPrewalk();
    // Walk east continuously: send, confirm, keep sending.
    beginStep(pw, ANCHOR, Direction.East, 1000, SLOW_STEP_MS);
    beginStep(pw, ANCHOR, Direction.East, 1140, SLOW_STEP_MS);
    confirmStep(pw, { x: 101, y: 200, z: 7 }, 1700);
    confirmStep(pw, { x: 102, y: 200, z: 7 }, 2380);
    // Both earlier steps confirmed; the third send predicts from x=102.
    beginStep(pw, ANCHOR, Direction.East, 2400, SLOW_STEP_MS);
    const s = prewalkStateAt(pw, 2400 + SLOW_STEP_MS - 1);
    expect(s?.x).toBeGreaterThan(102);
    expect(s?.moving).toBe(true);
  });
});

describe('flushPrewalk', () => {
  it('empties the chain (cancel/0xB5 path)', () => {
    const pw = createPrewalk();
    heldWalkEast(pw, 1000, 2);
    flushPrewalk(pw);
    expect(prewalkStateAt(pw, 1000)).toBeNull();
  });
});
