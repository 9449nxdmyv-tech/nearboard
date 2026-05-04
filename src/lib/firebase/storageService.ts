/**
 * @file storageService.ts
 * @description Firebase Storage upload/download operations. All file storage
 *              access goes through this module — never from components.
 *              Includes automatic image resizing for bandwidth optimization.
 */

import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import type { UploadMetadata } from 'firebase/storage';
import { storage } from './app';

import { MAX_VIDEO_BYTES, MAX_PHOTOS_PER_CARD } from '$lib/config/constants';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

/** Allowed image MIME types */
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
/** Allowed video MIME types */
const ALLOWED_VIDEO_TYPES = new Set(['video/webm', 'video/mp4', 'video/quicktime']);

/** Image size variants for optimization */
const IMAGE_SIZES = {
	thumbnail: 150,
	medium: 600,
	large: 1200
};

/**
 * Resizes an image to the specified max dimension while maintaining aspect ratio.
 * Returns a Blob of the resized image in JPEG format.
 */
async function resizeImage(file: File, maxDimension: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const objectUrl = URL.createObjectURL(file);
		const img = new Image();
		const cleanup = () => URL.revokeObjectURL(objectUrl);
		img.onload = () => {
			// Calculate new dimensions maintaining aspect ratio
			let width = img.width;
			let height = img.height;

			if (width > height) {
				if (width > maxDimension) {
					height = Math.round((height * maxDimension) / width);
					width = maxDimension;
				}
			} else {
				if (height > maxDimension) {
					width = Math.round((width * maxDimension) / height);
					height = maxDimension;
				}
			}

			// Create canvas and resize
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				cleanup();
				reject(new Error('Could not get canvas context'));
				return;
			}
			ctx.drawImage(img, 0, 0, width, height);

			// Convert to blob with quality optimization
			canvas.toBlob(
				(blob) => {
					cleanup();
					if (blob) resolve(blob);
					else reject(new Error('Failed to create blob'));
				},
				'image/jpeg',
				0.85 // Quality setting
			);
		};
		img.onerror = () => {
			cleanup();
			reject(new Error('Failed to load image'));
		};
		img.src = objectUrl;
	});
}

/**
 * Uploads thumbnail/medium/large size variants. The original must be uploaded
 * separately by the caller (so progress can be tracked on the largest blob).
 */
async function uploadResizedVariants(
	boardId: string,
	file: File,
	baseFilename: string
): Promise<{ thumbnail: string; medium: string; large: string }> {
	const [thumbnail, medium, large] = await Promise.all(
		Object.entries(IMAGE_SIZES).map(async ([sizeName, dimension]) => {
			const resizedBlob = await resizeImage(file, dimension);
			const storageRef = ref(storage(), `boards/${boardId}/photos/${sizeName}_${baseFilename}`);
			await uploadBytes(storageRef, resizedBlob, { contentType: 'image/jpeg' });
			return getDownloadURL(storageRef);
		})
	);

	return { thumbnail, medium, large };
}

/**
 * Uploads a file/blob using uploadBytesResumable and reports progress via callback.
 * Falls back to uploadBytes when no onProgress callback is provided.
 */
async function uploadWithProgress(
	storageRef: ReturnType<typeof ref>,
	data: Blob | File,
	metadata: UploadMetadata,
	onProgress?: (pct: number) => void
): Promise<void> {
	if (!onProgress) {
		await uploadBytes(storageRef, data, metadata);
		return;
	}

	return new Promise<void>((resolve, reject) => {
		const task = uploadBytesResumable(storageRef, data, metadata);
		task.on(
			'state_changed',
			(snapshot) => {
				const pct = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
				onProgress(Math.round(pct));
			},
			(error) => reject(error),
			() => resolve()
		);
	});
}

/**
 * Validates file size and optionally MIME type before upload.
 */
function validateFile(
	file: File | Blob,
	maxBytes: number,
	label: string,
	allowedTypes?: Set<string>
): void {
	if (file.size > maxBytes) {
		const maxMB = Math.round(maxBytes / (1024 * 1024));
		throw new Error(`${label} must be under ${maxMB} MB`);
	}
	if (allowedTypes && file.type && !allowedTypes.has(file.type)) {
		throw new Error(`${label} type "${file.type}" is not allowed`);
	}
}

/**
 * Extracts file extension from a File object, falling back to a default.
 */
function getFileExtension(file: File, fallback = 'bin'): string {
	return file.name.split('.').pop() ?? fallback;
}

