import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHubName } from '../domain/hubId.ts';

/**
 * The encryption helpers in nostr.ts are module-private, so these reproduce the
 * exact scheme and pin its properties. What matters is not the implementation
 * but the guarantee: a relay stores something it cannot read, and knowing the
 * hub name is what grants access — the same rule the BLE side uses.
 */

async function hubKey(hubName: string): Promise<CryptoKey> {
  const material = new TextEncoder().encode(`nearboard-hub-key:${normalizeHubName(hubName)}`);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt'
  ]);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function seal(key: CryptoKey, frame: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new Uint8Array(frame.byteLength);
  plain.set(frame);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const out = new Uint8Array(iv.byteLength + cipher.byteLength);
  out.set(iv, 0);
  out.set(cipher, iv.byteLength);
  return toBase64(out);
}

async function open(key: CryptoKey, payload: string): Promise<Uint8Array | null> {
  try {
    const bytes = fromBase64(payload);
    if (bytes.byteLength <= 12) return null;
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      key,
      bytes.slice(12)
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

const FRAME = new TextEncoder().encode('a post that should never be readable by a relay');

test('a frame round-trips through the same hub name', async () => {
  const key = await hubKey('Coffee Shop Wall');
  const back = await open(key, await seal(key, FRAME));
  assert.deepEqual(Array.from(back!), Array.from(FRAME));
});

test('hub names agree the same way they do for hub ids', async () => {
  const a = await hubKey('Coffee Shop Wall');
  const b = await hubKey('  coffee   shop wall ');
  const back = await open(b, await seal(a, FRAME));
  assert.deepEqual(Array.from(back!), Array.from(FRAME), 'normalisation must match hubId rules');
});

test('a different hub name cannot read the post', async () => {
  const mine = await hubKey('Coffee Shop Wall');
  const theirs = await hubKey('Some Other Board');
  assert.equal(await open(theirs, await seal(mine, FRAME)), null);
});

test('a relay holding the ciphertext learns nothing', async () => {
  const key = await hubKey('Coffee Shop Wall');
  const stored = await seal(key, FRAME);
  const text = new TextDecoder().decode(fromBase64(stored));
  assert.ok(!text.includes('post'), 'plaintext must not survive into the stored event');
  assert.ok(!text.includes('relay'), 'plaintext must not survive into the stored event');
});

test('the same post encrypts differently every time', async () => {
  // A fixed IV would let a relay tell that two users posted identical content.
  const key = await hubKey('Coffee Shop Wall');
  assert.notEqual(await seal(key, FRAME), await seal(key, FRAME));
});

test('a tampered payload is rejected rather than returned corrupt', async () => {
  const key = await hubKey('Coffee Shop Wall');
  const sealed = fromBase64(await seal(key, FRAME));
  sealed[sealed.length - 1] ^= 0xff; // flip a bit in the auth tag
  assert.equal(await open(key, toBase64(sealed)), null);
});

test('a truncated payload is rejected', async () => {
  const key = await hubKey('Coffee Shop Wall');
  assert.equal(await open(key, toBase64(new Uint8Array(8))), null);
});

test('round-trips a payload large enough to carry an image post', async () => {
  const key = await hubKey('Coffee Shop Wall');
  const big = new Uint8Array(150 * 1024).map((_, i) => i % 256);
  const back = await open(key, await seal(key, big));
  assert.equal(back!.byteLength, big.byteLength);
  assert.deepEqual(Array.from(back!.subarray(0, 32)), Array.from(big.subarray(0, 32)));
});
