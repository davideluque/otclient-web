import { Application, Container } from 'pixi.js';
import { parseDat } from './lib/dat';
import { parseSpr } from './lib/spr';
import { parseOtb } from './lib/otb';
import { buildAtlasPages, computeAtlasLayout } from './lib/atlas';
import { TileMap } from './lib/tileMap';
import { createAtlasTextures, renderTileRegion, buildDatIndex } from './lib/tileRenderer';
import { Viewport } from './lib/viewport';
import { buildOtbmIndex, parseTilesInTileArea } from './lib/otbmIndex';
import { ChunkManager } from './lib/chunkManager';
import type { OtbmIndex, OtbmTileAreaEntry } from './lib/otbmIndex';
import type { DatFile } from './lib/dat';
import type { SprFile } from './lib/spr';
import type { OtbFile } from './lib/otb';

// --- File loading UI ---

interface LoadedFiles {
  dat?: ArrayBuffer;
  spr?: ArrayBuffer;
  otb?: ArrayBuffer;
  otbm?: ArrayBuffer;
}

const loaded: LoadedFiles = {};
const SPAWN_FLOOR = 7;
const CHUNK_LOAD_RADIUS = 200;
const CHUNK_RECHECK_TILES = 4;
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

function classifyFile(name: string): keyof LoadedFiles | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.dat')) return 'dat';
  if (lower.endsWith('.spr')) return 'spr';
  if (lower.endsWith('.otb')) return 'otb';
  if (lower.endsWith('.otbm')) return 'otbm';
  return null;
}

async function handleFiles(files: FileList | File[]) {
  for (const file of files) {
    const type = classifyFile(file.name);
    if (!type) continue;

    loaded[type] = await file.arrayBuffer();
    addFileToList(`${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
  }

  const allLoaded = loaded.dat && loaded.spr && loaded.otb && loaded.otbm;
  if (allLoaded) {
    setStatus('Loading assets...');
    try {
      await startApp();
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`, true);
      console.error(e);
    }
  } else {
    const missing = (['dat', 'spr', 'otb', 'otbm'] as const).filter(k => !loaded[k]);
    setStatus(`Still need: ${missing.map(k => '.' + k).join(', ')}`);
  }
}

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

