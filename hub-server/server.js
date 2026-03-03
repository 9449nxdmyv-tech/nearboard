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

// ---- Shared state for chunked response ----

let responseBuffer = Buffer.alloc(0);
let responseOffset = 0;

// ---- Shared state for chunked upload ----

let uploadBuffer = Buffer.alloc(0);

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
    responseBuffer = Buffer.from(json, 'utf-8');
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

    try {
      const json = uploadBuffer.toString('utf-8');
      const post = JSON.parse(json);

      const posts = loadPosts();
      posts.push(post);
      savePosts(posts);

      log('write', 'POST_UPLOAD', `stored post "${post.text?.slice(0, 40)}..." by ${post.authorId?.slice(0, 8)}`);
      uploadBuffer = Buffer.alloc(0);
    } catch {
      log('write', 'POST_UPLOAD', `chunk ${data.length}B, accumulated ${uploadBuffer.length}B`);
    }

    callback(bleno.Characteristic.RESULT_SUCCESS);
  }
});

// 5. ENGAGEMENT — Write
const engagementChar = new bleno.Characteristic({
  uuid: CHAR_ENGAGEMENT,
  properties: ['write', 'writeWithoutResponse'],
  onWriteRequest(data, offset, withoutResponse, callback) {
    const str = data.toString('utf-8');
    const parts = str.split('|');
    const postId = parts[0];
    const deltaLike = parseInt(parts[1] || '0', 10);
    const deltaReshare = parseInt(parts[2] || '0', 10);

    const posts = loadPosts();
    const post = posts.find(p => p.postId === postId);
    if (post) {
      post.likeCount = (post.likeCount || 0) + deltaLike;
      post.reshareCount = (post.reshareCount || 0) + deltaReshare;
      post.lastInteractionAt = Date.now();
      savePosts(posts);
      log('write', 'ENGAGEMENT', `post ${postId.slice(0, 8)}... +${deltaLike} likes, +${deltaReshare} reshares`);
    } else {
      log('write', 'ENGAGEMENT', `post ${postId} not found`);
    }

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
    // Set services first, then start advertising
    bleno.setServices([hubService], (err) => {
      if (err) {
        log('ble', 'setServices', `error: ${err}`);
        return;
      }
      log('ble', 'services', 'registered');
      bleno.startAdvertising(hubName, [SERVICE_UUID], (err) => {
        if (err) {
          log('ble', 'advertising', `error: ${err}`);
        } else {
          log('ble', 'advertising', `started as "${hubName}"`);
        }
      });
    });
  } else {
    bleno.stopAdvertising();
  }
});

bleno.on('accept', (clientAddress) => {
  log('ble', 'connect', clientAddress);
  responseBuffer = Buffer.alloc(0);
  responseOffset = 0;
  uploadBuffer = Buffer.alloc(0);
});

bleno.on('disconnect', (clientAddress) => {
  log('ble', 'disconnect', clientAddress);
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
