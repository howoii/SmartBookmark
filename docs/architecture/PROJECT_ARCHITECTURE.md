# 项目架构总览

这份文档面向后续 AI 开发、代码审查和功能迭代，目标是让读者在较短时间内理解：

- 代码按什么运行时拆分
- 书签数据存在哪里、如何聚合
- background / popup / settings / quickSave / quickSearch 的责任边界
- Chrome 书签同步、WebDAV 同步、自动同步分别怎么工作
- 修改某类功能时应该先看哪些文件

---

## 1. 项目定位

`smart-bookmark` 是一个 Manifest V3 Chrome 扩展，核心能力是：

- 把插件自有书签存储在本地
- 读取并融合 Chrome 收藏夹书签
- 提供 quick save / popup / quick search / settings 多入口管理书签
- 基于标签、摘要、embedding 做搜索增强
- 支持 WebDAV 配置同步
- 保留一套已关闭的云同步代码骨架

当前主数据源并不是 Chrome 原生书签，而是插件自己的书签存储；Chrome 书签更多承担：

- 外部来源
- 展示融合
- 双向变更同步

---

## 2. 运行时划分

### 2.1 Background / Service Worker

入口文件：

- `background.js`

职责：

- 初始化核心管理器
- 注册浏览器事件、快捷键、消息通道
- 提供对外消息接口
- 处理安装/升级时的浏览器书签补齐
- 注册 Chrome 书签监听与自动同步闹钟

特点：

- MV3 service worker 不是常驻的
- 关键状态不能只依赖内存，必要时要写入 `chrome.storage.local` 或 `chrome.storage.session`

### 2.2 Popup / Side Panel

入口文件：

- `popup.html`
- `popup.js`

职责：

- 展示书签列表 / 目录视图
- 搜索、排序、编辑、删除
- 响应 background 的刷新消息

### 2.3 Quick Save

入口文件：

- `quickSave.html`
- `quickSave.js`

职责：

- 针对当前标签页保存书签
- 编辑已有书签
- 生成标签、摘要、标题翻译

### 2.4 Quick Search

入口文件：

- `quickSearch.html`
- `quickSearch.js`

职责：

- 提供更轻量的快捷搜索入口
- 复用搜索和部分书签编辑能力

### 2.5 Settings / Options

入口文件：

- `settings.html`
- `settings.js`

职责：

- 管理设置、API 服务、自定义过滤器、导入导出、同步设置
- 展示版本信息和统计信息

### 2.6 Content Script

入口文件：

- `contentScript.js`
- `versionCheck.js`

职责较轻，主要用于特定页面交互和版本传递，不承担核心书签逻辑。

---

## 3. 模块分层

### 3.1 基础层

- `consts.js`
  - 消息类型、feature flag、同步枚举
- `logger.js`
  - 日志输出
- `i18n.js`
  - 国际化消息
- `common.js`
  - 跨页面公共能力和消息封装
- `env.js`
  - 运行环境标识

### 3.2 数据模型与存储

- `models.js`
  - `BookmarkSource`
  - `UnifiedBookmark`
- `storageManager.js`
  - 插件本地书签存储核心
  - 缓存、批量写入、运行时字段清洗、embedding 延迟更新
- `settingsManager.js`
  - `chrome.storage.sync` 中的用户设置
- `syncSettingManager.js`
  - `chrome.storage.local` 中的同步配置和同步状态

### 3.3 书签业务层

- `util.js`
  - 书签聚合、Chrome 书签读取、状态判断、打开设置页、使用频率更新等通用业务函数
- `bookmarkOps.js`
  - 统一更新 / 删除书签，协调 extension 与 Chrome 两侧
- `directoryViewData.js`
  - 目录视图的数据聚合层
- `search.js`
  - 搜索、向量相似度和搜索历史
- `api.js`
  - 标签生成、embedding、AI 相关 API 封装
