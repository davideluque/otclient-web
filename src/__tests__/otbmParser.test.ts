import { describe, it, expect, vi } from 'vitest';
import { OtbmParser } from '../lib/otbmParser';
import type { WorkerLike } from '../lib/otbmParser';
import type { OtbmFile, OtbmRegion } from '../lib/otbm';

/**
 * Minimal in-process stand-in for a real Worker. Captures every
 * outgoing postMessage so the test can inspect / hand-feed responses
 * by calling `respond(...)`. Mirrors what a real Worker would do
 * asynchronously, but stays synchronous for test simplicity — the
 * client class doesn't care about microtask ordering.
 */
class MockWorker implements WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: Array<{ message: unknown; transfer?: Transferable[] }> = [];
  terminated = false;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.posted.push({ message, transfer });
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Pretend the worker sent a message back. */
  respond(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
  /** Pretend the worker crashed. */
  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function makeOtbmStub(): OtbmFile {
  return {
    header: { version: 2, width: 1, height: 1, majorVersionItems: 3, minorVersionItems: 760 },
    tiles: [],
    towns: [],
  };
}

describe('OtbmParser', () => {
  it('transfers the buffer on setBuffer with an init message', () => {
    const mock = new MockWorker();
    const parser = new OtbmParser({ workerFactory: () => mock });
    const buf = new ArrayBuffer(8);
    parser.setBuffer(buf);
    expect(mock.posted).toHaveLength(1);
    expect(mock.posted[0].message).toEqual({ type: 'init', buffer: buf });
    expect(mock.posted[0].transfer).toEqual([buf]);
  });

  it('posts a parse message with a unique id and resolves on response', async () => {
    const mock = new MockWorker();
    const parser = new OtbmParser({ workerFactory: () => mock });
    const region: OtbmRegion = { centerX: 100, centerY: 100, radius: 10, z: 7 };

    const promise = parser.parseRegion(region);
    expect(mock.posted).toHaveLength(1);
    const sent = mock.posted[0].message as { type: string; id: number; region: OtbmRegion };
    expect(sent.type).toBe('parse');
    expect(sent.region).toEqual(region);

    const result = makeOtbmStub();
    mock.respond({ id: sent.id, result });
    await expect(promise).resolves.toBe(result);
  });

  it('rejects the matching promise on an error response', async () => {
    const mock = new MockWorker();
    const parser = new OtbmParser({ workerFactory: () => mock });
    const promise = parser.parseRegion({ centerX: 0, centerY: 0, radius: 10, z: 7 });
    const sent = mock.posted[0].message as { id: number };

    mock.respond({ id: sent.id, error: 'something broke' });
    await expect(promise).rejects.toThrow('something broke');
  });

  it('routes concurrent requests by id, no cross-talk', async () => {
    const mock = new MockWorker();
    const parser = new OtbmParser({ workerFactory: () => mock });
    const region: OtbmRegion = { centerX: 0, centerY: 0, radius: 10, z: 7 };

    const pA = parser.parseRegion(region);
    const pB = parser.parseRegion(region);
    expect(mock.posted).toHaveLength(2);
    const idA = (mock.posted[0].message as { id: number }).id;
    const idB = (mock.posted[1].message as { id: number }).id;
    expect(idA).not.toBe(idB);

    // Reply to B first, then A — order shouldn't matter.
    const resultA = makeOtbmStub();
    const resultB = makeOtbmStub();
    mock.respond({ id: idB, result: resultB });
    mock.respond({ id: idA, result: resultA });

    await expect(pA).resolves.toBe(resultA);
    await expect(pB).resolves.toBe(resultB);
  });

  it('ignores responses for unknown ids (e.g. after destroy)', () => {
    const mock = new MockWorker();
    new OtbmParser({ workerFactory: () => mock });
    // No outstanding requests. A stray response shouldn't throw.
    expect(() => mock.respond({ id: 999, result: makeOtbmStub() })).not.toThrow();
  });

  it('rejects every in-flight request on worker error', async () => {
    const mock = new MockWorker();
    const parser = new OtbmParser({ workerFactory: () => mock });
    const region: OtbmRegion = { centerX: 0, centerY: 0, radius: 10, z: 7 };
    const pA = parser.parseRegion(region);
    const pB = parser.parseRegion(region);

    mock.crash('worker died');

    await expect(pA).rejects.toThrow('worker died');
    await expect(pB).rejects.toThrow('worker died');
  });

  it('destroy() terminates the worker and rejects pending requests', async () => {
    const mock = new MockWorker();
    const parser = new OtbmParser({ workerFactory: () => mock });
    const promise = parser.parseRegion({ centerX: 0, centerY: 0, radius: 10, z: 7 });

    parser.destroy();
    expect(mock.terminated).toBe(true);
    await expect(promise).rejects.toThrow('destroyed');
  });

  it('parseRegion after destroy returns a rejected promise immediately', async () => {
    const mock = new MockWorker();
    const parser = new OtbmParser({ workerFactory: () => mock });
    parser.destroy();
    const region: OtbmRegion = { centerX: 0, centerY: 0, radius: 10, z: 7 };
    // Without the destroyed guard the Promise would never resolve because
    // there's no worker to respond. The guard makes the contract explicit.
    await expect(parser.parseRegion(region)).rejects.toThrow('destroyed');
  });

  it('setBuffer after destroy throws', () => {
    const mock = new MockWorker();
    const parser = new OtbmParser({ workerFactory: () => mock });
    parser.destroy();
    expect(() => parser.setBuffer(new ArrayBuffer(8))).toThrow('destroyed');
  });

  it('destroy() is idempotent — calling twice does not re-terminate', () => {
    const mock = new MockWorker();
    const parser = new OtbmParser({ workerFactory: () => mock });
    parser.destroy();
    expect(mock.terminated).toBe(true);
    // Reset and re-call destroy — the second call should be a no-op.
    mock.terminated = false;
    parser.destroy();
    expect(mock.terminated).toBe(false);
  });

  it('keeps unused vitest spy ergonomics for future-proofing', () => {
    // Anchor test: if vi changes its public surface and we wire spy-based
    // tests later, this ensures the import path is still good.
    expect(vi.fn).toBeDefined();
  });
});
