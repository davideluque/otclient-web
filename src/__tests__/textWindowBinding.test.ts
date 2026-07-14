// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { bindTextWindows } from '../lib/jamera/textWindowBinding';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { registerWireSkips } from '../lib/net/7.6/wireSkips';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import type { GameClient } from '../lib/net/common/GameClient';

function makeClient() {
  const protocol = new GameProtocol();
  const dispatcher = new PacketDispatcher();
  const client = {
    getProtocol: () => protocol,
    getDispatcher: () => dispatcher,
  } as unknown as GameClient;
  registerWireSkips(dispatcher, protocol);
  return { client, dispatcher };
}

afterEach(() => document.body.replaceChildren());

describe('text window binding', () => {
  it('shows a used book/sign including its writer', () => {
    const { client, dispatcher } = makeClient();
    bindTextWindows(client);
    const out = new OutputPacket();
    out.addU8(0x96);
    out.addU32(42);
    out.addU16(1954);
    out.addU16(200);
    out.addString('The north gate closes at sundown.');
    out.addString('Captain Bluebear');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    const pane = document.querySelector('.text-window')!;
    expect(pane.classList.contains('open')).toBe(true);
    expect(pane.textContent).toContain('The north gate closes at sundown.');
    expect(pane.textContent).toContain('Captain Bluebear');
  });

  it('shows house access lists and removes the pane on destroy', () => {
    const { client, dispatcher } = makeClient();
    const binding = bindTextWindows(client);
    const out = new OutputPacket();
    out.addU8(0x97);
    out.addU8(0);
    out.addU32(7);
    out.addString('Alice\nBob');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(document.querySelector('.text-window')!.textContent).toContain('Alice\nBob');
    binding.destroy();
    expect(document.querySelector('.text-window')).toBeNull();
  });
});
