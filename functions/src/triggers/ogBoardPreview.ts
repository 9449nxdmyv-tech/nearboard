/**
 * @file ogBoardPreview.ts
 * @description HTTPS Cloud Function that generates a dynamic OG preview image
 *              for shared board links. Returns an SVG image showing the board name,
 *              item count, member count, and a visual grid of content type icons.
 *
 * Usage: https://<region>-<project>.cloudfunctions.net/ogBoardPreview?boardId=xxx
 * Set as og:image in the public board page's meta tags.
 */

import '../utils/admin.js';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';

const CONTENT_TYPE_ICONS: Record<string, { emoji: string; color: string }> = {
	note: { emoji: '📝', color: '#6366f1' },
	link: { emoji: '🔗', color: '#0ea5e9' },
	photo: { emoji: '📷', color: '#f59e0b' },
	video: { emoji: '🎬', color: '#ef4444' },
	voice: { emoji: '🎙️', color: '#8b5cf6' },
	list: { emoji: '✅', color: '#10b981' },
	poll: { emoji: '📊', color: '#f97316' },
	location: { emoji: '📍', color: '#ec4899' },
	product: { emoji: '🛍️', color: '#14b8a6' }
};

function escapeXml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export const ogBoardPreview = onRequest(
	{ cors: true, memory: '256MiB' },
	async (req, res) => {
		const boardId = req.query.boardId as string;
		if (!boardId) {
			res.status(400).send('Missing boardId');
			return;
		}

		const db = getFirestore();
		const boardSnap = await db.doc(`boards/${boardId}`).get();

		if (!boardSnap.exists) {
			res.status(404).send('Board not found');
			return;
		}

		const board = boardSnap.data()!;
		const boardName = escapeXml((board.name as string) || 'Nearboard');
		const memberCount = (board.memberIds as string[])?.length || 1;
		const isPublic = board.isPublic === true;

		if (!isPublic) {
			res.status(403).send('Board is private');
			return;
		}

		// Get content type distribution (last 20 items)
		const contentSnap = await db
			.collection(`boards/${boardId}/content`)
			.orderBy('createdAt', 'desc')
			.limit(20)
			.select('type')
			.get();

		const typeCounts = new Map<string, number>();
		for (const doc of contentSnap.docs) {
			const type = doc.data().type as string;
			typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
		}

		const totalItems = contentSnap.size;

		// Build type pills
		const sortedTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
		const pills = sortedTypes.map(([type, count], i) => {
			const info = CONTENT_TYPE_ICONS[type] || { emoji: '📄', color: '#6b7280' };
			const x = 60 + i * 110;
			return `
				<rect x="${x}" y="260" width="100" height="34" rx="17" fill="${info.color}" opacity="0.15"/>
				<text x="${x + 50}" y="282" font-family="system-ui, sans-serif" font-size="13" fill="${info.color}" text-anchor="middle" font-weight="600">${info.emoji} ${count} ${type}${count > 1 ? 's' : ''}</text>
			`;
		}).join('');

		// Build SVG
		const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#eef2ff"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Decorative circles -->
  <circle cx="1100" cy="80" r="120" fill="#6366f1" opacity="0.05"/>
  <circle cx="100" cy="550" r="80" fill="#8b5cf6" opacity="0.05"/>

  <!-- Logo area -->
  <rect x="60" y="50" width="44" height="44" rx="12" fill="url(#accent)"/>
  <text x="82" y="80" font-family="system-ui, sans-serif" font-size="22" fill="white" text-anchor="middle" font-weight="700">N</text>
  <text x="116" y="80" font-family="system-ui, sans-serif" font-size="18" fill="#6366f1" font-weight="600">nearboard</text>

  <!-- Board name -->
  <text x="60" y="170" font-family="system-ui, sans-serif" font-size="48" fill="#1e1b4b" font-weight="700">${boardName}</text>

  <!-- Stats line -->
  <text x="60" y="220" font-family="system-ui, sans-serif" font-size="20" fill="#6b7280">
    ${totalItems} item${totalItems !== 1 ? 's' : ''} · ${memberCount} member${memberCount !== 1 ? 's' : ''}
  </text>

  <!-- Content type pills -->
  ${pills}

  <!-- CTA -->
  <rect x="60" y="520" width="260" height="52" rx="26" fill="url(#accent)"/>
  <text x="190" y="552" font-family="system-ui, sans-serif" font-size="18" fill="white" text-anchor="middle" font-weight="600">View this board →</text>

  <!-- Watermark -->
  <text x="1140" y="600" font-family="system-ui, sans-serif" font-size="14" fill="#cbd5e1" text-anchor="end">nearboard-app.web.app</text>
</svg>`;

		res.set('Content-Type', 'image/svg+xml');
		res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
		res.status(200).send(svg);
	}
);
