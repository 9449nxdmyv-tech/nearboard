import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  canonicalReplyBytes,
  signReply,
  verifyReply,
  withReplySignature,
  type SigningIdentity
} from './signing.ts';
import type { Reply } from '../domain/types.ts';

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function makeIdentity(): SigningIdentity {
  const secretKey = ed25519.utils.randomSecretKey();
  return { authorId: toHex(ed25519.getPublicKey(secretKey)), secretKey };
}

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    replyId: 'r1',
    postId: 'p1',
    hubId: 'h1',
    authorId: 'unset',
    text: 'agreed',
    createdAt: 2000,
    ...overrides
  };
}

const alice = makeIdentity();
const mallory = makeIdentity();

test('a signed reply verifies', () => {
  assert.equal(verifyReply(withReplySignature(makeReply(), alice)), true);
});

test('an unsigned reply is rejected', () => {
  assert.equal(verifyReply(makeReply({ authorId: alice.authorId })), false);
});

test('a reply cannot be moved onto a different post', () => {
  // Without postId in the signature, an innocuous reply could be lifted under
  // something it was never written for.
  const reply = withReplySignature(makeReply({ postId: 'original' }), alice);
  assert.equal(verifyReply({ ...reply, postId: 'somewhere-else' }), false);
});

test('a reply cannot be moved to another board', () => {
  const reply = withReplySignature(makeReply({ hubId: 'coffee-shop' }), alice);
  assert.equal(verifyReply({ ...reply, hubId: 'other-board' }), false);
});

test('tampering with the text invalidates it', () => {
  const reply = withReplySignature(makeReply({ text: 'what was said' }), alice);
  assert.equal(verifyReply({ ...reply, text: 'something else' }), false);
});

test('a forged reply claiming another author is rejected', () => {
  const forged = withReplySignature(makeReply({ text: 'alice never said this' }), mallory);
  assert.equal(verifyReply({ ...forged, authorId: alice.authorId }), false);
});

test('the claimed name is covered by the signature', () => {
  const reply = withReplySignature(makeReply({ authorName: 'sam' }), alice);
  assert.equal(verifyReply({ ...reply, authorName: 'someone else' }), false);
});

test('field boundaries are unambiguous', () => {
  const a = canonicalReplyBytes(makeReply({ replyId: 'ab', postId: 'c' }));
  const b = canonicalReplyBytes(makeReply({ replyId: 'a', postId: 'bc' }));
  assert.notDeepEqual(Array.from(a), Array.from(b));
});

test('malformed signatures are rejected without throwing', () => {
  const reply = withReplySignature(makeReply(), alice);
  for (const signature of ['', 'zz', 'not-hex', 'ff'.repeat(200)]) {
    assert.equal(verifyReply({ ...reply, signature }), false);
  }
});

test('a reply signature is not interchangeable with a post signature', () => {
  // Different version tags, so a signature from one context cannot be replayed
  // in the other.
  const reply = makeReply({ authorId: alice.authorId });
  const bytes = canonicalReplyBytes(reply);
  assert.ok(new TextDecoder().decode(bytes).includes('nearboard-reply-v1'));
});

test('signing is deterministic for the same reply', () => {
  const reply = makeReply({ authorId: alice.authorId });
  assert.equal(signReply(reply, alice.secretKey), signReply(reply, alice.secretKey));
});
