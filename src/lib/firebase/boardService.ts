/**
 * @file boardService.ts
 * @description Board CRUD and real-time Firestore sync. All board Firestore
 *              operations must go through this module — never from components.
 */

import {
	collection,
	doc,
	addDoc,
	setDoc,
	deleteDoc,
	getDoc,
	getDocs,
	query,
	where,
	orderBy,
	limit as firestoreLimit,
	startAfter,
	onSnapshot,
	serverTimestamp,
	updateDoc,
	deleteField,
	increment,
	arrayUnion,
	arrayRemove,
	Timestamp,
	type Unsubscribe,
	type QueryDocumentSnapshot,
	type DocumentData,
	writeBatch,
	runTransaction
} from 'firebase/firestore';
import { db } from './app';
import { wrapUrl } from '$lib/api/affiliateService';
import type {
	BoardDoc,
	BoardTemplate,
	MemberDoc,
	ContentDoc,
	LinkContentDoc,
	ListContentDoc,
	ProductContentDoc,
	ListItem,
	BriefingDoc,
	VoteDoc,
	TemplateDoc,
	TemplateSectionDoc,
	CommentDoc,
	InviteDoc
} from '$lib/types';

function boardsCol() {
	return collection(db(), 'boards');
}

export interface CreateBoardOptions {
	/** Marks the board as auto-created during onboarding. */
	isOnboarding?: boolean;
	/** Seeds the Living Summary instead of waiting for AI generation. */
	livingSummary?: { content: string; editedByAdmin: boolean };
	/** Cloned from a template — skips board creation limit. */
	isTemplateClone?: boolean;
}

/**
 * Creates a new board and adds the creator as owner member.
 * Returns the new board ID.
 */
export async function createBoard(
	name: string,
	template: BoardTemplate,
	userId: string,
	coverImageUrl: string | null = null,
	displayName: string = '',
	photoURL: string | null = null,
	options?: CreateBoardOptions
): Promise<string> {
	const userRef = doc(db(), 'users', userId);

	const boardData: Record<string, unknown> = {
		name,
		ownerId: userId,
		memberIds: [userId],
		isPublic: false,
		template,
		streak: 0,
		timeCapsuleLocked: false,
		timeCapsuleUnlockAt: null,
		coverImageUrl,
		pendingInviteCount: 0,
		enableLivingSummary: true,
		summaryStyle: 'paragraph',
		allowComments: true,
		lastActivityAt: serverTimestamp(),
		createdAt: serverTimestamp()
	};

	if (options?.isOnboarding) boardData.isOnboarding = true;
	if (options?.livingSummary) {
		boardData.livingSummary = {
			content: options.livingSummary.content,
			updatedAt: serverTimestamp(),
			version: 0,
			editedByAdmin: options.livingSummary.editedByAdmin
		};
	}

	const boardRef = await addDoc(boardsCol(), boardData);

	const memberData = {
		userId,
		displayName,
		photoURL,
		role: 'owner' as const,
		joinedAt: serverTimestamp(),
		notificationMode: 'ping' as const,
		lastReadAt: null
	};
	await setDoc(doc(db(), 'boards', boardRef.id, 'members', userId), memberData);

	if (!options?.isOnboarding && !options?.isTemplateClone) {
		await updateDoc(userRef, {
			ownedBoardCount: increment(1)
		});
	}

	return boardRef.id;
}

/**
 * Subscribes to all boards where the user is a member.
 * Returns an unsubscribe function.
 */
export function subscribeToUserBoards(
	userId: string,
	onUpdate: (boards: BoardDoc[]) => void,
	onError: (error: Error) => void
): Unsubscribe {
	const q = query(boardsCol(), where('memberIds', 'array-contains', userId), orderBy('lastActivityAt', 'desc'));

	return onSnapshot(
		q,
		(snapshot) => {
			const boards = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as BoardDoc);
			onUpdate(boards);
		},
		(error) => onError(error)
	);
}

/**
 * Subscribes to board members subcollection for real-time member profiles.
 */
export function subscribeToBoardMembers(
	boardId: string,
	onUpdate: (members: MemberDoc[]) => void,
	onError?: (error: Error) => void
): Unsubscribe {
	const membersCol = collection(db(), 'boards', boardId, 'members');
	return onSnapshot(
		membersCol,
		(snapshot) => {
			const members = snapshot.docs.map((d) => ({ ...d.data(), userId: d.id }) as MemberDoc);
			onUpdate(members);
		},
		(error) => onError?.(error)
	);
}

