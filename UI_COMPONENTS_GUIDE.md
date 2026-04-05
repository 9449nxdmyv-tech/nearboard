# Nearboard UI Components Guide

A comprehensive guide to the native-style UI components built for Nearboard.

## 📱 Core Philosophy

This is a **mobile-first** application designed to feel native. Every component follows these principles:

1. **Touch-optimized** - Large tap targets, proper spacing, haptic feedback
2. **Gesture-driven** - Swipe, pinch, long-press interactions
3. **Offline-aware** - Graceful degradation when connection is lost
4. **Accessible** - Keyboard navigation, screen reader support, reduced motion
5. **Performant** - Smooth 60fps animations, lazy loading

---

## 🎨 New Components

### Layout & Structure

| Component | Description | Usage |
|-----------|-------------|-------|
| `EmptyState.svelte` | Friendly empty states with icons and actions | When no content to display |
| `Skeleton.svelte` | Shimmer loading placeholders | During data fetching |
| `SkeletonCard.svelte` | Content-aware card skeletons | Photo, voice, default variants |
| `NativeSplash.svelte` | Branded app launch screen | Initial app load |
| `PageTransition.svelte` | Smooth page navigation animations | Wrap page content |

### Navigation & Input

| Component | Description | Usage |
|-----------|-------------|-------|
| `NativeTabs.svelte` | iOS-style segmented controls | Filter tabs, view switching |
| `NativeInput.svelte` | Floating label inputs | Forms, search, filters |
| `ActionSheet.svelte` | Bottom action sheets | Contextual actions |
| `LongPressMenu.svelte` | Press-and-hold context menu | Quick actions on cards |

### Media & Interaction

| Component | Description | Usage |
|-----------|-------------|-------|
| `ImageZoom.svelte` | Pinch-to-zoom lightbox | Photo viewing |
| `PullToRefresh.svelte` | iOS-style pull refresh | Content lists |
| `OfflineBanner.svelte` | Connection status indicator | Global connectivity |
| `KeyboardShortcutsHelp.svelte` | Keyboard shortcuts modal | Power user help |

---

## 🛠️ Usage Examples

### EmptyState

```svelte
<EmptyState 
  icon="ph:note"
  title="No notes yet"
  description="Start by creating your first note to capture your thoughts"
  actionLabel="Create Note"
  onAction={() => goto('/new')}
  secondaryActionLabel="Learn More"
  onSecondaryAction={() => goto('/help')}
  size="md"
/>
```

**Props:**
- `icon` - Iconify icon name (optional)
- `title` - String or Snippet
- `description` - String or Snippet (optional)
- `actionLabel` - Primary button text (optional)
- `onAction` - Primary button handler (optional)
- `secondaryActionLabel` - Secondary button text (optional)
- `onSecondaryAction` - Secondary button handler (optional)
- `size` - 'sm' | 'md' | 'lg'

---

### Skeleton Loading

```svelte
{#if loading}
  <SkeletonCard variant="photo" />
  <SkeletonCard variant="voice" />
{:else}
  <PhotoCard {...photoData} />
  <VoiceCard {...voiceData} />
{/if}
```

**SkeletonCard variants:**
- `default` - Standard card
- `photo` - Image-focused card
- `voice` - Audio card with waveform
- `wide` - Wider card layout
- `small` - Compact card

---

### NativeTabs

```svelte
<script>
  import NativeTabs from '$lib/components/ui/NativeTabs.svelte';
  
  const tabs = [
    { id: 'all', label: 'All', icon: 'ph:squares-four', badge: 12 },
    { id: 'notes', label: 'Notes', icon: 'ph:note' },
    { id: 'links', label: 'Links', icon: 'ph:link' }
  ];
  
  let activeTab = $state('all');
</script>

<NativeTabs 
  {tabs} 
  bind:activeTab 
  variant="segmented" 
/>
```

**Variants:**
- `segmented` - iOS-style sliding indicator
- `underline` - Traditional underline tabs
- `pills` - Individual pill buttons

---

### NativeInput

