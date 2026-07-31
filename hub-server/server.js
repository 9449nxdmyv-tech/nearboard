import bleno from '@abandonware/bleno';
import { readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

// ---- CLI args ----

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const hubName = getArg('--name') || 'nearboard hub';
const hubDesc = getArg('--desc') || '';

// ---- Hub identity (persisted) ----

const HUB_FILE = new URL('./hub.json', import.meta.url);
const POSTS_FILE = new URL('./posts.json', import.meta.url);

let hubId;
try {
  const data = JSON.parse(readFileSync(HUB_FILE, 'utf-8'));
  hubId = data.hubId;
} catch {
  hubId = randomUUID();
  writeFileSync(HUB_FILE, JSON.stringify({ hubId }));
}

// ---- Posts storage ----

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
  return posts.filter(p => {
    if (p.isEphemeral && p.expiresAt && p.expiresAt <= now) return false;
    if (now - p.createdAt > 30 * 24 * 60 * 60 * 1000) return false;
    return true;
  });
}

// ---- UUIDs ----

const SERVICE_UUID        = '0000dead00001000800000805f9b34fb';
const CHAR_HUB_META       = '0000dea100001000800000805f9b34fb';
const CHAR_POST_REQUEST   = '0000dea200001000800000805f9b34fb';
const CHAR_POST_RESPONSE  = '0000dea300001000800000805f9b34fb';
const CHAR_POST_UPLOAD    = '0000dea400001000800000805f9b34fb';
const CHAR_ENGAGEMENT     = '0000dea500001000800000805f9b34fb';

const MAX_CHUNK = 512;

// Reject an upload stream that declares or accumulates more than this.
// Bounds memory against a malformed or hostile client.
const MAX_UPLOAD_BYTES = 1024 * 1024; // 1 MiB

// ---- Connection state ----
//
// bleno's peripheral role serves a single connected central at a time, and its
// read/write callbacks carry no client identity — so this is per-connection
// state, reset on every accept/disconnect rather than keyed by address.
//
// Both directions are length-prefixed: a 4-byte big-endian uint32 header
// precedes the payload. That makes framing explicit instead of relying on
// "keep parsing until JSON.parse happens to succeed", which cannot distinguish
// a truncated stream from a complete one.

let responseBuffer = Buffer.alloc(0);
let responseOffset = 0;

let uploadBuffer = Buffer.alloc(0);
let uploadExpected = null; // total payload bytes declared by the header, or null

function resetConnectionState() {
  responseBuffer = Buffer.alloc(0);
  responseOffset = 0;
  uploadBuffer = Buffer.alloc(0);
  uploadExpected = null;
}

/** Prefix a payload with its 4-byte big-endian length */
function frame(payload) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

// ---- Characteristics ----

// 1. HUB_META — Read
const hubMetaChar = new bleno.Characteristic({
  uuid: CHAR_HUB_META,
  properties: ['read'],
  onReadRequest(offset, callback) {
    const meta = `${hubId}|${hubName}|${hubDesc}`;
    const buf = Buffer.from(meta, 'utf-8');
    log('read', 'HUB_META', meta);
    callback(bleno.Characteristic.RESULT_SUCCESS, buf.slice(offset));
  }
});

// 2. POST_REQUEST — Write (8-byte BE timestamp)
const postRequestChar = new bleno.Characteristic({
  uuid: CHAR_POST_REQUEST,
  properties: ['write', 'writeWithoutResponse'],
  onWriteRequest(data, offset, withoutResponse, callback) {
    let since = 0;
    if (data.length >= 8) {
      since = Number(data.readBigUInt64BE(0));
    }

    let posts = loadPosts();
    posts = pruneExpired(posts);
    savePosts(posts);

    const filtered = posts.filter(p => p.createdAt > since && !p.isHidden);
    const json = JSON.stringify(filtered);
    responseBuffer = frame(Buffer.from(json, 'utf-8'));
    responseOffset = 0;

    log('write', 'POST_REQUEST', `since=${since}, returning ${filtered.length} posts (${responseBuffer.length} bytes)`);
    callback(bleno.Characteristic.RESULT_SUCCESS);
  }
});

