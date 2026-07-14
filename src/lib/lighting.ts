import { Application, Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js';
import type { TileSource } from './tileRenderer';
import type { ThingType, Light } from './dat';
import { DatAttr } from './dat';
import type { Pixel } from './types';
import { TILE_SIZE } from '../constants';

const MASK_SIZE: Pixel = 256;
const MAX_INTENSITY = 7;

export interface LightSource {
  x: number;
  y: number;
  intensity: number;
  color: number;
}

/** Place a creature-carried light at its rendered (possibly interpolated) position. */
export function creatureLightSource(
  creature: { lightLevel: number; lightColor: number },
  position: { x: number; y: number },
): LightSource {
  return {
    x: position.x,
    y: position.y,
    intensity: creature.lightLevel,
    color: tibiaColorToHex(creature.lightColor),
  };
}

export interface LightingOptions {
  /** Base ambient color the framebuffer is filled with. Darker = darker night. */
  ambientColor: number;
  /** If false, lighting is bypassed entirely (full daylight). */
  enabled: boolean;
  /**
   * Lights that don't live on tiles as items — creature-carried lights
   * (torches in hand, the player's own glow) gathered by the caller.
   */
  extraLights?: LightSource[];
}

/** localStorage key + default for the player's brightness preference. */
const BRIGHTNESS_KEY = 'jamera.brightness';
export const DEFAULT_BRIGHTNESS = 100;

// In-memory cache: loadBrightness is on the render path (per repaint),
// and localStorage.getItem is synchronous blocking I/O.
let brightnessCache: number | null = null;

export function loadBrightness(): number {
  if (brightnessCache !== null) return brightnessCache;
  try {
    const stored = localStorage.getItem(BRIGHTNESS_KEY);
    // getItem → null for new users; Number(null) is 0, which would
    // silently default everyone to full darkness instead of DEFAULT.
    if (stored !== null) {
      const raw = Number(stored);
      if (Number.isFinite(raw) && raw >= 0 && raw <= 100) {
        brightnessCache = raw;
        return raw;
      }
    }
  } catch { /* storage blocked */ }
  brightnessCache = DEFAULT_BRIGHTNESS;
  return DEFAULT_BRIGHTNESS;
}

export function saveBrightness(pct: number): void {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  brightnessCache = clamped;
  try {
    localStorage.setItem(BRIGHTNESS_KEY, String(clamped));
  } catch { /* storage blocked — session-only via the cache */ }
}

/** Test hook: drop the in-memory cache so loadBrightness re-reads storage. */
export function resetBrightnessCache(): void {
  brightnessCache = null;
}

/**
 * Effective ambient color for the overlay: the server's world light
 * (0x82 level 0–255 scaling its palette color) multiplied by the user's
 * brightness. The old implementation blended toward white, which made
 * 0% look fully bright whenever the server reported daylight—the exact
 * opposite of what a brightness control promises.
 */
export function computeAmbient(level: number, colorIndex: number, brightnessPct: number): number {
  const server = tibiaColorToHex(colorIndex);
  const scale = Math.max(0, Math.min(255, level)) / 255;
  const brightness = Math.max(0, Math.min(100, brightnessPct)) / 100;
  const blend = (c: number): number => {
    return Math.round(c * scale * brightness);
  };
  const r = blend((server >> 16) & 0xff);
  const g = blend((server >> 8) & 0xff);
  const b = blend(server & 0xff);
  return (r << 16) | (g << 8) | b;
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

/**
 * `zs` is one floor or the whole drawn stack — multi-floor rendering
 * merges every drawn floor's sources into ONE overlay (design doc: no
 * per-floor light layers, classic behavior). Gathering stays per-floor-
 * accurate: only the listed floors contribute, so a torch in the sealed
 * cellar can't glow through the ground. The plain-number form keeps the
 * offline viewer's single-floor call site unchanged.
 */
export function* gatherLights(
  tileMap: TileSource,
  datIndex: Map<number, ThingType>,
  x1: number, y1: number, x2: number, y2: number,
  zs: number | readonly number[],
): Generator<LightSource> {
  for (const z of typeof zs === 'number' ? [zs] : zs) {
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
}

/**
 * Recycles light-bubble sprites across overlay rebuilds. Each call to
 * {@link buildIlluminationOverlay} resets the in-use counter, then borrows
 * sprites in order; new ones are minted only when the previous frame's high-
 * water mark is exceeded. Sprites are detached from their parent automatically
 * when the scratch scene is destroyed at the end of each overlay build, so
 * `acquire` can safely re-parent them next call.
 */
export class LightSpritePool {
  private sprites: Sprite[] = [];
  private inUse = 0;

  acquire(mask: Texture): Sprite {
    let sprite = this.sprites[this.inUse];
    if (!sprite) {
      sprite = new Sprite(mask);
      sprite.anchor.set(0.5);
      sprite.blendMode = 'add';
      this.sprites[this.inUse] = sprite;
    } else if (sprite.texture !== mask) {
      // Honor the mask passed by the caller — without this, a reused sprite
      // would silently keep the texture it was created with.
      sprite.texture = mask;
    }
    this.inUse++;
    return sprite;
  }

  reset(): void {
    this.inUse = 0;
  }

  destroy(): void {
    for (const sprite of this.sprites) sprite.destroy();
    this.sprites.length = 0;
    this.inUse = 0;
  }
}

/**
 * Build an illumination map by rendering the ambient color + all visible lights
 * into the caller-owned RenderTexture, then returning a multiply-blended Sprite
 * that composites over the rendered map. This is the OTClient approach: lights
 * *brighten* the darkness rather than overlaying it.
 *
 * Memory model: the caller owns `texture` and `pool` — both persist across
 * rebuilds. The texture is resized in place when the visible region changes
 * (cheap), and light bubbles are borrowed from the pool instead of allocated.
 * The returned Sprite is short-lived (one per call) and may be destroyed by
 * the caller without affecting the underlying texture.
 *
 * `zs` (one floor or the drawn stack, see gatherLights) all land at raw
 * world coordinates in the merged overlay — a torch under an iso-shifted
 * roof glows at its tile, up to a tile off from the shifted art. Accepted
 * v1: one classic merged pass, no per-floor light layers.
 */
export function buildIlluminationOverlay(
  app: Application,
  tileMap: TileSource,
  datIndex: Map<number, ThingType>,
  mask: Texture,
  texture: RenderTexture,
  pool: LightSpritePool,
  x1: number, y1: number, x2: number, y2: number,
  zs: number | readonly number[],
  opts: LightingOptions,
): Sprite {
  const w = (x2 - x1 + 1) * TILE_SIZE;
  const h = (y2 - y1 + 1) * TILE_SIZE;

  // Resize is a no-op when dimensions already match. Without this, panning
  // even one tile would force a costly reallocation of the GPU texture.
  if (texture.width !== w || texture.height !== h) {
    texture.resize(w, h);
  }

  pool.reset();
  const scene = new Container();

  // Base ambient fill. The framebuffer color where no light reaches.
  // Allocated per-call — Graphics holds GPU geometry that needs an explicit
  // destroy below; pooling it would mean tracking another piece of state
  // for very little win (one allocation vs N for the light bubbles).
  const ambient = new Graphics();
  ambient.rect(0, 0, w, h).fill({ color: opts.ambientColor });
  scene.addChild(ambient);

  // Each light additively brightens the framebuffer in its area. Expand the
  // gather rect by MAX_INTENSITY tiles so a light just outside the visible
  // rectangle still contributes when its bubble reaches in — otherwise the
  // screen edges go dark and torches pop in as the viewport pans.
  const addBubble = (light: LightSource): void => {
    const sprite = pool.acquire(mask);
    sprite.x = (light.x - x1) * TILE_SIZE + TILE_SIZE / 2;
    sprite.y = (light.y - y1) * TILE_SIZE + TILE_SIZE / 2;
    const radius = Math.min(light.intensity, MAX_INTENSITY) * TILE_SIZE / 2;
    sprite.width = radius * 2;
    sprite.height = radius * 2;
    sprite.tint = light.color;
    scene.addChild(sprite);
  };

  for (const light of gatherLights(
    tileMap, datIndex,
    x1 - MAX_INTENSITY, y1 - MAX_INTENSITY,
    x2 + MAX_INTENSITY, y2 + MAX_INTENSITY,
    zs,
  )) {
    addBubble(light);
  }
  // Creature-carried lights (torches in hand, the player's glow) come
  // from the caller — they live on creatures, not tile items.
  for (const light of opts.extraLights ?? []) addBubble(light);

  app.renderer.render({ container: scene, target: texture, clear: true });

  // scene.destroy() without `{ children: true }` removes children (parent =
  // null) but does NOT destroy them — pool sprites survive for next call.
  // The ambient Graphics is one-shot; destroy it to release its GPU geometry.
  ambient.destroy();
  scene.destroy();

  const overlay = new Sprite(texture);
  overlay.x = x1 * TILE_SIZE;
  overlay.y = y1 * TILE_SIZE;
  overlay.blendMode = 'multiply';
  return overlay;
}
