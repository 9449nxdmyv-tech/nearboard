<!--
  @file profile/+page.svelte
  @description User profile and settings — avatar upload, display name, notification prefs, sign out.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import Icon from '@iconify/svelte';
	import { Page, List, ListItem, ListInput, Button, Block, BlockTitle, Segmented, SegmentedButton } from 'konsta/svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import NativeSwitch from '$lib/components/ui/NativeSwitch.svelte';
	import { userStore, notificationStore, showToast, requestNotificationPermission } from '$lib/stores';
	import { signOut, uploadAvatar, updateDisplayName, updatePhotoURL, updateUserFields, deleteAccount } from '$lib/firebase';
	import { shareContent } from '$lib/native';
	import { getFunctions, httpsCallable } from 'firebase/functions';
	import { app } from '$lib/firebase/app';
	import Header from '$lib/components/ui/Header.svelte';


	const user = $derived($userStore.user);

	let displayName = $state($userStore.user?.displayName ?? '');
	let saving = $state(false);
	let saved = $state(false);
	let uploadingAvatar = $state(false);
	let avatarInputEl = $state<HTMLInputElement | undefined>();
	let referralCopied = $state(false);
	let enablingNotifs = $state(false);
	let quietStart = $state<number | undefined>($userStore.user?.quietHoursStart);
	let quietEnd = $state<number | undefined>($userStore.user?.quietHoursEnd);
	let savingQuiet = $state(false);
	let digestEnabled = $state<boolean>($userStore.user?.digestEnabled !== false);
	let digestTime = $state($userStore.user?.digestTime ?? '07:30');
	let savingDigest = $state(false);
	let sendingPreview = $state(false);
	let confirmDeleteAccount = $state(false);
	let deleting = $state(false);
	const referralLink = $derived(user ? `${window.location.origin}/refer/${user.uid}` : '');
	const detectedTimezone = $derived(user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
	const canNativeShare = $derived(typeof navigator !== 'undefined' && !!navigator.share);

	async function copyReferralLink() {
		await navigator.clipboard.writeText(referralLink);
		referralCopied = true;
		setTimeout(() => { referralCopied = false; }, 2000);
	}

	async function handleSave() {
		if (!user || saving) return;
		saving = true;
		try {
			await updateDisplayName(user.uid, displayName);
			saved = true;
			setTimeout(() => (saved = false), 2000);
		} catch (e) {
			showToast(e instanceof Error ? e.message : 'Failed to update profile');
		} finally {
			saving = false;
		}
	}

	async function handleAvatarSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !user) return;
		if (!file.type.startsWith('image/')) {
			showToast('Please select an image file');
			return;
		}
		uploadingAvatar = true;
		try {
			const photoURL = await uploadAvatar(user.uid, file);
			await updatePhotoURL(user.uid, photoURL);
			userStore.update((s) => s.user ? { ...s, user: { ...s.user, photoURL } } : s);
			showToast('Profile photo updated', 'success');
		} catch (e) {
			showToast(e instanceof Error ? e.message : 'Failed to upload photo');
		} finally {
			uploadingAvatar = false;
			if (avatarInputEl) avatarInputEl.value = '';
		}
	}

	async function handleShareReferral() {
		try {
			await shareContent('Join Nearboard', 'Check out Nearboard!', referralLink);
		} catch {
			await copyReferralLink();
		}
	}

	async function handleDeleteAccount() {
		deleting = true;
		try {
			await deleteAccount();
			goto('/onboarding');
		} catch (e) {
			showToast(e instanceof Error ? e.message : 'Failed to delete account');
		} finally {
			deleting = false;
			confirmDeleteAccount = false;
		}
	}

	async function handleSignOut() {
		await signOut();
		goto('/onboarding');
	}

	async function saveQuietHours() {
		if (!user) return;
		savingQuiet = true;
		await updateUserFields(user.uid, {
			quietHoursStart: quietStart ?? null,
			quietHoursEnd: quietEnd ?? null
		});
		showToast('Quiet hours updated', 'success');
		savingQuiet = false;
	}
</script>