```svelte
<NativeInput
  label="Email"
  bind:value={email}
  type="email"
  placeholder="you@example.com"
  leftIcon="ph:envelope"
  error={errors.email}
  helper="We'll never share your email"
  required
  autocomplete="email"
/>
```

**Props:**
- `label` - Floating label text
- `value` - Two-way bound value
- `type` - Input type (text, email, password, textarea, etc.)
- `placeholder` - Placeholder text
- `leftIcon` / `rightIcon` - Iconify icons
- `error` - Error message (shows red state)
- `helper` - Helper text
- `required` - Shows required indicator
- `autocomplete` - HTML autocomplete attribute

---

### ActionSheet

```svelte
<script>
  let showDeleteSheet = $state(false);
  
  const deleteActions = [
    { 
      id: 'delete', 
      label: 'Delete Card', 
      icon: 'ph:trash', 
      destructive: true,
      onClick: handleDelete 
    }
  ];
</script>

<ActionSheet
  open={showDeleteSheet}
  title="Delete this card?"
  description="This action cannot be undone"
  actions={deleteActions}
  cancelLabel="Cancel"
  onClose={() => showDeleteSheet = false}
/>
```

---

### LongPressMenu

```svelte
<LongPressMenu
  menuItems={[
    { id: 'edit', label: 'Edit', icon: 'ph:pencil', onClick: handleEdit },
    { id: 'share', label: 'Share', icon: 'ph:share', onClick: handleShare },
    { id: 'delete', label: 'Delete', icon: 'ph:trash', destructive: true, onClick: handleDelete }
  ]}
>
  <CardComponent {...cardData} />
</LongPressMenu>
```

---

### ImageZoom

```svelte
<script>
  let showZoom = $state(false);
  let currentImage = $state(null);
  
  function openImage(src, caption) {
    currentImage = { src, caption };
    showZoom = true;
  }
</script>

<img src={image.src} onclick={() => openImage(image.src, image.caption)} />

<ImageZoom
  src={currentImage?.src}
  caption={currentImage?.caption}
  open={showZoom}
  onClose={() => showZoom = false}
  shareUrl={currentImage?.shareUrl}
/>
```

**Features:**
- Pinch to zoom (2x-3x max)
- Double-tap to zoom
- Swipe down to close
- Share button (if shareUrl provided)
- Loading state
- Error handling

---

### PullToRefresh

```svelte
<PullToRefresh onRefresh={loadData} threshold={100}>
  <svelte:fragment>
    <!-- Your scrollable content -->
    <div class="pull-refresh-scroll">
      {#each items as item}
        <ItemCard {...item} />
      {/each}
    </div>
  </svelte:fragment>
</PullToRefresh>
```

---

### OfflineBanner

Automatically included in `+layout.svelte`. Shows when connection is lost.

```svelte
<!-- No setup needed - auto-detects offline state -->
<!-- Shows amber banner at top when offline -->
<!-- Auto-dismisses when reconnected -->
```

---

## ⌨️ Keyboard Shortcuts

Press `?` to view all shortcuts.

| Shortcut | Action |
|----------|--------|
| `g` then `h` | Go to Home |
| `g` then `f` | Go to Feed |
| `g` then `t` | Go to Today |
| `g` then `p` | Go to People |
| `/` | Focus search (future) |
| `n` | New note (future) |
| `Esc` | Close modals/sheets |
| `?` | Show shortcuts help |

---

## 🎯 Haptic Feedback

Import from `$lib/utils/haptics`:

```ts
import { 
  hapticLight,      // Button taps, selections
  hapticMedium,     // Confirmations, thresholds
  hapticHeavy,      // Destructive actions
  hapticSuccess,    // Success notifications
  hapticWarning,    // Warnings
  hapticError,      // Errors
  hapticSoft,       // Minimal feedback
  hapticSelection,  // Picker start
  hapticSelectionChanged, // Picker value change
  hapticSelectionEnd, // Picker end
  hapticDoubleTap   // Like/favorite
} from '$lib/utils/haptics';
```

