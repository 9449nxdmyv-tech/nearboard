# Nearboard — V3 Feature Prompt (Anti-Social Media Layer, Updated)

Nearboard is already built. The V2 foundations (moderation, age gating,
share sheet, video / multi-photo, Pinterest-style previews, voice notes,
feed, search, affiliate link wrapping, public board sharing) already exist
or are in progress.

Do NOT scaffold, re-architect, or duplicate anything that already exists.
Refactor in place when needed. Reuse existing services, stores, route patterns,
and UI primitives whenever possible.

One numbered item at a time. Stop after each and output:
1. A short summary of what changed.
2. A TODO list grouped HIGH → MED → LOW.

Follow the existing codebase structure and architecture.
Prioritize maintainability, DRY patterns, strict typing, and security.

---

## Product North Star

Nearboard is the anti-social media app for close-knit groups.

- No algorithms hijacking attention.
- No public likes or follower counts.
- No infinite scroll.
- Calm, finite feed with a clear "you're done" moment.
- Private by default, transparent in behavior, and simple to trust.

Core goals:
- Make capturing and sharing with close people effortless.
- Turn messy boards into clear shared context.
- Help users start boards faster with better onboarding and invitations.
- Keep everything maintainable, secure, and aligned with the current app architecture.

---

## Engineering Standards (Must Follow)

- All Firestore logic stays in `/src/lib/firebase/` — never in components.
- All new types go in `/src/lib/types/`.
- All new animation constants go in `/src/lib/config/animations.ts`.
- Max ~200 lines per component — decompose when needed.
- Reuse existing stores, cards, sheets, and route conventions.
- Refactor duplicated logic into shared services or utilities.
- Every TODO must use `[PRIORITY] [CATEGORY]` format.
- Security rules and server-side validation are part of the feature, not optional follow-up work.

---

## Feature 1 — Living Summary (Refactor AI Board Agent)

Goal: Replace the earlier "AI board agent" concept with a simpler,
more trustworthy, and more maintainable system: a pinned AI-maintained
Living Summary that reflects the current state of the board.

This is a refactor of the AI board assistant concept, not a second AI system.
There must be a single board intelligence layer called **Living Summary**.
Do not introduce a separate "agent" abstraction if existing briefing logic can be reused.

### Data

Add to `BoardDoc` in `firestore.ts`:
```ts
livingSummary?: {
  content: string;
  updatedAt: Timestamp;
  version: number;
  editedByAdmin: boolean;
};
enableLivingSummary: boolean;
```

### Behavior

- Reuse or refactor existing AI briefing logic into a single board summary pipeline.
- On content create/update/delete in a board:
  - debounce ~5 minutes to batch rapid changes;
  - only regenerate if meaningful changes occurred since last summary;
  - fetch the previous summary plus recent relevant cards;
  - generate an updated summary focused on:
    - decisions made,
    - current status,
    - important context,
    - next steps.
- Save result to `BoardDoc.livingSummary`.
- If the AI call fails, keep the previous summary.
- Board admins can manually edit the summary.
- Manual edits become the new baseline for the next regeneration.

### UI

Create `LivingSummaryCard.svelte` in `/components/ui/`:
- pinned at top of board;
- visually distinct from normal cards;
- title: `Current State`;
- summary body;
- small updated timestamp;
- admin-only `Edit` action;
- board setting toggle: `Auto-update summary`.

### Security / Maintainability

- AI generation happens server-side only.
- Never expose prompt internals or privileged board data to clients beyond the saved summary.
- Reuse existing Claude / AI service plumbing if present.
- Do not create duplicate summary systems (briefing + agent + summary); consolidate into one.

```ts
// TODO: HIGH SECURITY Ensure only board members can read livingSummary on private boards
// TODO: HIGH ARCH Refactor existing AI briefing / board-agent code into one summary pipeline
// TODO: MED COST Truncate card payload before AI call to control token use
// TODO: LOW FEATURE Add per-board summary style presets after core refactor is stable
```

---

## Feature 2 — Single-Layer Card Comments

Goal: Allow focused discussion directly on a card without turning Nearboard
into a chat app.

Comments must be flat, lightweight, and intentionally constrained.
No threading. No reactions on comments. No media attachments in comments.

### Data

Add `CommentDoc` in `firestore.ts` or the appropriate shared types file:
```ts
{
  id: string;
  authorId: string;
  text: string; // max 280 chars
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}
```

Collection path:
`/boards/{boardId}/content/{contentId}/comments/{commentId}`

### Services

Add to `boardService.ts` or the existing board-comment service layer:
- `addComment(boardId, contentId, text)`
- `getComments(boardId, contentId)`
- `deleteComment(boardId, contentId, commentId)`

If comment logic already exists partially, refactor and normalize it.
Do not create parallel comment services.

### Rules / Limits

- Character limit: **280 characters**.
- Single-layer only; no replies to comments.
- One comment per user every 10 seconds (server-side enforced).
- Board-level setting on `BoardDoc`:
  ```ts
  allowComments: boolean;
  ```
- If `allowComments === false`, disable input and hide add-comment CTA.

### UI

Create `CardComments.svelte` in `/components/ui/`:
- flat chronological list;
- compact composer;
- character counter;
- comment count badge on card;
- empty state when no comments exist;
- simple delete action for own comments and board admins.

### Moderation / Security

- Reuse the existing moderation pipeline for comment toxicity checks.
- Enforce character limit server-side, not just client-side.
- Firestore rules:
  - only board members can read/write comments;
  - users can delete only their own comments unless board admin;
  - rate limit backed by server / rules strategy.

