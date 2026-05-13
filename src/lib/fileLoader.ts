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

export function createFileLoader(options: FileLoaderOptions): (files: FileList | File[]) => Promise<void> {
  const loaded: LoadedFiles = {};
  let started = false;

  return async function handleFiles(files: FileList | File[]): Promise<void> {
    if (started) {
      options.setStatus('Already loaded. Refresh the page to load a different file set.');
      return;
    }

    for (const file of files) {
      const type = classifyFile(file.name);
      if (!type) continue;

      loaded[type] = await file.arrayBuffer();
      options.addFileToList(`${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
    }

    const complete = completeFiles(loaded);
    if (complete) {
      started = true;
      options.setStatus('Loading assets...');
      try {
        await options.startApp(complete);
      } catch (e) {
        options.setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`, true);
        options.onError?.(e);
      }
    } else {
      const missing = (['dat', 'spr', 'otb', 'otbm'] as const).filter(k => !loaded[k]);
      options.setStatus(`Still need: ${missing.map(k => '.' + k).join(', ')}`);
    }
  };
}
