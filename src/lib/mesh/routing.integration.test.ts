import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { MeshHarness } from './testing/harness.ts';
import { PacketType } from './packet.ts';
import { withReplySignature, verifyReply } from '../crypto/signing.ts';
import { signClaim, applyClaims, type CurationClaim } from '../domain/curation.ts';
import type { Reply } from '../domain/types.ts';

/**
 * Multi-hop routing for the packet types added after the mesh was built.
 *
 * A new packet type that fails to relay looks exactly like a working one right
 * up until two devices are in a room together — everything passes locally,
 * nothing propagates. These push replies, curation and announcements across a
 * real topology so that gap closes in software rather than on a table.
 */

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function makeKey() {
  const secretKey = ed25519.utils.randomSecretKey();
  const authorId = toHex(ed25519.getPublicKey(secretKey));
  // Both names: signing wants `authorId`, curation calls the same value a
  // curator id. One key, two roles.
  return { id: authorId, authorId, secretKey };
}

// --- replies ---

test('a signed reply survives four hops intact', async () => {
  const alice = makeKey();
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c', 'd', 'e');
  h.chain('a', 'b', 'c', 'd', 'e');

  const reply = withReplySignature(
    {
      replyId: 'r1',
      postId: 'p1',
      hubId: 'h1',
      authorId: 'unset',
      authorName: 'sam',
      text: 'agreed',
      createdAt: 1000
    } as Reply,
    alice
  );

  const packet = h.sendPacket('a', PacketType.Reply, reply);
  await h.settle();

  assert.deepEqual(h.reachedBy(packet.messageId), ['b', 'c', 'd', 'e']);

  // Still verifiable at the far end — relaying must not disturb the bytes.
  const [arrived] = h.payloadsAt<Reply>('e', PacketType.Reply);
  assert.equal(arrived.text, 'agreed');
  assert.equal(verifyReply(arrived), true);
});

test('a reply reaches every node in a ring exactly once', async () => {
  const alice = makeKey();
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c', 'd');
  h.ring('a', 'b', 'c', 'd');

  const reply = withReplySignature(
    { replyId: 'r1', postId: 'p1', hubId: 'h1', authorId: 'x', text: 'hi', createdAt: 1 },
    alice
  );
  const packet = h.sendPacket('a', PacketType.Reply, reply);
  await h.settle();

  for (const id of ['b', 'c', 'd']) {
    assert.equal(h.deliveryCount(id, packet.messageId), 1, id);
  }
});

test('a reply arriving before its post still propagates', async () => {
  // Different paths, different timing — a reply landing first is ordinary, and
  // the network must not require the post to route it.
  const alice = makeKey();
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c');
  h.chain('a', 'b', 'c');

  const reply = withReplySignature(
    { replyId: 'r1', postId: 'not-here-yet', hubId: 'h1', authorId: 'x', text: 'first', createdAt: 1 },
    alice
  );
  const replyPacket = h.sendPacket('a', PacketType.Reply, reply);
  await h.settle();

  assert.deepEqual(h.reachedBy(replyPacket.messageId), ['b', 'c']);
});

// --- curation ---

test('a curation claim propagates across the mesh', async () => {
  const cafe = makeKey();
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c', 'd');
  h.chain('a', 'b', 'c', 'd');

  const claim = signClaim(
    { hubId: 'h1', postId: 'p1', action: 'pin', curatorId: cafe.id, issuedAt: 1000 },
    cafe.secretKey
  );

  const packet = h.sendPacket('a', PacketType.Curation, claim);
  await h.settle();

  assert.deepEqual(h.reachedBy(packet.messageId), ['b', 'c', 'd']);

  const [arrived] = h.payloadsAt<CurationClaim>('d', PacketType.Curation);
  assert.equal(applyClaims([arrived], cafe.id).pinned.has('p1'), true);
});

test('an impostor claim relays but is honoured nowhere', async () => {
  // Relaying is content-agnostic on purpose — a node forwards what it cannot
  // evaluate. Trust is applied at the edge, when the claim is folded in.
  const cafe = makeKey();
  const impostor = makeKey();

  const h = new MeshHarness();
  h.addAll('a', 'b', 'c');
  h.chain('a', 'b', 'c');

  const forged = signClaim(
    { hubId: 'h1', postId: 'p1', action: 'remove', curatorId: impostor.id, issuedAt: 2000 },
    impostor.secretKey
  );

  const packet = h.sendPacket('a', PacketType.Curation, forged);
  await h.settle();

  assert.deepEqual(h.reachedBy(packet.messageId), ['b', 'c'], 'relaying is content-agnostic');

  const [arrived] = h.payloadsAt<CurationClaim>('c', PacketType.Curation);
  assert.equal(
    applyClaims([arrived], cafe.id).removed.has('p1'),
    false,
    'a device trusting the cafe must ignore the impostor'
  );
});

test('curation converges when claims arrive out of order', async () => {
  const cafe = makeKey();
  const h = new MeshHarness({ seed: 11 });
  h.addAll('a', 'b', 'c', 'd', 'e');
  h.mesh('a', 'b', 'c', 'd', 'e');

  // Pinned, then unpinned later. Whichever order they land, the newer wins.
  h.sendPacket('a', PacketType.Curation,
    signClaim({ hubId: 'h1', postId: 'p1', action: 'pin', curatorId: cafe.id, issuedAt: 1000 }, cafe.secretKey));
  h.sendPacket('e', PacketType.Curation,
    signClaim({ hubId: 'h1', postId: 'p1', action: 'unpin', curatorId: cafe.id, issuedAt: 2000 }, cafe.secretKey));
  await h.settle();

  for (const id of ['b', 'c', 'd']) {
    const claims = h.payloadsAt<CurationClaim>(id, PacketType.Curation);
    assert.equal(claims.length, 2, `${id} should have both claims`);
    assert.equal(
      applyClaims(claims, cafe.id).pinned.has('p1'),
      false,
      `${id} should agree the post is unpinned`
    );
  }
});

test('a removal survives a partition healing', async () => {
  const cafe = makeKey();
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c', 'd');
  h.link('a', 'b');
  h.link('c', 'd');

  const claim = signClaim(
    { hubId: 'h1', postId: 'p1', action: 'remove', curatorId: cafe.id, issuedAt: 1000 },
    cafe.secretKey
  );
  h.sendPacket('a', PacketType.Curation, claim);
  await h.settle();

  assert.equal(h.payloadsAt<CurationClaim>('d', PacketType.Curation).length, 0);

  // Someone walks between the two groups.
  h.link('b', 'c');
  await h.settle();

  const claims = h.payloadsAt<CurationClaim>('d', PacketType.Curation);
  assert.equal(applyClaims(claims, cafe.id).removed.has('p1'), true);
});

// --- announcements ---

test('announcements do not travel beyond one hop', async () => {
  // A board three hops away is not one you can walk over to, and flooding
  // announcements would drown the traffic that matters.
  const h = new MeshHarness();
  h.addAll('a', 'b', 'c', 'd');
  h.chain('a', 'b', 'c', 'd');

  const packet = h.sendPacket(
    'a',
    PacketType.Announce,
    { hubs: [{ hubId: 'f'.repeat(32), name: 'Coffee Shop Wall' }] },
    { ttl: 1 }
  );
  await h.settle();

  assert.deepEqual(h.reachedBy(packet.messageId), ['b'], 'only the immediate neighbour');
});
