<!--
  @file MapView.svelte
  @description Reusable interactive map component using MapLibre GL JS.
               Shows a location marker, optional user position, and supports click-to-place.
               Uses OpenFreeMap tiles (free, no API key).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type maplibreglType from 'maplibre-gl';

	let {
		latitude,
		longitude,
		zoom = 15,
		interactive = false,
		showUserLocation = false,
		markerColor = '#6c63ff',
		height = '200px',
		class: className = '',
		onMapClick,
		onMapError
	}: {
		latitude: number;
		longitude: number;
		zoom?: number;
		interactive?: boolean;
		showUserLocation?: boolean;
		markerColor?: string;
		height?: string;
		class?: string;
		onMapClick?: (lat: number, lng: number) => void;
		onMapError?: () => void;
	} = $props();

	let containerEl = $state<HTMLDivElement | undefined>();
	let map: maplibreglType.Map | null = null;
	let marker: maplibreglType.Marker | null = null;
	let userMarker: maplibreglType.Marker | null = null;

	onMount(() => {
		if (!containerEl) return;

		let destroyed = false;

		(async () => {
			const maplibregl = (await import('maplibre-gl')).default;
			if (destroyed) return;

			try {
				map = new maplibregl.Map({
					container: containerEl!,
					style: 'https://tiles.openfreemap.org/styles/liberty',
					center: [longitude, latitude],
					zoom,
					interactive,
					attributionControl: false
				});

				map.on('error', () => {
					if (!destroyed) onMapError?.();
				});
			} catch {
				if (!destroyed) onMapError?.();
				return;
			}

			// Main location marker
			marker = new maplibregl.Marker({ color: markerColor })
				.setLngLat([longitude, latitude])
				.addTo(map);

			// User location blue dot
			if (showUserLocation && navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(
					(pos) => {
						if (!map) return;
						const userMarkerEl = document.createElement('div');
						userMarkerEl.className = 'mapview-user-dot';
						userMarker = new maplibregl.Marker({ element: userMarkerEl })
							.setLngLat([pos.coords.longitude, pos.coords.latitude])
							.addTo(map);
					},
					() => { /* silently ignore */ },
					{ timeout: 8000 }
				);
			}

			// Click to place marker
			if (interactive && onMapClick) {
				map.on('click', (e) => {
					onMapClick(e.lngLat.lat, e.lngLat.lng);
				});
			}

			if (interactive) {
				map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
			}
		})();

		return () => {
			destroyed = true;
			marker?.remove();
			userMarker?.remove();
			map?.remove();
			map = null;
		};
	});

	// React to coordinate changes
	$effect(() => {
		if (!map || !marker) return;
		const lngLat: [number, number] = [longitude, latitude];
		marker.setLngLat(lngLat);
		if (interactive) {
			map.flyTo({ center: lngLat, duration: 400 });
		}
	});
</script>

<div
	bind:this={containerEl}
	class="w-full rounded-card overflow-hidden {className}"
	style="height: {height};"
	role={interactive ? 'application' : 'img'}
	aria-label="Map showing {latitude.toFixed(4)}, {longitude.toFixed(4)}"
></div>

<style>
	:global(.mapview-user-dot) {
		width: 14px;
		height: 14px;
		background: var(--color-map-user-dot);
		border: 2.5px solid white;
		border-radius: 50%;
		box-shadow: var(--shadow-map-marker-blue), var(--shadow-map-global-black);
	}

	:global(.maplibregl-ctrl-bottom-left),
	:global(.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib) {
		display: none !important;
	}
</style>
