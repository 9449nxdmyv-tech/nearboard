/**
 * @file userStore.ts
 * @description Reactive store for the authenticated user. Wired to Firebase Auth
 *              via initAuth() — call once from the root layout on mount.
 */

import { writable } from 'svelte/store';
import { onAuthStateChanged } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { auth } from '$lib/firebase/app';
import { getUserDoc } from '$lib/firebase/userService';
import type { UserDoc } from '$lib/types';

interface UserState {
	user: UserDoc | null;
	loading: boolean;
}

const USER_CACHE_KEY = 'nearboard_user';

/** Loads cached user from localStorage as a fallback before Firebase resolves. */
function loadCachedUser(): UserDoc | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(USER_CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		// Rehydrate Timestamp fields that were serialized to plain objects
		if (parsed.createdAt && typeof parsed.createdAt === 'object' && 'seconds' in parsed.createdAt) {
			parsed.createdAt = new Timestamp(parsed.createdAt.seconds, parsed.createdAt.nanoseconds ?? 0);
		}
		if (parsed.birthDate && typeof parsed.birthDate === 'object' && 'seconds' in parsed.birthDate) {
			parsed.birthDate = new Timestamp(parsed.birthDate.seconds, parsed.birthDate.nanoseconds ?? 0);
		}
		return parsed as UserDoc;
	} catch {
		return null;
	}
}

/** Caches user data to localStorage for offline fallback. */
function cacheUser(user: UserDoc | null): void {
	if (typeof window === 'undefined') return;
	if (user) {
		try {
			window.localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
		} catch { /* quota exceeded — ignore */ }
	} else {
		window.localStorage.removeItem(USER_CACHE_KEY);
	}
}

const cachedUser = loadCachedUser();

const initial: UserState = {
	user: cachedUser,
	loading: true
};

export const userStore = writable<UserState>(initial);

/**
 * Starts the Firebase Auth state listener.
 * Returns an unsubscribe function — call it on layout destroy.
 */
export function initAuth(): () => void {
	return onAuthStateChanged(auth(), async (firebaseUser) => {
		if (firebaseUser) {
			let userDoc = await getUserDoc(firebaseUser.uid);

			// Race condition: onAuthStateChanged fires before ensureUserDoc
			// finishes creating the doc. Retry with exponential backoff so a
			// slow network doesn't silently leave the caller with a stub doc.
			if (!userDoc) {
				for (const delay of [500, 1000, 2000, 4000]) {
					await new Promise((r) => setTimeout(r, delay));
					userDoc = await getUserDoc(firebaseUser.uid);
					if (userDoc) break;
				}
			}

			const resolvedUser: UserDoc = userDoc ?? {
				uid: firebaseUser.uid,
				displayName: firebaseUser.displayName ?? '',
				email: firebaseUser.email ?? '',
				photoURL: firebaseUser.photoURL ?? null,
				birthDate: null,
				ageGroup: 'adult',
				createdAt: Timestamp.now(),
				referredBy: null
			};

			cacheUser(resolvedUser);
			userStore.set({ user: resolvedUser, loading: false });
		} else {
			cacheUser(null);
			userStore.set({ user: null, loading: false });
		}
	});
}
