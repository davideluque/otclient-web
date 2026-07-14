// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindInteractions, floorChangeTileAtPointer, screenToWorldTile } from '../lib/jamera/interactions';
import { buildLookAtPacket, buildUseItemPacket, buildLogoutPacket } from '../lib/net/7.6/actionsProtocol';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { DatAttr } from '../lib/dat';
import type { GameClient } from '../lib/net/common/GameClient';
import type { Application } from 'pixi.js';
import type { GameWorld } from '../lib/GameWorld';
import type { MapTile } from '../lib/net/common/types';

const app = { screen: { width: 800, height: 600 } } as Application;
const world = { playerX: 100, playerY: 200, playerZ: 7 } as GameWorld;

describe('screenToWorldTile', () => {
  it('maps the screen center to the player tile', () => {
    expect(screenToWorldTile(app, world, 400, 300)).toEqual({ x: 100, y: 200, z: 7 });
  });

  it('maps one tile east/south correctly', () => {
    expect(screenToWorldTile(app, world, 400 + 32, 300)).toEqual({ x: 101, y: 200, z: 7 });
    expect(screenToWorldTile(app, world, 400, 300 + 32)).toEqual({ x: 100, y: 201, z: 7 });
  });

  it('handles the half-tile boundary around the center', () => {
    // Player tile spans ±16px around center (the 0.5 centering offset).
    expect(screenToWorldTile(app, world, 400 + 15, 300).x).toBe(100);
    expect(screenToWorldTile(app, world, 400 + 17, 300).x).toBe(101);
  });

  it('accounts for the stage cover-zoom', () => {
    // At zoom 2 one tile is 64 canvas px; 64px east of center is +1 tile.
    const zoomed = { ...app, stage: { scale: { x: 2 } } } as unknown as Application;
    expect(screenToWorldTile(zoomed, world, 400 + 64, 300)).toEqual({ x: 101, y: 200, z: 7 });
    // Tile spans ±32px around center at zoom 2 — +31px is still the player tile.
    expect(screenToWorldTile(zoomed, world, 400 + 31, 300).x).toBe(100);
  });
});

describe('floorChangeTileAtPointer', () => {
  const frameGroup = {
    width: 2, height: 2, exactSize: 64, layers: 1,
    numPatternX: 1, numPatternY: 1, numPatternZ: 1,
    animationPhases: 1, spriteIds: [1, 2, 3, 4],
  };
  const datIndex = new Map([[1947, { id: 1947, attrs: new Map(), frameGroup }]]) as Map<number, never>;
  const stair = {
    x: 101, y: 201, z: 7,
    things: [{ kind: 'item', item: { id: 1947 } }],
    items: [{ id: 1947 }], creatures: [],
  } as MapTile;
  const liveWorld = {
    getTile: (x: number, y: number, z: number) => x === 101 && y === 201 && z === 7 ? stair : undefined,
  } as unknown as GameWorld;

  it('maps every visible piece of a multi-tile stair to its anchor tile', () => {
    const floorChanges = new Set([1947]);
    for (const [x, y] of [[100, 200], [101, 200], [100, 201], [101, 201]]) {
      expect(floorChangeTileAtPointer(liveWorld, datIndex, { x, y, z: 7 }, floorChanges))
        .toEqual({ x: 101, y: 201, z: 7 });
    }
  });

  it('leaves ordinary ground taps unchanged', () => {
    expect(floorChangeTileAtPointer(liveWorld, datIndex, { x: 99, y: 199, z: 7 }, new Set([1947])))
      .toEqual({ x: 99, y: 199, z: 7 });
  });
});

describe('actions packets', () => {
  it('LookAt is pos + spriteId + stackpos', () => {
    const b = buildLookAtPacket({ x: 0x1234, y: 0x5678, z: 7 }, 1987, 2).toUint8Array();
    expect([...b]).toEqual([0x8c, 0x34, 0x12, 0x78, 0x56, 7, 0xc3, 0x07, 2]);
  });

  it('UseItem is pos + spriteId + stackpos + index', () => {
    const b = buildUseItemPacket({ x: 1, y: 2, z: 7 }, 100, 0).toUint8Array();
    expect([...b]).toEqual([0x82, 1, 0, 2, 0, 7, 100, 0, 0, 0]);
  });

  it('Logout is the bare opcode', () => {
    expect([...buildLogoutPacket().toUint8Array()]).toEqual([0x14]);
  });
});