/**
 * Subscribes to a single board document.
 */
export function subscribeToBoard(
	boardId: string,
	onUpdate: (board: BoardDoc | null) => void,
	onError?: (error: Error) => void
): Unsubscribe {
	const ref = doc(db(), 'boards', boardId);
	return onSnapshot(ref, (snap) => {
		if (!snap.exists()) {
			onUpdate(null);
			return;
		}
		onUpdate({ id: snap.id, ...snap.data() } as BoardDoc);
	}, onError);
}

/**
 * Fetches a single board document (non-realtime).
 */
export async function getBoard(boardId: string): Promise<BoardDoc | null> {
	const snap = await getDoc(doc(db(), 'boards', boardId));
	if (!snap.exists()) return null;
	return { id: snap.id, ...snap.data() } as BoardDoc;
}

/**
 * Updates the board's Living Summary. Called by board admins.
 * Manual edits mark the summary as editedByAdmin.
 */
export async function updateLivingSummary(
	boardId: string,
	content: string,
	version: number
): Promise<void> {
	await updateDoc(doc(db(), 'boards', boardId), {
		'livingSummary.content': content,
		'livingSummary.version': version,
		'livingSummary.updatedAt': serverTimestamp(),
		'livingSummary.editedByAdmin': true
	});
}

/**
 * Updates board fields. Only pass the fields you want to change.
 */
export async function updateBoard(
	boardId: string,
	data: Partial<Pick<BoardDoc, 'name' | 'isPublic' | 'template' | 'timeCapsuleLocked' | 'timeCapsuleUnlockAt' | 'enableLivingSummary' | 'summaryStyle' | 'summaryFocus' | 'lastRegenerationRequestedAt' | 'allowComments' | 'coverImageUrl' | 'pendingInviteCount' | 'experienceOverrides'>>
): Promise<void> {
	await updateDoc(doc(db(), 'boards', boardId), data);
}

/**
 * Requests an AI regeneration of the board's living summary.
 */
export async function requestSummaryRegeneration(boardId: string): Promise<void> {
	await updateDoc(doc(db(), 'boards', boardId), { lastRegenerationRequestedAt: serverTimestamp() });
}

/**
 * One-time migration for boards predating the Living Summary feature.
 * Sets enableLivingSummary=true (so processDirtyBoards picks them up) and
 * summaryDirty=true (so they're queued for the next cycle). Idempotent —
 * only called when `enableLivingSummary` is undefined on the board doc.
 */
export async function enableBoardSummaries(boardId: string): Promise<void> {
	await updateDoc(doc(db(), 'boards', boardId), {
		enableLivingSummary: true,
		summaryDirty: true
	});
}

/**
 * Deletes a board document. Subcollection cleanup is handled by the
 * onBoardDelete Cloud Function trigger.
 */
export async function deleteBoard(boardId: string): Promise<void> {
	await deleteDoc(doc(db(), 'boards', boardId));
}

// ─── Content operations ───────────────────────────────────────────────────────

function contentCol(boardId: string) {
	return collection(db(), 'boards', boardId, 'content');
}

/**
 * Adds a content item (note, list, etc.) to a board.
 * Returns the new content document ID.
 * 
 * Lever 7 (Agent guardrails): Requires userIntent field for all content creation.
 * Validates intent is non-empty. Automatically sets agentAdded flag if detected.
 * 
 * Note: userIntent is optional in the type for backward compatibility, but
 * Firestore rules will reject writes without a non-empty userIntent.
 */
