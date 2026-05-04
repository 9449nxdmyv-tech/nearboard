/**
 * @file addBoardItem.ts
 * @description MCP tool: Add content to a board.
 *              Supports note, list, link, voice, photo, video, and location types.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

interface AddBoardItemParams {
	boardId: string;
	type: string;
	content: string;
	caption?: string;
	latitude?: number;
	longitude?: number;
}

export async function addBoardItem(userId: string, params: AddBoardItemParams) {
	const { boardId, type, content, caption, latitude, longitude } = params;
	const db = getFirestore();
	const userSnap = await db.doc(`users/${userId}`).get();
	const userData = userSnap.data();
	const userName = (userData?.displayName as string) ?? 'MCP User';
	const userPhoto = (userData?.photoURL as string) ?? null;

	const data: Record<string, unknown> = {
		boardId,
		authorId: userId,
		authorName: userName,
		authorPhotoURL: userPhoto,
		moderationStatus: 'approved',
		userIntent: 'Added via MCP',
		createdAt: FieldValue.serverTimestamp(),
		type
	};

	switch (type) {
		case 'note':
			data.text = content;
			break;
		case 'list':
			data.title = content;
			data.items = [];
			break;
		case 'link':
			data.url = content;
			data.title = content;
			break;
		case 'voice':
			data.audioUrl = content;
			data.durationMs = 0;
			break;
		case 'photo':
			data.imageUrl = content;
			data.images = [{ url: content, width: 0, height: 0 }];
			data.caption = caption ?? '';
			break;
		case 'video':
			data.videoUrl = content;
			data.thumbnailUrl = null;
			data.durationMs = 0;
			data.caption = caption ?? '';
			break;
		case 'location':
			data.latitude = latitude ?? 0;
			data.longitude = longitude ?? 0;
			data.address = content;
			data.name = caption ?? content;
			break;
		default:
			data.text = content;
	}

	const ref = await db.collection(`boards/${boardId}/content`).add(data);
	return { contentId: ref.id, boardId, type };
}
