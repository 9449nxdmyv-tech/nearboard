<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { posts, loadPostsForHub, updatePost } from '$lib/stores/posts';
  import { getHub } from '$lib/db/localDb';
  import { sortedFeed, highlights } from '$lib/domain/scoring';
  import type { Hub, Post } from '$lib/domain/types';

  let hub = $state<Hub | null>(null);
  let feedPosts = $derived(sortedFeed($posts));
  let highlightPosts = $derived(highlights($posts, 3));
  let now = $state(Date.now());
  let ticker: ReturnType<typeof setInterval>;
  let viewingImage = $state<string | null>(null);

  const hubId = $derived(page.params.hubId);

  onMount(async () => {
    hub = (await getHub(hubId)) ?? null;
    await loadPostsForHub(hubId);
    ticker = setInterval(() => { now = Date.now(); }, 1000);
  });

  onDestroy(() => { clearInterval(ticker); });

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
  function imageUrl(postId: string, blob: Uint8Array): string {
    if (!blobUrlCache.has(postId)) {
      blobUrlCache.set(postId, URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' })));
    }
    return blobUrlCache.get(postId)!;
  }

  async function likePost(post: Post) {
    await updatePost({
      ...post,
      likeCount: post.likeCount + 1,
      lastInteractionAt: Date.now()
    });
  }

  async function carryPost(post: Post) {
    await updatePost({ ...post, isCarried: true, reshareCount: post.reshareCount + 1, lastInteractionAt: Date.now() });
  }

  async function hidePost(post: Post) {
    await updatePost({ ...post, isHidden: true });
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
      <article class="card animate-in" style="position: relative; overflow: hidden;">
        {#if post.isEphemeral && post.expiresAt}
          <div class="ephemeral-bar" style="width: {ephemeralProgress(post) * 100}%;"></div>
        {/if}

        <div class="post-meta">
          <div class="flex items-center gap-2">
            <span class="post-author">{shortAuthor(post.authorId)}</span>
            {#if post.isEphemeral && post.expiresAt}
              <span class="badge ephemeral" style="font-size: 9px;">{formatCountdown(post.expiresAt)}</span>
            {/if}
            {#if post.pinned}<span class="badge pinned" style="font-size: 9px;">pinned</span>{/if}
            {#if post.isFeatured}<span class="badge featured" style="font-size: 9px;">featured</span>{/if}
          </div>
          <span class="post-time">{relativeTime(post.createdAt)}</span>
        </div>

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
          <button onclick={() => likePost(post)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            {#if post.likeCount > 0}<span>{post.likeCount}</span>{/if}
          </button>
          <button onclick={() => carryPost(post)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 17 20 12 15 7"/><path d="M4 12h16"/>
            </svg>
            {#if post.reshareCount > 0}<span>{post.reshareCount}</span>{/if}
          </button>
          <button onclick={() => hidePost(post)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
        </div>
      </article>
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
