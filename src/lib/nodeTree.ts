/**
 * Shared binary node tree reader for OTB/OTBM formats.
 * Both formats use the same escape-byte encoding:
 * - 0xFE = NODE_START
 * - 0xFF = NODE_END
 * - 0xFD = ESCAPE (next byte is literal data)
 */

export const NODE_START = 0xfe;
export const NODE_END = 0xff;
export const ESCAPE_CHAR = 0xfd;

/**
 * Read unescaped node data from a raw buffer starting at `offset`.
 * Stops at NODE_START or NODE_END (does not consume the marker).
 */
export function readNodeData(data: Uint8Array, start: number): { bytes: Uint8Array; nextOffset: number } {
  let i = start;
  let len = 0;

  while (i < data.length) {
    const byte = data[i];

    if (byte === NODE_START || byte === NODE_END) {
      break;
    }

    if (byte === ESCAPE_CHAR) {
      i++;
      if (i < data.length) {
        len++;
      }
    } else {
      len++;
    }
    i++;
  }

  const nextOffset = i;
  const buf = new Uint8Array(len);
  let out = 0;
  i = start;

  while (i < nextOffset) {
    const byte = data[i];
    if (byte === ESCAPE_CHAR) {
      i++;
      if (i < nextOffset) {
        buf[out++] = data[i];
      }
    } else {
      buf[out++] = byte;
    }
    i++;
  }

  return { bytes: buf, nextOffset };
}

/**
 * Skip past a node and all its children until we reach the matching NODE_END.
 * `offset` should be right after the NODE_START marker.
 */
export function skipNode(data: Uint8Array, offset: number): number {
  let depth = 1;
  let i = offset;

  while (i < data.length && depth > 0) {
    const byte = data[i];
    if (byte === ESCAPE_CHAR) {
      i += 2;
      if (i > data.length) break; // escape at buffer end
      continue;
    }
    if (byte === NODE_START) depth++;
    if (byte === NODE_END) depth--;
    i++;
  }

  return i;
}
