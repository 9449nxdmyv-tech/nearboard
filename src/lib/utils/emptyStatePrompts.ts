/**
 * @file emptyStatePrompts.ts
 * @description Template-aware copy for the empty board state.
 *              Maps each BoardTemplate to a contextual icon, title, and prompt
 *              so a quiet board nudges members toward the kind of content that
 *              fits the board's purpose.
 */

import type { BoardTemplate } from '$lib/types';

export interface EmptyBoardPrompt {
	icon: string;
	title: string;
	description: string;
}

const PROMPTS: Record<BoardTemplate, EmptyBoardPrompt> = {
	trip: {
		icon: 'ph:airplane-tilt',
		title: 'Plan something memorable',
		description: 'Save a hotel link, drop a place to eat, or share a packing list to get started.'
	},
	household: {
		icon: 'ph:house',
		title: 'Make this your home base',
		description: 'Pin a chore, drop tonight\'s recipe, or capture a quick voice note for the family.'
	},
	family: {
		icon: 'ph:heart',
		title: 'Capture the everyday',
		description: 'Drop a photo from this week, share a moment, or start a list together.'
	},
	team: {
		icon: 'ph:users-three',
		title: 'Get the team aligned',
		description: 'Drop a doc, capture a decision, or start a poll to move things forward.'
	},
	creative: {
		icon: 'ph:palette',
		title: 'Collect the inspiration',
		description: 'Save a reference image, drop a moodboard link, or jot down ideas as they come.'
	},
	wishlist: {
		icon: 'ph:gift',
		title: 'Start the wishlist',
		description: 'Save a product link — Nearboard tracks price drops automatically.'
	},
	renovation: {
		icon: 'ph:hammer',
		title: 'Plan the build',
		description: 'Save a paint color, capture a measurement, or drop an inspiration photo.'
	},
	blank: {
		icon: 'ph:kanban',
		title: 'This board is empty',
		description: 'Tap + to add notes, links, photos, and more.'
	}
};

export function getEmptyBoardPrompt(template: BoardTemplate | undefined): EmptyBoardPrompt {
	return PROMPTS[template ?? 'blank'] ?? PROMPTS.blank;
}
