/**
 * Merging a post that arrived more than once.
 *
 * Over a mesh the same post reaches a device repeatedly, and each copy may
 * carry engagement the others have not seen — someone two hops away liked it,
 * and that like travelled a different path than the post did. Last-writer-wins
 * on the whole record would silently discard those likes, so the CRDT fields
 * merge field by field while the immutable content is left alone.
 */

import { merge as mergeEngagement } from './engagement.ts';
import type { Post } from './types.ts';

export function mergePost(existing: Post | undefined, incoming: Post): Post {
  if (!existing) return incoming;

  return {
    ...existing,
    ...incoming,

    // Engagement converges rather than being overwritten.
    likes: mergeEngagement(existing.likes, incoming.likes),
    reshares: mergeEngagement(existing.reshares, incoming.reshares),
    deranks: mergeEngagement(existing.deranks, incoming.deranks),

    lastInteractionAt: Math.max(
      existing.lastInteractionAt ?? 0,
      incoming.lastInteractionAt ?? 0
    ),

    // Content is immutable once posted. Taking the original defends against a
    // peer re-broadcasting a post with the text swapped: postId is meant to be
    // the identity of the content, so a different body under the same id is
    // either corruption or an attempt to rewrite what someone said.
    text: existing.text,
    authorId: existing.authorId,
    createdAt: existing.createdAt,
    imageBlob: existing.imageBlob ?? incoming.imageBlob,

    // Hiding is a local moderation decision; a peer must not be able to unhide
    // something this device chose to hide.
    isHidden: existing.isHidden || incoming.isHidden,

    // Carrying is likewise local — it records that *this* user passed it on.
    isCarried: existing.isCarried || incoming.isCarried
  };
}
