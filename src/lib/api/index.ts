/**
 * @file api/index.ts
 * @description Barrel export for all external API service modules.
 * @todos
 *   - (claudeService + ttsService + priceWatcher live in functions/src/utils/ — server-side only)
 */

export { extractMetadata } from './ogExtractor';
export { wrapUrl, type AffiliateResult } from './affiliateService';
export { createRateLimiter } from './rateLimiter';
