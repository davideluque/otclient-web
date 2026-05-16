import type { InputPacket } from './InputPacket';

export type OpcodeHandler = (packet: InputPacket) => void;

/**
 * Routes incoming server packets to registered opcode handlers.
 * Logs unhandled opcodes for debugging.
 */
export class PacketDispatcher {
  private handlers = new Map<number, OpcodeHandler>();
  private defaultHandler: OpcodeHandler | null = null;

  /**
   * Register a handler for a specific opcode.
   */
  on(opcode: number, handler: OpcodeHandler): void {
    this.handlers.set(opcode, handler);
  }

  /**
   * Register multiple opcodes to the same handler.
   */
  onMany(opcodes: number[], handler: OpcodeHandler): void {
    for (const op of opcodes) {
      this.handlers.set(op, handler);
    }
  }

  /**
   * Set a default handler for unregistered opcodes.
   */
  onDefault(handler: OpcodeHandler): void {
    this.defaultHandler = handler;
  }

  /**
   * Remove a handler for a specific opcode.
   */
  off(opcode: number): void {
    this.handlers.delete(opcode);
  }

  /**
   * Dispatch a packet. Reads the first byte as the opcode and routes accordingly.
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
