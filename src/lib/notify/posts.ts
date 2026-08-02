/**
 * Telling someone a board moved while they were not looking.
 *
 * A board you have to keep open is a board you forget. But a mesh delivers in
 * bursts — a peer arrives and flushes everything it was holding — so the naive
 * version fires twenty notifications for one encounter and gets muted forever.
 *
 * So notifications are coalesced into one per hub per quiet period, and stay
 * silent about the hub already on screen: telling someone about a post they can
 * see is noise, and noise is how an app loses notification permission.
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Post } from '$lib/domain/types';

const isNative = Capacitor.isNativePlatform();

/** Posts arriving within this window become a single notification. */
const COALESCE_MS = 8_000;

/** Never notify more often than this for the same hub. */
const MIN_GAP_MS = 60_000;

interface Pending {
  hubName: string;
  posts: Post[];
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();
const lastNotifiedAt = new Map<string, number>();

/** The hub currently on screen, which should never generate a notification. */
let visibleHubId: string | null = null;

export function setVisibleHub(hubId: string | null): void {
  visibleHubId = hubId;
}

let permissionChecked = false;
let permitted = false;

/**
 * Ask for notification permission, once.
 *
 * Deliberately not requested at launch: a prompt before the user has seen a
 * board arrive is a prompt with no context, and denying it is close to
 * permanent. Called on first arrival instead, when the value is obvious.
 */
async function ensurePermission(): Promise<boolean> {
  if (!isNative) return false;
  if (permissionChecked) return permitted;
  permissionChecked = true;

  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === 'granted') {
      permitted = true;
    } else if (status.display === 'prompt' || status.display === 'prompt-with-rationale') {
      const asked = await LocalNotifications.requestPermissions();
      permitted = asked.display === 'granted';
    } else {
      permitted = false;
    }
  } catch {
    permitted = false;
  }

  return permitted;
}

function summarise(hubName: string, posts: Post[]): { title: string; body: string } {
  if (posts.length === 1) {
    const text = posts[0].text.trim();
    return {
      title: hubName,
      body: text.length > 120 ? `${text.slice(0, 117)}…` : text
    };
  }
  return {
    title: hubName,
    body: `${posts.length} new posts`
  };
}

async function flush(hubId: string): Promise<void> {
  const entry = pending.get(hubId);
  pending.delete(hubId);
  if (!entry || entry.posts.length === 0) return;

  // Re-checked at fire time, not at queue time: the user may have opened the
  // hub during the coalescing window, in which case they have already seen it.
  if (visibleHubId === hubId) return;

  const last = lastNotifiedAt.get(hubId) ?? 0;
  if (Date.now() - last < MIN_GAP_MS) return;

  if (!(await ensurePermission())) return;

  const { title, body } = summarise(entry.hubName, entry.posts);
  lastNotifiedAt.set(hubId, Date.now());

  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          // Stable per hub, so a later notification replaces rather than
          // stacks — a board should occupy one row in the shade, not ten.
          id: hashToId(hubId),
          title,
          body,
          extra: { hubId }
        }
      ]
    });
  } catch {
    // Notification failed; not worth surfacing, the post is already stored.
  }
}

/** Small stable positive integer, which is all the notification id may be. */
function hashToId(hubId: string): number {
  let hash = 0;
  for (let i = 0; i < hubId.length; i++) {
    hash = (hash * 31 + hubId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2_000_000;
}

/**
 * Note that a post arrived from the mesh.
 *
 * Safe to call for every post; the coalescing and gap rules decide whether
 * anything is actually shown.
 */
export function notifyPostArrived(post: Post, hubName: string): void {
  if (!isNative) return;
  if (visibleHubId === post.hubId) return;

  const existing = pending.get(post.hubId);
  if (existing) {
    existing.posts.push(post);
    return;
  }

  pending.set(post.hubId, {
    hubName,
    posts: [post],
    timer: setTimeout(() => void flush(post.hubId), COALESCE_MS)
  });
}

/** Clear anything queued, e.g. when the mesh stops. */
export function resetNotifications(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
}
