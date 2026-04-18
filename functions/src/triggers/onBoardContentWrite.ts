/**
 * @file onBoardContentWrite.ts
 * @description Firestore trigger that fires on board content writes.
 *              Handles streak updates and marks boards as dirty for summary regeneration.
 *              The actual AI summary generation is done by the processDirtyBoards scheduled
 *              function — no setTimeout, no AI calls, no TTS in this trigger.
 */

import '../utils/admin.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { notifyBoardMembers } from '../utils/fcmService.js';

export const onBoardContentWrite = onDocumentWritten(
	{ document: 'boards/{boardId}/content/{contentId}' },
	async (event) => {
		const boardId = event.params.boardId;
		const db = getFirestore();

		// Determine change type
		const before = event.data?.before?.data();
		const after = event.data?.after?.data();
		const changeType = !before ? 'created' : !after ? 'deleted' : 'updated';

		const boardRef = db.doc(`boards/${boardId}`);

		// ─── Streak update (only on content creation) — uses transaction to avoid race conditions
		if (changeType === 'created') {
			await db.runTransaction(async (txn) => {
				const boardSnap = await txn.get(boardRef);
				if (!boardSnap.exists) return;
				const board = boardSnap.data() as {
					streak: number;
					lastActivityAt: FirebaseFirestore.Timestamp | null;
					enableLivingSummary?: boolean;
				};

				const now = new Date();
				const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
				const lastActivity = board.lastActivityAt?.toDate();
				const lastDate = lastActivity
					? new Date(lastActivity.getFullYear(), lastActivity.getMonth(), lastActivity.getDate())
					: null;

				let newStreak = board.streak || 0;
				if (!lastDate || lastDate.getTime() < todayStart.getTime() - 24 * 60 * 60 * 1000) {
					newStreak = 1;
				} else if (lastDate.getTime() < todayStart.getTime()) {
					newStreak += 1;
				}

				const updates: Record<string, unknown> = {
					streak: newStreak,
					lastActivityAt: FieldValue.serverTimestamp(),
					contentCount: FieldValue.increment(1)
				};

				const summaryEnabled = board.enableLivingSummary ?? true;
				if (summaryEnabled) {
					updates.summaryDirty = true;
					// Backfill: processDirtyBoards filters `where enableLivingSummary == true`,
					// which excludes boards where the field is undefined (pre-Living-Summary boards).
					// Set it explicitly so the scheduled job can see them.
					if (board.enableLivingSummary === undefined) {
						updates.enableLivingSummary = true;
					}
				}

				txn.update(boardRef, updates);
			});

			// ─── Global content cache (links + products only) ────────────
			if (after) {
				const contentType = after.type as string;
				if ((contentType === 'link' || contentType === 'product') && after.url) {
					try {
						const { upsertGlobalContent } = await import('../utils/globalContentService.js');
						const result = await upsertGlobalContent(
							boardId,
							event.params.contentId,
							after as import('../utils/globalContentService.js').CacheableContent
						);
						if (result.isStale) {
							console.info(`Global content stale: ${result.contentHash}`);
						}
					} catch (err) {
						console.error('Global content cache error:', err);
					}
				}
			}
		} else if (changeType === 'updated' && before && after) {
			// ─── Acknowledgment notification (detect new hearts) ────────────
			const prevAcks = (before.acknowledgments ?? {}) as Record<string, unknown>;
			const currAcks = (after.acknowledgments ?? {}) as Record<string, unknown>;
			const newAckUserIds = Object.keys(currAcks).filter((uid) => !(uid in prevAcks));

			if (newAckUserIds.length > 0) {
				const contentAuthorId = after.authorId as string | undefined;
				// Notify content author about new hearts (skip if they hearted their own post)
				if (contentAuthorId && !newAckUserIds.includes(contentAuthorId)) {
					// Get the name of the person who hearted
					try {
						const ackerUid = newAckUserIds[0];
						const ackerSnap = await db.doc(`users/${ackerUid}`).get();
						const ackerName = (ackerSnap.data()?.displayName as string) || 'Someone';
						const suffix = newAckUserIds.length > 1
							? ` and ${newAckUserIds.length - 1} other${newAckUserIds.length > 2 ? 's' : ''}`
							: '';
						await notifyBoardMembers(
							boardId,
							[contentAuthorId],
							'New reaction',
							`${ackerName}${suffix} liked your post`
						);
					} catch (err) {
						console.error('Acknowledgment notification failed:', err);
					}
				}
			}
		} else if (changeType === 'deleted') {
			// ─── Decrement content count + mark board dirty for summary regeneration on delete
			const updates: Record<string, unknown> = {
				contentCount: FieldValue.increment(-1)
			};
			const boardSnap = await boardRef.get();
			if (!boardSnap.exists) return;
			const board = boardSnap.data()!;
			const summaryEnabled = (board.enableLivingSummary ?? true) as boolean;
			if (summaryEnabled) {
				updates.summaryDirty = true;
				if (board.enableLivingSummary === undefined) {
					updates.enableLivingSummary = true;
				}
			}
			await boardRef.update(updates);
		}
	}
);