// 3. POST_RESPONSE — Read (chunked)
const postResponseChar = new bleno.Characteristic({
  uuid: CHAR_POST_RESPONSE,
  properties: ['read'],
  onReadRequest(offset, callback) {
    // The 'offset' param from bleno is the BLE ATT offset for long reads.
    // We use our own responseOffset for chunking across multiple read calls.
    if (responseOffset >= responseBuffer.length) {
      callback(bleno.Characteristic.RESULT_SUCCESS, Buffer.alloc(0));
      log('read', 'POST_RESPONSE', 'end (empty chunk)');
      return;
    }

    const chunk = responseBuffer.slice(responseOffset, responseOffset + MAX_CHUNK);
    responseOffset += chunk.length;
    callback(bleno.Characteristic.RESULT_SUCCESS, chunk);
    log('read', 'POST_RESPONSE', `chunk ${chunk.length}B, ${responseBuffer.length - responseOffset} remaining`);
  }
});

// 4. POST_UPLOAD — Write (chunked JSON)
const postUploadChar = new bleno.Characteristic({
  uuid: CHAR_POST_UPLOAD,
  properties: ['write', 'writeWithoutResponse'],
  onWriteRequest(data, offset, withoutResponse, callback) {
    uploadBuffer = Buffer.concat([uploadBuffer, data]);

    // Read the length header once we have all 4 bytes of it
    if (uploadExpected === null && uploadBuffer.length >= 4) {
      uploadExpected = uploadBuffer.readUInt32BE(0);
      uploadBuffer = uploadBuffer.subarray(4);

      if (uploadExpected > MAX_UPLOAD_BYTES) {
        log('write', 'POST_UPLOAD', `declared ${uploadExpected}B exceeds limit, dropping`);
        uploadBuffer = Buffer.alloc(0);
        uploadExpected = null;
        callback(bleno.Characteristic.RESULT_UNLIKELY_ERROR);
        return;
      }
    }

    // Guard against a stream that never declares a header or overruns it
    if (uploadBuffer.length > MAX_UPLOAD_BYTES) {
      log('write', 'POST_UPLOAD', `buffer overflow at ${uploadBuffer.length}B, dropping`);
      uploadBuffer = Buffer.alloc(0);
      uploadExpected = null;
      callback(bleno.Characteristic.RESULT_UNLIKELY_ERROR);
      return;
    }

    // Still accumulating
    if (uploadExpected === null || uploadBuffer.length < uploadExpected) {
      log('write', 'POST_UPLOAD', `chunk ${data.length}B, ${uploadBuffer.length}/${uploadExpected ?? '?'}B`);
      callback(bleno.Characteristic.RESULT_SUCCESS);
      return;
    }

    // Complete frame — consume exactly the declared length
    const payload = uploadBuffer.subarray(0, uploadExpected);
    const rest = uploadBuffer.subarray(uploadExpected);
    uploadBuffer = Buffer.from(rest);
    uploadExpected = null;

    try {
      const post = JSON.parse(payload.toString('utf-8'));
      const posts = loadPosts();
      posts.push(post);
      savePosts(posts);
      log('write', 'POST_UPLOAD', `stored post "${post.text?.slice(0, 40)}..." by ${post.authorId?.slice(0, 8)}`);
      callback(bleno.Characteristic.RESULT_SUCCESS);
    } catch (e) {
      // A bad frame is discarded on its own; the buffer is already advanced
      // past it, so it cannot poison subsequent uploads.
      log('write', 'POST_UPLOAD', `malformed frame discarded: ${e.message}`);
      callback(bleno.Characteristic.RESULT_UNLIKELY_ERROR);
    }
  }
});

