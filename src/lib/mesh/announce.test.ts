import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeAnnounce,
  decodeAnnounce,
  NearbyHubs,
  MAX_ANNOUNCED_HUBS,
  type AnnouncedHub
} from './announce.ts';
import { makePacket, PacketType, decodePacket, encodePacket } from './packet.ts';

const SENDER = 'a1b2c3d4e5f60718';
const ID_A = '2c9ed3252e60e4b8cc82f2379decb034';
const ID_B = 'aabbccddeeff00112233445566778899';

function hubs(...pairs: [string, string][]): AnnouncedHub[] {
  return pairs.map(([hubId, name]) => ({ hubId, name }));
}

test('round-trips announced boards', () => {
  const packet = encodeAnnounce(SENDER, hubs([ID_A, 'Coffee Shop Wall']));
  const back = decodeAnnounce(decodePacket(encodePacket(packet)));
  assert.deepEqual(back, [{ hubId: ID_A, name: 'Coffee Shop Wall' }]);
});

test('announcements are not relayed', () => {
  // A board three hops away is not one you can walk over to, and flooding
  // announcements would drown the traffic that matters.
  assert.equal(encodeAnnounce(SENDER, hubs([ID_A, 'x'])).ttl, 1);
});

test('caps how many boards one announcement can carry', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    hubId: i.toString(16).padStart(32, '0'),
    name: `hub ${i}`
  }));
  assert.equal(decodeAnnounce(encodeAnnounce(SENDER, many)).length, MAX_ANNOUNCED_HUBS);
});

test('ignores a packet that is not an announcement', () => {
  assert.deepEqual(decodeAnnounce(makePacket(PacketType.Post, SENDER, new Uint8Array(4))), []);
});

test('discards malformed payloads rather than throwing', () => {
  const junk = makePacket(PacketType.Announce, SENDER, new TextEncoder().encode('not json'));
  assert.deepEqual(decodeAnnounce(junk), []);

  const wrongShape = makePacket(
    PacketType.Announce,
    SENDER,
    new TextEncoder().encode('{"hubs":"not an array"}')
  );
  assert.deepEqual(decodeAnnounce(wrongShape), []);
});

test('rejects hub ids that are not 128 bits of hex', () => {
  // Everything here came from a stranger. A malformed id must never reach
  // storage or a route.
  const bad = makePacket(
    PacketType.Announce,
    SENDER,
    new TextEncoder().encode(
      JSON.stringify({
        hubs: [
          { hubId: '../../etc/passwd', name: 'evil' },
          { hubId: 'ZZZZ', name: 'evil' },
          { hubId: ID_A.slice(0, 10), name: 'truncated' },
          { hubId: ID_A.toUpperCase(), name: 'uppercase' },
          { hubId: ID_A, name: 'legitimate' }
        ]
      })
    )
  );
  assert.deepEqual(decodeAnnounce(bad), [{ hubId: ID_A, name: 'legitimate' }]);
});

test('rejects an unbounded name', () => {
  const bad = makePacket(
    PacketType.Announce,
    SENDER,
    new TextEncoder().encode(JSON.stringify({ hubs: [{ hubId: ID_A, name: 'x'.repeat(5000) }] }))
  );
  assert.deepEqual(decodeAnnounce(bad), []);
});

test('rejects an empty name', () => {
  const bad = makePacket(
    PacketType.Announce,
    SENDER,
    new TextEncoder().encode(JSON.stringify({ hubs: [{ hubId: ID_A, name: '   ' }] }))
  );
  assert.deepEqual(decodeAnnounce(bad), []);
});

test('truncates an over-long name on the way out', () => {
  const back = decodeAnnounce(encodeAnnounce(SENDER, hubs([ID_A, 'y'.repeat(500)])));
  assert.equal(back.length, 1);
  assert.ok(back[0].name.length <= 80);
});

// --- NearbyHubs ---

test('records and lists boards seen nearby', () => {
  const near = new NearbyHubs();
  assert.equal(near.record(hubs([ID_A, 'Coffee Shop Wall']), 'peer1'), true);
  assert.deepEqual(near.list(), [{ hubId: ID_A, name: 'Coffee Shop Wall' }]);
});

test('re-announcing the same board is not a change', () => {
  const near = new NearbyHubs();
  near.record(hubs([ID_A, 'Coffee Shop Wall']), 'peer1');
  assert.equal(
    near.record(hubs([ID_A, 'Coffee Shop Wall']), 'peer1'),
    false,
    'an unchanged announcement should not churn the UI'
  );
});

test('a renamed board counts as a change', () => {
  const near = new NearbyHubs();
  near.record(hubs([ID_A, 'Old Name']), 'peer1');
  assert.equal(near.record(hubs([ID_A, 'New Name']), 'peer1'), true);
});

test('boards expire so the list reflects what is actually around', () => {
  let clock = 1000;
  const near = new NearbyHubs(60_000, () => clock);
  near.record(hubs([ID_A, 'Coffee Shop Wall']), 'peer1');
  assert.equal(near.size, 1);

  clock += 61_000;
  assert.equal(near.size, 0, 'a board whose carrier left should stop being offered');
});

test('a peer walking out takes its boards with it', () => {
  const near = new NearbyHubs();
  near.record(hubs([ID_A, 'From peer1']), 'peer1');
  near.record(hubs([ID_B, 'From peer2']), 'peer2');

  near.forgetPeer('peer1');
  assert.deepEqual(near.list(), [{ hubId: ID_B, name: 'From peer2' }]);
});

test('the most recently seen board is listed first', () => {
  let clock = 1000;
  const near = new NearbyHubs(60_000, () => clock);
  near.record(hubs([ID_A, 'Older']), 'peer1');
  clock += 5_000;
  near.record(hubs([ID_B, 'Newer']), 'peer2');
  assert.deepEqual(near.list().map((h) => h.name), ['Newer', 'Older']);
});
