// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindChat } from '../lib/jamera/chatBinding';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { registerWireSkips } from '../lib/net/7.6/wireSkips';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import type { GameClient } from '../lib/net/common/GameClient';

function makeClient() {
  const protocol = new GameProtocol();
  const dispatcher = new PacketDispatcher();
  const sent: Uint8Array[] = [];
  const client = {
    getProtocol: () => protocol,
    getDispatcher: () => dispatcher,
    send: (p: OutputPacket) => sent.push(p.toUint8Array()),
  } as unknown as GameClient;
  return { client, dispatcher, sent };
}

afterEach(() => document.body.replaceChildren());

describe('bindChat', () => {
  it('renders an incoming say (0xAA) in the chat UI', () => {
    const { client, dispatcher } = makeClient();
    bindChat(client);

    const out = new OutputPacket();
    out.addU8(0xaa);
    out.addString('Trinity');
    out.addU8(0x01); // Say
    out.addU16(100); out.addU16(200); out.addU8(7); // position
    out.addString('hello jamera');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    const messages = document.querySelector('#chat-messages')!;
    expect(messages.textContent).toContain('Trinity');
    expect(messages.textContent).toContain('hello jamera');
  });

  it('routes server text messages (0xB4) into the default channel as Server', () => {
    const { client, dispatcher } = makeClient();
    bindChat(client);

    const out = new OutputPacket();
    out.addU8(0xb4);
    out.addU8(0x11); // message class
    out.addString('Welcome to Jamera!');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(document.querySelector('#chat-messages')!.textContent).toContain('Welcome to Jamera!');
  });

  it('keeps messages for channels opened by the server', () => {
    const { client, dispatcher } = makeClient();
    registerWireSkips(dispatcher, client.getProtocol());
    const binding = bindChat(client);

    const out = new OutputPacket();
    out.addU8(0xac); // ChannelOpen
    out.addU16(4);
    out.addString('Server Events');
    out.addU8(0xaa); // CreatureSpeak
    out.addString('Jamera');
    out.addU8(0x05); // Channel
    out.addU16(4);
    out.addString('Server restart in five minutes');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(binding.manager.getChannel(4)?.messages[0].text).toBe('Server restart in five minutes');
    const serverEventsTab = [...document.querySelectorAll('#chat-tabs button')]
      .find((button) => button.textContent === 'Server Events') as HTMLButtonElement | undefined;
    expect(serverEventsTab).toBeDefined();

    serverEventsTab!.click();
    expect(document.querySelector('#chat-messages')!.textContent).toContain('Server restart in five minutes');
  });

  it('sends typed messages through the client', () => {
    const { client, sent } = makeClient();
    bindChat(client);

    const input = document.querySelector('#chat-input') as HTMLInputElement;
    input.value = 'hi everyone';
    (document.querySelector('#chat-send') as HTMLButtonElement).click();

    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(0x96); // ClientOp Say
  });

  it('swallows send failures instead of crashing the UI handler', () => {
    const { client } = makeClient();
    (client as { send: (p: OutputPacket) => void }).send = () => { throw new Error('not in_game'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bindChat(client);

    const input = document.querySelector('#chat-input') as HTMLInputElement;
    input.value = 'hi';
    expect(() => (document.querySelector('#chat-send') as HTMLButtonElement).click()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('the ✕ button collapses the panel (no corner toggle — it overlapped the hotkey arc)', () => {
    const { client } = makeClient();
    bindChat(client);
    const ui = document.querySelector('#chat-ui') as HTMLElement;
    // Tests run with a fine pointer, so the panel starts open.
    expect(ui.style.display).toBe('flex');

    (document.querySelector('.chat-close') as HTMLButtonElement).click();
    expect(ui.style.display).toBe('none');

    // The 💬 corner toggle is gone; reopening goes through menu → Chat.
    const toggle = [...document.querySelectorAll('body > button')]
      .find((b) => b.textContent === '💬');
    expect(toggle).toBeUndefined();
  });

  it('destroy removes the UI', () => {
    const { client } = makeClient();
    const binding = bindChat(client);
    expect(document.querySelector('#chat-ui')).not.toBeNull();

    binding.destroy();
    expect(document.querySelector('#chat-ui')).toBeNull();
    expect(document.body.querySelectorAll('button').length).toBe(0);
  });
});
