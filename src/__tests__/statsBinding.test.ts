// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { bindStats } from '../lib/jamera/statsBinding';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
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
  return { client, dispatcher };
}

function statsFrame(): InputPacket {
  const out = new OutputPacket();
  out.addU8(0xa0);
  out.addU16(150); out.addU16(185); // hp / max
  out.addU16(400); out.addU32(4200); out.addU16(8); out.addU8(50);
  out.addU16(35); out.addU16(90);   // mana / max
  out.addU8(2); out.addU8(20); out.addU8(100);
  return new InputPacket(out.toArrayBuffer());
}

afterEach(() => document.body.replaceChildren());

describe('bindStats', () => {
  it('renders 0xA0 stats into the HUD', () => {
    const { client, dispatcher } = makeClient();
    bindStats(client);

    dispatcher.dispatch(statsFrame());

    const hud = document.querySelector('.hud')!;
    expect(hud.querySelector('.hud-level')?.textContent).toBe('8');
    expect(hud.querySelector('.hp .num')?.textContent).toBe('150 / 185');
    expect(hud.querySelector('.mp .num')?.textContent).toBe('35 / 90');
  });

  it('renders 0xA1 skills into the pane, hidden until toggled via the menu', () => {
    const { client, dispatcher } = makeClient();
    bindStats(client);

    const out = new OutputPacket();
    out.addU8(0xa1);
    const pairs = [[10, 0], [11, 25], [60, 90], [12, 5], [30, 50], [45, 75], [9, 1]];
    for (const [lvl, pct] of pairs) { out.addU8(lvl); out.addU8(pct); }
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    const pane = document.querySelector('.skill-pane') as HTMLElement;
    expect(pane).not.toBeNull();
    expect(pane.style.display).toBe('none'); // hidden until toggled
    // Find by label — the character block (level/magic) now precedes
    // the seven skills, so positional indexing is brittle.
    const swordRow = [...pane.querySelectorAll('.skill')]
      .find((r) => r.querySelector('.row span:first-child')?.textContent === 'Sword')!;
    expect(swordRow.querySelector('.lvl')?.textContent).toBe('60');

    // Open via the game menu entry.
    (document.querySelector('.game-menu-btn') as HTMLButtonElement).click();
    const skillsItem = [...document.querySelectorAll('.game-menu-pane button')]
      .find((b) => b.textContent === 'Skills') as HTMLButtonElement;
    skillsItem.click();
    expect(pane.style.display).toBe('block');
  });

  it('destroy removes HUD, pane, and menu', () => {
    const { client, dispatcher } = makeClient();
    const binding = bindStats(client);
    dispatcher.dispatch(statsFrame());

    binding.destroy();
    expect(document.querySelector('.hud')).toBeNull();
    expect(document.querySelector('.skill-pane')).toBeNull();
    expect(document.querySelector('.game-menu-btn')).toBeNull();
  });
});
