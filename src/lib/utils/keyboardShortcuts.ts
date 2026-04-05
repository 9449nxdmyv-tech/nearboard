/**
 * @file keyboardShortcuts.ts
 * @description Global keyboard shortcuts for power users.
 *              Inspired by Linear, Notion, and Gmail.
 * 
 * Shortcuts:
 * - g h: Go to Home (board list)
 * - g f: Go to Feed
 * - g t: Go to Today
 * - g p: Go to People
 * - / : Focus search (future)
 * - n : New note (future)
 * - Esc: Close modals/sheets
 * - ?: Show keyboard shortcuts help
 */

import { goto } from '$app/navigation';
import { page } from '$app/stores';

interface Shortcut {
	keys: string[];
	description: string;
	handler: () => void;
	category: 'navigation' | 'actions' | 'general';
}

let shortcuts: Shortcut[] = [];

export function initKeyboardShortcuts() {
	if (typeof window === 'undefined') return () => {};

	// Define shortcuts
	shortcuts = [
		// Navigation
		{
			keys: ['g', 'h'],
			description: 'Go to Home',
			handler: () => goto('/'),
			category: 'navigation'
		},
		{
			keys: ['g', 'f'],
			description: 'Go to Feed',
			handler: () => goto('/feed'),
			category: 'navigation'
		},
		{
			keys: ['g', 't'],
			description: 'Go to Today',
			handler: () => goto('/today'),
			category: 'navigation'
		},
		{
			keys: ['g', 'p'],
			description: 'Go to People',
			handler: () => goto('/people'),
			category: 'navigation'
		},
		{
			keys: ['g', 'b'],
			description: 'Go to Boards',
			handler: () => goto('/'),
			category: 'navigation'
		},
		// Actions (future)
		{
			keys: ['/'],
			description: 'Search',
			handler: () => {
				// Future: open search modal
				console.log('Search triggered');
			},
			category: 'actions'
		},
		{
			keys: ['n'],
			description: 'New note',
			handler: () => {
				// Future: open quick capture with note type
				console.log('New note triggered');
			},
			category: 'actions'
		},
		// General
		{
			keys: ['?'],
			description: 'Show shortcuts',
			handler: showShortcutsHelp,
			category: 'general'
		}
	];

	let sequence: string[] = [];
	let sequenceTimeout: ReturnType<typeof setTimeout> | null = null;

	function handleKeydown(e: KeyboardEvent) {
		// Ignore when typing in inputs
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, [contenteditable="true"], [role="textbox"]')) {
			return;
		}

		// Handle Escape globally
		if (e.key === 'Escape') {
			// Close any open modals/sheets
			document.dispatchEvent(new CustomEvent('keyboard-escape'));
			return;
		}

		const key = e.key.toLowerCase();

		// Check for sequence shortcuts (g + key)
		const sequenceShortcut = shortcuts.find(s => {
			if (s.keys.length !== 2) return false;
			
			if (sequence.length === 0 && key === s.keys[0]) {
				sequence.push(key);
				startSequenceTimeout();
				return false;
			}
			
			if (sequence.length === 1 && sequence[0] === s.keys[0] && key === s.keys[1]) {
				sequence = [];
				if (sequenceTimeout) {
					clearTimeout(sequenceTimeout);
					sequenceTimeout = null;
				}
				return true;
			}
			
			return false;
		});

		if (sequenceShortcut) {
			e.preventDefault();
			sequenceShortcut.handler();
			return;
		}

		// Check for single-key shortcuts
		const singleShortcut = shortcuts.find(s => 
			s.keys.length === 1 && s.keys[0] === key
		);

		if (singleShortcut) {
			e.preventDefault();
			singleShortcut.handler();
		}
	}

	function startSequenceTimeout() {
		if (sequenceTimeout) {
			clearTimeout(sequenceTimeout);
		}
		sequenceTimeout = setTimeout(() => {
			sequence = [];
			sequenceTimeout = null;
		}, 1000);
	}

	function showShortcutsHelp() {
		// Dispatch event for shortcuts modal
		document.dispatchEvent(new CustomEvent('show-shortcuts-help'));
	}

	// Add listener
	document.addEventListener('keydown', handleKeydown);

	return () => {
		document.removeEventListener('keydown', handleKeydown);
	};
}

export function getShortcutsByCategory(): Record<string, Shortcut[]> {
	return shortcuts.reduce((acc, shortcut) => {
		if (!acc[shortcut.category]) {
			acc[shortcut.category] = [];
		}
		acc[shortcut.category].push(shortcut);
		return acc;
	}, {} as Record<string, Shortcut[]>);
}

export function formatShortcut(keys: string[]): string {
	return keys.map(k => k === ' ' ? 'Space' : k.toUpperCase()).join(' + ');
}
