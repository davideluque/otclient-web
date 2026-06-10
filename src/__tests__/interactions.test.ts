// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindInteractions, screenToWorldTile } from '../lib/jamera/interactions';
import { buildLookAtPacket, buildUseItemPacket, buildLogoutPacket } from '../lib/net/7.6/actionsProtocol';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import type { GameClient } from '../lib/net/common/GameClient';
import type { Application } from 'pixi.js';
import type { GameWorld } from '../lib/GameWorld';

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

  function mount() {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    document.body.appendChild(canvas);
    const liveApp = { canvas, screen: { width: 800, height: 600 } } as unknown as Application;
    const liveWorld = {
      playerX: 100, playerY: 200, playerZ: 7,
      getTile: () => ({ items: [{ id: 1987 }] }),
    } as unknown as GameWorld;
    const sent: number[][] = [];
    const client = {
      getProtocol: () => new GameProtocol(),
      send: (p: { toUint8Array(): Uint8Array }) => sent.push([...p.toUint8Array()]),
    } as unknown as GameClient;
    const handle = bindInteractions(client, liveWorld, liveApp);
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
