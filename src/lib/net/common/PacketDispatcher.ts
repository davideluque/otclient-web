import type { InputPacket } from './InputPacket';

export type OpcodeHandler = (packet: InputPacket) => void;

export class PacketDispatcher {
  private handlers = new Map<number, OpcodeHandler>();
  private defaultHandler: OpcodeHandler | null = null;

  on(opcode: number, handler: OpcodeHandler): void {
    this.handlers.set(opcode, handler);
  }

  onMany(opcodes: number[], handler: OpcodeHandler): void {
    for (const op of opcodes) {
      this.handlers.set(op, handler);
    }
  }

  onDefault(handler: OpcodeHandler): void {
    this.defaultHandler = handler;
  }

  off(opcode: number): void {
    this.handlers.delete(opcode);
  }

  /**
   * Processes all opcodes in the packet (some server packets contain multiple).
   */
  dispatch(packet: InputPacket): void {
    while (packet.bytesLeft > 0) {
      const opcode = packet.getU8();
      const handler = this.handlers.get(opcode);

      if (handler) {
        handler(packet);
      } else if (this.defaultHandler) {
        this.defaultHandler(packet);
        return; // Can't continue — unknown opcode means unknown data length
      } else {
        console.warn(`Unhandled opcode: 0x${opcode.toString(16).padStart(2, '0')}`);
        return; // Can't determine packet boundary for unknown opcodes
      }
    }
  }
}
