---
name: chrome-extension-dev
description: >-
  Chrome extension development standards using Manifest V3. Use when building,
  modifying, or reviewing Chrome extensions, browser extensions, popup pages,
  content scripts, background service workers, or manifest.json files.
---

# Chrome Extension Development

这个 skill 只放“扩展开发时额外需要的工作流和项目约束”，不重复通用 clean code 或验证规则。

## Use This Skill For

- 修改 `manifest.json`
- 调整 background / popup / quickSearch / settings / content script 行为
- 新增或修改 Chrome 扩展权限、消息通信、存储、国际化、主题或 UI 交互

## Task Workflow

1. 先阅读 `docs/architecture/PROJECT_ARCHITECTURE.md`，确认本项目的运行时、存储层和同步链路。
2. 再识别改动落在哪个运行时：
   - background
   - popup / quickSearch / settings
   - content script
3. 画清楚本次改动涉及的状态来源、事件入口和消息链路。
4. 再检查是否会影响：
   - 权限
   - 生命周期
   - i18n
   - 主题变量
   - 现有交互回归

## Runtime-Specific Checklist

### Background / Service Worker

- 不依赖常驻内存。
- 跨请求状态要可恢复。
- 设计消息和存储时优先考虑生命周期中断后的恢复路径。

### Popup / QuickSearch / Settings

- 关注键盘事件、弹窗层级、编辑模式、搜索模式之间的优先级。
- 任何新增交互都要评估是否会和现有全局快捷键或 `Escape` 行为冲突。
- UI 文案变化要同步 i18n。

### Content Script

- 遵循最小权限原则。
- 避免把重逻辑塞在页面上下文里。
- 与 background 的交互要显式，不要假设共享状态。

## Project-Specific Guardrails

### Architecture First

- 涉及以下主题时，优先以 `docs/architecture/PROJECT_ARCHITECTURE.md` 为入口再看代码：
  - 书签聚合
  - `background` 消息处理
  - Chrome 书签同步
  - WebDAV / cloud 同步
  - 本地存储与设置存储分层

### Bookmark Data Sanitization

- 书签对象有两类清洗：
  - `sanitizeBookmarkForStorage`：仅删除纯运行时字段
  - `sanitizeBookmarkForExport`：删除所有 `_` 前缀字段
- 新增 `_` 字段时，要先确认它属于运行时字段还是存储字段，再同步检查这两个清洗入口。

### i18n

- 新增用户可见文案时同步更新 `_locales/zh_CN/messages.json` 和 `_locales/en/messages.json`。
- 优先复用已有 key 命名风格，不要引入单次使用的随意命名。

### Theme / UI

- 不要硬编码颜色，优先复用 `css/theme.css` 中的变量。
- popup 和 quickSearch 的改动要同时考虑桌面窄宽度下的可用性。

### Packaging / Build Hygiene

- 当前打包链路以 `build.sh` 为入口，流程是：
  - 先用 `build.py` 和 `config/manifest.*.json` 生成目标环境配置
  - 再通过 `rsync --exclude-from='exclude_list.txt'` 复制到临时目录
  - 最后对临时目录执行 `zip`
- 因此“哪些文件不能进扩展包”的单一事实来源是 `exclude_list.txt`；调整打包内容时，优先改这里。
- 变更打包排除规则前，先按运行时入口核对真实依赖：
  - `manifest.json`
  - `background.js`
  - `popup.html`
  - `quickSave.html`
  - `quickSearch.html`
  - `settings.html`
  - `intro.html`
- 当前项目里应排除的开发期内容包括：
  - `docs/`
  - `AGENTS.md`
  - `skills/`
  - `.cursor/`
  - `.codex/`
  - `.trae/`
  - `.idea/`
  - `.vscode/`
  - `.claude/`
  - `build/`
  - `.git/`
  - `build.sh`
  - `build.py`
  - `env.json`
  - `config/`
  - `exclude_list.txt`
  - `.gitignore`
  - `tmp_build`
- 注意不要误排这些运行时仍会用到的资源：
  - `intro.html` 和 `intro.js`：安装/升级后会由 `background.js` 打开
  - `videos/`：`intro.html` 会引用，且 `manifest.json` 已把 `videos/*` 声明为 `web_accessible_resources`
  - `icons/`、`css/`、`_locales/`、各页面 HTML/JS 入口：都由 manifest 或页面直接引用
- 如果新增了新的开发工具目录或仓库级文档目录，在同一次提交里同步更新 `exclude_list.txt`。
- 修改排除规则后，用下面的 dry-run 校验打包结果里是否仍混入开发文件：
  - `rsync -avn --exclude-from='exclude_list.txt' . /tmp/smart-bookmark-packcheck`
  - 然后检查输出里是否还出现 `docs`、`skills`、`.cursor`、`.codex`、`.trae`、`AGENTS.md` 等开发期路径

## When In Doubt

- API 兼容性不确定时，优先查官方文档。
- 权限或生命周期影响较大时，先缩小方案，再决定是否扩展。
