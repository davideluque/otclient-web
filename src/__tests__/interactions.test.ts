// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { screenToWorldTile } from '../lib/jamera/interactions';
import { buildLookAtPacket, buildUseItemPacket, buildLogoutPacket } from '../lib/net/7.6/actionsProtocol';
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
