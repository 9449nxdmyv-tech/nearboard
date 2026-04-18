/**
 * @file whatsAppImportService.ts
 * @description Orchestrates WhatsApp chat import: parse → filter → classify → write cards.
 *              All Firestore writes go through existing boardService.addContent.
 *
 *              For zip files, uses fflate's streaming Unzip to read the archive
 *              in small chunks via file.slice(). Only the .txt chat file and
 *              small images are decompressed — videos and large media are skipped.
 *              This keeps memory low even for multi-GB exports with media.
 */

import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import { Timestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './app';
import { parseChat } from '$lib/utils/whatsAppParser';
import { filterMessages } from '$lib/utils/whatsAppFilter';
import { addContent } from './boardService';
import { uploadPhoto } from './storageService';
import { detectContentType } from '$lib/utils/contentDetection';
import type {
	ClassifiedWhatsAppCard,
	WhatsAppImportResult,
	NoteContentDoc,
	ListContentDoc,
	LinkContentDoc,
	ProductContentDoc,
	PhotoContentDoc,
	ContentDoc,
	ListItem
} from '$lib/types';
import { WHATSAPP_IMPORT_MAX_TXT_BYTES } from '$lib/config/constants';

/** Extensions we'll extract from zip (images only, not video/audio) */
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic']);

/** Max decompressed size per image file (5 MB) */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Chunk size for streaming zip reads (1 MB) */
const STREAM_CHUNK_SIZE = 1024 * 1024;

/** Read a Blob as Uint8Array using FileReader (works on all browsers including Safari) */
function readBlobAsUint8Array(blob: Blob): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
		reader.onerror = () => reject(reader.error);
		reader.readAsArrayBuffer(blob);
	});
}

/**
 * Decides whether a file from the zip should be extracted.
 * Only .txt chat files and small images are worth extracting.
 */
function shouldExtract(name: string, originalSize?: number): boolean {
	if (name.startsWith('__MACOSX') || name.endsWith('/')) return false;
	if (name.endsWith('.txt')) return true;
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	if (!IMAGE_EXTS.has(ext)) return false;
	// If we know the original size and it's too large, skip
	if (originalSize !== undefined && originalSize > MAX_IMAGE_BYTES) return false;
	return true;
}

/**
 * Streams a zip File through fflate's Unzip, extracting only the files
 * that pass shouldExtract(). Returns a map of filename → Uint8Array.
 */
async function streamExtractZip(file: File): Promise<Map<string, Uint8Array>> {
	return new Promise((resolve, reject) => {
		const extracted = new Map<string, Uint8Array>();
		const uz = new Unzip();
		uz.register(UnzipInflate);
		uz.register(UnzipPassThrough);

		uz.onfile = (entry) => {
			if (!shouldExtract(entry.name, entry.originalSize)) return;

			const chunks: Uint8Array[] = [];
			let totalSize = 0;
			let discarded = false;

			entry.ondata = (err, data, final) => {
				if (err || discarded) return;

				totalSize += data.length;

				// If an image exceeds the size cap mid-stream, discard it
				if (!entry.name.endsWith('.txt') && totalSize > MAX_IMAGE_BYTES) {
					discarded = true;
					return;
				}

				chunks.push(data);

				if (final && !discarded) {
					const combined = new Uint8Array(totalSize);
					let offset = 0;
					for (const chunk of chunks) {
						combined.set(chunk, offset);
						offset += chunk.length;
					}
					extracted.set(entry.name, combined);
				}
			};

			entry.start();
		};

		// Read the file in chunks and push to the streaming unzipper
		(async () => {
			try {
				for (let offset = 0; offset < file.size; offset += STREAM_CHUNK_SIZE) {
					const end = Math.min(offset + STREAM_CHUNK_SIZE, file.size);
					const slice = file.slice(offset, end);
					const buffer = await readBlobAsUint8Array(slice);
					const isFinal = end >= file.size;
					uz.push(buffer, isFinal);
				}
				resolve(extracted);
			} catch (err) {
				reject(err);
			}
		})();
	});
}

/**
 * Phase 1: Parse file, filter noise, classify via LLM.
 * Handles both .txt and .zip WhatsApp exports.
 */
