# NEARBOARD_V1_MONETIZATION_RESET.md

You are working inside the existing Nearboard app codebase.

Do NOT scaffold, re-architect, or rebuild the app.
This task is a V1 monetization strategy reset.

The app already exists.
Your job is to remove the current consumer paywall direction and replace it with a calm, passive monetization model that keeps Nearboard free for normal users.

---

## Product Decision

Nearboard V1 is a **free consumer app**.

We are explicitly removing:
- consumer paywalls
- subscription prompts
- trial flows
- upgrade nudges
- locked feature states
- pricing screens tied to consumer usage

We are replacing that strategy with:

1. **Affiliate link monetization** for eligible shopping, travel, and commercial links.
2. **No paywall for consumer usage in V1.**
3. **No subscription system in V1.**
4. **No RevenueCat / Stripe paywall UX in V1.**
5. Future monetization may later include a business-facing Pro layer, but do NOT build that now.

The goals are:
- maximize adoption
- reduce friction in multiplayer/family use
- preserve the anti-social-media feel
- keep the app calm, useful, and trustworthy
- generate passive revenue in the background

---

## Core Principle

Nearboard should feel:
- free
- useful
- calm
- private
- not manipulative
- not sales-y

If any current UI, logic, or copy feels like:
- "upgrade to continue"
- "premium feature"
- "trial expired"
- "unlock more boards"
- "subscribe for AI"
- "pay to remove limits"

remove or neutralize it for V1.

---

## Task 1 — Remove Existing Consumer Paywall Path

Audit the existing codebase and remove or disable all V1 consumer paywall behavior.

### Remove or disable:
- paywall routes
- upgrade screens
- premium screens
- subscription prompts
- trial logic
- premium badges
- locked UI states
- upgrade CTA buttons
- entitlement checks for normal consumer flows
- pricing copy in onboarding/settings tied to V1 consumer use
- RevenueCat logic used only for consumer paywall enforcement
- Stripe subscription logic used only for consumer paywall enforcement

### Replace with:
- normal free access
- neutral copy
- no dead buttons
- no hidden premium branch logic
- no confusing “coming soon premium” placeholders

### Important
If some billing code is shared or harmless and not actively enforcing a paywall, do not delete recklessly.
Remove only what is specifically part of the consumer monetization path.

