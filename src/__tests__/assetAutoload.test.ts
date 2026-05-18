// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { tryAutoload, type AutoloadOptions } from '../lib/assetAutoload';

function bufResponse(byte: number): Response {
  return new Response(new Uint8Array([byte]), { status: 200 });
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
  // Strip any version query the URL test may have added so tests stay independent.
  window.history.replaceState({}, '', '/');
});

describe('tryAutoload', () => {
  it('returns false when the probe HEAD 404s — no startApp, no status churn', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(notFound()) as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(opts.startApp).not.toHaveBeenCalled();
    expect(opts.onStatus).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns false when the probe HEAD throws (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('NetworkError')) as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(opts.startApp).not.toHaveBeenCalled();
  });

  it('fetches all four files and calls startApp on full success', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') return Promise.resolve(new Response(null, { status: 200 }));
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

  it('returns false on partial folder — one file 404s after a successful probe', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') return Promise.resolve(new Response(null, { status: 200 }));
      if (url.endsWith('items.otb')) return Promise.resolve(notFound());
      return Promise.resolve(bufResponse(1));
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(opts.startApp).not.toHaveBeenCalled();
  });

  it('returns false for an unknown version (no manifest, never touches fetch)', async () => {
    window.history.replaceState({}, '', '/?version=nonsense-999');
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