- `folderRecommender.js`
  - 保存书签时自动推荐 Chrome 收藏夹目录
  - 三路召回（行为 / 词面 / 向量）+ 统一排序
  - 实时构造目录画像，不引入新的持久化存储
  - 在 popup / quickSave 页面上下文运行，通过 `BrowserBookmarkSelector.recommendationProvider` 接入

### 3.4 同步层

- `chromeBookmarkSync.js`
  - Chrome 书签事件监听
  - 代理写操作 mute 机制
  - 安装/升级时浏览器书签补齐
- `autoSync.js`
  - 自动同步调度器
- `webdavSync.js`
  - WebDAV 读写、元数据、合并策略
- `sync.js`
  - 已保留但默认关闭的云同步实现
- `webdavClient.js`
  - WebDAV HTTP 封装

### 3.5 UI 页面层

- `popup.js`
- `quickSave.js`
- `quickSearch.js`
- `settings.js`
- `bookmarkEditManager.js`
- `filterManager.js`
- `themeManager.js`

---

## 4. 数据存储模型

### 4.1 总体原则

项目里有三层常用存储：

1. `chrome.storage.local`
   - 插件主数据
   - 书签、同步配置、同步状态、临时缓存标记等
2. `chrome.storage.sync`
   - 跨设备同步的轻量用户设置
3. `chrome.storage.session`
   - service worker 会话级缓存
   - 例如 Chrome 书签 `id -> url` 缓存

### 4.2 插件书签存储

主入口：

- `storageManager.js`

主键规则：

- key 形如 `bookmark.<url>`
- 原始 URL 是唯一标识
- 当前不做 URL 规范化合并

典型字段：

- `url`
- `title`
- `tags`
- `excerpt`
- `embedding`
- `savedAt`
- `useCount`
- `lastUsed`
- `apiService`
- `embedModel`

运行时字段：

- `_presence`
- `_nodeKey`
- `_facet`
- `_embeddingPendingRefresh`

注意：

- `sanitizeBookmarkForStorage` 只删除纯运行时字段
- `sanitizeBookmarkForExport` 会删除所有 `_` 前缀字段
- 新增 `_` 字段时，要先判断它是否应被持久化

### 4.3 UnifiedBookmark

统一展示层模型在 `models.js`：

- `source = extension`
  - 代表插件存储中的完整书签
- `source = chrome`
  - 代表从 Chrome 收藏夹读取的轻量书签

聚合后还会补充：

- `_presence = extension_only | chrome_only | both`
- `chromeId`

### 4.4 设置与同步配置

`SettingsManager`

- 使用 `chrome.storage.sync`
- 保存展示、搜索、隐私、主题等设置

`SyncSettingsManager`

- 使用 `chrome.storage.local`
- 保存 WebDAV / cloud 同步配置

`SyncStatusManager`

- 使用 `chrome.storage.local`
- 保存同步状态、最近同步结果、同步过程信息

### 4.5 其他关键存储键

常见本地键包括：

- `bookmark.<url>`
- `sync_config`
- `sync_status`
- `sync_process`
- `lastSyncVersion`
- `browser_bookmark_bootstrap_state`
- `isRegeneratingEmbeddings`

---

## 5. 书签数据视图与聚合逻辑

### 5.1 展示聚合入口

主函数：

- `getAllBookmarks()` in `util.js`

职责：

- 读取插件书签
- 过滤不可标记 URL
- 再读取 Chrome 收藏夹书签
- 用原始 URL 精确匹配两边数据
- 生成 `extension_only / chrome_only / both`

### 5.2 目录视图聚合入口

主函数：

- `getBookmarksForDirectoryView()` in `directoryViewData.js`

职责：

- 读取 Chrome 树结构
- 读取插件书签
- 按原始 URL 精确匹配两边书签
- 构造 `facet + tree`
- 对插件独有书签挂到虚拟“未归类”目录

### 5.3 为什么会有两套聚合

- `getAllBookmarks()`
  - 面向列表、搜索、通用展示
- `getBookmarksForDirectoryView()`
  - 面向保留 Chrome 目录结构的目录树

