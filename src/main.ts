import { Application, Container } from 'pixi.js';
import { parseDat } from './lib/dat';
import { parseSpr } from './lib/spr';
import { parseOtb } from './lib/otb';
import { parseOtbm } from './lib/otbm';
import { buildAtlasPages, computeAtlasLayout } from './lib/atlas';
import { TileMap } from './lib/tileMap';
import { createAtlasTextures, renderTileRegion, buildDatIndex } from './lib/tileRenderer';
import { Viewport } from './lib/viewport';
import type { DatFile } from './lib/dat';
import type { SprFile } from './lib/spr';
import type { OtbFile } from './lib/otb';
import type { OtbmFile } from './lib/otbm';

// --- File loading UI ---

interface LoadedFiles {
  dat?: ArrayBuffer;
  spr?: ArrayBuffer;
  otb?: ArrayBuffer;
  otbm?: ArrayBuffer;
}

const loaded: LoadedFiles = {};
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

  const otbm: OtbmFile = parseOtbm(loaded.otbm!);
  setStatus('Parsed .otbm...');

  setStatus('Building texture atlas...');
  const atlasPages = buildAtlasPages(spr);
  const atlasTextures = createAtlasTextures(atlasPages);
  const layout = computeAtlasLayout(spr.spriteCount);
  const datIndex = buildDatIndex(dat);

  setStatus('Building tile map...');
  const tileMap = new TileMap(otbm, otb);

  // Initialize PixiJS
  const app = new Application();
  await app.init({
    background: '#1a1a2e',
    resizeTo: window,
    antialias: false,
    resolution: window.devicePixelRatio,
    autoDensity: true,
  });

  // Hide loader, show canvas
  loaderEl.style.display = 'none';
  document.body.appendChild(app.canvas);

  // Set up viewport centered on map
  const centerX = Math.floor((tileMap.minX + tileMap.maxX) / 2);
  const centerY = Math.floor((tileMap.minY + tileMap.maxY) / 2);

  const viewport = new Viewport({
    centerX,
    centerY,
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
    zoom: 1,
  });

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
      visible.x1, visible.y1, visible.x2, visible.y2, 7,
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

  console.log(`Map loaded: ${tileMap.size} tiles, center at (${centerX}, ${centerY})`);
}
