<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Capacitor } from '@capacitor/core';
  import { hubs, loadHubs } from '$lib/stores/hubs';
import { saveHub } from '$lib/db/localDb';
  import { meshStatus, ensureMeshStarted } from '$lib/stores/mesh';
  import { mesh } from '$lib/mesh/service';
import type { AnnouncedHub } from '$lib/mesh/announce';
  import type { FixAction } from '$lib/mesh/readiness';
  import { showToast } from '$lib/stores/toasts';
  import { canInstall, triggerInstall } from '$lib/pwa/installPrompt';

  const isNative = Capacitor.isNativePlatform();

  let isIos = $state(false);
  let webBleSupported = $state(false);
  let connecting = $state(false);
  let error = $state('');

  /**
   * Whether the user has been told what the permissions are for.
   *
   * The system prompts arrive with no context, and Location in particular looks
   * alarming for an app that promises no tracking — Android simply requires it
   * before any app may scan for Bluetooth devices, which is not something a
   * user can be expected to know. A denial is close to unrecoverable on iOS, so
   * the explanation has to come first, in the app's own words.
   */
  let primed = $state(true);

  onMount(async () => {
    isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    webBleSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
    await loadHubs();

    if (isNative) {
      primed = localStorage.getItem('nearboard_primed') === 'yes';
      if (primed) await ensureMeshStarted();
    }
  });

  async function acceptPriming() {
    localStorage.setItem('nearboard_primed', 'yes');
    primed = true;
    await ensureMeshStarted();
  }

  // Ticks so "last seen 4m ago" stays truthful without a reload.
  let now = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => { now = Date.now(); }, 30_000);
    return () => clearInterval(t);
  });

  const lastSeen = $derived.by(() => {
    const at = $meshStatus.lastPeerAt;
    if (!at) return '';
    const mins = Math.floor((now - at) / 60_000);
    if (mins < 1) return 'moments ago';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  });

  // Boards peers nearby are carrying. Joining one takes a tap, rather than
  // typing a name that has to match character for character.
  let nearby = $state<AnnouncedHub[]>([]);
  onMount(() => mesh.onNearbyHubs((hubs) => { nearby = hubs; }));

  async function joinNearby(hub: AnnouncedHub) {
    if (!$hubs.some((h) => h.hubId === hub.hubId)) {
      await saveHub({
        hubId: hub.hubId,
        name: hub.name,
        createdAt: Date.now(),
        isOwned: false,
        // Trust-on-first-use: whoever announced this board is who this device
        // will honour curation from, and nobody else.
        curatorId: hub.curatorId
      });
      await loadHubs();
      showToast(`Joined ${hub.name}`);
    }
    goto(`/hub/${hub.hubId}`);
  }

  async function fixBlocker(action: FixAction) {
    try {
      await mesh.resolveBlocker(action);
    } catch (e: any) {
      error = e?.message ?? 'Could not open settings';
    }
  }

  /**
   * Web has no peripheral role and no background scan, so a browser can only
   * join the mesh by the user picking a device from the chooser — which must
   * happen inside a user gesture.
   */
  async function connectFromBrowser() {
    connecting = true;
    error = '';
    try {
      await ensureMeshStarted();
      await mesh.connectToChosenDevice();
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') error = e?.message ?? 'Failed to connect';
    } finally {
      connecting = false;
    }
  }
</script>

<div class="animate-in" style="padding-top: max(40px, env(safe-area-inset-top));">
  <h1 style="font-size: 22px; font-weight: 400; letter-spacing: -0.02em;">nearboard</h1>
  <p class="text-tertiary mt-2" style="line-height: 1.6; max-width: 300px;">
    Local walls for nearby people.<br>
    No accounts. No cloud. No global feed.
  </p>
</div>

