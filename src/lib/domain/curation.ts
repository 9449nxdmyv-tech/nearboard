/**
 * Pinning and removal, by whoever runs a board.
 *
 * A board has a top — the wifi password, closed Monday, the thing you came to
 * read. And a café that puts a board on its wall needs to be able to take
 * something off it. Neither was possible: `pinned` rendered but nothing could
 * set it, and `isOwned` granted no capability at all.
 *
 * THE HARD PART IS OWNERSHIP
 * --------------------------
 * `hubId` is derived from the board's *name*, which is what lets two people
 * reach the same board by typing the same words. It also means there is no
 * global owner and never can be: anyone may create "Coffee Shop Wall" and
 * declare themselves in charge, and nothing in the id can distinguish them from
 * the café.
 *
 * So ownership here is trust-on-first-use, the same shape as an SSH host key.
 * When you join a board you record the key that announced it, and from then on
 * you honour pins and removals signed by *that* key and no other. Someone who
 * joined from a different announcer sees a different curator, and that is an
 * honest reflection of a network with no authority rather than a bug.
 *
 * What this buys, and its limit:
 *
 *   - the café that gave you the QR code can curate the board you joined
 *   - nobody else can, however loudly they claim to
 *   - two people who joined from different sources may see different pins
 *
 * A curator can pin and can remove from view. They cannot edit a post, because
 * a post is signed by its author and rewriting it is not something a signature
 * permits — and should not be.
 */

import { ed25519 } from '@noble/curves/ed25519.js';

export type CurationAction = 'pin' | 'unpin' | 'remove';

export interface CurationClaim {
  hubId: string;
  postId: string;
  action: CurationAction;
  /** Public key of the curator, hex. */
  curatorId: string;
  issuedAt: number;
  signature?: string;
}

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

/**
 * Bytes a curation signature covers.
 *
 * `issuedAt` is included so a claim cannot be replayed to undo a later one — a
 * curator who unpins something should not have an old "pin" resurrect it.
 */
export function canonicalClaimBytes(claim: CurationClaim): Uint8Array {
  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();

  const pushField = (bytes: Uint8Array) => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, bytes.byteLength, false);
    parts.push(header, bytes);
  };
  const pushText = (value: string) => pushField(encoder.encode(value));

  pushText('nearboard-curation-v1');
  pushText(claim.hubId);
  pushText(claim.postId);
  pushText(claim.action);
  pushText(claim.curatorId);

  const at = new Uint8Array(8);
  new DataView(at.buffer).setBigUint64(0, BigInt(Math.max(0, Math.floor(claim.issuedAt))), false);
  pushField(at);

  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function signClaim(claim: CurationClaim, secretKey: Uint8Array): CurationClaim {
  return { ...claim, signature: toHex(ed25519.sign(canonicalClaimBytes(claim), secretKey)) };
}

/**
 * Is this claim genuine, and from the curator this device recognises?
 *
 * Both halves matter. A valid signature from the wrong key is exactly what an
 * impostor produces — they can sign perfectly well, just not as the curator you
 * trusted when you joined.
 */
export function verifyClaim(claim: CurationClaim, trustedCuratorId: string | undefined): boolean {
  if (!trustedCuratorId) return false;
  if (claim.curatorId !== trustedCuratorId) return false;
  if (!claim.signature || !/^[0-9a-f]{64}$/.test(claim.curatorId)) return false;

  const signature = fromHex(claim.signature);
  const publicKey = fromHex(claim.curatorId);
  if (!signature || signature.length !== 64) return false;
  if (!publicKey || publicKey.length !== 32) return false;

  try {
    return ed25519.verify(signature, canonicalClaimBytes(claim), publicKey);
  } catch {
    return false;
  }
}

/**
 * Fold verified claims into a per-post view.
 *
 * Later claims win, so a curator can change their mind — pin, then unpin, and
 * the board follows.
 */
export interface CurationState {
  pinned: Set<string>;
  removed: Set<string>;
}

export function applyClaims(
  claims: CurationClaim[],
  trustedCuratorId: string | undefined
): CurationState {
  const latest = new Map<string, CurationClaim>();

  for (const claim of claims) {
    if (!verifyClaim(claim, trustedCuratorId)) continue;
    const existing = latest.get(claim.postId);
    if (!existing || claim.issuedAt > existing.issuedAt) latest.set(claim.postId, claim);
  }

  const pinned = new Set<string>();
  const removed = new Set<string>();

  for (const [postId, claim] of latest) {
    if (claim.action === 'pin') pinned.add(postId);
    else if (claim.action === 'remove') removed.add(postId);
  }

  return { pinned, removed };
}
