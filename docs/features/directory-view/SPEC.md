# 目录视图开发规范文档

> 版本：v1.0  
> 基于前期讨论整理，用于指导目录视图功能的开发与验收。

---

## 1. 概述

### 1.1 目标

在现有**列表视图**、**分组视图**之外，新增**目录视图**，以浏览器收藏夹的目录结构展示书签，并支持三种书签来源的差异化展示与统一操作。

### 1.2 三种书签来源与展示规则

| 来源 | 说明 | 展示位置 |
|------|------|----------|
| 仅 Chrome | 只存在于浏览器收藏夹 | 对应收藏夹目录下 |
| 仅插件 | 只存在于插件存储 | 虚拟「未归类」文件夹 |
| 两者皆有 (both) | 按 URL 判断相同 | 收藏夹目录下，并展示插件摘要、标签等 |

### 1.3 设计原则

- **兼容现有格式**：不改变 LocalStorage 书签结构，扩展数据保持原样。
- **可扩展**：为后续「移动书签目录」等操作预留能力模型。
- **样式一致**：复用列表/分组视图的书签卡片样式与操作入口。

---

## 2. 已冻结决策（基线）

| # | 决策项 | 结论 |
|---|--------|------|
| 1 | URL 比对 | 使用原始 URL 精确匹配 |
| 2 | Chrome-only 编辑保存 | 默认同时更新 Chrome 标题和 URL |
| 3 | both 删除 | 无需勾选确认，弹窗确认后默认同时删除 extension 与对应节点的 Chrome 书签（只删当前节点） |
| 4 | 批量操作粒度 | 按节点（nodeKey），不按 URL |
| 5 | 同 URL 多节点编辑 | 仅更新当前节点，不广播到同 URL 其它节点 |
| 6 | 编辑改 URL 冲突 | 新 URL 已存在时提示「将合并」，用户确认后执行 |
| 7 | 部分成功 | 展示「部分成功」toast + 失败明细，不做自动回滚 |
| 8 | 未归类 | 单层虚拟文件夹，放在根层最后 |
| 9 | 目录内排序 | 默认遵循 Chrome `index`；支持手动整理（见 §4.6） |

---

## 3. 数据结构与模型

### 3.1 URL 匹配

```javascript
/**
 * 目录视图、安装期浏览器书签同步、当前页面定位均按原始 URL 精确匹配。
 * 不再做 URL 规范化，也不再基于清洗后的 URL 合并书签。
 */
function isSameBookmark(urlA, urlB) {
  return urlA === urlB;
}
```

### 3.2 实体键定义

| 键名 | 用途 | 示例 |
|------|------|------|
| `bookmarkKey` | 聚合 extension/chrome 的同一书签 | `url` |
| `nodeKey` | 唯一标识目录树节点 | `bookmark:${chromeId}` / `virtual:uncategorized:${urlHash}` |

### 3.3 书签聚合模型（BookmarkFacet）

```typescript
type Presence = 'extension_only' | 'chrome_only' | 'both';

interface ChromeRef {
  chromeId: string;
  parentId: string;
  index: number;
  pathIds: string[];
  pathTitles: string[];
  title: string;
  dateAdded?: number;
  dateLastUsed?: number;
}

interface BookmarkFacet {
  key: string;           // bookmarkKey = url
  url: string;            // 原始 URL（展示用）
  presence: Presence;
  extension?: UnifiedBookmark;  // 复用现有 UnifiedBookmark
  chromeRefs: ChromeRef[];
}
```

### 3.4 目录树节点模型（DirectoryNode）

```typescript
type NodeType = 'folder' | 'bookmark' | 'virtual-folder';

interface DirectoryNode {
  nodeKey: string;
  type: NodeType;
  title: string;
  children?: DirectoryNode[];
  bookmarkKey?: string;   // 指向 BookmarkFacet.key
  chromeId?: string;      // 用于 chrome.bookmarks 操作
  parentNodeKey?: string;
  index?: number;         // Chrome 原始 index
}
```

### 3.5 操作能力模型（预留扩展）

