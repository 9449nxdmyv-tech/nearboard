<!--
  @file templates/+page.svelte
  @description Board Templates Marketplace — browse and clone public templates.
  @todos
    - LOW PERF: Cache popular templates at Cloudflare edge
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fly, fade } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { Page, Chip, Button, Block, BlockTitle, Popup, Navbar, NavbarBackLink, Link, List, ListItem, Preloader, Segmented, SegmentedButton } from 'konsta/svelte';
	import { CARD_ENTRANCE } from '$lib/config/animations';
	import { listTemplates, cloneTemplate } from '$lib/firebase';
	import { userStore, showToast } from '$lib/stores';
	import type { TemplateDoc, BoardTemplate } from '$lib/types';
	import Header from '$lib/components/ui/Header.svelte';


	const CATEGORIES: { value: BoardTemplate | 'all'; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'household', label: 'Household' },
		{ value: 'family', label: 'Family' },
		{ value: 'trip', label: 'Trip' },
		{ value: 'team', label: 'Team' },
		{ value: 'creative', label: 'Creative' },
		{ value: 'wishlist', label: 'Wishlist' },
		{ value: 'renovation', label: 'Renovation' }
	];

	const VISIBLE_CATEGORIES = CATEGORIES.slice(0, 4);
	const HIDDEN_CATEGORIES = CATEGORIES.slice(4);

	let showMoreMenu = $state(false);

	const CATEGORY_ICON: Record<string, string> = {
		household: 'ph:house', family: 'ph:users-three', trip: 'ph:suitcase-rolling', team: 'ph:briefcase',
		creative: 'ph:paint-brush', wishlist: 'ph:gift', renovation: 'ph:wrench', blank: 'ph:sparkle'
	};

	let templates = $state<(TemplateDoc & { id: string })[]>([]);
	let selectedCategory = $state<BoardTemplate | 'all'>('all');
	let loading = $state(true);
	let cloning = $state<string | null>(null);
	let error = $state<string | null>(null);
	let previewTemplate = $state<(TemplateDoc & { id: string }) | null>(null);

	// Upvote state (localStorage-backed)
	let upvotes = $state<Record<string, boolean>>({});

	// Close dropdown when clicking outside
	$effect(() => {
		if (!showMoreMenu) return;
		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest('.relative')) {
				showMoreMenu = false;
			}
		};
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});

	function loadUpvotes() {
		if (typeof localStorage === 'undefined') return;
		try {
			const raw = localStorage.getItem('nearboard_template_upvotes');
			if (raw) upvotes = JSON.parse(raw);
		} catch { /* ignore */ }
	}

	function saveUpvotes() {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem('nearboard_template_upvotes', JSON.stringify(upvotes));
	}

	function toggleUpvote(e: Event, templateId: string) {
		e.stopPropagation();
		upvotes = { ...upvotes, [templateId]: !upvotes[templateId] };
		saveUpvotes();
	}

	function getUpvoteCount(template: TemplateDoc & { id: string }): number {
		const localUpvote = upvotes[template.id] ? 1 : 0;
		return template.cloneCount + localUpvote;
	}

	async function loadTemplates(category: BoardTemplate | 'all') {
		loading = true;
		error = null;
		try {
			const cat = category === 'all' ? undefined : category;
			templates = await listTemplates(cat);
		} catch (e) {
			console.error('Failed to load templates:', e);
			error = String(e);
			templates = [];
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const cat = selectedCategory;
		loadTemplates(cat);
	});

	$effect(() => {
		loadUpvotes();
	});

	async function handleClone(templateId: string) {
		const user = $userStore.user;
		if (!user) return;
		cloning = templateId;
		try {
			const boardId = await cloneTemplate(templateId, user.uid, user.displayName || '', user.photoURL || null);
			previewTemplate = null;
			goto(`/board/${boardId}`);
		} catch (err) {
			console.error('Clone failed:', err);
			showToast('Failed to clone template', 'error');
		} finally {
			cloning = null;
		}
	}

	function openPreview(template: TemplateDoc & { id: string }) {
		previewTemplate = template;
	}

	function closePreview() {
		previewTemplate = null;
	}
</script>

