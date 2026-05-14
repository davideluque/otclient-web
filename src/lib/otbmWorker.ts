/// <reference lib="webworker" />

/**
 * Web Worker that parses OTBM regions off the main thread. The worker
 * holds the raw .otbm ArrayBuffer (transferred from the main thread
 * once at startup) and responds to per-region parse requests, so a
 * heavy parse no longer blocks the render loop.
 *
 * Protocol (see otbmParser.ts on the main side):
 *   IN  { type: 'init', buffer: ArrayBuffer }   transferred, no reply
 *   IN  { type: 'parse', id: number, region }   parses, replies once
 *   OUT { id: number, result: OtbmFile }        success
 *   OUT { id: number, error: string }           failure or no-init
 */

import { parseOtbmRegion } from './otbm';
import type { OtbmRegion } from './otbm';

type InitMessage = { type: 'init'; buffer: ArrayBuffer };
type ParseMessage = { type: 'parse'; id: number; region: OtbmRegion };
type InboundMessage = InitMessage | ParseMessage;

// The worker global is DedicatedWorkerGlobalScope, not Worker (Worker is
// the host-side handle). The reference-lib directive above pulls in the
// right ambient types so `self.postMessage` resolves to the worker
// signature (no targetOrigin required).
declare const self: DedicatedWorkerGlobalScope;

let buffer: ArrayBuffer | null = null;

self.onmessage = (e: MessageEvent<InboundMessage>) => {
  const msg = e.data;
  // Guard against any non-object message making it through (e.g. a
  // misconfigured external sender) before we try to read .type.
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'init') {
    buffer = msg.buffer;
    return;
  }

  if (msg.type === 'parse') {
    if (!buffer) {
      self.postMessage({
        id: msg.id,
        error: 'OTBM buffer not initialized — call setBuffer before parseRegion',
      });
      return;
    }
    try {
      const result = parseOtbmRegion(buffer, msg.region);
      self.postMessage({ id: msg.id, result });
    } catch (err) {
      self.postMessage({
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
