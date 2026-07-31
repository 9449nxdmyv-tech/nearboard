import { openDB, type IDBPDatabase } from 'idb';
import type { Hub, Post } from '$lib/domain/types';
import { MAX_POST_AGE_MS } from '$lib/domain/types';

const DB_NAME = 'nearboard';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * v1 → v2: scalar engagement counters become author-keyed CRDT sets.
 *
 * The original authors of existing likes were never recorded, so they cannot be
 * recovered. Rather than discard the counts, synthesise one placeholder author
 * per historical engagement: the visible count is preserved, and every future
 * engagement is a real author key that merges correctly across the mesh.
 */
function migrateCounters(post: any): void {
  const expand = (n: unknown, kind: string): Record<string, [number, 1]> => {
    const out: Record<string, [number, 1]> = {};
    const total = typeof n === 'number' && n > 0 ? Math.floor(n) : 0;
    for (let i = 0; i < total; i++) {
      out[`legacy:${post.postId}:${kind}:${i}`] = [post.lastInteractionAt ?? 0, 1];
    }
    return out;
  };

  post.likes = expand(post.likeCount, 'like');
  post.reshares = expand(post.reshareCount, 'reshare');
  post.deranks = expand(post.derankCount, 'derank');

  delete post.likeCount;
  delete post.reshareCount;
  delete post.derankCount;
}

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // Hubs store
        if (!db.objectStoreNames.contains('hubs')) {
          db.createObjectStore('hubs', { keyPath: 'hubId' });
        }
        // Posts store with hubId index for efficient per-hub queries
        if (!db.objectStoreNames.contains('posts')) {
          const postStore = db.createObjectStore('posts', { keyPath: 'postId' });
          postStore.createIndex('hubId', 'hubId', { unique: false });
        }

        if (oldVersion > 0 && oldVersion < 2) {
          const store = tx.objectStore('posts');
          store.openCursor().then(function next(cursor): any {
            if (!cursor) return;
            const post = cursor.value;
            migrateCounters(post);
            cursor.update(post);
            return cursor.continue().then(next);
          });
        }
      }
    });
  }
  return dbPromise;
}

// --- Hub operations ---

export async function saveHub(hub: Hub): Promise<void> {
  const db = await getDb();
  await db.put('hubs', hub);
}

export async function getHub(hubId: string): Promise<Hub | undefined> {
  const db = await getDb();
  return db.get('hubs', hubId);
}

export async function getAllHubs(): Promise<Hub[]> {
  const db = await getDb();
  return db.getAll('hubs');
}

// --- Post operations ---

export async function savePost(post: Post): Promise<void> {
  const db = await getDb();
  await db.put('posts', post);
}

export async function getPostsForHub(hubId: string): Promise<Post[]> {
  const db = await getDb();
  return db.getAllFromIndex('posts', 'hubId', hubId);
}

/**
 * Prune stale posts for a hub:
 * - Delete posts older than 30 days
 * - Delete expired ephemeral posts (expiresAt <= now)
 */
export async function pruneOldPosts(hubId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const posts = await getPostsForHub(hubId);
  const tx = db.transaction('posts', 'readwrite');

  for (const post of posts) {
    const tooOld = now - post.createdAt > MAX_POST_AGE_MS;
    const expired = post.isEphemeral && post.expiresAt != null && post.expiresAt <= now;
    if (tooOld || expired) {
      tx.store.delete(post.postId);
    }
  }

  await tx.done;
}

/**
 * Prune expired ephemeral posts across ALL hubs.
 * Call this periodically (e.g. every 30s).
 */
export async function pruneAllExpired(): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const tx = db.transaction('posts', 'readwrite');
  let cursor = await tx.store.openCursor();

  while (cursor) {
    const post = cursor.value as Post;
    if (post.isEphemeral && post.expiresAt != null && post.expiresAt <= now) {
      cursor.delete();
    }
    cursor = await cursor.continue();
  }

  await tx.done;
}