export async function parseAndClassify(file: File): Promise<ClassifiedWhatsAppCard[]> {
	const isZip = file.name.endsWith('.zip') || file.type === 'application/zip';

	if (!isZip && file.size > WHATSAPP_IMPORT_MAX_TXT_BYTES) {
		const maxMB = Math.round(WHATSAPP_IMPORT_MAX_TXT_BYTES / (1024 * 1024));
		throw new Error(`File too large. Maximum ${maxMB} MB for text files.`);
	}

	let chatText: string;
	let mediaFiles = new Map<string, File>();

	if (isZip) {
		// Stream-extract only .txt + small images — never loads full zip into memory
		const extracted = await streamExtractZip(file);

		// Find the .txt chat file
		let txtContent: Uint8Array | null = null;
		for (const [name, data] of extracted) {
			if (name.endsWith('.txt') && !name.startsWith('__MACOSX')) {
				txtContent = data;
			} else {
				const ext = name.split('.').pop()?.toLowerCase() ?? '';
				const mime = guessMimeType(ext);
				const blob = new Blob([data as BlobPart], { type: mime });
				const basename = name.split('/').pop() ?? name;
				mediaFiles.set(basename, new File([blob], basename, { type: mime }));
			}
		}

		if (!txtContent) {
			throw new Error('No .txt chat file found in the zip archive.');
		}

		chatText = new TextDecoder('utf-8').decode(txtContent);
	} else {
		const bytes = await readBlobAsUint8Array(file);
		chatText = new TextDecoder('utf-8').decode(bytes);
	}

	// Parse → filter
	const parsed = parseChat(chatText);
	if (parsed.length === 0) {
		throw new Error('Could not parse any messages from this file. Make sure it\'s a WhatsApp chat export.');
	}

	const filtered = filterMessages(parsed);
	if (filtered.length === 0) {
		throw new Error('No meaningful messages found in the last 30 days.');
	}

	// Classify via Cloud Function (5 min timeout for large chats)
	const functions = getFunctions(app());
	const classify = httpsCallable<
		{ messages: typeof filtered },
		{ cards: ClassifiedWhatsAppCard[] }
	>(functions, 'classifyWhatsApp', { timeout: 300_000 });

	let cards: ClassifiedWhatsAppCard[];
	try {
		const result = await classify({ messages: filtered });
		cards = result.data.cards;
	} catch (err: unknown) {
		const code = (err as { code?: string }).code;
		if (code === 'functions/deadline-exceeded') {
			throw new Error('Classification timed out. Try exporting a shorter chat (last 30 days).');
		}
		console.error('classifyWhatsApp call failed:', err);
		throw new Error('Classification failed. Please try again.');
	}

	if (!cards || cards.length === 0) {
		throw new Error('No cards could be created from this chat.');
	}

	// Attach media files to photo cards
	for (const card of cards) {
		if (card.cardType === 'photo' && card.originalMessage.attachments.length > 0) {
			const attachment = card.originalMessage.attachments[0];
			const mediaFile = mediaFiles.get(attachment.filename);
			if (mediaFile) {
				card.mediaFile = mediaFile;
			}
		}
	}

	return cards;
}

/**
 * Phase 2: Write approved cards to Firestore.
 */
