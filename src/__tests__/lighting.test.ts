import { describe, it, expect } from 'vitest';
import { computeAmbient, gatherLights, tibiaColorToHex } from '../lib/lighting';
import { DatAttr, ThingCategory } from '../lib/dat';
import { TileMap } from '../lib/tileMap';
import type { ThingType, FrameGroup } from '../lib/dat';
import type { OtbFile } from '../lib/otb';
import type { OtbmFile } from '../lib/otbm';

function emptyFrameGroup(): FrameGroup {
  return {
    width: 1,
    height: 1,
    exactSize: 32,
    layers: 1,
    numPatternX: 1,
    numPatternY: 1,
    numPatternZ: 1,
    animationPhases: 1,
    spriteIds: [1],
  };
}

function thing(id: number, attrs: ThingType['attrs'] = new Map()): ThingType {
  return { id, category: ThingCategory.Item, attrs, frameGroup: emptyFrameGroup() };
}

describe('tibiaColorToHex', () => {
  it('maps the 0 index to black', () => {
    expect(tibiaColorToHex(0)).toBe(0x000000);
  });

  it('maps the max index to white', () => {
    expect(tibiaColorToHex(215)).toBe(0xffffff);
  });

  it('decodes the 6x6x6 palette cube', () => {
    // index = r*36 + g*6 + b, each component in 0..5 mapped to step*51
    // index 1 → b=1 → (0, 0, 51)
    expect(tibiaColorToHex(1)).toBe(0x000033);
    // index 6 → g=1 → (0, 51, 0)
    expect(tibiaColorToHex(6)).toBe(0x003300);
    // index 36 → r=1 → (51, 0, 0)
    expect(tibiaColorToHex(36)).toBe(0x330000);
    // index 206 → r=5, g=4, b=2 → (255, 204, 102)
    expect(tibiaColorToHex(206)).toBe(0xffcc66);
  });

  it('clamps out-of-range indices', () => {
    expect(tibiaColorToHex(-5)).toBe(0x000000);
    expect(tibiaColorToHex(999)).toBe(0xffffff);
  });
});

