# Nearboard — Claude Code Master Prompt (SvelteKit + Capacitor)

You are building **"Nearboard"** — a shared ambient board app for close-knit
groups (families, friends, roommates, teams). Think Pinterest's zero-friction
clipping mechanic meets a real-time shared workspace, with an AI briefing
layer and AI chatbot connectors on top.

---

## Tech Stack

- **Frontend:** SvelteKit (latest) with TypeScript
- **Mobile:** Capacitor 6 (iOS + Android from one codebase)
- **Database:** Firebase Firestore (real-time listeners)
- **Auth:** Firebase Auth (Google, Apple, Email magic link + OAuth 2.0 for MCP)
- **Storage:** Firebase Storage (voice notes, images, files)
- **Push Notifications:** Firebase Cloud Messaging (FCM) via Capacitor Push Notifications plugin
- **AI Summaries:** Claude API (claude-3-5-haiku for speed/cost)
- **Text-to-Speech:** ElevenLabs API (voice briefings)
- **MCP Server:** Cloudflare Worker (low-latency MCP protocol endpoint)
- **Browser Extension:** Manifest V3 (Svelte-based popup)
- **Styling:** Tailwind CSS v4 with custom design tokens
- **Animations:** Svelte native transitions + GSAP for complex sequences
- **Icons:** Phosphor Icons (Svelte)
- **Hosting:** Firebase Hosting + Cloudflare CDN
- **Monetization:** Affiliate links (V1 strategy)

---

## Engineering Standards (Follow These at All Times)

### DRY (Don't Repeat Yourself)

- Every reusable piece of logic must live in one place only — a shared
  utility, store, service, or component.
- If you write the same logic twice, stop and extract it immediately.
- Firebase read/write operations must go through a single `/src/lib/firebase/`
  service layer — never call Firestore directly from a component.
- API calls (Claude, ElevenLabs, MCP) must live in `/src/lib/api/` — never
  inline in components or Cloud Functions.
- All animation configs (durations, easings, delays) must be defined in
  `/src/lib/config/animations.ts` and imported — never hardcoded inline.
- All color tokens, spacing, and design constants must live in
  `tailwind.config.ts` — never use arbitrary Tailwind values.
- MCP tool implementations must call the existing `/src/lib/firebase/`
  service layer — never duplicate Firestore logic in the MCP server.

### Maintainable Code

- Every file must have a single, clear responsibility — if a file is doing
  two things, split it.
- Component files: max 200 lines. If longer, decompose into sub-components.
- Cloud Functions: max 80 lines per function. Extract helpers into
  `/functions/src/utils/`.
- Use TypeScript strictly — no `any` types. Define interfaces for every
  Firestore document shape in `/src/lib/types/`.
- All Firestore document types must be defined in `/src/lib/types/firestore.ts`
  and shared between client, Cloud Functions, and MCP server.
- Name functions and variables for what they do, not how they do it
  (`getBoardBriefing` not `fetchData`).
- Every component must accept only typed props — no implicit prop drilling.
- Svelte stores must be in `/src/lib/stores/` with one store per domain
  (boardStore, userStore, notificationStore).
- Use barrel exports (`index.ts`) in every `/lib/` subdirectory for clean
  imports.

### TODO Logging

- The central source of truth for all tasks is **`TODO.md`** in the root directory.
- Any incomplete feature, known limitation, edge case, or future improvement
  must be logged as a structured TODO comment in the code AND added to `TODO.md`:

```ts
// TODO: [PRIORITY] [CATEGORY] Description
// Priority: HIGH | MED | LOW
// Category: FEATURE | PERF | UX | SECURITY | REFACTOR | BUG
```

At the top of every file that has TODOs, add a file-level summary block.
After each build step, update **`TODO.md`** with the latest progress.

---

## Project Structure