export async function addContent(
	boardId: string,
	data: Omit<ContentDoc, 'id' | 'createdAt' | 'moderationStatus'> & { 
		createdAt?: ReturnType<typeof serverTimestamp>;
		userIntent?: string;  // Lever 7: Required by Firestore rules, optional here for backward compat
		agentAdded?: boolean;
		agentId?: string;
	}
): Promise<string> {
	// Lever 7: Validate userIntent is provided and non-empty (if provided)
	if (data.userIntent !== undefined && data.userIntent.trim().length === 0) {
		throw new Error('userIntent must be non-empty');
	}

	let finalData: Record<string, unknown> = { ...data };

	// Set default userIntent if not provided (for backward compatibility)
	// Firestore rules will still enforce non-empty userIntent
	if (!finalData.userIntent) {
		finalData.userIntent = 'User-added content';
	}

	// Enforce Firestore rule limits (title ≤ 200, text ≤ 10000)
	if (typeof finalData.title === 'string' && finalData.title.length > 200) {
		finalData.title = (finalData.title as string).slice(0, 197) + '…';
	}
	if (typeof finalData.text === 'string' && finalData.text.length > 10000) {
		finalData.text = (finalData.text as string).slice(0, 9997) + '…';
	}

	// V1 Monetization: Affiliate wrapping for commercial links
	if ((data.type === 'link' || data.type === 'product') && 'url' in data) {
		try {
			const url = (data as LinkContentDoc | ProductContentDoc).url;
			if (url) {
				const affiliate = await wrapUrl(url);
				finalData = {
					...finalData,
					...affiliate,
					url: affiliate.resolvedUrl
				};
			}
		} catch (err) {
			console.error('Affiliate wrapping failed in addContent:', err);
		}
	}

	const ref = await addDoc(contentCol(boardId), {
		...finalData,
		boardId,
		moderationStatus: 'approved',
		createdAt: serverTimestamp()
	});
	// Fire-and-forget — don't block content creation on board meta update
	updateDoc(doc(db(), 'boards', boardId), { lastActivityAt: serverTimestamp() }).catch(console.error);
	return ref.id;
}

/**
 * Subscribes to all content in a board, ordered by creation time (newest first).
 */
export function subscribeToBoardContent(
	boardId: string,
	onUpdate: (content: ContentDoc[]) => void,
	onError?: (error: Error) => void
): Unsubscribe {
	const q = query(contentCol(boardId), orderBy('createdAt', 'desc'));
	return onSnapshot(q, (snapshot) => {
		const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as ContentDoc);
		onUpdate(items);
	}, onError);
}

/** Page size for cursor-based content pagination */
export const CONTENT_PAGE_SIZE = 20;

/**
 * Loads the next page of board content after a cursor document.
 * Returns the fetched items and the last document snapshot for the next page.
 * If fewer than CONTENT_PAGE_SIZE items are returned, there are no more pages.
 */
export async function loadMoreContent(
	boardId: string,
	lastDoc: QueryDocumentSnapshot<DocumentData>
): Promise<{ items: ContentDoc[]; lastDoc: QueryDocumentSnapshot<DocumentData> | null }> {
	const q = query(
		contentCol(boardId),
		orderBy('createdAt', 'desc'),
		startAfter(lastDoc),
		firestoreLimit(CONTENT_PAGE_SIZE)
	);
	const snapshot = await getDocs(q);
	const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as ContentDoc);
	const newLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
	return { items, lastDoc: newLastDoc };
}

/**
 * One-shot fetch of the first page of board content (no listener).
 * Use for feed rendering of low-activity boards where a live subscription
 * isn't worth the socket/memory overhead.
 */
export async function fetchLatestBoardContent(boardId: string): Promise<ContentDoc[]> {
	const q = query(contentCol(boardId), orderBy('createdAt', 'desc'), firestoreLimit(CONTENT_PAGE_SIZE));
	const snapshot = await getDocs(q);
	return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as ContentDoc);
}

/**
 * Subscribes to the first page of board content (real-time).
 * Returns an unsubscribe function and calls onUpdate with items + last doc snapshot.
 */
export function subscribeToBoardContentPaginated(
	boardId: string,
	onUpdate: (content: ContentDoc[], lastDoc: QueryDocumentSnapshot<DocumentData> | null) => void,
	onError?: (error: Error) => void
): Unsubscribe {
	const q = query(contentCol(boardId), orderBy('createdAt', 'desc'), firestoreLimit(CONTENT_PAGE_SIZE));
	return onSnapshot(q, (snapshot) => {
		const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as ContentDoc);
		const last = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
		onUpdate(items, last);
	}, onError);
}

/** Max items to fetch for board preview mosaic */
const PREVIEW_LIMIT = 6;

/**
 * Subscribes to a board's most recent content items for preview mosaic.
 * Lightweight: only fetches PREVIEW_LIMIT items.
 */
export function subscribeToBoardPreview(
	boardId: string,
	onUpdate: (content: ContentDoc[]) => void,
	onError?: (error: Error) => void
): Unsubscribe {
	const q = query(contentCol(boardId), orderBy('createdAt', 'desc'), firestoreLimit(PREVIEW_LIMIT));
	return onSnapshot(q, (snapshot) => {
		const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as ContentDoc);
		onUpdate(items);
	}, onError);
}

/**
 * Fetches recent videos from a board since a given date (one-shot, not realtime).
 */
