// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { createFileLoader } from '../lib/fileLoader';

function makeFiles(): File[] {
  return [
    new File([new Uint8Array([1])], 'Tibia.dat'),
    new File([new Uint8Array([2])], 'Tibia.spr'),
    new File([new Uint8Array([3])], 'items.otb'),
    new File([new Uint8Array([4])], 'test.otbm'),
  ];
}

describe('createFileLoader', () => {
  it('starts once and asks for refresh on subsequent complete drops', async () => {
    const statuses: string[] = [];
    const startApp = vi.fn().mockResolvedValue(undefined);
    const handleFiles = createFileLoader({
      setStatus: msg => statuses.push(msg),
      addFileToList: vi.fn(),
      startApp,
    });

    await handleFiles(makeFiles());
    await handleFiles(makeFiles());

    expect(startApp).toHaveBeenCalledTimes(1);
    expect(statuses).toContain('Loading assets...');
    expect(statuses.at(-1)).toBe('Already loaded. Refresh the page to load a different file set.');
  });
});
