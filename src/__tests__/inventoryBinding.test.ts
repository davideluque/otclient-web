// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bindInventory } from '../lib/jamera/inventoryBinding';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { setItemWireFlags, resetItemWireFlags } from '../lib/net/common/itemFlags';
import type { GameClient } from '../lib/net/common/GameClient';
import type { DatFile } from '../lib/dat';
import { DatAttr, ThingCategory } from '../lib/dat';

const ARROWS_ID = 2544;

function makeClient() {
  const protocol = new GameProtocol();
  const dispatcher = new PacketDispatcher();
  const client = {
    getProtocol: () => protocol,
    getDispatcher: () => dispatcher,
  } as unknown as GameClient;
  return { client, dispatcher };
}

beforeEach(() => {
  const frameGroup = {
    width: 1, height: 1, exactSize: 32, layers: 1,
    numPatternX: 1, numPatternY: 1, numPatternZ: 1,
    animationPhases: 1, spriteIds: [1],
  };
  setItemWireFlags({
    signature: 0, itemCount: ARROWS_ID, creatureCount: 0, effectCount: 0, missileCount: 0,
    items: [{ id: ARROWS_ID, category: ThingCategory.Item, attrs: new Map([[DatAttr.Stackable, true]]), frameGroup }],
    creatures: [], effects: [], missiles: [],
  } as unknown as DatFile);
});

afterEach(() => {
  resetItemWireFlags();
  document.body.replaceChildren();
});

describe('bindInventory', () => {
  it('fills a slot from 0x78 (stackable count included) and clears it on 0x79', () => {
    const { client, dispatcher } = makeClient();
    bindInventory(client);

    const set = new OutputPacket();
    set.addU8(0x78);
    set.addU8(10); // ammo slot
    set.addU16(ARROWS_ID);
    set.addU8(38);
    dispatcher.dispatch(new InputPacket(set.toArrayBuffer()));

    const pane = document.querySelector('.inventory-pane')!;
    const ammoCell = [...pane.querySelectorAll('.slot')].find((c) => c.textContent?.includes('#2544'))!;
    expect(ammoCell).toBeDefined();
    expect(ammoCell.querySelector('.count')?.textContent).toBe('38');

    const clear = new OutputPacket();
    clear.addU8(0x79);
    clear.addU8(10);
    dispatcher.dispatch(new InputPacket(clear.toArrayBuffer()));
    expect(pane.textContent).not.toContain('#2544');
  });

  it('starts hidden and toggle() shows it', () => {
    const { client, dispatcher } = makeClient();
    const binding = bindInventory(client);

    const set = new OutputPacket();
    set.addU8(0x78); set.addU8(1); set.addU16(ARROWS_ID); set.addU8(1);
    dispatcher.dispatch(new InputPacket(set.toArrayBuffer()));

    const pane = document.querySelector('.inventory-pane') as HTMLElement;
    expect(pane.style.display).toBe('none');
    binding.toggle();
    expect(pane.style.display).toBe('grid');
  });

  it('destroy unregisters handlers and removes the pane', () => {
    const { client, dispatcher } = makeClient();
    const binding = bindInventory(client);
    const set = new OutputPacket();
    set.addU8(0x78); set.addU8(1); set.addU16(ARROWS_ID); set.addU8(1);
    dispatcher.dispatch(new InputPacket(set.toArrayBuffer()));

    binding.destroy();
    expect(document.querySelector('.inventory-pane')).toBeNull();
  });
});
