import { describe, it, expect } from 'vitest';
import { tintOutfitSprite } from '../lib/outfitTint';
import { SPRITE_SIZE } from '../lib/spr';

const PIXELS = SPRITE_SIZE * SPRITE_SIZE;
const BYTES = PIXELS * 4;

function whiteBase(): Uint8Array {
  const buf = new Uint8Array(BYTES);
  for (let i = 0; i < BYTES; i += 4) {
    buf[i] = 255;
    buf[i + 1] = 255;
    buf[i + 2] = 255;
    buf[i + 3] = 255;
  }
  return buf;
}

function emptyMask(): Uint8Array {
  return new Uint8Array(BYTES);
}

function setPixel(buf: Uint8Array, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  const o = (y * SPRITE_SIZE + x) * 4;
  buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a;
}

describe('tintOutfitSprite', () => {
  const outfit = { head: 0, body: 0, legs: 0, feet: 0 };

  it('leaves base pixels unchanged where the mask is transparent', () => {
    const base = whiteBase();
    const mask = emptyMask();
    const out = tintOutfitSprite(base, mask, outfit);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(255);
    expect(out[2]).toBe(255);
    expect(out[3]).toBe(255);
  });

  it('keeps full transparency where the base is transparent', () => {
    const base = new Uint8Array(BYTES); // all-zero
    const mask = emptyMask();
    setPixel(mask, 5, 5, 255, 255, 0); // yellow
    const out = tintOutfitSprite(base, mask, outfit);
    const o = (5 * SPRITE_SIZE + 5) * 4;
    expect(out[o + 3]).toBe(0);
  });

  it('multiplies white base pixels by the head colour under a yellow mask', () => {
    const base = whiteBase();
    const mask = emptyMask();
    setPixel(mask, 0, 0, 255, 255, 0);
    // head index 76 → grayscale ramp at intensity ~0.43 → (110, 110, 110)
    const out = tintOutfitSprite(base, mask, { head: 76, body: 0, legs: 0, feet: 0 });
    // white * grey/255 = grey
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBe(out[2]);
    expect(out[0]).toBeGreaterThan(100);
    expect(out[0]).toBeLessThan(120);
  });

  it('uses body / legs / feet colours for red / green / blue masks', () => {
    const base = whiteBase();
    const mask = emptyMask();
    setPixel(mask, 0, 0, 255, 0, 0);   // body
    setPixel(mask, 1, 0, 0, 255, 0);   // legs
    setPixel(mask, 2, 0, 0, 0, 255);   // feet
    const out = tintOutfitSprite(base, mask, { head: 0, body: 1, legs: 19, feet: 38 });
    // 3 different palette entries → 3 different output colours under white base
    const body = [out[0], out[1], out[2]];
    const legs = [out[4], out[5], out[6]];
    const feet = [out[8], out[9], out[10]];
    expect(body).not.toEqual(legs);
    expect(legs).not.toEqual(feet);
    expect(body).not.toEqual(feet);
  });

  it('leaves base pixels unchanged where the mask is a non-marker colour', () => {
    const base = whiteBase();
    const mask = emptyMask();
    setPixel(mask, 0, 0, 128, 128, 128); // grey — not one of the four markers
    const out = tintOutfitSprite(base, mask, outfit);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(255);
    expect(out[2]).toBe(255);
  });
});
