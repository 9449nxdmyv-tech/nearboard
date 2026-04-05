# 🔒 Security & Code Review Report

**Project:** Nearboard  
**Date:** March 24, 2026  
**Reviewer:** AI Assistant  
**Scope:** Full codebase review for security vulnerabilities and bugs

---

## ✅ **Security Strengths**

### **1. Authentication & Authorization** ✅ EXCELLENT

- **Firebase Authentication** properly implemented
- **Firestore Security Rules** are comprehensive and well-structured:
  - Per-board member/owner checks
  - Age-gating (teen users can't create public boards)
  - Rate limiting on comments (10s cooldown)
  - Immutable votes (can't change/delete)
  - Proper subcollection access controls

```typescript
// Example: Good security pattern
allow create: if isMember(boardId)
  && request.resource.data.authorId == request.auth.uid
  && request.resource.data.moderationStatus == 'approved';
```

### **2. XSS Prevention** ✅ GOOD

- **DOMPurify** used for all user-generated HTML:
  - `src/lib/utils/textFormatter.ts` properly sanitizes AI summaries
  - Only allows safe tags: `p, ul, ol, li, strong, em, a, br`
  - Only allows safe attributes: `href, target, rel`

```typescript
function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { 
    ALLOWED_TAGS, 
    ALLOWED_ATTR 
  });
}
```

### **3. SSRF Protection** ✅ EXCELLENT

- **`isPrivateHost()`** function blocks internal IP ranges:
  - IPv4 private ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
  - IPv6 loopback/private ranges
  - IPv4-mapped IPv6 addresses
  - localhost

```typescript
function isPrivateHost(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, '').split('%')[0];
  if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.)/.test(clean)) return true;
  // ... more checks
}
```

### **4. Input Validation** ✅ GOOD

- **URL validation** in `ogMetadata.ts`:
  - Protocol check (http/https only)
  - Private IP blocking
  - Proper URL parsing with try/catch

- **Content length limits** in Firestore rules:
  - Note/voice text: max 10,000 chars
  - List title: max 200 chars
  - Comments: max 280 chars

### **5. Rate Limiting** ✅ GOOD

- **Per-IP rate limiting** (30 requests/minute)
- **Comment rate limiting** (10s cooldown per user)
- **In-memory store** with automatic cleanup

---

## ⚠️ **Security Issues Found**

### **CRITICAL: None Found** 🎉

No critical security vulnerabilities were identified.

---

### **HIGH: None Found** 🎉

No high-severity issues were identified.

---

### **MEDIUM: 2 Issues**

#### **M1: CSP Header Not Enforced in Dev** ⚠️

**Location:** `src/hooks.server.ts`

**Issue:** Content Security Policy (CSP) is only set in `firebase.json`, not in development.

**Current Code:**
```typescript
// NOTE: CSP is set in firebase.json headers for production
// hooks.server.ts only runs during dev, not in the static build.
```

**Risk:** XSS attacks possible in development environment.

**Fix:**
```typescript
// Add CSP header in hooks.server.ts
response.headers.set(
  'Content-Security-Policy',
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com;"
);
```

**Priority:** Medium  
**Effort:** 10 minutes

---

#### **M2: Rate Limiter Not Persistent** ⚠️

**Location:** `functions/src/triggers/ogMetadata.ts`, `src/lib/api/rateLimiter.ts`

**Issue:** Rate limiting uses in-memory Map, which resets on function restart. Attackers can bypass by waiting for cold start.

**Current Code:**
```typescript
const rateLimiter = new Map<string, { count: number; resetAt: number }>();
```

**Risk:** DDoS or abuse during function restarts.

**Fix:** Use Firebase Firestore or Redis for persistent rate limiting:

```typescript
// Use Firestore for persistent rate limiting
const db = getFirestore();
const rateLimitRef = db.doc(`rateLimits/${ip}`);

async function isRateLimited(ip: string): Promise<boolean> {
  const doc = await rateLimitRef.get();
  // ... check and update count
}
```

**Priority:** Medium  
**Effort:** 2 hours

---

### **LOW: 5 Issues**

#### **L1: Memory Leak in setInterval** ⚠️

**Location:** Multiple files

**Issue:** `setInterval` timers not always cleared on component unmount.

**Affected Files:**
- `src/lib/components/ui/QuickCaptureVoiceSheet.svelte:145`
- `src/routes/board/[boardId]/time-capsule/+page.svelte:36`
- `extension/src/popup/App.svelte:82`

**Example:**
```svelte
<script>
  let elapsedTimer = setInterval(() => { ... }, 1000);
  // ❌ Never cleared on unmount
</script>
```

**Fix:**
```svelte
<script>
  let elapsedTimer: ReturnType<typeof setInterval>;
  
  onMount(() => {
    elapsedTimer = setInterval(() => { ... }, 1000);
    return () => clearInterval(elapsedTimer); // ✅ Cleanup
  });
</script>
```

**Priority:** Low  
**Effort:** 30 minutes

---

#### **L2: Missing Error Handling in async/await** ⚠️

**Location:** Multiple files

**Issue:** Some `await` calls lack try/catch blocks.

**Example:**
```typescript
// src/routes/board/[boardId]/+page.svelte
const board = await getBoard(boardId); // ❌ No error handling
```

**Fix:**
```typescript
try {
  const board = await getBoard(boardId);
} catch (error) {
  console.error('Failed to load board:', error);
  showToast('Failed to load board', 'error');
}
```

**Priority:** Low  
**Effort:** 1 hour

---

#### **L3: Console Logs with Sensitive Data** ⚠️

**Location:** `functions/src/triggers/ogMetadata.ts`

**Issue:** Some error logs might expose internal state.

**Current Code:**
```typescript
console.error('Enrichment error:', error);
```

**Risk:** If error object contains sensitive data, it could be logged.

**Fix:**
```typescript
console.error('Enrichment error:', {
  message: error.message,
  url: targetUrl,
  // Don't log full error stack or internal state
});
```

**Priority:** Low  
**Effort:** 15 minutes

---

#### **L4: No Request Timeout for fetch()** ⚠️

**Location:** Some fetch calls

**Issue:** Not all `fetch()` calls have timeout protection.

**Example:**
```typescript
const res = await fetch(url); // ❌ No timeout
```

**Fix:**
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000);
const res = await fetch(url, { signal: controller.signal });
clearTimeout(timeoutId);
```

**Priority:** Low  
**Effort:** 1 hour

---

#### **L5: Hardcoded API Keys in Comments** ⚠️

**Location:** None found ✅

**Good:** No hardcoded API keys were found in the codebase. All secrets use Firebase Secrets.

---

## 🐛 **Bugs Found**

### **HIGH: None Found** 🎉

---

### **MEDIUM: 1 Issue**

#### **M1: PriceHistoryChart Date Handling** ⚠️

**Location:** `src/lib/components/ui/PriceHistoryChart.svelte`

**Issue:** Price history points don't have proper date tracking.

**Current Code:**
```typescript
history={priceHistory.map(p => ({ ...p, date: new Date() }))}
```

**Bug:** All prices get the same date (current date), not the actual price check date.

**Fix:** Store `checkedAt` timestamp in price history and use that.

**Priority:** Medium  
**Effort:** 1 hour

---

### **LOW: 3 Issues**

#### **L1: Share Menu ARIA Role Missing** ⚠️

**Location:** `src/routes/board/[boardId]/+page.svelte:513`

**Issue:** Clickable div lacks ARIA role.

**Warning:**
```
<div> with a click handler must have an ARIA role
```

**Fix:**
```svelte
<div role="menu" aria-label="Share options" onclick={...}>
```

**Priority:** Low  
**Effort:** 5 minutes

---

#### **L2: Image Alt Text Missing** ⚠️

**Location:** Multiple card components

**Issue:** Some images lack `alt` attributes.

**Fix:** Add descriptive alt text to all images.

**Priority:** Low  
**Effort:** 30 minutes

---

#### **L3: Type Warnings in Build** ⚠️

**Location:** Multiple files

**Issue:** 28 TypeScript warnings during build (mostly accessibility).

**Priority:** Low  
**Effort:** 2 hours

---

## 📊 **Summary**

| Category | Count | Status |
|----------|-------|--------|
| **Critical Issues** | 0 | ✅ Excellent |
| **High Issues** | 0 | ✅ Excellent |
| **Medium Issues** | 3 | ⚠️ Needs Attention |
| **Low Issues** | 8 | ℹ️ Nice to Fix |
| **Security Strengths** | 5 | ✅ Excellent |

---

## 🎯 **Recommended Actions**

### **Immediate (This Week)**

1. ✅ **Fix CSP header in hooks.server.ts** (10 min)
2. ✅ **Add clearInterval cleanup** to all setInterval calls (30 min)
3. ✅ **Add ARIA roles** to clickable divs (15 min)

### **Short Term (This Month)**

4. ⚠️ **Implement persistent rate limiting** with Firestore (2 hours)
5. ⚠️ **Fix PriceHistoryChart date handling** (1 hour)
6. ⚠️ **Add try/catch to all async calls** (1 hour)

### **Long Term (Next Quarter)**

7. ℹ️ **Add comprehensive logging** (sanitize error objects)
8. ℹ️ **Add timeout to all fetch() calls**
9. ℹ️ **Fix all TypeScript warnings**

---

## ✅ **Overall Assessment**

### **Security Score: 9/10** ⭐⭐⭐⭐⭐

**Strengths:**
- Excellent authentication/authorization
- Proper XSS prevention with DOMPurify
- Strong SSRF protection
- Good input validation
- Rate limiting implemented

**Areas for Improvement:**
- Persistent rate limiting
- CSP in development
- Error handling consistency

### **Code Quality Score: 8.5/10** ⭐⭐⭐⭐

**Strengths:**
- Clean TypeScript code
- Good component structure
- Proper type definitions
- Well-documented

**Areas for Improvement:**
- Memory cleanup (setInterval)
- Error handling consistency
- Accessibility improvements

---

## 🔐 **Security Best Practices Followed**

✅ Firebase Authentication  
✅ Firestore Security Rules  
✅ DOMPurify for XSS prevention  
✅ SSRF protection (private IP blocking)  
✅ Rate limiting  
✅ Input validation  
✅ HTTPS-only communication  
✅ No hardcoded secrets  
✅ Content-Type headers  
✅ Security headers (X-Frame-Options, etc.)

---

## 📝 **Conclusion**

The Nearboard codebase has **excellent security foundations** with proper authentication, authorization, and XSS prevention. The few issues found are mostly **low-priority improvements** rather than critical vulnerabilities.

**No critical or high-severity security issues were found.** 🎉

The recommended fixes should be implemented in priority order, but the app is **safe for production use** as-is.

---

**Reviewed By:** AI Assistant  
**Review Date:** March 24, 2026  
**Next Review:** June 24, 2026 (Quarterly)
