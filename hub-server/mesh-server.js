/**
 * nearboard anchor node.
 *
 * This is the hub-server rewritten to speak the mesh protocol. It is no longer
 * required infrastructure: it is an ordinary peer that happens to be always on
 * and always in range, so a board keeps its history when nobody is standing in
 * the room. Phones talk the same protocol to each other once peripheral mode
 * lands (Phase 0).
 *
 * The protocol modules are imported straight from the app's source rather than
 * reimplemented here — a second copy of a wire format is a second copy that
 * drifts, and a framing bug that only appears on one side is exactly the kind
 * of thing that is miserable to debug over BLE.
 */

import bleno from '@abandonware/bleno';
import { readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

import {
  decodePacket,
  encodePacket,
  makePacket,
  randomId,
  PacketType,
  SENDER_ID_SIZE
} from '../src/lib/mesh/packet.ts';
import { fragmentPacket, Reassembler, DEFAULT_MTU } from '../src/lib/mesh/fragment.ts';
import { mergePost } from '../src/lib/domain/mergePost.ts';

// ---- CLI args ----

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const hubName = getArg('--name') || 'nearboard hub';
const hubDesc = getArg('--desc') || '';

// ---- Identity & storage ----

const HUB_FILE = new URL('./hub.json', import.meta.url);
const POSTS_FILE = new URL('./posts.json', import.meta.url);

let hubId;
let senderId;
try {
  const data = JSON.parse(readFileSync(HUB_FILE, 'utf-8'));
  hubId = data.hubId;
  senderId = data.senderId ?? randomId(SENDER_ID_SIZE);
} catch {
  hubId = randomUUID();
  senderId = randomId(SENDER_ID_SIZE);
}
writeFileSync(HUB_FILE, JSON.stringify({ hubId, senderId }));

const MAX_POST_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
    if (now - p.createdAt > MAX_POST_AGE_MS) return false;
    return true;
  });
}

// mergePost is imported from the app rather than reimplemented — the anchor
// node must resolve a duplicate post exactly the way a phone does, or the two
// disagree about what a board contains.

// ---- Mesh service UUIDs (bleno wants them without dashes) ----

const MESH_SERVICE_UUID = '0000be5000001000800000805f9b34fb';
const CHAR_INBOUND = '0000be5100001000800000805f9b34fb';
const CHAR_OUTBOUND = '0000be5200001000800000805f9b34fb';

// ---- Connection state ----

const reassembler = new Reassembler();
/** Set by bleno when a central subscribes to the outbound characteristic. */
let notify = null;
let peerMtu = DEFAULT_MTU;

/** Packets we have already handled, so flooding does not loop. */
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

async function sendPacket(packet) {
  if (!notify) return;
  for (const frame of fragmentPacket(packet, peerMtu)) {
    notify(Buffer.from(frame));
  }
}

// ---- Packet handling ----

function handlePacket(packet) {
  if (alreadySeen(packet.messageId)) {
    log('mesh', 'dedup', `dropped replay of ${packet.messageId.slice(0, 8)}`);
    return;
  }

  switch (packet.type) {
    case PacketType.Sync:
      return handleSync(packet);
    case PacketType.Post:
      return handlePost(packet);
    case PacketType.Announce:
      return handleAnnounce(packet);
    default:
      log('mesh', 'packet', `ignoring unhandled type ${packet.type}`);
  }
}

function handleAnnounce(packet) {
  log('mesh', 'announce', `peer ${packet.senderId.slice(0, 8)} is here`);
  void sendPacket(
    makePacket(
      PacketType.Announce,
      senderId,
      Buffer.from(JSON.stringify({ hubId, name: hubName, description: hubDesc }), 'utf-8')
    )
  );
}

function handleSync(packet) {
  let since = 0;
  try {
    since = JSON.parse(Buffer.from(packet.payload).toString('utf-8')).since ?? 0;
  } catch {
    // A malformed request is treated as "everything".
  }

  const posts = pruneExpired(loadPosts());
  savePosts(posts);

  const due = posts.filter((p) => (p.lastInteractionAt ?? p.createdAt) > since && !p.isHidden);
  log('mesh', 'sync', `since=${since}, sending ${due.length} posts`);

  for (const post of due) {
    void sendPacket(
      makePacket(PacketType.Post, senderId, Buffer.from(JSON.stringify(post), 'utf-8'))
    );
  }
}

