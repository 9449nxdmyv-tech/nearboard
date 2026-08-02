<script lang="ts">
  /**
   * Settings.
   *
   * Two things here are more than preferences and are worded accordingly: the
   * display name, which is a claim anyone can copy, and the internet transport,
   * which changes a board from local to globally reachable.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Capacitor } from '@capacitor/core';
  import {
    getDisplayName,
    setDisplayName,
    fingerprint,
    MAX_NAME_LENGTH
  } from '$lib/crypto/profile';
  import { getOrCreateSigningIdentity } from '$lib/crypto/signing';
  import { showToast } from '$lib/stores/toasts';
  import { meshStatus } from '$lib/stores/mesh';

  const isNative = Capacitor.isNativePlatform();

  let name = $state('');
  let myKey = $state('');
  let saved = $state(false);

  onMount(() => {
    name = getDisplayName();
    myKey = getOrCreateSigningIdentity().authorId;
  });

  function saveName() {
    const normalized = setDisplayName(name);
    name = normalized;
    saved = true;
    showToast(normalized ? `You will appear as "${normalized}"` : 'You will appear as anonymous');
    setTimeout(() => { saved = false; }, 1500);
  }
</script>

<div class="animate-in" style="padding-top: max(24px, env(safe-area-inset-top));">
  <nav class="flex items-center gap-2 mb-6">
    <button class="ghost" onclick={() => goto('/')} aria-label="Back" style="padding: 6px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>
    <h1 style="font-size: 18px; font-weight: 400;">Settings</h1>
  </nav>

  <section class="mb-8">
    <h2 class="settings-heading">Your name</h2>
    <form onsubmit={(e) => { e.preventDefault(); saveName(); }} class="flex gap-2 mb-2">
      <input
        bind:value={name}
        placeholder="anonymous"
        maxlength={MAX_NAME_LENGTH}
        style="flex: 1;"
      />
      <button type="submit" class:primary={!saved}>{saved ? 'saved' : 'save'}</button>
    </form>
    <p class="settings-note">
      A label, not an account. Names are not unique — anyone can pick the same
      one, so posts also show the short code below, which nobody else can copy.
    </p>
  </section>

  <section class="mb-8">
    <h2 class="settings-heading">Your code</h2>
    <p class="settings-key">{fingerprint(myKey)}</p>
    <p class="settings-note">
      Derived from the key that signs your posts. This is what actually
      identifies you — share it if someone needs to be sure a post is yours.
    </p>
  </section>

  {#if isNative}
    <section class="mb-8">
      <h2 class="settings-heading">Bluetooth</h2>
      <p class="settings-note">
        {#if $meshStatus.canAdvertise}
          This device can be found by others and can find them.
        {:else}
          This device can find others, but cannot be found by them — its
          Bluetooth does not support advertising.
        {/if}
      </p>
      <p class="settings-note mt-2">
        Currently {$meshStatus.peerCount}
        {$meshStatus.peerCount === 1 ? 'person' : 'people'} nearby.
      </p>
    </section>
  {/if}

  <section class="mb-8">
    <h2 class="settings-heading">Reaching beyond Bluetooth</h2>
    <p class="settings-note">
      Turned on per board, from the board itself. It is off by default and
      deliberately not a global switch — a board that reaches the internet is no
      longer only a local board, and that is a decision worth making one board
      at a time.
    </p>
  </section>

  <section class="mb-8">
    <h2 class="settings-heading">Notifications</h2>
    <p class="settings-note">
      nearboard tells you when a board you have joined receives posts while you
      are elsewhere, at most once a minute per board. Turn them off in your
      system settings.
    </p>
  </section>

  <div class="flex flex-col gap-3 mb-8">
    <button class="w-full" onclick={() => goto('/about')}>
      about, privacy &amp; blocked people
    </button>
  </div>
</div>

<style>
  .settings-heading {
    font-size: 13px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    margin-bottom: 8px;
  }
  .settings-note {
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-muted, #999);
  }
  .settings-key {
    font-family: ui-monospace, monospace;
    font-size: 18px;
    letter-spacing: 0.06em;
    margin-bottom: 8px;
  }
</style>
