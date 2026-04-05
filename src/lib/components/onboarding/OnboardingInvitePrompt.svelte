<!--
  @file OnboardingInvitePrompt.svelte
  @description Full-screen invite prompt during onboarding.
               Uses native contacts when available, falls back to share link.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { PAGE_TRANSITION } from '$lib/config/animations';
	import { userStore, showToast } from '$lib/stores';
	import { inviteContacts, generateInviteLink } from '$lib/firebase';
	import { updateDoc, doc } from 'firebase/firestore';
	import { db } from '$lib/firebase/app';
	import {
		requestContactsPermission,
		getContacts,
		searchContacts,
		type Contact
	} from '$lib/native/contactsService';

	interface Props {
		boardId: string;
		preselectedNames?: string[];
		oncomplete: () => void;
		onskip: () => void;
	}

	let { boardId, preselectedNames = [], oncomplete, onskip }: Props = $props();

	let contacts = $state<Contact[]>([]);
	let searchQuery = $state('');
	let selectedIds = $state<Set<string>>(new Set());
	let hasContactsAccess = $state(false);
	let loading = $state(true);
	let sending = $state(false);
	let linkCopied = $state(false);

	const inviteLink = $derived(generateInviteLink(boardId));

	const filteredContacts = $derived(
		searchQuery ? searchContacts(contacts, searchQuery) : contacts
	);

	onMount(async () => {
		const granted = await requestContactsPermission();
		hasContactsAccess = granted;
		if (granted) {
			contacts = await getContacts();
		}
		loading = false;
	});

	function toggleContact(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	}

	async function handleInvite() {
		const user = $userStore.user;
		if (!user || selectedIds.size === 0) return;
		sending = true;
		try {
			const toInvite = contacts
				.filter((c) => selectedIds.has(c.id))
				.map((c) => ({
					name: c.displayName,
					identifier: c.emails[0] ?? c.phoneNumbers[0] ?? ''
				}))
				.filter((c) => c.identifier);

			if (toInvite.length > 0) {
				await inviteContacts(boardId, user.uid, toInvite);
			}
			oncomplete();
		} catch (err) {
			console.error('Invite failed:', err);
			showToast('Failed to send invites', 'error');
			sending = false;
		}
	}

	async function handleSkip() {
		const user = $userStore.user;
		if (user) {
			updateDoc(doc(db(), 'users', user.uid), { hasSkippedInvite: true }).catch(console.error);
		}
		onskip();
	}

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(inviteLink);
			linkCopied = true;
			showToast('Link copied!');
			setTimeout(() => { linkCopied = false; }, 2000);
		} catch {
			showToast('Failed to copy link', 'error');
		}
	}
</script>

<div
	class="fixed inset-0 z-50 flex flex-col bg-surface px-6 pt-safe"
	in:fade={{ duration: PAGE_TRANSITION.duration }}
>
	<div class="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full">
		<div class="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center mb-4">
			<Icon icon="ph:users" class="text-2xl text-accent" />
		</div>
		<h1 class="font-display text-2xl font-semibold text-primary mb-2 text-center">
			Who are you doing this with?
		</h1>
		<p class="text-sm text-muted mb-6 text-center">
			Invite someone to make this board shared.
		</p>

		{#if loading}
			<div class="flex items-center gap-2 text-muted text-sm">
				<Icon icon="ph:circle-notch-bold" class="animate-spin" />
				Loading contacts...
			</div>
		{:else if hasContactsAccess && contacts.length > 0}
			<!-- Search -->
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search contacts..."
				class="w-full py-3 px-4 border border-border rounded-lg text-sm
					bg-surface placeholder:text-muted focus:outline-none focus:border-accent
					transition-colors mb-4"
			/>

			<!-- Contact list -->
			<div class="w-full flex-1 overflow-y-auto max-h-[40vh] space-y-1 mb-4">
				{#each filteredContacts as contact (contact.id)}
					<button
						class="w-full flex items-center gap-3 p-2.5 rounded-card transition-all
							{selectedIds.has(contact.id) ? 'border border-accent bg-accent/5' : 'border border-transparent bg-card hover:bg-surface'}"
						onclick={() => toggleContact(contact.id)}
					>
						<div class="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
							<span class="text-xs font-semibold text-accent">
								{contact.displayName.charAt(0).toUpperCase()}
							</span>
						</div>
						<span class="text-sm text-primary flex-1 text-left truncate">
							{contact.displayName}
						</span>
						<Icon
							icon={selectedIds.has(contact.id) ? 'ph:check-circle-fill' : 'ph:circle'}
							class="text-lg {selectedIds.has(contact.id) ? 'text-accent' : 'text-border'}"
						/>
					</button>
				{/each}
			</div>

			<button
				onclick={handleInvite}
				disabled={selectedIds.size === 0 || sending}
				class="w-full py-3.5 bg-accent text-white rounded-lg font-medium
					disabled:opacity-50 active:scale-[0.98] transition-transform
					flex items-center justify-center gap-2"
			>
				{#if sending}
					<Icon icon="ph:circle-notch-bold" class="animate-spin" />
					Sending...
				{:else}
					<Icon icon="ph:share-network" class="text-base" />
					Invite {selectedIds.size || ''} {selectedIds.size === 1 ? 'person' : 'people'}
				{/if}
			</button>
		{:else}
			<!-- Fallback: share link -->
			<div class="w-full flex flex-col items-center gap-4">
				<div class="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
					<Icon icon="ph:link" class="text-xl text-accent" />
				</div>
				<p class="text-sm text-primary text-center leading-relaxed">
					Share this link to invite someone:
				</p>
				<div class="w-full flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2.5">
					<Icon icon="ph:link-simple" class="text-sm text-muted/25 shrink-0" />
					<span class="text-xs text-muted truncate flex-1">{inviteLink}</span>
					<button
						onclick={copyLink}
						class="shrink-0 px-3 py-1.5 bg-accent text-white text-xs rounded-full font-medium
							active:scale-95 transition-transform flex items-center gap-1"
					>
						<Icon icon={linkCopied ? 'ph:check-bold' : 'ph:copy'} class="text-xs" />
						{linkCopied ? 'Copied!' : 'Copy'}
					</button>
				</div>
			</div>
		{/if}

		<button
			onclick={handleSkip}
			class="mt-4 w-full py-2.5 text-muted hover:text-primary transition-colors text-sm"
		>
			Skip for now
		</button>
	</div>
</div>
