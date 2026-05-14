import { Application, Container } from 'pixi.js';
import { parseDat } from './lib/dat';
import { parseSpr, releaseSprBuffer } from './lib/spr';
import { parseOtb } from './lib/otb';
import { OtbmAttr, OtbmNode, parseOtbmRegion } from './lib/otbm';
import { NODE_END, NODE_START, readNodeData, skipNode } from './lib/nodeTree';
import { buildAtlasPages, collectReferencedSpriteIds, computeAtlasLayout } from './lib/atlas';
import { TileMap } from './lib/tileMap';
import { createAtlasTextures, renderTileRegion, renderPlayer, buildDatIndex } from './lib/tileRenderer';
import { Viewport } from './lib/viewport';
import { buildCreatureIndex, createPlayer } from './lib/player';
import type { PlayerState } from './lib/player';
import {
  buildIlluminationOverlay,
  createLightMaskTexture,
  NIGHT_AMBIENT,
  DAY_AMBIENT,
  type LightingOptions,
} from './lib/lighting';
import { createFileLoader } from './lib/fileLoader';
import type { RenderTexture } from 'pixi.js';
import type { DatFile } from './lib/dat';
import type { SprFile } from './lib/spr';
import type { OtbFile } from './lib/otb';
import type { OtbmFile, OtbmRegion } from './lib/otbm';
import type { CompleteLoadedFiles } from './lib/fileLoader';

// --- File loading UI ---

const INITIAL_REGION_RADIUS = 100;
const dropZone = document.getElementById('drop-zone')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const statusEl = document.getElementById('status')!;
const fileListEl = document.getElementById('file-list')!;
const loaderEl = document.getElementById('loader')!;

function setStatus(msg: string, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'error' : '';
}

function addFileToList(name: string) {
  const li = document.createElement('li');
  li.textContent = name;
  fileListEl.appendChild(li);
}

const handleFiles = createFileLoader({
  setStatus,
  addFileToList,
  startApp,
  onError: console.error,
});

// Drag and drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
});

// Click to open file picker
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files) handleFiles(fileInput.files);
});

// --- App startup ---