```ts
// TODO: HIGH PRODUCT Remove all consumer paywall gating from active flows
// TODO: HIGH UX Remove upgrade prompts, premium badges, locked-state copy
// TODO: HIGH REFACTOR Remove premium-only routing tied to V1 consumer usage
// TODO: MED REFACTOR Delete unused paywall components/services after verification
// TODO: LOW COPY Rewrite leftover pricing language in onboarding/settings/help text
Task 2 — Establish V1 Monetization Strategy
Implement affiliate monetization as the only active V1 revenue model.

Rules
The app remains free for all core consumer use.

Monetization must be passive and non-intrusive.

No banner ads.

No interstitials.

No autoplay promotions.

No sponsored clutter.

No user-facing price gates.

No “boosted” content.

No manipulative conversion funnels.

Recommended V1 approach
Use an affiliate aggregation service first so link monetization is easier to manage and scalable.

Provider priority for V1
Skimlinks as the preferred default provider

Sovrn Commerce as the backup or alternative provider

Amazon Associates only as a supplemental direct program where needed

Keep the service modular so more providers can be added later

Why this approach
One integration point is easier to maintain than many separate merchant programs

Merchant coverage can grow without changing app UX

Link resolution and reporting stay centralized

Nearboard stays focused on product instead of affiliate operations

Implement
Create or finalize affiliateService.ts and integrate it into the content creation pipeline.

Required behavior
When a user adds a card containing a product/commercial/travel URL, evaluate whether the domain is eligible.

Attempt affiliate resolution through the configured provider.

If the provider can monetize the URL, store the resolved affiliate URL.

If the URL is not eligible, preserve the original URL.

If the affiliate provider fails, preserve the original URL and continue card creation.

Affiliate resolution must never block user posting.

Preserve the original URL for debugging and trust-safe auditing.

V1 merchant/domain categories
Keep domains configurable in constants, never hardcoded in UI:

Amazon

Walmart

Target

Home Depot

Lowe's

Best Buy

Booking

Expedia

Other approved shopping or travel domains later

Data model
If not already present, add these fields to ContentDoc:

ts
isAffiliate?: boolean;
originalUrl?: string;
resolvedUrl?: string;
affiliateProvider?: 'skimlinks' | 'sovrn' | 'amazon' | null;
affiliateStatus?: 'wrapped' | 'not-eligible' | 'fallback-original' | 'error';
Service API
In /src/lib/api/affiliateService.ts:

ts
export async function wrapUrl(url: string): Promise<{
  originalUrl: string;
  resolvedUrl: string;
  isAffiliate: boolean;
  affiliateProvider: 'skimlinks' | 'sovrn' | 'amazon' | null;
  affiliateStatus: 'wrapped' | 'not-eligible' | 'fallback-original' | 'error';
}>;
Configuration
Create affiliate.constants.ts or extend the existing constants layer:

ts
export const AFFILIATE_PROVIDER = 'skimlinks';

export const AFFILIATE_PROVIDER_PRIORITY = [
  'skimlinks',
  'sovrn',
  'amazon'
] as const;

export const AFFILIATE_ENABLED_DOMAINS = [
  'amazon.com',
  'walmart.com',
  'target.com',
  'homedepot.com',
  'lowes.com',
  'bestbuy.com',
  'booking.com',
  'expedia.com'
];
Integration point
Run affiliate wrapping in the service/content creation pipeline, never in Svelte components.

Prefer server-side or trusted service-layer execution.

Never make the user opt into affiliate wrapping per link.

Never change visible content in a spammy way.

Preserve UX exactly as if the user posted a normal link.

Fallback behavior
If provider API/network/config fails, continue with original URL.

Card creation must still succeed.

Log affiliate failures for admin diagnostics only.

Do not show users a monetization error.

ts
// TODO: HIGH LEGAL Add FTC-style affiliate disclosure in Settings
// TODO: HIGH SECURITY Perform affiliate wrapping outside UI components
// TODO: HIGH RELIABILITY Affiliate failures must never block card creation
// TODO: HIGH PRODUCT Preserve original URL for audit/debug purposes
// TODO: MED PRODUCT Start with one aggregator provider, keep interface modular
// TODO: MED ANALYTICS Add aggregate provider-level reporting without invasive tracking
// TODO: LOW OPERATIONS Add admin config for provider priority changes later
Task 3 — Add Trust-Safe Disclosure
Nearboard should be transparent without becoming annoying.

Add one concise disclosure in Settings
Use copy similar to:

"Some shopping or booking links may earn Nearboard a small commission at no extra cost to you. This helps keep the app free and ad-free."

Rules
Put the disclosure in Settings

Also include it in any legal/privacy/help surface if appropriate

Do NOT interrupt users with modal popups

Do NOT add manipulative consent prompts

Do NOT make the app feel monetized

Optional secondary copy
Use only if needed in Help or FAQ:

"Nearboard does not sell ads in your boards. We may earn a commission from certain links if you choose to purchase something."

ts
// TODO: HIGH LEGAL Add affiliate disclosure in Settings
// TODO: MED COPY Add matching language in privacy/help documentation
// TODO: LOW UX Keep disclosure visible but non-intrusive
Task 4 — Preserve Anti-Social-Media UX
As you remove the paywall and add affiliate support, keep the product calm.

Keep:
no public like counts

no engagement bait

no scarcity mechanics

no growth hacks

no manipulative upgrade funnels

no ad-like surfaces

no fake urgency

If any monetization-related UI exists:
remove it unless it is strictly required for legal disclosure

do not add affiliate badges to cards unless required later

do not alter feed ranking or board behavior based on monetization

ts
// TODO: HIGH UX Remove monetization UI that creates pressure or distraction
// TODO: HIGH PRODUCT Ensure free flows are fully usable end-to-end
// TODO: MED UX Verify no monetization surface interrupts sharing/capture flows
Task 5 — Future-Proof Without Building Pro Monetization
We may eventually monetize through a separate business-facing Pro layer, but that is NOT part of this task.

Do NOT build:
business subscriptions

workspace billing

Pro dashboards

vendor lead systems

Stripe checkout flows

RevenueCat entitlements

usage caps

AI paywalls

team billing

You may:
keep affiliate logic modular

leave clean extension points for future business monetization

avoid architectural choices that make future B2B expansion harder

ts
// TODO: LOW ARCH Keep monetization logic modular for future Pro/business layer
Task 6 — Audit Existing Copy and Settings
Search the app for any language that conflicts with the free V1 strategy.

Update or remove:
pricing references

“premium” labels

paid plan references

subscription help text

locked AI copy

plan comparison tables

any onboarding text that implies feature gating

Replace with:
clear free-product messaging

calm, low-pressure language

optional honest disclosure about affiliate-supported sustainability

ts
// TODO: HIGH COPY Remove all consumer pricing references from V1 UX
// TODO: MED COPY Replace premium language with neutral/free-access copy
// TODO: LOW BRAND Reinforce calm, ad-free, anti-social-media positioning
Deliverables
When complete, output:

A short summary of what paywall logic was removed or disabled

A short summary of what affiliate logic was added or updated

A short summary of what copy/settings/legal text changed

A TODO list grouped by HIGH → MED → LOW

Constraints
Do not re-architect the app

Do not add unrelated monetization systems

Do not add ads

Do not add sponsorship placements

Do not add newsletter monetization

Do not add per-board pricing

Do not add artificial feature caps for consumers

Keep logic DRY

Keep components small

Keep all Firestore logic in the proper service layer

Follow existing Nearboard architecture patterns

Execution Order
Follow this order:

Audit and remove/disable consumer paywall logic

Clean up pricing/premium copy

Implement/finalize affiliate service

Integrate affiliate wrapping into the content creation flow

Add affiliate disclosure in Settings/legal surfaces

Verify the app is fully usable as a free product

Output concise summary + grouped TODOs

Start now by auditing the existing paywall implementation and removing it safely.
Then implement the affiliate flow.
Stop after completion and provide a concise change summary plus grouped TODOs.

text

## One-line preface

If Claude already built a paywall path, prepend this line above the prompt:

```md
Important: A previous direction added consumer paywall logic. Undo that strategy and realign V1 around a free consumer product with affiliate monetization only.
