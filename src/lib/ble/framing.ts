/**
 * Length-prefixed framing for GATT characteristic transfers.
 *
 * A frame is a 4-byte big-endian uint32 payload length followed by that many
 * payload bytes. Explicit framing lets a reader know when a transfer is
 * complete; the previous approach — appending chunks until `JSON.parse`
 * happened to succeed — cannot tell a truncated stream from a finished one,
 * and silently accepts a prefix that parses by coincidence.
 *
 * FUTURE (Phase 1): this is the seam that becomes the binary mesh packet
 * header. Fragment size should track the negotiated MTU rather than assuming
 * 512 — iOS negotiates ~185.
 */

/** Reject a frame declaring more than this, to bound memory. */
export const MAX_FRAME_BYTES = 1024 * 1024; // 1 MiB

/** Prefix a payload with its 4-byte big-endian length. */
export function frame(payload: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(4 + payload.byteLength);
  new DataView(out.buffer).setUint32(0, payload.byteLength, false);
  out.set(payload, 4);
  return out.buffer;
}

/** Encode a string as a length-prefixed frame. */
export function frameString(s: string): ArrayBuffer {
  return frame(new TextEncoder().encode(s));
}

/** Copy a DataView's window into a standalone Uint8Array. */
function viewBytes(dv: DataView): Uint8Array {
  return new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
}

/**
 * Read a length-prefixed frame by calling `read` repeatedly until the declared
 * payload is complete. Returns the UTF-8 decoded payload, or '' for an empty frame.
 */
export async function readFramed(read: () => Promise<DataView>): Promise<string> {
  let buf = new Uint8Array(0);
  let expected: number | null = null;
  let totalRead = 0;

  // Bounded by bytes rather than by read count: a read-count cap silently
  // fails on large payloads at small MTUs (iOS negotiates ~185 bytes), while
  // every non-empty read advances totalRead by at least one byte, so this
  // still terminates.
  for (;;) {
    const chunk = viewBytes(await read());
    totalRead += chunk.byteLength;
    if (totalRead > MAX_FRAME_BYTES + 4) {
      throw new Error(`Frame exceeded ${MAX_FRAME_BYTES} bytes without completing`);
    }

    // An empty read before the frame is complete means the peer has no more
    // to give — treat a fully-unstarted frame as "nothing available".
    if (chunk.byteLength === 0) {
      if (expected === null && buf.byteLength === 0) return '';
      throw new Error(
        `Truncated frame: got ${buf.byteLength} of ${expected ?? '?'} bytes`
      );
    }

    const merged = new Uint8Array(buf.byteLength + chunk.byteLength);
    merged.set(buf, 0);
    merged.set(chunk, buf.byteLength);
    buf = merged;

    if (expected === null && buf.byteLength >= 4) {
      expected = new DataView(buf.buffer).getUint32(0, false);
      if (expected > MAX_FRAME_BYTES) {
        throw new Error(`Frame declares ${expected} bytes, over the ${MAX_FRAME_BYTES} limit`);
      }
      buf = buf.slice(4);
    }

    if (expected !== null && buf.byteLength >= expected) {
      return new TextDecoder().decode(buf.subarray(0, expected));
    }
  }
}
