// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bindContainers } from '../lib/jamera/containerBinding';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { setItemWireFlags, resetItemWireFlags } from '../lib/net/common/itemFlags';
import { ThingCategory, DatAttr } from '../lib/dat';
import type { DatFile } from '../lib/dat';
import type { GameClient } from '../lib/net/common/GameClient';

const STACKABLE_ID = 3031; // 0x0BD7
const BAG_ID = 2853;

beforeEach(() => {
  const frameGroup = {
    width: 1, height: 1, exactSize: 32, layers: 1,
    numPatternX: 1, numPatternY: 1, numPatternZ: 1,
    animationPhases: 1, spriteIds: [1],
  };
  setItemWireFlags({
    signature: 0, itemCount: STACKABLE_ID, creatureCount: 0, effectCount: 0, missileCount: 0,
    items: [
      { id: BAG_ID, category: ThingCategory.Item, attrs: new Map(), frameGroup },
      { id: STACKABLE_ID, category: ThingCategory.Item, attrs: new Map([[DatAttr.Stackable, true]]), frameGroup },
    ],
    creatures: [], effects: [], missiles: [],
  } as unknown as DatFile);
});

afterEach(() => {
  resetItemWireFlags();
  document.body.replaceChildren();
});

function makeClient() {
  const protocol = new GameProtocol();
  const dispatcher = new PacketDispatcher();
  const sent: number[][] = [];
  const client = {
    getProtocol: () => protocol,
    getDispatcher: () => dispatcher,
    send: (p: { toUint8Array(): Uint8Array }) => sent.push([...p.toUint8Array()]),
  } as unknown as GameClient;
  return { client, dispatcher, sent };
}

function openFrame(
  cid: number,
  name: string,
  items: Array<{ id: number; count?: number }>,
  { capacity = 8, hasParent = false } = {},
): InputPacket {
  const out = new OutputPacket();
  out.addU8(0x6e);
  out.addU8(cid);
  out.addU16(BAG_ID);
  out.addString(name);
  out.addU8(capacity);
  out.addU8(hasParent ? 1 : 0);
  out.addU8(items.length);
  for (const item of items) {
    out.addU16(item.id);
    if (item.count !== undefined) out.addU8(item.count);
  }
  return new InputPacket(out.toArrayBuffer());
}

const pane = () => document.querySelector('.container-pane') as HTMLElement;
const headButton = (win: Element, text: string) =>
  [...win.querySelectorAll<HTMLButtonElement>('.head button')].find((b) => b.textContent === text);

describe('bindContainers with a pane', () => {
  it('renders a 0x6E frame: window with name, filled cells, count badge, empty padding', () => {
    const { client, dispatcher } = makeClient();
    bindContainers(client, document.body);
    expect(pane().style.display).toBe('none');

    dispatcher.dispatch(openFrame(3, 'Dead Rat', [{ id: BAG_ID }, { id: STACKABLE_ID, count: 12 }]));

    expect(pane().style.display).toBe('flex');
    const win = pane().querySelector('.window')!;
    expect(win.querySelector('.name')?.textContent).toBe('Dead Rat');
    const cells = win.querySelectorAll('.cell');
    expect(cells).toHaveLength(8); // capacity pads with dimmed empties
    expect(win.querySelectorAll('.cell.filled')).toHaveLength(2);
    expect(cells[0].textContent).toContain(`#${BAG_ID}`);
    expect(cells[1].querySelector('.count')?.textContent).toBe('12');
  });

  it('✕ sends 0x87 with the window id', () => {
    const { client, dispatcher, sent } = makeClient();
    bindContainers(client, document.body);
    dispatcher.dispatch(openFrame(5, 'Bag', []));

    headButton(pane().querySelector('.window')!, '✕')!.click();
    expect(sent).toEqual([[0x87, 5]]);
  });

  it('⬆ only exists for nested containers and sends 0x88', () => {
    const { client, dispatcher, sent } = makeClient();
    bindContainers(client, document.body);
    dispatcher.dispatch(openFrame(0, 'Backpack', []));
    expect(headButton(pane().querySelector('.window')!, '⬆')).toBeUndefined();

    dispatcher.dispatch(openFrame(0, 'Bag', [], { hasParent: true }));
    headButton(pane().querySelector('.window')!, '⬆')!.click();
    expect(sent).toEqual([[0x88, 0]]);
  });

  it('tapping an item sends 0x8C at the virtual container-slot position', () => {
    const { client, dispatcher, sent } = makeClient();
    bindContainers(client, document.body);
    dispatcher.dispatch(openFrame(3, 'Bag', [{ id: BAG_ID }, { id: STACKABLE_ID, count: 12 }]));

    pane().querySelectorAll<HTMLButtonElement>('.cell.filled')[1].click();
    // pos x=0xFFFF, y=0x40|cid (u16le), z=slot, then u16le itemId + slot.
    expect(sent).toEqual([[0x8c, 0xff, 0xff, 0x43, 0x00, 0x01, 0xd7, 0x0b, 0x01]]);
  });

  it('hides when the last window closes and destroy removes the pane', () => {
    const { client, dispatcher } = makeClient();
    const binding = bindContainers(client, document.body);
    dispatcher.dispatch(openFrame(2, 'Bag', []));
    expect(pane().style.display).toBe('flex');

    const close = new OutputPacket();
    close.addU8(0x6f);
    close.addU8(2);
    dispatcher.dispatch(new InputPacket(close.toArrayBuffer()));
    expect(pane().style.display).toBe('none');

    binding.destroy();
    expect(document.querySelector('.container-pane')).toBeNull();
  });
});