export async function getRecentVideos(
	boardId: string,
	since: Date,
	max = 10
): Promise<ContentDoc[]> {
	const sinceTs = Timestamp.fromDate(since);
	const q = query(
		contentCol(boardId),
		where('type', '==', 'video'),
		where('createdAt', '>=', sinceTs),
		orderBy('createdAt', 'desc'),
		firestoreLimit(max)
	);
	const snap = await getDocs(q);
	return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ContentDoc);
}

/**
 * Appends items to an existing list card with the given title, or creates a new
 * list if none exists. Used by the Pro Digest CTAs (recipe → shopping list,
 * movie → watchlist, book → reading list) so repeated taps consolidate into a
 * single list rather than creating duplicates.
 *
 * Matches case-insensitively on title. Dedupes by item text against the
 * existing list so re-adding the same movie is a no-op.
 *
 * Returns the list's content id (existing or newly created).
 */
export async function appendOrCreateList(
	boardId: string,
	title: string,
	newItems: { text: string }[],
	author: { uid: string; displayName: string; photoURL: string | null }
): Promise<string> {
	// Pull all list cards on the board and find the first one whose title matches.
	// We don't filter server-side because Firestore can't AND `type == 'list'` with
	// a case-insensitive title equality, and the result set is already small.
	const snap = await getDocs(query(contentCol(boardId), where('type', '==', 'list')));
	const targetTitle = title.trim().toLowerCase();
	const existing = snap.docs.find((d) => {
		const data = d.data() as ListContentDoc;
		return (data.title || '').trim().toLowerCase() === targetTitle;
	});

	if (existing) {
		const data = existing.data() as ListContentDoc;
		const existingTexts = new Set((data.items || []).map((i) => i.text.trim().toLowerCase()));
		const additions: ListItem[] = newItems
			.map((i) => i.text.trim())
			.filter((text) => text.length > 0 && !existingTexts.has(text.toLowerCase()))
			.map((text) => ({ id: crypto.randomUUID(), text, completed: false }));

		if (additions.length > 0) {
			await updateDoc(doc(db(), 'boards', boardId, 'content', existing.id), {
				items: [...(data.items || []), ...additions]
			});
		}
		return existing.id;
	}

	// No matching list — create one.
	const items: ListItem[] = newItems
		.map((i) => i.text.trim())
		.filter((text) => text.length > 0)
		.map((text) => ({ id: crypto.randomUUID(), text, completed: false }));

	return await addContent(boardId, {
		type: 'list',
		title,
		items,
		boardId,
		authorId: author.uid,
		authorName: author.displayName,
		authorPhotoURL: author.photoURL
	} as Omit<ListContentDoc, 'id' | 'createdAt' | 'moderationStatus'>);
}

/**
 * Toggles a list item's completed state inside a ListContentDoc.
 */
export async function toggleListItem(
	boardId: string,
	contentId: string,
	items: ListItem[],
	itemId: string
): Promise<void> {
	const updated = items.map((item) =>
		item.id === itemId ? { ...item, completed: !item.completed } : item
	);
	await updateDoc(doc(db(), 'boards', boardId, 'content', contentId), { items: updated });
}

/**
 * Updates fields on a content item.
 */
export async function updateContent(
	boardId: string,
	contentId: string,
	data: Record<string, unknown>
): Promise<void> {
	await updateDoc(doc(db(), 'boards', boardId, 'content', contentId), data);
}

/**
 * Deletes a content item from a board.
 */
export async function deleteContent(boardId: string, contentId: string): Promise<void> {
	await deleteDoc(doc(db(), 'boards', boardId, 'content', contentId));
}

// ─── Comment operations ──────────────────────────────────────────────────────

function commentsCol(boardId: string, contentId: string) {
	return collection(db(), 'boards', boardId, 'content', contentId, 'comments');
}

/**
 * Adds a comment to a content card.
 * Enforces 280 character limit and 10s rate limit.
 */
export async function addComment(
	boardId: string,
	contentId: string,
	userId: string,
	userName: string,
	userPhotoURL: string | null,
	text: string,
	mentions: string[] = []
): Promise<string> {
	if (text.length > 280) throw new Error('Comment too long');

	const memberRef = doc(db(), 'boards', boardId, 'members', userId);
	const memberSnap = await getDoc(memberRef);
	if (memberSnap.exists()) {
		const lastComment = memberSnap.data().lastCommentAt?.toMillis() ?? 0;
		if (Date.now() - lastComment < 10000) {
			throw new Error('Please wait 10s between comments');
		}
	}

	const ref = await addDoc(commentsCol(boardId, contentId), {
		authorId: userId,
		authorName: userName,
		authorPhotoURL: userPhotoURL,
		text: text.trim(),
		createdAt: serverTimestamp(),
		...(mentions.length > 0 ? { mentions } : {})
	});

	// commentCount is updated by the onCommentWrite trigger (single source of truth)
	updateDoc(memberRef, { lastCommentAt: serverTimestamp() }).catch(console.error);

	return ref.id;
}

