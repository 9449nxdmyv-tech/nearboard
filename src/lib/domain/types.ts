import type { EngagementSet } from './engagement';

export interface Hub {
  hubId: string;
  name: string;
  description?: string;
  createdAt: number; // ms epoch
  isOwned: boolean;
  /**
   * Public key of whoever curates this board, recorded when it was created or
   * joined — trust-on-first-use.
   *
   * hubId comes from the board's name, so there is no global owner and anyone
   * may claim to be one. This device honours pins and removals only from the
   * key it recorded here, which means two people who joined from different
   * sources may see different curators. That is an honest reflection of a
   * network with no authority.
   */
  curatorId?: string;
}

export interface Post {
  postId: string;
  hubId: string;
  /**
   * Ed25519 public key of the author, hex. The post is self-certifying: this
   * is the key its `signature` verifies against, so authorship needs no
   * directory to look up and no server to trust.
   */
  authorId: string;
  /**
   * Display name the author claimed, inside the signature.
   *
   * Not unique and cannot be — there is no registry. Two people may use the
   * same name; only the key distinguishes them, which is why identity is shown
   * as name plus fingerprint.
   */
  authorName?: string;
  /**
   * Ed25519 signature over the post's immutable content — see
   * $lib/crypto/signing. Absent on posts created before signing existed.
   */
  signature?: string;
  text: string; // max 280 chars
  imageBlob?: Uint8Array<ArrayBuffer>; // compressed, ≤150KB, max 720px longest side
  linkPreview?: {
    url: string;
    title?: string;
    description?: string;
    image?: string;
  };
  createdAt: number;
  lastInteractionAt: number;
  /**
   * Engagement keyed by author so it converges over a mesh — see
   * $lib/domain/engagement. Read counts via `count()`, never `Object.keys().length`.
   */
  likes: EngagementSet;
  reshares: EngagementSet;
  deranks: EngagementSet;
  pinned: boolean;
  isFeatured: boolean; // future monetization hook
  isEphemeral: boolean;
  expiresAt?: number; // ms epoch, only set when isEphemeral=true
  isHidden: boolean;
  isCarried: boolean; // future "Pass it on" behavior
}

export interface Reply {
  replyId: string;
  /** The post being answered. */
  postId: string;
  /** Which board it belongs to, so a reply can be routed without its post. */
  hubId: string;
  /** Ed25519 public key of the author, hex — same self-certifying scheme as Post. */
  authorId: string;
  authorName?: string;
  text: string;
  createdAt: number;
  /** Ed25519 signature over the reply's content — see $lib/crypto/signing. */
  signature?: string;
}

export const MAX_REPLY_CHARS = 140;

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