// 5. ENGAGEMENT — Write
const engagementChar = new bleno.Characteristic({
  uuid: CHAR_ENGAGEMENT,
  properties: ['write', 'writeWithoutResponse'],
  // Payload: "postId|authorId|kind|on"
  //
  // Engagement is keyed by author rather than sent as a delta. A delta is
  // unbounded (any client could write +999999) and cannot be deduplicated, so
  // the same like replayed over two mesh paths would be counted twice.
  onWriteRequest(data, offset, withoutResponse, callback) {
    const [postId, authorId, kind, on] = data.toString('utf-8').split('|');

    const FIELDS = { like: 'likes', reshare: 'reshares', derank: 'deranks' };
    const field = FIELDS[kind];

    if (!postId || !authorId || !field) {
      log('write', 'ENGAGEMENT', `rejected malformed payload (kind=${kind})`);
      callback(bleno.Characteristic.RESULT_UNLIKELY_ERROR);
      return;
    }

    const posts = loadPosts();
    const post = posts.find(p => p.postId === postId);
    if (!post) {
      log('write', 'ENGAGEMENT', `post ${postId.slice(0, 8)}... not found`);
      callback(bleno.Characteristic.RESULT_SUCCESS);
      return;
    }

    const now = Date.now();
    const set = post[field] && typeof post[field] === 'object' ? post[field] : {};
    const existing = set[authorId];
    const state = on === '0' ? 0 : 1;

    // Last write wins per author; ties resolve to `on` so every device agrees.
    if (!existing || now > existing[0] || (now === existing[0] && state === 1)) {
      set[authorId] = [now, state];
    }

    post[field] = set;
    post.lastInteractionAt = now;
    savePosts(posts);

    const total = Object.values(set).filter(e => e[1] === 1).length;
    log('write', 'ENGAGEMENT', `post ${postId.slice(0, 8)}... ${kind}=${state} by ${authorId.slice(0, 8)} (${total} total)`);
    callback(bleno.Characteristic.RESULT_SUCCESS);
  }
});

// ---- Service ----

const hubService = new bleno.PrimaryService({
  uuid: SERVICE_UUID,
  characteristics: [
    hubMetaChar,
    postRequestChar,
    postResponseChar,
    postUploadChar,
    engagementChar
  ]
});

// ---- Bleno events ----

bleno.on('stateChange', (state) => {
  log('ble', 'state', state);
  if (state === 'poweredOn') {
    // Start advertising first (includes service UUID so clients can filter)
    bleno.startAdvertising(hubName, [SERVICE_UUID], (err) => {
      if (err) {
        log('ble', 'advertising', `error: ${err}`);
        return;
      }
      log('ble', 'advertising', `started as "${hubName}"`);
      // Then set services (GATT table) so clients can discover them after connecting
      bleno.setServices([hubService], (err) => {
        if (err) {
          log('ble', 'setServices', `error: ${err}`);
        } else {
          log('ble', 'services', 'registered');
        }
      });
    });
  } else {
    bleno.stopAdvertising();
  }
});

bleno.on('accept', (clientAddress) => {
  log('ble', 'connect', clientAddress);
  resetConnectionState();
});

bleno.on('disconnect', (clientAddress) => {
  log('ble', 'disconnect', clientAddress);
  resetConnectionState();
  // Re-start advertising after disconnect so new clients can find us
  bleno.startAdvertising(hubName, [SERVICE_UUID], (err) => {
    if (err) {
      log('ble', 're-advertise', `error: ${err}`);
    } else {
      log('ble', 're-advertise', 'started');
    }
  });
});

// ---- Logging ----

function log(category, label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${ts} [${category}] ${label}: ${msg}`);
}

// ---- Startup ----

console.log('');
console.log(`  nearboard hub server`);
console.log(`  name: ${hubName}`);
console.log(`  id:   ${hubId}`);
console.log(`  desc: ${hubDesc || '(none)'}`);
console.log('');
console.log('  waiting for bluetooth...');
console.log('');

process.on('SIGINT', () => {
  console.log('\nshutting down...');
  bleno.stopAdvertising();
  process.exit(0);
});
