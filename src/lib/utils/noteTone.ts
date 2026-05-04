/**
 * @file noteTone.ts
 * @description Sticky-note tone palette + deterministic hash. Shared between
 *              the board NoteCard and the detail modal so a given short note
 *              always renders in the same colour.
 */

export type NoteTone = {
	bg: string;
	ring: string;
	mark: string;
	body: string;
};

export const NOTE_TONES: NoteTone[] = [
	// Blush — warm pink, fills the role Peach used to without bleeding into orange
	{ bg: '#ffe1ec', ring: 'rgba(244, 114, 182, 0.18)', mark: 'rgba(219, 39, 119, 0.38)', body: '#3a0f25' },
	// Mint
	{ bg: '#dcf5e3', ring: 'rgba(5, 150, 105, 0.18)', mark: 'rgba(4, 120, 87, 0.38)', body: '#0d2f1c' },
	// Sky
	{ bg: '#dbeefb', ring: 'rgba(2, 132, 199, 0.18)', mark: 'rgba(3, 105, 161, 0.38)', body: '#0c2438' },
	// Lavender — cool pale violet, replaces Lemon
	{ bg: '#ece4f8', ring: 'rgba(139, 92, 246, 0.18)', mark: 'rgba(109, 40, 217, 0.38)', body: '#1e1238' },
	// Lilac — pinker than Lavender
	{ bg: '#f3e8ff', ring: 'rgba(168, 85, 247, 0.18)', mark: 'rgba(126, 34, 206, 0.38)', body: '#2a1141' },
	// Rose
	{ bg: '#fbdbe5', ring: 'rgba(225, 29, 72, 0.18)', mark: 'rgba(190, 18, 60, 0.36)', body: '#3a0f1d' }
];

export function pickNoteTone(input: string): NoteTone {
	let h = 0;
	for (let i = 0; i < input.length; i++) {
		h = (h * 31 + input.charCodeAt(i)) | 0;
	}
	return NOTE_TONES[Math.abs(h) % NOTE_TONES.length];
}