async function startApp(loaded: CompleteLoadedFiles) {
  const dat: DatFile = parseDat(loaded.dat);
  setStatus('Parsed .dat...');

  const spr: SprFile = parseSpr(loaded.spr);
  setStatus('Parsed .spr...');

  const otb: OtbFile = parseOtb(loaded.otb);
  setStatus('Parsed .otb...');

  let initialRegion = getStandardRegion();
  let otbm: OtbmFile = parseOtbmRegion(loaded.otbm, initialRegion);
  if (otbm.tiles.length === 0) {
    initialRegion = getInitialRegion(loaded.otbm);
    otbm = parseOtbmRegion(loaded.otbm, initialRegion);
  }
  setStatus(`Loaded ${otbm.tiles.length} tiles around (${initialRegion.centerX}, ${initialRegion.centerY})`);

  setStatus('Building texture atlas...');
  const referencedSpriteIds = collectReferencedSpriteIds(dat, otb, otbm);
  const atlasPages = buildAtlasPages(spr, referencedSpriteIds);
  releaseSprBuffer(spr);
  const atlasTextures = createAtlasTextures(atlasPages);
  const layout = computeAtlasLayout(spr.spriteCount, referencedSpriteIds);
  const datIndex = buildDatIndex(dat);
  const atlasBytes = [...atlasPages.values()].reduce((sum, page) => sum + page.byteLength, 0);
  console.log(`Atlas CPU buffers: ${(atlasBytes / 1024 / 1024).toFixed(1)} MB across ${atlasPages.size} page(s)`);

  setStatus('Building tile map...');
  const tileMap = new TileMap(otbm, otb);
  setStatus(`Loaded ${tileMap.size} tiles around (${initialRegion.centerX}, ${initialRegion.centerY})`);

  const creatureIndex = buildCreatureIndex(dat);
  const player: PlayerState = createPlayer(
    initialRegion.centerX,
    initialRegion.centerY,
    initialRegion.z ?? 7,
    // Default outfit: lookType 128 (citizen). If the loaded .dat doesn't
    // ship that creature, renderPlayer falls back to drawing nothing —
    // the map still renders.
    { lookType: 128, headColor: 78, bodyColor: 132, legsColor: 13, feetColor: 38 },
  );

  // Initialize PixiJS
  const app = new Application();
  await app.init({
    background: '#000000',
    resizeTo: window,
    antialias: false,
    resolution: window.devicePixelRatio,
    autoDensity: true,
  });

  // Hide loader, show canvas
  loaderEl.style.display = 'none';
  document.body.appendChild(app.canvas);

  const viewport = new Viewport({
    centerX: initialRegion.centerX,
    centerY: initialRegion.centerY,
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
    zoom: 1,
  });
  const renderZ = initialRegion.z ?? 7;

  let tileContainer: Container | null = null;
  let lastVisibleKey = '';
  let ambient: LightingOptions = NIGHT_AMBIENT;
  let illuminationTexture: RenderTexture | null = null;
  const lightMask = createLightMaskTexture();

  function rebuildTiles() {
    if (tileContainer) {
      app.stage.removeChild(tileContainer);
      tileContainer.destroy({ children: true });
    }
    if (illuminationTexture) {
      illuminationTexture.destroy(true);
      illuminationTexture = null;
    }

    const visible = viewport.getVisibleTiles();
    lastVisibleKey = `${visible.x1},${visible.y1},${visible.x2},${visible.y2}`;

    // Split tile rendering at the player's row so the player draws on top
    // of objects to its north (walls, roofs) but behind objects to its south
    // (trees, fences). Not pixel-perfect at the player's own row but a big
    // improvement over "player always on top of everything".
    const playerRow = Math.floor(player.y);
    const tilesAbove = renderTileRegion(
      tileMap, datIndex, atlasTextures, layout,
      visible.x1, visible.y1, visible.x2, Math.min(playerRow - 1, visible.y2), renderZ,
    );
    const tilesBelow = renderTileRegion(
      tileMap, datIndex, atlasTextures, layout,
      visible.x1, Math.max(playerRow, visible.y1), visible.x2, visible.y2, renderZ,
    );

    tileContainer = new Container();
    tileContainer.addChild(tilesAbove);
    const playerSprite = renderPlayer(player, creatureIndex, atlasTextures, layout);
    if (playerSprite) tileContainer.addChild(playerSprite);
    tileContainer.addChild(tilesBelow);

    if (ambient.enabled) {
      const { sprite, texture } = buildIlluminationOverlay(
        app, tileMap, datIndex, lightMask,
        visible.x1, visible.y1, visible.x2, visible.y2, 7,
        ambient,
      );
      tileContainer.addChild(sprite);
      illuminationTexture = texture;
    }

    app.stage.addChild(tileContainer);
  }

  function updateTransform() {
    if (!tileContainer) return;
    const offset = viewport.getContainerOffset();
    tileContainer.x = offset.x;
    tileContainer.y = offset.y;
    tileContainer.scale.set(viewport.zoom);
  }

  function render(forceRebuild = false) {
    const visible = viewport.getVisibleTiles();
    const key = `${visible.x1},${visible.y1},${visible.x2},${visible.y2}`;

    if (forceRebuild || key !== lastVisibleKey) {
      rebuildTiles();
    }
    updateTransform();
  }

  render(true);

  // --- Touch/mouse controls ---

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    viewport.pan(dx, dy);
    render();
  });

  window.addEventListener('pointerup', () => {
    isDragging = false;
  });

  // Mouse wheel zoom
  app.canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    viewport.zoomBy(factor);
    render();
  }, { passive: false });

  // Pinch-to-zoom
  let lastPinchDist = 0;

  app.canvas.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist = Math.sqrt(dx * dx + dy * dy);
    }
  }, { passive: true });

  app.canvas.addEventListener('touchmove', (e: TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastPinchDist > 0) {
        const factor = dist / lastPinchDist;
        viewport.zoomBy(factor);
        render();
      }
      lastPinchDist = dist;
    }
  }, { passive: true });

  app.canvas.addEventListener('touchend', () => {
    lastPinchDist = 0;
  }, { passive: true });

  // Handle window resize
  window.addEventListener('resize', () => {
    viewport.screenWidth = window.innerWidth;
    viewport.screenHeight = window.innerHeight;
    render();
  });

  // N toggles night/day so you can see the difference
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'n' || e.key === 'N') {
      ambient = ambient === NIGHT_AMBIENT ? DAY_AMBIENT : NIGHT_AMBIENT;
      render(true);
    }
  });

  console.log(`Map loaded: ${tileMap.size} tiles, center at (${initialRegion.centerX}, ${initialRegion.centerY})`);
}

