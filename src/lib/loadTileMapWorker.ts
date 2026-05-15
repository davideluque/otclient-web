import { TileMap } from './tileMap';
import type {
  OTBMWorkerBuildMessage,
  OTBMWorkerOutgoingMessage,
  OTBMWorkerProgressMessage,
} from './otbmWorkerCore';

export function loadTileMapInWorker(
  otbBuffer: ArrayBuffer,
  otbmBuffer: ArrayBuffer,
  onProgress: (message: OTBMWorkerProgressMessage) => void,
): Promise<TileMap> {
  const worker = new Worker(new URL('./otbmWorker.ts', import.meta.url), { type: 'module' });

  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<OTBMWorkerOutgoingMessage>) => {
      const message = event.data;

      if (message.type === 'progress') {
        onProgress(message);
        return;
      }

      worker.terminate();

      if (message.type === 'complete') {
        resolve(TileMap.fromSnapshot(message.tileMap));
      } else {
        reject(new Error(message.message));
      }
    };

    worker.onerror = event => {
      worker.terminate();
      reject(new Error(event.message));
    };

    const message: OTBMWorkerBuildMessage = {
      type: 'build-tile-map',
      otbBuffer,
      otbmBuffer,
    };
    worker.postMessage(message, [otbBuffer, otbmBuffer]);
  });
}