改动聚合逻辑时，通常两边都要一起检查。

---

## 6. 关键业务链路

### 6.1 保存当前页面

入口：

- `quickSave.js`

主链路：

1. 读取当前 tab
2. 判断该 URL 是否已存在于 extension 或 Chrome
3. 生成标签 / 摘要 / 标题增强
4. 调用 `bookmarkOps.updateBookmark()` 或直接更新 extension 书签
5. 触发缓存刷新、自动同步和 embedding 更新

### 6.2 搜索书签

入口：

- `search.js`

主链路：

1. 获取 query embedding
2. 读取 `getBookmarksForSearch()`
3. 对 extension 书签计算 embedding 相似度
4. 同时做标题 / 标签 / 摘要 / URL 关键词匹配
5. 混合打分并排序

注意：

- Chrome-only 书签没有 embedding
- extension 书签即使无 embedding，也能走关键词搜索

### 6.3 编辑 / 删除书签

入口：

- `bookmarkOps.js`

统一语义：

- `extension_only`
  - 只改插件存储
- `chrome_only`
  - 必要时先写 extension，再代理更新 Chrome
- `both`
  - 两边一起维护

Chrome 写操作不直接在页面里做，而是走 background 代理，避免事件监听和 UI 更新竞态。

---

## 7. Chrome 书签同步逻辑

主模块：

- `chromeBookmarkSync.js`

### 7.1 运行目标

- 同步用户直接在 Chrome 收藏夹中的变更
- 避免插件自己触发的 Chrome API 写操作又被监听器重复处理
- 在安装/升级时补齐历史 Chrome 书签到插件存储

### 7.2 Mute 机制

当插件主动调用：

- `chrome.bookmarks.create`
- `chrome.bookmarks.update`
- `chrome.bookmarks.remove`
- `chrome.bookmarks.move`

不会直接在 UI 页执行，而是：

1. UI 调 `bookmarkOps`
2. `bookmarkOps` 发送消息给 background
3. background 调 `ChromeBookmarkSync.proxy*`
4. `proxy*` 先登记 mute，再调用 Chrome API
5. 监听器收到事件后消费 mute，跳过重复同步

这套设计是为了避免：

- 重复写 extension
- 重复刷新 UI
- “自己改自己”带来的竞态

### 7.3 URL 缓存

Chrome 书签 `onChanged` / `onRemoved` 并不总能直接给出旧 URL，因此模块会把：

- `chromeId -> url`

缓存到：

- 内存 `Map`
- `chrome.storage.session`

这样 service worker 重启后仍能恢复关键上下文。

### 7.4 安装 / 升级时的补齐

入口：

- `background.js` 的 `chrome.runtime.onInstalled`
- 调用 `ChromeBookmarkSync.runBootstrapSync()`

行为：

- 扫描整棵 Chrome 收藏夹
- 只导入插件里不存在的原始 URL
- 跳过不可标记页面
- 同 URL 多节点只保留一条写入插件存储
- 批量写入，避免消息风暴
- 记录 `browser_bookmark_bootstrap_state`

---

## 8. 远端同步逻辑

### 8.1 WebDAV 同步

主模块：

- `webdavSync.js`
- `webdavClient.js`
- `autoSync.js`

数据拆分：

- `data.json.gz`
  - 书签数据
- `config.json`
  - 设置、过滤器、服务配置
- `meta.json`
  - 元数据、hash、lastModified

特点：

- 书签导出时会清洗内部字段
- embedding 不会被同步，避免体积过大
- 自动同步由 `chrome.alarms` 驱动

### 8.2 云同步

主模块：

- `sync.js`

现状：

- 代码仍在
- 默认由 `FEATURE_FLAGS.ENABLE_CLOUD_SYNC = false` 关闭
- 维护时要把它看作“保留骨架”，不要默认认为线上启用

---

## 9. 消息通信与刷新机制

常见消息定义在：

- `consts.js`

高频消息包括：