describe('long-press pointer tracking', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function mount(tile?: MapTile, opts?: {
    nextContainerId?: () => number;
    floorChangeIds?: Set<number>;
    useableIds?: Set<number>;
    tapToWalk?: () => boolean;
  }) {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    document.body.appendChild(canvas);
    const defaultTile: MapTile = {
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
      getTile: () => tile ?? defaultTile,
    } as unknown as GameWorld;
    const sent: number[][] = [];
    const client = {
      getProtocol: () => new GameProtocol(),
      send: (p: { toUint8Array(): Uint8Array }) => sent.push([...p.toUint8Array()]),
    } as unknown as GameClient;
    // The default target is a walkable container item (id 1987); tests
    // that need a non-container target pass id 200 explicitly.
    const datIndex = new Map([
      [1987, { id: 1987, attrs: new Map([[DatAttr.Container, true]]) }],
      [200, { id: 200, attrs: new Map() }],
    ]) as never;
    const handle = bindInteractions(client, liveWorld, liveApp, datIndex, opts);
    const touch = (type: string, pointerId: number, clientX: number, clientY: number) =>
      canvas.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId, clientX, clientY, bubbles: true }));
    return { handle, canvas, sent, touch };
  }

  it('a second finger neither cancels nor hijacks the press', () => {
    const { handle, sent, touch } = mount();
    touch('pointerdown', 1, 400, 300);
    // Second finger lands elsewhere, wiggles, and lifts — joystick-style.
    touch('pointerdown', 2, 50, 550);
    touch('pointermove', 2, 90, 500);
    touch('pointerup', 2, 90, 500);
    vi.advanceTimersByTime(600);
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(0x8c); // LookAt fired from finger 1's press
    handle.destroy();
  });

  it('a quick tap walks: one 0x64 autowalk with the A* route', () => {
    const { handle, sent, touch } = mount();
    // Two tiles east of center (player tile center is at 400,300).
    touch('pointerdown', 1, 400 + 64, 300);
    touch('pointerup', 1, 400 + 64, 300);
    vi.advanceTimersByTime(600); // long-press must NOT also fire
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([0x64, 2, 1, 1]); // count 2, east east
    handle.destroy();
  });

  it('a single touch tap uses a corpse/container instead of relying on iOS dblclick', () => {
    const { handle, sent, touch } = mount(undefined, { useableIds: new Set([1987]) });
    touch('pointerdown', 1, 400, 300);
    touch('pointerup', 1, 400, 300);

    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(0x82); // UseItem
    handle.destroy();
  });

  it('keeps object taps active when tap-to-walk is disabled', () => {
    const { handle, sent, touch } = mount(undefined, {
      useableIds: new Set([1987]),
      tapToWalk: () => false,
    });
    touch('pointerdown', 1, 400, 300);
    touch('pointerup', 1, 400, 300);
    expect(sent[0][0]).toBe(0x82);
    handle.destroy();
  });

  it('does not walk ordinary ground when tap-to-walk is disabled', () => {
    const { handle, sent, touch } = mount(undefined, { tapToWalk: () => false });
    touch('pointerdown', 1, 464, 300);
    touch('pointerup', 1, 464, 300);
    expect(sent).toHaveLength(0);
    handle.destroy();
  });

  it('a wandering release does not walk', () => {
    const { handle, sent, touch } = mount();
    touch('pointerdown', 1, 400, 300);
    touch('pointerup', 1, 460, 300); // moved beyond tolerance
    expect(sent).toHaveLength(0);
    handle.destroy();
  });

  it('the pressing finger still cancels by moving or lifting', () => {
    const { handle, sent, touch } = mount();
    touch('pointerdown', 1, 400, 300);
    touch('pointermove', 1, 440, 300); // beyond tolerance
    vi.advanceTimersByTime(600);
    expect(sent).toHaveLength(0);

    touch('pointerdown', 1, 400, 300);
    touch('pointerup', 1, 400, 300);
    vi.advanceTimersByTime(600);
    expect(sent).toHaveLength(0);
    handle.destroy();
  });

  it('uses the full wire stack position when creatures split item views', () => {
    const ground = { id: 100 };
    const corpse = { id: 1987 };
    const creature = {
      id: 77,
      name: 'Rat',
      x: 100,
      y: 200,
      z: 7,
      direction: 2,
      health: 100,
      outfit: { lookType: 21, head: 0, body: 0, legs: 0, feet: 0 },
      lightLevel: 0,
      lightColor: 0,
      speed: 220,
    };
    const tile: MapTile = {
      x: 100,
      y: 200,
      z: 7,
      things: [
        { kind: 'item', item: ground },
        { kind: 'creature', creature },
        { kind: 'item', item: corpse },
      ],
      items: [ground, corpse],
      creatures: [creature],
    };
    const { canvas, handle, sent } = mount(tile);
    canvas.dispatchEvent(new MouseEvent('dblclick', { button: 0, clientX: 400, clientY: 300, bubbles: true }));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([0x82, 100, 0, 200, 0, 7, 0xc3, 0x07, 2, 0]);
    handle.destroy();
  });

  it('uses the client-chosen container window id as 0x82\'s index byte', () => {
    const { canvas, handle, sent } = mount(undefined, { nextContainerId: () => 5 });
    canvas.dispatchEvent(new MouseEvent('dblclick', { button: 0, clientX: 400, clientY: 300, bubbles: true }));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([0x82, 100, 0, 200, 0, 7, 0xc3, 0x07, 0, 5]);
    handle.destroy();
  });

  it('does not reserve a container window id for non-container uses', () => {
    const nextContainerId = vi.fn(() => 5);
    const tile: MapTile = {
      x: 100,
      y: 200,
      z: 7,
      things: [{ kind: 'item', item: { id: 200 } }],
      items: [{ id: 200 }],
      creatures: [],
    };
    const { canvas, handle, sent } = mount(tile, { nextContainerId });
    canvas.dispatchEvent(new MouseEvent('dblclick', { button: 0, clientX: 400, clientY: 300, bubbles: true }));

    expect(nextContainerId).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([0x82, 100, 0, 200, 0, 7, 200, 0, 0, 0]);
    handle.destroy();
  });

  it('falls back to window 0 without a nextContainerId provider', () => {
    const { canvas, handle, sent } = mount();
    canvas.dispatchEvent(new MouseEvent('dblclick', { button: 0, clientX: 400, clientY: 300, bubbles: true }));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([0x82, 100, 0, 200, 0, 7, 0xc3, 0x07, 0, 0]);
    handle.destroy();
  });

  it('looks at a creature instead of the ground underneath it', () => {
    const ground = { id: 100 };
    const creature = {
      id: 77,
      name: 'Rat',
      x: 100,
      y: 200,
      z: 7,
      direction: 2,
      health: 100,
      outfit: { lookType: 21, head: 0, body: 0, legs: 0, feet: 0 },
      lightLevel: 0,
      lightColor: 0,
      speed: 220,
    };
    const tile: MapTile = {
      x: 100,
      y: 200,
      z: 7,
      things: [
        { kind: 'item', item: ground },
        { kind: 'creature', creature },
      ],
      items: [ground],
      creatures: [creature],
    };
    const { canvas, handle, sent } = mount(tile);
    canvas.dispatchEvent(new MouseEvent('contextmenu', { button: 2, clientX: 400, clientY: 300, bubbles: true }));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([0x8c, 100, 0, 200, 0, 7, 77, 0, 1]);
    handle.destroy();
  });
});

describe('toCanvasSpace', () => {
  it('compensates canvas offset and CSS scaling', async () => {
    const { toCanvasSpace } = await import('../lib/jamera/interactions');
    const canvas = {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }),
    } as unknown as HTMLCanvasElement;
    // Logical screen 800×600 rendered into a 400×300 box at (100,50):
    // a click at the box center maps to the logical center.
    expect(toCanvasSpace(canvas, { width: 800, height: 600 }, 300, 200)).toEqual({ x: 400, y: 300 });
  });
});
