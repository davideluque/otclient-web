// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { createMinimap, minimapIndexToRgb } from '../lib/minimap';
import { bindMinimap } from '../lib/jamera/minimapBinding';
import { DatAttr, type ThingType } from '../lib/dat';
import type { GameWorld } from '../lib/GameWorld';

afterEach(() => document.body.replaceChildren());

describe('minimapIndexToRgb', () => {
  it('maps the 216-color cube corners and a known mid value', () => {
    expect(minimapIndexToRgb(0)).toBe(0x000000);
    expect(minimapIndexToRgb(215)).toBe(0xffffff);
    // 51 → r=1*51, g=2*51, b=3*51
    expect(minimapIndexToRgb(51)).toBe(0x336699);
  });
});

describe('createMinimap', () => {
  it('mounts, toggles visibility, destroys cleanly (no 2d ctx in happy-dom)', () => {
    const map = createMinimap({
      getCenter: () => ({ x: 0, y: 0, z: 7 }),
      tileColor: () => null,
    });
    const el = document.querySelector('.minimap') as HTMLElement;
    expect(el).toBeTruthy();
    expect(() => map.refresh()).not.toThrow();
    map.setVisible(false);
    expect(el.style.display).toBe('none');
    map.destroy();
    expect(document.querySelector('.minimap')).toBeNull();
  });
});

describe('bindMinimap', () => {
  it('binds against a world + lazy datIndex and tears down its timer', () => {
    const world = { playerX: 10, playerY: 20, playerZ: 7, getTile: () => undefined } as unknown as GameWorld;
    const ground: ThingType = { id: 1, attrs: new Map([[DatAttr.MinimapColor, 24]]) } as unknown as ThingType;
    const datIndex = new Map([[1, ground]]);
    const binding = bindMinimap(world, () => datIndex);
    expect(binding.visible).toBe(true);
    binding.setVisible(false);
    expect(binding.visible).toBe(false);
    binding.destroy();
    expect(document.querySelector('.minimap')).toBeNull();
  });
});

describe('close button', () => {
  it('renders a ✕ that fires onClose', () => {
    let closed = 0;
    const map = createMinimap({
      getCenter: () => ({ x: 100, y: 100, z: 7 }),
      tileColor: () => null,
      onClose: () => { closed++; },
    }, document.body);
    const btn = document.querySelector('[aria-label="Close minimap"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(closed).toBe(1);
    map.destroy();
  });
});