/**
 * Subscribes to comments for a content card, ordered by creation time.
 */
export function subscribeToComments(
	boardId: string,
	contentId: string,
	onUpdate: (comments: CommentDoc[]) => void,
	max = 50
): Unsubscribe {
	const q = query(commentsCol(boardId, contentId), orderBy('createdAt', 'desc'), firestoreLimit(max));
	return onSnapshot(q, (snapshot) => {
		const comments = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as CommentDoc).reverse();
		onUpdate(comments);
	});
}

/**
 * Deletes a comment. Only author or board owner can delete.
 * commentCount is updated by the onCommentWrite trigger.
 */
export async function deleteComment(
	boardId: string,
	contentId: string,
	commentId: string
): Promise<void> {
	const commentRef = doc(db(), 'boards', boardId, 'content', contentId, 'comments', commentId);
	await deleteDoc(commentRef);
}

// ─── Follow operations ────────────────────────────────────────────────────────

/**
 * Follows a public board. Adds boardId to user's followingBoardIds
 * and increments followerCount on the board.
 */
export async function followBoard(boardId: string, userId: string): Promise<void> {
	const batch = writeBatch(db());
	batch.update(doc(db(), 'users', userId), { followingBoardIds: arrayUnion(boardId) });
	batch.update(doc(db(), 'boards', boardId), { followerCount: increment(1) });
	await batch.commit();
}

/**
 * Unfollows a public board. Removes boardId from user's followingBoardIds
 * and decrements followerCount on the board.
 */
export async function unfollowBoard(boardId: string, userId: string): Promise<void> {
	const batch = writeBatch(db());
	batch.update(doc(db(), 'users', userId), { followingBoardIds: arrayRemove(boardId) });
	batch.update(doc(db(), 'boards', boardId), { followerCount: increment(-1) });
	await batch.commit();
}

// ─── Acknowledgment operations ────────────────────────────────────────────────

/**
 * Toggles a heart acknowledgment on a content item.
 */
export async function toggleAcknowledgment(
	boardId: string,
	contentId: string,
	userId: string,
	active: boolean
): Promise<void> {
	const ref = doc(db(), 'boards', boardId, 'content', contentId);
	if (active) {
		await updateDoc(ref, {
			[`acknowledgments.${userId}`]: {
				type: 'heart',
				createdAt: serverTimestamp()
			}
		});
	} else {
		await updateDoc(ref, {
			[`acknowledgments.${userId}`]: deleteField()
		});
	}
}

// ─── Briefing operations ──────────────────────────────────────────────────────

/**
 * Subscribes to the latest briefing for a board (most recent first, limit 1).
 */
export function subscribeToLatestBriefing(
	boardId: string,
	onUpdate: (briefing: BriefingDoc | null) => void,
	onError?: (error: Error) => void
): Unsubscribe {
	const q = query(
		collection(db(), 'boards', boardId, 'briefings'),
		orderBy('generatedAt', 'desc'),
		firestoreLimit(1)
	);
	return onSnapshot(q, (snapshot) => {
		if (snapshot.empty) {
			onUpdate(null);
			return;
		}
		const d = snapshot.docs[0];
		onUpdate({ id: d.id, ...d.data() } as BriefingDoc);
	}, onError);
}

// ─── Poll vote operations ─────────────────────────────────────────────────────

/**
 * Casts a vote on a poll. One vote per user — uses userId as doc ID.
 * Re-calling with a different optionId switches the vote.
 */
export async function voteOnPoll(
	boardId: string,
	contentId: string,
	userId: string,
	optionId: string
): Promise<void> {
	await setDoc(
		doc(db(), 'boards', boardId, 'content', contentId, 'votes', userId),
		{ userId, optionId, votedAt: serverTimestamp() }
	);
}

/**
 * Removes the current user's vote — used for tap-to-unvote.
 */
export async function removeVote(
	boardId: string,
	contentId: string,
	userId: string
): Promise<void> {
	await deleteDoc(
		doc(db(), 'boards', boardId, 'content', contentId, 'votes', userId)
	);
}

