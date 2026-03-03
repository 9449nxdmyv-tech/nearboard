import type { Post } from './types';

/** Transparent scoring: reshares weigh most, likes add, deranks subtract heavily */
export function score(post: Post): number {
  return 3 * post.reshareCount + 1 * post.likeCount - 4 * post.derankCount;
}

/** Is this post expired? (ephemeral + past expiresAt) */
function isExpired(post: Post, now: number): boolean {
  return post.isEphemeral && post.expiresAt != null && post.expiresAt <= now;
}

/**
 * Returns the sorted, filtered feed for a hub.
 *
 * Order:
 *  1. Featured first
 *  2. Pinned first
 *  3. Score descending
 *  4. lastInteractionAt descending (tie-breaker)
 *
 * Filters out hidden and expired ephemeral posts.
 */
export function sortedFeed(posts: Post[]): Post[] {
  const now = Date.now();

  return posts
    .filter((p) => !p.isHidden && !isExpired(p, now))
    .sort((a, b) => {
      // Featured posts float to top
      if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
      // Pinned posts next
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      // Then by score
      const scoreDiff = score(b) - score(a);
      if (scoreDiff !== 0) return scoreDiff;
      // Tie-break by recency
      return b.lastInteractionAt - a.lastInteractionAt;
    });
}

/** Top N posts for the "highlights" strip */
export function highlights(posts: Post[], limit = 3): Post[] {
  return sortedFeed(posts).slice(0, limit);
}
