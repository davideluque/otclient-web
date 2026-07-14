// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindInteractions, type ThingRef } from '../lib/jamera/interactions';
import { bindContainers } from '../lib/jamera/containerBinding';
import { bindInventory } from '../lib/jamera/inventoryBinding';
import { buildUseItemWithPacket } from '../lib/net/7.6/actionsProtocol';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { containerSlotPosition, inventorySlotPosition } from '../lib/net/common/virtualPosition';
import { setItemWireFlags, resetItemWireFlags } from '../lib/net/common/itemFlags';
import { ThingCategory } from '../lib/dat';
import type { DatFile } from '../lib/dat';
import type { GameClient } from '../lib/net/common/GameClient';
import type { Application } from 'pixi.js';
import type { GameWorld } from '../lib/GameWorld';
import type { MapTile } from '../lib/net/common/types';

const ROPE_ID = 3031; // 0x0bd7
const BAG_ID = 2853; // 0x0b25

describe('buildUseItemWithPacket', () => {
  it('is opcode + from triple + to triple, virtual positions included', () => {
    const b = buildUseItemWithPacket(
      containerSlotPosition(2, 1), ROPE_ID, 1,
      { x: 100, y: 200, z: 7 }, 1987, 0,
    ).toUint8Array();
    expect([...b]).toEqual([
      0x83,
      0xff, 0xff, 0x42, 0x00, 0x01, // from: container 2, slot 1
      0xd7, 0x0b, // fromSpriteId 3031
      0x01, // fromStackpos = slot
      0x64, 0x00, 0xc8, 0x00, 0x07, // to: map tile
      0xc3, 0x07, // toSpriteId 1987
      0x00, // toStackpos
    ]);
  });
});

describe('crosshair (use-with) mode', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  const ropeFrom: ThingRef = { position: containerSlotPosition(2, 1), thingId: ROPE_ID, stackPos: 1 };
  const armedPacket = [
    0x83,
    0xff, 0xff, 0x42, 0x00, 0x01,
    0xd7, 0x0b,
    0x01,
    0x64, 0x00, 0xc8, 0x00, 0x07, // the tapped tile (player tile at screen center)
    0xc3, 0x07, // its top thing, id 1987
    0x00, // at stackpos 0
  ];

  function mount(tileOverride?: MapTile) {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    document.body.appendChild(canvas);
    const tile: MapTile = tileOverride ?? {
      x: 100,
      y: 200,
      z: 7,
      things: [{ kind: 'item', item: { id: 1987 } }],
      items: [{ id: 1987 }],
      creatures: [],
    };
    const liveApp = { canvas, screen: { width: 800, height: 600 } } as unknown as Application;
    const liveWorld = {
      playerX: 100, playerY: 200, playerZ: 7, playerCreatureId: 1,
      getTile: () => tile,
    } as unknown as GameWorld;
    const sent: number[][] = [];
    const client = {
      getProtocol: () => new GameProtocol(),
      send: (p: { toUint8Array(): Uint8Array }) => sent.push([...p.toUint8Array()]),
    } as unknown as GameClient;
    // Every tile is plain walkable ground (id 1987, no blocking attrs).
    const datIndex = new Map([[1987, { id: 1987, attrs: new Map() }]]) as never;
    const handle = bindInteractions(client, liveWorld, liveApp, datIndex);
    const touch = (type: string, pointerId: number, clientX: number, clientY: number) =>
      canvas.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId, clientX, clientY, bubbles: true }));
    const tap = (clientX: number, clientY: number) => {
      touch('pointerdown', 1, clientX, clientY);
      touch('pointerup', 1, clientX, clientY);
    };
    return { handle, canvas, sent, touch, tap };
  }

  const hint = (): HTMLElement | null => document.querySelector('.use-with-hint');

  it('armed tap sends the exact 0x83 (container slot → tile top thing), disarms, and the next tap walks again', () => {
    const { handle, canvas, sent, tap } = mount();
    handle.armUseWith(ropeFrom);
    expect(hint()).not.toBeNull();
    expect(canvas.style.cursor).toBe('crosshair');

    tap(400, 300); // player tile at screen center
    expect(sent).toEqual([armedPacket]);
    expect(hint()).toBeNull();
    expect(canvas.style.cursor).toBe('');

    tap(400 + 64, 300); // disarmed: back to tap-to-walk
    expect(sent[1]).toEqual([0x64, 2, 1, 1]);
    handle.destroy();
  });

  it('armed desktop click fires the 0x83 instead of walking', () => {
    const { handle, canvas, sent } = mount();
    handle.armUseWith(ropeFrom);
    canvas.dispatchEvent(new MouseEvent('click', { button: 0, clientX: 400, clientY: 300, bubbles: true }));
    expect(sent).toEqual([armedPacket]);
    handle.destroy();
  });

  it('the hint ✕ and cancelUseWith disarm without sending; taps walk again', () => {
    const { handle, sent, tap } = mount();
    handle.armUseWith(ropeFrom);
    hint()!.querySelector('button')!.click();
    expect(hint()).toBeNull();

    handle.armUseWith(ropeFrom);
    handle.cancelUseWith();
    expect(hint()).toBeNull();

    tap(400 + 64, 300);
    expect(sent).toEqual([[0x64, 2, 1, 1]]);
    handle.destroy();
  });

  it('a long-press while armed cancels the mode instead of looking', () => {
    const { handle, sent, touch } = mount();
    handle.armUseWith(ropeFrom);
    touch('pointerdown', 1, 400, 300);
    vi.advanceTimersByTime(600);
    touch('pointerup', 1, 400, 300);
    expect(sent).toEqual([]);
    expect(hint()).toBeNull();
    handle.destroy();
  });

  it('re-arming replaces the pending source without stacking hints', () => {
    const { handle, sent, tap } = mount();
    handle.armUseWith({ position: containerSlotPosition(0, 0), thingId: BAG_ID, stackPos: 0 });
    handle.armUseWith(ropeFrom);
    expect(document.querySelectorAll('.use-with-hint')).toHaveLength(1);
    tap(400, 300);
    expect(sent).toEqual([armedPacket]);
    handle.destroy();
  });

  it('destroy removes the hint and cursor of an armed mode', () => {
    const { handle, canvas } = mount();
    handle.armUseWith(ropeFrom);
    handle.destroy();
    expect(hint()).toBeNull();
    expect(canvas.style.cursor).toBe('');
  });

  it('armed trade taps a creature once and sends the offered item plus player id', () => {
    const playerId = 0x10203040;
    const tile: MapTile = {
      x: 100, y: 200, z: 7,
      things: [{ kind: 'creature', creature: { id: playerId } as never }],
      items: [], creatures: [{ id: playerId } as never],
    };
    const { handle, sent, tap } = mount(tile);
    handle.armTrade(ropeFrom);
    expect(hint()?.textContent).toContain('Tap a player to trade');
    tap(400, 300);
    expect(sent).toEqual([[
      0x7d,
      0xff, 0xff, 0x42, 0x00, 0x01,
      0xd7, 0x0b, 0x01,
      0x40, 0x30, 0x20, 0x10,
    ]]);
    expect(hint()).toBeNull();
    handle.destroy();
  });
});

