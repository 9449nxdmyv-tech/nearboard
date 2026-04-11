<!--
  @file QuickCaptureLocationSheet.svelte
  @description Fullscreen sheet for detecting/searching/pinning a location.
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Icon from '@iconify/svelte';
	import { Navbar, NavbarBackLink, Link, List, ListInput, Button, Block } from 'konsta/svelte';
	import { addContent } from '$lib/firebase';
	import { userStore, showToast } from '$lib/stores';
	import { hapticSuccess } from '$lib/utils/haptics';
	import type { LocationContentDoc } from '$lib/types';
	import MapView from './MapView.svelte';
	import PlaceSearch from './PlaceSearch.svelte';
	import type { PlaceResult } from './PlaceSearch.svelte';

	let {
		boardId,
		onClose
	}: {
		boardId: string;
		onClose: () => void;
	} = $props();

	// ─── Body scroll lock ────────────────────────────────────────────────
	$effect(() => {
		const scrollY = window.scrollY;
		document.body.style.overflow = 'hidden';
		document.body.style.position = 'fixed';
		document.body.style.top = `-${scrollY}px`;
		document.body.style.width = '100%';
		return () => {
			document.body.style.overflow = '';
			document.body.style.position = '';
			document.body.style.top = '';
			document.body.style.width = '';
			window.scrollTo(0, scrollY);
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	let busy = $state(false);
	let locationAddress = $state('');
	let locationName = $state('');
	let locationCoords = $state<{ lat: number; lng: number } | null>(null);
	let locationLoading = $state(false);
	let userLocation = $state<{ lat: number; lng: number } | null>(null);

	async function detectLocation() {
		if (!navigator.geolocation) {
			showToast('Location is not supported on this device');
			return;
		}
		locationLoading = true;
		try {
			const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, {
					enableHighAccuracy: true,
					timeout: 15000,
					maximumAge: 60000
				});
			});
			const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
			locationCoords = coords;
			userLocation = coords;
			// Reverse geocode to get address
			try {
				const res = await fetch(
					`https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lng}`,
					{ headers: { 'User-Agent': 'Nearboard/1.0' }, signal: AbortSignal.timeout(8000) }
				);
				if (res.ok) {
					const data = await res.json();
					locationAddress = data.display_name ?? '';
					locationName = data.name ?? '';
				} else {
					locationAddress = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
				}
			} catch {
				// Geocode failed but we still have coords
				locationAddress = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
			}
		} catch (err: any) {
			const code = err?.code;
			if (code === 1) {
				showToast('Location permission denied. Enable it in your browser settings.');
			} else if (code === 2) {
				showToast('Could not determine your location. Try searching instead.');
			} else if (code === 3) {
				showToast('Location request timed out. Try again or search.');
			} else {
				showToast('Could not detect location');
			}
		} finally {
			locationLoading = false;
		}
	}

	function handlePlaceSelect(place: PlaceResult) {
		locationCoords = { lat: place.lat, lng: place.lng };
		locationName = place.name;
		locationAddress = place.address;
	}

	async function handleMapClick(lat: number, lng: number) {
		locationCoords = { lat, lng };
		locationName = '';
		locationAddress = '';
		try {
			const res = await fetch(
				`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
				{ headers: { 'User-Agent': 'Nearboard/1.0' }, signal: AbortSignal.timeout(8000) }
			);
			if (res.ok) {
				const data = await res.json();
				locationAddress = data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
				locationName = data.name ?? '';
			}
		} catch {
			locationAddress = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
		}
	}

	async function submitLocation() {
		const user = $userStore.user;
		if (!user || !locationCoords || !locationAddress.trim()) return;
		busy = true;
		try {
			await addContent(boardId, {
				type: 'location', latitude: locationCoords.lat, longitude: locationCoords.lng,
				address: locationAddress.trim(), name: locationName.trim() || null,
				boardId, authorId: user.uid, authorName: user.displayName || user.email, authorPhotoURL: user.photoURL
			} as Omit<LocationContentDoc, 'id' | 'createdAt'>);
			hapticSuccess();
			showToast('Location saved!');
			onClose();
		} catch { showToast('Failed to save location'); }
		finally { busy = false; }
	}

	const canSubmit = $derived(!busy && !!locationCoords && locationAddress.trim().length > 0);
</script>

{#snippet navLeft()}
	<NavbarBackLink onClick={onClose} text="Close" />
{/snippet}

{#snippet navRight()}
	{#if canSubmit}
		<Link onClick={submitLocation}>
			{#if busy}
				<Icon icon="ph:circle-notch-bold" class="text-lg animate-spin" />
			{:else}
				Save
			{/if}
		</Link>
	{/if}
{/snippet}

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-[60] flex items-stretch sm:items-center sm:justify-center"
	transition:fade={{ duration: 200 }}
>
	<div class="fixed inset-0 bg-black/40 sm:bg-black/60 sm:backdrop-blur-md" aria-hidden="true" onclick={onClose}></div>

	<div
		class="relative z-10 w-full h-full sm:h-auto sm:max-w-xl sm:max-h-[85vh] sm:rounded-2xl sm:shadow-2xl
			bg-surface flex flex-col overflow-hidden"
		in:fly={{ y: 40, duration: 300, easing: quintOut }}
		onclick={(e) => e.stopPropagation()}
	>
		<Navbar title="Pin a Place" left={navLeft} right={navRight} />

		<div class="flex-1 overflow-y-auto">
			<Block>
				<PlaceSearch
					placeholder="Search for a place..."
					userLat={userLocation?.lat ?? null}
					userLng={userLocation?.lng ?? null}
					onSelect={handlePlaceSelect}
				/>
			</Block>

			{#if locationCoords}
				<Block>
					<div class="rounded-xl overflow-hidden border border-border-light">
						<MapView
							latitude={locationCoords.lat}
							longitude={locationCoords.lng}
							zoom={15}
							interactive={true}
							showUserLocation={true}
							height="200px"
							onMapClick={handleMapClick}
						/>
					</div>
				</Block>

				{#if locationName || locationAddress}
					<Block>
						{#if locationName}
							<div class="flex items-center gap-2 mb-1">
								<Icon icon="ph:map-pin" class="text-primary text-sm shrink-0" />
								<span class="text-sm font-semibold text-on-surface truncate">{locationName}</span>
							</div>
						{/if}
						{#if locationAddress}
							<p class="text-xs text-muted line-clamp-2 leading-relaxed">{locationAddress}</p>
						{/if}
					</Block>
				{/if}

				<List inset strong outline>
					<ListInput
						outline
						label="Name"
						type="text"
						placeholder="Place name (optional)"
						value={locationName}
						onInput={(e) => { locationName = e.target.value; }}
					/>
				</List>
			{:else}
				<div class="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-5">
					<Button clear onClick={detectLocation} disabled={locationLoading} class="!p-0">
						<div class="flex flex-col items-center gap-3">
							<div class="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
								{#if locationLoading}
									<Icon icon="ph:circle-notch-bold" class="text-3xl text-primary animate-spin" />
								{:else}
									<Icon icon="ph:crosshair-bold" class="text-3xl text-primary" />
								{/if}
							</div>
							<div class="text-center">
								<p class="text-[14px] font-semibold text-on-surface">
									{locationLoading ? 'Detecting...' : 'Use Current Location'}
								</p>
								<p class="text-[12px] text-muted mt-0.5">Tap to detect automatically</p>
							</div>
						</div>
					</Button>

					<div class="flex items-center gap-3 w-full max-w-xs">
						<div class="flex-1 h-px bg-border-light"></div>
						<span class="text-[11px] text-muted font-medium">or search above</span>
						<div class="flex-1 h-px bg-border-light"></div>
					</div>
				</div>
			{/if}
		</div>

		{#if locationCoords}
			<div class="p-4 pb-safe border-t border-border-light">
				<Button large rounded onClick={submitLocation} disabled={!canSubmit}>
					{#if busy}
						<Icon icon="ph:circle-notch-bold" class="mr-2 animate-spin" />
						Saving...
					{:else}
						Save Location
					{/if}
				</Button>
			</div>
		{/if}
	</div>
</div>

<style>
	.pb-safe {
		padding-bottom: max(env(safe-area-inset-bottom, 0px), 1rem);
	}
	@media (min-width: 768px) {
		:global(.maplibregl-map) { min-height: 280px !important; }
	}
</style>
