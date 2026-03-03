import { openDB, type IDBPDatabase } from 'idb';
import type { Hub, Post } from '$lib/domain/types';
import { MAX_POST_AGE_MS } from '$lib/domain/types';

const DB_NAME = 'nearboard';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Hubs store
        if (!db.objectStoreNames.contains('hubs')) {
          db.createObjectStore('hubs', { keyPath: 'hubId' });
        }
        // Posts store with hubId index for efficient per-hub queries
        if (!db.objectStoreNames.contains('posts')) {
          const postStore = db.createObjectStore('posts', { keyPath: 'postId' });
          postStore.createIndex('hubId', 'hubId', { unique: false });
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