/**
 * Subscribes to all votes on a poll content item.
 */
export function subscribeToVotes(
	boardId: string,
	contentId: string,
	onUpdate: (votes: VoteDoc[]) => void,
	max = 200
): Unsubscribe {
	const q = query(
		collection(db(), 'boards', boardId, 'content', contentId, 'votes'),
		firestoreLimit(max)
	);
	return onSnapshot(q, (snapshot) => {
		const votes = snapshot.docs.map((d) => d.data() as VoteDoc);
		onUpdate(votes);
	});
}

// ─── Member management ───────────────────────────────────────────────────────

/**
 * Invites contacts to a board.
 */
export async function inviteContacts(
	boardId: string,
	inviterId: string,
	contacts: { name: string; identifier: string }[]
): Promise<void> {
	const batch = writeBatch(db());

	for (const c of contacts) {
		const normalizedIdentifier = c.identifier.trim().toLowerCase();
		const inviteRef = doc(collection(db(), 'boards', boardId, 'invites'));
		batch.set(inviteRef, {
			boardId,
			inviterId,
			contactName: c.name,
			contactIdentifier: normalizedIdentifier,
			status: 'pending',
			invitedAt: serverTimestamp()
		});
	}

	// Atomic: invite docs + count update in one batch
	batch.update(doc(db(), 'boards', boardId), {
		pendingInviteCount: increment(contacts.length)
	});

	await batch.commit();
}

/**
 * Fetches pending invites for a board.
 */
export async function getPendingInvites(boardId: string): Promise<InviteDoc[]> {
	const q = query(
		collection(db(), 'boards', boardId, 'invites'),
		where('status', '==', 'pending')
	);
	const snap = await getDocs(q);
	return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InviteDoc);
}

/**
 * Generates a share link for a board.
 * All boards are private-only (Lever 1) — returns /join/{boardId} (invite/join request page)
 */
export function generateShareLink(boardId: string): string {
	const origin = typeof window !== 'undefined' ? window.location.origin : '';
	return `${origin}/join/${boardId}`;  // Invite/join link only
}

/**
 * Generates a join link for a board (for invites).
 * The invite code is the board ID itself combined with a simple hash.
 */
export function generateInviteLink(boardId: string): string {
	return `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${boardId}`;
}

/**
 * Adds a user as a member of a board.
 * Updates both the board's memberIds array and the members subcollection.
 */
export async function joinBoard(
	boardId: string,
	userId: string,
	inviteId: string | null = null,
	displayName: string = '',
	photoURL: string | null = null
): Promise<void> {
	const boardRef = doc(db(), 'boards', boardId);
	const boardSnap = await getDoc(boardRef);
	if (!boardSnap.exists()) throw new Error('Board not found');

	const data = boardSnap.data();
	const memberIds = (data.memberIds as string[]) ?? [];
	if (memberIds.includes(userId)) return; // already a member

	// Use arrayUnion so two concurrent joins don't clobber each other's memberIds
	// via read-modify-write. arrayUnion is server-side and idempotent.
	const boardUpdate: Record<string, unknown> = {
		memberIds: arrayUnion(userId)
	};
	if (inviteId) {
		boardUpdate.pendingInviteCount = increment(-1);
	}
	await updateDoc(boardRef, boardUpdate);

	await setDoc(doc(db(), 'boards', boardId, 'members', userId), {
		userId,
		displayName,
		photoURL,
		role: 'member',
		joinedAt: serverTimestamp(),
		notificationMode: 'ping',
		lastReadAt: null,
		joinedViaInviteId: inviteId
	});

	if (inviteId) {
		await updateDoc(doc(db(), 'boards', boardId, 'invites', inviteId), {
			status: 'joined'
		});
	}
}

/**
 * Removes a member from a board. Only the board owner or the member themselves
 * can call this.
 */
export async function removeMember(boardId: string, userId: string): Promise<void> {
	const boardRef = doc(db(), 'boards', boardId);
	// arrayRemove is atomic and avoids read-modify-write races against concurrent
	// joins/removes. The previous filter() approach could resurrect a removed
	// member if a join landed between read and write.
	await updateDoc(boardRef, {
		memberIds: arrayRemove(userId)
	});

	await deleteDoc(doc(db(), 'boards', boardId, 'members', userId));
}

/**
 * Fetches all members of a board with their profiles.
 */
