// Optional auto-loader: if public/assets/<version>/manifest.json exists,
// fetches the four files it lists instead of showing the upload UI. Silent
// fallback on any miss. Remove by deleting this file + its two lines in
// main.ts. Version resolves from ?version=<v>, then VITE_CLIENT_VERSION,
// then DEFAULT_VERSION.

import type { CompleteLoadedFiles } from './fileLoader';

type FileKey = keyof CompleteLoadedFiles;

interface Manifest {
  files: Record<FileKey, string>;
}

const FILE_KEYS: readonly FileKey[] = ['dat', 'spr', 'otb', 'otbm'] as const;
const DEFAULT_VERSION = '760';

function isValidManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== 'object') return false;
  const files = (value as { files?: unknown }).files;
  if (!files || typeof files !== 'object') return false;
  return FILE_KEYS.every(k => typeof (files as Record<string, unknown>)[k] === 'string');
}

function resolveVersion(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('version');
  if (fromUrl) return fromUrl;
  const fromEnv = import.meta.env.VITE_CLIENT_VERSION as string | undefined;
  return fromEnv || DEFAULT_VERSION;
}

function baseFor(version: string): string {
  // Prefixed with import.meta.env.BASE_URL so subpath deploys still resolve.
  return `${import.meta.env.BASE_URL}assets/${version}`;
}

export interface AutoloadOptions {
  onStatus: (msg: string, isError?: boolean) => void;
  addFileToList: (name: string) => void;
  startApp: (files: CompleteLoadedFiles) => Promise<void>;
}

/**
 * Returns true if assets were found and startApp was launched.
 * Returns false (silently) if the manifest is absent/malformed or any
 * listed file 404s — caller falls back to the manual upload UI.
 */
export async function tryAutoload(options: AutoloadOptions): Promise<boolean> {
  const version = resolveVersion();
  const base = baseFor(version);

  // Probe manifest first. Missing / non-JSON / wrong shape = silent fallback.
  let manifest: Manifest;
  try {
    const res = await fetch(`${base}/manifest.json`);
    if (!res.ok) return false;
    const json: unknown = await res.json();
    if (!isValidManifest(json)) {
      console.warn(`Asset autoload: malformed manifest at ${base}/manifest.json`);
      return false;
    }
    manifest = json;
  } catch {
    return false;
  }

  // Manifest succeeded — autoload is committed. Surface that to the user
  // immediately so the drop-zone doesn't sit there during the .spr fetch
  // and look like it's waiting for input. A later file 404 (partial folder)
  // is treated as a config error with an explicit message rather than a
  // silent fallback: if the user set up the folder, they want to know what
  // went wrong. Network/parse errors get a generic error message so the
  // status doesn't stay stuck on "Loading...".
  options.onStatus('Loading assets...');

  try {
    const responses = await Promise.all(
      FILE_KEYS.map(key => fetch(`${base}/${manifest.files[key]}`)),
    );
    for (let i = 0; i < responses.length; i++) {
      if (!responses[i].ok) {
        const missing = manifest.files[FILE_KEYS[i]];
        options.onStatus(
          `Could not load ${missing}. Drop files to load manually.`,
          true,
        );
        return false;
      }
    }

    const buffers = await Promise.all(responses.map(r => r.arrayBuffer()));
    const loaded = {} as CompleteLoadedFiles;
    FILE_KEYS.forEach((key, i) => {
      loaded[key] = buffers[i];
      const name = manifest.files[key];
      options.addFileToList(`${name} (${(buffers[i].byteLength / 1024).toFixed(0)} KB)`);
    });

    await options.startApp(loaded);
    return true;
  } catch (e) {
    console.warn('Asset autoload failed, falling back to manual upload:', e);
    options.onStatus('Could not load assets. Drop files to load manually.', true);
    return false;
  }
}
