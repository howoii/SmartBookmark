---
name: "Smart Bookmark"
description: "A compact Chrome extension UI for saving, organizing, and searching bookmarks with AI assistance."
colors:
  primary: "#4caf50"
  primary-hover: "#43a047"
  primary-tint: "#e8f5e9"
  action: "#4285f4"
  action-tint: "#e3f2fd"
  danger: "#d32f2f"
  warning: "#ef6c00"
  surface-primary: "#ffffff"
  surface-secondary: "#f8f9fa"
  surface-tertiary: "#f5f5f5"
  border: "#dddddd"
  border-soft: "#eeeeee"
  border-hover: "#d0d0d0"
  text-primary: "#333333"
  text-secondary: "#666666"
  text-tertiary: "#999999"
  text-inverse: "#ffffff"
  tag-bg: "#e8f5e9"
  tag-text: "#2e7d32"
  link: "#0366d6"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-icon:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    size: "32px"
  button-icon-hover:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    size: "32px"
  input-search:
    backgroundColor: "{colors.surface-primary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "32px"
  list-item:
    backgroundColor: "{colors.surface-primary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "5px 10px"
  tag-chip:
    backgroundColor: "{colors.tag-bg}"
    textColor: "{colors.tag-text}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
---

# Design System: Smart Bookmark

## 1. Overview

**Creative North Star: "The Browser Desk Drawer"**

Smart Bookmark should feel like a compact drawer inside Chrome: close at hand, well-labeled, and ready for repeated use. The visual system is utilitarian rather than promotional. It uses small type, light borders, restrained green intent color, and predictable list surfaces so users can save, search, sort, and edit without shifting mental mode.

The interface rejects SaaS landing-page styling, oversized hero composition, decorative gradients, glassmorphism, playful illustration-led surfaces, one-note purple or dark-slate palettes, and card-heavy layouts that reduce information density. The best version of the UI is quiet, fast, and explicit: a user should know what can be clicked, what is selected, what is syncing, and what will happen on Enter or Esc.

**Key Characteristics:**
- Compact browser-extension density with 350-400px popup surfaces and full-height side panel layouts.
- White and soft-gray surfaces with green used sparingly for intent, success, and focus.
- Lists, toolbars, inputs, chips, and modals are the core primitives; cards are secondary.
- Motion is short and state-driven: hover, focus, slide-in toolbars, drag/drop, and loading spinners.

## 2. Colors

The palette is a light, neutral browser-tool palette anchored by a practical green accent and small blue/danger/status roles.

### Primary
- **Working Green**: The primary action and focus color. Use it for search focus rings, selected states, success affordances, tag accents, and add actions.
- **Quiet Green Tint**: The low-emphasis primary surface. Use it for icon hover backgrounds, success backgrounds, and selected/focused rows when the state is positive.

### Secondary
- **Action Blue**: Secondary action and AI/helper color. Use it for generated tag/excerpt actions, links, and settings-style helper actions.
- **Danger Red**: Destructive action color. Use it only for delete, unsupported states, and irreversible warnings.
- **Warning Orange**: Attention color for limits, caution, and non-blocking warnings.

### Neutral
- **Paper Surface**: Main popup, dialog, and panel background.
- **Soft Rail Surface**: Toolbar, pinned-site, and grouped-control background.
- **List Hover Surface**: Row hover, subdued container, and disabled/secondary panel background.
- **Hairline Borders**: Use soft 1px borders for separation; avoid heavy outlines.
- **Primary Text / Secondary Text / Tertiary Text**: Use the three-step text scale for title, metadata, and hints.

### Named Rules
**The Green Rarity Rule.** Green is a signal, not decoration. If more than one major region on a small popup is green at the same time, the screen is too loud.

**The Neutral First Rule.** Default surfaces are white or soft gray. Blue, red, orange, and green only appear when they explain state or action.

## 3. Typography

**Display Font:** System UI stack with platform-native rendering.
**Body Font:** System UI stack with platform-native rendering.
**Label/Mono Font:** No distinct mono role is used in the current product UI.

**Character:** Typography is compact, operational, and native to Chrome. It should feel like browser UI, not editorial content.

### Hierarchy
- **Display** (500, 18px, 1.3): Rare settings-page section headings only; do not use hero-scale type.
- **Headline** (500, 16px, 1.35): Sidebar app name, modal headings, and major settings groups.
- **Title** (500, 14px, 1.4): Bookmark titles, toolbar labels, search result titles, and primary row text.
- **Body** (400, 13px, 1.5): Excerpts, form text, messages, and compact descriptions.
- **Label** (600, 11px, 1.2): Section labels, metadata, counts, grouped headers, and subtle captions.

