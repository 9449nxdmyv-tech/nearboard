import { writable } from 'svelte/store';
import { mesh, type MeshStatus } from '$lib/mesh/service';
import { posts } from './posts';
import { mergePost } from '$lib/domain/mergePost';

/** Live mesh status for the UI. */
export const meshStatus = writable<MeshStatus>(mesh.getStatus());

mesh.onStatus((status) => meshStatus.set(status));

/**
 * Fold a post arriving from the mesh into the visible feed.
 *
 * The service has already persisted it; this only updates what is on screen,
 * and merges rather than replaces so a copy arriving mid-session cannot undo
 * engagement the user just added locally.
 */
mesh.onPost((incoming) => {
  posts.update((current) => {
    const index = current.findIndex((p) => p.postId === incoming.postId);
    if (index === -1) return [...current, incoming];
    const next = [...current];
    next[index] = mergePost(current[index], incoming);
    return next;
  });
});

let started = false;

/** Start the mesh once per session. Safe to call from every page. */
export async function ensureMeshStarted(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await mesh.start();
  } catch {
    started = false; // let a later navigation retry
  }
}