<Page>
	<Header title="Templates" />

	<!-- Category filters -->
	<Block class="!py-2 !flex !flex-wrap !gap-2">
		{#each VISIBLE_CATEGORIES as cat}
			<Chip
				onClick={() => { selectedCategory = cat.value; }}
				class="{selectedCategory === cat.value ? '!bg-primary !text-white' : ''}"
				outline={selectedCategory !== cat.value}
			>
				{cat.label}
			</Chip>
		{/each}
		<!-- More dropdown -->
		<div class="relative">
			<Chip
				onClick={() => { showMoreMenu = !showMoreMenu; }}
				outline
			>
				More
			</Chip>
			{#if showMoreMenu}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="absolute top-full right-0 mt-1 bg-card rounded-xl shadow-xl border border-border/50 py-1 z-20 min-w-[140px]"
					onclick={() => { showMoreMenu = false; }}>
					{#each HIDDEN_CATEGORIES as cat}
						<button
							onclick={() => { selectedCategory = cat.value; showMoreMenu = false; }}
							class="w-full text-left px-4 py-2 text-sm hover:bg-surface transition-colors
								{selectedCategory === cat.value ? 'text-primary font-semibold' : 'text-on-surface'}"
						>
							{cat.label}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</Block>

	<div>
		{#if loading}
			<div class="px-4 mt-4 flex flex-col gap-3">
				{#each Array(5) as _, i}
					<div class="flex items-center gap-3 p-4 bg-card rounded-[var(--radius-card)] shadow-card stagger-fade-in" style="--stagger-index: {i}">
						<div class="w-10 h-10 rounded-xl skeleton-shimmer shrink-0"></div>
						<div class="flex-1">
							<div class="h-4 w-2/3 skeleton-shimmer rounded mb-2"></div>
							<div class="h-3 w-1/3 skeleton-shimmer rounded"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else if error}
			<Block class="!text-center !mt-12">
				<p class="text-error text-[13px] font-medium">Failed to load templates.</p>
				<p class="text-[11px] text-muted mt-1">{error}</p>
			</Block>
		{:else if templates.length === 0}
			<Block class="!text-center !mt-12">
				<div class="w-16 h-16 rounded-full bg-surface-1 flex items-center justify-center mx-auto mb-3">
					<Icon icon="ph:clipboard-text" class="text-3xl text-on-surface/60" />
				</div>
				<p class="text-[15px] font-medium text-on-surface">No templates yet</p>
				<p class="text-[13px] text-muted mt-1">Publish one from your board settings!</p>
			</Block>
		{:else}
			<List inset strong>
				{#each templates as template (template.id)}
					{#snippet templateMedia()}
						<Icon icon={CATEGORY_ICON[template.category] ?? 'ph:sparkle'} class="text-lg" />
					{/snippet}
					{#snippet templateAfter()}
						<button
							onclick={(e) => toggleUpvote(e, template.id)}
							class="flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors
								{upvotes[template.id]
									? 'bg-error/5 text-error border border-error/20'
									: 'bg-surface text-muted border border-border hover:border-error/20 hover:text-error/60'}"
							aria-label={upvotes[template.id] ? 'Remove upvote' : 'Upvote template'}
						>
							<Icon icon={upvotes[template.id] ? 'ph:heart-fill' : 'ph:heart'} class="text-sm" />
							<span>{getUpvoteCount(template)}</span>
						</button>
					{/snippet}
					<ListItem
						link
						chevron
						onClick={() => openPreview(template)}
						media={templateMedia}
						after={templateAfter}
					>
						{#snippet title()}
							{template.name}
							{#if template.isCurated}
								<Chip class="!ml-1 !text-[9px] !px-1 !py-0">Curated</Chip>
							{/if}
						{/snippet}
						{#snippet subtitle()}
							by {template.creatorName}
						{/snippet}
						{#snippet text()}
							<span class="line-clamp-2">{template.description}</span>
						{/snippet}
					</ListItem>
				{/each}
			</List>
		{/if}
	</div>
</Page>

<!-- Template preview popup -->
<Popup opened={!!previewTemplate} onBackdropClick={closePreview}>
	{#if previewTemplate}
		{#snippet previewLeft()}
			<NavbarBackLink onClick={closePreview} text="Back" />
		{/snippet}
		{#snippet previewRight()}
			<Link onClick={() => handleClone(previewTemplate!.id)} class={cloning === previewTemplate?.id ? 'opacity-50 pointer-events-none' : ''}>
				{cloning === previewTemplate?.id ? 'Cloning...' : 'Clone'}
			</Link>
		{/snippet}
		<Navbar title={previewTemplate?.name ?? ''} left={previewLeft} right={previewRight} />

		<Block>
			<div class="flex items-center gap-3 mb-4">
				<div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
					<Icon icon={CATEGORY_ICON[previewTemplate.category] ?? 'ph:sparkle'} class="text-xl text-on-surface" />
				</div>
				<div>
					<p class="text-xs text-muted">
						by {previewTemplate.creatorName} &middot; {previewTemplate.cloneCount} clones
					</p>
					{#if previewTemplate.isCurated}
						<Chip class="!mt-1">Curated</Chip>
					{/if}
				</div>
			</div>
			<Chip outline class="!mb-4 !capitalize">{previewTemplate.category}</Chip>
			<p class="text-sm text-on-surface leading-relaxed">{previewTemplate.description}</p>
		</Block>

		<BlockTitle>Sections</BlockTitle>
		<List inset strong>
			{#each previewTemplate.sections as section}
				{#snippet sectionMedia()}
					<Icon icon={CATEGORY_ICON[section.contentType] ?? 'ph:note-pencil'} class="text-base text-on-surface/60" />
				{/snippet}
				<ListItem title={section.title} subtitle={section.contentType} media={sectionMedia} />
			{/each}
		</List>

		<Block>
			<Button large rounded onClick={() => handleClone(previewTemplate!.id)} disabled={cloning === previewTemplate?.id}>
				{cloning === previewTemplate?.id ? 'Creating board...' : 'Clone this template'}
			</Button>
		</Block>
	{/if}
</Popup>
