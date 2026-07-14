// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindScreenWakeLock, loadKeepScreenAwake } from '../lib/jamera/screenWakeLock';

class FakeSentinel extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}

describe('screen wake lock', () => {
  beforeEach(() => localStorage.clear());

  it('defaults on and requests silently on the first ordinary interaction', async () => {
    const sentinel = new FakeSentinel();
    const request = vi.fn(async () => sentinel);
    const handle = bindScreenWakeLock(document, { wakeLock: { request } });

    document.dispatchEvent(new PointerEvent('pointerdown'));
    await Promise.resolve();

    expect(request).toHaveBeenCalledWith('screen');
    expect(document.body.children).toHaveLength(0);
    handle.destroy();
  });

  it('reacquires after WebKit releases the lock while the page is hidden', async () => {
    const first = new FakeSentinel();
    const second = new FakeSentinel();
    const request = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const handle = bindScreenWakeLock(document, { wakeLock: { request } });
    document.dispatchEvent(new PointerEvent('pointerdown'));
    await Promise.resolve();
    first.dispatchEvent(new Event('release'));
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(2);
    handle.destroy();
  });

  it('the setting releases the lock and persists without a dialog', async () => {
    const sentinel = new FakeSentinel();
    const handle = bindScreenWakeLock(document, {
      wakeLock: { request: vi.fn(async () => sentinel) },
    });
    document.dispatchEvent(new PointerEvent('pointerdown'));
    await Promise.resolve();
    handle.setEnabled(false);
    await Promise.resolve();

    expect(sentinel.release).toHaveBeenCalledOnce();
    expect(loadKeepScreenAwake()).toBe(false);
    handle.destroy();
  });

  it('does nothing on browsers without the API', () => {
    const handle = bindScreenWakeLock(document, {});
    expect(() => document.dispatchEvent(new PointerEvent('pointerdown'))).not.toThrow();
    handle.destroy();
  });
});
