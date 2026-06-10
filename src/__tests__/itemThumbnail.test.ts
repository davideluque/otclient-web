// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { extractSpriteRGBA } from '../lib/itemThumbnail';
import { ATLAS_SIZE } from '../lib/atlas';
import { createInventoryPane } from '../lib/inventoryPane';

afterEach(() => document.body.replaceChildren());

describe('extractSpriteRGBA', () => {
  it('copies the 32×32 block at the sprite location', () => {
    const page = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
    // Mark the top-left pixel of the sprite at (64, 32) bright red.
    const px = (32 * ATLAS_SIZE + 64) * 4;
    page[px] = 255; page[px + 3] = 255;
    // And its bottom-right pixel green.
    const br = ((32 + 31) * ATLAS_SIZE + 64 + 31) * 4;
    page[br + 1] = 200; page[br + 3] = 255;

    const rgba = extractSpriteRGBA(page, { page: 0, x: 64, y: 32 });
    expect(rgba.length).toBe(32 * 32 * 4);
    expect([rgba[0], rgba[3]]).toEqual([255, 255]);
    const last = (31 * 32 + 31) * 4;
    expect([rgba[last + 1], rgba[last + 3]]).toEqual([200, 255]);
  });
});

describe('inventory pane thumbnails', () => {
  it('appends the rendered canvas and clears the textual label', () => {
    const thumb = document.createElement('canvas');
    const pane = createInventoryPane(document.body, { renderThumb: () => thumb });
    pane.setSlot('armor', 2463);

    const cell = [...document.querySelectorAll('.inventory-pane .slot')]
      .find((c) => c.contains(thumb)) as HTMLElement;
    expect(cell).toBeTruthy();
    expect(cell.querySelector('.label')?.textContent).toBe('');

    // Clearing the slot removes the canvas and restores the slot name.
    pane.setSlot('armor', null);
    expect(cell.querySelector('canvas')).toBeNull();
    expect(cell.querySelector('.label')?.textContent).toBe('armor');
    pane.destroy();
  });

  it('falls back to the #id label when the renderer returns null', () => {
    const pane = createInventoryPane(document.body, { renderThumb: () => null });
    pane.setSlot('head', 2457);
    const label = [...document.querySelectorAll('.inventory-pane .label')]
      .map((l) => l.textContent);
    expect(label).toContain('#2457');
    pane.destroy();
  });
});
