import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodePacket,
  decodePacket,
  makePacket,
  decrementTtl,
  toHex,
  fromHex,
  randomId,
  PacketType,
  PROTOCOL_VERSION,
  HEADER_SIZE,
  SENDER_ID_SIZE,
  MESSAGE_ID_SIZE,
  DEFAULT_TTL,
  MAX_TTL,
  MAX_PAYLOAD_BYTES,
  type Packet
} from './packet.ts';

const SENDER = 'a1b2c3d4e5f60718';
const MESSAGE = '00112233445566778899aabbccddeeff';

function fixture(overrides: Partial<Packet> = {}): Packet {
  return {
    version: PROTOCOL_VERSION,
    type: PacketType.Post,
    ttl: DEFAULT_TTL,
    timestamp: 1_700_000_000_000,
    senderId: SENDER,
    messageId: MESSAGE,
    payload: new TextEncoder().encode('hello nearby'),
    ...overrides
  };
}

test('round-trips every header field', () => {
  const packet = fixture();
  const back = decodePacket(encodePacket(packet));
  assert.equal(back.version, packet.version);
  assert.equal(back.type, packet.type);
  assert.equal(back.ttl, packet.ttl);
  assert.equal(back.timestamp, packet.timestamp);
  assert.equal(back.senderId, packet.senderId);
  assert.equal(back.messageId, packet.messageId);
  assert.deepEqual(Array.from(back.payload), Array.from(packet.payload));
});

test('encodes to exactly header + payload', () => {
  const payload = new Uint8Array(1234);
  assert.equal(encodePacket(fixture({ payload })).byteLength, HEADER_SIZE + 1234);
});

test('round-trips an empty payload', () => {
  const back = decodePacket(encodePacket(fixture({ payload: new Uint8Array(0) })));
  assert.equal(back.payload.byteLength, 0);
});

test('round-trips a payload larger than a uint16 can express', () => {
  // The reason payloadLen is 4 bytes: a 150 KB image post overflows uint16.
  const payload = new Uint8Array(150 * 1024).map((_, i) => i % 256);
  const back = decodePacket(encodePacket(fixture({ payload })));
  assert.equal(back.payload.byteLength, payload.byteLength);
  assert.deepEqual(Array.from(back.payload.subarray(0, 32)), Array.from(payload.subarray(0, 32)));
  assert.deepEqual(
    Array.from(back.payload.subarray(payload.byteLength - 32)),
    Array.from(payload.subarray(payload.byteLength - 32))
  );
});

test('preserves millisecond timestamps beyond 2^32', () => {
  const timestamp = 1_900_000_000_000;
  assert.equal(decodePacket(encodePacket(fixture({ timestamp }))).timestamp, timestamp);
});

test('decodes from a view into a larger buffer', () => {
  // BLE stacks hand out views into reused buffers.
  const encoded = encodePacket(fixture());
  const backing = new Uint8Array(encoded.byteLength + 64);
  backing.set(encoded, 16);
  const view = backing.subarray(16, 16 + encoded.byteLength);
  assert.equal(decodePacket(view).senderId, SENDER);
});

test('decoded payload does not alias the receive buffer', () => {
  const encoded = encodePacket(fixture());
  const decoded = decodePacket(encoded);
  encoded.fill(0); // simulate the stack reusing the buffer
  assert.deepEqual(Array.from(decoded.payload), Array.from(new TextEncoder().encode('hello nearby')));
});

test('rejects a packet shorter than the header', () => {
  assert.throws(() => decodePacket(new Uint8Array(HEADER_SIZE - 1)), /shorter than/);
});

test('rejects an unknown protocol version', () => {
  const encoded = encodePacket(fixture());
  encoded[0] = 99;
  assert.throws(() => decodePacket(encoded), /Unsupported protocol version 99/);
});

test('rejects a packet whose declared payload is missing', () => {
  const encoded = encodePacket(fixture());
  assert.throws(() => decodePacket(encoded.subarray(0, encoded.byteLength - 3)), /truncated/);
});

test('rejects a declared payload over the size limit', () => {
  const encoded = encodePacket(fixture());
  new DataView(encoded.buffer).setUint32(35, MAX_PAYLOAD_BYTES + 1, false);
  assert.throws(() => decodePacket(encoded), /over the .* limit/);
});

test('refuses to encode an oversized payload', () => {
  const payload = { byteLength: MAX_PAYLOAD_BYTES + 1 } as Uint8Array;
  assert.throws(() => encodePacket(fixture({ payload })), /exceeds the/);
});

test('ignores trailing bytes past the declared payload', () => {
  const encoded = encodePacket(fixture());
  const padded = new Uint8Array(encoded.byteLength + 10);
  padded.set(encoded, 0);
  assert.deepEqual(
    Array.from(decodePacket(padded).payload),
    Array.from(new TextEncoder().encode('hello nearby'))
  );
});

test('clamps ttl into range on encode', () => {
  assert.equal(decodePacket(encodePacket(fixture({ ttl: 250 }))).ttl, MAX_TTL);
  assert.equal(decodePacket(encodePacket(fixture({ ttl: -5 }))).ttl, 0);
});

test('decrementTtl consumes one hop', () => {
  const next = decrementTtl(fixture({ ttl: 7 }));
  assert.equal(next?.ttl, 6);
});

test('decrementTtl stops a packet at its last hop', () => {
  assert.equal(decrementTtl(fixture({ ttl: 1 })), null);
  assert.equal(decrementTtl(fixture({ ttl: 0 })), null);
});

test('decrementTtl does not mutate the original', () => {
  const packet = fixture({ ttl: 5 });
  decrementTtl(packet);
  assert.equal(packet.ttl, 5);
});

test('a packet survives a full relay chain and dies at the end', () => {
  let packet: Packet | null = fixture({ ttl: DEFAULT_TTL });
  let hops = 0;
  while (packet) {
    packet = decrementTtl(decodePacket(encodePacket(packet)));
    if (packet) hops++;
  }
  assert.equal(hops, DEFAULT_TTL - 1);
});

test('makePacket fills defaults and generates distinct message ids', () => {
  const a = makePacket(PacketType.Announce, SENDER, new Uint8Array(0));
  const b = makePacket(PacketType.Announce, SENDER, new Uint8Array(0));
  assert.equal(a.version, PROTOCOL_VERSION);
  assert.equal(a.ttl, DEFAULT_TTL);
  assert.notEqual(a.messageId, b.messageId);
  assert.match(a.messageId, /^[0-9a-f]{32}$/);
});

test('hex helpers round-trip', () => {
  const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 255]);
  assert.equal(toHex(bytes), '00010f107f80ff');
  assert.deepEqual(Array.from(fromHex('00010f107f80ff', 7)), Array.from(bytes));
});

test('fromHex pads a short id rather than throwing', () => {
  assert.deepEqual(Array.from(fromHex('aabb', 4)), [0xaa, 0xbb, 0, 0]);
});

test('fromHex truncates an over-long id rather than overflowing', () => {
  assert.deepEqual(Array.from(fromHex('aabbccddee', 2)), [0xaa, 0xbb]);
});

test('a peer sending a malformed id cannot break decoding', () => {
  const packet = fixture({ senderId: 'zzzz', messageId: '' });
  const back = decodePacket(encodePacket(packet));
  assert.equal(back.senderId.length, SENDER_ID_SIZE * 2);
  assert.equal(back.messageId.length, MESSAGE_ID_SIZE * 2);
});

test('randomId returns the requested width', () => {
  assert.equal(randomId(8).length, 16);
  assert.equal(randomId(16).length, 32);
});
