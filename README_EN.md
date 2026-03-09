# Smart Bookmark

<p align="center">
  <img src="https://img.shields.io/badge/version-1.2.5-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <a href="https://chromewebstore.google.com/detail/smart-bookmark/nlboajobccgidfcdoedphgfaklelifoa"><img src="https://img.shields.io/badge/Chrome-Web%20Store-orange" alt="Chrome Web Store"></a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/smart-bookmark/dohicooegjedllghbfapbmbhjopnkbad"><img src="https://img.shields.io/badge/Edge-Add--ons-blue" alt="Edge Addons"></a>
</p>

<p align="center">
  AI-powered intelligent bookmark manager for Chrome & Edge. Auto-generate tags, semantic search, and effortless sync.
</p>

<p align="center">
  <a href="#introduction">Introduction</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#roadmap">Roadmap</a>
  ·
  <a href="#faq">FAQ</a>
  ·
  <a href="README.md">中文</a>
</p>

---

## Introduction

Smart Bookmark is an AI-powered bookmark manager extension for Chrome and Edge. It **auto-generates tags** when you save pages, **understands natural language** when you search, and supports WebDAV sync, custom filters, and batch operations. The extension is free—just configure your API Key or use Ollama for local models.

---

## Features

- **🤖 AI Auto Tags**: Save a page and get relevant tags automatically. No more manual tagging or folder organization.
- **🔍 Semantic Search**: Use natural language to find bookmarks—describe what you remember instead of exact keywords.
- **📋 Custom Filters**: Filter by title, tags, URL, and more. Auto-categorize bookmarks with rules.
- **☁️ WebDAV Sync**: Sync your bookmarks across devices via WebDAV.
- **✅ Batch Operations**: Select and delete multiple bookmarks at once.
- **⌨️ Keyboard Shortcuts**: `Ctrl+K` / `Cmd+K` for quick search, `Ctrl+B` / `Cmd+B` for quick save.
- **🌙 Dark Mode**: Switch between light and dark themes.

---

## Quick Start

### Installation