<Page>
	<Header title="Profile" />
	<div>
		<!-- Avatar + email -->
		<Block class="!flex items-center gap-4">
			<button
				onclick={() => avatarInputEl?.click()}
				disabled={uploadingAvatar}
				class="relative shrink-0 group"
				aria-label="Change profile photo"
			>
				{#if user?.photoURL}
					<img
						src={user.photoURL}
						alt={user.displayName}
						class="w-16 h-16 rounded-full object-cover
							{uploadingAvatar ? 'opacity-50' : 'group-hover:opacity-80'} transition-opacity"
						onerror={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'}
					/>
				{:else}
					<div class="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center
						{uploadingAvatar ? 'opacity-50' : 'group-hover:bg-primary/30'} transition-colors">
						<Icon icon="ph:user" class="text-2xl text-on-surface" />
					</div>
				{/if}
				<div class="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-primary text-white
					flex items-center justify-center shadow-sm">
					{#if uploadingAvatar}
						<Icon icon="ph:spinner" class="text-xs animate-spin" />
					{:else}
						<Icon icon="ph:camera-fill" class="text-xs" />
					{/if}
				</div>
				<input
					bind:this={avatarInputEl}
					type="file"
					accept="image/*"
					onchange={handleAvatarSelect}
					class="hidden"
				/>
			</button>
			<div>
				<p class="text-on-surface font-medium">{user?.displayName || 'User'}</p>
				<p class="text-xs text-muted">{user?.email}</p>
				{#if user?.createdAt}
					<p class="text-[11px] text-muted">
						Member since {user.createdAt.toDate().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
					</p>
				{/if}
			</div>
		</Block>

		<!-- Display name -->
		<BlockTitle>Display Name</BlockTitle>
		<List inset strong>
			<ListInput
				type="text"
				placeholder="Your display name"
				value={displayName}
				onInput={(e) => { displayName = e.target.value; }}
				clearButton={displayName.length > 0}
				onClear={() => { displayName = ''; }}
			/>
		</List>
		<Block class="!-mt-2">
			<Button
				rounded
				onClick={handleSave}
				disabled={saving || displayName === (user?.displayName ?? '')}
			>
				{#if saved}
					<Icon icon="ph:check-bold" class="text-base mr-1" />
					Saved
				{:else}
					{saving ? 'Saving...' : 'Save'}
				{/if}
			</Button>
		</Block>

		<!-- Notifications -->
		<BlockTitle>Push Notifications</BlockTitle>
		{#snippet notifMedia()}
			<Icon icon="ph:bell" class="text-xl text-on-surface" />
		{/snippet}
		{#snippet notifAfter()}
			{#if $notificationStore.permission === 'granted'}
				<Icon icon="ph:check-circle-fill" class="text-xl text-success" />
			{:else if $notificationStore.permission === 'denied'}
				<Icon icon="ph:warning-circle" class="text-xl text-warning" />
			{:else}
				<Button small rounded clear
					onClick={async () => {
						if (!user) return;
						enablingNotifs = true;
						await requestNotificationPermission(user.uid);
						enablingNotifs = false;
					}}
					disabled={enablingNotifs}
				>
					{enablingNotifs ? '...' : 'Enable'}
				</Button>
			{/if}
		{/snippet}
		<List inset strong>
			<ListItem
				title="Status"
				after={notifAfter}
				media={notifMedia}
			>
				{#snippet subtitle()}
					{#if $notificationStore.permission === 'granted'}
						Enabled
					{:else if $notificationStore.permission === 'denied'}
						Blocked — enable in browser settings
					{:else}
						Not yet enabled
					{/if}
				{/snippet}
			</ListItem>
		</List>

		<!-- Quiet Hours -->
		{#if $notificationStore.permission === 'granted'}
			<BlockTitle>Quiet Hours</BlockTitle>
			<Block>
				<div class="flex items-center gap-3">
					<div class="flex-1">
						<label class="text-xs font-medium text-muted mb-1 block">From</label>
						<select
							class="w-full py-2.5 px-3 border border-border/60 rounded-lg text-sm bg-card focus:outline-none focus:border-primary"
							bind:value={quietStart}
							onchange={saveQuietHours}
						>
							<option value={undefined}>Off</option>
							{#each Array.from({ length: 24 }, (_, i) => i) as h}
								<option value={h}>{h.toString().padStart(2, '0')}:00</option>
							{/each}
						</select>
					</div>
					<span class="text-xs text-muted mt-5">to</span>
					<div class="flex-1">
						<label class="text-xs font-medium text-muted mb-1 block">To</label>
						<select
							class="w-full py-2.5 px-3 border border-border/60 rounded-lg text-sm bg-card focus:outline-none focus:border-primary"
							bind:value={quietEnd}
							onchange={saveQuietHours}
						>
							<option value={undefined}>Off</option>
							{#each Array.from({ length: 24 }, (_, i) => i) as h}
								<option value={h}>{h.toString().padStart(2, '0')}:00</option>
							{/each}
						</select>
					</div>
				</div>
				{#if detectedTimezone}
					<p class="text-xs text-muted mt-2">Timezone: {detectedTimezone}</p>
				{/if}
			</Block>
		{/if}

		<!-- Email Digest -->
		<BlockTitle>Daily Email Digest</BlockTitle>
		{#snippet digestAfter()}
			<NativeSwitch
				checked={digestEnabled}
				onchange={async () => {
					if (!user) return;
					digestEnabled = !digestEnabled;
					savingDigest = true;
					await updateUserFields(user.uid, { digestEnabled });
					showToast(digestEnabled ? 'Digest enabled' : 'Digest disabled', 'success');
					savingDigest = false;
				}}
				disabled={savingDigest}
			/>
		{/snippet}
		<List inset strong>
			<ListItem
				title="Enable digest"
				subtitle="Get a daily summary of your board activity"
				after={digestAfter}
			/>
			{#if digestEnabled}
				<ListInput
					label="Send time"
					type="time"
					value={digestTime}
					onInput={(e) => { digestTime = e.target.value; }}
					onChange={async () => {
						if (!user) return;
						savingDigest = true;
						await updateUserFields(user.uid, {
							digestTime,
							digestTimezone: detectedTimezone
						});
						showToast('Digest time updated', 'success');
						savingDigest = false;
					}}
				/>
			{/if}
		</List>
		{#if digestEnabled}
			<Block class="!-mt-2">
				{#if detectedTimezone}
					<p class="text-xs text-muted mb-3">Timezone: {detectedTimezone}</p>
				{/if}
				<Button small rounded outline
					onClick={async () => {
						sendingPreview = true;
						try {
							const functions = getFunctions(app());
							const sendPreview = httpsCallable<Record<string, never>, { success: boolean; boardCount: number }>(functions, 'sendDigestPreview', { timeout: 60_000 });
							const result = await sendPreview({});
							showToast(`Preview sent! (${result.data.boardCount} boards)`, 'success');
						} catch (e: unknown) {
							const msg = e instanceof Error ? e.message : 'Failed to send preview';
							showToast(msg.includes('not-found') ? 'No new activity in the last 24 hours' : msg);
						} finally {
							sendingPreview = false;
						}
					}}
					disabled={sendingPreview}
				>
					{sendingPreview ? 'Sending...' : 'Send me a preview'}
				</Button>
			</Block>
		{/if}

		<!-- Quick links -->
		<BlockTitle>Quick Links</BlockTitle>
		{#snippet profileLinkMedia()}<Icon icon="ph:user-circle" class="text-lg text-on-surface" />{/snippet}
		{#snippet feedMedia()}<Icon icon="ph:rss" class="text-lg text-on-surface" />{/snippet}
		{#snippet templatesMedia()}<Icon icon="ph:clipboard-text" class="text-lg text-on-surface" />{/snippet}
		{#snippet todayMedia()}<Icon icon="ph:sun" class="text-lg text-on-surface" />{/snippet}
		<List inset strong>
			{#if user}
				<ListItem title="Your Public Profile" link href="/u/{user.uid}" media={profileLinkMedia} />
			{/if}
			<ListItem title="Global Feed" link href="/feed" media={feedMedia} />
			<ListItem title="Template Marketplace" link href="/templates" media={templatesMedia} />
			<ListItem title="Today Dashboard" link href="/today" media={todayMedia} />
		</List>

		<!-- Affiliate Disclosure -->
		<Block>
			<div class="flex items-start gap-3">
				<Icon icon="ph:info" class="text-lg text-on-surface/50 mt-0.5 shrink-0" />
				<p class="text-xs text-muted leading-relaxed">
					Some shopping or booking links may earn Nearboard a small commission at no extra cost to you.
					This helps keep the app free and ad-free.
				</p>
			</div>
		</Block>

		<!-- Referral -->
		{#if user}
			<BlockTitle>Invite Friends</BlockTitle>
			<Block>
				<p class="text-xs text-muted mb-3">
					Share Nearboard with your friends and help grow our community.
				</p>
				<div class="flex gap-2 items-center">
					<code class="flex-1 text-xs text-on-surface bg-surface-1 px-3 py-2.5 rounded-lg truncate">
						{referralLink}
					</code>
					<Button small rounded onClick={copyReferralLink}>
						{referralCopied ? 'Copied!' : 'Copy'}
					</Button>
					{#if canNativeShare}
						<Button small rounded outline onClick={handleShareReferral}>
							Share
						</Button>
					{/if}
				</div>
			</Block>
		{/if}

		<!-- Sign out -->
		<Block class="!mt-8">
			<Button large rounded clear onClick={handleSignOut}>
				<span class="text-error">Sign Out</span>
			</Button>
		</Block>

		<!-- Danger zone -->
		<BlockTitle class="!text-error">Danger Zone</BlockTitle>
		<Block>
			<Button large rounded outline onClick={() => { confirmDeleteAccount = true; }} disabled={deleting}>
				<span class="text-error">{deleting ? 'Deleting...' : 'Delete Account'}</span>
			</Button>
			<p class="text-xs text-muted mt-2 text-center">This permanently deletes your account and all your data.</p>
		</Block>

		<Block>
			<p class="text-[10px] text-muted text-center">Nearboard v0.1.0</p>
		</Block>
	</div>

	{#if confirmDeleteAccount}
		<ConfirmDialog
			title="Delete your account?"
			message="This permanently deletes your account, boards, and all content. This action cannot be undone."
			confirmLabel="Delete Account"
			onConfirm={handleDeleteAccount}
			onCancel={() => { confirmDeleteAccount = false; }}
		/>
	{/if}
</Page>
