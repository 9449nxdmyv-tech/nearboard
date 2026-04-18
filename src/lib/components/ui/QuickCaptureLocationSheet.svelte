<!--
  @file QuickCaptureLocationSheet.svelte
  @description Fullscreen sheet for detecting/searching/pinning a location.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { Navbar, NavbarBackLink, Link, Button, Block } from 'konsta/svelte';
	import { addContent } from '$lib/firebase';
	import { userStore, showToast } from '$lib/stores';
	import { hapticSuccess } from '$lib/utils/haptics';
	import QuickCaptureShell from './QuickCaptureShell.svelte';
	import SubmitButton from './SubmitButton.svelte';
	import type { LocationContentDoc } from '$lib/types';
	import MapView from './MapView.svelte';
	import PlaceSearch from './PlaceSearch.svelte';
	import type { PlaceResult } from './PlaceSearch.svelte';
	import { onMount } from 'svelte';

	let {
		boardId,
		onClose
	}: {
		boardId: string;
		onClose: () => void;
	} = $props();

	let busy = $state(false);
	let locationAddress = $state('');
	let locationName = $state('');
	let locationCoords = $state<{ lat: number; lng: number } | null>(null);
	let locationLoading = $state(false);
	let userLocation = $state<{ lat: number; lng: number } | null>(null);

	// Auto-detect user location on mount
	onMount(() => {
		if (!locationCoords && !locationLoading) {
			detectLocation();
		}
	});

	async function detectLocation() {
		if (!navigator.geolocation) {
			showToast('Location is not supported on this device');
			return;
		}

		if (!window.isSecureContext) {
			showToast('Location requires HTTPS. Use a secure connection.');
			return;
		}

		locationLoading = true;

		try {
			if (navigator.permissions) {
				const permStatus = await navigator.permissions.query({ name: 'geolocation' });
				if (permStatus.state === 'denied') {
					showToast('Location permission denied. Enable it in your browser settings.');
					locationLoading = false;
					return;
				}
			}
		} catch {
			// permissions API not available
		}

		const attempts = [
			{ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
			{ enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 }
		];

		let pos: GeolocationPosition | null = null;
		let lastError: any = null;

		for (const opts of attempts) {
			try {
				pos = await new Promise<GeolocationPosition>((resolve, reject) => {
					navigator.geolocation.getCurrentPosition(resolve, reject, opts);
				});
				break;
			} catch (err: any) {
				lastError = err;
			}
		}

		if (!pos) {
			locationLoading = false;
			const code = lastError?.code;
			if (code === 1) showToast('Location permission denied. Enable it in your browser settings.');
			else if (code === 2) showToast('Could not determine your location. Try searching instead.');
			else if (code === 3) showToast('Location request timed out. Try again or search.');
			else showToast('Could not detect location. Try searching instead.');
			return;
		}

		const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
		locationCoords = coords;
		userLocation = coords;

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
			locationAddress = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
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

<QuickCaptureShell {onClose}>
	<Navbar title="Pin a Place" left={navLeft} right={navRight} />

	<!-- Search bar at top -->
	<div class="shrink-0 px-4 pt-2 pb-3 bg-surface">
		<PlaceSearch
			placeholder="Search for a place..."
			userLat={userLocation?.lat ?? null}
			userLng={userLocation?.lng ?? null}
			onSelect={handlePlaceSelect}
		/>
	</div>

	<!-- Scrollable content area -->
	<div class="flex-1 overflow-y-auto">
		{#if locationCoords}
			<!-- Map preview -->
			<div class="px-4 pt-3">
				<div class="rounded-2xl overflow-hidden shadow-md ring-1 ring-border/20">
					<MapView
						latitude={locationCoords.lat}
						longitude={locationCoords.lng}
						zoom={15}
						interactive={true}
						showUserLocation={true}
						height="220px"
						onMapClick={handleMapClick}
					/>
				</div>
			</div>

			<!-- Location info card -->
			<div class="mx-4 mt-3 p-4 rounded-2xl bg-surface-1/80 ring-1 ring-border/10">
				<div class="flex items-start gap-3">
					<div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
						<Icon icon="ph:map-pin-fill" class="text-xl text-primary" />
					</div>
					<div class="flex-1 min-w-0">
						{#if locationName}
							<p class="text-[14px] font-semibold text-on-surface leading-snug">{locationName}</p>
						{/if}
						{#if locationAddress}
							<p class="text-[12px] text-muted leading-relaxed mt-0.5 line-clamp-2">{locationAddress}</p>
						{:else}
							<p class="text-[11px] text-muted tabular-nums">{locationCoords.lat.toFixed(5)}, {locationCoords.lng.toFixed(5)}</p>
						{/if}
					</div>
					<!-- Change location hint -->
					<button
						onclick={() => { locationCoords = null; locationAddress = ''; locationName = ''; }}
						class="shrink-0 text-[11px] text-primary font-medium press-scale"
					>
						Change
					</button>
				</div>
			</div>

			<!-- Name input -->
			<div class="mx-4 mt-3 p-3 rounded-2xl bg-surface-1/80 ring-1 ring-border/10">
				<div class="flex items-center gap-2.5">
					<Icon icon="ph:tag" class="text-base text-muted shrink-0" />
					<input
						type="text"
						placeholder="Add a name (optional)"
						value={locationName}
						onInput={(e) => { locationName = (e.target as HTMLInputElement).value; }}
						class="flex-1 text-[14px] bg-transparent text-on-surface placeholder:text-muted/40 outline-none py-1"
					/>
				</div>
			</div>

			<!-- Tap hint -->
			<div class="flex items-center justify-center gap-1.5 mt-4 mb-2">
				<Icon icon="ph:cursor-click" class="text-sm text-muted/40" />
				<span class="text-[11px] text-muted/50">Tap the map to change pin</span>
			</div>
		{:else}
			<!-- Empty state: detect location prompt -->
			<div class="flex-1 flex flex-col items-center justify-center px-6 py-16 gap-8">
				<div class="flex flex-col items-center gap-4">
					<!-- Icon circle -->
					<div class="w-28 h-28 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center ring-1 ring-primary/10">
						{#if locationLoading}
							<Icon icon="ph:circle-notch-bold" class="text-5xl text-primary animate-spin" />
						{:else}
							<Icon icon="ph:crosshair-bold" class="text-5xl text-primary" />
						{/if}
					</div>

					<!-- Text -->
					<div class="text-center">
						<p class="text-[16px] font-semibold text-on-surface">
							{locationLoading ? 'Detecting your location...' : 'Use Current Location'}
						</p>
						<p class="text-[13px] text-muted mt-1">
							{locationLoading ? 'Please wait a moment...' : 'Tap to detect automatically'}
						</p>
					</div>

					<!-- Detect button -->
					<Button
						class="mt-2 !rounded-full !px-8 !py-2.5 !text-[14px] !font-semibold"
						onClick={detectLocation}
						disabled={locationLoading}
					>
						{#if locationLoading}
							<Icon icon="ph:circle-notch-bold" class="mr-2 animate-spin" />
							Detecting...
						{:else}
							<Icon icon="ph:crosshair" class="mr-2" />
							Detect Now
						{/if}
					</Button>
				</div>

				<!-- Divider -->
				<div class="flex items-center gap-3 w-full max-w-xs">
					<div class="flex-1 h-px bg-border/30"></div>
					<span class="text-[11px] text-muted/60 font-medium">or search above</span>
					<div class="flex-1 h-px bg-border/30"></div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Submit footer -->
	{#if locationCoords}
		<div class="shrink-0 p-4 pb-safe border-t border-border/20 bg-surface">
			<SubmitButton {busy} disabled={!canSubmit} onClick={submitLocation}>
				<Icon icon="ph:map-pin" class="mr-1.5" />
				Save Location
			</SubmitButton>
		</div>
	{/if}
</QuickCaptureShell>

<style>
	@media (min-width: 768px) {
		:global(.maplibregl-map) { min-height: 280px !important; }
	}
</style>
