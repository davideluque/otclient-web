import { Application, Container, Graphics, RenderTexture, Sprite } from 'pixi.js';
import type { TileMap } from '../tileMap';
import type { ThingType, Light } from '../dat';
import { DatAttr } from '../dat';
import { TILE_SIZE } from '../../constants';
import { createLightMesh, type LightMesh } from './shader';

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

/**
 * Recycles light-bubble Meshes across overlay rebuilds. Each call to
 * {@link buildIlluminationOverlay} resets the in-use counter, then borrows
 * meshes in order; new ones are minted only when the previous frame's high-
 * water mark is exceeded. Meshes are detached from their parent automatically
 * when the scratch scene is destroyed at the end of each overlay build, so
 * `acquire` can safely re-parent them next call.
 */
export class LightMeshPool {
  private items: LightMesh[] = [];
  private inUse = 0;

  acquire(): LightMesh {
    let item = this.items[this.inUse];
    if (!item) {
      item = createLightMesh();
      this.items[this.inUse] = item;
    }
    this.inUse++;
    return item;
  }

  reset(): void {
    this.inUse = 0;
  }

  destroy(): void {
    for (const item of this.items) item.mesh.destroy({ children: true });
    this.items.length = 0;
    this.inUse = 0;
  }
}

/**
 * Render the ambient + every visible light bubble into the caller-owned
 * RenderTexture, then point the caller-owned overlay Sprite at it.
 *
 * Memory model: `texture`, `pool`, and `overlay` all persist across rebuilds.
 * The texture resizes in place; light bubbles are borrowed from the pool;
 * the overlay sprite is mutated, never reallocated. Nothing in this function
 * allocates GPU resources on a hot path beyond the (very small) scratch
 * Container + ambient Graphics it cleans up at the end.
 */
export function buildIlluminationOverlay(
  app: Application,
  tileMap: TileMap,
  datIndex: Map<number, ThingType>,
  texture: RenderTexture,
  pool: LightMeshPool,
  overlay: Sprite,
  x1: number, y1: number, x2: number, y2: number, z: number,
  opts: LightingOptions,
  time: number,
): Sprite {
  const w = (x2 - x1 + 1) * TILE_SIZE;
  const h = (y2 - y1 + 1) * TILE_SIZE;

  if (texture.width !== w || texture.height !== h) {
    texture.resize(w, h);
  }

  pool.reset();
  const scene = new Container();

  const ambient = new Graphics();
  ambient.rect(0, 0, w, h).fill({ color: opts.ambientColor });
  scene.addChild(ambient);

  // Expand the gather rect by MAX_INTENSITY tiles so a light just outside the
  // visible rectangle still contributes when its bubble reaches in — otherwise
  // the screen edges go dark and torches pop in as the viewport pans.
  for (const light of gatherLights(
    tileMap, datIndex,
    x1 - MAX_INTENSITY, y1 - MAX_INTENSITY,
    x2 + MAX_INTENSITY, y2 + MAX_INTENSITY,
    z,
  )) {
    const { mesh, uniforms } = pool.acquire();
    const radius = Math.min(light.intensity, MAX_INTENSITY) * TILE_SIZE / 2;
    const diameter = radius * 2;
    // Mesh geometry is a unit quad — translate so the center sits on the
    // light's tile and scale so the quad covers diameter × diameter pixels.
    mesh.x = (light.x - x1) * TILE_SIZE + TILE_SIZE / 2 - radius;
    mesh.y = (light.y - y1) * TILE_SIZE + TILE_SIZE / 2 - radius;
    mesh.width = diameter;
    mesh.height = diameter;
    uniforms.uTint[0] = ((light.color >> 16) & 0xff) / 255;
    uniforms.uTint[1] = ((light.color >> 8) & 0xff) / 255;
    uniforms.uTint[2] = (light.color & 0xff) / 255;
    uniforms.uTime = time;
    scene.addChild(mesh);
  }

  app.renderer.render({ container: scene, target: texture, clear: true });

  // scene.destroy() without `{ children: true }` removes children (parent =
  // null) but does NOT destroy them — pool meshes survive for next call.
  ambient.destroy();
  scene.destroy();

  overlay.texture = texture;
  overlay.x = x1 * TILE_SIZE;
  overlay.y = y1 * TILE_SIZE;
  overlay.blendMode = 'multiply';
  return overlay;
}
