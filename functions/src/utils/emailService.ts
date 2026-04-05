/**
 * @file emailService.ts
 * @description Email transport service using Postmark for transactional emails.
 *              Used by the daily email digest Cloud Function.
 */

import { ServerClient } from 'postmark';

let _client: ServerClient | null = null;

function getClient(): ServerClient {
	if (!_client) {
		const token = process.env.POSTMARK_SERVER_TOKEN;
		if (!token) throw new Error('POSTMARK_SERVER_TOKEN secret is not set');
		_client = new ServerClient(token);
	}
	return _client;
}

/** Type icon mapping for content types used in digest emails. */
const CONTENT_TYPE_ICONS: Record<string, string> = {
	note: '\u{1F4DD}',
	list: '\u{2705}',
	link: '\u{1F517}',
	product: '\u{1F6D2}',
	voice: '\u{1F3A4}',
	photo: '\u{1F4F7}',
	video: '\u{1F3AC}',
	location: '\u{1F4CD}',
	poll: '\u{1F4CA}'
};

export interface DigestBoardSection {
	boardId: string;
	boardName: string;
	/** Individual cards shown when count is 1–3. */
	cards: Array<{
		title: string;
		type: string;
		authorName: string;
	}>;
	/** Total new cards (used for 4+ collapse). */
	totalNewCards: number;
}

export interface DigestEmailData {
	toEmail: string;
	userName: string;
	boards: DigestBoardSection[];
	aiInsight: string;
	unsubscribeUrl: string;
	appBaseUrl: string;
	/** Quiet boards (7+ days inactive) for ambient signals (Lever 5) */
	quietBoards?: Array<{ name: string; daysQuiet: number }>;
}

/**
 * Renders a digest email as HTML and sends it via Postmark.
 */
export async function sendDigestEmail(data: DigestEmailData): Promise<void> {
	const html = renderDigestHtml(data);
	const textBody = renderDigestText(data);

	await getClient().sendEmail({
		From: 'digest@nearboard.app',
		To: data.toEmail,
		Subject: `Your Nearboard digest — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
		HtmlBody: html,
		TextBody: textBody,
		MessageStream: 'outbound',
		Headers: [
			{ Name: 'List-Unsubscribe', Value: `<${data.unsubscribeUrl}>` },
			{ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }
		]
	});
}

function renderDigestHtml(data: DigestEmailData): string {
	const boardSections = data.boards.map((board) => {
		const boardUrl = `${data.appBaseUrl}/b/${board.boardId}`;

		if (board.totalNewCards >= 4) {
			return `
				<div style="margin-bottom:20px;padding:16px;background:#f8f9fa;border-radius:12px;">
					<h3 style="margin:0 0 8px;font-size:15px;color:#1a1a1a;">${escapeHtml(board.boardName)}</h3>
					<p style="margin:0 0 12px;font-size:14px;color:#555;">
						${board.totalNewCards} new cards added
					</p>
					<a href="${boardUrl}" style="display:inline-block;padding:8px 16px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:500;">
						Open Board &rarr;
					</a>
				</div>`;
		}

		const cardRows = board.cards.map((card) => {
			const icon = CONTENT_TYPE_ICONS[card.type] || '\u{1F4CB}';
			return `
				<div style="padding:8px 0;border-bottom:1px solid #eee;">
					<span style="font-size:14px;">${icon}</span>
					<span style="font-size:14px;color:#1a1a1a;margin-left:6px;">${escapeHtml(card.title)}</span>
					<span style="font-size:12px;color:#888;margin-left:8px;">by ${escapeHtml(card.authorName)}</span>
				</div>`;
		}).join('');

		return `
			<div style="margin-bottom:20px;padding:16px;background:#f8f9fa;border-radius:12px;">
				<h3 style="margin:0 0 12px;font-size:15px;color:#1a1a1a;">
					<a href="${boardUrl}" style="color:#6366f1;text-decoration:none;">${escapeHtml(board.boardName)}</a>
				</h3>
				${cardRows}
			</div>`;
	}).join('');

	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f0f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
	<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
		<div style="background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
			<h2 style="margin:0 0 4px;font-size:18px;color:#1a1a1a;">Good morning, ${escapeHtml(data.userName)} \u{1F44B}</h2>
			<p style="margin:0 0 20px;font-size:13px;color:#888;">Here's what happened on your boards.</p>

			${boardSections}

			${data.aiInsight ? `
			<div style="margin-top:20px;padding:14px;background:#eef2ff;border-radius:10px;border-left:3px solid #6366f1;">
				<p style="margin:0;font-size:13px;color:#4338ca;line-height:1.5;">${escapeHtml(data.aiInsight)}</p>
			</div>` : ''}

			${data.quietBoards && data.quietBoards.length > 0 ? `
			<div style="margin-top:20px;padding:14px;background:#fef3c7;border-radius:10px;border-left:3px solid #f59e0b;">
				<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#92400e;">Quiet Boards</p>
				<p style="margin:0;font-size:13px;color:#78350f;line-height:1.5;">
				 ${data.quietBoards.map((q) => `${escapeHtml(q.name)} (${q.daysQuiet} days quiet)`).join(', ')}
				</p>
			</div>` : ''}
		</div>

		<div style="text-align:center;padding:16px 0;">
			<a href="${data.appBaseUrl}" style="font-size:13px;color:#6366f1;text-decoration:none;font-weight:500;">Open Nearboard</a>
			<span style="color:#ccc;margin:0 8px;">|</span>
			<a href="${data.unsubscribeUrl}" style="font-size:13px;color:#888;text-decoration:none;">Unsubscribe</a>
		</div>
	</div>
</body>
</html>`;
}

function renderDigestText(data: DigestEmailData): string {
	const lines = [`Good morning, ${data.userName}!\n`, 'Here\'s what happened on your boards:\n'];

	for (const board of data.boards) {
		lines.push(`\n--- ${board.boardName} ---`);
		if (board.totalNewCards >= 4) {
			lines.push(`${board.totalNewCards} new cards added`);
			lines.push(`Open: ${data.appBaseUrl}/b/${board.boardId}`);
		} else {
			for (const card of board.cards) {
				const icon = CONTENT_TYPE_ICONS[card.type] || '';
				lines.push(`${icon} ${card.title} (by ${card.authorName})`);
			}
		}
	}

	if (data.aiInsight) {
		lines.push(`\n--- Insight ---\n${data.aiInsight}`);
	}

	lines.push(`\nOpen Nearboard: ${data.appBaseUrl}`);
	lines.push(`Unsubscribe: ${data.unsubscribeUrl}`);

	return lines.join('\n');
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
