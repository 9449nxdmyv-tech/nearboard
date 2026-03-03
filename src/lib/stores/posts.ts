import { writable } from 'svelte/store';
import type { Post } from '$lib/domain/types';
import { getPostsForHub, savePost as dbSavePost, pruneOldPosts } from '$lib/db/localDb';

/** Posts for the currently viewed hub */
export const posts = writable<Post[]>([]);

/** Load posts for a hub from IndexedDB, prune stale ones first */
export async function loadPostsForHub(hubId: string): Promise<void> {
  await pruneOldPosts(hubId);
  const all = await getPostsForHub(hubId);
  posts.set(all);
}

/** Save a post to IndexedDB and update the store */
export async function addPost(post: Post): Promise<void> {
  await dbSavePost(post);
  posts.update((current) => [...current, post]);
}

/** Update a single post in IndexedDB and the store */
export async function updatePost(updated: Post): Promise<void> {
  await dbSavePost(updated);
  posts.update((current) =>
    current.map((p) => (p.postId === updated.postId ? updated : p))
  );
}
