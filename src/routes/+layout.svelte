<!--
  @file +layout.svelte
  @description Root layout with Konsta UI App wrapper, Konsta Tabbar, ChatCapture bar, and navigation.
-->
<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { App, Tabbar, TabbarLink } from 'konsta/svelte';
	import Icon from '@iconify/svelte';
	import { TAB_ITEMS } from '$lib/config/constants';
	import {
		userStore,
		initAuth,
		subscribeToBoardsForUser,
		unsubscribeBoards,
		initNotifications,
		boardStore,
		showToast
	} from '$lib/stores';
	import { completeEmailLinkSignIn, addContent } from '$lib/firebase';
	import { extractMetadata } from '$lib/api';
	import { detectFromUrl, refineDetection } from '$lib/utils/contentDetection';
	import { initShareHandler, processSharedImages } from '$lib/native';
	import { hapticLight } from '$lib/utils/haptics';
	import { clearBadge, isNativePush } from '$lib/native/pushService';
	import type { CaptureType } from '$lib/components/ui/CaptureSheet.svelte';
	import CaptureSheet from '$lib/components/ui/CaptureSheet.svelte';
	import ToastContainer from '$lib/components/ui/ToastContainer.svelte';
	import InstallBanner from '$lib/components/ui/InstallBanner.svelte';
	import OfflineBanner from '$lib/components/ui/OfflineBanner.svelte';
	import KeyboardShortcutsHelp from '$lib/components/ui/KeyboardShortcutsHelp.svelte';

	import QuickCapturePhotoSheet from '$lib/components/ui/QuickCapturePhotoSheet.svelte';
	import QuickCaptureVideoSheet from '$lib/components/ui/QuickCaptureVideoSheet.svelte';
	import QuickCaptureVoiceSheet from '$lib/components/ui/QuickCaptureVoiceSheet.svelte';
	import QuickCaptureListSheet from '$lib/components/ui/QuickCaptureListSheet.svelte';
	import QuickCapturePollSheet from '$lib/components/ui/QuickCapturePollSheet.svelte';
	import QuickCaptureLocationSheet from '$lib/components/ui/QuickCaptureLocationSheet.svelte';
	import type { NoteContentDoc, LinkContentDoc, ProductContentDoc, PageMetadata } from '$lib/types';

	let { children }: { children: Snippet } = $props();

	// ─── Capture state ──────────────────────────────────────────
	let captureSheetType = $state<CaptureType | null>(null);
	let captureTargetBoardId = $state('');
	let showCaptureSheet = $state(false);

	const TAB_PATHS = ['/', '/feed', '/people', '/profile'];
	const showTabbar = $derived(
		!!$userStore.user &&
		!$userStore.loading &&
		(TAB_PATHS.includes($page.url.pathname) || $page.url.pathname.startsWith('/board/'))
	);
	const currentPath = $derived($page.url.pathname);

	// Bottom padding: tabbar + safe area for home indicator
	// ~100px+ total: tabbar (~50px) + pb-safe min (16px) + FAB protrusion (8px) + visual buffer
	const bottomPaddingStyle = $derived(showTabbar ? 'padding-bottom: 120px' : '');

	/** Extract boardId from route params */
	const routeBoardId = $derived(
		$page.url.pathname.startsWith('/board/')
			? $page.params.boardId ?? null
			: null
	);

	/** Selected board for capture — defaults to route board or first board */
	let selectedBoardId = $state<string | null>(null);

	$effect(() => {
		if (routeBoardId) {
			selectedBoardId = routeBoardId;
		} else if (!selectedBoardId && $boardStore.boards.length > 0) {
			// Pick the most recently active board
			const sorted = [...$boardStore.boards].sort((a, b) => {
				const aTime = a.lastActivityAt?.toMillis?.() ?? 0;
				const bTime = b.lastActivityAt?.toMillis?.() ?? 0;
				return bTime - aTime;
			});
			selectedBoardId = sorted[0].id;
		}
	});

	function resolveBoardId(): string | null {
		return selectedBoardId || routeBoardId || ($boardStore.boards.length === 1 ? $boardStore.boards[0].id : null);
	}

	// ─── ChatCapture handlers ────────────────────────────────────
	async function handleChatSubmit(data: { type: 'note'; text: string } | { type: 'link'; url: string; meta?: PageMetadata }) {
		const user = $userStore.user;
		const bid = resolveBoardId();
		if (!user || !bid) {
			showToast('Select a board first', 'error');
			return;
		}

		// Close the sheet immediately so the backdrop doesn't block the UI
		showCaptureSheet = false;

		// Navigate to the board first so the listener is ready for the new content
		if (!currentPath.startsWith(`/board/${bid}`)) goto(`/board/${bid}`);

		try {
			if (data.type === 'note') {
				await addContent(bid, {
					type: 'note',
					text: data.text,
					boardId: bid,
					authorId: user.uid,
					authorName: user.displayName || '',
					authorPhotoURL: user.photoURL,
					userIntent: 'Quick capture'
				} as Omit<NoteContentDoc, 'id' | 'createdAt'>);
				showToast('Note added!', 'success');
			} else {
				const url = data.url;
				const domain = new URL(url).hostname.replace('www.', '');
				// Use pre-fetched meta or fetch fresh
				const meta = data.meta ?? await extractMetadata(url);

				// Run content type detection with metadata refinement
				const urlDetection = detectFromUrl(url);
				const refined = refineDetection(urlDetection, {
					price: meta?.price,
					type: meta?.type,
					youtubeId: meta?.youtubeId,
					enrichment: meta?.enrichment ? { kind: meta.enrichment.kind } : null
				});

				const authorBase = {
					boardId: bid,
					authorId: user.uid,
					authorName: user.displayName || '',
					authorPhotoURL: user.photoURL,
					userIntent: 'Quick capture'
				};

				if (refined.type === 'product' && (meta?.price || urlDetection.type === 'product')) {
					// Save as product card with price tracking fields
					const productData: Omit<ProductContentDoc, 'id' | 'createdAt'> = {
						type: 'product',
						url,
						title: meta?.title || url,
						description: meta?.description || null,
						image: meta?.image || null,
						price: meta?.price || '',
						domain,
						favicon: null,
						enrichment: meta?.enrichment || null,
						originalPrice: meta?.price || null,
						lastCheckedPrice: meta?.price || null,
						lastCheckedAt: null,
						priceDrop: false,
						...authorBase
					} as unknown as Omit<ProductContentDoc, 'id' | 'createdAt'>;
					await addContent(bid, productData);
					showToast('Product saved!', 'success');
				} else {
					// Save as link card with enrichment data — enrichment drives the display
					await addContent(bid, {
						type: 'link',
						url,
						title: meta?.title || url,
						description: meta?.description || null,
						image: meta?.image || null,
						domain,
						favicon: null,
						enrichment: meta?.enrichment || null,
						...authorBase
					} as Omit<LinkContentDoc, 'id' | 'createdAt'>);
					showToast('Link added!', 'success');
				}
			}
		} catch {
			showToast('Failed to add content', 'error');
		}
	}

	function handleCapture(type: CaptureType) {
		const bid = resolveBoardId();
		if (!bid) {
			showToast('Select a board first', 'error');
			return;
		}
		captureTargetBoardId = bid;
		captureSheetType = type;
		showCaptureSheet = false;
	}

	function handleCaptureSheetClose() {
		const bid = captureTargetBoardId;
		captureSheetType = null;
		if (bid && !currentPath.startsWith(`/board/${bid}`)) goto(`/board/${bid}`);
	}

	// ─── Auth & lifecycle ────────────────────────────────────────
	onMount(() => {
		let unsubscribe: (() => void) | undefined;
		let appResumeCleanup: (() => void) | undefined;

		completeEmailLinkSignIn()
			.catch((err) => {
				console.error('Email link sign-in failed:', err);
			})
			.finally(() => {
				unsubscribe = initAuth();
			});

		if (isNativePush()) {
			clearBadge();
			import('@capacitor/app').then(({ App }) => {
				const handle = App.addListener('resume', () => clearBadge());
				appResumeCleanup = () => { handle.then((h) => h.remove()); };
			}).catch(() => {});
		}

		return () => {
			unsubscribe?.();
			appResumeCleanup?.();
		};
	});

	$effect(() => {
		if (!browser) return;
		const { user, loading } = $userStore;
		const path = $page.url.pathname;
		if (loading) return;

		const publicPaths = ['/onboarding', '/b/', '/u/', '/join/', '/refer/', '/share-target'];
		const isPublicPath = publicPaths.some((p) => path.startsWith(p));
		const needsAgeGate = user && user.birthDate === null;

		if (!user && !isPublicPath) {
			goto('/onboarding', { replaceState: true });
		} else if (user && path === '/onboarding' && !path.startsWith('/onboarding/')) {
			if (needsAgeGate) {
				if ($page.url.searchParams.get('step') !== 'age') {
					goto('/onboarding?step=age', { replaceState: true });
				}
			} else {
				goto('/', { replaceState: true });
			}
		} else if (needsAgeGate && !isPublicPath) {
			goto('/onboarding?step=age', { replaceState: true });
		}

		if (user) {
			subscribeToBoardsForUser(user.uid);
			initNotifications(user.uid);
			initShareHandler(async (content, boardId) => {
				const handled = await processSharedImages(
					content, boardId, user.uid,
					user.displayName || '', user.photoURL || null
				);
				if (handled) return;
				const params = new URLSearchParams();
				if (content.title) params.set('title', content.title);
				if (content.text) params.set('text', content.text);
				if (content.url) params.set('url', content.url);
				goto(`/share-target?${params.toString()}`);
			});
		} else {
			unsubscribeBoards();
		}
	});

	$effect(() => {
		if (!browser) return;
		const { user, loading } = $userStore;
		const path = $page.url.pathname;
		if (loading || !user || user.birthDate === null) return;

		const needsOnboarding = !user.onboardingCompletedAt &&
			$boardStore.boards.length === 0 &&
			!$boardStore.loading;

		if (needsOnboarding && (path === '/' || (path === '/onboarding' && !path.startsWith('/onboarding/')))) {
			goto('/onboarding/intent', { replaceState: true });
		}
	});