function handlePost(packet) {
  let incoming;
  try {
    incoming = JSON.parse(Buffer.from(packet.payload).toString('utf-8'));
  } catch (e) {
    log('mesh', 'post', `discarded unparseable post: ${e.message}`);
    return;
  }

  if (!incoming?.postId || typeof incoming.text !== 'string') {
    log('mesh', 'post', 'discarded post missing required fields');
    return;
  }

  const posts = loadPosts();
  const index = posts.findIndex((p) => p.postId === incoming.postId);
  if (index === -1) {
    posts.push(incoming);
    log('mesh', 'post', `stored "${incoming.text.slice(0, 40)}" from ${incoming.authorId?.slice(0, 8)}`);
  } else {
    posts[index] = mergePost(posts[index], incoming);
    log('mesh', 'post', `merged engagement into ${incoming.postId.slice(0, 8)}`);
  }
  savePosts(posts);
}

// ---- Characteristics ----

const inboundChar = new bleno.Characteristic({
  uuid: CHAR_INBOUND,
  properties: ['write', 'writeWithoutResponse'],
  onWriteRequest(data, offset, withoutResponse, callback) {
    try {
      let packet = decodePacket(new Uint8Array(data));

      if (packet.type === PacketType.Fragment) {
        const whole = reassembler.accept(packet);
        if (!whole) {
          callback(bleno.Characteristic.RESULT_SUCCESS);
          return;
        }
        packet = whole;
      }

      handlePacket(packet);
      callback(bleno.Characteristic.RESULT_SUCCESS);
    } catch (e) {
      // A peer sending garbage costs one dropped frame, nothing more.
      log('mesh', 'inbound', `dropped frame: ${e.message}`);
      callback(bleno.Characteristic.RESULT_UNLIKELY_ERROR);
    }
  }
});

const outboundChar = new bleno.Characteristic({
  uuid: CHAR_OUTBOUND,
  properties: ['notify'],
  onSubscribe(maxValueSize, updateValueCallback) {
    // maxValueSize is the usable notification payload, i.e. MTU minus the ATT
    // header — exactly the fragment budget.
    peerMtu = maxValueSize;
    notify = updateValueCallback;
    log('mesh', 'subscribe', `peer subscribed, mtu=${maxValueSize}`);
  },
  onUnsubscribe() {
    notify = null;
    log('mesh', 'unsubscribe', 'peer stopped listening');
  }
});

const meshService = new bleno.PrimaryService({
  uuid: MESH_SERVICE_UUID,
  characteristics: [inboundChar, outboundChar]
});

// ---- Bleno lifecycle ----

bleno.on('stateChange', (state) => {
  log('ble', 'state', state);
  if (state !== 'poweredOn') {
    bleno.stopAdvertising();
    return;
  }

  bleno.startAdvertising(hubName, [MESH_SERVICE_UUID], (err) => {
    if (err) {
      log('ble', 'advertising', `error: ${err}`);
      return;
    }
    log('ble', 'advertising', `started as "${hubName}"`);
    bleno.setServices([meshService], (err2) => {
      log('ble', 'services', err2 ? `error: ${err2}` : 'registered');
    });
  });
});

bleno.on('accept', (clientAddress) => {
  log('ble', 'connect', clientAddress);
  reassembler.clear();
});

bleno.on('disconnect', (clientAddress) => {
  log('ble', 'disconnect', clientAddress);
  reassembler.clear();
  notify = null;
  peerMtu = DEFAULT_MTU;

  bleno.startAdvertising(hubName, [MESH_SERVICE_UUID], (err) => {
    log('ble', 're-advertise', err ? `error: ${err}` : 'started');
  });
});

// ---- Logging ----

function log(category, label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${ts} [${category}] ${label}: ${msg}`);
}

console.log('');
console.log('  nearboard anchor node (mesh protocol)');
console.log(`  name:   ${hubName}`);
console.log(`  hub:    ${hubId}`);
console.log(`  peer:   ${senderId}`);
console.log(`  desc:   ${hubDesc || '(none)'}`);
console.log('');
console.log('  waiting for bluetooth...');
console.log('');

process.on('SIGINT', () => {
  console.log('\nshutting down...');
  bleno.stopAdvertising();
  process.exit(0);
});
