/**
 * End-to-end check against real public Nostr relays.
 *
 * Two independent "devices" that never touch each other: one publishes an
 * encrypted post, the other subscribes and decrypts it. If this works, the app
 * has a transport that reaches every platform a browser runs on — which BLE
 * cannot.
 */

import { SimplePool, finalizeEvent, generateSecretKey } from 'nostr-tools';
import { webcrypto } from 'crypto';

const crypto = webcrypto;
const KIND = 7373;
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

const HUB_NAME = `nearboard test ${Date.now()}`; // unique so we only see ourselves

function log(m) {
  console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
}

function normalize(name) {
  return name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function hubId(name) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalize(name)));
  return [...new Uint8Array(d).subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hubKey(name) {
  const d = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`nearboard-hub-key:${normalize(name)}`)
  );
  return crypto.subtle.importKey('raw', d, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + cipher.length);
  out.set(iv, 0);
  out.set(cipher, 12);
  return Buffer.from(out).toString('base64');
}

async function open(key, b64) {
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) },
    key,
    bytes.slice(12)
  );
  return new Uint8Array(plain);
}

async function main() {
  const id = await hubId(HUB_NAME);
  const key = await hubKey(HUB_NAME);
  log(`hub "${HUB_NAME}"`);
  log(`hub id ${id}`);

  // Two separate identities — the receiver knows only the hub name.
  const senderSk = generateSecretKey();
  const receiverPool = new SimplePool();
  const senderPool = new SimplePool();

  const message = JSON.stringify({ postId: 'p1', text: 'hello from the other side' });

  const got = new Promise((resolve) => {
    receiverPool.subscribeMany(RELAYS, { kinds: [KIND], '#h': [id] }, {
      onevent: async (event) => {
        try {
          const plain = await open(key, event.content);
          resolve(new TextDecoder().decode(plain));
        } catch {
          // not ours
        }
      }
    });
  });

  log('subscriber listening on 3 relays...');
  await new Promise((r) => setTimeout(r, 2500));

  const content = await seal(key, new TextEncoder().encode(message));
  const event = finalizeEvent(
    { kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['h', id]], content },
    senderSk
  );

  log(`publishing ${content.length}B of ciphertext...`);
  const results = await Promise.allSettled(senderPool.publish(RELAYS, event));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  log(`accepted by ${ok}/${RELAYS.length} relays`);

  const received = await Promise.race([
    got,
    new Promise((r) => setTimeout(() => r(null), 15000))
  ]);

  console.log('');
  if (received === message) {
    log('SUCCESS — encrypted post travelled through public relays and decrypted');
    log(`relay stored: ${content.slice(0, 48)}...`);
    log(`we recovered: ${received}`);
    process.exit(0);
  } else {
    log(`FAILED — got ${received === null ? 'nothing (timeout)' : received}`);
    process.exit(1);
  }
}

main().catch((e) => {
  log(`ERROR: ${e.message}`);
  process.exit(1);
});
