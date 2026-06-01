# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smart Bookmark is a **Manifest V3 Chrome extension** (Chrome 108+) for managing bookmarks. The extension maintains its own bookmark store (`chrome.storage.local`) as the primary data source, with Chrome native bookmarks as a secondary/fusion source. It provides quick save, popup/side panel, quick search, and settings pages. Features include AI tag generation, embedding-based search, WebDAV sync, and folder recommendations.

The primary development guidance document is `AGENTS.md` — read it first. Architecture details are in `docs/architecture/PROJECT_ARCHITECTURE.md`.

## Build & Develop

```bash
# Switch to development environment (updates env.js + manifest.json)
python3 build.py development

# Switch to production environment
python3 build.py production

# Create release ZIPs for Chrome + Edge (runs build.py production, then packages)
bash build.sh

# Dry-run to verify packaging excludes dev files
rsync -avn --exclude-from='exclude_list.txt' . /tmp/smart-bookmark-packcheck
```

The build pipeline: `build.py` sets the env → `build.sh` uses `rsync --exclude-from=exclude_list.txt` to copy files to a temp dir → zips the result. The authoritative list of excluded files is `exclude_list.txt`. Manifest variants per store live in `config/manifest.{chrome,edge}.json`.

There are no automated tests. Manual regression checklists are in `docs/testing/`.

## Runtime Contexts (critical)

The extension runs in **separate contexts** — never treat them as the same process:

| Context | Entry | Lifecycle |
|---------|-------|-----------|
| Service Worker | `background.js` | Non-persistent, can terminate any time |
| Side Panel | `popup.html` / `popup.js` | Lives while panel is open |
| Quick Save | `quickSave.html` / `quickSave.js` | Per-invocation (Ctrl+B / Cmd+B) |
| Quick Search | `quickSearch.html` / `quickSearch.js` | Per-invocation (Ctrl+K / Cmd+K) |
| Settings | `settings.html` / `settings.js` | Long-lived options page |
| Content Script | `contentScript.js`, `versionCheck.js` | Only on localhost:8080 |

Cross-context communication uses `chrome.runtime.sendMessage` / `chrome.runtime.connect` only. Message types are defined in `consts.js`.

## Architecture at a Glance

### Storage Layers
- **`chrome.storage.local`** — Extension bookmark data (keys: `bookmark.<url>`), sync config, sync state. Managed by `storageManager.js`.
- **`chrome.storage.sync`** — Light user settings. Managed by `settingsManager.js`.
- **`chrome.storage.session`** — Service worker caches (e.g., Chrome bookmark id→url mapping).

### Key Modules

| Layer | Files | Role |
|-------|-------|------|
| Foundation | `consts.js`, `logger.js`, `i18n.js`, `common.js`, `env.js` | Constants, logging, i18n, shared utilities |
| Data | `models.js`, `storageManager.js`, `settingsManager.js` | Bookmark model, local storage CRUD, settings |
| Bookmarks | `util.js`, `bookmarkOps.js`, `search.js`, `directoryViewData.js` | Aggregation, edit/delete ops, search, directory tree |
| AI | `api.js`, `folderRecommender.js` | Tag/embedding generation, folder recommendations |
| Sync | `chromeBookmarkSync.js`, `autoSync.js`, `webdavSync.js`, `webdavClient.js` | Chrome bookmark sync, WebDAV, auto-sync scheduling |
| UI | `popup.js`, `quickSave.js`, `quickSearch.js`, `settings.js`, `bookmarkEditManager.js`, `filterManager.js`, `themeManager.js`, `browserBookmarkSelector.js`, `iconPicker.js` | Page logic |

### Data Model

- **`UnifiedBookmark`** (in `models.js`): union of extension + Chrome bookmarks, with `source` field (`extension` / `chrome`) and `_presence` field (`extension_only` / `chrome_only` / `both`).
- **`BookmarkSource`**: extension-origin bookmarks stored under key `bookmark.<url>` — the URL is the unique identifier.
- **`_`-prefixed fields**: runtime-only fields (e.g. `_presence`, `_nodeKey`, `_facet`). `sanitizeBookmarkForStorage()` removes only runtime fields; `sanitizeBookmarkForExport()` removes ALL `_` fields.

### Two Aggregation Views

Always check both when changing bookmark aggregation:
- **`getAllBookmarks()`** in `util.js` — flat list for search and general display
- **`getBookmarksForDirectoryView()`** in `directoryViewData.js` — tree-structured view matching Chrome's folder hierarchy

## Critical Constraints

1. **Chrome bookmark writes must go through background proxy**. Never call `chrome.bookmarks.*` write APIs directly from pages. Path: `bookmarkOps → message → background → ChromeBookmarkSync.proxy*`. This prevents the mute mechanism from breaking and avoids "self-triggered" event loops.

2. **Service Worker is not persistent**. Don't rely on in-memory state. Critical caches must be rebuildable from `chrome.storage.session` or `chrome.storage.local`.

3. **New `_` fields require sanitize check**. When adding a field prefixed with `_`, decide if it's runtime-only or persistent, then update the appropriate sanitize function.

4. **Cloud sync is disabled**. `sync.js` and `FEATURE_FLAGS.ENABLE_CLOUD_SYNC` are retained as a skeleton but not active.

5. **i18n is mandatory**. User-facing strings must use `chrome.i18n.getMessage()` with keys in `_locales/{en,zh_CN}/messages.json`.

6. **CSS variables, not hardcoded colors**. Use `css/theme.css` custom properties. Add new variables there first.

## When Changing Specific Features

See `docs/architecture/PROJECT_ARCHITECTURE.md` §10 for detailed "what to read first" guides for: bookmark storage structure, directory view, Chrome bookmark linkage, sync logic, search/AI generation, and folder recommendations.
