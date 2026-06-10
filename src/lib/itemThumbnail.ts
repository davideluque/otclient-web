import { spriteIndex } from './tileRenderer';
import { ATLAS_SIZE, type AtlasPages, type SpriteLocation } from './atlas';
import type { ThingType } from './dat';

/**
 * DOM-side item thumbnails for the inventory pane: compose an item's
 * phase-0 sprites (all layers, all width/height pieces) into a small
 * canvas straight from the CPU-side atlas pages — no PIXI involved, so
 * the pane stays a plain DOM component.
 */

const SPRITE = 32;

/** Extract one 32×32 RGBA sprite from its atlas page. Exported for tests. */
export function extractSpriteRGBA(page: Uint8Array, loc: SpriteLocation): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SPRITE * SPRITE * 4);
  for (let row = 0; row < SPRITE; row++) {
    const src = ((loc.y + row) * ATLAS_SIZE + loc.x) * 4;
    out.set(page.subarray(src, src + SPRITE * 4), row * SPRITE * 4);
  }
  return out;
}

/**
 * Render `clientId`'s idle look into a canvas sized to the item's
 * full footprint (multi-tile items like beds render whole). Returns
 * null when the id is unknown, no sprites resolve, or the host can't
 * do 2D canvas (tests) — callers fall back to the textual slot.
 */
export function renderItemThumbnail(
  clientId: number,
  datIndex: Map<number, ThingType>,
  layout: Map<number, SpriteLocation>,
  pages: AtlasPages,
): HTMLCanvasElement | null {
  const thing = datIndex.get(clientId);
  if (!thing) return null;
  const fg = thing.frameGroup;

  const canvas = document.createElement('canvas');
  canvas.width = fg.width * SPRITE;
  canvas.height = fg.height * SPRITE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const scratch = document.createElement('canvas');
  scratch.width = SPRITE;
  scratch.height = SPRITE;
  const sctx = scratch.getContext('2d');
  if (!sctx) return null;

  let drewAnything = false;
  // Same ordering as renderTile: furthest piece first, anchor last,
  // layer 0 under higher layers. Patterns/phase pinned to 0 — a
  // thumbnail wants the canonical look, not world variation.
  for (let h = fg.height - 1; h >= 0; h--) {
    for (let w = fg.width - 1; w >= 0; w--) {
      for (let layer = 0; layer < fg.layers; layer++) {
        const id = fg.spriteIds[spriteIndex(fg, 0, 0, 0, layer, h, w)];
        if (!id) continue;
        const loc = layout.get(id);
        const page = loc && pages.get(loc.page);
        if (!loc || !page) continue;
        const rgba = extractSpriteRGBA(page, loc);
        sctx.putImageData(new ImageData(rgba as ImageDataArray, SPRITE, SPRITE), 0, 0);
        // drawImage (not putImageData) so transparent pixels composite
        // over what's already on the canvas.
        ctx.drawImage(scratch, (fg.width - 1 - w) * SPRITE, (fg.height - 1 - h) * SPRITE);
        drewAnything = true;
      }
    }
  }
  return drewAnything ? canvas : null;
}
