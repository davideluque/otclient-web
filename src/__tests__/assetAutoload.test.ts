// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { tryAutoload, type AutoloadOptions } from '../lib/assetAutoload';

const VALID_MANIFEST = {
  files: { dat: 'Tibia.dat', spr: 'Tibia.spr', otb: 'items.otb', otbm: 'world.otbm' },
};

function bufResponse(byte: number): Response {
  return new Response(new Uint8Array([byte]), { status: 200 });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

function makeOptions() {
  const onStatus = vi.fn<AutoloadOptions['onStatus']>();
  const addFileToList = vi.fn<AutoloadOptions['addFileToList']>();
  const startApp = vi.fn<AutoloadOptions['startApp']>().mockResolvedValue(undefined);
  return { onStatus, addFileToList, startApp };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  window.history.replaceState({}, '', '/');
});

describe('tryAutoload', () => {
  it('returns false when manifest.json 404s — no startApp, no status churn', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(notFound()) as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(opts.startApp).not.toHaveBeenCalled();
    expect(opts.onStatus).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns false when manifest fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('NetworkError')) as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(opts.startApp).not.toHaveBeenCalled();
  });

  it('returns false (with warning) when manifest JSON is malformed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ wrong: 'shape' })) as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(opts.startApp).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reads filenames from manifest.json and calls startApp on full success', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('manifest.json')) return Promise.resolve(jsonResponse(VALID_MANIFEST));
      if (url.endsWith('Tibia.dat')) return Promise.resolve(bufResponse(1));
      if (url.endsWith('Tibia.spr')) return Promise.resolve(bufResponse(2));
      if (url.endsWith('items.otb')) return Promise.resolve(bufResponse(3));
      if (url.endsWith('world.otbm')) return Promise.resolve(bufResponse(4));
      throw new Error(`unexpected url ${url}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(true);
    expect(opts.startApp).toHaveBeenCalledTimes(1);
    const [loaded] = opts.startApp.mock.calls[0];
    expect(loaded.dat).toBeInstanceOf(ArrayBuffer);
    expect(loaded.spr).toBeInstanceOf(ArrayBuffer);
    expect(loaded.otb).toBeInstanceOf(ArrayBuffer);
    expect(loaded.otbm).toBeInstanceOf(ArrayBuffer);
    expect(opts.addFileToList).toHaveBeenCalledTimes(4);
  });

  it('honours custom filenames from the manifest (not hardcoded)', async () => {
    const customManifest = {
      files: { dat: 'a.dat', spr: 'b.spr', otb: 'c.otb', otbm: 'd.otbm' },
    };
    const seenAssetUrls: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('manifest.json')) return Promise.resolve(jsonResponse(customManifest));
      seenAssetUrls.push(url);
      return Promise.resolve(bufResponse(0));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await tryAutoload(makeOptions());

    expect(seenAssetUrls.some(u => u.endsWith('/a.dat'))).toBe(true);
    expect(seenAssetUrls.some(u => u.endsWith('/d.otbm'))).toBe(true);
  });

  it('returns false on partial folder — listed file 404s after manifest succeeds', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('manifest.json')) return Promise.resolve(jsonResponse(VALID_MANIFEST));
      if (url.endsWith('items.otb')) return Promise.resolve(notFound());
      return Promise.resolve(bufResponse(1));
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(opts.startApp).not.toHaveBeenCalled();
    // Silent fallback: no "Auto-loaded…" text should leak through.
    expect(opts.onStatus).not.toHaveBeenCalled();
  });

  it('targets the version folder from ?version=<v>', async () => {
    window.history.replaceState({}, '', '/?version=810');
    const seen: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      seen.push(url);
      return Promise.resolve(notFound());
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await tryAutoload(makeOptions());

    expect(seen[0]).toBe(`${import.meta.env.BASE_URL}assets/810/manifest.json`);
  });

  it('prefixes URLs with import.meta.env.BASE_URL for subpath deploys', async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      seen.push(url);
      return Promise.resolve(notFound());
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await tryAutoload(makeOptions());

    expect(seen[0].startsWith(import.meta.env.BASE_URL)).toBe(true);
  });
});
