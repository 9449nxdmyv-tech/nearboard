<script lang="ts">
  /**
   * Privacy, guidelines and contact, in one place.
   *
   * App Review requires published contact details and a privacy policy for an
   * app carrying user content. More usefully, this is where the app has to be
   * straight about what it does and does not protect — particularly the
   * encryption, which is easy to overstate and dangerous to rely on if
   * misunderstood.
   */
  import { goto } from '$app/navigation';
  import { moderation, unblock, unmute, mute } from '$lib/stores/moderation';

  const SUPPORT_EMAIL = 'support@nearboard.app';

  let newMutedWord = $state('');

  function addMutedWord() {
    const word = newMutedWord.trim();
    if (!word) return;
    mute(word);
    newMutedWord = '';
  }

  function shortKey(authorId: string): string {
    return authorId.slice(0, 8) + '…' + authorId.slice(-4);
  }
</script>

<div class="animate-in" style="padding-top: max(24px, env(safe-area-inset-top));">
  <nav class="flex items-center gap-2 mb-6">
    <button class="ghost" onclick={() => goto('/')} aria-label="Back" style="padding: 6px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>
    <h1 style="font-size: 18px; font-weight: 400;">About &amp; privacy</h1>
  </nav>

  <section class="mb-8">
    <h2 class="policy-heading">What nearboard is</h2>
    <p class="policy-text">
      A local board you share with people physically near you, over Bluetooth.
      There are no accounts and no server holding your posts. Posts live on the
      devices of people who received them, and are passed on device to device.
    </p>
  </section>

  <section class="mb-8">
    <h2 class="policy-heading">What we collect</h2>
    <p class="policy-text">
      Nothing. There is no analytics, no tracking, no advertising identifier and
      no account. Your posts, your keys and your settings are stored on your
      device only.
    </p>
    <p class="policy-text mt-2">
      We cannot read your posts, delete them, or tell you who wrote one — not as
      a policy, but because there is no server on which any of that could happen.
      That is also the limit of what we can do if something goes wrong.
    </p>
  </section>

  <section class="mb-8">
    <h2 class="policy-heading">What leaves your device</h2>
    <p class="policy-text">
      Over Bluetooth, posts go to people in range and are relayed onward by
      their devices.
    </p>
    <p class="policy-text mt-2">
      If you turn on <strong>reaching beyond Bluetooth</strong> for a board, its
      posts are also sent to public Nostr relays — servers operated by third
      parties, not by us. They are encrypted first, so a relay stores something
      it cannot read.
    </p>
  </section>

  <section class="mb-8">
    <h2 class="policy-heading">About that encryption</h2>
    <!--
      Stated plainly and without flattery. The key comes from the hub name, so
      anyone who knows or guesses the name can read everything on that board.
      Calling this "encrypted" and stopping there would mislead someone who
      might rely on it for something that matters.
    -->
    <p class="policy-text">
      The key for a board is derived from its <em>name</em>. Anyone who knows
      the name — or guesses it — can read that board. A common name like
      "coffee shop" should be assumed public.
    </p>
    <p class="policy-text mt-2">
      This protects a board from relay operators and passers-by. It is
      <strong>not</strong> private messaging, and nearboard should not be used
      for anything you would be harmed by others reading.
    </p>
  </section>

  <section class="mb-8">
    <h2 class="policy-heading">Community guidelines</h2>
    <p class="policy-text">
      Do not post content that harasses, threatens or targets a person; sexual
      content involving minors; or anything unlawful where you are. Posts are
      signed, and a signature cannot be shed by reconnecting.
    </p>
    <p class="policy-text mt-2">
      Reporting a post lowers it for everyone, not just you, and blocking an
      author is permanent on this device. Both are on each post.
    </p>
  </section>

  <section class="mb-8">
    <h2 class="policy-heading">Blocked people</h2>
    {#if $moderation.blocked.length === 0}
      <p class="policy-text">You have not blocked anyone.</p>
    {:else}
      <div class="flex flex-col gap-2">
        {#each $moderation.blocked as authorId (authorId)}
          <div class="flex items-center justify-between gap-2">
            <code class="text-xs text-tertiary">{shortKey(authorId)}</code>
            <button class="ghost text-xs" onclick={() => unblock(authorId)}>unblock</button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="mb-8">
    <h2 class="policy-heading">Muted words</h2>
    <p class="policy-text mb-3">
      Posts containing these are collapsed on this device. Nobody else is
      affected.
    </p>
    <form class="flex gap-2 mb-3" onsubmit={(e) => { e.preventDefault(); addMutedWord(); }}>
      <input bind:value={newMutedWord} placeholder="a word to mute" maxlength="40" style="flex: 1;" />
      <button type="submit" disabled={!newMutedWord.trim()}>mute</button>
    </form>
    {#if $moderation.mutedWords.length > 0}
      <div class="flex flex-col gap-2">
        {#each $moderation.mutedWords as word (word)}
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm">{word}</span>
            <button class="ghost text-xs" onclick={() => unmute(word)}>remove</button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="mb-8">
    <h2 class="policy-heading">Contact</h2>
    <p class="policy-text">
      Questions, or a report you cannot handle in the app:
      <a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a>
    </p>
  </section>

  <p class="text-xs text-tertiary mb-8">
    nearboard is 17+. Content comes from people nearby and is not reviewed
    before you see it.
  </p>
</div>

<style>
  .policy-heading {
    font-size: 13px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    margin-bottom: 8px;
  }
  .policy-text {
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-muted, #999);
  }
  .policy-text a {
    color: var(--accent);
  }
</style>