```text
/nearboard
  /src
    /lib
      /firebase
        boardService.ts
        userService.ts
        storageService.ts
        pricingService.ts       ← product price tracking
        index.ts
      /api
        claudeService.ts
        elevenlabsService.ts
        affiliateService.ts     ← affiliate link wrapping (V1 monetization)
        ogExtractor.ts
        priceWatcher.ts         ← retailer price polling
        paywallService.ts       ← legacy/neutralized gates (all free in V1)
        index.ts
      /stores
        boardStore.ts
        userStore.ts
        notificationStore.ts
        todayStore.ts           ← Today dashboard data
        index.ts
      /types
        firestore.ts
        ui.ts
        api.ts
        mcp.ts                  ← MCP tool input/output types
        index.ts
      /config
        animations.ts
        constants.ts
        affiliate.constants.ts  ← affiliate config
      /utils
        contentDetector.ts
        dateFormatter.ts
        ogParser.ts
    /components
      /cards
        NoteCard.svelte
        ListCard.svelte
        LinkCard.svelte
        ProductCard.svelte
        VoiceCard.svelte
        PhotoCard.svelte
        LocationCard.svelte
      /ui
        FAB.svelte
        BottomSheet.svelte
        Avatar.svelte
        BoardHeader.svelte
        BriefingCard.svelte
        PollCard.svelte         ← voting on board cards
        TodayDashboard.svelte   ← cross-board daily digest
        StreakBadge.svelte      ← board streak counter
    /routes
  /functions
    /src
      /triggers
        onBoardContentWrite.ts  ← AI briefing trigger
        onProductPriceDrop.ts   ← price alert trigger
      /scheduled
        morningDigest.ts        ← 8am daily briefing
        priceWatcher.ts         ← periodic price polling
        wrappedGenerator.ts     ← annual Wrapped card
      /utils
  /mcp
    server.ts                   ← Cloudflare Worker MCP endpoint
    tools/
    oauth/
  /extension
```

---

## Design Philosophy

- **Calm and private** — Nearboard is a free consumer app with no paywalls, no ads, and no engagement bait.
- **Minimalist and warm** — off-white backgrounds (#FAFAF8), soft shadows, no harsh borders.
- **Fluid motion everywhere** — every state change, card add, and notification has a purposeful animation.
- **Mobile-first** — interactions designed for thumb reach zones.
- **Zero cognitive load** — the user should never have to think about where to tap. One FAB is the only entry point.

---

## Core Features (All Free in V1)

### 1) Real-Time Board Sync
Firestore onSnapshot listeners managed through boardService.ts.

### 2) Zero-Friction FAB
Single violet FAB. Radial menu for Note, Voice, Photo, Video, Link, List, Poll, Location.

### 3) Content Card Types
Masonry grid layout. Each card has author avatar and timestamp. Swipe-left to delete.

### 4) AI Briefing System
Daily briefings summarized by Claude and optionally read aloud via ElevenLabs.

### 5) Push Notifications
Silent | Ping | Voice modes. Morning digest at 8am. Price drop alerts.

### 6) Browser Extension
Save links, products, and notes directly to any board.

### 7) Monetization: Affiliate Strategy
Nearboard is free for all core consumer use. Monetization is passive via affiliate links:
- Commercial links (Amazon, Walmart, Booking, etc.) are automatically wrapped with affiliate tracking.
- Transparency: A concise disclosure in Settings explains that some links may earn commissions to keep the app free.

### 8) Board Time Capsule
Owner can lock a board until a future unlock date.

### 9) AI Board Assistant
Chat with your board's content via Claude.

### 10) MCP Server (AI Chatbot Connectors)
Connect Nearboard to Claude, ChatGPT, etc., via Model Context Protocol.

---

## Build Order (V1 Re-aligned)

1. Project scaffold & Auth
2. Board creation & Real-time sync
3. Card types (Note, List, Link, Product, Voice, Photo, Video, Poll, Location)
4. AI Briefing System (Text + Voice)
5. Today Dashboard & Streaks
6. Public Board Mode
7. Product Price Tracking
8. **Affiliate Service Integration (V1 Monetization)**
9. AI Board Assistant
10. Board Time Capsule
11. MCP Server & OAuth
12. Nearboard Wrapped (Annual)
13. Templates Marketplace
