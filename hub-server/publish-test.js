/**
 * Publish a real post to a hub over the internet transport.
 *
 * Stands in for a phone or browser: it knows nothing but the hub name, and it
 * speaks the same encrypted packet format the app does. If the anchor stores
 * what this sends, the whole path works for anyone with a network connection.
 */

import { webcrypto } from 'crypto';
import { encodePacket, makePacket, PacketType, randomId, SENDER_ID_SIZE } from '../src/lib/mesh/packet.ts';
import { deriveHubId } from '../src/lib/domain/hubId.ts';
import { withSignature } from '../src/lib/crypto/signing.ts';
import { ed25519 } from '@noble/curves/ed25519.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { NostrLink } = await import('../src/lib/mesh/nostr.ts');

const hubName = process.argv[2] ?? 'Coffee Shop Wall';
const text = process.argv[3] ?? 'posted from a device that has never seen Bluetooth';

const hubId = await deriveHubId(hubName);
const senderId = randomId(SENDER_ID_SIZE);

// A throwaway signing identity. Unsigned posts are rejected by every node, so
// this tool has to be a real author rather than an anonymous publisher.
const signingSecret = ed25519.utils.randomSecretKey();
const authorId = [...ed25519.getPublicKey(signingSecret)]
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');
const secretKey = webcrypto.getRandomValues(new Uint8Array(32));

console.log(`hub "${hubName}" -> ${hubId}`);

const link = new NostrLink({ hubId, hubName, secretKey });
await link.start();
console.log('connected to relays');

const post = {
  postId: `p-${Date.now()}`,
  hubId,
  authorId,
  text,
  createdAt: Date.now(),
  lastInteractionAt: Date.now(),
  likes: {},
  reshares: {},
  deranks: {},
  pinned: false,
  isFeatured: false,
  isEphemeral: false,
  isHidden: false,
  isCarried: false
};

const signed = withSignature(post, { authorId, secretKey: signingSecret });
const payload = new TextEncoder().encode(JSON.stringify(signed));
const frame = new Uint8Array(encodePacket(makePacket(PacketType.Post, senderId, payload)));

console.log(`publishing post "${text}" (${frame.length}B packet)...`);
await link.sendFrame(frame);
console.log('published');

setTimeout(async () => {
  await link.stop();
  process.exit(0);
}, 3000);
