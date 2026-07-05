import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bindContainers } from '../lib/jamera/containerBinding';
import { ContainerManager } from '../lib/containers';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { registerWireSkips } from '../lib/net/7.6/wireSkips';
import { setItemWireFlags, resetItemWireFlags } from '../lib/net/common/itemFlags';
import { ThingCategory, DatAttr } from '../lib/dat';
import type { DatFile } from '../lib/dat';
import type { GameClient } from '../lib/net/common/GameClient';

const STACKABLE_ID = 3031;
const BAG_ID = 2853;

function makeDat(): DatFile {
  const frameGroup = {
    width: 1, height: 1, exactSize: 32, layers: 1,
    numPatternX: 1, numPatternY: 1, numPatternZ: 1,
    animationPhases: 1, spriteIds: [1],
  };
  return {
    signature: 0,
    itemCount: STACKABLE_ID,
    creatureCount: 0,
    effectCount: 0,
    missileCount: 0,
    items: [
      { id: BAG_ID, category: ThingCategory.Item, attrs: new Map(), frameGroup },
      { id: STACKABLE_ID, category: ThingCategory.Item, attrs: new Map([[DatAttr.Stackable, true]]), frameGroup },
    ],
    creatures: [],
    effects: [],
    missiles: [],
  } as unknown as DatFile;
}

beforeEach(() => setItemWireFlags(makeDat()));
afterEach(() => resetItemWireFlags());

function makeClient() {
  const protocol = new GameProtocol();
  const dispatcher = new PacketDispatcher();
  const client = {
    getProtocol: () => protocol,
    getDispatcher: () => dispatcher,
  } as unknown as GameClient;
  return { client, dispatcher, protocol };
}

function openFrame(cid: number, name: string, items: Array<{ id: number; count?: number }>): OutputPacket {
  const out = new OutputPacket();
  out.addU8(0x6e);
  out.addU8(cid);
  out.addU16(BAG_ID);
  out.addString(name);
  out.addU8(8);
  out.addU8(0);
  out.addU8(items.length);
  for (const item of items) {
    out.addU16(item.id);
    if (item.count !== undefined) out.addU8(item.count);
  }
  return out;
}

describe('bindContainers', () => {
  it('overrides the wireSkips and mirrors a full open/add/update/remove/close cycle', () => {
    const { client, dispatcher } = makeClient();
    registerWireSkips(dispatcher, client.getProtocol());
    const binding = bindContainers(client);
    const events: number[] = [];
    binding.manager.subscribe(() => events.push(binding.manager.get(3)?.items.length ?? -1));

    dispatcher.dispatch(new InputPacket(openFrame(3, 'Dead Rat', [{ id: BAG_ID }]).toArrayBuffer()));
    expect(binding.manager.get(3)?.name).toBe('Dead Rat');

    // 0x70 add — prepends at slot 0
    const add = new OutputPacket();
    add.addU8(0x70);
    add.addU8(3);
    add.addU16(STACKABLE_ID);
    add.addU8(12);
    dispatcher.dispatch(new InputPacket(add.toArrayBuffer()));
    expect(binding.manager.get(3)?.items).toEqual([{ id: STACKABLE_ID, count: 12 }, { id: BAG_ID }]);

    // 0x71 update slot 1
    const update = new OutputPacket();
    update.addU8(0x71);
    update.addU8(3);
    update.addU8(1);
    update.addU16(STACKABLE_ID);
    update.addU8(99);
    dispatcher.dispatch(new InputPacket(update.toArrayBuffer()));
    expect(binding.manager.get(3)?.items[1]).toEqual({ id: STACKABLE_ID, count: 99 });

    // 0x72 remove slot 0
    const remove = new OutputPacket();
    remove.addU8(0x72);
    remove.addU8(3);
    remove.addU8(0);
    dispatcher.dispatch(new InputPacket(remove.toArrayBuffer()));
    expect(binding.manager.get(3)?.items).toEqual([{ id: STACKABLE_ID, count: 99 }]);

    // 0x6F close
    const close = new OutputPacket();
    close.addU8(0x6f);
    close.addU8(3);
    dispatcher.dispatch(new InputPacket(close.toArrayBuffer()));
    expect(binding.manager.get(3)).toBeUndefined();
    expect(events.length).toBe(5); // open, add, update, remove, close each notify
  });

  it('destroy() unregisters the handlers and clears state', () => {
    const { client, dispatcher } = makeClient();
    registerWireSkips(dispatcher, client.getProtocol());
    const binding = bindContainers(client);

    dispatcher.dispatch(new InputPacket(openFrame(0, 'Backpack', []).toArrayBuffer()));
    expect(binding.manager.get(0)).toBeDefined();
    binding.destroy();
    expect(binding.manager.get(0)).toBeUndefined();
  });
});

describe('ContainerManager', () => {
  it('re-open on the same id replaces the window in place (up-arrow rebind)', () => {
    const manager = new ContainerManager();
    manager.open({ containerId: 1, containerItemId: BAG_ID, name: 'Bag', capacity: 8, hasParent: true, items: [{ id: STACKABLE_ID, count: 5 }] });
    manager.open({ containerId: 1, containerItemId: BAG_ID, name: 'Backpack', capacity: 20, hasParent: false, items: [] });
    expect(manager.list).toHaveLength(1);
    expect(manager.get(1)?.name).toBe('Backpack');
    expect(manager.get(1)?.items).toEqual([]);
  });

  it('ignores updates for unknown ids and out-of-range slots', () => {
    const manager = new ContainerManager();
    manager.updateItem(9, 0, { id: BAG_ID });
    manager.removeItem(9, 0);
    manager.open({ containerId: 0, containerItemId: BAG_ID, name: 'Bag', capacity: 8, hasParent: false, items: [] });
    manager.updateItem(0, 2, { id: BAG_ID });
    manager.removeItem(0, 2);
    expect(manager.get(0)?.items).toEqual([]);
  });

  it('nextFreeId picks the first gap and falls back to 0 when all 16 are open', () => {
    const manager = new ContainerManager();
    expect(manager.nextFreeId()).toBe(0);
    for (let id = 0; id <= 15; id++) {
      manager.open({ containerId: id, containerItemId: BAG_ID, name: `C${id}`, capacity: 8, hasParent: false, items: [] });
    }
    expect(manager.nextFreeId()).toBe(0);
    manager.close(7);
    expect(manager.nextFreeId()).toBe(7);
  });
});
