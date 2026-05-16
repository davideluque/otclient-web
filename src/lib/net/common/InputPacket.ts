/**
 * Reads typed fields from an OT protocol packet buffer.
 * All multi-byte integers are little-endian.
 */
export class InputPacket {
  private view: DataView;
  private offset: number;

  constructor(buffer: ArrayBuffer, offset = 0) {
    this.view = new DataView(buffer);
    this.offset = offset;
  }

  get position(): number {
    return this.offset;
  }

  get bytesLeft(): number {
    return this.view.byteLength - this.offset;
  }

  getU8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  getU16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  getU32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  getString(): string {
    const len = this.getU16();
    const bytes = new Uint8Array(this.view.buffer, this.offset, len);
    this.offset += len;
    return new TextDecoder().decode(bytes);
  }

  getPosition(): { x: number; y: number; z: number } {
    return {
      x: this.getU16(),
      y: this.getU16(),
      z: this.getU8(),
    };
  }

  /** Read raw bytes into a new Uint8Array. */
  getBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(this.view.buffer, this.offset, length);
    this.offset += length;
    return new Uint8Array(bytes);
  }

  skip(n: number): void {
    this.offset += n;
  }

  /** Peek at the next byte without advancing. */
  peekU8(): number {
    return this.view.getUint8(this.offset);
  }

  /** Peek at the next U16 without advancing. */
  peekU16(): number {
    return this.view.getUint16(this.offset, true);
  }
}
