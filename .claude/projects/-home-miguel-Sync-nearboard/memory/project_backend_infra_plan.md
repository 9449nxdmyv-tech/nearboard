---
name: Backend Infrastructure Improvements (Gemini Review)
description: Gemini review of backend/infra with 6 accepted fixes implemented 2026-03-22
type: project
---

Backend infrastructure review from Gemini, analyzed and selectively implemented on 2026-03-22.

## Implemented (all 6 verified with 0 TS errors)

1. **isMember Firestore rule optimization** — Removed redundant `exists()` call on members subcollection. `memberIds` array check is sufficient, eliminating a shadow read per protected operation.

2. **Streak race condition fix** — Replaced read-compute-write pattern with `db.runTransaction()` in `onBoardContentWrite.ts`. Two concurrent content creates no longer overwrite each other's streak value.

3. **inviteContacts atomicity** — Replaced `Promise.all` + separate `updateDoc` with a single `writeBatch()` in `boardService.ts`. Invite docs + `pendingInviteCount` update are now atomic.

4. **processDirtyBoards lease pattern** — Clear `summaryDirty` before AI processing, re-set on failure. Prevents duplicate AI calls when two function instances overlap.

5. **Price history capping** — Added `MAX_PRICE_ENTRIES = 730` in `priceWatcher.ts`. Trims old entries on price change to prevent hitting 1MB Firestore doc limit.

6. **updateBoardSummary cursor query** — Replaced `limit(50)` + post-fetch filter with `where('createdAt', '>', lastSummaryTimestamp)` cursor. No new items missed for very active boards.

## Rejected (with reasons)

- **Proxy rotation for priceWatcher** — Over-engineering for current scale
- **Headless browser for OG** — Multi-tier UA fallback already works well
- **notifications/activities Firestore rules** — Collections don't exist client-side (confirmed by grep)
- **Zod shared schemas** — Massive refactor, marginal gain
- **Mock affiliate service** — Already simple with graceful degradation
- **Cloud Tasks for priceWatcher** — Over-engineering
- **lastSeen write batching** — Already throttled to 10s, low impact
- **Custom Claims for memberIds** — Complex migration; memberIds array on board doc is simpler

**Why:** Gemini's review was thorough but several recommendations were over-engineered for the project's current scale. We focused on correctness (race conditions, atomicity) and cost (shadow reads, unbounded growth) over infrastructure complexity.

**How to apply:** These are all deployed changes. If revisiting price tracking at scale, proxy rotation and Cloud Tasks may become relevant.
