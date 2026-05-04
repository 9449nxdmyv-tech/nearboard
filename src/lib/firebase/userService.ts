/**
 * @file userService.ts
 * @description Firebase Auth operations and user Firestore document management.
 *              All auth logic lives here — never call Firebase Auth from components.
 */

import {
	GoogleAuthProvider,
	OAuthProvider,
	signInWithPopup,
	sendSignInLinkToEmail,
	isSignInWithEmailLink,
	signInWithEmailLink,
	signOut as firebaseSignOut,
	deleteUser,
	updateProfile,
	type User
} from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { auth, db } from './app';
import type { UserDoc, AgeGroup } from '$lib/types';
import { MIN_AGE, ADULT_AGE, REFERRAL_STORAGE_KEY, DEFAULT_DIGEST_TIME, DEFAULT_DIGEST_ENABLED } from '$lib/config/constants';

const googleProvider = new GoogleAuthProvider();
const appleProvider = new OAuthProvider('apple.com');

const EMAIL_STORAGE_KEY = 'nearboard_emailForSignIn';
const EMAIL_LINK_RATE_KEY = 'nearboard_last_email_link';
const EMAIL_LINK_COOLDOWN_MS = 60_000;

/** Maps Firebase Auth error codes to user-friendly messages. */
function friendlyAuthError(code: string): string {
	switch (code) {
		case 'auth/popup-closed-by-user':
			return 'Sign-in was cancelled';
		case 'auth/account-exists-with-different-credential':
			return 'An account already exists with this email';
		case 'auth/network-request-failed':
			return 'Network error. Check your connection';
		case 'auth/too-many-requests':
			return 'Too many attempts. Please try again later';
		default:
			return 'Something went wrong. Please try again';
	}
}

export async function signInWithGoogle(): Promise<User> {
	try {
		const result = await signInWithPopup(auth(), googleProvider);
		await ensureUserDoc(result.user);
		return result.user;
	} catch (err: unknown) {
		const code = (err as { code?: string }).code ?? '';
		throw new Error(friendlyAuthError(code));
	}
}

export async function signInWithApple(): Promise<User> {
	try {
		const result = await signInWithPopup(auth(), appleProvider);
		await ensureUserDoc(result.user);
		return result.user;
	} catch (err: unknown) {
		const code = (err as { code?: string }).code ?? '';
		throw new Error(friendlyAuthError(code));
	}
}

export async function sendEmailLink(email: string): Promise<void> {
	const lastSend = window.localStorage.getItem(EMAIL_LINK_RATE_KEY);
	if (lastSend && Date.now() - Number(lastSend) < EMAIL_LINK_COOLDOWN_MS) {
		throw new Error('Please wait before requesting another link');
	}

	const actionCodeSettings = {
		url: window.location.origin + '/onboarding',
		handleCodeInApp: true
	};
	await sendSignInLinkToEmail(auth(), email, actionCodeSettings);
	window.localStorage.setItem(EMAIL_STORAGE_KEY, email);
	window.localStorage.setItem(EMAIL_LINK_RATE_KEY, String(Date.now()));
}

export async function completeEmailLinkSignIn(): Promise<User | null> {
	const href = window.location.href;
	if (!isSignInWithEmailLink(auth(), href)) return null;

	const email = window.localStorage.getItem(EMAIL_STORAGE_KEY);
	if (!email) return null;

	const result = await signInWithEmailLink(auth(), email, href);
	window.localStorage.removeItem(EMAIL_STORAGE_KEY);
	// Clean up the URL (remove oobCode, mode, apiKey params)
	window.history.replaceState({}, '', window.location.pathname);
	await ensureUserDoc(result.user);
	return result.user;
}

export async function signOut(): Promise<void> {
	await firebaseSignOut(auth());
}

/**
 * Derives a friendly default display name from a user's email or uid.
 * Title-cases the email handle (foo.bar → Foo Bar) so it reads naturally.
 */
function defaultDisplayName(user: Pick<User, 'email' | 'uid'>): string {
	const handle = user.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
	if (handle) {
		return handle
			.split(' ')
			.filter(Boolean)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}
	return 'New friend';
}

/**
 * Creates or updates a user document in Firestore to ensure it's complete.
 * Backfills displayName from the email handle when Firebase Auth doesn't supply one
 * (common with email magic-link signups).
 */
async function ensureUserDoc(user: User): Promise<void> {
	const userRef = doc(db(), 'users', user.uid);
	const userSnap = await getDoc(userRef);

	const existing = userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : null;
	const existingName = typeof existing?.displayName === 'string' ? (existing.displayName as string).trim() : '';
	const resolvedName = user.displayName?.trim() || existingName || defaultDisplayName(user);

	// Sync the derived name back to Firebase Auth so future reads of currentUser are consistent.
	if (!user.displayName?.trim() && resolvedName) {
		try {
			await updateProfile(user, { displayName: resolvedName });
		} catch {
			// Non-fatal — Firestore is the source of truth.
		}
	}

	if (!userSnap.exists() || !existing?.email || !existingName) {
		const referredBy =
			typeof window !== 'undefined' ? window.localStorage.getItem(REFERRAL_STORAGE_KEY) : null;

		const userData: Record<string, unknown> = {
			uid: user.uid,
			displayName: resolvedName,
			email: user.email ?? '',
			photoURL: user.photoURL ?? null,
			referredBy: referredBy ?? null
		};

		// Auto-detect timezone on every sign-in
		if (typeof Intl !== 'undefined') {
			userData.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		}

		// Only set createdAt on initial document creation.
		if (!userSnap.exists()) {
			userData.createdAt = serverTimestamp();
			userData.birthDate = null;
			userData.ageGroup = 'adult';
			userData.digestEnabled = DEFAULT_DIGEST_ENABLED;
			userData.digestTime = DEFAULT_DIGEST_TIME;
			userData.digestTimezone = userData.timezone || 'UTC';
		}

		await setDoc(userRef, userData, { merge: true });

		if (referredBy && typeof window !== 'undefined') {
			window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
		}
	}
}

