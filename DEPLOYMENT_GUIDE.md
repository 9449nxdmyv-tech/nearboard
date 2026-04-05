# 🚀 Nearboard Enrichment - Deployment Guide

## ✅ Pre-Deployment Checklist

- [x] TypeScript builds successfully
- [x] Microlink API integration complete (works with or without API key)
- [x] open-graph-scraper integrated
- [x] AI classification ready (optional)
- [x] Social metrics ready (optional)
- [x] Price history chart component created
- [x] ProductCard updated with new chart

---

## 🔑 Step 1: Get API Keys (Optional but Recommended)

### **Microlink API** (Screenshots, Logos, Rich Metadata)

**FREE Tier: 50 requests/month without key, 10,000/month with key**

1. **Go to:** https://microlink.io/dashboard
2. **Sign up** with GitHub/Google/Email
3. **Copy your API key** from dashboard
4. **Set as Firebase secret:**
   ```bash
   cd /home/miguel/Sync/nearboard
   firebase functions:secrets:set MICROLINK_API_KEY
   # Paste your key when prompted
   ```

**Note:** The code works WITHOUT an API key (50 free requests/month), but you'll get much better limits with a key.

### **Gemini API** (AI Classification) - OPTIONAL

**FREE Tier: 15 requests/minute**

1. **Go to:** https://aistudio.google.com/apikey
2. **Sign in** with Google account
3. **Create API key**
4. **Set as Firebase secret:**
   ```bash
   firebase functions:secrets:set GEMINI_API_KEY
   ```

### **SharedCount API** (Social Metrics) - OPTIONAL

**FREE Tier: 100 requests/month**

1. **Go to:** https://sharedcount.com
2. **Sign up** for free account
3. **Get API key** from dashboard
4. **Set as Firebase secret:**
   ```bash
   firebase functions:secrets:set SHARED_COUNT_API_KEY
   ```

---

## 🛠️ Step 2: Build Functions

```bash
cd /home/miguel/Sync/nearboard/functions

# Install dependencies (if not already done)
npm install

# Build TypeScript
npm run build
```

**Expected output:**
```
> build
> tsc

✓ Build completed successfully
```

---

## 🚀 Step 3: Deploy to Firebase

### **Deploy Only the Enrichment Function**

```bash
cd /home/miguel/Sync/nearboard

# Deploy ogMetadata function
firebase deploy --only functions:ogMetadata
```

### **Deploy All Functions (if you have others)**

```bash
firebase deploy --only functions
```

### **Deploy Everything (Functions + Hosting)**

```bash
firebase deploy
```

---

## 🧪 Step 4: Test the Deployment

### **Test Locally (Development)**

```bash
# Start dev server
npm run dev

# In another terminal, test the endpoint
curl "http://localhost:5173/api/og?url=https://github.com"
```

### **Test Production (After Deploy)**

```bash
# Replace with your actual Firebase project URL
curl "https://your-project-id.web.app/api/og?url=https://github.com"

# Or directly to Cloud Function
curl "https://us-central1-your-project-id.cloudfunctions.net/ogMetadata?url=https://github.com"
```

### **Expected Response**

```json
{
  "status": "success",
  "data": {
    "title": "GitHub",
    "description": "Where software is built",
    "image": "https://github.githubassets.com/images/modules/site/social-cards/github-social.png",
    "logo": "https://logo.clearbit.com/github.com",
    "publisher": "GitHub",
    "url": "https://github.com"
  }
}
```

---

## 📊 Step 5: Monitor Usage

### **Check Function Logs**

```bash
# Real-time logs
firebase functions:log --only ogMetadata

# Last 50 entries
firebase functions:log --only ogMetadata --limit 50
```

### **Check Microlink Usage**

1. Go to https://microlink.io/dashboard
2. View usage statistics
3. Monitor request count

---

## 🔧 Troubleshooting

### **404 Error on /api/og**

**In Development:**
```bash
# Check if route exists
ls -la src/routes/api/og/+server.ts

# Restart dev server
npm run dev
```

**In Production:**
```bash
# Check if function is deployed
firebase functions:list

# Check function logs
firebase functions:log --only ogMetadata

# Redeploy if needed
firebase deploy --only functions:ogMetadata
```

### **Microlink API Returns 403**

```bash
# Check if API key is set correctly
firebase functions:secrets:access MICROLINK_API_KEY

# If empty, set it again
firebase functions:secrets:set MICROLINK_API_KEY
```

### **Function Timeout**

The function has a 30-second timeout. If URLs are timing out:

1. Some sites are slow to load
2. Enable prerender mode for JavaScript-heavy sites
3. Consider increasing timeout in `firebase.json`:
   ```json
   {
     "functions": {
       "timeoutSeconds": 60
     }
   }
   ```

---

## 💰 Cost Summary

| Service | Free Tier | With API Key | Typical Monthly Cost |
|---------|-----------|--------------|---------------------|
| **Microlink** | 50 req/mo | 10,000 req/mo | $0 (most users) |
| **Gemini AI** | 15 req/min | 15 req/min | $0-10 |
| **SharedCount** | 100 req/mo | 100 req/mo | $0-29 |
| **Firebase** | Generous | Generous | $0-25 |
| **Total** | | | **$0-64/mo** |

**Most users will pay $0/month** with the free tiers!

---

## 📈 What You Get

After deployment, each URL enrichment returns:

| Field | Description | Source |
|-------|-------------|--------|
| `title` | Page title | Microlink/OG tags |
| `description` | Meta description | Microlink/OG tags |
| `image` | OG image URL | Microlink |
| `logo` | Site logo URL | Microlink |
| `screenshot` | Full page screenshot | Microlink |
| `publisher` | Site name | Microlink |
| `classification` | AI category + tags | Gemini (optional) |
| `socialMetrics` | Shares, likes | SharedCount (optional) |
| `fullText` | Article body text | Readability |

---

## ✅ Verification Checklist

After deployment, verify:

- [ ] Function deploys without errors
- [ ] Test URL returns enriched data
- [ ] Screenshot URL is present (if enabled)
- [ ] Logo URL is present
- [ ] No 404 errors in logs
- [ ] Response time < 5 seconds
- [ ] Microlink dashboard shows requests

---

## 🎉 Success!

Your link enrichment is now **best-in-class** with:

- ✅ Microlink API integration (screenshots, logos, rich metadata)
- ✅ open-graph-scraper fallback
- ✅ AI classification (optional)
- ✅ Social metrics (optional)
- ✅ Price history charts
- ✅ oEmbed support for social platforms

**Next:** Test with various URLs and monitor usage in Firebase Console!
