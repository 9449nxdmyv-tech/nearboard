<!--
  @file create-board/+page.svelte
  @description Multi-step board creation with Konsta UI components.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import {
		Page, Navbar, NavbarBackLink, Block, BlockTitle,
		List, ListInput, Button, Progressbar
	} from 'konsta/svelte';
	import { createBoard, inviteContacts, uploadBoardCover } from '$lib/firebase';
	import { userStore, showToast, requestNotificationPermission } from '$lib/stores';
	import { requestContactsPermission, getContacts, type Contact } from '$lib/native/contactsService';
	import { avatarInitial } from '$lib/utils/textFormatter';
	import type { BoardTemplate } from '$lib/types';

	type Step = 'name' | 'cover' | 'invite' | 'confirm';
	const STEPS: Step[] = ['name', 'cover', 'invite', 'confirm'];
	let step = $state<Step>('name');

	const stepIndex = $derived(STEPS.indexOf(step));
	const progress = $derived((stepIndex + 1) / STEPS.length);

	// Step 1: Name & Template
	let name = $state('');
	let template = $state<BoardTemplate>('blank');

	// Step 2: Cover
	let coverUrl = $state<string | null>(null);
	let coverFile = $state<File | null>(null);
	let coverInputEl = $state<HTMLInputElement | undefined>();

	async function handleCoverSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (!target.files?.[0]) return;
		if (coverUrl) URL.revokeObjectURL(coverUrl);
		coverFile = target.files[0];
		coverUrl = URL.createObjectURL(coverFile);
	}

	onDestroy(() => {
		if (coverUrl) URL.revokeObjectURL(coverUrl);
	});

	// Step 3: Invite
	let contacts = $state<Contact[]>([]);
	let selectedContacts = $state<Contact[]>([]);
	let contactsLoading = $state(false);
	let contactsPermissionDenied = $state(false);

	let busy = $state(false);
	let error = $state<string | null>(null);

	const templates: { value: BoardTemplate; label: string; icon: string }[] = [
		{ value: 'household', label: 'Household', icon: 'ph:house' },
		{ value: 'family', label: 'Family', icon: 'ph:users-three' },
		{ value: 'trip', label: 'Trip', icon: 'ph:suitcase-rolling' },
		{ value: 'team', label: 'Team', icon: 'ph:briefcase' },
		{ value: 'creative', label: 'Creative', icon: 'ph:paint-brush' },
		{ value: 'wishlist', label: 'Wishlist', icon: 'ph:gift' },
		{ value: 'renovation', label: 'Renovation', icon: 'ph:wrench' },
		{ value: 'blank', label: 'Blank', icon: 'ph:sparkle' }
	];

	function goBack() {
		if (step === 'name') goto('/');
		else step = STEPS[stepIndex - 1];
	}

	async function nextStep() {
		if (step === 'name' && name.trim()) step = 'cover';
		else if (step === 'cover') { step = 'invite'; loadContacts(); }
		else if (step === 'invite') step = 'confirm';
	}

	async function loadContacts() {
		contactsLoading = true;
		const granted = await requestContactsPermission();
		if (granted) contacts = await getContacts();
		else contactsPermissionDenied = true;
		contactsLoading = false;
	}

	function toggleContact(contact: Contact) {
		const idx = selectedContacts.findIndex(c => c.id === contact.id);
		if (idx >= 0) selectedContacts = selectedContacts.filter(c => c.id !== contact.id);
		else selectedContacts = [...selectedContacts, contact];
	}

	async function handleFinalSubmit() {
		const user = $userStore.user;
		if (!user || !name.trim()) return;

		busy = true;
		error = null;
		try {
			let finalCoverUrl = null;
			if (coverFile) finalCoverUrl = await uploadBoardCover(user.uid, coverFile);

			const boardId = await createBoard(name.trim(), template, user.uid, finalCoverUrl, user.displayName || '', user.photoURL || null);

			if (selectedContacts.length > 0) {
				const invites = selectedContacts.map(c => ({
					name: c.displayName,
					identifier: c.emails[0] || c.phoneNumbers[0] || 'unknown'
				}));
				await inviteContacts(boardId, user.uid, invites);
			}

			if (coverUrl) URL.revokeObjectURL(coverUrl);
			showToast('Board created!', 'success');
			requestNotificationPermission(user.uid).catch(() => {});
			goto(`/board/${boardId}`);
		} catch (e) {
			error = 'Failed to create board. Please try again.';
			console.error(e);
		} finally {
			busy = false;
		}
	}
