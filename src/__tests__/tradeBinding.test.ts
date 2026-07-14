// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindTrade } from '../lib/jamera/tradeBinding';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import type { GameClient } from '../lib/net/common/GameClient';
import { resetItemWireFlags, setItemWireFlags } from '../lib/net/common/itemFlags';
import { ThingCategory, type DatFile } from '../lib/dat';

beforeEach(() => {
  const frameGroup = {
    width: 1, height: 1, exactSize: 32, layers: 1,
    numPatternX: 1, numPatternY: 1, numPatternZ: 1,
    animationPhases: 1, spriteIds: [1],
  };
  setItemWireFlags({
    items: [2853, 3031, 3035].map((id) => ({
      id, category: ThingCategory.Item, attrs: new Map(), frameGroup,
    })),
  } as unknown as DatFile);
});
afterEach(() => {
  resetItemWireFlags();
  document.body.replaceChildren();
});

function makeClient() {
  const protocol = new GameProtocol();
  const dispatcher = new PacketDispatcher();
  const send = vi.fn();
  const client = {
    getProtocol: () => protocol,
    getDispatcher: () => dispatcher,
    send,
  } as unknown as GameClient;
  return { client, protocol, dispatcher, send };
}

function offerFrame(opcode: number, name: string, itemIds: number[]): InputPacket {
  const out = new OutputPacket();
  out.addU8(opcode);
  out.addString(name);
  out.addU8(itemIds.length);
  for (const id of itemIds) out.addU16(id);
  return new InputPacket(out.toArrayBuffer());
}

describe('bindTrade', () => {
  it('shows both offers, enables acceptance, and builds the accept packet', () => {
    const { client, protocol, dispatcher, send } = makeClient();
    bindTrade(client);

    dispatcher.dispatch(offerFrame(protocol.serverOpcodes.TradeRequest, 'Alice', [2853]));
    expect(document.querySelector('.trade-pane')).not.toBeNull();
    expect((document.querySelector('.trade-actions .accept') as HTMLButtonElement).disabled).toBe(true);

    dispatcher.dispatch(offerFrame(protocol.serverOpcodes.TradeRequestAck, 'Bob', [3031, 3035]));
    const accept = document.querySelector('.trade-actions .accept') as HTMLButtonElement;
    expect(accept.disabled).toBe(false);
    expect(document.querySelectorAll('.trade-item')).toHaveLength(3);
    accept.click();
    expect(accept.disabled).toBe(true);
    expect([...send.mock.calls[0][0].toUint8Array()]).toEqual([0x7f]);
  });

  it('keeps the same pane and its dragged position when the counter-offer arrives', () => {
    const { client, protocol, dispatcher } = makeClient();
    bindTrade(client);
    dispatcher.dispatch(offerFrame(protocol.serverOpcodes.TradeRequest, 'Alice', [2853]));
    const pane = document.querySelector<HTMLElement>('.trade-pane')!;
    pane.style.left = '23px';
    pane.style.top = '41px';
    pane.style.transform = 'none';

    dispatcher.dispatch(offerFrame(protocol.serverOpcodes.TradeRequestAck, 'Bob', [3031]));
    expect(document.querySelector('.trade-pane')).toBe(pane);
    expect(pane.style.left).toBe('23px');
    expect(pane.style.top).toBe('41px');
    expect(pane.style.transform).toBe('none');
  });

  it('looks at the correct side/index and closes on the server close packet', () => {
    const { client, protocol, dispatcher, send } = makeClient();
    const binding = bindTrade(client);
    dispatcher.dispatch(offerFrame(protocol.serverOpcodes.TradeRequest, 'Alice', [2853]));
    dispatcher.dispatch(offerFrame(protocol.serverOpcodes.TradeRequestAck, 'Bob', [3031, 3035]));

    (document.querySelectorAll<HTMLButtonElement>('.trade-item')[2]).click();
    expect([...send.mock.calls[0][0].toUint8Array()]).toEqual([0x7e, 1, 1]);

    const close = new OutputPacket();
    close.addU8(protocol.serverOpcodes.TradeClose);
    dispatcher.dispatch(new InputPacket(close.toArrayBuffer()));
    expect(document.querySelector('.trade-pane')).toBeNull();
    binding.destroy();
  });
});
