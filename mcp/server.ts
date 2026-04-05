/**
 * @file server.ts
 * @description Cloudflare Worker MCP server endpoint. Exposes Nearboard tools
 *              to Claude, ChatGPT, Gemini, and any MCP-compatible AI chatbot.
 * @todos
 *   - HIGH SECURITY: Rotate OAuth tokens every 30 days
 *   - HIGH FEATURE: Register in ChatGPT App Directory after MCP server is live
 *   - HIGH FEATURE: Submit to Claude MCP Apps directory after OAuth is verified
 *   - MED FEATURE: Add Gemini MCP connector when Google releases stable spec
 *   - LOW FEATURE: Build n8n MCP trigger node for automation power users
 */

import { getFirestore } from 'firebase-admin/firestore';
import { validateToken } from './oauth/tokenHandler';
import { getBoardBriefing } from './tools/getBoardBriefing';
import { addBoardItem } from './tools/addBoardItem';
import { listBoardContent } from './tools/listBoardContent';
import { searchBoards } from './tools/searchBoards';
import { createBoard } from './tools/createBoard';
import { checkListItems } from './tools/checkListItems';
import { getAllBoards } from './tools/getAllBoards';

/**
 * Validates that the user is a member of the specified board.
 * Returns true if the user is a member, false otherwise.
 */
async function validateBoardMembership(userId: string, boardId: string): Promise<boolean> {
	const db = getFirestore();
	const boardSnap = await db.doc(`boards/${boardId}`).get();
	if (!boardSnap.exists) return false;
	const memberIds = (boardSnap.data()?.memberIds as string[]) ?? [];
	return memberIds.includes(userId);
}

/** Tools that require a boardId argument and thus need membership validation */
const BOARD_SCOPED_TOOLS = new Set([
	'get_board_briefing', 'add_board_item', 'list_board_content', 'check_list_items'
]);

interface MCPRequest {
	method: string;
	params: {
		name?: string;
		arguments?: Record<string, unknown>;
	};
}

// --- Input validation helpers (lightweight, no external deps) ---

const MAX_STRING_LENGTH = 2000;
const VALID_ITEM_TYPES = new Set(['note', 'list', 'link', 'voice', 'photo', 'video', 'location']);

interface ValidationError { field: string; message: string }

function requireString(args: Record<string, unknown>, field: string, maxLen = MAX_STRING_LENGTH): ValidationError | null {
	const val = args[field];
	if (typeof val !== 'string' || val.trim().length === 0) {
		return { field, message: `${field} must be a non-empty string` };
	}
	if (val.length > maxLen) {
		return { field, message: `${field} must be at most ${maxLen} characters` };
	}
	return null;
}

function optionalString(args: Record<string, unknown>, field: string, maxLen = MAX_STRING_LENGTH): ValidationError | null {
	if (args[field] === undefined || args[field] === null) return null;
	return requireString(args, field, maxLen);
}

function optionalPositiveInt(args: Record<string, unknown>, field: string, max = 100): ValidationError | null {
	if (args[field] === undefined || args[field] === null) return null;
	const val = args[field];
	if (typeof val !== 'number' || !Number.isInteger(val) || val < 1 || val > max) {
		return { field, message: `${field} must be a positive integer (1\u2013${max})` };
	}
	return null;
}

function requireStringArray(args: Record<string, unknown>, field: string, maxItems = 100): ValidationError | null {
	const val = args[field];
	if (!Array.isArray(val) || val.length === 0) {
		return { field, message: `${field} must be a non-empty array of strings` };
	}
	if (val.length > maxItems) {
		return { field, message: `${field} must have at most ${maxItems} items` };
	}
	for (const item of val) {
		if (typeof item !== 'string' || item.trim().length === 0) {
			return { field, message: `Every item in ${field} must be a non-empty string` };
		}
	}
	return null;
}

/** Per-tool validation rules. Returns an array of errors (empty = valid). */
function validateToolInput(toolName: string, args: Record<string, unknown>): ValidationError[] {
	const errors: ValidationError[] = [];
	const push = (e: ValidationError | null) => { if (e) errors.push(e); };

	switch (toolName) {
		case 'get_board_briefing':
			push(requireString(args, 'boardId', 128));
			break;

		case 'add_board_item':
			push(requireString(args, 'boardId', 128));
			push(requireString(args, 'content', MAX_STRING_LENGTH));
			push(optionalString(args, 'caption', 500));
			if (typeof args.type !== 'string' || !VALID_ITEM_TYPES.has(args.type)) {
				errors.push({ field: 'type', message: `type must be one of: ${[...VALID_ITEM_TYPES].join(', ')}` });
			}
			if (args.type === 'location') {
				if (typeof args.latitude !== 'number' || args.latitude < -90 || args.latitude > 90) {
					errors.push({ field: 'latitude', message: 'latitude must be a number between -90 and 90' });
				}
				if (typeof args.longitude !== 'number' || args.longitude < -180 || args.longitude > 180) {
					errors.push({ field: 'longitude', message: 'longitude must be a number between -180 and 180' });
				}
			}
			break;

		case 'list_board_content':
			push(requireString(args, 'boardId', 128));
			push(optionalPositiveInt(args, 'limit', 100));
			break;

		case 'search_boards':
			push(requireString(args, 'query', 500));
			break;

		case 'create_board':
			push(requireString(args, 'name', 200));
			push(optionalString(args, 'template', 200));
			break;

		case 'check_list_items':
			push(requireString(args, 'boardId', 128));
			push(requireString(args, 'contentId', 128));
			push(requireStringArray(args, 'itemIds'));
			break;

		case 'get_all_boards':
			// No arguments needed
			break;
	}

	return errors;
}

