# Iconography Guide - Nearboard App

## Overview

This guide establishes the principles and rules for using icons consistently across the Nearboard application. Adhering to these guidelines ensures a cohesive and native-feeling user interface.

## 1. Icon Library: Phosphor Icons (via Iconify)

-   **Rule:** All icons used in the application MUST be sourced from [Phosphor Icons](https://phosphoricons.com/) and implemented via the Iconify component.
-   **Reason:** Ensures a unified visual style, consistent rendering, and simplifies management.
-   **Implementation:** Use `<Icon icon="ph:icon-name" />`.

## 2. Icon Weight and Style Rules

Phosphor Icons offer various weights (Thin, Light, Regular, Bold, Fill, Duotone). The following rules dictate their usage:

-   **2.1. Default/General UI:**
    -   **Rule:** Use `Regular` weight for most general UI elements, informational icons, and non-interactive displays.
    -   **Examples:** `ph:info`, `ph:question`, `ph:kanban` (for displaying a board icon where it's not a primary action).
    -   **Implementation:** `icon="ph:icon-name"` (without a suffix).

-   **2.2. Active/Selected States:**
    -   **Rule:** Use `Fill` weight for icons representing active, selected, or focused states, especially in navigation (e.g., active tab) or toggleable elements.
    -   **Examples:** Active tab in `Tabbar` (`ph:house-fill`), selected checkbox (`ph:check-circle-fill`).
    -   **Implementation:** `icon="ph:icon-name-fill"`.

-   **2.3. Prominent Actions & High Emphasis:**
    -   **Rule:** Use `Bold` weight for primary call-to-action buttons (like the central FAB), critical interactive elements, or icons that require high visual emphasis.
    -   **Examples:** Central FAB (`ph:plus-bold`), close buttons (`ph:x-bold`), loading spinners (`ph:circle-notch-bold`).
    -   **Implementation:** `icon="ph:icon-name-bold"`.

-   **2.4. Decorative/Illustrative & Content Type Display (Non-Interactive):**
    -   **Rule:** For purely decorative elements (e.g., sparkles, flames) or when illustrating content types in a non-interactive display (e.g., a list of content types), `Fill` weight can be used if it enhances visual appeal, provided it doesn't imply interactivity where none exists.
    -   **Caution:** Avoid using `fill` if it creates ambiguity about interactivity. If illustrating a content type where selection is not the primary purpose, `Regular` is preferred.
    -   **Examples:** `ph:sparkle-fill`, `ph:flame-fill`.

-   **2.5. Specific Guidelines for Similar Concepts:**
    -   **Checkmark Icons (`ph:check`, `ph:check-bold`, `ph:check-circle-fill`):**
        -   `ph:check` (Regular): For small, inline confirmations within text or simple lists.
        -   `ph:check-bold`: For emphasizing a successful action or a bolder confirmation.
        -   `ph:check-circle-fill`: For prominent success indicators (e.g., after form submission, large status messages).
    -   **Close/Dismiss Icons (`ph:x`, `ph:x-bold`, `ph:x-circle-fill`):**
        -   `ph:x` (Regular): For small dismiss buttons (e.g., in a tag).
        -   `ph:x-bold`: For prominent close buttons (e.g., modal headers).
        -   `ph:x-circle-fill`: For error indicators (e.g., failed status messages).
    -   **Link Icons (`ph:link`, `ph:link-simple`):**
        -   `ph:link` (Regular): Primary icon for external links.
        -   `ph:link-simple` (Regular): Alternative for simpler visual, if needed. (Consider deprecating one for consistency).

## 3. Icon Sizing Scale

Icon sizing MUST adhere to the Tailwind CSS `text-Xl` utility scale for consistency and responsiveness. Avoid arbitrary pixel values.

-   **Scale:**
    -   `text-[8px]` (custom, very small) / `text-[10px]` / `text-[11px]` (custom, small): Very subtle indicators, inline with small text.
    -   `text-xs` (12px) / `text-sm` (14px): Inline with regular text, helper icons, small contextual actions.
    -   `text-base` (16px) / `text-lg` (18px): Standard size for list items, form fields, secondary actions.
    -   `text-xl` (20px) / `text-2xl` (24px): Navigation tabs, prominent buttons, primary actions.
    -   `text-3xl` (30px) / `text-4xl` (36px) / `text-5xl` (48px): Empty states, onboarding illustrations, hero sections, large status indicators.
-   **Rule:** Always use `text-` classes. For cases requiring exact pixel sizes outside of the `text-Xl` scale (e.g., to match specific component spacing), use `w-X h-Y` classes as a last resort, ensuring they are multiples of `4px` (Tailwind's default spacing scale).

## 4. Icon Color Application

Icon colors MUST be applied using semantic CSS variables defined in `src/app.css` or Tailwind classes that directly map to them. Avoid hardcoded colors.

-   **Rules:**
    -   **Themed Colors:** Use `text-primary`, `text-accent`, `text-success`, `text-error`, `text-warning`, `text-info` for functional states.
    -   **Neutral Colors:** Use `text-on-surface` for primary content icons, `text-on-surface-secondary` for secondary content, and `text-muted` for subdued or disabled icons.
    -   **Brand-specific:** For brand logos or specific contextual colors (e.g., YouTube red), define a semantic CSS variable in `src/app.css` (e.g., `--color-brand-youtube`) and use `text-[color:var(--color-brand-youtube)]`.
    -   **Opacity:** Use Tailwind's opacity modifiers (e.g., `text-on-surface/60`) for variations in intensity.

## 5. Documentation & Maintenance

-   **Rule:** This `ICONOGRAPHY_GUIDE.md` serves as the single source of truth for icon usage.
-   **Rule:** Any new icon usage patterns or significant changes to existing rules MUST be documented here.
-   **Rule:** Developers should consult this guide before introducing new icons or modifying existing ones.
