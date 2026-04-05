/**
 * @file hooks.server.ts
 * @description SvelteKit server hooks — sets security response headers (CSP, etc.).
 */

import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
	// NOTE: CSP is set in firebase.json headers for production (adapter-static).
	// hooks.server.ts only runs during dev, not in the static build.

	return response;
};