- `BOOKMARKS_UPDATED`
  - 通知页面刷新展示
- `BOOKMARK_STORAGE_UPDATED`
  - 同步本地缓存
- `GET_FULL_BOOKMARKS`
- `GET_BOOKMARKS_LOCAL_CACHE`
- `SET_BOOKMARKS`
- `REMOVE_BOOKMARKS`
- `UPDATE_BOOKMARKS_AND_EMBEDDING`
- `PROXY_CHROME_BOOKMARK_*`

经验规则：

- 写操作尽量落在 background
- 页面尽量通过消息请求数据，而不是自行维护另一套真相源
- 调整消息类型时，要同步检查发送方、接收方和缓存更新点

---

## 10. 修改某类功能时先看哪里

### 10.1 改书签存储结构

优先看：

- `models.js`
- `storageManager.js`
- `util.js`
- `bookmarkOps.js`
- `importExport.js`
- `webdavSync.js`

同时检查：

- 导出清洗
- 运行时字段清洗
- embedding 更新逻辑

### 10.2 改目录视图

优先看：

- `directoryViewData.js`
- `popup.js`
- `docs/features/directory-view/SPEC.md`

同时检查：

- URL 聚合规则
- 当前页定位逻辑
- 编辑 / 删除动作是否与列表视图保持一致

### 10.3 改 Chrome 书签联动

优先看：

- `chromeBookmarkSync.js`
- `bookmarkOps.js`
- `background.js`
- `util.js`

同时检查：

- mute 机制
- `chrome.storage.session` 缓存恢复
- 安装期 bootstrap sync

### 10.4 改同步逻辑

优先看：

- `autoSync.js`
- `syncSettingManager.js`
- `webdavSync.js`
- `sync.js`
- `storageManager.js`

同时检查：

- 是否会造成频繁同步
- 是否会把内部字段同步出去
- 是否会误触发 embedding 更新

### 10.5 改搜索 / AI 生成

优先看：

- `search.js`
- `api.js`
- `storageManager.js`
- `quickSave.js`

同时检查：

- embedding 缺失时的降级
- token 统计
- API 服务配置来源

### 10.6 改目录推荐

优先看：

- `folderRecommender.js`
- `browserBookmarkSelector.js`（`refreshRecommendations` / `setRecommendations`）
- `quickSave.js`（`getRecommendedFolders`）
- `popup.js`（`getRecommendedFolders`）

同时检查：

- 推荐不应在 `chromeId` 已存在（锁定模式）时触发
- 向量召回依赖 `getEmbedding` / `makeEmbeddingText`（来自 `api.js`），API 失败时静默降级
- 推荐理由文案在 `_locales/zh_CN/messages.json` 和 `_locales/en/messages.json`
- 性能：10000 书签场景下推荐耗时应 < 150ms

---

## 11. AI 开发时最容易踩的坑

1. 误把 Chrome 收藏夹当成唯一书签源。
   - 实际上插件自有书签才是主数据源。

2. 忘了区分运行时。
   - background、popup、settings、content script 不是同一上下文。

3. 新增 `_` 字段后只改了模型，没改清洗逻辑。

4. 直接在页面里调用 Chrome 书签写 API，绕开 background mute 代理。

5. 只改列表聚合，不改目录聚合。

6. 在 service worker 内依赖只存在于内存的状态。

7. 忽略 feature flag。
   - 尤其是 cloud sync、browser import 等功能。

---

## 12. 推荐阅读顺序

如果是第一次接手本项目，建议按这个顺序看：

1. `manifest.json`
2. `background.js`
3. `storageManager.js`
4. `util.js`
5. `bookmarkOps.js`
6. `chromeBookmarkSync.js`
7. `popup.js`
8. `settings.js`
9. `search.js`
10. `webdavSync.js`

如果是改目录视图，再补：

- `directoryViewData.js`
- `docs/features/directory-view/SPEC.md`

如果是改文档体系，再补：

- `docs/README.md`
