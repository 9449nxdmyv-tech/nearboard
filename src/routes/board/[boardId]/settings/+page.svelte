<!--
  @file board/[boardId]/settings/+page.svelte
  @description Board settings — members, invite link, notification prefs, danger zone.
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Icon from '@iconify/svelte';
	import { Page, List, ListItem, ListInput, Button, Block, BlockTitle, Segmented, SegmentedButton, Preloader } from 'konsta/svelte';
	import Header from '$lib/components/ui/Header.svelte';
	import { userStore, showToast } from '$lib/stores';
	import {
		getBoard,
		updateBoard,
		deleteBoard,
		generateShareLink,
		getBoardMembers,
		getPendingInvites,
		removeMember,
		updateMemberNotificationMode,
		updateMemberDigestMuted,
		getQuarantinedContent,
		setModerationStatus,
		getPendingJoinRequests,
		approveJoinRequest,
		rejectJoinRequest
	} from '$lib/firebase';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import WhatsAppImportSheet from '$lib/components/ui/WhatsAppImportSheet.svelte';
	import { Toggle } from 'konsta/svelte';
	import { hapticLight } from '$lib/utils/haptics';
	import { avatarInitial } from '$lib/utils/textFormatter';
	import type { BoardDoc, MemberDoc, ContentDoc, InviteDoc, JoinRequestDoc, ScrollBehavior, VideoPlayback, FeedOrder, ConversationMode, LayoutStyle, BoardExperienceOverrides } from '$lib/types';
	import { globalExperience, getEffectiveExperience } from '$lib/stores';

	const boardId = $derived($page.params.boardId ?? '');

	let board = $state<BoardDoc | null>(null);
	let members = $state<MemberDoc[]>([]);
	let invites = $state<InviteDoc[]>([]);
	let quarantined = $state<ContentDoc[]>([]);
	let joinRequests = $state<JoinRequestDoc[]>([]);
	let loading = $state(true);
	let inviteLink = $state('');
	let copied = $state(false);
	let confirmDeleteBoard = $state(false);
	let confirmRemoveMember = $state<string | null>(null);
	let showWhatsAppImport = $state(false);

	const isOwner = $derived(board?.ownerId === $userStore.user?.uid);
	const currentUserId = $derived($userStore.user?.uid ?? '');
	const owner = $derived(members.find((m) => m.userId === board?.ownerId));
	const myMember = $derived(members.find((m) => m.userId === currentUserId));
	const myNotifMode = $derived(myMember?.notificationMode ?? 'ping');
	const myDigestMuted = $derived(myMember?.digestMuted ?? false);
	let savingDigestMute = $state(false);

	$effect(() => {
		const user = $userStore.user;
		if (!user || !boardId || !loading) return;

		async function load() {
			try {
				board = await getBoard(boardId);
				members = await getBoardMembers(boardId);
				invites = await getPendingInvites(boardId);

				if (board) {
					inviteLink = generateShareLink(boardId);
					if (board.ownerId === user!.uid) {
						quarantined = await getQuarantinedContent(boardId);
						try {
							joinRequests = await getPendingJoinRequests(boardId);
						} catch {
							// Join requests index may not be deployed yet
						}
					}
				}
			} catch {
				showToast('Failed to load board settings');
			} finally {
				loading = false;
			}
		}

		load();
	});

	async function copyInvite() {
		await navigator.clipboard.writeText(inviteLink);
		copied = true;
		setTimeout(() => { copied = false; }, 2000);
		showToast('Invite link copied!');
	}

	async function handleModeration(contentId: string, action: 'approved' | 'quarantined') {
		try {
			await setModerationStatus(boardId, contentId, action);
			quarantined = quarantined.filter((c) => c.id !== contentId);
			showToast(action === 'approved' ? 'Content approved' : 'Content removed', 'success');
		} catch {
			showToast('Failed to update moderation status');
		}
	}

	async function handleRemoveMember(userId: string) {
		try {
			await removeMember(boardId, userId);
			members = members.filter((m) => m.userId !== userId);
			showToast('Member removed', 'success');
		} catch {
			showToast('Failed to remove member');
		}
		confirmRemoveMember = null;
	}

	async function handleNotifMode(mode: 'silent' | 'ping' | 'voice') {
		if (!currentUserId) return;
		try {
			await updateMemberNotificationMode(boardId, currentUserId, mode);
			members = members.map((m) =>
				m.userId === currentUserId ? { ...m, notificationMode: mode } : m
			);
			showToast('Notification preference updated', 'success');
		} catch {
			showToast('Failed to update notification preference');
		}
	}

	async function handleDeleteBoard() {
		try {
			await deleteBoard(boardId);
			showToast('Board deleted', 'success');
			goto('/');
		} catch {
			showToast('Failed to delete board');
		}
	}

	async function handleApproveRequest(request: JoinRequestDoc) {
		try {
			await approveJoinRequest(boardId, request.id, currentUserId);
			joinRequests = joinRequests.filter((r) => r.id !== request.id);
			// Refresh members list
			members = await getBoardMembers(boardId);
			showToast('Member added', 'success');
		} catch {
			showToast('Failed to approve request');
		}
	}

	async function handleRejectRequest(requestId: string) {
		try {
			await rejectJoinRequest(boardId, requestId, currentUserId);
			joinRequests = joinRequests.filter((r) => r.id !== requestId);
			showToast('Request rejected', 'success');
		} catch {
			showToast('Failed to reject request');
		}
	}
