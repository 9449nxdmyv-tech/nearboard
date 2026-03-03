export interface Hub {
  hubId: string;
  name: string;
  description?: string;
  createdAt: number; // ms epoch
  isOwned: boolean;
}

export interface Post {
  postId: string;
  hubId: string;
  authorId: string; // deviceId of author
  text: string; // max 280 chars
  imageBlob?: Uint8Array; // compressed, ≤150KB, max 720px longest side
  linkPreview?: {
    url: string;
    title?: string;
    description?: string;
    image?: string;
  };
  createdAt: number;
  lastInteractionAt: number;
  likeCount: number;
  reshareCount: number;
  derankCount: number;
  pinned: boolean;
  isFeatured: boolean; // future monetization hook
  isEphemeral: boolean;
  expiresAt?: number; // ms epoch, only set when isEphemeral=true
  isHidden: boolean;
  isCarried: boolean; // future "Pass it on" behavior
}

export interface Reply {
  replyId: string;
  postId: string;
  authorId: string;
  text: string; // max 140 chars
  createdAt: number;
}

/** Duration options for ephemeral posts, in milliseconds */
export const EPHEMERAL_DURATIONS = [
  { label: '30 seconds', ms: 30_000 },
  { label: '1 minute', ms: 60_000 },
  { label: '2 minutes', ms: 120_000 },
  { label: '5 minutes', ms: 300_000 }
] as const;

export const DEFAULT_EPHEMERAL_DURATION_MS = 300_000; // 5 minutes

/** Cycle values for toolbar ephemeral toggle: null=off, then durations in ms */
export const EPHEMERAL_CYCLE = [null, 30_000, 60_000, 120_000, 300_000] as const;

export const MAX_POST_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
