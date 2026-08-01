/**
 * Binary packet format for the mesh.
 *
 * Every unit of traffic on the mesh is one packet. The header carries what a
 * relay needs in order to forward a packet without understanding its contents:
 *
 *   offset  size  field
 *   ------  ----  -----
 *        0     1  version
 *        1     1  type
 *        2     1  ttl          remaining hops; a relay decrements and drops at 0
 *        3     8  timestamp    ms epoch, uint64
 *       11     8  senderId     truncated peer fingerprint
 *       19    16  messageId    random; the dedup key that makes flooding safe
 *       35     4  payloadLen   uint32
 *       39   ...  payload
 *
 * All multi-byte integers are big-endian, matching the existing timestamp
 * encoding on the wire.
 *
 * Why a `messageId` at all: flooding means the same packet reaches a device by
 * several paths. Without a stable per-packet identity there is no way to tell a
 * relayed duplicate from a genuinely new packet, so a device would either
 * re-broadcast forever or drop real traffic. Phase 2's seen-set keys off this.
 *
 * Why `payloadLen` is 4 bytes rather than the 2 a chat protocol would use:
 * posts carry images up to ~150 KB, well past the 65535 a uint16 can express.
 * Two extra bytes per packet is a cheaper price than a second size ceiling.
 */

export const PROTOCOL_VERSION = 1;

/** Header layout, in bytes. */
export const HEADER_SIZE = 39;
const OFF_VERSION = 0;
const OFF_TYPE = 1;
const OFF_TTL = 2;
const OFF_TIMESTAMP = 3;
const OFF_SENDER = 11;
const OFF_MESSAGE_ID = 19;
const OFF_PAYLOAD_LEN = 35;

export const SENDER_ID_SIZE = 8;
export const MESSAGE_ID_SIZE = 16;

/** Hops a packet may still take. Matches bitchat's default. */
export const DEFAULT_TTL = 7;
export const MAX_TTL = 15;

/** Refuse to allocate for a payload larger than this. */
export const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024; // 4 MiB

/**
 * A const object rather than a TS `enum`: an enum emits runtime code, which
 * type-stripping runtimes (including `node --test`) refuse to handle.
 */
export const PacketType = {
  /** "I am here", carrying a peer's identity and the hubs it holds. */
  Announce: 1,
  /** A post being propagated. */
  Post: 2,
  /** An engagement CRDT entry for a post. */
  Engagement: 3,
  /** A request for posts newer than a timestamp. */
  Sync: 4,
  /** A piece of a packet too large to send whole; see fragment.ts. */
  Fragment: 5
} as const;

export type PacketType = (typeof PacketType)[keyof typeof PacketType];

export interface Packet {
  version: number;
  type: PacketType;
  ttl: number;
  timestamp: number;
  /** Hex, 16 chars. */
  senderId: string;
  /** Hex, 32 chars. The dedup key. */
  messageId: string;
  payload: Uint8Array;
}

// --- hex helpers ---

const HEX: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0')
);

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i]];
  return out;
}

export function fromHex(hex: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  // Tolerate a short or long id by truncating/zero-padding rather than
  // throwing: an id is an opaque label, and a peer running a different build
  // should not be able to crash our decoder by sending an odd one.
  const usable = Math.min(size * 2, hex.length - (hex.length % 2));
  for (let i = 0; i < usable; i += 2) {
    out[i / 2] = parseInt(hex.substring(i, i + 2), 16) || 0;
  }
  return out;
}

/** Random hex id of `size` bytes, for senderId and messageId. */
export function randomId(size: number): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function newMessageId(): string {
  return randomId(MESSAGE_ID_SIZE);
}

// --- encode / decode ---

export function encodePacket(packet: Packet): Uint8Array<ArrayBuffer> {
  const { payload } = packet;
  if (payload.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `Payload of ${payload.byteLength} bytes exceeds the ${MAX_PAYLOAD_BYTES} limit`
    );
  }

  const out = new Uint8Array(HEADER_SIZE + payload.byteLength);
  const view = new DataView(out.buffer);

  out[OFF_VERSION] = packet.version;
  out[OFF_TYPE] = packet.type;
  out[OFF_TTL] = Math.max(0, Math.min(MAX_TTL, packet.ttl));
  view.setBigUint64(OFF_TIMESTAMP, BigInt(Math.max(0, Math.floor(packet.timestamp))), false);
  out.set(fromHex(packet.senderId, SENDER_ID_SIZE), OFF_SENDER);
  out.set(fromHex(packet.messageId, MESSAGE_ID_SIZE), OFF_MESSAGE_ID);
  view.setUint32(OFF_PAYLOAD_LEN, payload.byteLength, false);
  out.set(payload, HEADER_SIZE);

  return out;
}

/**
 * Decode a packet. Throws on anything malformed rather than returning a
 * partially-filled object — a relay must not forward what it could not parse.
 */
export function decodePacket(bytes: Uint8Array): Packet {
  if (bytes.byteLength < HEADER_SIZE) {
    throw new Error(`Packet of ${bytes.byteLength} bytes is shorter than the ${HEADER_SIZE}-byte header`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[OFF_VERSION];
  if (version !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocol version ${version}`);
  }

  const payloadLen = view.getUint32(OFF_PAYLOAD_LEN, false);
  if (payloadLen > MAX_PAYLOAD_BYTES) {
    throw new Error(`Packet declares ${payloadLen} bytes, over the ${MAX_PAYLOAD_BYTES} limit`);
  }
  if (bytes.byteLength < HEADER_SIZE + payloadLen) {
    throw new Error(
      `Packet truncated: declared ${payloadLen} payload bytes, have ${bytes.byteLength - HEADER_SIZE}`
    );
  }

  return {
    version,
    type: bytes[OFF_TYPE] as PacketType,
    ttl: bytes[OFF_TTL],
    timestamp: Number(view.getBigUint64(OFF_TIMESTAMP, false)),
    senderId: toHex(bytes.subarray(OFF_SENDER, OFF_SENDER + SENDER_ID_SIZE)),
    messageId: toHex(bytes.subarray(OFF_MESSAGE_ID, OFF_MESSAGE_ID + MESSAGE_ID_SIZE)),
    // Copy rather than subarray: the caller may hold this past the lifetime of
    // the receive buffer, which BLE stacks reuse.
    payload: bytes.slice(HEADER_SIZE, HEADER_SIZE + payloadLen)
  };
}

/** Build a packet with sensible defaults for the fields a caller rarely sets. */
export function makePacket(
  type: PacketType,
  senderId: string,
  payload: Uint8Array,
  options: { ttl?: number; timestamp?: number; messageId?: string } = {}
): Packet {
  return {
    version: PROTOCOL_VERSION,
    type,
    ttl: options.ttl ?? DEFAULT_TTL,
    timestamp: options.timestamp ?? Date.now(),
    senderId,
    messageId: options.messageId ?? newMessageId(),
    payload
  };
}

/**
 * The same packet with one hop consumed, or null if it must not travel further.
 * Returns a new object so a relay cannot accidentally mutate what it is holding
 * for dedup.
 */
export function decrementTtl(packet: Packet): Packet | null {
  if (packet.ttl <= 1) return null;
  return { ...packet, ttl: packet.ttl - 1 };
}
