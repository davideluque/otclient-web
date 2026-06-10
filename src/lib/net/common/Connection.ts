import { InputPacket } from './InputPacket';
import { OutputPacket } from './OutputPacket';
import { xteaEncrypt, xteaDecrypt } from './xtea';
import { ParseError } from '../../parseError';
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
    // Reconnects must retire the previous socket first. Otherwise a late
    // close/message from the stale socket can mutate this shared Connection.
    this.disconnect();

    return new Promise((resolve, reject) => {
      const url = `${this.proxyUrl}${path}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        if (this.ws !== ws) return;
        resolve();
      };

      ws.onerror = () => {
        if (this.ws !== ws) return;
        const msg = `WebSocket connection failed: ${url}`;
        this.onError?.(msg);
        reject(new Error(msg));
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.receiveBuffer = new Uint8Array(0);
        this.onClose?.();
      };

      ws.onmessage = (event: MessageEvent) => {
        if (this.ws !== ws) return;
        this.handleData(new Uint8Array(event.data as ArrayBuffer));
      };
    });
  }

  disconnect(): void {
    const ws = this.ws;
    if (ws) {
      ws.onopen = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.onmessage = null;
      ws.close();
    }
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
    // Append to receive buffer — reuse capacity when possible
    if (this.receiveBuffer.length === 0) {
      this.receiveBuffer = new Uint8Array(data);
    } else {
      const combined = new Uint8Array(this.receiveBuffer.length + data.length);
      combined.set(this.receiveBuffer);
      combined.set(data, this.receiveBuffer.length);
      this.receiveBuffer = combined;
    }

    // Extract complete packets
    let offset = 0;
    while (offset + 2 <= this.receiveBuffer.length) {
      const packetLen = this.receiveBuffer[offset] | (this.receiveBuffer[offset + 1] << 8);

      if (offset + 2 + packetLen > this.receiveBuffer.length) break; // incomplete

      // Extract packet data
      const packetData = this.receiveBuffer.slice(offset + 2, offset + 2 + packetLen);
      offset += 2 + packetLen;

      // Decrypt if key is set (must be multiple of 8 for XTEA block cipher)
      if (this.xteaKey && packetData.length >= 8 && packetData.length % 8 === 0) {
        xteaDecrypt(packetData, this.xteaKey);
      }

      // Dispatch to handler. A malformed packet (handler reading past
      // the frame -> ParseError) must not abort this loop: packet
      // boundaries come from the length prefix, so later frames in the
      // buffer are still well-defined. Drop the bad frame, keep going.
      const packet = new InputPacket(packetData.buffer);
      try {
        this.onPacket?.(packet);
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        console.warn('[net] dropped malformed packet:', e.message);
      }
    }

    // Trim consumed bytes from buffer
    if (offset > 0) {
      this.receiveBuffer = offset < this.receiveBuffer.length
        ? this.receiveBuffer.slice(offset)
        : new Uint8Array(0);
    }
  }
}
