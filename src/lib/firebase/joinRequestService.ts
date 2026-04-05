/**
 * @file joinRequestService.ts
 * @description Join request operations — request to join, approve/reject,
 *              and public profile/board queries.
 */

import {
	collection,
	doc,
	addDoc,
	getDoc,
	getDocs,
	updateDoc,
	query,
	where,
	orderBy,
	serverTimestamp
} from 'firebase/firestore';
import { db } from './app';
import { joinBoard } from './boardService';
import type { JoinRequestDoc, UserDoc, BoardDoc } from '$lib/types';

/**
 * Creates a join request for a board. Checks that the user is not already
 * a member and has no existing pending request.
 */
export async function requestToJoin(
	boardId: string,
	user: { uid: string; displayName: string; photoURL: string | null }
): Promise<string> {
	if (!boardId || !user.uid) throw new Error('Invalid request');
	// Check not already a member
	const boardSnap = await getDoc(doc(db(), 'boards', boardId));
	if (!boardSnap.exists()) throw new Error('Board not found');
	const boardData = boardSnap.data();
	const memberIds = (boardData.memberIds as string[]) ?? [];
	if (memberIds.includes(user.uid)) throw new Error('Already a member');

	// Check no existing pending request
	const existing = await getUserJoinRequestStatus(boardId, user.uid);
	if (existing?.status === 'pending') throw new Error('Request already pending');

	const ref = await addDoc(collection(db(), 'boards', boardId, 'joinRequests'), {
		boardId,
		requesterId: user.uid,
		requesterName: user.displayName,
		requesterPhotoURL: user.photoURL,
		status: 'pending',
		requestedAt: serverTimestamp(),
		resolvedAt: null,
		resolvedBy: null
	});

	return ref.id;
}

/**
 * Returns all pending join requests for a board, ordered by requestedAt.
 */
export async function getPendingJoinRequests(boardId: string): Promise<JoinRequestDoc[]> {
	const q = query(
		collection(db(), 'boards', boardId, 'joinRequests'),
		where('status', '==', 'pending'),
		orderBy('requestedAt', 'asc')
	);
	const snap = await getDocs(q);
	return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as JoinRequestDoc);
}

/**
 * Approves a join request — updates status and adds the requester as a board member.
 */
export async function approveJoinRequest(
	boardId: string,
	requestId: string,
	ownerId: string
): Promise<void> {
	const reqRef = doc(db(), 'boards', boardId, 'joinRequests', requestId);
	const reqSnap = await getDoc(reqRef);
	if (!reqSnap.exists()) throw new Error('Request not found');

	const data = reqSnap.data() as JoinRequestDoc;

	await updateDoc(reqRef, {
		status: 'approved',
		resolvedAt: serverTimestamp(),
		resolvedBy: ownerId
	});

	await joinBoard(
		boardId,
		data.requesterId,
		null,
		data.requesterName,
		data.requesterPhotoURL
	);
}

/**
 * Rejects a join request.
 */
export async function rejectJoinRequest(
	boardId: string,
	requestId: string,
	ownerId: string
): Promise<void> {
	await updateDoc(doc(db(), 'boards', boardId, 'joinRequests', requestId), {
		status: 'rejected',
		resolvedAt: serverTimestamp(),
		resolvedBy: ownerId
	});
}

/**
 * Returns the user's latest join request for a board, or null.
 */
export async function getUserJoinRequestStatus(
	boardId: string,
	userId: string
): Promise<JoinRequestDoc | null> {
	if (!boardId || !userId) return null;
	const q = query(
		collection(db(), 'boards', boardId, 'joinRequests'),
		where('requesterId', '==', userId),
		orderBy('requestedAt', 'desc')
	);
	const snap = await getDocs(q);
	if (snap.empty) return null;
	return { id: snap.docs[0].id, ...snap.docs[0].data() } as JoinRequestDoc;
}

/**
 * Queries public boards where a given user is a member.
 */
export async function getPublicBoardsForUser(userId: string): Promise<BoardDoc[]> {
	if (!userId) return [];
	const q = query(
		collection(db(), 'boards'),
		where('memberIds', 'array-contains', userId),
		where('isPublic', '==', true)
	);
	const snap = await getDocs(q);
	return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BoardDoc);
}

/**
 * Queries ALL boards where a given user is a member (public + private).
 * Requires the caller to be signed in (Firestore rules allow any authed read).
 */
export async function getAllBoardsForUser(userId: string): Promise<BoardDoc[]> {
	if (!userId) return [];
	const q = query(
		collection(db(), 'boards'),
		where('memberIds', 'array-contains', userId)
	);
	const snap = await getDocs(q);
	return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BoardDoc);
}

/**
 * Fetches a public user profile. Returns null for teens or missing users.
 * Only exposes safe fields.
 */
export type PublicUserProfile = {
	uid: string;
	displayName: string;
	photoURL: string | null;
	createdAt: import('firebase/firestore').Timestamp;
};

export async function getPublicUserProfile(
	userId: string
): Promise<PublicUserProfile | null> {
	if (!userId) return null;
	const snap = await getDoc(doc(db(), 'users', userId));
	if (!snap.exists()) return null;
	const data = snap.data() as UserDoc;
	if (data.ageGroup === 'teen') return null;
	return {
		uid: data.uid,
		displayName: data.displayName,
		photoURL: data.photoURL,
		createdAt: data.createdAt
	};
}

/**
 * Batch-fetch public profiles for multiple user IDs.
 * Filters out nulls (teens, missing users).
 */
export async function getPublicUserProfiles(
	userIds: string[]
): Promise<PublicUserProfile[]> {
	const results = await Promise.all(userIds.map(getPublicUserProfile));
	return results.filter((p): p is PublicUserProfile => p !== null);
}