</script>

<svelte:head>
	<title>Nearboard</title>
</svelte:head>

<App theme="ios" safeAreas dark={false}>
	<ToastContainer />
	<OfflineBanner />
	<InstallBanner />
	<KeyboardShortcutsHelp />

	{#if $userStore.loading}
		<div class="flex items-center justify-center min-h-screen">
			<h1 class="text-2xl font-semibold">Nearboard</h1>
		</div>
	{:else if $userStore.user || $page.url.pathname.startsWith('/onboarding') || $page.url.pathname.startsWith('/b/') || $page.url.pathname.startsWith('/join/') || $page.url.pathname.startsWith('/refer/') || $page.url.pathname.startsWith('/u/')}
		<div class="flex-1" style={bottomPaddingStyle}>
			{@render children()}
		</div>

		<!-- Bottom Tabbar with center FAB -->
		{#if showTabbar}
			<div class="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-border-light pb-safe">
				<div class="relative">
					<!-- Center FAB button -->
					<button
						onclick={() => { showCaptureSheet = true; hapticLight(); }}
						class="absolute left-1/2 -translate-x-1/2 -top-2 z-10
							w-12 h-12 rounded-full bg-primary text-white shadow-lg shadow-primary/30
							flex items-center justify-center press-scale
							active:shadow-sm transition-all"
						aria-label="Add content"
					>
						<Icon icon="ph:plus-bold" class="text-xl" />
					</button>

					<Tabbar labels icons class="!relative !z-auto !bg-surface !border-t-0">
						{#each TAB_ITEMS.slice(0, 2) as item (item.href)}
							{@const isActive = currentPath === item.href}
							{#snippet tabIcon()}
								<Icon icon={isActive ? item.iconActive : item.icon} class="text-2xl" />
							{/snippet}
							{#snippet tabLabel()}
								{item.label}
							{/snippet}
							<TabbarLink
								active={isActive}
								onclick={() => { goto(item.href); hapticLight(); }}
								icon={tabIcon}
								label={tabLabel}
							/>
						{/each}
						<!-- Spacer for center FAB -->
						{#each [null] as _}
							{#snippet spacerIcon()}<div class="w-6 h-6"></div>{/snippet}
							{#snippet spacerLabel()}<span class="text-[10px] text-transparent">Add</span>{/snippet}
							<TabbarLink icon={spacerIcon} label={spacerLabel} />
						{/each}
						{#each TAB_ITEMS.slice(2) as item (item.href)}
							{@const isActive = currentPath === item.href}
							{#snippet tabIcon2()}
								<Icon icon={isActive ? item.iconActive : item.icon} class="text-2xl" />
							{/snippet}
							{#snippet tabLabel2()}
								{item.label}
							{/snippet}
							<TabbarLink
								active={isActive}
								onclick={() => goto(item.href)}
								icon={tabIcon2}
								label={tabLabel2}
							/>
						{/each}
					</Tabbar>
				</div>
			</div>
		{/if}

		<!-- Capture sheet overlay -->
		{#if showCaptureSheet}
			<CaptureSheet
				boards={$boardStore.boards}
				{selectedBoardId}
				onSelectBoard={(id) => { selectedBoardId = id; }}
				onSubmit={handleChatSubmit}
				onCapture={handleCapture}
				onClose={() => { showCaptureSheet = false; }}
			/>
		{/if}
	{/if}

	<!-- Capture sheets (inside App for safe area handling) -->
	{#if captureSheetType === 'photo' && captureTargetBoardId}
		<QuickCapturePhotoSheet boardId={captureTargetBoardId} onClose={handleCaptureSheetClose} />
	{/if}

	{#if captureSheetType === 'video' && captureTargetBoardId}
		<QuickCaptureVideoSheet boardId={captureTargetBoardId} onClose={handleCaptureSheetClose} />
	{/if}

	{#if captureSheetType === 'voice' && captureTargetBoardId}
		<QuickCaptureVoiceSheet boardId={captureTargetBoardId} onClose={handleCaptureSheetClose} />
	{/if}

	{#if captureSheetType === 'list' && captureTargetBoardId}
		<QuickCaptureListSheet boardId={captureTargetBoardId} onClose={handleCaptureSheetClose} />
	{/if}

	{#if captureSheetType === 'poll' && captureTargetBoardId}
		<QuickCapturePollSheet boardId={captureTargetBoardId} onClose={handleCaptureSheetClose} />
	{/if}

	{#if captureSheetType === 'location' && captureTargetBoardId}
		<QuickCaptureLocationSheet boardId={captureTargetBoardId} onClose={handleCaptureSheetClose} />
	{/if}
</App>
