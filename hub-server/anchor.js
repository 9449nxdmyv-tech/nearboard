/**
 * nearboard anchor node.
 *
 * An always-on peer that holds a board's history so it survives everyone
 * walking away. Optional by design: a group of phones forms a board with no
 * anchor at all.
 *
 * RUNS ANYWHERE
 * -------------
 * The earlier version required a working BLE peripheral, which turns out to be
 * a hardware lottery. bleno drives the HCI socket directly and so competes with
 * bluetoothd, which every desktop Linux runs; BlueZ's own D-Bus path avoids
 * that but not every controller supports advertising through it — the Broadcom
 * chip this was developed on registers a GATT application happily and then
 * rejects even an empty advertisement. A server that only works on hardware
 * that cooperates is not a server anyone can run.
 *
 * So Bluetooth is optional. The internet transport needs nothing but an
 * outbound WebSocket, which means this runs unchanged on a VPS, a Raspberry Pi,
 * a laptop, or in a container — with no Bluetooth hardware, no root, and no
 * system configuration. Bluetooth is added on top where it happens to work,
 * and its absence is reported plainly rather than being fatal.
 *
 * Usage:
 *   node anchor.js --name "Coffee Shop Wall"          both transports
 *   node anchor.js --name "..." --no-bluetooth        internet only
 *   node anchor.js --name "..." --no-internet         Bluetooth only
 */

import { readFileSync, writeFileSync } from 'fs';
import { randomUUID, webcrypto } from 'crypto';

import { decodePacket, PacketType, randomId, SENDER_ID_SIZE } from '../src/lib/mesh/packet.ts';
import { Reassembler } from '../src/lib/mesh/fragment.ts';
import { mergePost } from '../src/lib/domain/mergePost.ts';
import { verifyPost } from '../src/lib/crypto/signing.ts';
import { deriveHubId } from '../src/lib/domain/hubId.ts';

// The shared modules assume a browser-shaped global crypto.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ---- args ----

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};

const hubName = arg('--name') || 'nearboard hub';
const hubDesc = arg('--desc') || '';
const useBluetooth = !flag('--no-bluetooth');
const useInternet = !flag('--no-internet');

// ---- storage ----

const STATE_FILE = new URL('./hub.json', import.meta.url);
const POSTS_FILE = new URL('./posts.json', import.meta.url);
const MAX_POST_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

const state = loadState();
if (!state.senderId) state.senderId = randomId(SENDER_ID_SIZE);
if (!state.nostrKey) {
  const sk = webcrypto.getRandomValues(new Uint8Array(32));
  state.nostrKey = [...sk].map((b) => b.toString(16).padStart(2, '0')).join('');
}
if (!state.hubId) state.hubId = randomUUID();
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

const nostrKey = new Uint8Array(
  state.nostrKey.match(/.{2}/g).map((h) => parseInt(h, 16))
);