### Named Rules
**The No Hero Type Rule.** This is a browser tool. Large marketing typography is prohibited inside operational surfaces.

**The Ellipsis Rule.** Bookmark titles, URLs, folder paths, tags, and preview rows must truncate cleanly instead of wrapping unpredictably.

## 4. Elevation

Smart Bookmark uses a hybrid of tonal layering and small shadows. Flat 1px borders separate most content; shadows are reserved for floating panels, dialogs, toolbar action clusters, pinned tiles, and temporary status messages. Depth should clarify stacking, not add decoration.

### Shadow Vocabulary
- **Subtle Tile** (`box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1)`): Pinned site icons and small raised controls.
- **Panel Lift** (`box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1)`): Lightweight dropdowns and elevated panels.
- **Dialog Lift** (`box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1)`): Modals, status messages, and overlays.
- **Toolbar Capsule** (`box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.8)`): Compact action groups that need a tactile boundary.

### Named Rules
**The Flat-Until-Floating Rule.** Lists and toolbars are flat at rest. Shadows appear when a component floats above content, responds to hover, or needs temporary focus.

## 5. Components

### Buttons
- **Shape:** Compact rounded controls with functional curvature (6px for standard icon buttons, 7-8px inside toolbars/modals).
- **Primary:** Use Working Green for save/confirm and selected intent; keep padding compact and predictable.
- **Hover / Focus:** Use `primary-tint` or a soft border shift, with 0.15-0.2s transitions. Focus states must remain visible.
- **Secondary / Ghost / Tertiary:** Most toolbar buttons are icon-first ghost buttons. Destructive buttons turn red only on danger affordances.

### Chips
- **Style:** Tags use soft green backgrounds, green text, small 11px type, and 4px radii.
- **State:** Selected or recommended chips may use stronger green/blue tints, but should remain small and list-friendly.

### Cards / Containers
- **Corner Style:** Use 6-8px radii for small operational containers, 10-12px only for larger settings panels.
- **Background:** Use Paper Surface for main content and Soft Rail Surface for grouped controls.
- **Shadow Strategy:** Prefer borders and tonal layering; use shadows only for floating or tactile elements.
- **Border:** Use soft 1px borders, never thick decorative strokes.
- **Internal Padding:** 8-16px is the normal range; 24px is reserved for empty states or settings page sections.

### Inputs / Fields
- **Style:** White background, 1px neutral border in side panel/settings, 2px border in quick search, 6-8px radius.
- **Focus:** Green border plus a soft green focus ring (`0 0 0 2-3px rgba(76, 175, 80, 0.1)`).
- **Error / Disabled:** Use status colors with text or icon support; never rely on color alone.

### Navigation
- **Style:** Settings navigation uses a fixed dark sidebar, 14px labels, 8px rounded active rows, and subtle white overlays.
- **States:** Hover and active states use opacity shifts rather than saturated blocks. The active nav item may increase weight to 500.
- **Mobile / Popup Treatment:** Popup and quick search avoid nav chrome; they use toolbar buttons and keyboard shortcuts instead.

### Search And Suggestion Lists
- **Style:** Search results are list-first, not card-first. Full results can show title, excerpt, tags, metadata, and relevance; presearch previews stay simpler with icon and title.
- **State:** Keyboard focus must be visually equivalent to hover. Enter, Esc, and arrow-key behavior should be discoverable through placement and short helper text.

## 6. Do's and Don'ts

### Do:
- **Do** keep extension surfaces compact, scrollable inside the intended list region, and stable at 350-400px popup widths.
- **Do** use `primary` for focus, success, selected, and add states, with `primary-tint` for low-emphasis surfaces.
- **Do** keep repeated bookmark rows dense: 13-14px titles, 11-12px metadata, favicon-first layout, and clean ellipsis.
- **Do** use borders, tonal backgrounds, and small shadows to express hierarchy before adding new visual effects.
- **Do** keep icon-only buttons square, predictable, and tooltip-backed.

### Don't:
- **Don't** use SaaS landing-page styling, oversized hero composition, decorative gradients, glassmorphism, playful illustration-led surfaces, one-note purple or dark-slate palettes, or card-heavy layouts that reduce information density.
- **Don't** make search, save, or settings screens feel like marketing pages; the first viewport must be useful UI.
- **Don't** hide sync, AI generation, semantic search, or preview-search uncertainty behind vague magic language.
- **Don't** add thick borders, decorative stripes, or saturated full-width bands unless they represent an error or blocking state.
- **Don't** let text overlap controls or wrap inside compact buttons; truncate row content and keep action targets stable.