```typescript
interface OperationCapability {
  canEditMetadata: boolean;   // 编辑标签/摘要
  canEditChromeNode: boolean;  // 更新 Chrome 标题/URL
  canDeleteExtension: boolean;
  canDeleteChromeNode: boolean;
  canMoveChromeNode?: boolean; // 未来：移动目录
}
```

---

## 4. 行为规范

### 4.1 单节点编辑

| 来源 | 编辑后行为 |
|------|------------|
| chrome_only | 创建 extension 数据，状态变 both；同时 `chrome.bookmarks.update` 更新标题/URL |
| extension_only | 仅更新 extension |
| both | 更新 extension；对当前节点执行 `chrome.bookmarks.update`（不广播同 URL 其它节点） |

**list/group 与目录视图统一**：chrome_only 书签也可编辑和删除；编辑时写入 extension 书签。

### 4.2 单节点删除

| 来源 | 行为 |
|------|------|
| chrome_only | 删除 Chrome 节点 |
| extension_only | 删除 extension |
| both | 弹窗确认后，默认同时删除 extension 与对应节点的 Chrome 书签（只删当前节点） |

**list/group 与目录视图统一**：`getAllBookmarks` 合并 both 时补充 `chromeId`、`_presence`，删除 both 时同时删 extension 与 Chrome。

### 4.3 批量删除（按节点）

- 选择集：`Set<nodeKey>`
- 分流：Chrome 删除队列（chromeId）、Extension 删除队列（url）
- both 节点：默认同时删两边；若需差异化，可后续扩展弹窗

### 4.4 冲突与失败

- **编辑改 URL 冲突**：新 URL 已存在 → 提示「将合并为同一书签」，确认后执行
- **部分成功**：展示「部分成功」toast + 失败明细，不做自动回滚
- **节点失效**：操作时 chromeId 不存在 → 提示并刷新树

### 4.5 打开链接

- 沿用 `display.openInNewTab` 配置
- 使用计数仅更新 extension 侧（若存在）

### 4.6 目录内整理

在每个非虚拟文件夹的操作菜单（`...`）中提供整理功能，支持三种整理方式：

| 整理方式 | 规则 |
|----------|------|
| 按域名整理 | 文件夹在前（按名称升序），书签在后（按域名升序，同域名按标题升序） |
| 按创建日期整理 | 文件夹在前（按 `dateAdded` 从旧到新），书签在后（按 `dateAdded` 从旧到新） |
| 按名称整理 | 文件夹在前（按名称升序），书签在后（按标题升序） |

- **作用范围**：仅整理当前目录的一级子项（children），不递归子文件夹
- **真实重排**：通过 `chrome.bookmarks.move` 修改浏览器真实书签顺序，而非仅改变显示顺序
- **可用条件**：文件夹为真实 Chrome 文件夹（非虚拟文件夹），且子项数 > 1
- **UI 入口**：操作菜单中的「整理」项，展开二级子菜单选择整理方式

---

## 5. 文件级开发任务

### 5.1 新增文件

| 文件 | 职责 |
|------|------|
| `directoryViewData.js` | `getBookmarksForDirectoryView()`、构建 BookmarkFacet、DirectoryNode 树 |
| `DirectoryBookmarkRenderer.js` 或并入 `popup.js` | 目录视图渲染器 |

### 5.2 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `models.js` | Chrome 书签 `tags` 默认 `[]`，不把目录路径作为标签 |
| `util.js` | `getAllBookmarks` 合并 both 时补充 chromeId、_presence |
| `popup.js` | 1) `renderBookmarksList` 增加 `viewMode === 'directory'` 分支<br>2) 数据源：`getBookmarksForDirectoryView()`<br>3) 渲染器：`DirectoryBookmarkRenderer`<br>4) `updateViewModeTriggerDisplay` 支持 `directory`<br>5) 编辑/删除逻辑接入 nodeKey；both 删除默认同时删 extension 与对应节点 Chrome 书签 |
| `popup.html` | 视图模式下拉增加「目录」选项 |
| `css/popup.css` | 目录树容器、文件夹折叠样式 |
| `_locales/zh_CN/messages.json` | `popup_view_mode_directory_title`、`popup_directory_uncategorized`、删除勾选相关文案 |
| `_locales/en/messages.json` | 同上 |
| `bookmarkEditManager.js` | 选择集从 URL 升级为支持 nodeKey（或新增 directoryEditManager 分支） |
| `filterManager.js` | 目录视图下隐藏/禁用筛选（或按需支持标签筛选） |