| Browser | Install Link |
|---------|--------------|
| Chrome | [Chrome Web Store](https://chromewebstore.google.com/detail/smart-bookmark/nlboajobccgidfcdoedphgfaklelifoa) |
| Edge | [Microsoft Edge Addons](https://microsoftedge.microsoft.com/addons/detail/smart-bookmark/dohicooegjedllghbfapbmbhjopnkbad) |

### Basic Usage

**1. Initial Setup**

- After installation, right-click the extension icon → choose "Open Side Panel" or "Options" to open settings
- In **API Configuration**, select a provider (OpenAI, Qwen, GLM, Ollama, etc.) and enter your API Key
- Once configured, AI features are ready to use

**2. Saving Bookmarks**

- **Quick Save**: Click the toolbar icon to open the save dialog. Edit title and tags, then save the current page
- **Shortcut**: Press `Ctrl+B` (Mac: `Cmd+B`) on any page to open the save dialog
- AI will auto-generate tags when saving; you can edit or add more manually

**3. Searching Bookmarks**

- **Side Panel**: Right-click the extension icon → "Open Side Panel", then type keywords or natural language in the search box
- **Shortcut**: Press `Ctrl+K` (Mac: `Cmd+K`) to open quick search
- **Address Bar**: Type `sb` followed by a space in the address bar to search bookmarks

**4. Other Operations**

- Browse, edit, and delete bookmarks in the side panel. Batch selection is supported
- Configure WebDAV sync, filters, and theme in settings

---

## Screenshots

<p align="center">
  <img src="pic/view-4.png" alt="Main Interface" width="600">
</p>

<p align="center">
  <img src="pic/view-3.png" alt="Search Interface" width="600">
</p>

<p align="center">
  <img src="pic/view-5.png" alt="Settings Interface" width="600">
</p>

---

## Roadmap

### Completed ✅

- [x] Multiple API support and custom API
- [x] Import browser bookmarks
- [x] Keyboard shortcuts for save and search
- [x] Dark mode
- [x] Import/export bookmarks
- [x] Ollama local model support
- [x] WebDAV sync
- [x] Batch select and delete
- [x] AI-generated bookmark summaries
- [x] Edge Add-ons store
- [x] Multi-language support

### Planned 📋

- [ ] Smart tag recommendations
- [ ] Custom prompts
- [ ] Hierarchical tags and AI auto-classification
- [ ] Batch organize historical bookmarks

---

## FAQ

### Why do I need to configure an API Key?

AI features (auto tags, semantic search, summaries) rely on large language models. The extension does not host AI services—it calls third-party APIs (OpenAI, Qwen, GLM, etc.), so you need to provide your own API Key. For local models like Ollama, you still need to configure the API in settings.

### How do I set up Ollama?

<details>
<summary>Click to expand</summary>

1. **Install Ollama**  
   Download from [ollama.com](https://ollama.com/)

2. **Enable CORS and start**

   **macOS:**
   ```bash
   launchctl setenv OLLAMA_ORIGINS "*"
   # Then start Ollama App
   ```

   **Windows:**
   - Control Panel → System Properties → Environment Variables
   - Add user variables:
     - `OLLAMA_HOST` = `0.0.0.0`
     - `OLLAMA_ORIGINS` = `*`
   - Start Ollama App

   **Linux:**
   ```bash
   OLLAMA_ORIGINS="*" ollama serve
   ```

3. **Configure in Smart Bookmark**
   - Settings → API Services → Custom Service
   - API URL: `http://localhost:11434/v1`
   - API Key: `ollama`
   - Model: Choose your installed model (e.g. `llama3`, `qwen2`)

</details>

### How do I use WebDAV sync?

<details>
<summary>Click to expand</summary>

1. Go to **Settings** → **Sync** → **WebDAV** card
2. Click "Settings" and fill in:
   - **Server URL**: Full WebDAV URL (e.g. `https://dav.jianguoyun.com/dav/`)
   - **Username** and **Password**
   - **Sync folder**: Path on server (default `/bookmarks`)
3. Click "Test connection" to verify
4. Choose what to sync: bookmarks, settings, filters, API config
5. Enable "Auto sync" and set interval (5 min–24 hours)
6. Configure conflict resolution: **Merge** (recommended), local-first, or remote-first
7. Turn on WebDAV and click "Sync now" to sync manually

**Recommended cloud storage**: [Nutstore](https://help.jianguoyun.com/?p=2064), [InfiniCLOUD](https://infini-cloud.net/) (WebDAV-compatible)

</details>

### Why did tag generation fail?

Possible causes:

| Cause | Description |
|-------|-------------|
| **Unsupported model** | Use a **Chat model**, not a reasoning model. Configure a text model in API settings (e.g. `gpt-3.5-turbo`, `qwen-turbo`) |
| **Insufficient balance** | Check your API account balance |
| **Network issues** | Cannot reach API (e.g. VPN/proxy needed for some regions) or request timeout |
| **API config error** | Verify API Key, URL, and model name |

Try the "Verify" button in settings to test the API connection.

### How do I change keyboard shortcuts?

Shortcuts are managed by the browser:

- **Chrome**: Open `chrome://extensions/shortcuts`
- **Edge**: Open `edge://extensions/shortcuts`

Find Smart Bookmark and click the pencil icon next to the shortcut. You can also go to **Settings** → **Basic Settings** → **Shortcuts** → "Set shortcuts" to jump there.

---

## Local Development

1. Clone the repo:
   ```bash
   git clone https://github.com/howoii/SmartBookmark.git
   cd SmartBookmark
   ```

2. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the project folder

---

## Contributing

Contributions are welcome! Report bugs or suggest features via [Issues](https://github.com/howoii/SmartBookmark/issues), or fork and submit a Pull Request.

---

## Support

If Smart Bookmark helps you, consider supporting the project:

[💝 Donate](https://howoii.github.io/smartbookmark-support/donate.html)

---

## Acknowledgments

This project was developed with [Cursor](https://www.cursor.com/). Thanks for the powerful AI capabilities!

---

## License

This project is open source under the [MIT License](LICENSE).

<p align="center">
  <strong>⭐ If you find it helpful, please give us a Star!</strong>
</p>
