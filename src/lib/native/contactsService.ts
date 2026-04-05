/**
 * @file contactsService.ts
 * @description Secure contacts abstraction layer. Manages native contacts
 *              permissions and normalization.
 */

import { Capacitor } from '@capacitor/core';

export interface Contact {
	id: string;
	displayName: string;
	phoneNumbers: string[];
	emails: string[];
}

/**
 * Checks and requests contacts permission.
 */
export async function requestContactsPermission(): Promise<boolean> {
	if (!Capacitor.isNativePlatform()) {
		console.warn('Contacts API not available on web');
		return false;
	}

	try {
		// Note: Requires @capacitor-community/contacts plugin
		// For now, we stub this until the user confirms installation.
		// return (await Contacts.requestPermissions()).contacts === 'granted';
		return false;
	} catch (e) {
		console.error('Permission request failed:', e);
		return false;
	}
}

/**
 * Fetches and normalizes device contacts.
 */
export async function getContacts(): Promise<Contact[]> {
	if (!Capacitor.isNativePlatform()) {
		return [];
	}

	try {
		// Stub for @capacitor-community/contacts
		// const result = await Contacts.getContacts({
		// 	projection: {
		// 		name: true,
		// 		phones: true,
		// 		emails: true
		// 	}
		// });
		// return result.contacts.map(c => ({ ... }));
		return [];
	} catch (e) {
		console.error('Failed to fetch contacts:', e);
		return [];
	}
}

/**
 * Filters contacts by a search query.
 */
export function searchContacts(contacts: Contact[], query: string): Contact[] {
	const q = query.toLowerCase();
	return contacts.filter(
		(c) =>
			c.displayName.toLowerCase().includes(q) ||
			c.emails.some((e) => e.toLowerCase().includes(q)) ||
			c.phoneNumbers.some((p) => p.includes(q))
	);
}

/**
 * Normalizes an email or phone number for secure matching.
 */
export function normalizeIdentifier(val: string): string {
	return val.trim().toLowerCase();
}
