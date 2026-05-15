import { parseOtb } from './otb';
import { parseOtbmWithProgress } from './otbm';
import { TileMap } from './tileMap';
import type { TileMapSnapshot } from './tileMap';

export type OTBMWorkerStage = 'parsing-otbm';

export interface OTBMWorkerProgressMessage {
  type: 'progress';
  stage: OTBMWorkerStage;
  bytesProcessed: number;
  bytesTotal: number;
}

export interface OTBMWorkerCompleteMessage {
  type: 'complete';
  tileMap: TileMapSnapshot;
}

export interface OTBMWorkerErrorMessage {
  type: 'error';
  message: string;
}

export interface OTBMWorkerBuildMessage {
  type: 'build-tile-map';
  otbBuffer: ArrayBuffer;
  otbmBuffer: ArrayBuffer;
}

export type OTBMWorkerIncomingMessage = OTBMWorkerBuildMessage;
export type OTBMWorkerOutgoingMessage =
  | OTBMWorkerProgressMessage
  | OTBMWorkerCompleteMessage
  | OTBMWorkerErrorMessage;

export function buildTileMapSnapshotInWorker(
  message: OTBMWorkerBuildMessage,
  postProgress: (message: OTBMWorkerProgressMessage) => void,
): TileMapSnapshot {
  const otb = parseOtb(message.otbBuffer);
  const otbm = parseOtbmWithProgress(message.otbmBuffer, progress => {
    postProgress({
      type: 'progress',
      stage: 'parsing-otbm',
      bytesProcessed: progress.bytesProcessed,
      bytesTotal: progress.bytesTotal,
    });
  });

  return new TileMap(otbm, otb).toSnapshot();
}