{#if $canInstall}
  <div style="border: 1px solid rgba(233, 69, 96, 0.2); padding: 12px; margin-top: 20px; border-radius: 2px;">
    <p class="text-sm text-muted mb-2">Install for the best experience</p>
    <button class="w-full primary" onclick={triggerInstall}>Install app</button>
  </div>
{/if}

{#if !isNative && !webBleSupported}
  <div style="border: 1px solid rgba(212, 160, 64, 0.2); padding: 12px; margin-top: 12px; border-radius: 2px;">
    <p class="text-sm" style="color: var(--ephemeral);">
      This browser has no Bluetooth. Install the app to join the mesh — you can
      still read hubs you have already joined.
    </p>
  </div>
{/if}

{#if isNative && !primed}
  <div class="priming mt-6">
    <p class="text-sm mb-3" style="line-height: 1.6;">
      nearboard needs two permissions to find people near you.
    </p>
    <p class="text-sm text-muted mb-2" style="line-height: 1.6;">
      <strong>Bluetooth</strong> — how posts travel. Nothing goes to a server.
    </p>
    <p class="text-sm text-muted mb-3" style="line-height: 1.6;">
      <strong>Location</strong> — Android requires it before any app may scan
      for Bluetooth devices. nearboard never reads where you are.
    </p>
    <button class="primary w-full" onclick={acceptPriming}>Continue</button>
  </div>
{/if}

<!--
  Mesh state. Each phase is distinguishable and, when something is wrong, comes
  with the one tap that fixes it. A resting state that cannot be told apart from
  a fault is the thing this replaced.
-->
{#if isNative && !primed}
  <!-- Nothing to report until the mesh has been allowed to start. -->
{:else if $meshStatus.phase === 'blocked' && $meshStatus.blocker}
  {@const blocker = $meshStatus.blocker}
  <div class="mesh-blocker mt-6">
    <p class="mesh-blocker-title">{blocker.title}</p>
    <p class="mesh-blocker-detail">{blocker.detail}</p>
    {#if blocker.action && blocker.actionLabel}
      <button class="primary w-full mt-3" onclick={() => fixBlocker(blocker.action!)}>
        {blocker.actionLabel}
      </button>
    {/if}
  </div>
{:else}
  <div class="mesh-status mt-6" class:live={$meshStatus.phase === 'connected'}>
    <span class="mesh-dot" class:pulse={$meshStatus.phase === 'searching'}></span>
    {#if $meshStatus.phase === 'idle'}
      <span class="text-sm text-tertiary">mesh off</span>
    {:else if $meshStatus.phase === 'checking'}
      <span class="text-sm text-tertiary">checking bluetooth...</span>
    {:else if $meshStatus.phase === 'searching'}
      <span class="text-sm text-tertiary">
        no one nearby yet{lastSeen ? ` · last seen ${lastSeen}` : ''}
      </span>
    {:else}
      <span class="text-sm">
        {$meshStatus.peerCount} {$meshStatus.peerCount === 1 ? 'person' : 'people'} nearby
      </span>
    {/if}
  </div>
{/if}

{#if isNative && !$meshStatus.canAdvertise && $meshStatus.phase !== 'blocked'}
  <p class="text-xs text-tertiary mt-2" style="line-height: 1.5;">
    You can find others, but they can't find you — this device's Bluetooth
    can't advertise. Posts still sync with anyone you connect to.
  </p>
{/if}

<div class="flex flex-col gap-3 mt-6 mb-8">
  {#if !isNative && webBleSupported}
    <button onclick={connectFromBrowser} disabled={connecting} class="w-full">
      {connecting ? 'connecting...' : 'connect to someone nearby'}
    </button>
  {/if}
  <button class="w-full" onclick={() => goto('/create-hub')}>
    start a hub
  </button>
</div>

{#if error}
  <p class="text-sm text-accent mt-2">{error}</p>
{/if}

<!--
  Somebody opening this alone sees an app that appears to do nothing — which is
  also exactly what App Review sees, in a building with no other nearboard users
  in Bluetooth range. Saying plainly that it needs someone nearby, and offering
  a board that works without one, is the difference between "not finished" and
  "waiting for people".
-->
{#if $hubs.length === 0 && nearby.length === 0 && $meshStatus.phase !== 'blocked'}
  <div class="empty-intro mb-8">
    <p class="text-sm text-muted" style="line-height: 1.6;">
      nearboard needs someone else nearby. Posts travel phone to phone over
      Bluetooth — there is no server holding them.
    </p>
    <p class="text-sm text-muted mt-3" style="line-height: 1.6;">
      On your own? Open a board and turn on <em>reaching beyond Bluetooth</em>
      to see it working before anyone is in range.
    </p>
  </div>
{/if}

<div class="text-center mb-8 flex justify-center gap-4">
  <button class="ghost text-xs" onclick={() => goto('/settings')}>settings</button>
  <button class="ghost text-xs" onclick={() => goto('/about')}>about &amp; privacy</button>
</div>

{#if nearby.length > 0}
  <p class="text-xs text-tertiary mb-3" style="text-transform: uppercase; letter-spacing: 0.08em;">
    Boards near you
  </p>
  <div class="stagger mb-6">
    {#each nearby as hub (hub.hubId)}
      <div
        class="card interactive"
        role="button"
        tabindex="0"
        onclick={() => joinNearby(hub)}
        onkeydown={(e) => e.key === 'Enter' && joinNearby(hub)}
      >
        <div class="flex items-center gap-2">
          <span style="font-weight: 500;">{hub.name}</span>
          {#if !$hubs.some((h) => h.hubId === hub.hubId)}
            <span class="badge">tap to join</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}

{#if $hubs.length > 0}
  <p class="text-xs text-tertiary mb-3" style="text-transform: uppercase; letter-spacing: 0.08em;">
    Your hubs
  </p>
  <div class="stagger">
    {#each $hubs as hub}
      <div
        class="card interactive"
        role="button"
        tabindex="0"
        onclick={() => goto(`/hub/${hub.hubId}`)}
        onkeydown={(e) => e.key === 'Enter' && goto(`/hub/${hub.hubId}`)}
      >
        <div class="flex items-center gap-2">
          <span style="font-weight: 500;">{hub.name}</span>
          {#if hub.isOwned}<span class="badge">yours</span>{/if}
        </div>
        {#if hub.description}
          <p class="text-sm text-muted mt-1">{hub.description}</p>
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <div class="text-center" style="padding: 40px 0; color: var(--text-tertiary);">
    <p>no hubs found</p>
    <p class="text-xs mt-1">start a hub to create a local board</p>
  </div>
{/if}
