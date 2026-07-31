import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PacketChannel, type PacketLink } from './transport.ts';
import { makePacket, encodePacket, PacketType, type Packet } from './packet.ts';
import { DEFAULT_MTU } from './fragment.ts';

const SENDER = 'a1b2c3d4e5f60718';

/** An in-memory link that records what was written and can inject frames. */
function fakeLink(mtu = DEFAULT_MTU) {
  const sent: Uint8Array[] = [];
  let handler: ((frame: Uint8Array) => void) | null = null;

  const link: PacketLink = {
    mtu,
    async sendFrame(frame) {
      sent.push(frame.slice());
    },
    onFrame(h) {
      handler = h;
      return () => {
        handler = null;
      };
    }
  };

  return {
    link,
    sent,
    inject: (frame: Uint8Array) => handler?.(frame),
    get subscribed() {
      return handler !== null;
    }
  };
}

/** Wire two channels together so each receives what the other sends. */
function pair(mtu = DEFAULT_MTU) {
  const a = fakeLink(mtu);
  const b = fakeLink(mtu);

  const chanA = new PacketChannel(
    {
      mtu,
      sendFrame: async (f) => b.inject(f),
      onFrame: a.link.onFrame
    },
    'peer-b'
  );
  const chanB = new PacketChannel(
    {
      mtu,
      sendFrame: async (f) => a.inject(f),
      onFrame: b.link.onFrame
    },
    'peer-a'
  );

  chanA.start();
  chanB.start();
  return { chanA, chanB };
}

test('delivers a small packet end to end', async () => {
  const { chanA, chanB } = pair();
  const received: Packet[] = [];
  chanB.onPacket((p) => received.push(p));

  const packet = makePacket(PacketType.Post, SENDER, new TextEncoder().encode('hi'));
  await chanA.send(packet);

  assert.equal(received.length, 1);
  assert.equal(received[0].messageId, packet.messageId);
  assert.deepEqual(Array.from(received[0].payload), Array.from(packet.payload));
});

test('delivers a fragmented packet as one reassembled packet', async () => {
  const { chanA, chanB } = pair();
  const received: Packet[] = [];
  chanB.onPacket((p) => received.push(p));

  const payload = new Uint8Array(9000).map((_, i) => i % 256);
  const packet = makePacket(PacketType.Post, SENDER, payload);
  await chanA.send(packet);

  assert.equal(received.length, 1, 'fragments must surface as a single packet');
  assert.equal(received[0].type, PacketType.Post);
  assert.deepEqual(Array.from(received[0].payload), Array.from(payload));
});

test('tags packets with the peer they came from', async () => {
  const { chanA, chanB } = pair();
  const peers: string[] = [];
  chanB.onPacket((_p, peerId) => peers.push(peerId));
  await chanA.send(makePacket(PacketType.Announce, SENDER, new Uint8Array(0)));
  assert.deepEqual(peers, ['peer-a']);
});

test('writes one frame for a small packet and many for a large one', async () => {
  const link = fakeLink();
  const chan = new PacketChannel(link.link, 'peer');
  chan.start();

  await chan.send(makePacket(PacketType.Post, SENDER, new Uint8Array(10)));
  assert.equal(link.sent.length, 1);

  link.sent.length = 0;
  await chan.send(makePacket(PacketType.Post, SENDER, new Uint8Array(9000)));
  assert.ok(link.sent.length > 1);
  for (const frame of link.sent) {
    assert.ok(frame.byteLength <= DEFAULT_MTU);
  }
});

test('respects a negotiated MTU larger than the default', async () => {
  const link = fakeLink(512);
  const chan = new PacketChannel(link.link, 'peer');
  chan.start();
  await chan.send(makePacket(PacketType.Post, SENDER, new Uint8Array(400)));
  assert.equal(link.sent.length, 1, 'should fit in one frame at MTU 512');
});

test('falls back to a usable MTU when the link reports zero', async () => {
  const link = fakeLink(0);
  const chan = new PacketChannel(link.link, 'peer');
  chan.start();
  await assert.doesNotReject(() =>
    chan.send(makePacket(PacketType.Post, SENDER, new Uint8Array(1000)))
  );
  assert.ok(link.sent.length > 0);
});

test('a malformed frame is reported and dropped, not thrown', () => {
  const link = fakeLink();
  const errors: Error[] = [];
  const chan = new PacketChannel(link.link, 'peer', (e) => errors.push(e));
  chan.start();

  const received: Packet[] = [];
  chan.onPacket((p) => received.push(p));

  assert.doesNotThrow(() => link.inject(new Uint8Array([1, 2, 3])));
  assert.equal(received.length, 0);
  assert.equal(errors.length, 1);
});

test('a bad protocol version is dropped without killing the channel', () => {
  const link = fakeLink();
  const errors: Error[] = [];
  const chan = new PacketChannel(link.link, 'peer', (e) => errors.push(e));
  chan.start();

  const received: Packet[] = [];
  chan.onPacket((p) => received.push(p));

  const bad = encodePacket(makePacket(PacketType.Post, SENDER, new Uint8Array(4)));
  bad[0] = 99;
  link.inject(bad);

  const good = encodePacket(makePacket(PacketType.Post, SENDER, new Uint8Array(4)));
  link.inject(good);

  assert.equal(errors.length, 1);
  assert.equal(received.length, 1, 'the channel must keep working after a bad frame');
});

test('a throwing handler does not stop other handlers', () => {
  const link = fakeLink();
  const errors: Error[] = [];
  const chan = new PacketChannel(link.link, 'peer', (e) => errors.push(e));
  chan.start();

  const seen: string[] = [];
  chan.onPacket(() => {
    throw new Error('handler blew up');
  });
  chan.onPacket(() => seen.push('second'));

  link.inject(encodePacket(makePacket(PacketType.Post, SENDER, new Uint8Array(2))));

  assert.deepEqual(seen, ['second']);
  assert.equal(errors.length, 1);
});

test('unsubscribing stops delivery', () => {
  const link = fakeLink();
  const chan = new PacketChannel(link.link, 'peer');
  chan.start();

  const received: Packet[] = [];
  const off = chan.onPacket((p) => received.push(p));

  link.inject(encodePacket(makePacket(PacketType.Post, SENDER, new Uint8Array(2))));
  off();
  link.inject(encodePacket(makePacket(PacketType.Post, SENDER, new Uint8Array(2))));

  assert.equal(received.length, 1);
});

test('stop detaches from the link and start is idempotent', () => {
  const link = fakeLink();
  const chan = new PacketChannel(link.link, 'peer');

  chan.start();
  chan.start();
  assert.equal(link.subscribed, true);

  chan.stop();
  assert.equal(link.subscribed, false);
});

test('an incomplete fragment group emits nothing', () => {
  const link = fakeLink();
  const chan = new PacketChannel(link.link, 'peer');
  chan.start();

  const received: Packet[] = [];
  chan.onPacket((p) => received.push(p));

  // Send half the fragments of a large packet
  const other = fakeLink();
  const sender = new PacketChannel(other.link, 'x');
  sender.start();
  return sender
    .send(makePacket(PacketType.Post, SENDER, new Uint8Array(9000)))
    .then(() => {
      const half = other.sent.slice(0, Math.floor(other.sent.length / 2));
      for (const frame of half) link.inject(frame);
      assert.equal(received.length, 0);
    });
});