async function startApp() {
  const dat: DatFile = parseDat(loaded.dat!);
  setStatus('Parsed .dat...');

  const spr: SprFile = parseSpr(loaded.spr!);
  setStatus('Parsed .spr...');

  const otb: OtbFile = parseOtb(loaded.otb!);
  setStatus('Parsed .otb...');

  setStatus('Indexing .otbm...');
  const otbmBuffer = loaded.otbm!;
  const otbmIndex: OtbmIndex = buildOtbmIndex(otbmBuffer);
  const spawn = pickSpawn(otbmBuffer, otbmIndex);
  setStatus(`Indexed ${otbmIndex.tileAreas.length} chunks`);

  setStatus('Building texture atlas...');
  const atlasPages = buildAtlasPages(spr);
  const atlasTextures = createAtlasTextures(atlasPages);
  const layout = computeAtlasLayout(spr.spriteCount);
  const datIndex = buildDatIndex(dat);

  setStatus('Loading initial chunks...');
  const tileMap = new TileMap({ header: otbmIndex.header, tiles: [], towns: otbmIndex.towns }, otb);
  const chunkManager = new ChunkManager(otbmBuffer, otb, otbmIndex, tileMap);
  chunkManager.ensureChunksAround(spawn.x, spawn.y, spawn.z, CHUNK_LOAD_RADIUS);
  setStatus(`Loaded ${chunkManager.loadedChunkCount}/${chunkManager.totalChunkCount} chunks (${tileMap.size} tiles) around (${spawn.x}, ${spawn.y})`);

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
    centerX: spawn.x,
    centerY: spawn.y,
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
    zoom: 1,
  });
  const renderZ = spawn.z;
  let lastChunkCheckX = spawn.x;
  let lastChunkCheckY = spawn.y;

  let tileContainer: Container | null = null;
  let lastVisibleKey = '';

  function rebuildTiles() {
    if (tileContainer) {
      app.stage.removeChild(tileContainer);
      tileContainer.destroy({ children: true });
    }

    const visible = viewport.getVisibleTiles();
    lastVisibleKey = `${visible.x1},${visible.y1},${visible.x2},${visible.y2}`;

    tileContainer = renderTileRegion(
      tileMap, datIndex, atlasTextures, layout,
      visible.x1, visible.y1, visible.x2, visible.y2, renderZ,
    );

    app.stage.addChild(tileContainer);
  }

  function updateTransform() {
    if (!tileContainer) return;
    const offset = viewport.getContainerOffset();
    tileContainer.x = offset.x;
    tileContainer.y = offset.y;
    tileContainer.scale.set(viewport.zoom);
  }

  function ensureChunksIfMoved(): boolean {
    const dx = viewport.centerX - lastChunkCheckX;
    const dy = viewport.centerY - lastChunkCheckY;
    if (dx * dx + dy * dy < CHUNK_RECHECK_TILES * CHUNK_RECHECK_TILES) return false;
    lastChunkCheckX = viewport.centerX;
    lastChunkCheckY = viewport.centerY;
    const cx = Math.round(viewport.centerX);
    const cy = Math.round(viewport.centerY);
    const added = chunkManager.ensureChunksAround(cx, cy, renderZ, CHUNK_LOAD_RADIUS);
    console.log(
      `chunk check @ (${cx}, ${cy}): +${added} new — `
      + `${chunkManager.loadedChunkCount}/${chunkManager.totalChunkCount} loaded, `
      + `${tileMap.size} tiles in map`,
    );
    return added > 0;
  }

  function render(forceRebuild = false) {
    const chunksChanged = ensureChunksIfMoved();
    const visible = viewport.getVisibleTiles();
    const key = `${visible.x1},${visible.y1},${visible.x2},${visible.y2}`;

    if (forceRebuild || chunksChanged || key !== lastVisibleKey) {
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

  console.log(`Map loaded: ${tileMap.size} tiles streamed in ${chunkManager.loadedChunkCount}/${chunkManager.totalChunkCount} chunks, spawn at (${spawn.x}, ${spawn.y}, z=${spawn.z})`);
}

interface Spawn { x: number; y: number; z: number }

// Land in the densest floor-7 chunk we can find. Byte size of a TileArea's
// children block is roughly proportional to how many tile/item nodes are in
// it, so "largest chunk by bytes" almost always points at a city or town —
// which is where the player wants to start.
function pickSpawn(buffer: ArrayBuffer, index: OtbmIndex): Spawn {
  const sorted: OtbmTileAreaEntry[] = [];
  for (const e of index.tileAreas) if (e.baseZ === SPAWN_FLOOR) sorted.push(e);
  sorted.sort((a, b) => (b.childrenEnd - b.childrenStart) - (a.childrenEnd - a.childrenStart));

  for (const entry of sorted) {
    const tiles = parseTilesInTileArea(buffer, entry).filter(t => t.items.length > 0);
    if (tiles.length === 0) continue;

    let sumX = 0;
    let sumY = 0;
    for (const t of tiles) { sumX += t.position.x; sumY += t.position.y; }
    const cx = sumX / tiles.length;
    const cy = sumY / tiles.length;

    let best = tiles[0];
    let bestDist = Infinity;
    for (const t of tiles) {
      const dx = t.position.x - cx;
      const dy = t.position.y - cy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = t; }
    }
    return { x: best.position.x, y: best.position.y, z: best.position.z };
  }

  // Last resort: any chunk on any floor.
  const fallback = index.tileAreas[0];
  if (fallback) return { x: fallback.baseX + 128, y: fallback.baseY + 128, z: fallback.baseZ };
  return { x: 32100, y: 32100, z: SPAWN_FLOOR };
}
