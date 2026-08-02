import { writable, get } from 'svelte/store';
import {
  EMPTY_MODERATION,
  blockAuthor,
  unblockAuthor,
  muteWord,
  unmuteWord,
  type ModerationState
} from '$lib/domain/moderation';

const STORAGE_KEY = 'nearboard_moderation';

/**
 * Blocks and mutes are local and permanent.
 *
 * They live in localStorage rather than the mesh on purpose. Broadcasting who
 * you have blocked would tell the mesh — including the blocked person — exactly
 * that, which is the opposite of what someone blocking a harasser wants.
 */
function load(): ModerationState {
  if (typeof localStorage === 'undefined') return EMPTY_MODERATION;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return EMPTY_MODERATION;
    const parsed = JSON.parse(stored) as Partial<ModerationState>;
    return {
      blocked: Array.isArray(parsed.blocked) ? parsed.blocked.filter((x) => typeof x === 'string') : [],
      mutedWords: Array.isArray(parsed.mutedWords)
        ? parsed.mutedWords.filter((x) => typeof x === 'string')
        : []
    };
  } catch {
    return EMPTY_MODERATION;
  }
}

export const moderation = writable<ModerationState>(load());

function persist(state: ModerationState) {
  moderation.set(state);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable; the in-memory state still applies.
  }
}

export function block(authorId: string): void {
  persist(blockAuthor(get(moderation), authorId));
}

export function unblock(authorId: string): void {
  persist(unblockAuthor(get(moderation), authorId));
}

export function mute(word: string): void {
  persist(muteWord(get(moderation), word));
}

export function unmute(word: string): void {
  persist(unmuteWord(get(moderation), word));
}
