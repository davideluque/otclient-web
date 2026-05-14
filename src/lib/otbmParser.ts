import type { OtbmFile, OtbmRegion } from './otbm';

/**
 * Minimal Worker-shaped interface — `Worker | MockWorker` for tests.
 * Only the methods we actually use.
 */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

type ParseResponse =
  | { id: number; result: OtbmFile }
  | { id: number; error: string };

interface OtbmParserOpts {
  /** Override the worker factory — used by tests to inject a mock. The
   *  default lazy-creates a real Worker pointing at otbmWorker.ts. */
  workerFactory?: () => WorkerLike;
}

/**
 * Main-thread façade over the OTBM-parsing worker. Owns the lifecycle
 * of a single Worker, multiplexes parse requests by an integer id, and
 * resolves the matching Promise when the worker responds.
 *
 * Usage:
 *   const parser = new OtbmParser();
 *   parser.setBuffer(otbmArrayBuffer); // transfers ownership
 *   const region = await parser.parseRegion({ centerX, centerY, radius, z });
 */
export class OtbmParser {
  private worker: WorkerLike;
  private pending = new Map<number, {
    resolve: (file: OtbmFile) => void;
    reject: (err: Error) => void;
  }>();
  private nextId = 0;
  private destroyed = false;

  constructor(opts: OtbmParserOpts = {}) {
    this.worker = (opts.workerFactory ?? defaultWorkerFactory)();
    this.worker.onmessage = (e: MessageEvent) => this.onMessage(e.data as ParseResponse);
    this.worker.onerror = (e: ErrorEvent) => this.onError(e);
  }

  /**
   * Hand the raw .otbm buffer to the worker. The buffer is transferred
   * (not copied), so it becomes inaccessible on the main thread after
   * this call — all OTBM parsing has to go through this parser from
   * here on. Call once at startup before any parseRegion.
   */
  setBuffer(buffer: ArrayBuffer): void {
    if (this.destroyed) throw new Error('OtbmParser destroyed');
    this.worker.postMessage({ type: 'init', buffer }, [buffer]);
  }

  /**
   * Parse a single region. Returns a Promise that resolves with the
   * parsed OtbmFile or rejects with the worker's error message.
   * Multiple parseRegion calls are safe in flight at once — each gets a
   * unique id and the worker processes them in order it received them.
   * Returns a rejected Promise immediately if the parser was destroyed
   * (the worker is gone, so the Promise would otherwise never resolve).
   */
  parseRegion(region: OtbmRegion): Promise<OtbmFile> {
    if (this.destroyed) {
      return Promise.reject(new Error('OtbmParser destroyed'));
    }
    return new Promise<OtbmFile>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'parse', id, region });
    });
  }

  /** Terminate the worker and reject any in-flight requests. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('OtbmParser destroyed'));
    this.pending.clear();
  }

  private onMessage(msg: ParseResponse) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if ('error' in msg) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  }

  private onError(e: ErrorEvent) {
    // A worker-level error rejects every in-flight request — no per-id
    // tag, so we can't route it to a specific Promise.
    const err = new Error(e.message || 'OTBM worker error');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

function defaultWorkerFactory(): WorkerLike {
  return new Worker(new URL('./otbmWorker.ts', import.meta.url), { type: 'module' });
}
