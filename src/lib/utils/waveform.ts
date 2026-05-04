/**
 * @file waveform.ts
 * @description Compute normalized waveform peaks from an audio Blob using
 *              the Web Audio API. Used to give voice notes a visualisation
 *              that reflects the actual recording rather than a fake sine.
 *
 *              Output: array of values in [0, 1] suitable for vertical bars.
 *              Caller decides bar count (default 64). The function is best-effort
 *              — on decode failure it returns an empty array so the renderer
 *              can fall back to a deterministic shape.
 */

const DEFAULT_PEAK_COUNT = 64;

/** Create an offline-decode-capable audio context, or return null on platforms that don't support it. */
function getAudioContext(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctor) return null;
	try {
		return new Ctor();
	} catch {
		return null;
	}
}

/**
 * Decodes an audio blob and returns RMS-normalized peaks per chunk.
 * Returns an empty array if decode fails (caller should fall back to a deterministic
 * waveform). Chunks the channel data into peakCount equal segments and computes
 * the RMS of each, then normalises against the global max so the loudest peak is 1.
 */
export async function computeWaveformPeaks(
	blob: Blob,
	peakCount: number = DEFAULT_PEAK_COUNT
): Promise<number[]> {
	const ctx = getAudioContext();
	if (!ctx) return [];

	try {
		const arrayBuffer = await blob.arrayBuffer();
		// decodeAudioData copies the buffer, so it's safe to close the context after.
		const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
		const channelData = audioBuffer.getChannelData(0);
		const samplesPerPeak = Math.max(1, Math.floor(channelData.length / peakCount));

		const peaks: number[] = new Array(peakCount);
		let max = 0;
		for (let i = 0; i < peakCount; i++) {
			const start = i * samplesPerPeak;
			const end = Math.min(start + samplesPerPeak, channelData.length);
			let sumSquares = 0;
			for (let j = start; j < end; j++) {
				const v = channelData[j];
				sumSquares += v * v;
			}
			const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
			peaks[i] = rms;
			if (rms > max) max = rms;
		}

		if (max === 0) {
			return new Array(peakCount).fill(0.05);
		}

		// Normalize so the loudest peak is 1.0; floor at a small value so silent
		// sections still render a visible thread (rather than collapsing to 0).
		const FLOOR = 0.05;
		return peaks.map((p) => {
			const normalized = p / max;
			return Number((FLOOR + (1 - FLOOR) * normalized).toFixed(3));
		});
	} catch {
		return [];
	} finally {
		if (typeof ctx.close === 'function') {
			ctx.close().catch(() => {});
		}
	}
}

/**
 * Deterministic fallback used when no recorded waveform exists (legacy voice notes).
 * Produces a stable, visually-interesting shape based on the bar count seed.
 */
export function deterministicWaveform(barCount: number): number[] {
	const out: number[] = new Array(barCount);
	for (let i = 0; i < barCount; i++) {
		const x = Math.sin(i * 127.1 + barCount * 0.01) * 43758.5453;
		const fractional = x - Math.floor(x);
		out[i] = 0.3 + fractional * 0.6;
	}
	return out;
}