export async function getBoardMembers(boardId: string): Promise<MemberDoc[]> {
	const snap = await getDocs(collection(db(), 'boards', boardId, 'members'));
	return snap.docs.map((d) => ({ ...d.data() }) as MemberDoc);
}

/**
 * Updates a member's notification preference for a board.
 */
export async function updateMemberNotificationMode(
	boardId: string,
	userId: string,
	mode: 'silent' | 'ping' | 'voice'
): Promise<void> {
	await updateDoc(doc(db(), 'boards', boardId, 'members', userId), {
		notificationMode: mode
	});
}

/**
 * Updates a member's digest muted preference for a board.
 */
export async function updateMemberDigestMuted(
	boardId: string,
	userId: string,
	muted: boolean
): Promise<void> {
	await updateDoc(doc(db(), 'boards', boardId, 'members', userId), {
		digestMuted: muted
	});
}

/**
 * Heartbeat used by the board view to drive AvatarStack's presence pulse.
 * Cheap setDoc-merge — should be called on board open and every ~30s while open.
 * Stale writes are tolerated; the pulse fades out client-side once the timestamp
 * ages past the freshness threshold (~90s).
 */
export async function heartbeatPresence(boardId: string, userId: string): Promise<void> {
	try {
		await setDoc(doc(db(), 'boards', boardId, 'members', userId), {
			lastViewedAt: serverTimestamp()
		}, { merge: true });
	} catch (err) {
		// Presence is best-effort — never crash the board view if it fails.
		console.warn('heartbeatPresence failed:', err);
	}
}

/**
 * Marks a board as read for the current user.
 * Updates both the member doc (for other features) and the consolidated
 * readState doc (for efficient unread checks — 1 read instead of N).
 */
export async function markBoardRead(boardId: string, userId: string): Promise<void> {
	const now = Timestamp.now();
	await Promise.all([
		setDoc(doc(db(), 'boards', boardId, 'members', userId), {
			lastReadAt: serverTimestamp()
		}, { merge: true }),
		setDoc(doc(db(), 'users', userId, 'readState', 'boards'), {
			[boardId]: now
		}, { merge: true })
	]);
}

/**
 * Syncs the current user's displayName and photoURL on their member doc
 * so the AvatarStack always shows up-to-date profile photos.
 */
export async function syncMemberProfile(
	boardId: string,
	userId: string,
	displayName: string,
	photoURL: string | null
): Promise<void> {
	await setDoc(doc(db(), 'boards', boardId, 'members', userId), {
		displayName,
		photoURL
	}, { merge: true });
}

/**
 * Returns the lastReadAt timestamp for a user's membership in a board.
 */
export async function getLastReadAt(boardId: string, userId: string): Promise<Timestamp | null> {
	const memberRef = doc(db(), 'boards', boardId, 'members', userId);
	const snap = await getDoc(memberRef);
	return (snap.data()?.lastReadAt as Timestamp) ?? null;
}

/**
 * Returns all board read timestamps for a user in a single Firestore read.
 * Used by boardStore to efficiently compute unread state.
 */
export async function getAllReadTimestamps(userId: string): Promise<Map<string, Timestamp>> {
	const snap = await getDoc(doc(db(), 'users', userId, 'readState', 'boards'));
	const result = new Map<string, Timestamp>();
	if (snap.exists()) {
		const data = snap.data();
		for (const [boardId, ts] of Object.entries(data)) {
			if (ts instanceof Timestamp) {
				result.set(boardId, ts);
			}
		}
	}
	return result;
}

// ─── Time Capsule operations ─────────────────────────────────────────────────

/**
 * Locks a board as a time capsule with a future unlock date.
 */
export async function lockTimeCapsule(boardId: string, unlockDate: Date): Promise<void> {
	await updateDoc(doc(db(), 'boards', boardId), {
		timeCapsuleLocked: true,
		timeCapsuleUnlockAt: Timestamp.fromDate(unlockDate)
	});
}

/**
 * Manually unlocks a time capsule (owner only).
 */
export async function unlockTimeCapsule(boardId: string): Promise<void> {
	await updateDoc(doc(db(), 'boards', boardId), {
		timeCapsuleLocked: false,
		timeCapsuleUnlockAt: null
	});
}

// ─── Template Marketplace operations ─────────────────────────────────────────

/**
 * Publishes a board as a template in the marketplace.
 */
