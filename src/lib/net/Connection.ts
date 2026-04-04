import { InputPacket } from './InputPacket';
import { OutputPacket } from './OutputPacket';
import { xteaEncrypt, xteaDecrypt } from './xtea';
import type { XteaKey } from './xtea';

export type PacketHandler = (packet: InputPacket) => void;

/**
 * WebSocket connection to the OT server via the TCP proxy.
 * Handles packet framing (2-byte length prefix) and optional XTEA encryption.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private xteaKey: XteaKey | null = null;
  private onPacket: PacketHandler | null = null;
  private onClose: (() => void) | null = null;
  private onError: ((err: string) => void) | null = null;
  private receiveBuffer = new Uint8Array(0);

  private proxyUrl: string;

  constructor(proxyUrl: string) {
    this.proxyUrl = proxyUrl;
  }

  setPacketHandler(handler: PacketHandler): void {
    this.onPacket = handler;
  }

  setCloseHandler(handler: () => void): void {
    this.onClose = handler;
  }

  setErrorHandler(handler: (err: string) => void): void {
    this.onError = handler;
  }

  setXteaKey(key: XteaKey): void {
    this.xteaKey = key;
  }

  connect(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.proxyUrl}${path}`;
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => resolve();

      this.ws.onerror = () => {
        const msg = `WebSocket connection failed: ${url}`;
        this.onError?.(msg);
        reject(new Error(msg));
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.receiveBuffer = new Uint8Array(0);
        this.onClose?.();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleData(new Uint8Array(event.data as ArrayBuffer));
      };
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.receiveBuffer = new Uint8Array(0);
  }

  /**
   * Send a packet with 2-byte length prefix. Optionally XTEA-encrypts the payload.
   */
  send(packet: OutputPacket, encrypt = false): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    let payload = packet.toUint8Array();

    if (encrypt) {
      if (!this.xteaKey) {
        console.error('Cannot encrypt: no XTEA key set');
        return;
      }
      payload = xteaEncrypt(payload, this.xteaKey);
    }

    // 2-byte length prefix (little-endian)
    const frame = new Uint8Array(2 + payload.length);
    const view = new DataView(frame.buffer);
    view.setUint16(0, payload.length, true);
    frame.set(payload, 2);

    this.ws.send(frame.buffer);
  }

  /**
   * Handle incoming data: buffer, extract framed packets, decrypt, dispatch.
   */
  private handleData(data: Uint8Array): void {
    // Append to receive buffer
    const combined = new Uint8Array(this.receiveBuffer.length + data.length);
    combined.set(this.receiveBuffer);
    combined.set(data, this.receiveBuffer.length);
    this.receiveBuffer = combined;

    // Extract complete packets
    while (this.receiveBuffer.length >= 2) {
      const view = new DataView(
        this.receiveBuffer.buffer,
        this.receiveBuffer.byteOffset,
        this.receiveBuffer.byteLength,
      );
      const packetLen = view.getUint16(0, true);

      if (this.receiveBuffer.length < 2 + packetLen) break; // incomplete

      // Extract packet data
      const packetData = new Uint8Array(this.receiveBuffer.buffer, 2, packetLen).slice();

      // Advance buffer
      this.receiveBuffer = new Uint8Array(
        this.receiveBuffer.buffer,
        2 + packetLen,
        this.receiveBuffer.length - 2 - packetLen,
      ).slice();

      // Decrypt if key is set (must be multiple of 8 for XTEA block cipher)
      if (this.xteaKey && packetData.length >= 8 && packetData.length % 8 === 0) {
        xteaDecrypt(packetData, this.xteaKey);
      }

      // Dispatch to handler
      const packet = new InputPacket(packetData.buffer);
      this.onPacket?.(packet);
    }
  }
}