function getStandardRegion(): OtbmRegion {
  return { centerX: 32100, centerY: 32100, radius: INITIAL_REGION_RADIUS, z: 7 };
}

function getInitialRegion(buffer: ArrayBuffer): OtbmRegion {
  const tile = findFirstTile(buffer);
  if (!tile) {
    return getStandardRegion();
  }

  return {
    centerX: tile.x,
    centerY: tile.y,
    radius: INITIAL_REGION_RADIUS,
    z: tile.z,
  };
}

function findFirstTile(buffer: ArrayBuffer): { x: number; y: number; z: number } | null {
  const data = new Uint8Array(buffer);
  let offset = 4;
  const scanEnd = Math.min(data.length, 1024 * 1024);
  let areaBaseX = 0;
  let areaBaseY = 0;
  let areaBaseZ = 0;

  if (data[offset] !== NODE_START) return null;
  offset++;

  const root = readNodeData(data, offset);
  offset = root.nextOffset;

  function walk(depth = 0): { x: number; y: number; z: number } | null {
    if (depth > 8) return null;

    while (offset < scanEnd && offset < data.length) {
      const marker = data[offset];

      if (marker === NODE_END) {
        offset++;
        return null;
      }

      if (marker !== NODE_START) {
        offset++;
        continue;
      }

      offset++;
      const node = readNodeData(data, offset);
      offset = node.nextOffset;
      if (node.bytes.length === 0) {
        const found = walk(depth + 1);
        if (found) return found;
        continue;
      }

      const nodeType = node.bytes[0];
      if (nodeType === OtbmNode.TileArea) {
        areaBaseX = node.bytes[1] | (node.bytes[2] << 8);
        areaBaseY = node.bytes[3] | (node.bytes[4] << 8);
        areaBaseZ = node.bytes[5];
        if (areaBaseZ !== 7) {
          offset = skipNode(data, offset);
          continue;
        }
        const found = walk(depth + 1);
        if (found) return found;
      } else if (nodeType === OtbmNode.Tile || nodeType === OtbmNode.HouseTile) {
        if (tileNodeHasItems(node.bytes) || data[offset] === NODE_START) {
          return {
            x: areaBaseX + node.bytes[1],
            y: areaBaseY + node.bytes[2],
            z: areaBaseZ,
          };
        }
        offset = skipNode(data, offset);
      } else if (nodeType === OtbmNode.MapData || nodeType === OtbmNode.Towns) {
        const found = walk(depth + 1);
        if (found) return found;
      } else {
        offset = skipNode(data, offset);
      }
    }

    return null;
  }

  return walk();
}

function tileNodeHasItems(bytes: Uint8Array): boolean {
  let offset = bytes[0] === OtbmNode.HouseTile ? 7 : 3;

  while (offset < bytes.length) {
    const attrType = bytes[offset];
    offset++;

    if (attrType === OtbmAttr.Item) return true;
    if (attrType === OtbmAttr.TileFlags) {
      offset += 4;
    } else if (attrType === OtbmAttr.Description) {
      const len = bytes[offset] | (bytes[offset + 1] << 8);
      offset += 2 + len;
    } else {
      break;
    }
  }

  return false;
}