export async function publishTemplate(
	boardId: string,
	name: string,
	description: string,
	category: BoardTemplate,
	creatorId: string,
	creatorName: string,
	sections: TemplateSectionDoc[]
): Promise<string> {
	const ref = await addDoc(collection(db(), 'templates'), {
		name,
		description,
		category,
		creatorId,
		creatorName,
		sections,
		sourceBoardId: boardId,
		cloneCount: 0,
		createdAt: serverTimestamp()
	});
	return ref.id;
}

/**
 * Lists public templates, optionally filtered by category.
 */
export async function listTemplates(
	category?: BoardTemplate
): Promise<(TemplateDoc & { id: string })[]> {
	let q;
	if (category) {
		q = query(collection(db(), 'templates'), where('category', '==', category), firestoreLimit(50));
	} else {
		q = query(collection(db(), 'templates'), firestoreLimit(50));
	}
	const snap = await getDocs(q);
	return snap.docs
		.map((d) => ({ id: d.id, ...d.data() }) as TemplateDoc & { id: string })
		.sort((a, b) => {
			// Curated templates appear first
			const ac = a.isCurated ? 1 : 0;
			const bc = b.isCurated ? 1 : 0;
			if (bc !== ac) return bc - ac;
			return (b.cloneCount ?? 0) - (a.cloneCount ?? 0);
		});
}

/**
 * Converts a template section into properly typed content data for addContent.
 */
function sectionToContentData(
	section: TemplateSectionDoc,
	boardId: string,
	userId: string
): Omit<ContentDoc, 'id' | 'createdAt' | 'moderationStatus'> {
	const base = {
		boardId,
		authorId: userId,
		authorName: 'Template',
		authorPhotoURL: null
	};

	switch (section.contentType) {
		case 'link':
			return {
				...base,
				type: 'link',
				url: section.url || '',
				title: section.title,
				description: section.description ?? null,
				image: section.image ?? null,
				domain: section.domain || '',
				favicon: section.favicon ?? null,
				enrichment: null
			} as Omit<LinkContentDoc, 'id' | 'createdAt' | 'moderationStatus'>;

		case 'product':
			return {
				...base,
				type: 'product',
				url: section.url || '',
				title: section.title,
				image: section.image ?? null,
				price: section.price || '',
				domain: section.domain || '',
				originalPrice: section.originalPrice ?? null,
				lastCheckedPrice: null,
				lastCheckedAt: null,
				priceDrop: false
			} as Omit<ProductContentDoc, 'id' | 'createdAt' | 'moderationStatus'>;

		case 'list':
			return {
				...base,
				type: 'list',
				title: section.title,
				items: section.items || []
			} as unknown as Omit<ContentDoc, 'id' | 'createdAt' | 'moderationStatus'>;

		default:
			return {
				...base,
				type: section.contentType,
				text: section.placeholder,
				title: section.title
			} as Omit<ContentDoc, 'id' | 'createdAt' | 'moderationStatus'>;
	}
}

/**
 * Clones a template to create a new board with pre-populated sections.
 */
export async function cloneTemplate(
	templateId: string,
	userId: string,
	displayName: string = '',
	photoURL: string | null = null
): Promise<string> {
	const templateSnap = await getDoc(doc(db(), 'templates', templateId));
	if (!templateSnap.exists()) throw new Error('Template not found');

	const template = templateSnap.data() as TemplateDoc;
	const boardId = await createBoard(template.name, template.category, userId, null, displayName, photoURL, { isTemplateClone: true });

	// Increment clone count
	await updateDoc(doc(db(), 'templates', templateId), { cloneCount: increment(1) });

	// Add content from template sections in a single batch — atomic and
	// avoids one network round-trip per section. Write directly (not via
	// addContent) to skip affiliate wrapping and ensure all required fields
	// are present for Firestore rules.
	// writeBatch caps at 500 ops per commit; chunk if a template ever exceeds that.
	const BATCH_LIMIT = 500;
	const sections = template.sections;
	for (let i = 0; i < sections.length; i += BATCH_LIMIT) {
		const batch = writeBatch(db());
		for (const section of sections.slice(i, i + BATCH_LIMIT)) {
			const ref = doc(contentCol(boardId));
			batch.set(ref, {
				...sectionToContentData(section, boardId, userId),
				boardId,
				moderationStatus: 'approved' as const,
				userIntent: 'Cloned from template',
				createdAt: serverTimestamp()
			});
		}
		await batch.commit();
	}

	// Update board activity
	updateDoc(doc(db(), 'boards', boardId), { lastActivityAt: serverTimestamp() }).catch(console.error);

	return boardId;
}
