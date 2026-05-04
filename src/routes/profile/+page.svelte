<!--
  @file profile/+page.svelte
  @description User profile and settings — avatar upload, display name, notification prefs, sign out.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import Icon from '@iconify/svelte';
	import { Page, List, ListItem, ListInput, Button, Block, BlockTitle, Segmented, SegmentedButton } from 'konsta/svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { Toggle } from 'konsta/svelte';
	import { hapticLight } from '$lib/utils/haptics';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import { userStore, notificationStore, showToast, requestNotificationPermission, globalExperience } from '$lib/stores';
	import { signOut, uploadAvatar, updateDisplayName, updatePhotoURL, updateUserFields, deleteAccount } from '$lib/firebase';
	import { EXPERIENCE_PRESETS } from '$lib/config/constants';
	import { applyPreset, detectPreset } from '$lib/utils/experienceResolver';
	import type { ScrollBehavior, VideoPlayback, FeedOrder, LayoutStyle, ExperiencePreset, UserExperiencePreferences } from '$lib/types/firestore';
	import { shareContent } from '$lib/native';
	import { getFunctions, httpsCallable } from 'firebase/functions';
	import { app } from '$lib/firebase/app';
	import Header from '$lib/components/ui/Header.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import PlusBadge from '$lib/components/ui/PlusBadge.svelte';
	import { isPlus, PLUS_PRICING } from '$lib/utils/tier';


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
	// ── Experience settings ──
	const experience = $derived($globalExperience);
	let savingExperience = $state(false);

	async function saveExperience(updates: Partial<UserExperiencePreferences>) {
		if (!user) return;
		savingExperience = true;
		const current = user.experiencePreferences ?? {};
		const merged = { ...current, ...updates, updatedAt: null };
		// Detect preset after merge
		const full: UserExperiencePreferences = {
			scrollBehavior: merged.scrollBehavior ?? experience.scrollBehavior,
			videoPlayback: merged.videoPlayback ?? experience.videoPlayback,
			feedOrder: merged.feedOrder ?? experience.feedOrder,
			layoutStyle: merged.layoutStyle ?? experience.layoutStyle
		};
		full.preset = detectPreset(full);
		await updateUserFields(user.uid, { experiencePreferences: full });
		userStore.update((s) => s.user ? { ...s, user: { ...s.user, experiencePreferences: full } } : s);
		savingExperience = false;
	}

	async function selectPreset(preset: 'calm' | 'balanced' | 'lively') {
		if (!user) return;
		hapticLight();
		const prefs = applyPreset(preset);
		savingExperience = true;
		await updateUserFields(user.uid, { experiencePreferences: prefs });
		userStore.update((s) => s.user ? { ...s, user: { ...s.user, experiencePreferences: prefs } } : s);
		showToast(`${preset.charAt(0).toUpperCase() + preset.slice(1)} experience applied`, 'success');
		savingExperience = false;
	}

	const referralLink = $derived(user ? `${window.location.origin}/refer/${user.uid}` : '');
	const detectedTimezone = $derived(user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
	const canNativeShare = $derived(typeof navigator !== 'undefined' && !!navigator.share);

	async function copyReferralLink() {
		const ok = await copyToClipboard(referralLink, 'Referral link copied!');
		if (ok) { referralCopied = true; setTimeout(() => { referralCopied = false; }, 2000); }
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
	<div class="pt-2">
		<!-- Avatar + email -->
		<Block class="!flex items-center gap-4">
			<button
				onclick={() => avatarInputEl?.click()}
				disabled={uploadingAvatar}
				class="relative shrink-0 group"
				aria-label="Change profile photo"
			>
				<div class="{uploadingAvatar ? 'opacity-50' : 'group-hover:opacity-80'} transition-opacity">
					<Avatar name={user?.displayName} photoURL={user?.photoURL} size="xl" />
				</div>
				<div class="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-primary text-white
					flex items-center justify-center shadow-sm">
					{#if uploadingAvatar}
						<Icon icon="ph:spinner" class="text-xs animate-spin" />
					{:else}
						<Icon icon="ph:camera" class="text-xs" />
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
				<p class="text-on-surface font-medium flex items-center gap-1.5">
					{user?.displayName || 'User'}
					{#if isPlus(user)}
						<PlusBadge size="md" />
					{/if}
				</p>
				<p class="text-xs text-muted">{user?.email}</p>
				{#if user?.createdAt}
					<p class="text-[11px] text-muted">
						Member since {user.createdAt.toDate().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
					</p>
				{/if}
			</div>
		</Block>

		<!-- Plus tier card -->
		<Block class="!mt-1">
			{#if isPlus(user)}
				<a
					href="/pricing"
					class="flex items-center gap-3 px-4 py-3 rounded-card bg-gradient-to-r from-accent/10 to-accent/5
						border border-accent/20 hover:border-accent/40 active:scale-[0.99] transition-all"
				>
					<div class="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
						<Icon icon="ph:star-fill" class="text-base text-accent" />
					</div>
					<div class="flex-1 min-w-0">
						<p class="text-[14px] font-semibold text-on-surface flex items-center gap-1.5">Plus supporter</p>
						<p class="text-[12px] text-muted truncate">Manage subscription or invoices</p>
					</div>
					<Icon icon="ph:caret-right" class="text-base text-muted shrink-0" />
				</a>
			{:else}
				<a
					href="/pricing"
					class="flex items-center gap-3 px-4 py-3 rounded-card bg-gradient-to-r from-accent/10 via-accent/8 to-accent/5
						border border-accent/20 hover:border-accent/40 active:scale-[0.99] transition-all"
				>
					<div class="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
						<Icon icon="ph:sparkle-fill" class="text-base text-accent" />
					</div>
					<div class="flex-1 min-w-0">
						<p class="text-[14px] font-semibold text-on-surface">Upgrade to Plus</p>
						<p class="text-[12px] text-muted">${PLUS_PRICING.monthly}/mo · unlock on-demand AI summaries</p>
					</div>
					<Icon icon="ph:caret-right" class="text-base text-muted shrink-0" />
				</a>
			{/if}
		</Block>

		<!-- Display name -->
		<BlockTitle>Display Name</BlockTitle>
		<List inset strong outline>
			<ListInput
				outline
				type="text"
				placeholder="Your display name"
				value={displayName}
				onInput={(e) => { displayName = e.target.value; }}
				clearButton={displayName.length > 0}
				onClear={() => { displayName = ''; }}
			/>
		</List>
		<Block class="pt-0">
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
			<List inset strong outline>
				<ListInput
					outline
					label="From"
					type="select"
					value={quietStart}
					onInput={(e) => { quietStart = e.target.value === '' ? undefined : Number(e.target.value); saveQuietHours(); }}
				>
					<option value="">Off</option>
					{#each Array.from({ length: 24 }, (_, i) => i) as h (h)}
						<option value={h}>{h.toString().padStart(2, '0')}:00</option>
					{/each}
				</ListInput>
				<ListInput
					outline
					label="To"
					type="select"
					value={quietEnd}
					onInput={(e) => { quietEnd = e.target.value === '' ? undefined : Number(e.target.value); saveQuietHours(); }}
				>
					<option value="">Off</option>
					{#each Array.from({ length: 24 }, (_, i) => i) as h (h)}
						<option value={h}>{h.toString().padStart(2, '0')}:00</option>
					{/each}
				</ListInput>
			</List>
			{#if detectedTimezone}
				<Block class="pt-0">
					<p class="text-xs text-muted">Timezone: {detectedTimezone}</p>
				</Block>
			{/if}
		{/if}

		<!-- Email Digest -->
		<BlockTitle>Daily Email Digest</BlockTitle>
		{#snippet digestAfter()}
			<Toggle
				checked={digestEnabled}
				onChange={async () => {
					if (!user) return;
					hapticLight();
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
		</List>
		{#if digestEnabled}
			<List inset strong outline>
				<ListInput
					outline
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
			</List>
		{/if}
		{#if digestEnabled}
			<Block class="pt-0">
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
							if (msg.includes('not-found')) showToast('No new activity in the last 24 hours');
							else if (msg.includes('resource-exhausted')) showToast('Please wait a few minutes before requesting another preview');
							else showToast(msg);
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

		<!-- Experience Settings -->
		<BlockTitle>Experience</BlockTitle>
		<Block>
			<p class="text-xs text-muted mb-4">
				Choose whether Nearboard feels calmer and more intentional, or more immersive and chat-like.
			</p>

			<!-- Preset picker -->
			<Segmented strong rounded>
				{#each ['calm', 'balanced', 'lively'] as preset (preset)}
					<SegmentedButton
						active={experience.preset === preset}
						onClick={() => selectPreset(preset as 'calm' | 'balanced' | 'lively')}
					>
						{preset.charAt(0).toUpperCase() + preset.slice(1)}
					</SegmentedButton>
				{/each}
			</Segmented>
			{#if experience.preset === 'custom'}
				<p class="text-[11px] text-muted text-center mt-2">Custom — you've changed individual settings below</p>
			{/if}
		</Block>

		<BlockTitle>Customize Experience</BlockTitle>
		<List inset strong outline>
			<!-- Scroll behavior -->
			<ListInput
				outline
				label="Scroll behavior"
				type="select"
				value={experience.scrollBehavior}
				onInput={(e) => saveExperience({ scrollBehavior: e.target.value as ScrollBehavior })}
				disabled={savingExperience}
			>
				<option value="load-more">Load more</option>
				<option value="paged">Paged sections</option>
				<option value="infinite">Infinite scroll</option>
			</ListInput>

			<!-- Video playback -->
			<ListInput
				outline
				label="Video playback"
				type="select"
				value={experience.videoPlayback}
				onInput={(e) => saveExperience({ videoPlayback: e.target.value as VideoPlayback })}
				disabled={savingExperience}
			>
				<option value="tap-to-play">Tap to play</option>
				<option value="wifi-autoplay">Autoplay on Wi-Fi</option>
				<option value="muted-autoplay">Autoplay muted</option>
				<option value="full-autoplay">Full autoplay</option>
			</ListInput>

			<!-- Feed order -->
			<ListInput
				outline
				label="Feed order"
				type="select"
				value={experience.feedOrder}
				onInput={(e) => saveExperience({ feedOrder: e.target.value as FeedOrder })}
				disabled={savingExperience}
			>
				<option value="newest">Newest first</option>
				<option value="oldest">Oldest first</option>
				<option value="most-active">Most active</option>
				<option value="curated">Board curated</option>
			</ListInput>

			<!-- Layout style -->
			<ListInput
				outline
				label="Layout style"
				type="select"
				value={experience.layoutStyle}
				onInput={(e) => saveExperience({ layoutStyle: e.target.value as LayoutStyle })}
				disabled={savingExperience}
			>
				<option value="single-column">Single column</option>
				<option value="masonry">Masonry</option>
				<option value="compact-grid">Compact grid</option>
			</ListInput>
		</List>
		<Block class="pt-0">
			<div class="space-y-2 text-[11px] text-muted leading-relaxed">
				<p><strong>Scroll:</strong> Load more creates natural stopping points. Infinite scroll feels faster, but more continuous.</p>
				<p><strong>Video:</strong> Tap-to-play keeps browsing intentional. Autoplay makes media feel more immersive.</p>
				<p><strong>Feed:</strong> Newest first is the clearest default. Most active surfaces the busiest conversations.</p>
				<p><strong>Board vs Chat:</strong> Choose whether boards feel more like shared collections or active conversations.</p>
				<p><strong>Layout:</strong> Single column is easier to scan. Masonry is better for discovery-heavy boards.</p>
			</div>
		</Block>

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
				<div class="flex flex-col gap-3">
					<div class="flex gap-2 items-stretch w-full">
						<code class="flex-1 w-0 text-xs text-on-surface bg-surface-1 px-3 py-2.5 rounded-lg overflow-hidden text-ellipsis whitespace-nowrap">
							{referralLink}
						</code>
						<button
							type="button"
							onclick={copyReferralLink}
							class="shrink-0 px-4 py-2 text-sm font-medium rounded-full bg-primary text-white active:opacity-80 transition-opacity"
						>
							{referralCopied ? 'Copied!' : 'Copy'}
						</button>
					</div>
					{#if canNativeShare}
						<Button small rounded outline onClick={handleShareReferral} class="w-full">
							<Icon icon="ph:share-fat" class="text-base mr-1.5" />
							Share with Friends
						</Button>
					{/if}
				</div>
			</Block>
		{/if}

		<!-- Sign out -->
		<Block class="mt-6">
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
