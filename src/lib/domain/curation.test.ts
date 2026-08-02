import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  signClaim,
  verifyClaim,
  applyClaims,
  canonicalClaimBytes,
  type CurationClaim
} from './curation.ts';

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function makeKey() {
  const secretKey = ed25519.utils.randomSecretKey();
  return { id: toHex(ed25519.getPublicKey(secretKey)), secretKey };
}

const cafe = makeKey();
const impostor = makeKey();

function claim(overrides: Partial<CurationClaim> = {}): CurationClaim {
  return {
    hubId: 'h1',
    postId: 'p1',
    action: 'pin',
    curatorId: cafe.id,
    issuedAt: 1000,
    ...overrides
  };
}

test('the recognised curator can pin', () => {
  const signed = signClaim(claim(), cafe.secretKey);
  assert.equal(verifyClaim(signed, cafe.id), true);
});

test('an impostor with a perfectly valid signature is still rejected', () => {
  // This is the crux. An impostor can sign flawlessly — they simply cannot sign
  // as the curator this device recognised when it joined.
  const signed = signClaim(claim({ curatorId: impostor.id }), impostor.secretKey);
  assert.equal(verifyClaim(signed, cafe.id), false);
});

test('claiming the curator id without the key fails', () => {
  const forged = signClaim(claim({ curatorId: cafe.id }), impostor.secretKey);
  assert.equal(verifyClaim(forged, cafe.id), false);
});

test('a device that trusts nobody honours nothing', () => {
  // Joining without recording a curator means no one may curate — which is the
  // safe default, not an oversight.
  const signed = signClaim(claim(), cafe.secretKey);
  assert.equal(verifyClaim(signed, undefined), false);
});

test('a claim cannot be moved to another board or post', () => {
  const signed = signClaim(claim({ hubId: 'coffee-shop', postId: 'p1' }), cafe.secretKey);
  assert.equal(verifyClaim({ ...signed, hubId: 'other-board' }, cafe.id), false);
  assert.equal(verifyClaim({ ...signed, postId: 'p2' }, cafe.id), false);
});

test('the action itself is signed', () => {
  // Otherwise a pin could be flipped into a removal in transit.
  const signed = signClaim(claim({ action: 'pin' }), cafe.secretKey);
  assert.equal(verifyClaim({ ...signed, action: 'remove' }, cafe.id), false);
});

test('an unsigned claim is rejected', () => {
  assert.equal(verifyClaim(claim(), cafe.id), false);
});

// --- folding claims ---

test('a curator can change their mind', () => {
  const claims = [
    signClaim(claim({ action: 'pin', issuedAt: 1000 }), cafe.secretKey),
    signClaim(claim({ action: 'unpin', issuedAt: 2000 }), cafe.secretKey)
  ];
  assert.equal(applyClaims(claims, cafe.id).pinned.has('p1'), false);
});

test('an older claim cannot resurrect a decision', () => {
  // Replaying an old "pin" must not undo a later "unpin", which is why
  // issuedAt is inside the signature.
  const claims = [
    signClaim(claim({ action: 'unpin', issuedAt: 2000 }), cafe.secretKey),
    signClaim(claim({ action: 'pin', issuedAt: 1000 }), cafe.secretKey)
  ];
  assert.equal(applyClaims(claims, cafe.id).pinned.has('p1'), false);
});

test('removal and pinning are tracked separately', () => {
  const claims = [
    signClaim(claim({ postId: 'a', action: 'pin', issuedAt: 1 }), cafe.secretKey),
    signClaim(claim({ postId: 'b', action: 'remove', issuedAt: 1 }), cafe.secretKey)
  ];
  const state = applyClaims(claims, cafe.id);
  assert.deepEqual([...state.pinned], ['a']);
  assert.deepEqual([...state.removed], ['b']);
});

test("an impostor's claims are dropped while the curator's are kept", () => {
  const claims = [
    signClaim(claim({ postId: 'real', action: 'pin', issuedAt: 1 }), cafe.secretKey),
    signClaim(
      claim({ postId: 'fake', action: 'pin', curatorId: impostor.id, issuedAt: 2 }),
      impostor.secretKey
    )
  ];
  assert.deepEqual([...applyClaims(claims, cafe.id).pinned], ['real']);
});

test('canonical bytes are unambiguous across fields', () => {
  const a = canonicalClaimBytes(claim({ hubId: 'ab', postId: 'c' }));
  const b = canonicalClaimBytes(claim({ hubId: 'a', postId: 'bc' }));
  assert.notDeepEqual(Array.from(a), Array.from(b));
});
