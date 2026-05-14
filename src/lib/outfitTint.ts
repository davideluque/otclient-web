import { SPRITE_SIZE } from './spr';
import { ATLAS_SIZE } from './atlas';
import type { AtlasPages, SpriteLocation } from './atlas';
import type { OutfitRGB } from './outfitColors';
import { outfitIndexToRgb } from './outfitColors';

export interface OutfitColorIndices {
  head: number;
  body: number;
  legs: number;
  feet: number;
}

const SPRITE_PIXELS = SPRITE_SIZE * SPRITE_SIZE;
const SPRITE_BYTES = SPRITE_PIXELS * 4;
const STRIDE = ATLAS_SIZE * 4;

/**
 * Extract a sprite's 32×32 RGBA pixel block out of an atlas page. Returns
 * a fresh Uint8Array of length SPRITE_BYTES — copies, so the atlas isn't
 * referenced after this returns.
 */
export function extractSpritePixels(
  atlasPages: AtlasPages,
  layout: Map<number, SpriteLocation>,
  spriteId: number,
): Uint8Array | null {
  const loc = layout.get(spriteId);
  if (!loc) return null;
  const page = atlasPages.get(loc.page);
  if (!page) return null;

  const out = new Uint8Array(SPRITE_BYTES);
  const startX = loc.x;
  const startY = loc.y;
  for (let row = 0; row < SPRITE_SIZE; row++) {
    const srcOffset = (startY + row) * STRIDE + startX * 4;
    out.set(page.subarray(srcOffset, srcOffset + SPRITE_SIZE * 4), row * SPRITE_SIZE * 4);
  }
  return out;
}

/**
 * Compose the final tinted outfit sprite. OTClient applies four multiply
 * blend passes on the base layer using the layer-1 mask as a stencil:
 *   - yellow pixels (mask)   → multiply by head color
 *   - red pixels (mask)      → multiply by body color
 *   - green pixels (mask)    → multiply by legs color
 *   - blue pixels (mask)     → multiply by feet color
 * The base layer's white pixels in those regions therefore take on the
 * chosen colour directly; non-template pixels stay as drawn.
 *
 * Pixels in the mask that don't match any of the four marker colours
 * leave the base unchanged — that's the "outline" / non-colourable
 * detail Tibia outfits retain regardless of palette choice.
 */
export function tintOutfitSprite(
  baseRgba: Uint8Array,
  maskRgba: Uint8Array,
  outfit: OutfitColorIndices,
): Uint8Array {
  const head = outfitIndexToRgb(outfit.head);
  const body = outfitIndexToRgb(outfit.body);
  const legs = outfitIndexToRgb(outfit.legs);
  const feet = outfitIndexToRgb(outfit.feet);
  const out = new Uint8Array(SPRITE_BYTES);

  for (let i = 0; i < SPRITE_BYTES; i += 4) {
    const baseR = baseRgba[i];
    const baseG = baseRgba[i + 1];
    const baseB = baseRgba[i + 2];
    const baseA = baseRgba[i + 3];
    if (baseA === 0) {
      out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0;
      continue;
    }

    const mR = maskRgba[i];
    const mG = maskRgba[i + 1];
    const mB = maskRgba[i + 2];
    const mA = maskRgba[i + 3];

    const tint = mA > 0 ? pickMaskTint(mR, mG, mB, head, body, legs, feet) : null;

    if (tint === null) {
      out[i] = baseR; out[i + 1] = baseG; out[i + 2] = baseB; out[i + 3] = baseA;
    } else {
      // Multiply-blend the base with the chosen colour. White template
      // areas pick up the colour fully; shaded base pixels darken it.
      out[i] = Math.round(baseR * tint.r / 255);
      out[i + 1] = Math.round(baseG * tint.g / 255);
      out[i + 2] = Math.round(baseB * tint.b / 255);
      out[i + 3] = baseA;
    }
  }
  return out;
}

function pickMaskTint(r: number, g: number, b: number, head: OutfitRGB, body: OutfitRGB, legs: OutfitRGB, feet: OutfitRGB): OutfitRGB | null {
  // Tibia mask sprites use four pure marker colours. Any other (non-marker)
  // mask pixel means "this region isn't colourable" — leave the base alone.
  const isYellow = r > 200 && g > 200 && b < 64;  // head
  if (isYellow) return head;
  const isRed = r > 200 && g < 64 && b < 64;      // body
  if (isRed) return body;
  const isGreen = r < 64 && g > 200 && b < 64;    // legs
  if (isGreen) return legs;
  const isBlue = r < 64 && g < 64 && b > 200;     // feet
  if (isBlue) return feet;
  return null;
}