```ts
// TODO: HIGH SECURITY Enforce 280-char limit and membership checks server-side
// TODO: HIGH SECURITY Rate limit comments to 1 every 10 seconds per user
// TODO: MED UX Show remaining characters in composer only when user is near limit
// TODO: LOW FEATURE Add @mentions later only if it fits existing notification architecture
```

---

## Feature 3 — Better Board Creation + Contact Invites

Goal: Make creating a board feel instant and social by letting users invite
people from their contacts during setup, then show joined members immediately
as social proof and context.

This should improve activation, not add complexity.

### Board Creation Flow

Refactor the current board creation flow into a clearer multi-step flow,
reusing existing sheets / modals / route patterns where possible:

1. Board name
2. Optional cover / preview context
3. Invite people from contacts
4. Confirm and create

Keep the flow minimal and fast. Do not turn it into a long wizard.

### Contacts Integration

- Use native contacts permission via Capacitor / existing mobile bridge if present.
- Create a secure contacts abstraction layer, e.g. `contactsService.ts`, not direct component access.
- Read contacts locally only after explicit user permission.
- Normalize contacts into a UI-safe shape:
  ```ts
  {
    id: string;
    displayName: string;
    phoneNumbers: string[];
    emails: string[];
  }
  ```
- Match contacts against existing Nearboard users server-side where possible.
- Allow inviting by phone/email for contacts who are not yet on Nearboard.

### Invites

- Add invitation flow to board creation:
  - select contacts;
  - create board;
  - send invites using existing invite/share mechanism when possible.
- Reuse the existing board share / invite system rather than creating a second invite path.
- Persist pending invite metadata in a secure, normalized way.

### Joined Preview

After board creation, invited contacts who have joined the board should be previewed at the top.

Update `BoardCard.svelte` and/or board header UI to show:
- joined member avatar stack at top;
- prioritize recently invited contacts who joined;
- show pending invite count separately if helpful (`+2 invited`).

Do not fake joined status. Only show joined members if membership is real.

### Security / Privacy

- Never upload the entire address book raw to Firestore.
- Only send minimal hashed / normalized lookup values required for match or invite flows.
- Contacts permission must be optional and gracefully skippable.
- If permission denied, fallback to manual invite by link.
- Firestore rules must ensure only authorized board admins can create invites.

```ts
// TODO: HIGH PRIVACY Never persist raw contacts unnecessarily; minimize and hash where possible
// TODO: HIGH SECURITY Reuse existing invite/share mechanism instead of duplicating membership flows
// TODO: MED UX Fallback cleanly to share-link invite when contacts permission is denied
// TODO: LOW FEATURE Show "joined from your invite" badge briefly after first join event
```

---

## Feature 4 — Finish Line (You're All Caught Up)

Goal: Replace infinite scroll with a calm, satisfying end state.
When the user has seen all new content, explicitly tell them there is
nothing else to check right now.

### Behavior

- In both `GlobalFeed.svelte` and `TodayDashboard.svelte`:
  - derive unseen cards using existing `lastSeenAt` logic;
  - mark items seen when sufficiently visible;
  - batch seen-state updates;
  - render `FinishLine.svelte` when there is no unseen content left.
- If new items arrive while Finish Line is visible:
  - show a subtle refresh banner;
  - do not auto-insert or auto-scroll.

### UI

Create `FinishLine.svelte` in `/components/ui/`:
- calm, minimal presentation;
- primary text: `You're all caught up.`
- secondary text: `Nothing new right now. Come back later.`
- no engagement bait.

### Security / Maintainability

- Reuse existing feed stores and seen-state logic.
- Do not create a second unread tracking system.

```ts
// TODO: HIGH ARCH Reuse existing lastSeen / feed derivation logic instead of duplicating unread tracking
// TODO: MED PERF Batch visibility-based seen writes to avoid Firestore spam
// TODO: LOW UX Add subtle fade-in on Finish Line appearance
```

---

## Feature 5 — Private Acknowledgments (No Public Likes)

Goal: Let members quietly acknowledge a card without creating public metrics,
pressure, or popularity dynamics.

### Data

Add to `ContentDoc`:
```ts
acknowledgments?: {
  [userId: string]: {
    type: 'heart';
    createdAt: Timestamp;
  }
}
```

Keep it intentionally minimal: one type only.

### Behavior

- Any member can toggle acknowledgment on their own behalf.
- Only the card author can see who acknowledged their card.
- Other users only see their own acknowledged state.
- No counts in public UI.
- No sorting or ranking by acknowledgment data.

### UI

Create `CardAcknowledgmentButton.svelte`:
- single heart icon;
- subtle tap animation;
- no public counts.

Author-only private detail:
- discreet line on card showing who acknowledged;
- optional bottom sheet with full list.

### Security

- Users may only write or delete their own acknowledgment entry.
- Membership required for read/write.
- No analytics, rankings, or recommendation logic derived from acknowledgments.

```ts
// TODO: HIGH SECURITY Firestore rules must restrict acknowledgment writes to current user key only
// TODO: MED UX Keep acknowledgment UI subtle and private to preserve anti-social feel
// TODO: LOW FEATURE Allow per-board disable toggle if needed later
```

---

## Build Order — Follow Exactly

1. Living Summary refactor (replace AI board agent concept)
2. Single-layer card comments with 280-char limit
3. Better board creation + contact invites + joined preview
4. Finish Line
5. Private Acknowledgments

After each item:
- stop;
- output a short summary;
- output TODOs grouped HIGH → MED → LOW.

Start with item 1.
