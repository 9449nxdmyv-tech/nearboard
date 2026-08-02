/**
 * Post authorship.
 *
 * Until now `authorId` was self-asserted: a peer could publish a post claiming
 * to be anyone, and nothing downstream could tell. On a flood network that is
 * worse than it sounds — every device relays and stores the forgery, and the
 * person impersonated has no way to contest it.
 *
 * A post now carries an Ed25519 signature, and `authorId` *is* the public key.
 * That makes a post self-certifying: verification needs nothing but the post
 * itself, no key lookup and no trusted directory, which is the only thing that
 * works when there is no server to ask.
 *
 * WHAT IS SIGNED
 * --------------
 * Only the immutable content. Engagement is deliberately excluded, and that is
 * not a weakness but a requirement: likes accumulate as a post travels, so a
 * signature covering them would break the instant anyone reacted. The parts a
 * signature must protect are the ones that identify what was said and by whom —
 * everything else is a CRDT that converges on its own and cannot be forged into
 * saying something different.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import type { Post } from '$lib/domain/types';

const STORAGE_KEY = 'nearboard_signing_key';

export interface SigningIdentity {
  /** Hex public key. This is the post's authorId. */
  authorId: string;
  secretKey: Uint8Array;
}

// --- hex ---

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// --- identity ---

/**
 * The device's signing key, created once and persisted.
 *
 * NOTE: held in localStorage, which is readable by any script running in the
 * app's origin. Adequate while the app is the only thing in that origin, but
 * the right home is the platform keystore (Keychain / Android Keystore) — worth
 * moving before this key means anything to anyone.
 */
export function getOrCreateSigningIdentity(): SigningIdentity {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const secretKey = fromHex(stored);
    if (secretKey && secretKey.length === 32) {
      return { authorId: toHex(ed25519.getPublicKey(secretKey)), secretKey };
    }
    // Corrupt or truncated: better to mint a new identity than to fail closed
    // and lock the user out of posting entirely.
  }

  const secretKey = ed25519.utils.randomSecretKey();
  localStorage.setItem(STORAGE_KEY, toHex(secretKey));
  return { authorId: toHex(ed25519.getPublicKey(secretKey)), secretKey };
}

/** Is this an authorId that can actually be verified? */
export function isVerifiableAuthorId(authorId: string): boolean {
  return /^[0-9a-f]{64}$/.test(authorId);
}

// --- canonical encoding ---

/**
 * The exact bytes a signature covers.
 *
 * Fields are length-prefixed rather than joined by a separator. Concatenating
 * with a delimiter lets two different posts produce identical bytes — an author
 * whose text ends where the next field begins could be made to sign something
 * they did not write. A length prefix makes the boundaries unambiguous.
 */
export function canonicalBytes(post: Post): Uint8Array {
  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();

  const pushField = (bytes: Uint8Array) => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, bytes.byteLength, false);
    parts.push(header, bytes);
  };

  const pushText = (value: string) => pushField(encoder.encode(value));
  const pushNumber = (value: number) => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigUint64(0, BigInt(Math.max(0, Math.floor(value))), false);
    pushField(buf);
  };

  // Version tag, so the scheme can change later without old signatures
  // silently validating against new rules.
  pushText('nearboard-post-v1');

  pushText(post.postId);
  pushText(post.hubId);
  pushText(post.authorId);
  pushText(post.text);
  pushNumber(post.createdAt);
  pushNumber(post.isEphemeral ? 1 : 0);
  pushNumber(post.expiresAt ?? 0);
  pushField(post.imageBlob ?? new Uint8Array(0));

  // Deliberately absent: likes, reshares, deranks, lastInteractionAt, pinned,
  // isFeatured, isHidden, isCarried. All mutate after publication, by design.

  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

// --- sign / verify ---

/** Sign a post. `authorId` must already be the identity's public key. */
export function signPost(post: Post, secretKey: Uint8Array): string {
  return toHex(ed25519.sign(canonicalBytes(post), secretKey));
}

/**
 * Does this post's signature match the author it claims?
 *
 * Returns false rather than throwing on anything malformed: a peer sending a
 * corrupt signature should cost one dropped post, not an exception in the
 * middle of packet handling.
 */
export function verifyPost(post: Post): boolean {
  if (!post.signature || !isVerifiableAuthorId(post.authorId)) return false;

  const signature = fromHex(post.signature);
  const publicKey = fromHex(post.authorId);
  if (!signature || signature.length !== 64) return false;
  if (!publicKey || publicKey.length !== 32) return false;

  try {
    return ed25519.verify(signature, canonicalBytes(post), publicKey);
  } catch {
    return false;
  }
}

/** Sign a post in place, returning a new signed copy. */
export function withSignature(post: Post, identity: SigningIdentity): Post {
  const authored: Post = { ...post, authorId: identity.authorId };
  return { ...authored, signature: signPost(authored, identity.secretKey) };
}
