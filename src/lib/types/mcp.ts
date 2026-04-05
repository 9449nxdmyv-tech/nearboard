/**
 * @file mcp.ts
 * @description Input/output types for all MCP tool calls.
 *              Shared between /mcp/server.ts and /src/lib/firebase/ service layer.
 *
 * Security notes:
 *   - Board membership is validated server-side on every board-scoped tool call
 *     (see BOARD_SCOPED_TOOLS in mcp/server.ts → validateBoardMembership).
 *   - OAuth tokens are currently user-scoped; per-board scoping is planned for a
 *     future OAuth consent flow iteration (tracked in mcp/server.ts).
 */

import type { BoardTemplate, ContentType } from './firestore';

// ─── Tool input types ─────────────────────────────────────────────────────────

export interface GetBoardBriefingInput {
	boardId: string;
}

export interface AddBoardItemInput {
	boardId: string;
	type: 'note' | 'list' | 'link' | 'voice' | 'photo' | 'video' | 'location';
	content: string;
	/** Optional caption for photo/video items */
	caption?: string;
	/** Latitude for location items */
	latitude?: number;
	/** Longitude for location items */
	longitude?: number;
}

export interface ListBoardContentInput {
	boardId: string;
	limit?: number;
}

export interface SearchBoardsInput {
	query: string;
}

export interface CreateBoardInput {
	name: string;
	template?: BoardTemplate;
}

export interface CheckListItemsInput {
	boardId: string;
	itemIds: string[];
}

export type GetAllBoardsInput = Record<string, never>;

// ─── Tool output types ────────────────────────────────────────────────────────

export interface GetBoardBriefingOutput {
	boardId: string;
	boardName: string;
	text: string;
	audioUrl: string | null;
	generatedAt: string;
}

export interface AddBoardItemOutput {
	contentId: string;
	boardId: string;
	type: string;
}

export interface ListBoardContentOutput {
	items: {
		id: string;
		type: ContentType;
		authorName: string;
		createdAt: string;
		text?: string;
		title?: string;
		url?: string;
	}[];
}

export interface SearchBoardsOutput {
	boards: {
		id: string;
		name: string;
		template: BoardTemplate;
		memberCount: number;
	}[];
}

export interface CreateBoardOutput {
	boardId: string;
	name: string;
	template: BoardTemplate;
}

export interface CheckListItemsOutput {
	updatedCount: number;
}

export interface GetAllBoardsOutput {
	boards: {
		id: string;
		name: string;
		template: BoardTemplate;
		memberCount: number;
		streak: number;
		lastActivityAt: string;
	}[];
}