// ─── Shared utilities for summary generation ─────────────────────────────────
// Used by processDirtyBoards and updateBoardSummary.

/** Template-specific focus areas for Living Summary generation. */
export const TEMPLATE_FOCUS: Record<string, string> = {
	'trip': `Focus on: itinerary status, what's booked vs still missing, key dates and destinations, packing notes, budget if mentioned.`,
	'household': `Focus on: pending tasks and chores, recent purchases or expenses, shared decisions, recurring items, anything that needs attention soon.`,
	'family': `Focus on: recent moments and memories, upcoming events, shared links or media highlights, who contributed what.`,
	'team': `Focus on: project status and progress, blockers and open questions, action items and owners, key decisions made, deadlines.`,
	'creative': `Focus on: themes and inspiration emerging, progress on pieces or projects, reference materials collected, creative direction.`,
	'wishlist': `Focus on: items saved and their prices, any price drops or deals, priority items, categories of interest.`,
	'renovation': `Focus on: project phases and progress, budget tracking, materials and products saved, contractor notes, before/after comparisons, timeline.`,
	'blank': `Focus on: key themes across the content, important items and decisions, what's actionable, overall status.`
};

interface ListItemData {
	text: string;
	checked: boolean;
}

interface PollOptionData {
	text: string;
	votes?: number;
}

/**
 * Truncate long free-text at a sentence boundary when possible.
 * Prefers ending on ., !, or ? within the 200–300 char window so AI context
 * reads as a complete thought rather than a mid-sentence hard cut.
 */
function smartTruncate(text: string, maxLen = 300): string {
	if (!text) return '';
	if (text.length <= maxLen) return text;
	const window = text.slice(0, maxLen);
	// Last sentence-ending punctuation followed by whitespace (inside window)
	const match = window.match(/^[\s\S]*[.!?](?=\s)/);
	if (match && match[0].length >= 200) return match[0].trimEnd() + ' …';
	// Fall back to hard cut
	return window.trimEnd() + '…';
}

/**
 * Serializes a content document into a rich text representation for the AI prompt.
 */
