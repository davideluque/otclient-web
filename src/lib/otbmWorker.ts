import { buildTileMapSnapshotInWorker } from './otbmWorkerCore';
import type { OTBMWorkerIncomingMessage, OTBMWorkerOutgoingMessage } from './otbmWorkerCore';

interface WorkerContext {
  onmessage: ((event: MessageEvent<OTBMWorkerIncomingMessage>) => void) | null;
  postMessage(message: OTBMWorkerOutgoingMessage): void;
}

const ctx = self as unknown as WorkerContext;

ctx.onmessage = (event: MessageEvent<OTBMWorkerIncomingMessage>) => {
  try {
    const tileMap = buildTileMapSnapshotInWorker(event.data, message => {
      ctx.postMessage(message satisfies OTBMWorkerOutgoingMessage);
    });

    ctx.postMessage({
      type: 'complete',
      tileMap,
    } satisfies OTBMWorkerOutgoingMessage);
  } catch (e) {
    ctx.postMessage({
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    } satisfies OTBMWorkerOutgoingMessage);
  }
};