describe('action-sheet arming', () => {
  beforeEach(() => {
    const frameGroup = {
      width: 1, height: 1, exactSize: 32, layers: 1,
      numPatternX: 1, numPatternY: 1, numPatternZ: 1,
      animationPhases: 1, spriteIds: [1],
    };
    setItemWireFlags({
      signature: 0,
      itemCount: BAG_ID,
      creatureCount: 0,
      effectCount: 0,
      missileCount: 0,
      items: [{ id: BAG_ID, category: ThingCategory.Item, attrs: new Map(), frameGroup }],
      creatures: [],
      effects: [],
      missiles: [],
    } as unknown as DatFile);
  });
  afterEach(() => {
    resetItemWireFlags();
    document.body.replaceChildren();
  });

  function makeClient() {
    const protocol = new GameProtocol();
    const dispatcher = new PacketDispatcher();
    const client = {
      getProtocol: () => protocol,
      getDispatcher: () => dispatcher,
      send: () => {},
    } as unknown as GameClient;
    return { client, dispatcher };
  }

  function sheetButton(label: string): HTMLElement | undefined {
    return [...document.querySelectorAll<HTMLElement>('.action-sheet button')]
      .find((b) => b.textContent === label);
  }

  it('container item sheet offers Use with… and arms with the slot\'s virtual position', () => {
    const { client, dispatcher } = makeClient();
    const armed: ThingRef[] = [];
    bindContainers(client, document.body, { armUseWith: (from) => armed.push(from) });
    const open = new OutputPacket();
    open.addU8(0x6e);
    open.addU8(3); // cid
    open.addU16(BAG_ID);
    open.addString('Dead Rat');
    open.addU8(6);
    open.addU8(0);
    open.addU8(2);
    open.addU16(BAG_ID);
    open.addU16(BAG_ID);
    dispatcher.dispatch(new InputPacket(open.toArrayBuffer()));

    document.querySelectorAll<HTMLElement>('.container-pane .cell.filled')[1].click();
    sheetButton('Use with…')!.click();

    expect(armed).toEqual([{ position: containerSlotPosition(3, 1), thingId: BAG_ID, stackPos: 1 }]);
    expect(document.querySelector('.action-sheet-backdrop')).toBeNull();
  });

  it('inventory slot sheet offers Use with… and arms with the equipment slot; both sheets omit it without a provider', () => {
    const { client, dispatcher } = makeClient();
    const armed: ThingRef[] = [];
    bindInventory(client, document.body, { armUseWith: (from) => armed.push(from) });
    const set = new OutputPacket();
    set.addU8(0x78);
    set.addU8(10); // ammo slot
    set.addU16(BAG_ID);
    dispatcher.dispatch(new InputPacket(set.toArrayBuffer()));

    document.querySelector<HTMLElement>('.inventory-pane .slot.filled')!.click();
    sheetButton('Use with…')!.click();
    expect(armed).toEqual([{ position: inventorySlotPosition(10), thingId: BAG_ID, stackPos: 10 }]);

    document.body.replaceChildren();
    const bare = makeClient();
    bindInventory(bare.client, document.body);
    bare.dispatcher.dispatch(new InputPacket(set.toArrayBuffer()));
    document.querySelector<HTMLElement>('.inventory-pane .slot.filled')!.click();
    expect(sheetButton('Use with…')).toBeUndefined();
  });

  it('item sheets expose Trade with… only when a trade arming provider exists', () => {
    const { client, dispatcher } = makeClient();
    const armed: ThingRef[] = [];
    bindInventory(client, document.body, { armTrade: (from) => armed.push(from) });
    const set = new OutputPacket();
    set.addU8(0x78);
    set.addU8(10);
    set.addU16(BAG_ID);
    dispatcher.dispatch(new InputPacket(set.toArrayBuffer()));
    document.querySelector<HTMLElement>('.inventory-pane .slot.filled')!.click();
    sheetButton('Trade with…')!.click();
    expect(armed).toEqual([{
      position: inventorySlotPosition(10), thingId: BAG_ID, stackPos: 10,
    }]);
  });
});
