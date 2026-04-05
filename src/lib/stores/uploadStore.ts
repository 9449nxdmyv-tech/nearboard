/**
 * @file uploadStore.ts
 * @description Background upload queue for photos and videos.
 *              Closes capture sheets immediately and uploads in background,
 *              reporting progress via toast notifications.
 */

import { writable } from 'svelte/store';
import { toast, updateToast, dismissToast } from './toastStore';
import { addContent } from '$lib/firebase';
import { hapticSuccess } from '$lib/utils/haptics';
import { compressImages } from '$lib/utils/mediaCompression';

export interface UploadJob {
	id: string;
	type: 'photo' | 'video';
	toastId: string;
	status: 'uploading' | 'done' | 'error';
}

export const uploadStore = writable<UploadJob[]>([]);

function addJob(job: UploadJob) {
	uploadStore.update((jobs) => [...jobs, job]);
}

function removeJob(id: string) {
	uploadStore.update((jobs) => jobs.filter((j) => j.id !== id));
}

/**
 * Queue a photo upload in the background.
 * Returns immediately — the sheet can close right away.
 */
export function queuePhotoUpload(opts: {
	boardId: string;
	userId: string;
	userName: string;
	userPhoto: string | null;
	files: File[];
	previews: string[];
	caption: string;
}) {
	const jobId = crypto.randomUUID();
	const toastId = toast.loading(
		opts.files.length > 1 ? `Uploading ${opts.files.length} photos...` : 'Uploading photo...'
	);
	addJob({ id: jobId, type: 'photo', toastId, status: 'uploading' });

	(async () => {
		try {
			const { uploadPhotos } = await import('$lib/firebase/storageService');

			// Compress images before upload (resize to 1920px max, JPEG 0.8 quality)
			const compressedFiles = await compressImages(opts.files);

			// Get dimensions from preview URLs
			const dimensions = await Promise.all(
				opts.previews.map((src) => new Promise<{ width: number; height: number }>((resolve) => {
					const img = new Image();
					const timeout = setTimeout(() => resolve({ width: 0, height: 0 }), 5000);
					img.onload = () => { clearTimeout(timeout); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
					img.onerror = () => { clearTimeout(timeout); resolve({ width: 0, height: 0 }); };
					img.src = src;
				}))
			);

			const uploadResults = await uploadPhotos(opts.boardId, opts.userId, compressedFiles);
			const images = uploadResults.map((result, i) => ({
				url: result.original,
				thumbnailUrl: result.thumbnail,
				mediumUrl: result.medium,
				largeUrl: result.large,
				width: dimensions[i].width,
				height: dimensions[i].height
			}));

			await addContent(opts.boardId, {
				type: 'photo',
				imageUrl: images[0].url,
				images: images.map(img => ({
					url: img.url,
					thumbnailUrl: img.thumbnailUrl,
					mediumUrl: img.mediumUrl,
					largeUrl: img.largeUrl,
					width: img.width,
					height: img.height
				})),
				caption: opts.caption || null,
				width: images[0].width,
				height: images[0].height,
				boardId: opts.boardId,
				authorId: opts.userId,
				authorName: opts.userName,
				authorPhotoURL: opts.userPhoto
			} as any);

			updateToast(toastId, { type: 'success', message: 'Photo saved!', duration: 3000 });
			hapticSuccess();
			removeJob(jobId);
		} catch (err) {
			console.error('Background photo upload failed:', err);
			updateToast(toastId, { type: 'error', message: 'Photo upload failed', duration: 5000 });
			removeJob(jobId);
		} finally {
			// Clean up preview URLs
			opts.previews.forEach((u) => URL.revokeObjectURL(u));
		}
	})();
}

/**
 * Queue a video upload in the background.
 * Returns immediately — the sheet can close right away.
 */
export function queueVideoUpload(opts: {
	boardId: string;
	userId: string;
	userName: string;
	userPhoto: string | null;
	videoFile: Blob;
	durationMs: number;
	caption: string;
	thumbnailBlob: Blob | null;
}) {
	const jobId = crypto.randomUUID();
	const toastId = toast.loading('Uploading video...');
	addJob({ id: jobId, type: 'video', toastId, status: 'uploading' });

	(async () => {
		try {
			const { uploadVideo, uploadPhoto } = await import('$lib/firebase/storageService');

			// Upload thumbnail if available
			let thumbnailUrl: string | null = null;
			if (opts.thumbnailBlob) {
				try {
					const thumbFile = new File([opts.thumbnailBlob], `thumb-${Date.now()}.jpg`, { type: 'image/jpeg' });
					const thumbResult = await uploadPhoto(opts.boardId, opts.userId, thumbFile);
					thumbnailUrl = thumbResult.thumbnail;
				} catch { /* proceed without thumbnail */ }
			}

			const videoUrl = await uploadVideo(opts.boardId, opts.userId, opts.videoFile, (p) => {
				updateToast(toastId, { message: `Uploading video... ${Math.round(p)}%` });
			});

			await addContent(opts.boardId, {
				type: 'video',
				videoUrl,
				thumbnailUrl,
				durationMs: opts.durationMs,
				caption: opts.caption || null,
				boardId: opts.boardId,
				authorId: opts.userId,
				authorName: opts.userName,
				authorPhotoURL: opts.userPhoto
			} as any);

			updateToast(toastId, { type: 'success', message: 'Video saved!', duration: 3000 });
			hapticSuccess();
			removeJob(jobId);
		} catch (err) {
			console.error('Background video upload failed:', err);
			updateToast(toastId, { type: 'error', message: 'Video upload failed', duration: 5000 });
			removeJob(jobId);
		}
	})();
}
