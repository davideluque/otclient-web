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
  it('renders an incoming say (0xAA) in the glance overlay', () => {
    const { client, dispatcher } = makeClient();
    bindChat(client);

    const out = new OutputPacket();
    out.addU8(0xaa);
    out.addString('Trinity');
    out.addU8(0x01); // Say
    out.addU16(100); out.addU16(200); out.addU8(7);
    out.addString('hello jamera');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    const glance = document.querySelector('.chat-glance-stack')!;
    expect(glance.textContent).toContain('Trinity');
    expect(glance.textContent).toContain('hello jamera');
  });

  it('routes server text messages (0xB4) into the default channel as Server', () => {
    const { client, dispatcher } = makeClient();
    const binding = bindChat(client);

    const out = new OutputPacket();
    out.addU8(0xb4);
    out.addU8(0x11);
    out.addString('Welcome to Jamera!');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(document.querySelector('.chat-glance-stack')!.textContent).toContain('Welcome to Jamera!');
    expect(document.querySelector('.game-message-overlay')!.textContent).toContain('Welcome to Jamera!');
    expect(binding.manager.getChannel(0)?.messages[0].text).toBe('Welcome to Jamera!');
  });

  it('keeps messages for channels opened by the server', () => {
    const { client, dispatcher } = makeClient();
    registerWireSkips(dispatcher, client.getProtocol());
    const binding = bindChat(client);

    const out = new OutputPacket();
    out.addU8(0xac);
    out.addU16(4);
    out.addString('Server Events');
    out.addU8(0xaa);
    out.addString('Jamera');
    out.addU8(0x05);
    out.addU16(4);
    out.addString('Server restart in five minutes');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(binding.manager.getChannel(4)?.messages[0].text).toBe('Server restart in five minutes');
    binding.presentation.openQuick();
    const serverEventsTab = [...document.querySelectorAll('.quick-chat-tabs button')]
      .find((button) => button.textContent === 'Server Events') as HTMLButtonElement | undefined;
    expect(serverEventsTab).toBeDefined();

    serverEventsTab!.click();
    expect(document.querySelector('.quick-chat-messages')!.textContent).toContain('Server restart in five minutes');
    binding.destroy();
  });

  it('fires onDeathMessage for a class 0x13 "You are dead." and still shows it in chat', () => {
    const { client, dispatcher } = makeClient();
    const onDeathMessage = vi.fn();
    bindChat(client, document.body, { onDeathMessage });

    const out = new OutputPacket();
    out.addU8(0xb4);
    out.addU8(0x13);
    out.addString('You are dead.');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(onDeathMessage).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.chat-glance-stack')!.textContent).toContain('You are dead.');
  });

  it('does not fire onDeathMessage for class 0x13 with different text', () => {
    const { client, dispatcher } = makeClient();
    const onDeathMessage = vi.fn();
    bindChat(client, document.body, { onDeathMessage });

    const out = new OutputPacket();
    out.addU8(0xb4);
    out.addU8(0x13);
    out.addString('You advanced in sword fighting.');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(onDeathMessage).not.toHaveBeenCalled();
    expect(document.querySelector('.chat-glance-stack')!.textContent).toContain('You advanced in sword fighting.');
  });

  it('does not fire onDeathMessage for the same text in a different class', () => {
    const { client, dispatcher } = makeClient();
    const onDeathMessage = vi.fn();
    bindChat(client, document.body, { onDeathMessage });

    const out = new OutputPacket();
    out.addU8(0xb4);
    out.addU8(0x11);
    out.addString('You are dead.');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(onDeathMessage).not.toHaveBeenCalled();
  });

  it('sends typed messages through the client from quick chat', () => {
    const { client, sent } = makeClient();
    const binding = bindChat(client);
    binding.presentation.openQuick();

    const input = document.querySelector('.quick-chat-input-row input') as HTMLInputElement;
    input.value = 'hi everyone';
    (document.querySelector('.quick-chat-input-row button') as HTMLButtonElement).click();

    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(0x96);
    binding.destroy();
  });

  it('swallows send failures instead of crashing the UI handler', () => {
    const { client } = makeClient();
    (client as { send: (p: OutputPacket) => void }).send = () => { throw new Error('not in_game'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const binding = bindChat(client);
    binding.presentation.openQuick();

    const input = document.querySelector('.quick-chat-input-row input') as HTMLInputElement;
    input.value = 'hi';
    expect(() => (document.querySelector('.quick-chat-input-row button') as HTMLButtonElement).click()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    binding.destroy();
  });

  it('close button in quick chat returns to glance mode', () => {
    const { client } = makeClient();
    const binding = bindChat(client);
    binding.presentation.openQuick();
    expect(binding.presentation.mode).toBe('quick');

    (document.querySelector('.quick-chat-head-actions button[aria-label="Close chat"]') as HTMLButtonElement).click();
    expect(binding.presentation.mode).toBe('glance');
    expect(document.querySelector('.quick-chat.open')).toBeNull();
    binding.destroy();
  });

  it('destroy removes all chat UI', () => {
    const { client } = makeClient();
    const binding = bindChat(client);
    binding.presentation.openQuick();
    expect(document.querySelector('.quick-chat')).not.toBeNull();

    binding.destroy();
    expect(document.querySelector('.quick-chat')).toBeNull();
    expect(document.querySelector('.chat-open-btn')).toBeNull();
    expect(document.body.querySelectorAll('button').length).toBe(0);
  });
});