/**
 * Calculates age from a birth date.
 */
export function calculateAge(birthDate: Date): number {
	const today = new Date();
	let age = today.getFullYear() - birthDate.getFullYear();
	const monthDiff = today.getMonth() - birthDate.getMonth();
	if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
		age--;
	}
	return age;
}

/**
 * Determines age group from a birth date.
 * Throws if under MIN_AGE.
 */
export function getAgeGroup(birthDate: Date): AgeGroup {
	const age = calculateAge(birthDate);
	if (age < MIN_AGE) {
		throw new Error(`You must be at least ${MIN_AGE} years old to use Nearboard.`);
	}
	return age < ADULT_AGE ? 'teen' : 'adult';
}

/**
 * Sets the user's birth date and age group after onboarding.
 * Validates age — rejects under-13.
 * Uses setDoc with merge to handle the case where the user doc
 * hasn't been created yet (race with onAuthStateChanged).
 */
export async function setBirthDate(uid: string, birthDate: Date): Promise<AgeGroup> {
	const ageGroup = getAgeGroup(birthDate);
	await setDoc(doc(db(), 'users', uid), {
		birthDate: Timestamp.fromDate(birthDate),
		ageGroup
	}, { merge: true });
	return ageGroup;
}

export async function getUserDoc(uid: string): Promise<UserDoc | null> {
	const ref = doc(db(), 'users', uid);
	const snap = await getDoc(ref);
	if (!snap.exists()) return null;
	// Ensure uid is present, even if missing in the document data, by merging the doc id
	return { ...snap.data(), uid: snap.id } as UserDoc;
}

/**
 * Updates the user's global seen timestamp.
 */
export async function updateLastSeen(uid: string): Promise<void> {
	await updateDoc(doc(db(), 'users', uid), {
		lastSeenAt: serverTimestamp()
	});
}

/**
 * Marks onboarding as complete when all conditions are met
 * (board exists, invite sent, card added).
 */
export async function markOnboardingComplete(uid: string): Promise<void> {
	await updateDoc(doc(db(), 'users', uid), {
		onboardingCompletedAt: serverTimestamp()
	});
}

/**
 * Updates the user's display name in both Firebase Auth and Firestore.
 */
export async function updateDisplayName(uid: string, displayName: string): Promise<void> {
	const firebaseUser = auth().currentUser;
	if (firebaseUser) {
		await updateProfile(firebaseUser, { displayName });
	}
	await updateDoc(doc(db(), 'users', uid), { displayName });
}

/**
 * Updates the user's photo URL in both Firebase Auth and Firestore.
 */
export async function updatePhotoURL(uid: string, photoURL: string): Promise<void> {
	const firebaseUser = auth().currentUser;
	if (firebaseUser) {
		await updateProfile(firebaseUser, { photoURL });
	}
	await updateDoc(doc(db(), 'users', uid), { photoURL });
}

/**
 * Updates arbitrary fields on a user's Firestore document.
 * Use for settings fields like quietHoursStart/quietHoursEnd.
 */
export async function updateUserFields(uid: string, fields: Record<string, unknown>): Promise<void> {
	await updateDoc(doc(db(), 'users', uid), fields);
}

/**
 * Permanently deletes the current user's account.
 * Removes the Firestore user doc, then deletes the Firebase Auth user.
 * Throws with a friendly message if re-authentication is required.
 */
export async function deleteAccount(): Promise<void> {
	const firebaseUser = auth().currentUser;
	if (!firebaseUser) throw new Error('Not signed in');

	// Pre-flight a benign auth-touching call so requires-recent-login fails fast,
	// BEFORE we delete the Firestore doc. Without this we'd wipe user data and
	// only then discover that auth deletion can't proceed, leaving the auth
	// account orphaned. Re-running updateProfile with the same name is a no-op
	// when the credential is recent enough.
	try {
		await updateProfile(firebaseUser, { displayName: firebaseUser.displayName ?? '' });
	} catch (err: unknown) {
		const code = (err as { code?: string }).code ?? '';
		if (code === 'auth/requires-recent-login') {
			throw new Error('Please sign out and sign back in, then try again.');
		}
		throw new Error(friendlyAuthError(code));
	}

	// Auth credential is fresh — safe to wipe Firestore (triggers onUserDelete
	// cascade) and then delete the auth user itself.
	await deleteDoc(doc(db(), 'users', firebaseUser.uid));

	try {
		await deleteUser(firebaseUser);
	} catch (err: unknown) {
		const code = (err as { code?: string }).code ?? '';
		throw new Error(friendlyAuthError(code));
	}
}
