import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fragmentPacket,
  parseFragment,
  needsFragmentation,
  chunkSize,
  Reassembler,
  DEFAULT_MTU,
  MIN_MTU,
  FRAGMENT_HEADER_SIZE,
  MAX_PENDING_REASSEMBLIES
} from './fragment.ts';
import {
  decodePacket,
  encodePacket,
  makePacket,
  PacketType,
  HEADER_SIZE,
  type Packet
} from './packet.ts';

const SENDER = 'a1b2c3d4e5f60718';

function post(size: number): Packet {
  const payload = new Uint8Array(size).map((_, i) => (i * 7) % 256);
  return makePacket(PacketType.Post, SENDER, payload);
}

/** Send a packet through fragmentation and back, in the given order. */
function roundTrip(packet: Packet, mtu = DEFAULT_MTU, order?: (n: number) => number[]): Packet {
  const wire = fragmentPacket(packet, mtu);
  const r = new Reassembler();
  const indices = order ? order(wire.length) : wire.map((_, i) => i);

  let result: Packet | null = null;
  for (const i of indices) {
    const out = r.accept(decodePacket(wire[i]));
    if (out) result = out;
  }
  assert.ok(result, 'expected reassembly to complete');
  return result;
}

test('a small packet is not fragmented', () => {
  const packet = post(10);
  assert.equal(needsFragmentation(packet), false);
  assert.equal(fragmentPacket(packet).length, 1);
});

test('a packet at exactly the MTU is not fragmented', () => {
  const packet = post(DEFAULT_MTU - HEADER_SIZE);
  assert.equal(encodePacket(packet).byteLength, DEFAULT_MTU);
  assert.equal(fragmentPacket(packet).length, 1);
});

test('one byte over the MTU fragments', () => {
  const packet = post(DEFAULT_MTU - HEADER_SIZE + 1);
  assert.equal(needsFragmentation(packet), true);
  assert.ok(fragmentPacket(packet).length > 1);
});

test('every fragment fits within the MTU', () => {
  for (const mtu of [MIN_MTU, 64, 180, 185, 512]) {
    for (const frame of fragmentPacket(post(20_000), mtu)) {
      assert.ok(frame.byteLength <= mtu, `fragment of ${frame.byteLength}B exceeds MTU ${mtu}`);
    }
  }
});

test('the default 23-byte BLE MTU cannot carry the mesh', () => {
  // Not a limitation to work around — a packet header plus a fragment header
  // is already 51 bytes, so MTU negotiation is a precondition for sending.
  assert.ok(MIN_MTU > 23);
  assert.throws(() => fragmentPacket(post(1000), 23), /at least 52 is required/);
});

test('round-trips a fragmented payload byte for byte', () => {
  const packet = post(5000);
  const back = roundTrip(packet);
  assert.deepEqual(Array.from(back.payload), Array.from(packet.payload));
  assert.equal(back.type, packet.type);
  assert.equal(back.senderId, packet.senderId);
  assert.equal(back.messageId, packet.messageId);
});

test('round-trips a 150 KB image post at a realistic iOS MTU', () => {
  const packet = post(150 * 1024);
  const wire = fragmentPacket(packet, 185);
  assert.ok(wire.length > 1000, `expected many fragments, got ${wire.length}`);
  const back = roundTrip(packet, 185);
  assert.deepEqual(Array.from(back.payload), Array.from(packet.payload));
});

test('reassembles fragments arriving out of order', () => {
  const packet = post(3000);
  const back = roundTrip(packet, DEFAULT_MTU, (n) =>
    Array.from({ length: n }, (_, i) => i).reverse()
  );
  assert.deepEqual(Array.from(back.payload), Array.from(packet.payload));
});

test('reassembles fragments arriving shuffled', () => {
  const packet = post(3000);
  const back = roundTrip(packet, DEFAULT_MTU, (n) => {
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = (i * 7919) % (i + 1); // deterministic shuffle
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  });
  assert.deepEqual(Array.from(back.payload), Array.from(packet.payload));
});

test('a duplicated fragment does not corrupt or complete the packet early', () => {
  // The same fragment reaching us by two relay paths is normal under flooding.
  const packet = post(3000);
  const wire = fragmentPacket(packet);
  const r = new Reassembler();

  let completions = 0;
  let result: Packet | null = null;

  for (let i = 0; i < wire.length; i++) {
    for (const attempt of [0, 1]) {
      const out = r.accept(decodePacket(wire[i]));
      if (out) {
        completions++;
        result = out;
        assert.equal(i, wire.length - 1, 'completed before the last fragment arrived');
        assert.equal(attempt, 0, 'a duplicate re-completed an already-finished group');
      }
    }
  }

  assert.equal(completions, 1);
  assert.deepEqual(Array.from(result!.payload), Array.from(packet.payload));
});

test('a fully replayed group re-emits — suppressing that is the seen-set\'s job', () => {
  // The reassembler is deliberately memoryless about completed groups. Holding
  // every finished fragmentId forever would be an unbounded leak, so duplicate
  // suppression lives downstream in Phase 2, keyed on the packet's messageId.
  const packet = post(3000);
  const wire = fragmentPacket(packet);
  const r = new Reassembler();

  const deliver = () => {
    let out: Packet | null = null;
    for (const frame of wire) {
      const done = r.accept(decodePacket(frame));
      if (done) out = done;
    }
    return out;
  };

  const first = deliver();
  const second = deliver();
  assert.ok(first && second);
  assert.equal(first.messageId, second.messageId, 'a replay is identifiable by messageId');
});

