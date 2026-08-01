import { writable } from 'svelte/store';
import type { Hub } from '$lib/domain/types';
import { getAllHubs } from '$lib/db/localDb';

/** All known hubs (owned + discovered) */
export const hubs = writable<Hub[]>([]);

/** Currently active/connected hub ID */
export const activeHubId = writable<string | null>(null);

/** Load hubs from IndexedDB into the store */
export async function loadHubs(): Promise<void> {
  const all = await getAllHubs();
  hubs.set(all);
}