</script>

<Page>
	<Header title="Board Settings" backHref="/board/{boardId}" />

	{#if loading}
		<Block class="!text-center !mt-12">
			<Preloader />
			<p class="text-muted text-sm mt-3">Loading...</p>
		</Block>
	{:else if !board}
		<Block class="!text-center !mt-12">
			<p class="text-error text-sm">Board not found</p>
		</Block>
	{:else}
		<div class="pt-2">
			<!-- Board info -->
			<BlockTitle>Board Info</BlockTitle>
			<List inset strong>
				<ListItem title={board?.name ?? ''}>
					{#snippet subtitle()}
						<span class="capitalize">{board?.template} board</span>
						{#if owner} &middot; Owned by {owner.displayName}{/if}
					{/snippet}
				</ListItem>
			</List>

			<!-- Invite link -->
			<BlockTitle>Invite Link</BlockTitle>
			<Block>
				<p class="text-xs text-muted mb-2">Share this link to invite others:</p>
				<div class="flex gap-2 items-stretch w-full">
					<code class="flex-1 w-0 text-xs text-on-surface bg-surface-1 px-3 py-2.5 rounded-lg overflow-hidden text-ellipsis whitespace-nowrap">
						{inviteLink}
					</code>
					<button
						type="button"
						onclick={copyInvite}
						class="shrink-0 px-4 py-2 text-sm font-medium rounded-full bg-primary text-white active:opacity-80 transition-opacity"
					>
						{copied ? 'Copied!' : 'Copy'}
					</button>
				</div>
			</Block>

			<!-- Board Settings -->
			<BlockTitle>Settings</BlockTitle>
			{#snippet summaryAfter()}
				{#if isOwner}
					<Toggle
						checked={board?.enableLivingSummary ?? false}
						onChange={async () => {
							if (!board) return;
							hapticLight();
							const newState = !board.enableLivingSummary;
							await updateBoard(boardId, { enableLivingSummary: newState });
							board = { ...board, enableLivingSummary: newState };
						}}
					/>
				{:else}
					<span class="text-xs text-muted">{board?.enableLivingSummary ? 'On' : 'Off'}</span>
				{/if}
			{/snippet}
			{#snippet commentsAfter()}
				{#if isOwner}
					<Toggle
						checked={board?.allowComments ?? false}
						onChange={async () => {
							if (!board) return;
							hapticLight();
							const newState = !board.allowComments;
							await updateBoard(boardId, { allowComments: newState });
							board = { ...board, allowComments: newState };
						}}
					/>
				{:else}
					<span class="text-xs text-muted">{board?.allowComments ? 'On' : 'Off'}</span>
				{/if}
			{/snippet}
			<List inset strong>
				<ListItem
					title="Auto-update summary"
					subtitle="AI maintains a pinned summary"
					after={summaryAfter}
				/>
				<ListItem
					title="Allow comments"
					subtitle="Enable discussion on content cards"
					after={commentsAfter}
				/>
			</List>

			<!-- Summary options (when enabled + owner) -->
			{#if board?.enableLivingSummary && isOwner}
				<BlockTitle>Summary Style</BlockTitle>
				<Block>
					<Segmented strong rounded>
						{#each [
							{ value: 'paragraph', label: 'Paragraph' },
							{ value: 'bullets', label: 'Bullets' },
							{ value: 'action-items', label: 'Actions' }
						] as opt (opt.value)}
							<SegmentedButton
								active={board?.summaryStyle === opt.value}
								onClick={async () => {
									if (!board) return;
									const val = opt.value as any;
									await updateBoard(boardId, { summaryStyle: val });
									board = { ...board, summaryStyle: val };
								}}
							>
								{opt.label}
							</SegmentedButton>
						{/each}
					</Segmented>
				</Block>
				<List inset strong outline>
					<ListInput
						outline
						label="Summary Focus"
						type="text"
						placeholder="Leave blank for automatic focus"
						value={board?.summaryFocus ?? ''}
						onBlur={async (e) => {
							if (!board) return;
							const val = (e.target as HTMLInputElement).value.trim();
							await updateBoard(boardId, { summaryFocus: val });
							board = { ...board, summaryFocus: val || undefined };
						}}
					/>
				</List>
				<Block class="!-mt-2">
					<p class="text-[11px] text-muted">e.g., "track the budget" or "focus on what everyone is bringing"</p>
				</Block>
			{/if}

			<!-- Notification preferences -->
			<BlockTitle>Notifications</BlockTitle>
			<Block>
				<p class="text-xs text-muted mb-3">How you want to be notified about this board:</p>
				<Segmented strong rounded>
					{#each [
						{ value: 'silent', label: 'Silent', icon: 'ph:bell-slash' },
						{ value: 'ping', label: 'Ping', icon: 'ph:bell-ringing' },
						{ value: 'voice', label: 'Voice', icon: 'ph:speaker-high' }
					] as opt (opt.value)}
						<SegmentedButton
							active={myNotifMode === opt.value}
							onClick={() => handleNotifMode(opt.value as 'silent' | 'ping' | 'voice')}
						>
							<Icon icon={opt.icon} class="text-sm mr-1" />
							{opt.label}
						</SegmentedButton>
					{/each}
				</Segmented>
				<p class="text-xs text-muted mt-2">
					{#if myNotifMode === 'silent'}
						No notifications — check the board manually.
					{:else if myNotifMode === 'ping'}
						Push notification with text summary.
					{:else}
						Push notification + AI voice briefing.
					{/if}
				</p>
			</Block>
			{#snippet digestMuteAfter()}
				<Toggle
					checked={myDigestMuted}
					disabled={savingDigestMute}
					onChange={async () => {
						if (!currentUserId) return;
						hapticLight();
						savingDigestMute = true;
						const newVal = !myDigestMuted;
						await updateMemberDigestMuted(boardId, currentUserId, newVal);
						members = members.map((m) =>
							m.userId === currentUserId ? { ...m, digestMuted: newVal } : m
						);
						showToast(newVal ? 'Board muted from digest' : 'Board included in digest', 'success');
						savingDigestMute = false;
					}}
				/>
			{/snippet}
			<List inset strong>
				<ListItem
					title="Mute from email digest"
					subtitle="Exclude this board from your daily digest"
					after={digestMuteAfter}
				/>
			</List>

			<!-- Import & Export (owner only) -->
			{#if isOwner}
				<BlockTitle>Import & Export</BlockTitle>
				{#snippet whatsappMedia()}<Icon icon="ph:whatsapp-logo" class="text-xl text-[color:var(--color-brand-whatsapp)]" />{/snippet}
				{#snippet telegramMedia()}<Icon icon="ph:telegram-logo" class="text-xl text-[color:var(--color-brand-telegram)] opacity-40" />{/snippet}
				<List inset strong>
					<ListItem
						title="Import from WhatsApp"
						subtitle="Turn chat messages into board cards"
						media={whatsappMedia}
						link
						onClick={() => { showWhatsAppImport = true; }}
					/>
					<ListItem
						title="Import from Telegram"
						subtitle="Coming soon"
						media={telegramMedia}
						class="opacity-40 pointer-events-none"
					/>
				</List>
			{/if}

			<!-- Members -->
			<BlockTitle>Members ({members.length})</BlockTitle>
			<List inset strong>
				{#each members as member (member.userId)}
					{#snippet memberMedia()}
						{#if member.photoURL}
							<img src={member.photoURL} alt={member.displayName} class="w-8 h-8 rounded-full object-cover" />
						{:else}
							<div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs text-primary font-medium">
								{avatarInitial(member.displayName || member.userId)}
							</div>
						{/if}
					{/snippet}
					{#snippet memberAfter()}
						{#if member.userId === board?.ownerId}
							<span class="text-xs" title="Owner">👑</span>
						{/if}
						{#if isOwner && member.userId !== board?.ownerId}
							<Button small clear onClick={() => { confirmRemoveMember = member.userId; }}>
								<span class="text-error text-xs">Remove</span>
							</Button>
						{/if}
					{/snippet}
					<ListItem
						title={member.displayName || member.userId}
						media={memberMedia}
						after={memberAfter}
					>
						{#snippet subtitle()}
							<span class="capitalize">{member.role}</span>
							{#if member.joinedViaInviteId}
								<span class="ml-1 px-1.5 py-0.5 bg-primary/10 text-primary text-[9px] font-bold uppercase rounded">Invited</span>
							{/if}
						{/snippet}
					</ListItem>
				{/each}
			</List>

			<!-- Join Requests (owner only) -->
			{#if isOwner && joinRequests.length > 0}
				<BlockTitle>Join Requests ({joinRequests.length})</BlockTitle>
				<List inset strong>
					{#each joinRequests as request (request.id)}
						{#snippet reqMedia()}
							{#if request.requesterPhotoURL}
								<img src={request.requesterPhotoURL} alt={request.requesterName} class="w-8 h-8 rounded-full object-cover" />
							{:else}
								<div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs text-primary font-medium">
									{avatarInitial(request.requesterName)}
								</div>
							{/if}
						{/snippet}
						{#snippet reqAfter()}
							<div class="flex gap-1.5">
								<Button small rounded onClick={() => handleApproveRequest(request)}>
									Approve
								</Button>
								<Button small rounded outline onClick={() => handleRejectRequest(request.id)}>
									<span class="text-error">Reject</span>
								</Button>
							</div>
						{/snippet}
						<ListItem
							title={request.requesterName}
							media={reqMedia}
							after={reqAfter}
						>
							{#snippet subtitle()}
								{#if request.requestedAt}
									{request.requestedAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
								{/if}
							{/snippet}
						</ListItem>
					{/each}
				</List>
			{/if}

			<!-- Content moderation (owner only) -->
			{#if isOwner && quarantined.length > 0}
				<BlockTitle class="!text-warning">Flagged Content ({quarantined.length})</BlockTitle>
				<List inset strong>
					{#each quarantined as item (item.id)}
						{#snippet modAfter()}
							<div class="flex gap-1.5">
								<Button small rounded onClick={() => handleModeration(item.id, 'approved')}>
									Approve
								</Button>
								<Button small rounded outline onClick={() => handleModeration(item.id, 'quarantined')}>
									<span class="text-error">Remove</span>
								</Button>
							</div>
						{/snippet}
						<ListItem after={modAfter}>
							{#snippet title()}
								<span class="truncate">
									{#if 'text' in item}
										{item.text}
									{:else if 'title' in item}
										{item.title}
									{:else if 'url' in item}
										{item.url}
									{:else}
										(media content)
									{/if}
								</span>
							{/snippet}
							{#snippet subtitle()}
								{item.authorName} &middot; {item.type}
							{/snippet}
						</ListItem>
					{/each}
				</List>
			{/if}

			<!-- Danger zone -->
			{#if isOwner}
				<BlockTitle class="!text-error">Danger Zone</BlockTitle>
				<Block>
					<Button large rounded outline onClick={() => { confirmDeleteBoard = true; }}>
						<span class="text-error">Delete Board</span>
					</Button>
					<p class="text-xs text-muted mt-2 text-center">This permanently deletes the board and all content.</p>
				</Block>
			{/if}
		</div>
	{/if}
</Page>

{#if confirmDeleteBoard}
	<ConfirmDialog
		title="Delete this board?"
		message="All content, members, and briefings will be permanently deleted."
		confirmLabel="Delete Board"
		onConfirm={handleDeleteBoard}
		onCancel={() => { confirmDeleteBoard = false; }}
	/>
{/if}

{#if confirmRemoveMember}
	<ConfirmDialog
		title="Remove member?"
		message="They will lose access to this board."
		confirmLabel="Remove"
		onConfirm={() => { if (confirmRemoveMember) handleRemoveMember(confirmRemoveMember); }}
		onCancel={() => { confirmRemoveMember = null; }}
	/>
{/if}

<WhatsAppImportSheet
	open={showWhatsAppImport}
	{boardId}
	boardName={board?.name ?? ''}
	onClose={() => { showWhatsAppImport = false; }}
/>
