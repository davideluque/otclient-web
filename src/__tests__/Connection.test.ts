import { afterEach, describe, expect, it } from 'vitest';
import { Connection } from '../lib/net/common/Connection';
import { OutputPacket } from '../lib/net/common/OutputPacket';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  binaryType: BinaryType = 'blob';
  readyState = MockWebSocket.CONNECTING;
  sent: ArrayBufferLike[] = [];
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof data === 'string' || data instanceof Blob) return;
    this.sent.push(ArrayBuffer.isView(data) ? data.buffer : data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSING;
  }

  openFromServer(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  closeFromServer(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new Event('close') as CloseEvent);
  }
}

const originalWebSocket = globalThis.WebSocket;

describe('Connection', () => {
  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    MockWebSocket.instances = [];
  });

  it('keeps a replacement socket active when a stale socket closes later', async () => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    const conn = new Connection('ws://proxy');

    const firstConnect = conn.connect('/login');
    const first = MockWebSocket.instances[0];
    first.openFromServer();
    await firstConnect;

    const secondConnect = conn.connect('/login');
    const second = MockWebSocket.instances[1];
    second.openFromServer();
    await secondConnect;

    first.closeFromServer();

    const packet = new OutputPacket();
    packet.addU8(0x1e);
    conn.send(packet);

    expect(second.sent).toHaveLength(1);
  });
});