/**
 * Uploads a board cover image to Firebase Storage.
 */
export async function uploadBoardCover(userId: string, file: File): Promise<string> {
	validateFile(file, MAX_IMAGE_BYTES, 'Cover image', ALLOWED_IMAGE_TYPES);
	const ext = getFileExtension(file, 'jpg');
	const filename = `${Date.now()}-${userId}.${ext}`;
	const storageRef = ref(storage(), `temp/covers/${filename}`);
	await uploadBytes(storageRef, file, { contentType: file.type });
	return getDownloadURL(storageRef);
}

/**
 * Uploads a profile photo (avatar) to Firebase Storage.
 * Stored under users/{uid}/avatar. Returns the public download URL.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
	validateFile(file, MAX_AVATAR_BYTES, 'Profile photo', ALLOWED_IMAGE_TYPES);
	const ext = getFileExtension(file, 'jpg');
	const storageRef = ref(storage(), `users/${userId}/avatar.${ext}`);
	await uploadBytes(storageRef, file, { contentType: file.type });
	return getDownloadURL(storageRef);
}

/**
 * Uploads a voice note audio blob to Firebase Storage.
 * Returns the public download URL.
 */
export async function uploadVoiceNote(
	boardId: string,
	userId: string,
	audioBlob: Blob,
	onProgress?: (pct: number) => void
): Promise<string> {
	const contentType = audioBlob.type || 'audio/webm';
	const ext = contentType.split('/')[1]?.split(';')[0] || 'webm';
	const filename = `${Date.now()}-${userId}.${ext}`;
	const storageRef = ref(storage(), `boards/${boardId}/voice/${filename}`);
	await uploadWithProgress(storageRef, audioBlob, { contentType }, onProgress);
	return getDownloadURL(storageRef);
}

/**
 * Uploads a single photo to Firebase Storage with automatic size variants.
 * Validates file size and type before upload.
 * Returns URLs for all size variants (thumbnail, medium, large, original).
 */
export async function uploadPhoto(
	boardId: string,
	userId: string,
	file: File,
	onProgress?: (pct: number) => void
): Promise<{ thumbnail: string; medium: string; large: string; original: string }> {
	validateFile(file, MAX_IMAGE_BYTES, 'Image', ALLOWED_IMAGE_TYPES);
	const ext = getFileExtension(file, 'jpg');
	const baseFilename = `${Date.now()}-${userId}.${ext}`;

	// Upload the original once — with progress if requested — then derive variants.
	const originalRef = ref(storage(), `boards/${boardId}/photos/original_${baseFilename}`);
	await uploadWithProgress(originalRef, file, { contentType: file.type }, onProgress);
	const originalUrl = await getDownloadURL(originalRef);

	const variants = await uploadResizedVariants(boardId, file, baseFilename);
	return { ...variants, original: originalUrl };
}

/**
 * Uploads multiple photos (up to MAX_PHOTOS_PER_CARD) in parallel.
 * Returns an array of URL objects (thumbnail, medium, large, original) for each photo.
 */
export async function uploadPhotos(
	boardId: string,
	userId: string,
	files: File[]
): Promise<Array<{ thumbnail: string; medium: string; large: string; original: string }>> {
	if (files.length > MAX_PHOTOS_PER_CARD) {
		throw new Error(`Maximum ${MAX_PHOTOS_PER_CARD} photos allowed`);
	}
	return Promise.all(files.map((f) => uploadPhoto(boardId, userId, f)));
}

/**
 * Uploads a short video clip to Firebase Storage.
 * Validates file size and type before upload. Returns the public download URL.
 */
export async function uploadVideo(
	boardId: string,
	userId: string,
	videoBlob: Blob,
	onProgress?: (pct: number) => void
): Promise<string> {
	validateFile(videoBlob, MAX_VIDEO_BYTES, 'Video', ALLOWED_VIDEO_TYPES);
	const contentType = videoBlob.type || 'video/webm';
	const extMap: Record<string, string> = {
		'video/webm': 'webm',
		'video/mp4': 'mp4',
		'video/quicktime': 'mov'
	};
	const ext = extMap[contentType.split(';')[0]] || 'webm';
	const filename = `${Date.now()}-${userId}.${ext}`;
	const storageRef = ref(storage(), `boards/${boardId}/videos/${filename}`);
	await uploadWithProgress(storageRef, videoBlob, { contentType }, onProgress);
	return getDownloadURL(storageRef);
}
