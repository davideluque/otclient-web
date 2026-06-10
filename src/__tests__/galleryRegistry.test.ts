// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENTRIES, type GalleryCtx } from '../lib/gallery/registry';

function makeCtx(): GalleryCtx {
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  return {
    stage,
    log: vi.fn(),
    knobs: {
      button: vi.fn(),
      toggle: vi.fn(),
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll('style').forEach((s) => s.remove());
});

describe('gallery registry', () => {
  it('has unique entry names', () => {
    const names = ENTRIES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // The standalone-component contract, enforced: every entry mounts in a
  // bare document (no game page, no external CSS) and its teardown
  // removes what it added to <body>.
  it.each(ENTRIES.map((e) => ({ name: e.name, entry: e })))(
    'mounts and tears down cleanly: $name',
    ({ entry }) => {
      const ctx = makeCtx();
      const before = document.body.childElementCount;

      const teardown = entry.mount(ctx);
      expect(typeof teardown).toBe('function');

      teardown();
      expect(document.body.childElementCount).toBe(before);
    },
  );
});
