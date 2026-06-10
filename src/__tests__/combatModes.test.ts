// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCombatModes } from '../lib/combatModes';
import { bindCombatModes } from '../lib/jamera/combatModesBinding';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import type { GameClient } from '../lib/net/common/GameClient';

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

function btn(role: string): HTMLButtonElement {
  return document.querySelector(`.combat-modes button[data-role="${role}"]`) as HTMLButtonElement;
}

describe('createCombatModes', () => {
  it('cycles the stance and toggles chase/secure, reporting each change', () => {
    const onChange = vi.fn();
    const modes = createCombatModes({ onChange });
    expect(modes.state).toEqual({ fightMode: 2, chase: false, secure: true });

    btn('fight').click(); // 2 → 3
    btn('fight').click(); // 3 → 1 (wraps)
    btn('chase').click();
    btn('secure').click();
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(modes.state).toEqual({ fightMode: 1, chase: true, secure: false });
    modes.destroy();
  });
});

describe('bindCombatModes', () => {
  function makeClient() {
    const protocol = new GameProtocol();
    const sent: number[][] = [];
    const client = {
      getProtocol: () => protocol,
      send: (p: { toUint8Array(): Uint8Array }) => sent.push([...p.toUint8Array()]),
    } as unknown as GameClient;
    return { client, sent };
  }

  it('sends 0xA0 with the wire bytes on bind and on every change, and persists', () => {
    const { client, sent } = makeClient();
    const binding = bindCombatModes(client);
    // Login sync with defaults: balanced, no chase, secure on.
    expect(sent[0]).toEqual([0xa0, 2, 0, 1]);

    btn('fight').click(); // → defensive
    expect(sent[1]).toEqual([0xa0, 3, 0, 1]);
    binding.destroy();

    // A new session restores the persisted state and re-syncs it.
    const second = makeClient();
    bindCombatModes(second.client);
    expect(second.sent[0]).toEqual([0xa0, 3, 0, 1]);
  });
});