const TOOLS = [
	{
		name: 'get_board_briefing',
		description: 'Get the latest AI briefing summary for a specific board',
		inputSchema: { type: 'object', properties: { boardId: { type: 'string' } }, required: ['boardId'] }
	},
	{
		name: 'add_board_item',
		description: 'Add a note, list, link, voice, photo, video, or location to a board',
		inputSchema: {
			type: 'object',
			properties: {
				boardId: { type: 'string' },
				type: { type: 'string', enum: ['note', 'list', 'link', 'voice', 'photo', 'video', 'location'] },
				content: { type: 'string', description: 'Text, URL, or audio URL depending on type' },
				caption: { type: 'string', description: 'Optional caption for photo/video' },
				latitude: { type: 'number', description: 'Latitude for location type' },
				longitude: { type: 'number', description: 'Longitude for location type' }
			},
			required: ['boardId', 'type', 'content']
		}
	},
	{
		name: 'list_board_content',
		description: 'List recent items added to a board',
		inputSchema: { type: 'object', properties: { boardId: { type: 'string' }, limit: { type: 'number' } }, required: ['boardId'] }
	},
	{
		name: 'search_boards',
		description: 'Search across all user boards by topic or keyword',
		inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
	},
	{
		name: 'create_board',
		description: 'Create a new board with a name and optional template',
		inputSchema: { type: 'object', properties: { name: { type: 'string' }, template: { type: 'string' } }, required: ['name'] }
	},
	{
		name: 'check_list_items',
		description: 'Mark one or more list items as complete',
		inputSchema: {
			type: 'object',
			properties: { boardId: { type: 'string' }, contentId: { type: 'string' }, itemIds: { type: 'array', items: { type: 'string' } } },
			required: ['boardId', 'contentId', 'itemIds']
		}
	},
	{
		name: 'get_all_boards',
		description: 'Get a summary of all boards the user belongs to',
		inputSchema: { type: 'object', properties: {} }
	}
];

const toolHandlers: Record<string, (userId: string, args: Record<string, unknown>) => Promise<unknown>> = {
	get_board_briefing: (uid, args) => getBoardBriefing(uid, args.boardId as string),
	add_board_item: (uid, args) => addBoardItem(uid, {
		boardId: args.boardId as string,
		type: args.type as string,
		content: args.content as string,
		caption: args.caption as string | undefined,
		latitude: args.latitude as number | undefined,
		longitude: args.longitude as number | undefined
	}),
	list_board_content: (uid, args) => listBoardContent(uid, args.boardId as string, (args.limit as number) ?? 10),
	search_boards: (uid, args) => searchBoards(uid, args.query as string),
	create_board: async (uid, args) => {
		const db = getFirestore();
		const userSnap = await db.doc(`users/${uid}`).get();
		const userData = userSnap.data();
		return createBoard(
			uid,
			args.name as string,
			(args.template as string) ?? 'blank',
			userData?.displayName || '',
			userData?.photoURL || null
		);
	},
	check_list_items: (uid, args) => checkListItems(uid, args.boardId as string, args.contentId as string, args.itemIds as string[]),
	get_all_boards: (uid) => getAllBoards(uid)
};

export default {
	async fetch(request: Request): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }
			});
		}

		const authHeader = request.headers.get('Authorization');
		const userId = await validateToken(authHeader);
		if (!userId) {
			return Response.json({ error: 'Unauthorized' }, { status: 401 });
		}

		const body = await request.json() as MCPRequest;

		if (body.method === 'tools/list') {
			return Response.json({ tools: TOOLS });
		}

		if (body.method === 'tools/call') {
			const toolName = body.params.name;
			const args = body.params.arguments ?? {};
			const handler = toolName ? toolHandlers[toolName] : undefined;

			if (!handler) {
				return Response.json({ error: `Unknown tool: ${toolName}` }, { status: 400 });
			}

			// Validate input parameters before any Firestore access
			const validationErrors = validateToolInput(toolName!, args);
			if (validationErrors.length > 0) {
				return Response.json(
					{ error: 'Invalid input', details: validationErrors },
					{ status: 400 }
				);
			}

			// Validate board membership for board-scoped tools.
			// NOTE: OAuth tokens are currently user-scoped. Future enhancement: scope
			// OAuth sessions per-board so tokens are only valid for boards the user
			// explicitly granted access to during the OAuth consent flow.
			if (toolName && BOARD_SCOPED_TOOLS.has(toolName)) {
				const boardId = args.boardId as string;
				if (!(await validateBoardMembership(userId, boardId))) {
					return Response.json({ error: 'Access denied: not a member of this board' }, { status: 403 });
				}
			}

			const result = await handler(userId, args);
			return Response.json({ content: [{ type: 'text', text: JSON.stringify(result) }] });
		}

		return Response.json({ error: 'Unknown method' }, { status: 400 });
	}
};
