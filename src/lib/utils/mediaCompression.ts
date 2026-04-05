/**
 * @file mediaCompression.ts
 * @description Client-side image compression via Canvas API.
 *              Resizes to max dimension and re-encodes as JPEG.
 *              Typically achieves 70-90% size reduction with minimal quality loss.
 */

const DEFAULT_MAX_DIM = 1920;
const DEFAULT_QUALITY = 0.8;

/**
 * Compress a single image file by resizing and re-encoding as JPEG.
 * Uses OffscreenCanvas when available, falls back to regular Canvas.
 */
export async function compressImage(
	file: File,
	maxDim = DEFAULT_MAX_DIM,
	quality = DEFAULT_QUALITY
): Promise<File> {
	// Skip non-image files or tiny files (< 100KB)
	if (!file.type.startsWith('image/') || file.size < 100_000) {
		return file;
	}

	const img = await createImageBitmap(file);
	const scale = Math.min(1, maxDim / Math.max(img.width, img.height));

	// Skip if already small enough and JPEG
	if (scale >= 1 && file.type === 'image/jpeg') {
		img.close();
		return file;
	}

	const w = Math.round(img.width * scale);
	const h = Math.round(img.height * scale);

	let blob: Blob;

	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(w, h);
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(img, 0, 0, w, h);
		blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
	} else {
		// Fallback for older browsers
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(img, 0, 0, w, h);
		blob = await new Promise<Blob>((resolve) => {
			canvas.toBlob((b) => resolve(b!), 'image/jpeg', quality);
		});
	}

	img.close();

	// Only use compressed version if it's actually smaller
	if (blob.size >= file.size) {
		return file;
	}

	const name = file.name.replace(/\.[^.]+$/, '.jpg');
	return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}

/**
 * Compress multiple image files in parallel.
 */
export async function compressImages(
	files: File[],
	maxDim = DEFAULT_MAX_DIM,
	quality = DEFAULT_QUALITY
): Promise<File[]> {
	return Promise.all(files.map((f) => compressImage(f, maxDim, quality)));
}
