/**
 * Chrome 书签同步管理模块
 *
 * 职责：
 * 1. 持久化 URL 缓存（chrome.storage.session）— 支持 SW 重启后获取变更前的旧 URL
 * 2. Mute 机制 — 代理操作触发的 Chrome 事件不重复通知 UI
 * 3. 外部变更同步 — 用户在 Chrome 书签管理器中的操作自动同步到插件书签
 * 4. 代理操作 API — 供 background 消息处理器调用的 mute + 执行封装
 * 5. 事件监听器注册
 *
 * 依赖（由 background.js importScripts 保证在此之前加载）：
 *   logger, LocalStorageMgr, SettingsManager, MessageType, sendMessageSafely, isNonMarkableUrl,
 *   KNOWN_ROOT_BOOKMARK_FOLDER_IDS（consts.js）
 */

const ChromeBookmarkSync = (() => {
    // ─── 常量 ───
    const MUTE_TTL_MS = 5000;
    const REFRESH_DEBOUNCE_MS = 400;
    const SYNC_TAG_GENERATION_TIMEOUT_MS = 20000;
    const SESSION_CACHE_KEY = '_bmUrlCache';
    const BOOTSTRAP_STATE_KEY = 'browser_bookmark_bootstrap_state';
    const BOOTSTRAP_BATCH_SIZE = 200;

    // ─── 内部状态 ───

    // chromeId → url 内存缓存
    const _urlCache = new Map();
    // 缓存加载 promise（懒初始化，保证只执行一次）
    let _cacheReadyPromise = null;

    // mute: key = chromeId, value = { ts, op }
    const _mutedOps = new Map();
    // create mute 计数器（create 时不知道 chromeId）
    let _muteCreateCounter = 0;

    // 事件串行队列（promise 链），避免同一书签的并发事件交错导致竞态
    let _eventQueue = Promise.resolve();

    // 刷新通知 debounce
    let _refreshTimer = null;
    let _importInProgress = false;
    let _bootstrapSyncPromise = null;

    // ─── URL 缓存 (chrome.storage.session 持久化) ───

    function ensureCacheReady() {
        if (!_cacheReadyPromise) {
            _cacheReadyPromise = _loadOrBuildCache();
        }
        return _cacheReadyPromise;
    }

    async function _loadOrBuildCache() {
        try {
            const stored = await chrome.storage.session.get(SESSION_CACHE_KEY);
            if (stored[SESSION_CACHE_KEY]) {
                const entries = stored[SESSION_CACHE_KEY];
                for (const [id, url] of Object.entries(entries)) {
                    _urlCache.set(id, url);
                }
                logger.debug('[bookmark-sync] 从 session 恢复 URL 缓存', { size: _urlCache.size });
            } else {
                await _rebuildCacheFromTree();
            }
        } catch (e) {
            logger.error('[bookmark-sync] 缓存加载失败，降级为 getTree 重建', { error: e.message });
            await _rebuildCacheFromTree();
        }
    }

    async function _rebuildCacheFromTree() {
        try {
            const tree = await chrome.bookmarks.getTree();
            _urlCache.clear();
            (function traverse(node) {
                if (node.url) _urlCache.set(node.id, node.url);
                if (node.children) node.children.forEach(traverse);
            })(tree[0]);
            await _persistCache();
            logger.debug('[bookmark-sync] 从 getTree 构建 URL 缓存', { size: _urlCache.size });
        } catch (e) {
            logger.error('[bookmark-sync] getTree 构建缓存失败', { error: e.message });
        }
    }

    function _persistCache() {
        const obj = Object.fromEntries(_urlCache);
        return chrome.storage.session.set({ [SESSION_CACHE_KEY]: obj }).catch(e => {
            logger.error('[bookmark-sync] 缓存持久化失败', { error: e.message });
        });
    }

    // ─── Mute 机制 ───

    function muteEvent(chromeId, operation) {
        _mutedOps.set(chromeId, { ts: Date.now(), op: operation });
        logger.debug('[proxy-mute] 注册 mute', { chromeId, operation });
        setTimeout(() => {
            if (_mutedOps.has(chromeId)) {
                logger.warn('[proxy-mute] TTL 过期自动清除 mute', { chromeId });
                _mutedOps.delete(chromeId);
            }
        }, MUTE_TTL_MS);
    }

    function muteNextCreate() {
        _muteCreateCounter++;
        logger.debug('[proxy-mute] 注册 create mute', { counter: _muteCreateCounter });
        setTimeout(() => {
            if (_muteCreateCounter > 0) {
                logger.warn('[proxy-mute] create mute TTL 过期自动清除', { counter: _muteCreateCounter });
                _muteCreateCounter = 0;
            }
        }, MUTE_TTL_MS);
    }

    function _consumeMute(chromeId) {
        if (_mutedOps.has(chromeId)) {
            const entry = _mutedOps.get(chromeId);
            _mutedOps.delete(chromeId);
            logger.debug('[proxy-mute] 消费 mute', { chromeId, op: entry.op });
            return true;
        }
        return false;
    }

    function _consumeCreateMute() {
        if (_muteCreateCounter > 0) {
            _muteCreateCounter--;
            logger.debug('[proxy-mute] 消费 create mute', { remaining: _muteCreateCounter });
            return true;
        }
        return false;
    }

    function rollbackCreateMute() {
        _muteCreateCounter = Math.max(0, _muteCreateCounter - 1);
    }

    // ─── 刷新通知 ───

    function _notifyRefresh() {
        sendMessageSafely({ type: MessageType.BOOKMARKS_UPDATED });
    }

    function scheduleRefresh() {
        if (_importInProgress) return;
        if (_refreshTimer) clearTimeout(_refreshTimer);
        _refreshTimer = setTimeout(() => {
            _refreshTimer = null;
            _notifyRefresh();
        }, REFRESH_DEBOUNCE_MS);
    }

    function createBootstrapState(overrides = {}) {
        return {
            status: 'idle',
            lastRunAt: null,
            lastRunReason: null,
            lastRunVersion: null,
            previousVersion: null,
            importedCount: 0,
            skippedExistingCount: 0,
            skippedDuplicateCount: 0,
            skippedInvalidCount: 0,
            error: null,
            ...overrides,
        };
    }

    async function updateBootstrapState(overrides = {}) {
        const current = await LocalStorageMgr.get(BOOTSTRAP_STATE_KEY) || createBootstrapState();
        const next = {
            ...current,
            ...overrides,
        };
        await LocalStorageMgr.set(BOOTSTRAP_STATE_KEY, next);
        return next;
    }

    function collectChromeBookmarksFromTree(tree) {
        const flattened = [];
        const root = Array.isArray(tree) ? tree[0] : tree;

        (function traverse(node) {
            if (!node) return;
            if (node.url) {
                flattened.push(node);
                return;
            }
            const isRoot = (node.parentId || '') === '0';
            if (isRoot && !KNOWN_ROOT_BOOKMARK_FOLDER_IDS.has(node.id)) {
                logger.debug('[bookmark-sync] 跳过非标准根目录', { node });
                return;
            }
            (node.children || []).forEach(traverse);
        })(root);

        return flattened;
    }

    function mergeChromeBookmarkNode(current, incoming) {
        if (!current) return incoming;
        return {
            ...current,
            title: current.title || incoming.title || incoming.url,
            dateAdded: Math.min(
                current.dateAdded || Number.MAX_SAFE_INTEGER,
                incoming.dateAdded || Number.MAX_SAFE_INTEGER
            ),
            dateLastUsed: Math.max(current.dateLastUsed || 0, incoming.dateLastUsed || 0) || undefined,
        };
    }

    async function buildBootstrapImportPayload() {
        const [tree, existingBookmarks] = await Promise.all([
            chrome.bookmarks.getTree(),
            LocalStorageMgr.getBookmarks(),
        ]);

        const existingUrls = new Set(
            Object.values(existingBookmarks || {})
                .filter(bookmark => bookmark?.url)
                .map(bookmark => bookmark.url)
        );

        const uniqueChromeBookmarks = new Map();
        let skippedInvalidCount = 0;
        let skippedExistingCount = 0;
        let skippedDuplicateCount = 0;

        for (const bookmark of collectChromeBookmarksFromTree(tree)) {
            if (!bookmark?.url || isNonMarkableUrl(bookmark.url)) {
                skippedInvalidCount++;
                continue;
            }
            if (existingUrls.has(bookmark.url)) {
                skippedExistingCount++;
                continue;
            }
            if (uniqueChromeBookmarks.has(bookmark.url)) {
                skippedDuplicateCount++;
                uniqueChromeBookmarks.set(
                    bookmark.url,
                    mergeChromeBookmarkNode(uniqueChromeBookmarks.get(bookmark.url), bookmark)
                );
                continue;
            }
            uniqueChromeBookmarks.set(bookmark.url, bookmark);
        }

        const bookmarksToImport = Array.from(uniqueChromeBookmarks.values()).map(bookmark => ({
            url: bookmark.url,
            title: bookmark.title || bookmark.url,
            tags: [],
            excerpt: '',
            savedAt: getDateTimestamp(bookmark.dateAdded) || Date.now(),
            useCount: 0,
            lastUsed: getDateTimestamp(bookmark.dateLastUsed),
        }));

        return {
            bookmarksToImport,
            skippedExistingCount,
            skippedDuplicateCount,
            skippedInvalidCount,
        };
    }

    async function persistBootstrapBookmarks(bookmarksToImport) {
        for (let i = 0; i < bookmarksToImport.length; i += BOOTSTRAP_BATCH_SIZE) {
            const batch = bookmarksToImport.slice(i, i + BOOTSTRAP_BATCH_SIZE);
            await LocalStorageMgr.setBookmarks(batch, {
                noSync: true,
                noUpdateEmbedding: true,
            });
        }
    }

    async function runBootstrapSync({ reason, previousVersion = null, currentVersion = null } = {}) {
        if (_bootstrapSyncPromise) {
            return _bootstrapSyncPromise;
        }

        _bootstrapSyncPromise = (async () => {
            const startedAt = Date.now();
            await updateBootstrapState(createBootstrapState({
                status: 'running',
                lastRunAt: startedAt,
                lastRunReason: reason || null,
                lastRunVersion: currentVersion || null,
                previousVersion,
            }));

            try {
                const {
                    bookmarksToImport,
                    skippedExistingCount,
                    skippedDuplicateCount,
                    skippedInvalidCount,
                } = await buildBootstrapImportPayload();

                if (bookmarksToImport.length > 0) {
                    await persistBootstrapBookmarks(bookmarksToImport);
                    await LocalStorageMgr.notifyBookmarkSync();
                    try {
                        const embeddingService = await ConfigManager.getEmbeddingService();
                        if (embeddingService?.apiKey && embeddingService?.embedModel) {
                            LocalStorageMgr.scheduleUpdateEmbedding();
                        }
                    } catch (error) {
                        logger.warn('[bookmark-sync] 检查 embedding 配置失败，跳过自动补向量', { error: error.message });
                    }
                    _notifyRefresh();
                }

                const result = createBootstrapState({
                    status: 'success',
                    lastRunAt: startedAt,
                    lastRunReason: reason || null,
                    lastRunVersion: currentVersion || null,
                    previousVersion,
                    importedCount: bookmarksToImport.length,
                    skippedExistingCount,
                    skippedDuplicateCount,
                    skippedInvalidCount,
                });
                await LocalStorageMgr.set(BOOTSTRAP_STATE_KEY, result);
                logger.info('[bookmark-sync] 安装期浏览器书签同步完成', result);
                return result;
            } catch (error) {
                const failed = createBootstrapState({
                    status: 'failed',
                    lastRunAt: startedAt,
                    lastRunReason: reason || null,
                    lastRunVersion: currentVersion || null,
                    previousVersion,
                    error: error.message,
                });
                await LocalStorageMgr.set(BOOTSTRAP_STATE_KEY, failed);
                logger.error('[bookmark-sync] 安装期浏览器书签同步失败', { error: error.message });
                throw error;
            } finally {
                _bootstrapSyncPromise = null;
            }
        })();

        return _bootstrapSyncPromise;
    }

    // ─── 外部变更 → 插件书签同步 ───

    async function _syncChangedToExtension(id, changeInfo, oldUrl) {
        try {
            if (!oldUrl || isNonMarkableUrl(oldUrl)) return;

            const extBookmark = await LocalStorageMgr.getBookmark(oldUrl);
            if (!extBookmark) {
                logger.debug('[bookmark-sync] onChanged: 插件中不存在，跳过', { oldUrl });
                return;
            }

            const urlChanged = changeInfo.url && changeInfo.url !== oldUrl;
            if (urlChanged) {
                await LocalStorageMgr.removeBookmark(oldUrl);
                await LocalStorageMgr.updateBookmarksAndEmbedding([{
                    ...extBookmark,
                    url: changeInfo.url,
                    title: changeInfo.title ?? extBookmark.title,
                }]);
                logger.info('[bookmark-sync] URL 变更已同步', { oldUrl, newUrl: changeInfo.url });
            } else if (changeInfo.title) {
                await LocalStorageMgr.updateBookmarksAndEmbedding([{
                    ...extBookmark,
                    title: changeInfo.title,
                }]);
                logger.info('[bookmark-sync] 标题变更已同步', { url: oldUrl, newTitle: changeInfo.title });
            }
        } catch (e) {
            logger.error('[bookmark-sync] onChanged 同步失败', { id, changeInfo, error: e.message });
        }
    }

    async function _syncCreatedToExtension(id, bookmark) {
        try {
            if (!bookmark.url || isNonMarkableUrl(bookmark.url)) return;

            const extBookmark = await LocalStorageMgr.getBookmark(bookmark.url);
            if (extBookmark) {
                if (bookmark.title && bookmark.title !== extBookmark.title) {
                    await LocalStorageMgr.updateBookmarksAndEmbedding([{
                        ...extBookmark,
                        title: bookmark.title,
                    }]);
                    logger.info('[bookmark-sync] 已有书签标题同步', { url: bookmark.url });
                }
            } else {
                const newBookmark = await _buildExtensionBookmarkFromChromeBookmark(bookmark);
                await LocalStorageMgr.updateBookmarksAndEmbedding([newBookmark]);
                logger.info('[bookmark-sync] 新书签已同步到插件', { url: bookmark.url, title: bookmark.title });
            }
        } catch (e) {
            logger.error('[bookmark-sync] onCreated 同步失败', { id, error: e.message });
        }
    }

    async function _getActiveTabMatchingBookmarkUrl(url) {
        try {
            const [activeTab] = await chrome.tabs.query({
                active: true,
                lastFocusedWindow: true,
            });
            if (activeTab?.id && activeTab.url === url) {
                return activeTab;
            }
        } catch (error) {
            logger.warn('[bookmark-sync] 查询当前活动标签页失败', { url, error: error.message });
        }
        return null;
    }

    async function _buildExtensionBookmarkFromChromeBookmark(bookmark) {
        const baseBookmark = {
            url: bookmark.url,
            title: bookmark.title || bookmark.url,
            tags: [],
            excerpt: '',
            savedAt: bookmark.dateAdded || Date.now(),
            useCount: 0,
            lastUsed: bookmark.dateLastUsed || Date.now(),
        };

        const activeTab = await _getActiveTabMatchingBookmarkUrl(bookmark.url);
        if (!activeTab?.id || activeTab.status !== 'complete') {
            return baseBookmark;
        }

        try {
            const pageContent = await getPageContent(activeTab);
            const excerpt = pageContent?.excerpt?.trim();
            if (!excerpt) {
                return baseBookmark;
            }

            const autoGenerate = await SettingsManager.get('ai.autoGenerateTags');
            if (autoGenerate === false) {
                return { ...baseBookmark, excerpt };
            }

            const tags = await _generateTagsForSyncWithTimeout(pageContent, activeTab, bookmark.url);
            if (!Array.isArray(tags) || tags.length === 0) {
                return baseBookmark;
            }

            logger.info('[bookmark-sync] 使用当前页面内容补全新书签', {
                url: bookmark.url,
                tagCount: tags.length,
            });

            return {
                ...baseBookmark,
                tags,
                excerpt,
            };
        } catch (error) {
            logger.warn('[bookmark-sync] 当前页面内容补全失败，回退为直接保存', {
                url: bookmark.url,
                error: error.message,
            });
            return baseBookmark;
        }
    }

    async function _generateTagsForSyncWithTimeout(pageContent, tab, url) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort(new Error('sync tag generation timeout'));
        }, SYNC_TAG_GENERATION_TIMEOUT_MS);

        try {
            return await generateTags(pageContent, tab, controller.signal);
        } catch (error) {
            if (isAbortError(error) || isUserCanceledError(error) || error?.message === USER_CANCELED) {
                logger.warn('[bookmark-sync] 生成标签超时或被取消，回退为直接保存', {
                    url,
                    timeoutMs: SYNC_TAG_GENERATION_TIMEOUT_MS,
                });
                return [];
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async function _syncRemovedFromExtension(id, removeInfo, cachedUrl) {
        try {
            const node = removeInfo.node;

            if (node?.children) {
                await _syncFolderRemoved(node);
                return;
            }

            const url = cachedUrl || node?.url;
            if (!url || isNonMarkableUrl(url)) return;

            try {
                const remaining = await chrome.bookmarks.search({ url });
                if (remaining.length > 0) {
                    logger.debug('[bookmark-sync] URL 仍存在于其他 Chrome 书签，跳过删除', { url });
                    return;
                }
            } catch (_) { /* search 失败时继续删除 */ }

            const extBookmark = await LocalStorageMgr.getBookmark(url);
            if (!extBookmark) {
                logger.debug('[bookmark-sync] onRemoved: 插件中不存在，跳过', { url });
                return;
            }

            await LocalStorageMgr.removeBookmark(url);
            logger.info('[bookmark-sync] 书签删除已同步', { url });
        } catch (e) {
            logger.error('[bookmark-sync] onRemoved 同步失败', { id, error: e.message });
        }
    }

    async function _syncFolderRemoved(node) {
        if (node.url && !isNonMarkableUrl(node.url)) {
            _urlCache.delete(node.id);
            try {
                const remaining = await chrome.bookmarks.search({ url: node.url });
                if (remaining.length > 0) return;
            } catch (_) { /* ignore */ }

            const extBookmark = await LocalStorageMgr.getBookmark(node.url);
            if (extBookmark) {
                await LocalStorageMgr.removeBookmark(node.url);
                logger.info('[bookmark-sync] 文件夹删除 - 子书签同步删除', { url: node.url });
            }
        }
        if (node.children) {
            for (const child of node.children) {
                await _syncFolderRemoved(child);
            }
        }
    }

    // ─── 事件处理器（缓存更新 → mute 检查 → 同步 → 刷新） ───

    async function _handleChanged(id, changeInfo) {
        await ensureCacheReady();

        const oldUrl = _urlCache.get(id);
        if (changeInfo.url) {
            _urlCache.set(id, changeInfo.url);
            _persistCache();
        }

        if (_consumeMute(id)) {
            logger.debug('[proxy-mute] 事件 onChanged 已被 mute，跳过同步和刷新', { id, changeInfo });
            return;
        }
        logger.debug('书签变更(onChanged)', { id, changeInfo });
        await _syncChangedToExtension(id, changeInfo, oldUrl);
        scheduleRefresh();
    }

    async function _handleCreated(id, bookmark) {
        await ensureCacheReady();

        if (bookmark.url) {
            _urlCache.set(id, bookmark.url);
            _persistCache();
        }

        if (_consumeCreateMute()) {
            logger.debug('[proxy-mute] 事件 onCreated 已被 create mute，跳过同步和刷新', { id, bookmark });
            return;
        }
        logger.debug('书签变更(onCreated)', { id, bookmark });
        await _syncCreatedToExtension(id, bookmark);
        scheduleRefresh();
    }

    async function _handleRemoved(id, removeInfo) {
        await ensureCacheReady();

        const cachedUrl = _urlCache.get(id);
        _urlCache.delete(id);
        if (removeInfo.node?.children) {
            _clearCacheForSubtree(removeInfo.node);
        }
        _persistCache();

        if (_consumeMute(id)) {
            logger.debug('[proxy-mute] 事件 onRemoved 已被 mute，跳过同步和刷新', { id, removeInfo });
            return;
        }
        logger.debug('书签变更(onRemoved)', { id, removeInfo });
        await _syncRemovedFromExtension(id, removeInfo, cachedUrl);
        scheduleRefresh();
    }

    async function _handleMoved(id, moveInfo) {
        await ensureCacheReady();

        if (_consumeMute(id)) {
            logger.debug('[proxy-mute] 事件 onMoved 已被 mute，跳过刷新', { id, moveInfo });
            return;
        }
        logger.debug('书签变更(onMoved)', { id, moveInfo });
        scheduleRefresh();
    }

    function _clearCacheForSubtree(node) {
        if (node.id) _urlCache.delete(node.id);
        if (node.children) {
            node.children.forEach(child => _clearCacheForSubtree(child));
        }
    }

    // ─── 事件队列 ───

    function _enqueue(asyncFn) {
        _eventQueue = _eventQueue.then(asyncFn).catch(e => {
            logger.error('[bookmark-sync] 队列任务异常', { error: e.message });
        });
    }

    // ─── 注册 Chrome 书签事件监听器 ───

    function registerListeners() {
        chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
            _enqueue(() => _handleChanged(id, changeInfo));
        });

        chrome.bookmarks.onCreated.addListener((id, bookmark) => {
            _enqueue(() => _handleCreated(id, bookmark));
        });

        chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
            _enqueue(() => _handleRemoved(id, removeInfo));
        });

        chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
            _enqueue(() => _handleMoved(id, moveInfo));
        });

        if (chrome.bookmarks.onImportBegan) {
            chrome.bookmarks.onImportBegan.addListener(() => {
                _importInProgress = true;
                if (_refreshTimer) {
                    clearTimeout(_refreshTimer);
                    _refreshTimer = null;
                }
            });
        }
        if (chrome.bookmarks.onImportEnded) {
            chrome.bookmarks.onImportEnded.addListener(() => {
                _importInProgress = false;
                _notifyRefresh();
            });
        }

        logger.debug('[bookmark-sync] 事件监听器已注册');
        ensureCacheReady();
    }

    // ─── 代理操作 API（供 background 消息处理器调用） ───

    async function proxyCreate(createDetails) {
        logger.debug('[proxy] 执行 chrome.bookmarks.create', { createDetails });
        muteNextCreate();
        try {
            const result = await chrome.bookmarks.create(createDetails);
            logger.debug('[proxy] chrome.bookmarks.create 成功', { result });
            return result;
        } catch (error) {
            rollbackCreateMute();
            logger.error('[proxy] chrome.bookmarks.create 失败', { error: error.message });
            throw error;
        }
    }

    async function proxyUpdate(chromeId, changes) {
        logger.debug('[proxy] 执行 chrome.bookmarks.update', { chromeId, changes });
        muteEvent(chromeId, 'update');
        const result = await chrome.bookmarks.update(chromeId, changes);
        logger.debug('[proxy] chrome.bookmarks.update 成功', { chromeId, result });
        return result;
    }

    async function proxyRemove(chromeId) {
        logger.debug('[proxy] 执行 chrome.bookmarks.remove', { chromeId });
        muteEvent(chromeId, 'remove');
        await chrome.bookmarks.remove(chromeId);
        logger.debug('[proxy] chrome.bookmarks.remove 成功', { chromeId });
    }

    async function proxyMove(chromeId, destination) {
        logger.debug('[proxy] 执行 chrome.bookmarks.move', { chromeId, destination });
        muteEvent(chromeId, 'move');
        const result = await chrome.bookmarks.move(chromeId, destination);
        logger.debug('[proxy] chrome.bookmarks.move 成功', { chromeId, result });
        return result;
    }

    async function proxyRemoveTree(chromeId) {
        logger.debug('[proxy] 执行 chrome.bookmarks.removeTree', { chromeId });
        muteEvent(chromeId, 'remove');
        await chrome.bookmarks.removeTree(chromeId);
        logger.debug('[proxy] chrome.bookmarks.removeTree 成功', { chromeId });
    }

    // ─── 公开 API ───

    return {
        ensureCacheReady,
        registerListeners,
        scheduleRefresh,
        runBootstrapSync,

        // 代理操作（background 消息处理器调用）
        proxyCreate,
        proxyUpdate,
        proxyRemove,
        proxyMove,
        proxyRemoveTree,
    };
})();
