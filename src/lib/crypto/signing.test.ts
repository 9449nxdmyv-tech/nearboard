import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  canonicalBytes,
  signPost,
  verifyPost,
  withSignature,
  isVerifiableAuthorId,
  type SigningIdentity
} from './signing.ts';
import type { Post } from '../domain/types.ts';

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function makeIdentity(): SigningIdentity {
  const secretKey = ed25519.utils.randomSecretKey();
  return { authorId: toHex(ed25519.getPublicKey(secretKey)), secretKey };
}

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    postId: 'p1',
    hubId: 'h1',
    authorId: 'unset',
    text: 'hello nearby',
    createdAt: 1000,
    lastInteractionAt: 1000,
    likes: {},
    reshares: {},
    deranks: {},
    pinned: false,
    isFeatured: false,
    isEphemeral: false,
    isHidden: false,
    isCarried: false,
    ...overrides
  };
}

const alice = makeIdentity();
const mallory = makeIdentity();

test('a signed post verifies', () => {
  assert.equal(verifyPost(withSignature(makePost(), alice)), true);
});

test('authorId is the public key, so a post is self-certifying', () => {
  // Verification needs nothing but the post — no key lookup, no directory,
  // which is the only thing that works with no server to ask.
  const post = withSignature(makePost(), alice);
  assert.equal(post.authorId, alice.authorId);
  assert.ok(isVerifiableAuthorId(post.authorId));
});

test('an unsigned post is rejected', () => {
  // Not "unverified" — rejected. A tier that skips the check is a tier an
  // attacker opts into by omitting the signature.
  assert.equal(verifyPost(makePost({ authorId: alice.authorId })), false);
});

test('tampering with the text invalidates the signature', () => {
  const post = withSignature(makePost({ text: 'what was actually said' }), alice);
  assert.equal(verifyPost({ ...post, text: 'something else entirely' }), false);
});

test('a forged post claiming another author is rejected', () => {
  // Mallory signs a post but stamps Alice's key on it.
  const forged = withSignature(makePost({ text: 'alice never said this' }), mallory);
  assert.equal(verifyPost({ ...forged, authorId: alice.authorId }), false);
});

test('mallory cannot produce a valid signature for alice', () => {
  const post = makePost({ authorId: alice.authorId, text: 'impersonation' });
  const signature = signPost(post, mallory.secretKey);
  assert.equal(verifyPost({ ...post, signature }), false);
});

test('backdating or re-attributing a post invalidates it', () => {
  const post = withSignature(makePost({ createdAt: 5000 }), alice);
  assert.equal(verifyPost({ ...post, createdAt: 1 }), false);
  assert.equal(verifyPost({ ...post, postId: 'different' }), false);
  assert.equal(verifyPost({ ...post, hubId: 'another-board' }), false);
});

test('moving a post to another hub invalidates it', () => {
  const post = withSignature(makePost({ hubId: 'coffee-shop' }), alice);
  assert.equal(verifyPost({ ...post, hubId: 'somewhere-else' }), false);
});

// --- the crucial property: engagement must NOT be signed ---

test('engagement changes do not break the signature', () => {
  // This is why engagement is excluded. Likes accumulate as a post travels; a
  // signature covering them would break the instant anyone reacted.
  const post = withSignature(makePost(), alice);

  const liked: Post = {
    ...post,
    likes: { bob: [2000, 1], carol: [2100, 1] },
    reshares: { dave: [2200, 1] },
    lastInteractionAt: 2200
  };

  assert.equal(verifyPost(liked), true, 'a post must stay verifiable after it is liked');
});

test('local-only flags do not break the signature', () => {
  const post = withSignature(makePost(), alice);
  assert.equal(verifyPost({ ...post, isHidden: true, isCarried: true, pinned: true }), true);
});

// --- canonical encoding ---

test('field boundaries are unambiguous', () => {
  // Concatenating with a delimiter would let two different posts produce the
  // same bytes, so an author could be made to sign something they did not
  // write. Length prefixes make that impossible.
  const a = canonicalBytes(makePost({ postId: 'ab', hubId: 'c' }));
  const b = canonicalBytes(makePost({ postId: 'a', hubId: 'bc' }));
  assert.notDeepEqual(Array.from(a), Array.from(b));
});

test('canonical bytes are stable across calls', () => {
  const post = makePost({ authorId: alice.authorId });
  assert.deepEqual(Array.from(canonicalBytes(post)), Array.from(canonicalBytes(post)));
});

test('the image is covered by the signature', () => {
  const post = withSignature(makePost({ imageBlob: new Uint8Array([1, 2, 3]) }), alice);
  assert.equal(verifyPost(post), true);
  assert.equal(
    verifyPost({ ...post, imageBlob: new Uint8Array([9, 9, 9]) }),
    false,
    'swapping the image must invalidate the post'
  );
});

test('ephemeral settings are covered', () => {
  // Otherwise a peer could strip the expiry from a post meant to disappear.
  const post = withSignature(makePost({ isEphemeral: true, expiresAt: 9999 }), alice);
  assert.equal(verifyPost({ ...post, isEphemeral: false, expiresAt: undefined }), false);
  assert.equal(verifyPost({ ...post, expiresAt: 99999999 }), false);
});

// --- malformed input ---

test('malformed signatures are rejected without throwing', () => {
  const post = withSignature(makePost(), alice);
  for (const signature of ['', 'zz', 'not-hex', 'ab'.repeat(10), 'ff'.repeat(200)]) {
    assert.equal(verifyPost({ ...post, signature }), false, `should reject "${signature.slice(0, 12)}"`);
  }
});

test('malformed author ids are rejected', () => {
  const post = withSignature(makePost(), alice);
  for (const authorId of ['', 'nope', alice.authorId.slice(0, 40), alice.authorId.toUpperCase()]) {
    assert.equal(verifyPost({ ...post, authorId }), false);
  }
});

test('a legacy UUID authorId is not verifiable', () => {
  assert.equal(isVerifiableAuthorId('9f8e7d6c-1234-4321-abcd-0123456789ab'), false);
  assert.equal(isVerifiableAuthorId(alice.authorId), true);
});

test('two identities produce different keys', () => {
  assert.notEqual(makeIdentity().authorId, makeIdentity().authorId);
});
