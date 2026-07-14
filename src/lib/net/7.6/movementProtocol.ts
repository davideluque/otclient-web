import { OutputPacket } from '../common/OutputPacket';
import type { WalkDirection } from '../common/types';
import { ClientOp } from './opcodes';

/**
 * Direction index order: N, E, S, W, NE, SE, SW, NW. Cardinal values stay
 * compatible with player facing while the final four map to 0x6A–0x6D.
 */
const MOVE_OPCODES: readonly number[] = [
  ClientOp.MoveNorth,
  ClientOp.MoveEast,
  ClientOp.MoveSouth,
  ClientOp.MoveWest,
  ClientOp.MoveNorthEast,
  ClientOp.MoveSouthEast,
  ClientOp.MoveSouthWest,
  ClientOp.MoveNorthWest,
];

export function buildMovePacket(direction: WalkDirection): OutputPacket {
  const out = new OutputPacket();
  out.addU8(MOVE_OPCODES[direction]);
  return out;
}

/**
 * 0x64 autowalk wire direction bytes, indexed by WalkDirection
 * (0=N, 1=E, 2=S, 3=W, 4=NE, 5=SE, 6=SW, 7=NW).
 * Verified against the server's parseAutoWalk:
 * 1=E, 2=NE, 3=N, 4=NW, 5=W, 6=SW, 7=S, 8=SE — directions are read
 * first-step-first (path.push_back).
 */
const AUTOWALK_DIR_BYTES: readonly number[] = [3, 1, 7, 5, 2, 8, 6, 4];

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
