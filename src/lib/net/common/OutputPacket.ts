/**
 * Builds an OT protocol packet buffer by writing typed fields.
 * All multi-byte integers are little-endian.
 */
export class OutputPacket {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset: number;

  constructor(initialSize = 1024) {
    this.buffer = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  get length(): number {
    return this.offset;
  }

  private ensureCapacity(needed: number): void {
    const required = this.offset + needed;
    if (required <= this.buffer.byteLength) return;

    let newSize = this.buffer.byteLength * 2;
    while (newSize < required) newSize *= 2;

    const newBuffer = new ArrayBuffer(newSize);
    new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
    this.buffer = newBuffer;
    this.view = new DataView(this.buffer);
  }

  addU8(value: number): void {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  addU16(value: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  addU32(value: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  addString(value: string): void {
    const encoded = new TextEncoder().encode(value);
    this.addU16(encoded.length);
    this.addBytes(encoded);
  }

  addPosition(x: number, y: number, z: number): void {
    this.addU16(x);
    this.addU16(y);
    this.addU8(z);
  }

  addBytes(data: Uint8Array): void {
    this.ensureCapacity(data.length);
    new Uint8Array(this.buffer).set(data, this.offset);
    this.offset += data.length;
  }

  /** Get the packet data as a trimmed Uint8Array. */
  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer, 0, this.offset);
  }

  /** Get the packet data as an ArrayBuffer (trimmed copy). */
  toArrayBuffer(): ArrayBuffer {
    return this.buffer.slice(0, this.offset);
  }
}
