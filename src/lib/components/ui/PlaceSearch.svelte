<!--
  @file PlaceSearch.svelte
  @description Place autocomplete search input using Photon (Komoot) geocoding API.
               Free, open-source, no API key needed. Uses Konsta Searchbar.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { fly, fade } from 'svelte/transition';
	import { onDestroy } from 'svelte';
	import { Searchbar, List, ListItem } from 'konsta/svelte';

	export interface PlaceResult {
		name: string;
		address: string;
		lat: number;
		lng: number;
	}

	let {
		placeholder = 'Search for a place...',
		userLat = null,
		userLng = null,
		onSelect
	}: {
		placeholder?: string;
		userLat?: number | null;
		userLng?: number | null;
		onSelect: (place: PlaceResult) => void;
	} = $props();

	let query = $state('');
	let results = $state<PlaceResult[]>([]);
	let loading = $state(false);
	let showDropdown = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let searchAbort: AbortController | null = null;

	onDestroy(() => {
		if (debounceTimer) clearTimeout(debounceTimer);
		searchAbort?.abort();
	});

	function formatPhotonFeature(feature: {
		properties: Record<string, string | undefined>;
		geometry: { coordinates: [number, number] };
	}): PlaceResult {
		const p = feature.properties;
		const name = p.name || p.street || '';
		const parts: string[] = [];
		if (p.housenumber && p.street) parts.push(`${p.street} ${p.housenumber}`);
		else if (p.street) parts.push(p.street);
		if (p.city || p.town || p.village) parts.push(p.city || p.town || p.village || '');
		if (p.state) parts.push(p.state);
		if (p.country) parts.push(p.country);
		const address = parts.filter(Boolean).join(', ') || name;

		return {
			name,
			address,
			lat: feature.geometry.coordinates[1],
			lng: feature.geometry.coordinates[0]
		};
	}

	async function search(q: string) {
		if (q.length < 2) {
			results = [];
			showDropdown = false;
			return;
		}

		searchAbort?.abort();
		const controller = new AbortController();
		searchAbort = controller;
		loading = true;
		try {
			const params = new URLSearchParams({ q, limit: '6', lang: 'en' });
			if (userLat != null && userLng != null) {
				params.set('lat', String(userLat));
				params.set('lon', String(userLng));
			}
			const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: controller.signal });
			if (!res.ok) throw new Error();
			const data = await res.json();
			if (controller.signal.aborted) return;
			results = (data.features ?? []).map(formatPhotonFeature);
			showDropdown = results.length > 0;
		} catch {
			if (controller.signal.aborted) return;
			results = [];
			showDropdown = false;
		} finally {
			if (!controller.signal.aborted) loading = false;
		}
	}

	function handleInput(e: any) {
		query = e.target.value;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => search(query.trim()), 350);
	}

	function selectPlace(place: PlaceResult) {
		query = place.name || place.address;
		showDropdown = false;
		results = [];
		onSelect(place);
	}

	function handleClear() {
		query = '';
		results = [];
		showDropdown = false;
	}

	function iconForPlace(place: PlaceResult): string {
		const lower = (place.name + place.address).toLowerCase();
		if (/restaurant|cafe|coffee|food|pizza|burger|sushi|bakery/i.test(lower)) return 'ph:fork-knife';
		if (/hotel|hostel|inn|lodge|resort/i.test(lower)) return 'ph:bed';
		if (/park|garden|forest|beach|lake/i.test(lower)) return 'ph:tree';
		if (/hospital|clinic|pharmacy|doctor/i.test(lower)) return 'ph:first-aid';
		if (/school|university|college|library/i.test(lower)) return 'ph:graduation-cap';
		if (/airport|station|terminal/i.test(lower)) return 'ph:airplane';
		if (/shop|store|mall|market|supermarket/i.test(lower)) return 'ph:storefront';
		if (/gym|fitness|sport|stadium/i.test(lower)) return 'ph:barbell';
		if (/museum|gallery|theater|cinema/i.test(lower)) return 'ph:paint-brush';
		if (/church|mosque|temple|synagogue/i.test(lower)) return 'ph:cross';
		return 'ph:map-pin';
	}
</script>

<div class="relative">
	<Searchbar
		value={query}
		onInput={handleInput}
		onClear={handleClear}
		onFocus={() => { if (results.length > 0) showDropdown = true; }}
		onBlur={() => { setTimeout(() => { showDropdown = false; }, 200); }}
		{placeholder}
	/>

	{#if loading}
		<div class="absolute right-14 top-1/2 -translate-y-1/2 z-10" transition:fade={{ duration: 100 }}>
			<Icon icon="ph:circle-notch-bold" class="text-primary animate-spin text-base" />
		</div>
	{/if}

	{#if showDropdown && results.length > 0}
		<div class="absolute z-50 left-4 right-4 top-full mt-1 bg-surface rounded-xl shadow-xl border border-border-light max-h-56 overflow-y-auto"
			transition:fly={{ y: -8, duration: 150 }}>
			<List class="!my-0">
				{#each results as place, i}
					<ListItem title={place.name || place.address} subtitle={place.name ? place.address : ''} onClick={() => selectPlace(place)}>
						{#snippet media()}
							<div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
								<Icon icon={iconForPlace(place)} class="text-primary text-sm" />
							</div>
						{/snippet}
					</ListItem>
				{/each}
			</List>
			<div class="px-3 py-1.5 border-t border-border-light">
				<p class="text-[9px] text-muted text-center">Powered by Photon &amp; OpenStreetMap</p>
			</div>
		</div>
	{/if}
</div>