describe('gatherLights', () => {
  const otb: OtbFile = {
    version: { version: 1, majorVersion: 1, minorVersion: 1, buildNumber: 1, csdVersion: '' },
    items: [],
    serverToClient: new Map([
      [100, 200], // torch server id 100 → client id 200
      [101, 201], // lamp server id 101 → client id 201
      [102, 202], // non-emitter server id 102 → client id 202
    ]),
    serverIdToFlags: new Map(),
  };

  const datIndex = new Map<number, ThingType>([
    [200, thing(200, new Map([[DatAttr.Light, { intensity: 7, color: 206 }]]))],
    [201, thing(201, new Map([[DatAttr.Light, { intensity: 3, color: 215 }]]))],
    [202, thing(202)], // no light
  ]);

  function makeTileMap(items: { x: number; y: number; z?: number; serverIds: number[] }[]): TileMap {
    const otbm: OtbmFile = {
      header: { version: 1, width: 1, height: 1, majorVersionItems: 1, minorVersionItems: 1 },
      tiles: items.map(t => ({
        position: { x: t.x, y: t.y, z: t.z ?? 7 },
        flags: 0,
        items: t.serverIds.map(id => ({ id })),
      })),
      towns: [],
    };
    return new TileMap(otbm, otb);
  }

  it('emits a light for each emitting item in the visible region', () => {
    const tm = makeTileMap([
      { x: 5, y: 5, serverIds: [100] },
      { x: 6, y: 5, serverIds: [101] },
    ]);
    const lights = [...gatherLights(tm, datIndex, 0, 0, 10, 10, 7)];
    expect(lights).toHaveLength(2);
    expect(lights[0]).toMatchObject({ x: 5, y: 5, intensity: 7, color: tibiaColorToHex(206) });
    expect(lights[1]).toMatchObject({ x: 6, y: 5, intensity: 3, color: tibiaColorToHex(215) });
  });

  it('skips non-emitting items and items with zero intensity', () => {
    const zeroIntensityIndex = new Map(datIndex);
    zeroIntensityIndex.set(200, thing(200, new Map([[DatAttr.Light, { intensity: 0, color: 100 }]])));
    const tm = makeTileMap([{ x: 1, y: 1, serverIds: [100, 102] }]);
    const lights = [...gatherLights(tm, zeroIntensityIndex, 0, 0, 5, 5, 7)];
    expect(lights).toHaveLength(0);
  });

  it('ignores tiles outside the visible region', () => {
    const tm = makeTileMap([
      { x: 1, y: 1, serverIds: [100] },
      { x: 50, y: 50, serverIds: [100] },
    ]);
    const lights = [...gatherLights(tm, datIndex, 0, 0, 10, 10, 7)];
    expect(lights).toHaveLength(1);
    expect(lights[0]).toMatchObject({ x: 1, y: 1 });
  });

  it('ignores tiles on a different floor', () => {
    const tm = makeTileMap([{ x: 1, y: 1, serverIds: [100] }]);
    const lights = [...gatherLights(tm, datIndex, 0, 0, 10, 10, 6)];
    expect(lights).toHaveLength(0);
  });

  it('emits multiple lights when a tile stacks several emitters', () => {
    const tm = makeTileMap([{ x: 2, y: 2, serverIds: [100, 101] }]);
    const lights = [...gatherLights(tm, datIndex, 0, 0, 10, 10, 7)];
    expect(lights).toHaveLength(2);
    expect(lights.map(l => l.intensity).sort()).toEqual([3, 7]);
  });

  it('merges every listed floor into one gather — a torch upstairs lights the view', () => {
    const tm = makeTileMap([
      { x: 5, y: 5, z: 7, serverIds: [100] },
      { x: 6, y: 5, z: 6, serverIds: [101] }, // the floor above the player
    ]);
    const lights = [...gatherLights(tm, datIndex, 0, 0, 10, 10, [7, 6])];
    expect(lights).toHaveLength(2);
    expect(lights.map(l => l.intensity).sort()).toEqual([3, 7]);
  });

  it('stays per-floor-accurate: unlisted floors contribute nothing', () => {
    const tm = makeTileMap([
      { x: 5, y: 5, z: 7, serverIds: [100] },
      { x: 5, y: 6, z: 8, serverIds: [100] }, // underground — never drawn above ground
    ]);
    const lights = [...gatherLights(tm, datIndex, 0, 0, 10, 10, [7, 6, 5])];
    expect(lights).toHaveLength(1);
    expect(lights[0]).toMatchObject({ x: 5, y: 5 });
  });

  it('a roof-culled drawn set gathers only the remaining floors', () => {
    const tm = makeTileMap([
      { x: 5, y: 5, z: 7, serverIds: [100] },
      { x: 6, y: 5, z: 6, serverIds: [101] },
    ]);
    // Indoors: firstVisible === playerZ, the drawn set collapses to [7].
    const lights = [...gatherLights(tm, datIndex, 0, 0, 10, 10, [7])];
    expect(lights).toHaveLength(1);
    expect(lights[0]).toMatchObject({ x: 5, y: 5, intensity: 7 });
  });

  it('the plain-number form still gathers a single floor (offline viewer)', () => {
    const tm = makeTileMap([
      { x: 5, y: 5, z: 7, serverIds: [100] },
      { x: 6, y: 5, z: 6, serverIds: [101] },
    ]);
    expect([...gatherLights(tm, datIndex, 0, 0, 10, 10, 7)]).toHaveLength(1);
  });
});

describe('computeAmbient', () => {
  it('0% is dark even when the server reports full daylight', () => {
    expect(computeAmbient(255, 215, 0)).toBe(0x000000);
  });

  it('100% preserves the server day/night level', () => {
    expect(computeAmbient(255, 215, 100)).toBe(0xffffff);
    expect(computeAmbient(128, 215, 100)).toBe(0x808080);
    expect(computeAmbient(0, 215, 100)).toBe(0x000000);
  });

  it('scales the server light at intermediate brightness', () => {
    expect(computeAmbient(255, 215, 50)).toBe(0x808080);
    expect(computeAmbient(128, 215, 50)).toBe(0x404040);
  });
});
