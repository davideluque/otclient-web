/**
 * Minimap — a small canvas (left edge, under the HUD) painting
 * the known tiles around the player from their .dat minimap colors,
 * exactly like the original client's automap. Self-contained component
 * (joystick.ts pattern): the host supplies a color lookup and a center,
 * the component owns DOM/canvas/painting.
 */

export interface MinimapOptions {
  /** 0xRRGGBB for a tile, or null when unknown (painted black). */
  tileColor(x: number, y: number, z: number): number | null;
  /** Current center (the player). */
  getCenter(): { x: number; y: number; z: number };
  /** Half-extent in tiles around the center (default 28). */
  radius?: number;
  /** Canvas pixels per tile (default 3). */
  scale?: number;
  /** Called when the corner \u2715 is tapped — the owner flips its open state. */
  onClose?: () => void;
}

export interface MinimapHandle {
  readonly el: HTMLElement;
  /** Repaint from the current world state. */
  refresh(): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

/**
 * Tibia's automap colors are indices into the 216-color web-safe cube:
 * r = (i/36)*51, g = ((i/6)%6)*51, b = (i%6)*51.
 */
export function minimapIndexToRgb(index: number): number {
  const i = index & 0xff;
  const r = Math.floor(i / 36) % 6 * 51;
  const g = Math.floor(i / 6) % 6 * 51;
  const b = (i % 6) * 51;
  return (r << 16) | (g << 8) | b;
}

const STYLE_ID = 'minimap-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .minimap {
      /* Left column, under the HUD (top 8, ~50px tall) and the
         status-bar condition row (top 86) — keeps top-right free. */
      position: fixed; top: calc(112px + env(safe-area-inset-top, 0px)); left: 8px;
      border: 1px solid #555; border-radius: 8px;
      background: #000; z-index: 35; overflow: hidden;
      opacity: 0.92;
    }
    .minimap canvas { display: block; image-rendering: pixelated; }
    .minimap .close-btn {
      position: absolute; top: 2px; right: 2px;
      background: rgba(22,22,22,0.7); border: none; border-radius: 4px;
      color: #ccc; font-size: 0.75rem; line-height: 1;
      padding: 2px 4px; cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

export function createMinimap(opts: MinimapOptions, parent: HTMLElement = document.body): MinimapHandle {
  ensureStyles();
  const radius = opts.radius ?? 28;
  const scale = opts.scale ?? 3;
  const side = 2 * radius + 1;

  const el = document.createElement('div');
  el.className = 'minimap';
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  // Render 1px per tile, upscale via CSS (pixelated) — the ImageData
  // stays tiny regardless of the on-screen size.
  canvas.style.width = `${side * scale / 2}px`;
  canvas.style.height = `${side * scale / 2}px`;
  el.appendChild(canvas);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'close-btn';
  closeBtn.textContent = '\u2715';
  closeBtn.setAttribute('aria-label', 'Close minimap');
  closeBtn.addEventListener('click', () => opts.onClose?.());
  el.appendChild(closeBtn);
  parent.appendChild(el);

  const ctx = canvas.getContext('2d');
  const image = ctx ? ctx.createImageData(side, side) : null;

  const refresh = (): void => {
    if (!ctx || !image) return;
    const { x: cx, y: cy, z } = opts.getCenter();
    const px = image.data;
    let i = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const color = opts.tileColor(cx + dx, cy + dy, z);
        const c = color ?? 0x000000;
        px[i++] = (c >> 16) & 0xff;
        px[i++] = (c >> 8) & 0xff;
        px[i++] = c & 0xff;
        px[i++] = 255;
      }
    }
    // Player dot: white with a dark outline so it reads on any ground.
    const center = (radius * side + radius) * 4;
    px[center] = 255; px[center + 1] = 255; px[center + 2] = 255;
    ctx.putImageData(image, 0, 0);
  };

  refresh();

  return {
    el,
    refresh,
    setVisible: (visible) => { el.style.display = visible ? 'block' : 'none'; },
    destroy: () => el.remove(),
  };
}
