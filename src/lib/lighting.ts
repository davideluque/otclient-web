import { Application, Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js';
import type { TileMap } from './tileMap';
import type { ThingType, Light } from './dat';
import { DatAttr } from './dat';

const TILE_SIZE = 32;
const MASK_SIZE = 256;
const MAX_INTENSITY = 7;

export interface LightSource {
  x: number;
  y: number;
  intensity: number;
  color: number;
}

export interface LightingOptions {
  /** Base ambient color the framebuffer is filled with. Darker = darker night. */
  ambientColor: number;
  /** If false, lighting is bypassed entirely (full daylight). */
  enabled: boolean;
}

export const NIGHT_AMBIENT: LightingOptions = {
  ambientColor: 0x404868,
  enabled: true,
};

export const DAY_AMBIENT: LightingOptions = {
  ambientColor: 0xffffff,
  enabled: false,
};

/**
 * Soft radial mask used as the bubble for every light source. Quadratic
 * falloff with a small solid bright core, matching OTClient's bubble.
 */
export function createLightMaskTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = MASK_SIZE;
  canvas.height = MASK_SIZE;
  const ctx = canvas.getContext('2d')!;
  const c = MASK_SIZE / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.1, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.36)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
  return Texture.from(canvas);
}

/**
 * Convert a Tibia 7.6 palette index (0-215) to a 24-bit RGB hex color.
 * The palette is a 6×6×6 cube; each component takes one of {0, 51, 102, 153, 204, 255}.
 */
export function tibiaColorToHex(paletteIndex: number): number {
  const idx = Math.max(0, Math.min(215, paletteIndex));
  const r = (Math.floor(idx / 36) % 6) * 51;
  const g = (Math.floor(idx / 6) % 6) * 51;
  const b = (idx % 6) * 51;
  return (r << 16) | (g << 8) | b;
}

export function* gatherLights(
  tileMap: TileMap,
  datIndex: Map<number, ThingType>,
  x1: number, y1: number, x2: number, y2: number, z: number,
): Generator<LightSource> {
  for (const tile of tileMap.tilesInRegion(x1, y1, x2, y2, z)) {
    for (const item of tile.items) {
      const tt = datIndex.get(item.clientId);
      if (!tt) continue;
      const light = tt.attrs.get(DatAttr.Light) as Light | undefined;
      if (!light || light.intensity === 0) continue;
      yield {
        x: tile.x,
        y: tile.y,
        intensity: light.intensity,
        color: tibiaColorToHex(light.color),
      };
    }
  }
}

export interface IlluminationOverlay {
  sprite: Sprite;
  texture: RenderTexture;
}

/**
 * Build an illumination map by rendering the ambient color + all visible lights
 * into a RenderTexture, then returning a multiply-blended Sprite that composites
 * over the rendered map. This is the OTClient approach: lights *brighten* the
 * darkness rather than overlaying it.
 *
 * Caller owns the returned RenderTexture and must destroy it before discarding
 * the sprite (PixiJS doesn't reclaim render textures automatically).
 */
export function buildIlluminationOverlay(
  app: Application,
  tileMap: TileMap,
  datIndex: Map<number, ThingType>,
  mask: Texture,
  x1: number, y1: number, x2: number, y2: number, z: number,
  opts: LightingOptions,
): IlluminationOverlay {
  const w = (x2 - x1 + 1) * TILE_SIZE;
  const h = (y2 - y1 + 1) * TILE_SIZE;

  const scene = new Container();

  // Base ambient fill. The framebuffer color where no light reaches.
  const ambient = new Graphics();
  ambient.rect(0, 0, w, h).fill({ color: opts.ambientColor });
  scene.addChild(ambient);

  // Each light additively brightens the framebuffer in its area. Expand the
  // gather rect by MAX_INTENSITY tiles so a light just outside the visible
  // rectangle still contributes when its bubble reaches in — otherwise the
  // screen edges go dark and torches pop in as the viewport pans.
  for (const light of gatherLights(
    tileMap, datIndex,
    x1 - MAX_INTENSITY, y1 - MAX_INTENSITY,
    x2 + MAX_INTENSITY, y2 + MAX_INTENSITY,
    z,
  )) {
    const sprite = new Sprite(mask);
    sprite.anchor.set(0.5);
    sprite.x = (light.x - x1) * TILE_SIZE + TILE_SIZE / 2;
    sprite.y = (light.y - y1) * TILE_SIZE + TILE_SIZE / 2;
    const radius = Math.min(light.intensity, MAX_INTENSITY) * TILE_SIZE / 2;
    sprite.width = radius * 2;
    sprite.height = radius * 2;
    sprite.tint = light.color;
    sprite.blendMode = 'add';
    scene.addChild(sprite);
  }

  const texture = RenderTexture.create({ width: w, height: h });
  app.renderer.render({ container: scene, target: texture, clear: true });
  scene.destroy({ children: true });

  const overlay = new Sprite(texture);
  overlay.x = x1 * TILE_SIZE;
  overlay.y = y1 * TILE_SIZE;
  overlay.blendMode = 'multiply';

  return { sprite: overlay, texture };
}
