<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { addPost } from '$lib/stores/posts';
  import { getOrCreateIdentity } from '$lib/crypto/identity';
  import { EPHEMERAL_CYCLE } from '$lib/domain/types';
  import type { Post } from '$lib/domain/types';

  const hubId = $derived(page.url.searchParams.get('hubId') ?? '');

  let text = $state('');
  let imageFile = $state<File | null>(null);
  let imagePreviewUrl = $state('');
  let ephemeralIndex = $state(0);
  let submitting = $state(false);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let detectedUrl = $state('');
  let linkPreview = $state<{ url: string; title?: string; description?: string; image?: string } | null>(null);
  let linkFetching = $state(false);

  const MAX_CHARS = 280;
  let charsUsed = $derived(text.length);
  let charsLeft = $derived(MAX_CHARS - text.length);
  let isEphemeral = $derived(ephemeralIndex > 0);
  let ephemeralMs = $derived(EPHEMERAL_CYCLE[ephemeralIndex]);

  const RING_R = 10;
  const RING_CIRC = 2 * Math.PI * RING_R;
  let ringOffset = $derived(RING_CIRC - (charsUsed / MAX_CHARS) * RING_CIRC);
  let ringColor = $derived(
    charsLeft <= 0 ? '#ff4444' :
    charsLeft <= 20 ? 'var(--accent)' :
    charsLeft <= 40 ? 'var(--ephemeral)' :
    'var(--text-tertiary)'
  );

  const ephemeralLabels = ['', '30s', '1m', '2m', '5m'];
  let ephemeralLabel = $derived(ephemeralLabels[ephemeralIndex]);

  const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

  let urlDebounceTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const urls = text.match(URL_REGEX);
    const firstUrl = urls?.[0] ?? '';
    if (firstUrl !== detectedUrl) {
      detectedUrl = firstUrl;
      clearTimeout(urlDebounceTimer);
      if (firstUrl) {
        urlDebounceTimer = setTimeout(() => fetchLinkPreview(firstUrl), 600);
      } else {
        linkPreview = null;
      }
    }
  });

  $effect(() => {
    if (imageFile) {
      imagePreviewUrl = URL.createObjectURL(imageFile);
    } else {
      imagePreviewUrl = '';
    }
  });

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, window.innerHeight * 0.5) + 'px';
  }

  async function fetchLinkPreview(url: string) {
    linkFetching = true;
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(5000) });
      const html = await resp.text();

      const getOg = (prop: string) => {
        const m = html.match(new RegExp(`<meta[^>]*property=["']og:${prop}["'][^>]*content=["']([^"']*)["']`, 'i'))
          || html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${prop}["']`, 'i'));
        return m?.[1] ?? '';
      };
      const title = getOg('title') || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '';
      const description = getOg('description');
      const image = getOg('image');

      linkPreview = { url, title: title.slice(0, 120), description: description.slice(0, 200), image };
    } catch {
      linkPreview = { url };
    } finally {
      linkFetching = false;
    }
  }

  function getDomain(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
  }

  async function compressImage(file: File): Promise<Uint8Array> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 720;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = maxDim / Math.max(w, h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            blob!.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
          },
          'image/jpeg',
          0.7
        );
      };
      img.src = URL.createObjectURL(file);
    });
  }

  function cycleEphemeral() {
    ephemeralIndex = (ephemeralIndex + 1) % EPHEMERAL_CYCLE.length;
  }

  function removeImage() {
    imageFile = null;
    imagePreviewUrl = '';
  }

  function removeLinkPreview() {
    linkPreview = null;
    detectedUrl = '';
  }

  async function handleSubmit() {
    if (!text.trim() || !hubId || charsLeft < 0) return;
    submitting = true;

    const { deviceId } = await getOrCreateIdentity();
    const now = Date.now();

    let imageBlob: Uint8Array | undefined;
    if (imageFile) {
      imageBlob = await compressImage(imageFile);
    }

    const post: Post = {
      postId: crypto.randomUUID(),
      hubId,
      authorId: deviceId,
      text: text.trim(),
      imageBlob,
      linkPreview: linkPreview ?? undefined,
      createdAt: now,
      lastInteractionAt: now,
      likeCount: 0,
      reshareCount: 0,
      derankCount: 0,
      pinned: false,
      isFeatured: false,
      isEphemeral,
      expiresAt: isEphemeral && ephemeralMs ? now + ephemeralMs : undefined,
      isHidden: false,
      isCarried: false
    };

    await addPost(post);
    goto(`/hub/${hubId}`);
  }