export function serializeContent(data: Record<string, unknown>): string {
	const cleanText = (text: string) => smartTruncate(text || '', 300);
	const author = (data.authorName as string) || '';
	const authorTag = author ? ` (by ${author})` : '';

	switch (data.type as string) {
		case 'note':
			return `[Note]${authorTag} ${cleanText(data.text as string)}`;
		case 'list': {
			const items = (data.items as ListItemData[]) || [];
			const checked = items.filter((i) => i.checked).length;
			const total = items.length;
			const progress = total > 0 ? ` (${checked}/${total} done)` : '';
			const remaining = total > 20 ? ` (+${total - 20} more)` : '';
			const itemTexts = items.slice(0, 20).map((i) => `${i.checked ? '[x]' : '[ ]'} ${cleanText(i.text)}`).join(', ');
			return `[List]${authorTag} ${data.title}${progress}: ${itemTexts}${remaining}`;
		}
		case 'link': {
			const desc = data.description ? ` — ${cleanText(data.description as string)}` : '';
			const enrichKind = (data.enrichment as Record<string, unknown>)?.kind;
			const tag = enrichKind ? String(enrichKind).charAt(0).toUpperCase() + String(enrichKind).slice(1) : 'Link';
			return `[${tag}]${authorTag} ${data.title} (${data.domain})${desc}`;
		}
		case 'product': {
			const priceInfo = data.price ? ` ${data.price}` : '';
			const drop = data.priceDrop ? ' [PRICE DROPPED]' : '';
			return `[Product]${authorTag} ${data.title}${priceInfo}${drop} (${data.domain})`;
		}
		case 'poll': {
			const options = (data.options as PollOptionData[]) || [];
			const totalVotes = options.reduce((sum, o) => sum + (o.votes || 0), 0);
			const optionTexts = options.map((o) => `"${o.text}": ${o.votes || 0} votes`).join(', ');
			return `[Poll]${authorTag} ${data.question || data.title} (${totalVotes} total votes: ${optionTexts})`;
		}
		case 'photo': {
			const count = (data.images as string[])?.length || 1;
			const caption = data.caption ? ` — "${cleanText(data.caption as string)}"` : '';
			return `[Photo${count > 1 ? ` x${count}` : ''}]${authorTag}${caption}`;
		}
		case 'video': {
			const caption = data.caption ? ` — "${cleanText(data.caption as string)}"` : '';
			return `[Video]${authorTag}${caption}`;
		}
		case 'voice': {
			const transcript = data.transcript ? ` — "${cleanText(data.transcript as string)}"` : '';
			return `[Voice note]${authorTag}${transcript}`;
		}
		case 'location': {
			const name = data.locationName || data.title || 'a location';
			return `[Location]${authorTag} ${name}`;
		}
		default:
			return `[${data.type}]${authorTag} ${data.title || ''}`;
	}
}

/**
 * Regenerates the board's Living Summary based on recent content.
 * Single AI call produces: headline, highlights, summary, and briefingText.
 * Sends push notification with the briefingText (no TTS — audio is on-demand only).
 */
/** Minimum time between summary regenerations per board (15 minutes). */
const SUMMARY_COOLDOWN_MS = 15 * 60 * 1000;

/** Shorter cooldown for manual regeneration requests (60 seconds). */
const MANUAL_REGEN_COOLDOWN_MS = 60 * 1000;

/** Simple hash function for caching AI responses */
function hashContent(items: string[]): string {
	const crypto = require('crypto');
	return crypto.createHash('sha256').update(items.join('|||')).digest('hex').slice(0, 16);
}

/**
 * Gets cached summary or generates new one.
 * Cache stored in board doc under livingSummary.cacheKey.
 */
async function getCachedSummary(
	boardRef: FirebaseFirestore.DocumentReference,
	contentHash: string
): Promise<{ content: string; headline: string; highlights: string[]; briefingText: string } | null> {
	const boardSnap = await boardRef.get();
	if (!boardSnap.exists) return null;
	
	const board = boardSnap.data()!;
	const cachedKey = board.livingSummary?.cacheKey;
	
	if (cachedKey === contentHash && board.livingSummary?.content) {
		return {
			content: board.livingSummary.content,
			headline: board.livingSummary.headline || '',
			highlights: board.livingSummary.highlights || [],
			briefingText: board.livingSummary.briefingText || ''
		};
	}
	
	return null;
}