</script>

{#snippet backLink()}
	<NavbarBackLink onClick={goBack} text={step === 'name' ? 'Cancel' : 'Back'} />
{/snippet}

{#snippet title()}New Board{/snippet}

<Page>
	<Navbar
		title="New Board"
		left={backLink}
	/>

	<!-- Progress bar -->
	<Progressbar progress={progress} />

	<div class="flex-1 flex flex-col overflow-hidden">
		{#if step === 'name'}
			<div in:fly={{ x: 20, duration: 250 }} class="flex-1 flex flex-col">
				<BlockTitle>Name your board</BlockTitle>
				<List inset strong outline>
					<ListInput
						outline
						label="Board name"
						type="text"
						placeholder="e.g. Dream Home Project"
						value={name}
						onInput={(e) => { name = e.target.value; }}
						clearButton={name.length > 0}
						onClear={() => { name = ''; }}
					/>
				</List>

				<BlockTitle>Template</BlockTitle>
				<Block>
					<div class="grid grid-cols-4 gap-2">
						{#each templates as t (t.value)}
							<button
								onclick={() => { template = t.value; }}
								class="flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-colors
									{template === t.value
										? 'bg-primary/10 border-primary'
										: 'border-border-light active:bg-surface-1'}"
							>
								<div class="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
									<Icon icon={t.icon} class="text-sm text-primary" />
								</div>
								<span class="text-[11px] font-medium text-on-surface">{t.label}</span>
							</button>
						{/each}
					</div>
				</Block>
			</div>

		{:else if step === 'cover'}
			<div in:fly={{ x: 20, duration: 250 }} class="flex-1 flex flex-col">
				<BlockTitle>Board cover</BlockTitle>
				<Block>
					<p class="text-xs text-muted mb-3">Optional: add a photo to give it some life.</p>

					<input type="file" accept="image/*" class="hidden" bind:this={coverInputEl} onchange={handleCoverSelect} />

					<button
						type="button"
						onclick={() => coverInputEl?.click()}
						class="w-full h-40 rounded-xl border-2 border-dashed border-border-light
							hover:border-primary/50 transition-all cursor-pointer overflow-hidden bg-surface-1"
					>
						{#if coverUrl}
							<img src={coverUrl} alt="Cover" class="w-full h-full object-cover" />
						{:else}
							<div class="flex flex-col items-center justify-center gap-2 h-full">
								<div class="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center">
									<Icon icon="ph:image-plus" class="text-xl text-on-surface/60" />
								</div>
								<span class="text-xs text-muted">Tap to upload</span>
							</div>
						{/if}
					</button>
				</Block>
			</div>

		{:else if step === 'invite'}
			<div in:fly={{ x: 20, duration: 250 }} class="flex-1 flex flex-col overflow-hidden">
				<BlockTitle>Invite people</BlockTitle>
				<Block>
					<p class="text-xs text-muted">Shared boards are more fun. You can also invite via link later.</p>
				</Block>

				{#if contactsPermissionDenied}
					<Block>
						<div class="flex items-center gap-3 p-3 rounded-xl bg-warning/10 border border-warning/20">
							<Icon icon="ph:lock-key" class="text-xl text-warning shrink-0" />
							<div class="flex-1">
								<p class="text-sm font-medium">Contacts access denied</p>
								<p class="text-xs text-muted">You can invite via link after creating.</p>
							</div>
						</div>
					</Block>
				{:else if contactsLoading}
					<div class="flex-1 flex flex-col items-center justify-center gap-2">
						<span class="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full"></span>
						<span class="text-xs text-muted">Accessing contacts...</span>
					</div>
				{:else}
					<List inset strong class="flex-1 overflow-y-auto">
						{#each contacts as contact (contact.id)}
							{@const isSelected = selectedContacts.some(c => c.id === contact.id)}
							<button
								onclick={() => toggleContact(contact)}
								class="flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors
									{isSelected ? 'bg-primary/5' : 'active:bg-surface-1'}"
							>
								<div class="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent font-bold text-sm shrink-0">
									{avatarInitial(contact.displayName)}
								</div>
								<div class="flex-1 min-w-0">
									<p class="text-sm font-medium truncate">{contact.displayName}</p>
									<p class="text-[11px] text-muted truncate">{contact.emails[0] || contact.phoneNumbers[0]}</p>
								</div>
								{#if isSelected}
									<Icon icon="ph:check-circle" class="text-lg text-accent shrink-0" />
								{:else}
									<div class="w-5 h-5 rounded-full border-2 border-border shrink-0"></div>
								{/if}
							</button>
						{/each}
						{#if contacts.length === 0}
							<div class="py-6 text-center text-sm text-muted italic">No contacts found.</div>
						{/if}
					</List>
				{/if}
			</div>

		{:else if step === 'confirm'}
			<div in:fly={{ x: 20, duration: 250 }} class="flex-1 flex flex-col">
				<BlockTitle>Ready to go?</BlockTitle>
				<Block>
					<div class="flex rounded-xl border border-border-light overflow-hidden bg-surface-1">
						<div class="w-24 shrink-0 bg-primary/5 flex items-center justify-center">
							{#if coverUrl}
								<img src={coverUrl} alt="" class="w-full h-full object-cover" />
							{:else}
								<Icon icon={templates.find(t => t.value === template)?.icon || 'ph:sparkle'} class="text-3xl text-on-surface" />
							{/if}
						</div>
						<div class="p-3 flex-1 min-w-0">
							<h2 class="text-base font-bold text-on-surface truncate">{name}</h2>
							<span class="text-[11px] text-muted capitalize">{template}</span>
							<div class="flex items-center gap-1.5 mt-2">
								<Icon icon="ph:users" class="text-sm text-on-surface/60" />
								<span class="text-xs text-muted">
									{selectedContacts.length + 1} {selectedContacts.length === 0 ? 'member' : 'members'}
								</span>
							</div>
						</div>
					</div>

					{#if selectedContacts.length > 0}
						<div class="mt-4">
							<p class="text-[10px] font-bold text-muted uppercase tracking-widest mb-2">Pending Invites</p>
							<div class="flex flex-wrap gap-1.5">
								{#each selectedContacts as contact (contact.id)}
									<span class="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-[11px] font-medium">
										{contact.displayName}
									</span>
								{/each}
							</div>
						</div>
					{/if}
				</Block>
			</div>
		{/if}

		{#if error}
			<div transition:fade={{ duration: 150 }}>
				<Block>
					<p class="text-sm text-error text-center">{error}</p>
				</Block>
			</div>
		{/if}

		<!-- Action button -->
		<div class="shrink-0 px-4 pt-2 pb-4 pb-safe">
			{#if step === 'confirm'}
				<Button large rounded onClick={handleFinalSubmit} disabled={busy}>
					{busy ? 'Creating...' : 'Create Board'}
				</Button>
			{:else}
				<Button large rounded onClick={nextStep} disabled={step === 'name' && !name.trim()}>
					{step === 'invite' ? 'Skip & Continue' : 'Next'}
				</Button>
			{/if}
		</div>
	</div>
</Page>
