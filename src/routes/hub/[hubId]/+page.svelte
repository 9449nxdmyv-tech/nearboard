<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { posts, loadPostsForHub, updatePost } from '$lib/stores/posts';
  import { getHub, getRepliesForHub, saveReply, getCurationClaims, saveCurationClaim } from '$lib/db/localDb';
  import { sortedFeed, highlights } from '$lib/domain/scoring';
  import { count, has, toggle, add } from '$lib/domain/engagement';
  import { hiddenReason, hiddenLabel, withoutBlocked, type HiddenReason } from '$lib/domain/moderation';
  import { moderation, block, unblock } from '$lib/stores/moderation';
  import { showToast } from '$lib/stores/toasts';
  import { delivery, deliveryFor, deliveryLabel, recordDelivery } from '$lib/stores/delivery';
  import { setVisibleHub } from '$lib/notify/posts';
  import { authorLabel, fingerprint, getDisplayName } from '$lib/crypto/profile';
  import { getOrCreateSigningIdentity, withReplySignature } from '$lib/crypto/signing';
  import { MAX_REPLY_CHARS, type Reply } from '$lib/domain/types';
  import { signClaim, applyClaims, type CurationClaim } from '$lib/domain/curation';
  import { getDeviceIdSync } from '$lib/crypto/identity';
  import { mesh } from '$lib/mesh/service';
  import { meshStatus, ensureMeshStarted } from '$lib/stores/mesh';
  import type { Hub, Post } from '$lib/domain/types';

  let hub = $state<Hub | null>(null);
  let me = $state<string | null>(null);
  let unsubscribeReach: (() => void) | undefined;
  let unsubscribeReply: (() => void) | undefined;
  let unsubscribeCuration: (() => void) | undefined;

  /** Curation claims for this board, folded into pinned/removed on demand. */
  let claims = $state<CurationClaim[]>([]);

  /** Whether this device holds the key this board's curation is honoured from. */
  const amCurator = $derived(
    !!hub?.curatorId && hub.curatorId === getOrCreateSigningIdentity().authorId
  );

  const curation = $derived(applyClaims(claims, hub?.curatorId));

  async function curate(post: Post, action: 'pin' | 'unpin' | 'remove') {
    if (!hub || !amCurator) return;
    const identity = getOrCreateSigningIdentity();

    const claim = signClaim(
      {
        hubId: hub.hubId,
        postId: post.postId,
        action,
        curatorId: identity.authorId,
        issuedAt: Date.now()
      },
      identity.secretKey
    );

    await saveCurationClaim(claim);
    claims = [...claims, claim];

    try {
      await mesh.publishCuration(claim);
    } catch {
      // Stored locally; it travels with the next peer.
    }

    showToast(
      action === 'pin' ? 'Pinned to the top of this board'
      : action === 'unpin' ? 'Unpinned'
      : 'Removed from this board'
    );
  }

  /** Replies for this board, grouped by the post they answer. */
  let replies = $state<Reply[]>([]);
  /** Which post has its reply box open. */
  let replyingTo = $state<string | null>(null);
  let replyText = $state('');

  const repliesByPost = $derived.by(() => {
    const grouped = new Map<string, Reply[]>();
    for (const reply of replies) {
      const list = grouped.get(reply.postId) ?? [];
      list.push(reply);
      grouped.set(reply.postId, list);
    }
    for (const list of grouped.values()) list.sort((a, b) => a.createdAt - b.createdAt);
    return grouped;
  });

  async function loadReplies() {
    replies = await getRepliesForHub(hubId);
  }

  function openReply(postId: string) {
    replyingTo = replyingTo === postId ? null : postId;
    replyText = '';
  }

  async function sendReply(post: Post) {
    const text = replyText.trim();
    if (!text) return;

    const identity = getOrCreateSigningIdentity();
    const draft: Reply = {
      replyId: crypto.randomUUID(),
      postId: post.postId,
      hubId: post.hubId,
      authorId: identity.authorId,
      authorName: getDisplayName() || undefined,
      text,
      createdAt: Date.now()
    };

    const reply = withReplySignature(draft, identity);
    await saveReply(reply);
    replies = [...replies, reply];
    replyingTo = null;
    replyText = '';

    try {
      await mesh.publishReply(reply);
    } catch {
      // Stored locally; store-and-forward carries it to the next peer.
    }
  }
  /**
   * The feed, after the curator has had their say.
   *
   * Removal only affects display — the post is still stored and still relayed,
   * because a curator governs their own board, not the network.
   */
  const curated = $derived(
    withoutBlocked(sortedFeed($posts), $moderation)
      .filter((p) => !curation.removed.has(p.postId))
      .map((p) => (curation.pinned.has(p.postId) ? { ...p, pinned: true } : p))
  );

  let feedPosts = $derived(
    [...curated].sort((a, b) => Number(b.pinned) - Number(a.pinned))
  );
  let highlightPosts = $derived(
    withoutBlocked(highlights($posts, 3), $moderation).filter(
      (p) => !curation.removed.has(p.postId)
    )
  );

  /** Posts the user chose to open despite a warning. */
  let revealed = $state<Set<string>>(new Set());

  function reveal(postId: string) {
    revealed = new Set(revealed).add(postId);
  }
  let now = $state(Date.now());
  let ticker: ReturnType<typeof setInterval>;
  let viewingImage = $state<string | null>(null);

  const hubId = $derived(page.params.hubId ?? '');

  onMount(async () => {
    me = getDeviceIdSync();
    hub = (await getHub(hubId)) ?? null;
    await loadPostsForHub(hubId);
    setVisibleHub(hubId);
    await loadReplies();
    claims = await getCurationClaims(hubId);
    void ensureMeshStarted();

    unsubscribeCuration = mesh.onCuration((claim) => {
      if (claim.hubId !== hubId) return;
      claims = [...claims, claim];
    });

    unsubscribeReply = mesh.onReply((reply) => {
      if (reply.hubId !== hubId) return;
      // Replace rather than append: the same reply can arrive by two paths.
      replies = [...replies.filter((r) => r.replyId !== reply.replyId), reply];
    });

    // Store-and-forward flushes cached posts when someone arrives, so a post
    // written alone genuinely reaches people later. Update its reach rather
    // than leaving it reading "waiting" forever.
    unsubscribeReach = mesh.onReachChanged((peerCount) => {
      for (const post of $posts) {
        if (post.authorId === me) recordDelivery(post.postId, peerCount);
      }
    });
    ticker = setInterval(() => { now = Date.now(); }, 1000);
  });

  onDestroy(() => {
    setVisibleHub(null);
    unsubscribeCuration?.();
    unsubscribeReply?.();
    unsubscribeReach?.();
    clearInterval(ticker);
    for (const url of blobUrlCache.values()) URL.revokeObjectURL(url);
    blobUrlCache.clear();
  });

  function formatCountdown(expiresAt: number): string {
    const remaining = Math.max(0, expiresAt - now);
    const secs = Math.floor(remaining / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function isExpired(post: Post): boolean {
    return post.isEphemeral && post.expiresAt != null && post.expiresAt <= now;
  }

  function relativeTime(ts: number): string {
    const diff = now - ts;
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  }

  function shortAuthor(authorId: string): string {
    return authorId.replace(/-/g, '').slice(0, 6);
  }

  function ephemeralProgress(post: Post): number {
    if (!post.expiresAt) return 0;
    const total = post.expiresAt - post.createdAt;
    const remaining = Math.max(0, post.expiresAt - now);
    return total > 0 ? remaining / total : 0;
  }

  function getDomain(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
  }

  const blobUrlCache = new Map<string, string>();
  function imageUrl(postId: string, blob: Uint8Array<ArrayBuffer>): string {
    if (!blobUrlCache.has(postId)) {
      blobUrlCache.set(postId, URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' })));
    }
    return blobUrlCache.get(postId)!;
  }

  let overInternet = $state(false);

  /**
   * Opt in or out of carrying this hub over the internet.
   *
   * Off by default. Local-first is the promise on the home screen, so reaching
   * past Bluetooth is a deliberate choice — and posts are encrypted with a key
   * derived from the hub name before they leave, so relays hold ciphertext.
   */
  async function toggleInternet() {
    if (!hub) return;
    if (overInternet) {
      await mesh.leaveInternet(hub.hubId);
      overInternet = false;
      showToast('Back to Bluetooth only — this board is local again.');
    } else {
      await mesh.joinOverInternet(hub.hubId, hub.name);
      overInternet = mesh.isOnInternet(hub.hubId);
      if (overInternet) {
        // Said plainly, because this is the moment a local board stops being
        // local. Anyone who knows the name can now reach it from anywhere.
        showToast('This board can now be reached from anywhere, not just nearby.');
      }
    }
  }

  /** Persist locally, then push the merged post onto the mesh. */
  async function saveAndPublish(updated: Post) {
    await updatePost(updated);
    try {
      await mesh.publishEngagement(updated);
    } catch (e) {
      console.warn('Engagement saved locally but not yet published:', e);
    }
  }

  async function likePost(post: Post) {
    if (!me) return;
    await saveAndPublish({
      ...post,
      likes: toggle(post.likes, me),
      lastInteractionAt: Date.now()
    });
  }

  async function carryPost(post: Post) {
    if (!me) return;
    await saveAndPublish({
      ...post,
      isCarried: true,
      reshares: add(post.reshares, me),
      lastInteractionAt: Date.now()
    });
  }

  /**
   * Report a post.
   *
   * There is no server to report to, so this has to have effect on its own: it
   * adds to the post's deranks — a CRDT that already lowers its score wherever
   * it travels — and blocks the author on this device. Enough reports and the
   * post sinks in everyone's feed, computed identically on every device.
   */
  async function reportPost(post: Post) {
    if (!me) return;
    await saveAndPublish({
      ...post,
      deranks: add(post.deranks, me),
      lastInteractionAt: Date.now()
    });
    block(post.authorId);
    showToast('Reported. This post will sink for everyone.');
  }

  /**
   * Block an author outright. Keyed on their public key, so it holds.
   *
   * Undoable: mis-tapping the block icon is easy, and without undo the only
   * remedy is finding the About screen and matching a truncated key by eye.
   */
  function blockAuthorOf(post: Post) {
    const authorId = post.authorId;
    block(authorId);
    showToast('Blocked. You will not see their posts.', () => unblock(authorId));
  }

  async function hidePost(post: Post) {
    await updatePost({ ...post, isHidden: true });
    showToast('Hidden from your feed.', () => {
      void updatePost({ ...post, isHidden: false });
    });
  }
</script>

{#if hub}
  <div class="hub-header animate-in">
    <div class="flex justify-between items-center">
      <button class="ghost" onclick={() => goto('/')} style="padding: 6px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div style="flex: 1; min-width: 0; text-align: center;">
        <span style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">{hub.name}</span>
      </div>
      <div style="width: 28px;"></div>
    </div>
    {#if hub.description}
      <p class="text-xs text-tertiary text-center mt-1">{hub.description}</p>
    {/if}
    <div class="text-center mt-2">
      <button class="ghost text-xs" onclick={toggleInternet} style="padding: 4px 8px;">
        {overInternet ? '🌐 reaching beyond Bluetooth' : '⌁ Bluetooth only'}
      </button>
    </div>
    <p class="text-xs text-tertiary text-center mt-1">
      {#if $meshStatus.phase === 'connected'}
        syncing with {$meshStatus.peerCount}
        {$meshStatus.peerCount === 1 ? 'person' : 'people'}
      {:else if $meshStatus.phase === 'blocked'}
        <span style="color: var(--accent);">
          {$meshStatus.blocker?.title} — fix it on the home screen
        </span>
      {:else if $meshStatus.phase === 'searching'}
        no one nearby — your posts will sync when someone is
      {:else}
        posts are saved here until the mesh starts
      {/if}
    </p>
  </div>

  <!-- Highlights -->
  {#if highlightPosts.length > 0}
    <div class="mt-4 mb-2">
      <p class="text-xs text-tertiary mb-2" style="text-transform: uppercase; letter-spacing: 0.08em;">highlights</p>
      <div class="hide-scrollbar" style="display: flex; gap: 8px; overflow-x: auto; margin: 0 -16px; padding: 0 16px 8px;">
        {#each highlightPosts as post}
          {#if !isExpired(post)}
            <div style="min-width: 160px; max-width: 200px; flex-shrink: 0; border: 1px solid var(--border); border-radius: 2px; padding: 8px;">
              <p class="text-sm" style="line-height: 1.3;">
                {post.text.slice(0, 60)}{post.text.length > 60 ? '...' : ''}
              </p>
              {#if post.isEphemeral && post.expiresAt}
                <span class="badge ephemeral pulse mt-1" style="font-size: 9px;">{formatCountdown(post.expiresAt)}</span>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/if}

  <p class="text-xs text-tertiary mb-2 mt-4">sorted by passes, likes, recency</p>

  <!-- Feed -->
  {#each feedPosts as post, i (post.postId)}
    {#if !isExpired(post)}
      {@const warning = revealed.has(post.postId) ? null : hiddenReason(post, $moderation)}
      {#if warning}
        <!--
          Collapsed rather than removed. Removing outright would make the app
          decide for the user what they may read; a warning tells them why and
          lets them choose. Blocked authors never reach here — those are dropped
          from the feed entirely, because "I do not want to see this person"
          should not still put them on screen.
        -->
        <article class="card collapsed-post">
          <p class="text-sm text-tertiary">{hiddenLabel(warning)}</p>
          <button class="ghost text-xs mt-2" onclick={() => reveal(post.postId)}>
            show anyway
          </button>
        </article>
      {:else}
      <article class="card animate-in" style="position: relative; overflow: hidden;">
        {#if post.isEphemeral && post.expiresAt}
          <div class="ephemeral-bar" style="width: {ephemeralProgress(post) * 100}%;"></div>
        {/if}

        <div class="post-meta">
          <div class="flex items-center gap-2">
            <!--
              Name and fingerprint together. The name is the forgeable part —
              anyone may call themselves anything — and the fingerprint is not,
              so showing one without the other would be misleading.
            -->
            <span class="post-author">{authorLabel(post.authorId, post.authorName)}</span>
            <span class="post-fingerprint">{fingerprint(post.authorId)}</span>
            {#if post.isEphemeral && post.expiresAt}
              <span class="badge ephemeral" style="font-size: 9px;">{formatCountdown(post.expiresAt)}</span>
            {/if}
            {#if post.pinned}<span class="badge pinned" style="font-size: 9px;">pinned</span>{/if}
            {#if post.isFeatured}<span class="badge featured" style="font-size: 9px;">featured</span>{/if}
          </div>
          <span class="post-time">{relativeTime(post.createdAt)}</span>
        </div>

        {#if me && post.authorId === me}
          {@const reach = deliveryLabel(deliveryFor($delivery, post.postId))}
          {#if reach}
            <p class="post-reach">{reach}</p>
          {/if}
        {/if}

        <p class="post-text">{post.text}</p>

        {#if post.imageBlob}
          <img
            src={imageUrl(post.postId, post.imageBlob)}
            alt="Post image"
            class="post-image"
            onclick={() => { viewingImage = imageUrl(post.postId, post.imageBlob!); }}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && (viewingImage = imageUrl(post.postId, post.imageBlob!))}
          />
        {/if}

        {#if post.linkPreview}
          <a href={post.linkPreview.url} target="_blank" rel="noopener noreferrer"
             class="link-card" style="margin-top: 8px;">
            {#if post.linkPreview.image}
              <img class="link-card-image" src={post.linkPreview.image} alt="" />
            {/if}
            <div class="link-card-body">
              <div class="link-card-domain">{getDomain(post.linkPreview.url)}</div>
              {#if post.linkPreview.title}
                <div class="link-card-title">{post.linkPreview.title}</div>
              {/if}
              {#if post.linkPreview.description}
                <div class="link-card-desc">{post.linkPreview.description}</div>
              {/if}
              {#if !post.linkPreview.title && !post.linkPreview.image}
                <div class="link-card-url-only">{post.linkPreview.url}</div>
              {/if}
            </div>
          </a>
        {/if}

        <div class="post-actions">
          <button onclick={() => likePost(post)} aria-label="Like" aria-pressed={me ? has(post.likes, me) : false}>
            <svg viewBox="0 0 24 24" fill={me && has(post.likes, me) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            {#if count(post.likes) > 0}<span>{count(post.likes)}</span>{/if}
          </button>
          <button onclick={() => carryPost(post)} aria-label="Pass it on">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 17 20 12 15 7"/><path d="M4 12h16"/>
            </svg>
            {#if count(post.reshares) > 0}<span>{count(post.reshares)}</span>{/if}
          </button>
          <button onclick={() => hidePost(post)} aria-label="Hide this post">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>

          {#if me && post.authorId !== me}
            <button onclick={() => reportPost(post)} aria-label="Report this post" title="Report">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
              </svg>
              {#if count(post.deranks) > 0}<span>{count(post.deranks)}</span>{/if}
            </button>
            <button onclick={() => blockAuthorOf(post)} aria-label="Block this person" title="Block">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/>
              </svg>
            </button>
          {/if}

          {#if amCurator}
            <button
              onclick={() => curate(post, curation.pinned.has(post.postId) ? 'unpin' : 'pin')}
              aria-label={curation.pinned.has(post.postId) ? 'Unpin' : 'Pin to top'}
              title={curation.pinned.has(post.postId) ? 'Unpin' : 'Pin to top'}
            >
              <svg viewBox="0 0 24 24" fill={curation.pinned.has(post.postId) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 17v5"/><path d="M9 10.8V4h6v6.8l2 3.2H7z"/>
              </svg>
            </button>
            <button onclick={() => curate(post, 'remove')} aria-label="Remove from this board" title="Remove from this board">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
              </svg>
            </button>
          {/if}

          <button onclick={() => openReply(post.postId)} aria-label="Reply" title="Reply">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 4 11.5a8.5 8.5 0 0 1 8.5-8.5 8.4 8.4 0 0 1 8.5 8.5z"/>
            </svg>
            {#if (repliesByPost.get(post.postId)?.length ?? 0) > 0}
              <span>{repliesByPost.get(post.postId)!.length}</span>
            {/if}
          </button>
        </div>

        {#if repliesByPost.get(post.postId)?.length}
          <div class="thread">
            {#each repliesByPost.get(post.postId)! as reply (reply.replyId)}
              <div class="thread-reply">
                <div class="flex items-center gap-2">
                  <span class="post-author">{authorLabel(reply.authorId, reply.authorName)}</span>
                  <span class="post-fingerprint">{fingerprint(reply.authorId)}</span>
                  <span class="post-time">{relativeTime(reply.createdAt)}</span>
                </div>
                <p class="thread-text">{reply.text}</p>
              </div>
            {/each}
          </div>
        {/if}

        {#if replyingTo === post.postId}
          <form
            class="reply-box"
            onsubmit={(e) => { e.preventDefault(); void sendReply(post); }}
          >
            <input
              bind:value={replyText}
              placeholder="reply..."
              maxlength={MAX_REPLY_CHARS}
              autofocus
            />
            <button type="submit" class="primary" disabled={!replyText.trim()}>send</button>
          </form>
        {/if}
      </article>
      {/if}
    {/if}
  {/each}

  {#if feedPosts.length === 0}
    <div class="text-center" style="padding: 48px 0; color: var(--text-tertiary);">
      <p>no posts yet</p>
      <p class="text-xs mt-1">be the first to post something</p>
    </div>
  {/if}

  <button class="fab" onclick={() => goto(`/compose?hubId=${hubId}`)}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  </button>

  {#if viewingImage}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="image-overlay" onclick={() => { viewingImage = null; }} onkeydown={(e) => e.key === 'Escape' && (viewingImage = null)}>
      <button class="close-btn" onclick={(e) => { e.stopPropagation(); viewingImage = null; }}>
        <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/>
        </svg>
      </button>
      <img src={viewingImage} alt="Full view" />
    </div>
  {/if}

{:else}
  <div class="text-center animate-in" style="padding-top: 48px; color: var(--text-tertiary);">
    <p class="mb-4">hub not found</p>
    <button class="w-full" onclick={() => goto('/')}>go home</button>
  </div>
{/if}
