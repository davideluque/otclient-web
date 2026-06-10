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

  it('allows a retry with different files after a failed boot', async () => {
    const statuses: string[] = [];
    const startApp = vi
      .fn()
      .mockRejectedValueOnce(new Error('corrupt spr'))
      .mockResolvedValueOnce(undefined);
    const handleFiles = createFileLoader({
      setStatus: msg => statuses.push(msg),
      addFileToList: vi.fn(),
      startApp,
    });

    await handleFiles(makeFiles());
    expect(statuses.at(-1)).toMatch(/corrupt spr/);

    await handleFiles(makeFiles());

    expect(startApp).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe('Loading assets...');
  });
});

describe('createFileLoader size cap', () => {
  it('rejects oversized files before reading them into memory', async () => {
    const statuses: string[] = [];
    const startApp = vi.fn().mockResolvedValue(undefined);
    const handleFiles = createFileLoader({
      setStatus: msg => statuses.push(msg),
      addFileToList: vi.fn(),
      startApp,
    });

    // A File whose reported size is huge; arrayBuffer() must never run.
    const huge = new File([new Uint8Array(1)], 'Tibia.spr');
    Object.defineProperty(huge, 'size', { value: 300 * 1024 * 1024 });
    const arrayBuffer = vi.spyOn(huge, 'arrayBuffer');

    await handleFiles([huge]);

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(startApp).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toMatch(/too large/);
  });
});
