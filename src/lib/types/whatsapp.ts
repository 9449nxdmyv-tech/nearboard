/**
 * @file whatsapp.ts
 * @description Types for WhatsApp chat import pipeline.
 */

export type ParsedWhatsAppMessage = {
	timestamp: string; // ISO string
	author: string;
	text: string;
	attachments: { filename: string; mimeHint: 'image' | 'gif' | 'video' | 'document' | 'unknown' }[];
	isSystemMessage: boolean;
};

export type ClassifiedWhatsAppCard = {
	originalMessage: ParsedWhatsAppMessage;
	cardType: 'link' | 'product' | 'note' | 'list' | 'photo';
	proposedTitle: string;
	proposedContent: string;
	proposedUrl?: string;
	proposedDate?: string;
	confidence: 'high' | 'medium';
	/** For media cards — populated during zip extraction */
	mediaFile?: File;
};

export type WhatsAppImportResult = { imported: number; failed: number };