export async function importApprovedCards(params: {
	boardId: string;
	importerUid: string;
	importerName: string;
	importerPhotoURL: string | null;
	cards: ClassifiedWhatsAppCard[];
	selectedIndices: number[];
}): Promise<WhatsAppImportResult> {
	const { boardId, importerUid, importerName, importerPhotoURL, cards, selectedIndices } = params;

	let imported = 0;
	let failed = 0;

	const importedAt = Timestamp.now();

	async function writeCard(card: ClassifiedWhatsAppCard): Promise<boolean> {
		const importedFrom = {
			source: 'whatsapp' as const,
			originalAuthorName: card.originalMessage.author,
			originalTimestamp: card.originalMessage.timestamp,
			importedAt
		};

		const base = {
			boardId,
			authorId: importerUid,
			authorName: importerName,
			authorPhotoURL: importerPhotoURL,
			importedFrom
		};

		try {

			switch (card.cardType) {
				case 'note': {
					await addContent(boardId, {
						...base,
						type: 'note',
						text: card.proposedContent,
						userIntent: 'Imported from WhatsApp chat'  // Lever 7: Required intent
					} as Omit<NoteContentDoc, 'id' | 'createdAt' | 'moderationStatus'>);
					break;
				}

				case 'list': {
					const lines = card.proposedContent.split('\n').filter((l) => l.trim());
					const items: ListItem[] = lines.map((line, i) => ({
						id: `item-${i}`,
						text: line.replace(/^[-•*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim(),
						completed: false
					}));
					await addContent(boardId, {
						...base,
						type: 'list',
						title: card.proposedTitle,
						items,
						userIntent: 'Imported from WhatsApp chat'  // Lever 7: Required intent
					} as Omit<ListContentDoc, 'id' | 'createdAt' | 'moderationStatus'>);
					break;
				}

				case 'link':
				case 'product': {
					if (card.proposedUrl) {
						const detectedType = detectContentType(card.proposedUrl);
						let domain: string;
						try {
							domain = new URL(card.proposedUrl).hostname.replace(/^www\./, '');
						} catch {
							domain = '';
						}

						if (detectedType.type === 'product' || card.cardType === 'product') {
							await addContent(boardId, {
								...base,
								type: 'product',
								url: card.proposedUrl,
								title: card.proposedTitle,
								image: null,
								price: '',
								domain,
								originalPrice: null,
								lastCheckedPrice: null,
								lastCheckedAt: null,
								priceDrop: false,
								userIntent: 'Imported from WhatsApp chat'  // Lever 7: Required intent
							} as Omit<ProductContentDoc, 'id' | 'createdAt' | 'moderationStatus'>);
						} else {
							await addContent(boardId, {
								...base,
								type: 'link',
								url: card.proposedUrl,
								title: card.proposedTitle,
								description: card.proposedContent || null,
								image: null,
								domain,
								favicon: null,
								userIntent: 'Imported from WhatsApp chat'  // Lever 7: Required intent
							} as Omit<LinkContentDoc, 'id' | 'createdAt' | 'moderationStatus'>);
						}
					} else {
						// URL missing — fall back to note
						await addContent(boardId, {
							...base,
							type: 'note',
							text: `${card.proposedTitle}\n\n${card.proposedContent}`,
							userIntent: 'Imported from WhatsApp chat'  // Lever 7: Required intent
						} as Omit<NoteContentDoc, 'id' | 'createdAt' | 'moderationStatus'>);
					}
					break;
				}

				case 'photo': {
					if (card.mediaFile) {
						const urls = await uploadPhoto(boardId, importerUid, card.mediaFile);

						// Get image dimensions
						const dims = await getImageDimensions(card.mediaFile);

						await addContent(boardId, {
							...base,
							type: 'photo',
							imageUrl: urls.original,
							images: [{ 
								url: urls.original, 
								thumbnailUrl: urls.thumbnail,
								mediumUrl: urls.medium,
								largeUrl: urls.large,
								width: dims.width, 
								height: dims.height 
							}],
							caption: card.proposedContent || null,
							width: dims.width,
							height: dims.height,
							userIntent: 'Imported from WhatsApp chat'  // Lever 7: Required intent
						} as Omit<PhotoContentDoc, 'id' | 'createdAt' | 'moderationStatus'>);
					} else {
						// No media file — fall back to note
						await addContent(boardId, {
							...base,
							type: 'note',
							text: card.proposedContent || card.proposedTitle,
							userIntent: 'Imported from WhatsApp chat'  // Lever 7: Required intent
						} as Omit<NoteContentDoc, 'id' | 'createdAt' | 'moderationStatus'>);
					}
					break;
				}
			}

			return true;
		} catch (err) {
			console.error('Failed to import card:', err);
			return false;
		}
	}

	// Write cards in parallel batches of 5
	const BATCH_SIZE = 5;
	const validCards = selectedIndices.map((idx) => cards[idx]).filter(Boolean) as ClassifiedWhatsAppCard[];

	for (let i = 0; i < validCards.length; i += BATCH_SIZE) {
		const batch = validCards.slice(i, i + BATCH_SIZE);
		const results = await Promise.all(batch.map((card) => writeCard(card)));
		for (const ok of results) {
			if (ok) imported++;
			else failed++;
		}
	}

	return { imported, failed };
}

/** Get image dimensions from a File using an Image element */
function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve({ width: img.naturalWidth, height: img.naturalHeight });
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			resolve({ width: 0, height: 0 });
		};
		img.src = url;
	});
}

/** Guess MIME type from file extension */
function guessMimeType(ext: string): string {
	const map: Record<string, string> = {
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		gif: 'image/gif',
		webp: 'image/webp',
		heic: 'image/heic',
		mp4: 'video/mp4',
		mov: 'video/quicktime',
		webm: 'video/webm',
		'3gp': 'video/3gpp',
		pdf: 'application/pdf',
		opus: 'audio/opus'
	};
	return map[ext] ?? 'application/octet-stream';
}
