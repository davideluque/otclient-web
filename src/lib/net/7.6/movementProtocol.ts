import { OutputPacket } from '../common/OutputPacket';
import type { WalkDirection } from '../common/types';
import { ClientOp } from './opcodes';

/**
 * 7.6 movement packets: a single opcode byte per step, 0x65–0x68 in
 * north/east/south/west order. The server answers with the matching
 * Move* map row (0x65–0x68 server-side) on success or CancelWalk (0xB5)
 * when the step is rejected.
 */
const MOVE_OPCODES: readonly number[] = [
  ClientOp.MoveNorth,
  ClientOp.MoveEast,
  ClientOp.MoveSouth,
  ClientOp.MoveWest,
];

export function buildMovePacket(direction: WalkDirection): OutputPacket {
  const out = new OutputPacket();
  out.addU8(MOVE_OPCODES[direction]);
  return out;
}

/**
 * 0x64 autowalk wire direction bytes, indexed by WalkDirection
 * (0=N, 1=E, 2=S, 3=W). Verified against the server's parseAutoWalk:
 * 1=E, 2=NE, 3=N, 4=NW, 5=W, 6=SW, 7=S, 8=SE — directions are read
 * first-step-first (path.push_back).
 */
const AUTOWALK_DIR_BYTES: readonly number[] = [3, 1, 7, 5];

/** Wire count byte caps the route at 255 steps. */
const AUTOWALK_MAX_STEPS = 255;

export function buildAutoWalkPacket(route: WalkDirection[]): OutputPacket {
  const steps = route.slice(0, AUTOWALK_MAX_STEPS);
  const out = new OutputPacket();
  out.addU8(ClientOp.AutoWalk);
  out.addU8(steps.length);
  for (const dir of steps) out.addU8(AUTOWALK_DIR_BYTES[dir]);
  return out;
}