### 5.3 可选 / 后续

| 文件 | 内容 |
|------|------|
| `settingsManager.js` | `display.viewMode` 默认值扩展 `'directory'` 选项 |
| `background.js` | 监听 `chrome.bookmarks.onMoved` 等，发送 `BOOKMARKS_UPDATED` 刷新目录视图 |

---

## 6. 实现阶段

### Phase 1：数据与基础渲染（MVP）

1. 实现 `getBookmarksForDirectoryView()`：拉取 Chrome 树 + extension，按原始 URL 聚合为 BookmarkFacet，构建 DirectoryNode 树
2. 新增 `DirectoryBookmarkRenderer`，复用 `createBookmarkElement` 风格
3. `popup.js` 接入目录视图分支，视图切换可正常切换
4. 单节点：编辑、删除、打开（按现有逻辑，先不区分 both 删除勾选）

**验收**：能看到 Chrome 树 + 未归类，三种状态正确展示，单节点操作可用。

### Phase 2：操作语义完善

1. Chrome-only 编辑：保存时同时更新 Chrome + 创建 extension
2. both 删除：弹窗确认后默认同时删除 extension 与对应节点的 Chrome 书签（只删当前节点）
3. 编辑改 URL 冲突：提示合并逻辑
4. 部分成功：toast 与失败明细

**验收**：行为符合规范表。

### Phase 3：批量与 nodeKey

1. `BookmarkEditManager` 或新建目录专用编辑管理器，选择集改为 `Set<nodeKey>`
2. 批量删除按节点分流执行
3. 同 URL 多节点时，批量操作仅影响选中节点

**验收**：批量删除按节点生效，不误删同 URL 其它节点。

### Phase 4：扩展（可选）

1. 移动书签目录（`chrome.bookmarks.move`）
2. 目录视图下筛选（标签等）
3. 懒加载大目录树

---

## 7. 验收清单

- [ ] 目录视图可切换，显示 Chrome 收藏夹树 + 未归类
- [ ] chrome_only、extension_only、both 三种状态正确展示
- [ ] both 节点展示插件摘要、标签
- [ ] 单节点编辑、删除符合规范
- [ ] both 删除弹窗确认后同时删除 extension 与对应节点 Chrome 书签
- [ ] 批量删除按节点生效
- [ ] URL normalize 后正确识别 both
- [ ] 部分失败有明确提示
- [ ] 样式与列表/分组视图一致
- [ ] 目录整理三种方式正确执行，文件夹始终在前
- [ ] 整理后浏览器真实书签顺序改变（非仅显示顺序）
- [ ] 整理子菜单在空间不足时向左展开

---

## 8. 附录：i18n Key 建议

| Key | 中文 | 英文 |
|-----|------|------|
| `popup_view_mode_directory_title` | 目录 | Directory |
| `popup_directory_uncategorized` | 未归类 | Unclassified |
| `popup_confirm_delete_chrome_bookmark` | 同时删除浏览器收藏夹中的书签 | Also delete from browser bookmarks |
| `popup_delete_partial_success` | 部分删除成功 | Partial delete success |
| `popup_url_merge_confirm` | 该 URL 已存在，将合并为同一书签。是否继续？ | This URL already exists. Merge into same bookmark? |
| `popup_directory_folder_sort_title` | 整理 | Organize |
| `popup_directory_folder_sort_by_domain` | 按域名整理 | Organize by domain |
| `popup_directory_folder_sort_by_date` | 按创建日期整理 | Organize by date created |
| `popup_directory_folder_sort_by_name` | 按名称整理 | Organize by name |
| `popup_directory_folder_sorted_success` | 整理完成 | Organized successfully |
| `popup_directory_folder_sort_failed` | 整理失败：$1 | Failed to organize: $1 |

---

*文档结束*