test('completes only on the final missing fragment', () => {
  const wire = fragmentPacket(post(3000));
  const r = new Reassembler();
  for (let i = 0; i < wire.length - 1; i++) {
    assert.equal(r.accept(decodePacket(wire[i])), null);
  }
  assert.ok(r.accept(decodePacket(wire[wire.length - 1])));
});

test('interleaves two packets without mixing them', () => {
  const a = post(2000);
  const b = post(2500);
  const wireA = fragmentPacket(a);
  const wireB = fragmentPacket(b);
  const r = new Reassembler();

  const done: Packet[] = [];
  const max = Math.max(wireA.length, wireB.length);
  for (let i = 0; i < max; i++) {
    if (i < wireA.length) {
      const out = r.accept(decodePacket(wireA[i]));
      if (out) done.push(out);
    }
    if (i < wireB.length) {
      const out = r.accept(decodePacket(wireB[i]));
      if (out) done.push(out);
    }
  }

  assert.equal(done.length, 2);
  const byId = new Map(done.map((p) => [p.messageId, p]));
  assert.deepEqual(Array.from(byId.get(a.messageId)!.payload), Array.from(a.payload));
  assert.deepEqual(Array.from(byId.get(b.messageId)!.payload), Array.from(b.payload));
});

test('abandons a reassembly that never completes', () => {
  let clock = 1000;
  const r = new Reassembler(4 * 1024 * 1024, 30_000, () => clock);
  const wire = fragmentPacket(post(3000));

  r.accept(decodePacket(wire[0]));
  assert.equal(r.pendingCount, 1);

  clock += 31_000;
  r.expire();
  assert.equal(r.pendingCount, 0, 'a stalled reassembly must not pin memory');
});

test('caps the number of concurrent reassemblies', () => {
  let clock = 1000;
  const r = new Reassembler(4 * 1024 * 1024, 30_000, () => clock);

  for (let i = 0; i < MAX_PENDING_REASSEMBLIES + 10; i++) {
    clock += 1; // distinct start times so the oldest is well-defined
    r.accept(decodePacket(fragmentPacket(post(3000))[0]));
  }

  assert.equal(r.pendingCount, MAX_PENDING_REASSEMBLIES);
});

test('rejects a reassembly that exceeds the byte budget', () => {
  const r = new Reassembler(1000);
  const wire = fragmentPacket(post(5000));
  assert.throws(() => {
    for (const frame of wire) r.accept(decodePacket(frame));
  }, /exceeded 1000 bytes/);
});

test('rejects a fragment group whose total changes mid-stream', () => {
  const wire = fragmentPacket(post(3000));
  const r = new Reassembler();
  const first = decodePacket(wire[0]);
  r.accept(first);

  const tampered = decodePacket(wire[1]);
  new DataView(
    tampered.payload.buffer,
    tampered.payload.byteOffset,
    tampered.payload.byteLength
  ).setUint16(10, 9999, false);

  assert.throws(() => r.accept(tampered), /changed its total/);
});

test('rejects a fragment whose index is outside its total', () => {
  const packet = decodePacket(fragmentPacket(post(3000))[0]);
  const view = new DataView(
    packet.payload.buffer,
    packet.payload.byteOffset,
    packet.payload.byteLength
  );
  view.setUint16(8, 500, false); // index
  view.setUint16(10, 10, false); // total
  assert.throws(() => parseFragment(packet), /outside its total/);
});

test('rejects a fragment declaring a total of zero', () => {
  const packet = decodePacket(fragmentPacket(post(3000))[0]);
  new DataView(
    packet.payload.buffer,
    packet.payload.byteOffset,
    packet.payload.byteLength
  ).setUint16(10, 0, false);
  assert.throws(() => parseFragment(packet), /total of zero/);
});

test('rejects a fragment payload shorter than its header', () => {
  const packet = makePacket(PacketType.Fragment, SENDER, new Uint8Array(FRAGMENT_HEADER_SIZE - 1));
  assert.throws(() => parseFragment(packet), /shorter than its header/);
});

test('rejects a non-fragment packet', () => {
  assert.throws(() => parseFragment(post(10)), /is not a fragment/);
});

test('fragments carry the original ttl so relays treat them alike', () => {
  const packet = makePacket(PacketType.Post, SENDER, new Uint8Array(3000), { ttl: 4 });
  for (const frame of fragmentPacket(packet)) {
    assert.equal(decodePacket(frame).ttl, 4);
  }
});

test('each fragment gets a distinct message id for dedup', () => {
  const ids = fragmentPacket(post(3000)).map((f) => decodePacket(f).messageId);
  assert.equal(new Set(ids).size, ids.length);
});

test('rejects an MTU one byte below the minimum', () => {
  assert.throws(() => chunkSize(MIN_MTU - 1), /cannot carry a fragment/);
  assert.equal(chunkSize(MIN_MTU), 1);
});

test('reassembled payload does not alias the receive buffers', () => {
  const packet = post(3000);
  const wire = fragmentPacket(packet);
  const r = new Reassembler();

  let result: Packet | null = null;
  for (const frame of wire) {
    const out = r.accept(decodePacket(frame));
    if (out) result = out;
    frame.fill(0); // stack reuses the buffer immediately after handing it over
  }

  assert.deepEqual(Array.from(result!.payload), Array.from(packet.payload));
});
