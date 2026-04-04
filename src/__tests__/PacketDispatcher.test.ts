import { describe, it, expect, vi } from 'vitest';
import { PacketDispatcher } from '../lib/net/PacketDispatcher';
import { InputPacket } from '../lib/net/InputPacket';
import { OutputPacket } from '../lib/net/OutputPacket';

function makePacket(...opcodes: number[]): InputPacket {
  const out = new OutputPacket();
  for (const op of opcodes) out.addU8(op);
  return new InputPacket(out.toArrayBuffer());
}

describe('PacketDispatcher', () => {
  it('dispatches to registered handler', () => {
    const dispatcher = new PacketDispatcher();
    const handler = vi.fn();
    dispatcher.on(0x64, handler);

    dispatcher.dispatch(makePacket(0x64));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('calls default handler for unregistered opcodes', () => {
    const dispatcher = new PacketDispatcher();
    const defaultHandler = vi.fn();
    dispatcher.onDefault(defaultHandler);

    dispatcher.dispatch(makePacket(0xff));
    expect(defaultHandler).toHaveBeenCalledOnce();
  });

  it('does not call handler after removal', () => {
    const dispatcher = new PacketDispatcher();
    const handler = vi.fn();
    dispatcher.on(0x64, handler);
    dispatcher.off(0x64);

    dispatcher.dispatch(makePacket(0x64));
    expect(handler).not.toHaveBeenCalled();
  });

  it('registers multiple opcodes to same handler', () => {
    const dispatcher = new PacketDispatcher();
    const handler = vi.fn();
    dispatcher.onMany([0x65, 0x66, 0x67], handler);

    dispatcher.dispatch(makePacket(0x65));
    dispatcher.dispatch(makePacket(0x66));
    dispatcher.dispatch(makePacket(0x67));
    expect(handler).toHaveBeenCalledTimes(3);
  });
});
