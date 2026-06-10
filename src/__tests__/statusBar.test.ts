// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { createStatusBar, StatusIcon } from '../lib/statusBar';
import { bindStatus } from '../lib/jamera/statusBinding';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import type { GameClient } from '../lib/net/common/GameClient';

afterEach(() => document.body.replaceChildren());

describe('createStatusBar', () => {
  it('shows exactly the chips in the mask and hides the bar when empty', () => {
    const bar = createStatusBar();
    const el = document.querySelector('.status-bar') as HTMLElement;

    bar.setIcons(StatusIcon.Poison | StatusIcon.Haste);
    const on = [...el.querySelectorAll('.chip.on')].map((c) => c.getAttribute('data-bit'));
    expect(on).toEqual([String(StatusIcon.Poison), String(StatusIcon.Haste)]);
    expect(el.style.display).toBe('flex');

    bar.setIcons(0);
    expect(el.style.display).toBe('none');
    bar.destroy();
  });
});

describe('bindStatus', () => {
  it('renders 0xA2 bitmasks from the wire and unbinds on destroy', () => {
    const protocol = new GameProtocol();
    const dispatcher = new PacketDispatcher();
    const client = {
      getProtocol: () => protocol,
      getDispatcher: () => dispatcher,
    } as unknown as GameClient;

    const binding = bindStatus(client);
    const out = new OutputPacket();
    out.addU8(0xa2);
    out.addU8(StatusIcon.InFight | StatusIcon.ManaShield);
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    const on = [...document.querySelectorAll('.chip.on')].map((c) => c.getAttribute('data-bit'));
    expect(on).toEqual([String(StatusIcon.ManaShield), String(StatusIcon.InFight)]);
    binding.destroy();
    expect(document.querySelector('.status-bar')).toBeNull();
  });
});
