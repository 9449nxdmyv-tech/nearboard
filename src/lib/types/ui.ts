/**
 * @file ui.ts
 * @description Typed prop interfaces for all Svelte components.
 *              Every component must accept only typed props from this file.
 */

import type { Timestamp } from 'firebase/firestore';
import type { ListItem, PhotoImage } from './firestore';

// ─── Card prop interfaces ─────────────────────────────────────────────────────

export interface BaseCardProps {
	id: string;
	boardId: string;
	authorId: string;
	authorName: string;
	authorPhotoURL: string | null;
	createdAt: Date | Timestamp;
	isBoardOwner?: boolean;
	allowComments?: boolean;
	onShare?: () => void;
}

export interface NoteCardProps extends BaseCardProps {
	text: string;
}

export interface ListCardProps extends BaseCardProps {
	title: string;
	items: ListItem[];
	onToggleItem: (itemId: string) => void;
}

export interface VoiceCardProps extends BaseCardProps {
	audioUrl: string;
	durationMs: number;
}

export interface PhotoCardProps extends BaseCardProps {
	imageUrl: string;
	images: PhotoImage[];
	caption: string | null;
	width: number;
	height: number;
}

export interface VideoCardProps extends BaseCardProps {
	videoUrl: string;
	thumbnailUrl: string | null;
	durationMs: number;
	caption: string | null;
}

export interface LocationCardProps extends BaseCardProps {
	latitude: number;
	longitude: number;
	address: string;
	name: string | null;
}

export interface LinkCardProps extends BaseCardProps {
	url: string;
	title: string;
	description: string | null;
	image: string | null;
	domain: string;
	favicon: string | null;
	enrichment?: import('./api').LinkEnrichment | null;
}

export interface ProductCardProps extends BaseCardProps {
	url: string;
	title: string;
	image: string | null;
	price: string;
	domain: string;
	originalPrice: string | null;
	lastCheckedPrice: string | null;
	lastCheckedAt: Date | Timestamp | null;
	priceDrop: boolean;
}

export interface PollCardProps extends BaseCardProps {
	question: string;
	options: Array<{ id: string; text: string; votes: number }>;
	totalVotes: number;
	userVote?: string | null;
	onVote?: (optionId: string) => void;
}

// ─── FAB ─────────────────────────────────────────────────────────────────────

export type FABMenuItemType = 'note' | 'voice' | 'photo' | 'video' | 'link' | 'list' | 'location' | 'poll';

// ─── Navigation ───────────────────────────────────────────────────────────────

export interface NavItem {
	href: string;
	label: string;
	icon: string;
}
