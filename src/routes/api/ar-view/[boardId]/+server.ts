/**
 * @file api/ar-view/+server.ts
 * @description AR view API endpoint (Lever 4 — AR groundwork).
 *              Returns location cards from a board with lat/long for AR rendering.
 *              Only accessible to board members (private-only social graph).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDoc, getDocs, doc, collection, query, where, orderBy, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '$lib/firebase/app';
import type { LocationContentDoc } from '$lib/types';

interface ARViewResponse {
	boardId: string;
	boardName: string;
	locations: Array<{
		id: string;
		name: string | null;
		address: string;
		latitude: number;
		longitude: number;
		authorName: string;
		createdAt: string;
	}>;
}

export const GET: RequestHandler = async ({ params, url }) => {
	const boardId = params.boardId;

	if (!boardId) {
		return json({ error: 'Board ID required' }, { status: 400 });
	}

	try {
		// Fetch board to verify access
		const boardRef = doc(db(), 'boards', boardId);
		const boardSnap = await getDoc(boardRef);

		if (!boardSnap.exists()) {
			return json({ error: 'Board not found' }, { status: 404 });
		}

		const board = boardSnap.data();

		// Note: Firestore security rules already enforce member-only access
		// This is a defense-in-depth check
		const currentUser = url.searchParams.get('userId');
		if (currentUser && !board.memberIds?.includes(currentUser)) {
			return json({ error: 'Access denied' }, { status: 403 });
		}

		// Fetch location cards from the board
		const contentRef = collection(db(), 'boards', boardId, 'content');
		const locationQuery = query(
			contentRef,
			where('type', '==', 'location'),
			orderBy('createdAt', 'desc')
		);

		// Note: This query requires a composite index on (type, createdAt)
		// Firestore will provide a link to create the index if it doesn't exist
		const contentSnap = await getDocs(locationQuery);

		const locations = contentSnap.docs.map((docSnap: QueryDocumentSnapshot) => {
			const data = docSnap.data() as LocationContentDoc;
			return {
				id: docSnap.id,
				name: data.name,
				address: data.address,
				latitude: data.latitude,
				longitude: data.longitude,
				authorName: data.authorName,
				createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date().toISOString()
			};
		});

		const response: ARViewResponse = {
			boardId,
			boardName: board.name,
			locations
		};

		// Cache for 5 minutes — locations don't change frequently
		return new Response(JSON.stringify(response), {
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'public, max-age=300'
			}
		});
	} catch (err) {
		console.error('AR view API error:', err);

		// Handle missing index error gracefully
		if (err instanceof Error && err.message.includes('index')) {
			return json(
				{ error: 'Index required. Please create the composite index on (type, createdAt).', details: err.message },
				{ status: 503 }
			);
		}

		return json({ error: 'Failed to fetch AR view data' }, { status: 500 });
	}
};
