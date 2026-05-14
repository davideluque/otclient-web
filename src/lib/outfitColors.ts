// Tibia outfit color palette. The four head/body/legs/feet attributes of an
// Outfit each store an index 0–132 into this palette. The palette is the
// HSI (hue, saturation, intensity) construction OTClient uses; we mirror
// its algorithm from src/client/outfit.cpp so colours match the official
// client byte-for-byte.

const HSI_H_STEPS = 19;
const HSI_SI_VALUES = 7;
const PALETTE_SIZE = HSI_H_STEPS * HSI_SI_VALUES; // 133 (valid indices 0–132)

export interface OutfitRGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Convert an outfit color index to RGB. Out-of-range indices map to 0
 * (matches OTClient's behaviour). Result components are 0–255 integers.
 */
export function outfitIndexToRgb(index: number): OutfitRGB {
  let i = index;
  if (i < 0 || i >= PALETTE_SIZE) i = 0;

  // The HSI cube has special handling at hue=0 (grayscale ramp).
  let hue: number;
  let saturation: number;
  let intensity: number;

  if (i % HSI_H_STEPS !== 0) {
    hue = (i % HSI_H_STEPS) * (1 / 18);
    switch (Math.floor(i / HSI_H_STEPS)) {
      case 0: saturation = 0.25; intensity = 1; break;
      case 1: saturation = 0.25; intensity = 0.75; break;
      case 2: saturation = 0.5; intensity = 0.75; break;
      case 3: saturation = 0.667; intensity = 0.75; break;
      case 4: saturation = 1; intensity = 1; break;
      case 5: saturation = 1; intensity = 0.75; break;
      case 6: saturation = 1; intensity = 0.5; break;
      default: saturation = 1; intensity = 1; break;
    }
  } else {
    hue = 0;
    saturation = 0;
    intensity = 1 - i / HSI_H_STEPS / HSI_SI_VALUES;
  }

  if (intensity === 0) return { r: 0, g: 0, b: 0 };

  if (saturation === 0) {
    const v = Math.floor(intensity * 255);
    return { r: v, g: v, b: v };
  }

  let red: number;
  let green: number;
  let blue: number;

  if (hue < 1 / 6) {
    red = intensity;
    blue = intensity * (1 - saturation);
    green = blue + (intensity - blue) * 6 * hue;
  } else if (hue < 2 / 6) {
    green = intensity;
    blue = intensity * (1 - saturation);
    red = green - (intensity - blue) * (6 * hue - 1);
  } else if (hue < 3 / 6) {
    green = intensity;
    red = intensity * (1 - saturation);
    blue = red + (intensity - red) * (6 * hue - 2);
  } else if (hue < 4 / 6) {
    blue = intensity;
    red = intensity * (1 - saturation);
    green = blue - (intensity - red) * (6 * hue - 3);
  } else if (hue < 5 / 6) {
    blue = intensity;
    green = intensity * (1 - saturation);
    red = green + (intensity - green) * (6 * hue - 4);
  } else {
    red = intensity;
    green = intensity * (1 - saturation);
    blue = red - (intensity - green) * (6 * hue - 5);
  }

  return {
    r: Math.floor(red * 255),
    g: Math.floor(green * 255),
    b: Math.floor(blue * 255),
  };
}