---

## 🎨 Design Tokens

All defined in `src/app.css`:

```css
/* Colors */
--color-primary: #0d0d14
--color-accent: #5b52e8
--color-surface: #fafaf8
--color-card: #ffffff
--color-muted: #7a7a85
--color-success: #2db87a
--color-border: #d4d4d0

/* Typography */
--font-sans: 'Inter', ui-sans-serif, system-ui
--font-display: 'Fraunces', ui-serif, serif

/* Radius */
--radius-card: 16px
--radius-input: 12px
--radius-pill: 999px

/* Shadows */
--shadow-card: 0 2px 12px rgba(0, 0, 0, 0.06)
--shadow-fab: 0 8px 32px rgba(91, 82, 232, 0.2)
```

---

## 📋 Best Practices

### 1. Touch Targets
```svelte
<!-- ✅ Good: Minimum 44x44px -->
<button class="w-11 h-11">...</button>

<!-- ❌ Bad: Too small -->
<button class="w-6 h-6">...</button>
```

### 2. Loading States
```svelte
<!-- ✅ Good: Skeleton matches content -->
{#if loading}
  <SkeletonCard variant="photo" />
{:else}
  <PhotoCard {...data} />
{/if}
```

### 3. Empty States
```svelte
<!-- ✅ Good: Actionable empty state -->
<EmptyState 
  title="No items yet"
  description="Add your first item to get started"
  actionLabel="Add Item"
  onAction={handleAdd}
/>
```

### 4. Error Handling
```svelte
<!-- ✅ Good: Offline detection -->
<OfflineBanner /> <!-- Auto-included in layout -->

<!-- ✅ Good: Error empty state -->
<EmptyState 
  icon="ph:wifi-slash"
  title="Connection lost"
  description="Your changes will sync when you're back online"
/>
```

### 5. Gesture Feedback
```svelte
<!-- ✅ Good: Haptic on interactions -->
<button onclick={() => {
  hapticLight();
  handleAction();
}}>
```

---

## 🚀 Performance Tips

1. **Lazy load images** - Use `loading="lazy"` on below-fold images
2. **Skeleton screens** - Show immediately, don't wait for data
3. **Haptic feedback** - Use native Capacitor when available
4. **Gesture thresholds** - 80-120px for swipe actions
5. **Animation duration** - 200-400ms for most transitions

---

## ♿ Accessibility

All components include:
- Keyboard navigation support
- ARIA labels and roles
- Focus management
- Reduced motion support
- Screen reader announcements

```svelte
<!-- Example: Proper button labeling -->
<button 
  aria-label="Delete card"
  onclick={handleDelete}
>
  <Icon icon="ph:trash" aria-hidden="true" />
</button>
```

---

## 📱 Native Platform Features

### Capacitor Integration

```ts
// Haptics (auto-detects native)
import { Haptics } from '@capacitor/haptics';

// App lifecycle
import { App } from '@capacitor/app';
App.addListener('resume', () => {
  // Refresh data when app resumes
});

// Push notifications
import { PushNotifications } from '@capacitor/push-notifications';
```

### Safe Areas

```css
/* Use safe-area insets */
.pb-safe {
  padding-bottom: max(env(safe-area-inset-bottom), 1rem);
}

.pt-safe {
  padding-top: max(env(safe-area-inset-top), 1rem);
}
```

---

## 🔮 Future Components

Planned additions:
- `SearchModal.svelte` - Full-screen search with filters
- `ShareSheet.svelte` - Native-style share dialog
- `DatePicker.svelte` - iOS-style date picker
- `Toast.svelte` - Replacement for current toast system
- `ProgressBar.svelte` - Upload/progress indicator
- `Avatar.svelte` - Enhanced avatar with status

---

## 📚 Resources

- [Svelte 5 Runes Docs](https://svelte.dev/docs/svelte/$state)
- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [Iconify Icons](https://iconify.design/icon-sets/ph/)
- [Capacitor Docs](https://capacitorjs.com/docs)
- [iOS Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)
