// Optional auto-loader. If a per-version asset folder exists under public/
// with the expected filenames, fetches all four files on startup and skips
// the manual upload UI. Silent fallback on any miss — the manual drop-zone
// continues to work exactly as before.
//
// To remove the feature entirely: delete this file plus the two lines in
// src/main.ts that import and call tryAutoload(). Nothing else depends on
// it.
//
// To add a new client version: drop the four files in
// public/assets/<version>/ using the canonical names below and add an entry
// to MANIFESTS. Per-version overrides exist because some clients diverge
// from the stock naming (different items.otb shipment, etc.).
//
// Active version resolution order:
//   1. ?version=<v>     URL query string
//   2. VITE_CLIENT_VERSION   build-time env (.env / .env.local)
//   3. DEFAULT_VERSION  fallback
//
// Folder & filename convention follows the real Tibia client where
// possible: Tibia.dat, Tibia.spr, items.otb. The map is named world.otbm
// for consistency with TFS server distributions.

import type { CompleteLoadedFiles } from './fileLoader';

type FileKey = keyof CompleteLoadedFiles;

interface VersionManifest {
  base: string;
  files: Record<FileKey, string>;
}

const CANONICAL_FILES: Record<FileKey, string> = {
  dat: 'Tibia.dat',
  spr: 'Tibia.spr',
  otb: 'items.otb',
  otbm: 'world.otbm',
};

const MANIFESTS: Record<string, VersionManifest> = {
  '760': { base: '/assets/760', files: CANONICAL_FILES },
  // Future versions: add manifests here and create public/assets/<v>/.
  // '810': { base: '/assets/810', files: CANONICAL_FILES },
  // '860': { base: '/assets/860', files: CANONICAL_FILES },
};

const DEFAULT_VERSION = '760';
const FILE_KEYS: readonly FileKey[] = ['dat', 'spr', 'otb', 'otbm'] as const;

function resolveVersion(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('version');
  if (fromUrl) return fromUrl;
  const fromEnv = import.meta.env.VITE_CLIENT_VERSION as string | undefined;
  return fromEnv || DEFAULT_VERSION;
}

export interface AutoloadOptions {
  onStatus: (msg: string, isError?: boolean) => void;
  addFileToList: (name: string) => void;
  startApp: (files: CompleteLoadedFiles) => Promise<void>;
}

/**
 * Returns true if assets were found and startApp was launched.
 * Returns false if the folder is absent or any expected file is missing —
 * caller should then show the manual upload UI.
 */
export async function tryAutoload(options: AutoloadOptions): Promise<boolean> {
  const version = resolveVersion();
  const manifest = MANIFESTS[version];
  if (!manifest) return false;

  // Cheap presence probe: if even the .dat isn't there, don't fire the rest.
  // Keeps the console quiet when the folder isn't populated.
  const probeUrl = `${manifest.base}/${manifest.files.dat}`;
  try {
    const probe = await fetch(probeUrl, { method: 'HEAD' });
    if (!probe.ok) return false;
  } catch {
    return false;
  }

  options.onStatus(`Auto-loading ${version} assets from ${manifest.base}/...`);

  try {
    const responses = await Promise.all(
      FILE_KEYS.map(key => fetch(`${manifest.base}/${manifest.files[key]}`)),
    );
    for (const res of responses) {
      if (!res.ok) return false;
    }

    const buffers = await Promise.all(responses.map(r => r.arrayBuffer()));
    const loaded = {} as CompleteLoadedFiles;
    FILE_KEYS.forEach((key, i) => {
      loaded[key] = buffers[i];
      const name = manifest.files[key];
      options.addFileToList(`${name} (${(buffers[i].byteLength / 1024).toFixed(0)} KB)`);
    });

    options.onStatus('Loading assets...');
    await options.startApp(loaded);
    return true;
  } catch (e) {
    // Network/parse error during autoload — let the user upload manually.
    console.warn('Asset autoload failed, falling back to manual upload:', e);
    return false;
  }
}
