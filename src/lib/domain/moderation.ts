/**
 * Blocking, reporting and filtering.
 *
 * A board that anyone can post to anonymously, where posts delete themselves,
 * is genuinely useful and also a good tool for bullying someone in a school or
 * an office. That is not a compliance detail to bolt on later; it is a property
 * of the thing being built, and the app needs answers to it.
 *
 * It is also what the App Store requires. Guideline 1.2 asks a user-generated
 * content app for four things: a way to filter objectionable material, a way to
 * report it, a way to block an abusive user, and published contact details.
 *
 * WHAT MAKES THIS WORK WITHOUT A SERVER
 * -------------------------------------
 * There is nobody to report *to*. So a report does two things that both have
 * real effect without an authority:
 *
 *   - locally, it hides the post and blocks its author
 *   - on the mesh, it adds to the post's `deranks` — an existing CRDT that
 *     already lowers a post's score everywhere it travels
 *
 * So reporting is not a gesture into the void: enough people reporting a post
 * sinks it in everyone's feed, and the arithmetic is the same on every device
 * because the set converges.
 *
 * Blocking keys on `authorId`, which is an Ed25519 public key. That matters:
 * an author cannot shed a block by reconnecting or picking a new display name,
 * because the key is what signs their posts. Blocking someone actually holds.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * No shipped list of forbidden words. Which words are slurs is contextual and
 * changes by community and language; a hardcoded English list would be both
 * ineffective and presumptuous. Filtering is community-driven (the derank
 * threshold) plus whatever words the user chooses to mute themselves.
 *
 * Blocked and reported content is still *relayed*. Refusing to carry traffic
 * would fragment the mesh for everyone else and turn one person's block into a
 * partition. Moderation is about what a device shows, not what it carries.
 */

import { count } from './engagement.ts';
import type { Post } from './types.ts';

/** Reports needed before a post is collapsed behind a warning. */
export const REPORT_COLLAPSE_THRESHOLD = 3;

export interface ModerationState {
  /** Author public keys this device refuses to display. */
  blocked: string[];
  /** Words that collapse a post on this device only. */
  mutedWords: string[];
}

export const EMPTY_MODERATION: ModerationState = { blocked: [], mutedWords: [] };

export function isBlocked(state: ModerationState, authorId: string): boolean {
  return state.blocked.includes(authorId);
}

export function blockAuthor(state: ModerationState, authorId: string): ModerationState {
  if (!authorId || isBlocked(state, authorId)) return state;
  return { ...state, blocked: [...state.blocked, authorId] };
}

export function unblockAuthor(state: ModerationState, authorId: string): ModerationState {
  return { ...state, blocked: state.blocked.filter((id) => id !== authorId) };
}

export function muteWord(state: ModerationState, word: string): ModerationState {
  const normalized = word.trim().toLowerCase();
  if (!normalized || state.mutedWords.includes(normalized)) return state;
  return { ...state, mutedWords: [...state.mutedWords, normalized] };
}

export function unmuteWord(state: ModerationState, word: string): ModerationState {
  const normalized = word.trim().toLowerCase();
  return { ...state, mutedWords: state.mutedWords.filter((w) => w !== normalized) };
}

/** How many people have reported this post, across the whole mesh. */
export function reportCount(post: Post): number {
  return count(post.deranks);
}

export type HiddenReason = 'blocked' | 'reported' | 'muted' | null;

/**
 * Why a post should not be shown as-is.
 *
 * Returns a reason rather than a boolean so the UI can say something true:
 * "you blocked this person" and "several people reported this" deserve
 * different words, and a post the user chose to hide should not look like one
 * the community pushed down.
 */
export function hiddenReason(post: Post, state: ModerationState): HiddenReason {
  if (isBlocked(state, post.authorId)) return 'blocked';

  if (state.mutedWords.length > 0) {
    const text = post.text.toLowerCase();
    if (state.mutedWords.some((word) => text.includes(word))) return 'muted';
  }

  if (reportCount(post) >= REPORT_COLLAPSE_THRESHOLD) return 'reported';

  return null;
}

/** Wording shown in place of a collapsed post. */
export function hiddenLabel(reason: Exclude<HiddenReason, null>): string {
  switch (reason) {
    case 'blocked':
      return 'You blocked this person';
    case 'reported':
      return 'Several people reported this post';
    case 'muted':
      return 'This post contains a word you muted';
  }
}

/**
 * Remove posts from a feed that should not appear at all.
 *
 * Only blocked authors are removed outright — the user has said they do not
 * want to see this person, and collapsing rather than removing would still put
 * them on screen. Reported and muted posts stay in the list so they can be
 * collapsed with an explanation and opened deliberately.
 */
export function withoutBlocked(posts: Post[], state: ModerationState): Post[] {
  if (state.blocked.length === 0) return posts;
  return posts.filter((post) => !isBlocked(state, post.authorId));
}
