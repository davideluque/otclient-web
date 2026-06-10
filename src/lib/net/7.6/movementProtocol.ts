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
