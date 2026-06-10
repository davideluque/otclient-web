export interface LoadedFiles {
  dat?: ArrayBuffer;
  spr?: ArrayBuffer;
  otb?: ArrayBuffer;
  otbm?: ArrayBuffer;
}

export interface CompleteLoadedFiles {
  dat: ArrayBuffer;
  spr: ArrayBuffer;
  otb: ArrayBuffer;
  otbm: ArrayBuffer;
}

interface FileLoaderOptions {
  setStatus: (msg: string, isError?: boolean) => void;
  addFileToList: (name: string) => void;
  startApp: (files: CompleteLoadedFiles) => Promise<void>;
  onError?: (error: unknown) => void;
}

function classifyFile(name: string): keyof LoadedFiles | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.dat')) return 'dat';
  if (lower.endsWith('.spr')) return 'spr';
  if (lower.endsWith('.otb')) return 'otb';
  if (lower.endsWith('.otbm')) return 'otbm';
  return null;
}

function completeFiles(files: LoadedFiles): CompleteLoadedFiles | null {
  if (!files.dat || !files.spr || !files.otb || !files.otbm) return null;
  return {
    dat: files.dat,
    spr: files.spr,
    otb: files.otb,
    otbm: files.otbm,
  };
}

const MAX_FILE_BYTES = 256 * 1024 * 1024;

export function createFileLoader(options: FileLoaderOptions): (files: FileList | File[]) => Promise<void> {
  const loaded: LoadedFiles = {};
  let started = false;

  return async function handleFiles(files: FileList | File[]): Promise<void> {
    if (started) {
      options.setStatus('Already loaded. Refresh the page to load a different file set.');
      return;
    }

    let rejection: string | null = null;
    for (const file of files) {
      const type = classifyFile(file.name);
      if (!type) continue;

      // Reject before arrayBuffer() so a mislabeled multi-GB file can't
      // OOM the tab. Real 7.6 assets top out well under this: Tibia.spr
      // ~25 MB, large OTBM maps ~50 MB.
      if (file.size > MAX_FILE_BYTES) {
        rejection = `${file.name} is too large (${Math.round(file.size / 1024 / 1024)} MB) — not a Tibia 7.6 asset file.`;
        continue;
      }

      loaded[type] = await file.arrayBuffer();
      options.addFileToList(`${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
    }

    const complete = completeFiles(loaded);
    if (!complete && rejection) {
      // The rejection is the reason we're incomplete — keep the
      // explanation visible instead of the generic "Still need" list.
      options.setStatus(rejection, true);
      return;
    }
    if (complete) {
      started = true;
      options.setStatus('Loading assets...');
      try {
        await options.startApp(complete);
      } catch (e) {
        // Let the user retry with different files instead of forcing a refresh.
        started = false;
        options.setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`, true);
        options.onError?.(e);
      }
    } else {
      const missing = (['dat', 'spr', 'otb', 'otbm'] as const).filter(k => !loaded[k]);
      options.setStatus(`Still need: ${missing.map(k => '.' + k).join(', ')}`);
    }
  };
}