export async function updateBoardSummary(
	boardId: string,
	boardName: string,
	template: string,
	db: FirebaseFirestore.Firestore,
	memberIds?: string[],
	/** Bypass cooldown for manual regeneration requests. */
	bypassCooldown = false
): Promise<void> {
	const boardRef = db.doc(`boards/${boardId}`);
	const boardSnap = await boardRef.get();
	if (!boardSnap.exists) return;
	const board = boardSnap.data()!;

	const lastSummaryAt = board.livingSummary?.updatedAt?.toMillis() ?? 0;
	const cooldownMs = bypassCooldown ? MANUAL_REGEN_COOLDOWN_MS : SUMMARY_COOLDOWN_MS;

	// ─── Cooldown: skip if last summary was generated recently ────────────
	// processDirtyBoards clears summaryDirty before calling us (atomic claim),
	// so we must re-set it here — otherwise the board stays stuck until the
	// next content write.
	if (!bypassCooldown && Date.now() - lastSummaryAt < cooldownMs) {
		await boardRef.update({ summaryDirty: true }).catch(() => {});
		return;
	}

	// ─── Fetch full board context (most recent 50 items) ──────────────────
	// Regardless of when the last summary ran, always send the AI a snapshot
	// of the current board so it can merge/reconcile with the previous summary.
	// The cache key (below) ensures we skip the AI call when nothing changed.
	const contentCol = db.collection(`boards/${boardId}/content`);
	const contentSnap = await contentCol.orderBy('createdAt', 'desc').limit(50).get();

	const items: string[] = [];
	for (const doc of contentSnap.docs) {
		items.push(serializeContent(doc.data()));
	}

	// ─── Skip AI for tiny boards ──────────────────────────────────────────
	// Onboarding boards are seeded with a few items but don't yet reflect the
	// user's real intent — wait until they've added more before summarizing.
	const isOnboarding = board.isOnboarding === true;
	const minItemsForAI = isOnboarding ? 5 : 3;
	if (items.length < minItemsForAI) {
		await boardRef.update({ summaryDirty: false });
		return;
	}

	// ─── Cache check ──────────────────────────────────────────────────────
	// Hash the serialized items; if identical to last run, skip the AI call
	// and just touch updatedAt so the cooldown resets.
	const contentHash = hashContent(items);
	const cached = await getCachedSummary(boardRef, contentHash);
	if (cached) {
		console.log(`Using cached summary for board ${boardId}`);
		await boardRef.update({
			summaryDirty: false,
			livingSummary: {
				...board.livingSummary,
				updatedAt: FieldValue.serverTimestamp()
			}
		});
		return;
	}

	// Dynamic import to avoid loading AI SDK in the trigger cold start
	const { generateText } = await import('../utils/aiService.js');

	const prevSummary = board.livingSummary?.content ?? '(no previous summary)';
	const version = (board.livingSummary?.version ?? 0) + 1;
	const style = (board['summaryStyle'] as string) || 'paragraph';
	const templateFocus = TEMPLATE_FOCUS[template] || TEMPLATE_FOCUS['blank'];
	const userFocus = (board['summaryFocus'] as string)?.trim() || '';

	// ─── Style-specific SUMMARY formatting ────────────────────────────────
	// Each style produces visibly distinct output. The structural parser
	// (HEADLINE / HIGHLIGHTS / SUMMARY / BRIEFING) stays the same — only the
	// SUMMARY body shape changes.
	const styleFormats: Record<string, string> = {
		'paragraph':
			`Write 2–3 short paragraphs of flowing prose. No bullets, no checkboxes, no headings. ` +
			`Connect ideas with complete sentences. Example shape:\n` +
			`  The team locked in the venue for March 14. Catering is still open — two quotes in, waiting on the third.\n\n` +
			`  Attendee list grew to 42; Sarah added six more names from the partner team.`,
		'bullets':
			`Write a flat bulleted list. Every line MUST start with "- " (dash + space). ` +
			`No paragraphs, no checkboxes, no sub-bullets. Group related facts when possible. ` +
			`Example shape:\n` +
			`  - Venue confirmed for March 14\n` +
			`  - Catering: 2 quotes received, waiting on third\n` +
			`  - 42 attendees, +6 from partner team`,
		'action-items':
			`Write a checklist of tasks. Every line MUST start with "[ ] " for pending or "[x] " for done. ` +
			`Focus on what still needs to happen, not on narrative. No paragraphs, no plain bullets. ` +
			`Example shape:\n` +
			`  [x] Venue confirmed for March 14\n` +
			`  [ ] Pick caterer from 3 quotes\n` +
			`  [ ] Finalize attendee list (currently 42)`
	};
	const styleFormat = styleFormats[style] ?? styleFormats['paragraph'];

	const prompt = `You are summarizing the board "${boardName}" (a ${template} board).

Previous summary (for continuity — merge and refine, don't start from scratch):
${prevSummary}

Current board content (${items.length} most recent items):
${items.join('\n')}

${templateFocus}${userFocus ? `\n\nThe board owner specifically asked the summary to: ${userFocus}` : ''}

Respond in EXACTLY this format (keep each section on its own line):

HEADLINE: (one short sentence under 80 chars — the single most useful insight or status update for someone glancing at this board)
HIGHLIGHTS:
- (what's new bullet 1)
- (what's new bullet 2)
- (what's new bullet 3, optional — only if there's a third notable change)
SUMMARY:
(the full updated summary below, formatted per the style rules)
BRIEFING: (a warm, conversational 2-sentence notification message, max 40 words, using first names if available — like a helpful friend telling someone what's new)

Rules for the SUMMARY section (STYLE = ${style}):
${styleFormat}
- Do NOT use markdown formatting. No **bold**, no *italic*, no ## headers, no backticks. Write plain text only.
- Refine the previous summary using the current content; don't just append.

Rules for HEADLINE:
- Must be a single line, under 80 characters.
- Should be specific and actionable, not generic (e.g., "Hotel still missing for Day 3" not "Trip planning in progress").

Rules for HIGHLIGHTS:
- 2-3 short bullets about what changed since the last summary.
- Each bullet starts with "- " and is one line.
- Be specific: mention names, counts, or items.

Rules for BRIEFING:
- Exactly 2 sentences, max 40 words total.
- Warm, conversational tone — like a helpful friend, not a robot.
- Use first names. If it's a product, mention the name and price.
- Must be on a single line after "BRIEFING: ".`;

	const raw = await generateText(prompt, 350);
	if (!raw) {
		// Groq call failed or returned empty — re-queue so the next cycle retries.
		// Without this, summaryDirty stays false (cleared by processDirtyBoards)
		// and the summary is permanently stuck on "Generating summary…".
		console.error(`AI returned empty response for board ${boardId} — re-queuing`);
		await boardRef.update({ summaryDirty: true }).catch(() => {});
		return;
	}

	// Parse structured response
	const headlineMatch = raw.match(/^HEADLINE:\s*(.+)$/m);
	const headline = headlineMatch?.[1]?.trim().slice(0, 80) || '';

	const highlightsMatch = raw.match(/HIGHLIGHTS:\n([\s\S]*?)(?=\nSUMMARY:)/);
	const highlights = highlightsMatch?.[1]
		?.split('\n')
		.map(l => l.replace(/^-\s*/, '').trim())
		.filter(l => l.length > 0)
		.slice(0, 3) || [];

	const summaryMatch = raw.match(/SUMMARY:\n([\s\S]*?)(?=\nBRIEFING:)/);
	const newContent = summaryMatch?.[1]?.trim() || raw.trim();

	const briefingMatch = raw.match(/^BRIEFING:\s*(.+)$/m);
	const briefingText = briefingMatch?.[1]?.trim() || '';

	// Atomic update: summary + clear dirty flag + cache key
	await boardRef.update({
		livingSummary: {
			content: newContent,
			headline,
			highlights,
			briefingText,
			version,
			updatedAt: FieldValue.serverTimestamp(),
			editedByAdmin: false,
			cacheKey: contentHash  // Store hash for cache lookup
		},
		summaryDirty: false
	});

	// Briefing docs are created only by morningDigest (with TTS audio).
	// No briefing doc here — avoids unbounded subcollection growth.

	// Send push notification (skip for solo boards)
	if (briefingText && memberIds && memberIds.length > 1) {
		const { notifyBoardMembers } = await import('../utils/fcmService.js');
		await notifyBoardMembers(boardId, memberIds, boardName, briefingText);
	}
}