function loadPosts() {
  try {
    return JSON.parse(readFileSync(POSTS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function savePosts(posts) {
  writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
}

function pruneExpired(posts) {
  const now = Date.now();
  return posts.filter((p) => {
    if (p.isEphemeral && p.expiresAt && p.expiresAt <= now) return false;
    return now - p.createdAt <= MAX_POST_AGE_MS;
  });
}

// ---- logging ----

function log(category, label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${ts} [${category}] ${label}: ${msg}`);
}

// ---- packet handling, shared by every transport ----

const reassembler = new Reassembler();
const seen = new Map();
const SEEN_TTL_MS = 5 * 60_000;
const SEEN_MAX = 2000;

function alreadySeen(messageId) {
  const now = Date.now();
  if (seen.size > SEEN_MAX) {
    for (const [id, at] of seen) {
      if (at < now - SEEN_TTL_MS) seen.delete(id);
      if (seen.size <= SEEN_MAX) break;
    }
  }
  if (seen.has(messageId)) return true;
  seen.set(messageId, now);
  return false;
}

/** Handle one decoded packet, whichever transport carried it. */
function handlePacket(packet, via) {
  if (alreadySeen(packet.messageId)) return;

  if (packet.type !== PacketType.Post) {
    log('mesh', via, `ignoring packet type ${packet.type}`);
    return;
  }

  let incoming;
  try {
    incoming = JSON.parse(Buffer.from(packet.payload).toString('utf-8'));
  } catch (e) {
    log('mesh', via, `discarded unparseable post: ${e.message}`);
    return;
  }

  if (!incoming?.postId || typeof incoming.text !== 'string') {
    log('mesh', via, 'discarded post missing required fields');
    return;
  }

  // An anchor stores and re-serves posts from strangers, so an unverified post
  // here would be laundered into something that looks authoritative. Checked
  // with the same code the app uses, so the two cannot disagree about what
  // counts as authentic.
  if (!verifyPost(incoming)) {
    log('mesh', via, `rejected ${incoming.postId.slice(0, 8)}: bad or missing signature`);
    return;
  }

  const posts = loadPosts();
  const index = posts.findIndex((p) => p.postId === incoming.postId);
  if (index === -1) {
    posts.push(incoming);
    log('mesh', via, `stored "${incoming.text.slice(0, 40)}"`);
  } else {
    // Merge rather than overwrite: copies arriving by different paths each
    // carry engagement the others have not seen.
    posts[index] = mergePost(posts[index], incoming);
    log('mesh', via, `merged engagement into ${incoming.postId.slice(0, 8)}`);
  }
  savePosts(pruneExpired(posts));
}

/** Feed raw bytes in from any transport. */
function acceptFrame(bytes, via) {
  try {
    let packet = decodePacket(new Uint8Array(bytes));
    if (packet.type === PacketType.Fragment) {
      const whole = reassembler.accept(packet);
      if (!whole) return;
      packet = whole;
    }
    handlePacket(packet, via);
  } catch (e) {
    log('mesh', via, `dropped frame: ${e.message}`);
  }
}

// ---- startup ----

const transports = [];

async function startInternet(hubId) {
  const { NostrLink } = await import('../src/lib/mesh/nostr.ts');
  const link = new NostrLink({
    hubId,
    hubName,
    secretKey: nostrKey,
    onError: (e) => log('net', 'error', e.message)
  });
  link.onFrame((frame) => acceptFrame(frame, 'internet'));
  await link.start();
  log('net', 'relays', 'connected — reachable from any platform');
  transports.push({ name: 'internet', stop: () => link.stop() });
  return link;
}

async function startBluetooth() {
  // Best effort. Advertising is genuinely unavailable on some controllers, and
  // that must not stop the anchor from doing its job over the internet.
  try {
    const { startPeripheral } = await import('./bluez-peripheral.js');
    const peripheral = await startPeripheral({
      serviceUuid: 'edbd67ef-dc53-41c2-a6ac-cd4d438831d3',
      inboundUuid: 'edbd0001-dc53-41c2-a6ac-cd4d438831d3',
      outboundUuid: 'edbd0002-dc53-41c2-a6ac-cd4d438831d3',
      localName: 'nearboard',
      log,
      onWrite: (buffer) => acceptFrame(buffer, 'bluetooth')
    });
    transports.push({ name: 'bluetooth', stop: () => peripheral.stop() });
    return true;
  } catch (e) {
    log('ble', 'unavailable', e.message);
    log('ble', 'note', 'continuing without Bluetooth — the internet transport covers every platform');
    return false;
  }
}

async function main() {
  const hubId = await deriveHubId(hubName);

  console.log('');
  console.log('  nearboard anchor node');
  console.log(`  hub:    ${hubName}`);
  console.log(`  id:     ${hubId}`);
  console.log(`  peer:   ${state.senderId}`);
  if (hubDesc) console.log(`  desc:   ${hubDesc}`);
  console.log('');

  if (useInternet) {
    try {
      await startInternet(hubId);
    } catch (e) {
      log('net', 'failed', e.message);
    }
  }

  if (useBluetooth) await startBluetooth();

  if (transports.length === 0) {
    console.error('No transport available — nothing to do.');
    process.exit(1);
  }

  console.log('');
  log('anchor', 'ready', `carrying "${hubName}" over ${transports.map((t) => t.name).join(' + ')}`);
  console.log('');
}

process.on('SIGINT', async () => {
  console.log('\nshutting down...');
  for (const t of transports) await t.stop().catch(() => {});
  process.exit(0);
});

main().catch((e) => {
  console.error('failed to start:', e.message);
  process.exit(1);
});