</script>

<div class="compose-sheet">
  <nav class="flex justify-between items-center" style="padding: 8px 0;">
    <button class="ghost" onclick={() => goto(`/hub/${hubId}`)}>cancel</button>
    <button
      type="button"
      class="primary"
      onclick={handleSubmit}
      disabled={!text.trim() || submitting || charsLeft < 0}
      style="padding: 6px 16px; min-height: 32px;"
    >
      {submitting ? 'posting...' : 'post'}
    </button>
  </nav>

  {#if isEphemeral}
    <div class="compose-ephemeral-bar animate-in">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/>
      </svg>
      <span>self-deletes after {ephemeralLabel}</span>
    </div>
  {/if}

  <div class="compose-box">
    <textarea
      bind:this={textareaEl}
      bind:value={text}
      class="compose-textarea"
      placeholder="what's happening nearby?"
      maxlength={MAX_CHARS}
      oninput={autoResize}
    ></textarea>

    {#if imagePreviewUrl || linkPreview || linkFetching}
      <div class="compose-attachments">
        {#if imagePreviewUrl}
          <div class="compose-image-preview animate-in">
            <img src={imagePreviewUrl} alt="Selected" />
            <button class="remove-btn" type="button" onclick={removeImage}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/>
              </svg>
            </button>
          </div>
        {/if}

        {#if linkPreview}
          <div style="position: relative; margin-top: {imagePreviewUrl ? '8px' : '0'};">
            <div class="link-card animate-in">
              {#if linkPreview.image}
                <img class="link-card-image" src={linkPreview.image} alt="" />
              {/if}
              <div class="link-card-body">
                <div class="link-card-domain">{getDomain(linkPreview.url)}</div>
                {#if linkPreview.title}
                  <div class="link-card-title">{linkPreview.title}</div>
                {/if}
                {#if linkPreview.description}
                  <div class="link-card-desc">{linkPreview.description}</div>
                {/if}
                {#if !linkPreview.title && !linkPreview.image}
                  <div class="text-xs text-tertiary" style="word-break: break-all;">{linkPreview.url}</div>
                {/if}
              </div>
            </div>
            <button class="remove-btn" type="button" onclick={removeLinkPreview}
                    style="position: absolute; top: 6px; right: 6px;">
              <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="3" y1="3" x2="11" y2="11"/><line x1="11" y1="3" x2="3" y2="11"/>
              </svg>
            </button>
          </div>
        {:else if linkFetching}
          <p class="text-xs text-tertiary pulse" style="padding: 8px 0;">loading preview...</p>
        {/if}
      </div>
    {/if}
  </div>

  <div class="compose-toolbar-inline">
    <input type="file" accept="image/*" id="img-input" style="display:none;"
           onchange={(e) => { imageFile = (e.target as HTMLInputElement).files?.[0] ?? null; }} />

    <button type="button" class="icon-btn" onclick={() => document.getElementById('img-input')?.click()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="13" r="3.5"/>
      </svg>
    </button>

    <button type="button" class="icon-btn" style="position: relative;" onclick={cycleEphemeral}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
           stroke={isEphemeral ? 'var(--ephemeral)' : 'currentColor'}
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/>
      </svg>
      {#if isEphemeral}
        <span class="ephemeral-badge">{ephemeralLabel}</span>
      {/if}
    </button>

    <div style="flex: 1;"></div>

    <span class="compose-charcount" class:warn={charsLeft <= 40 && charsLeft > 20} class:danger={charsLeft <= 20}>{charsLeft}</span>
    <div class="char-ring">
      <svg width="24" height="24" viewBox="0 0 24 24">
        <circle class="char-ring-track" cx="12" cy="12" r={RING_R}/>
        <circle class="char-ring-fill" cx="12" cy="12" r={RING_R}
          stroke={ringColor}
          stroke-dasharray={RING_CIRC}
          stroke-dashoffset={ringOffset}
        />
      </svg>
    </div>
  </div>
</div>
