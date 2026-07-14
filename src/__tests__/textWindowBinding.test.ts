// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const send = vi.fn();
  const client = {
    getProtocol: () => protocol,
    getDispatcher: () => dispatcher,
    send,
  } as unknown as GameClient;
  registerWireSkips(dispatcher, protocol);
  return { client, dispatcher, send };
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
    expect(pane.querySelector('textarea')).toBeNull();
  });

  it('edits a DAT-writable book and saves the server-issued window id', () => {
    const { client, dispatcher, send } = makeClient();
    bindTextWindows(client, document.body, { isWritable: (id) => id === 1954 });
    const out = new OutputPacket();
    out.addU8(0x96);
    out.addU32(0x10203040);
    out.addU16(1954);
    out.addU16(200);
    out.addString('Draft');
    out.addString('');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    const textarea = document.querySelector<HTMLTextAreaElement>('.text-window textarea')!;
    expect(textarea.maxLength).toBe(200);
    textarea.value = 'Final text';
    document.querySelector<HTMLButtonElement>('.text-window .save')!.click();
    expect([...send.mock.calls[0][0].toUint8Array()]).toEqual([
      0x89, 0x40, 0x30, 0x20, 0x10,
      10, 0, ...new TextEncoder().encode('Final text'),
    ]);
    expect(document.querySelector('.text-window')!.classList.contains('open')).toBe(false);
  });

  it('edits and saves a house access list', () => {
    const { client, dispatcher, send } = makeClient();
    bindTextWindows(client);
    const out = new OutputPacket();
    out.addU8(0x97);
    out.addU8(0);
    out.addU32(7);
    out.addString('Alice');
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    const textarea = document.querySelector<HTMLTextAreaElement>('.text-window textarea')!;
    textarea.value = 'Alice\nBob';
    document.querySelector<HTMLButtonElement>('.text-window .save')!.click();
    expect([...send.mock.calls[0][0].toUint8Array()]).toEqual([
      0x8a, 0, 7, 0, 0, 0, 9, 0, ...new TextEncoder().encode('Alice\nBob'),
    ]);
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

    expect(document.querySelector<HTMLTextAreaElement>('.text-window textarea')!.value).toBe('Alice\nBob');
    binding.destroy();
    expect(document.querySelector('.text-window')).toBeNull();
  });
});
