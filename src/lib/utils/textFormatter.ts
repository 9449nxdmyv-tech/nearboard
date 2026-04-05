/**
 * @file textFormatter.ts
 * @description Shared text formatting utilities for AI-generated content.
 *              Two modes: stripMarkdown (plain text) and renderInline (safe HTML).
 *              All HTML output is sanitized with DOMPurify to prevent XSS.
 */

import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = ['strong', 'em', 'code', 'a'];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'class'];

function sanitize(html: string): string {
	return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

/**
 * Strip ALL markdown formatting to plain text.
 * Handles: headers, bold, italic, code, links, bullets, checkboxes, stray markers.
 */
export function stripMarkdown(text: string): string {
	return text
		// Remove header markers: ## Header → Header
		.replace(/^#{1,6}\s+/gm, '')
		// Remove horizontal rules: --- or ***
		.replace(/^[-*_]{3,}\s*$/gm, '')
		// Remove bullet prefixes: - item, * item, • item, 1. item, 2) item
		.replace(/^[\s]*[-•*]\s+/gm, '')
		.replace(/^[\s]*\d+[.)]\s+/gm, '')
		// Remove checkbox markers: [ ] [x] [X] [✓]
		.replace(/\[([xX✓]?)\]\s*/g, '')
		// Remove bold+italic: ***text*** or ___text___
		.replace(/\*{3}(.+?)\*{3}/g, '$1')
		.replace(/_{3}(.+?)_{3}/g, '$1')
		// Remove bold: **text** or __text__
		.replace(/\*{2}(.+?)\*{2}/g, '$1')
		.replace(/_{2}(.+?)_{2}/g, '$1')
		// Remove italic: *text* or _text_
		.replace(/\*([^*\n]+?)\*/g, '$1')
		.replace(/\b_([^_\n]+?)_\b/g, '$1')
		// Remove inline code backticks: `code`
		.replace(/`([^`]+)`/g, '$1')
		// Remove markdown links: [text](url) → text
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		// Clean up any remaining stray * or ** at start/end of lines
		.replace(/^\*{1,3}\s*/gm, '')
		.replace(/\s*\*{1,3}$/gm, '')
		// Clean up stray __ at start/end of lines
		.replace(/^_{1,3}\s*/gm, '')
		.replace(/\s*_{1,3}$/gm, '')
		// Collapse multiple blank lines into one
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Convert a plain-text summary into a single clean preview line.
 * Strips all formatting, bullets, and truncates.
 */
/** Extract the first character of a name as an uppercase initial, with fallback. */
export function avatarInitial(name: string | null | undefined): string {
	return (name || '?').charAt(0).toUpperCase();
}

export function summaryPreview(text: string, maxLen = 120): string {
	// Strip markdown while pairs are intact
	const cleaned = stripMarkdown(text);
	// Take first non-empty line, collapse whitespace
	const firstLine = cleaned.split('\n').find(l => l.trim().length > 0) ?? '';
	const flat = firstLine.replace(/\s+/g, ' ').trim();
	return flat.length > maxLen ? flat.slice(0, maxLen) + '…' : flat;
}

// ─── HTML rendering (for rich summary cards) ──────────────────────────

/** Escape HTML entities to prevent XSS */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Convert inline markdown to safe HTML.
 * Escapes HTML first, then converts bold, italic, code, and links.
 * Use with {@html} in Svelte templates.
 */
export function renderInline(text: string): string {
	let html = escapeHtml(text);
	// Bold+italic: ***text***
	html = html.replace(/\*{3}(.+?)\*{3}/g, '<strong><em>$1</em></strong>');
	html = html.replace(/_{3}(.+?)_{3}/g, '<strong><em>$1</em></strong>');
	// Bold: **text**
	html = html.replace(/\*{2}(.+?)\*{2}/g, '<strong>$1</strong>');
	html = html.replace(/_{2}(.+?)_{2}/g, '<strong>$1</strong>');
	// Italic: *text*
	html = html.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
	html = html.replace(/\b_([^_\n]+?)_\b/g, '<em>$1</em>');
	// Inline code
	html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
	// Links: [text](url)
	html = html.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		'<a href="$2" target="_blank" rel="noopener" class="text-accent underline underline-offset-2">$1</a>'
	);
	// Clean stray markers that weren't paired
	html = html.replace(/\*{1,3}/g, '');
	return sanitize(html);
}

/**
 * Render a full summary block as safe HTML paragraphs.
 * Strips bullet/heading prefixes and converts inline markdown.
 * Returns HTML string for use with {@html}.
 */
export function renderSummaryHtml(text: string): string {
	const lines = text.split('\n').filter(l => l.trim().length > 0);
	const htmlParts: string[] = [];

	for (const line of lines) {
		let trimmed = line.trim();
		// Strip header markers
		trimmed = trimmed.replace(/^#{1,6}\s+/, '');
		// Strip bullet/number prefixes
		trimmed = trimmed.replace(/^[-•*]\s+/, '');
		trimmed = trimmed.replace(/^\d+[.)]\s+/, '');
		// Strip checkbox markers
		trimmed = trimmed.replace(/^\[([xX✓]?)\]\s*/, '');

		if (!trimmed) continue;
		htmlParts.push(renderInline(trimmed));
	}

	return sanitize(htmlParts.join(' '));
}
