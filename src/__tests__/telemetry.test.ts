// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { initTelemetry, resetTelemetry, telemetry } from '../lib/jamera/telemetry';

afterEach(() => {
  resetTelemetry();
  vi.restoreAllMocks();
});

describe('telemetry', () => {
  it('is a no-op before init', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    telemetry('walk-send', { dir: 1 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('derives the HTTP sink from the proxy WS url and flushes a full batch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    initTelemetry('ws://100.64.199.111:8090/?x=1');

    for (let i = 0; i < 60; i++) telemetry('walk-send', { dir: 1 });
    expect(fetchSpy).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls.at(-1)!;
    expect(url).toBe('http://100.64.199.111:8090/telemetry');
    const batch = JSON.parse(String(init!.body));
    expect(Array.isArray(batch)).toBe(true);
    const sends = batch.filter((e: { name: string }) => e.name === 'walk-send');
    expect(sends.length).toBeGreaterThanOrEqual(59); // the init event occupies one batch slot
    expect(sends[0].session).toBeTruthy();
    expect(sends[0].t).toBeGreaterThan(0);
    expect(typeof sends[0].pt).toBe('number');
  });

  it('maps wss to https', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    initTelemetry('wss://example.com:8090');
    for (let i = 0; i < 60; i++) telemetry('fps', { fps: 60 });
    expect(String(fetchSpy.mock.calls.at(-1)![0])).toBe('https://example.com:8090/telemetry');
  });
});
