class LocalStorageMgr {
    static Namespace = {
        BOOKMARK: 'bookmark.',
        TAGCACHE: 'tagcache',
        BOOKMARK_CACHE: 'bookmark_cache',
        CACHE: 'cache.'
    };

    static _bookmarksCache = null;
    static _bookmarksLocalCache = null;
    static _bookmarkCacheUpdateTimer = null;
    static _updateEmbeddingTimer = null;
    static _isUpdatingEmbedding = false; // 标记是否正在更新向量，避免重复触发
    static _commonCache = {};
    static DEBOUNCE_DELAY = 2000; // 2000毫秒的防抖延迟
    static BOOKMARK_CACHE_UPDATE_DELAY = 4000; // 4000毫秒的更新间隔
    static UPDATE_EMBEDDING_DELAY = 20000; // 20秒的防抖更新间隔
    static BATCH_SIZE = 10; // 10个书签为一批
    static REGENERATING_EMBEDDINGS_TIMEOUT = 5 * 60 * 1000; // 5分钟超时时间（毫秒）

    static async init() {
        if (EnvIdentifier !== "background") {
            await this.initLocalCache();
        } else {
            this.scheduleUpdateEmbedding();
        }
        this.setupListener();
    }

    static async initBookmarksCache() {
        logger.debug('initBookmarksCache');
        await this.getBookmarks();
    }

    static async initLocalCache() {
        logger.debug('initLocalCache');
        await this.getBookmarksFromLocalCache();
    }

    // 通知popup和setting等页面书签缓存变化
    static async notifyBookmarkCacheChange(bookmarksMap) {
        try {
            await chrome.runtime.sendMessage({
                env: EnvIdentifier,
                type: MessageType.BOOKMARK_STORAGE_UPDATED,
                data: {
                    bookmarksMap: bookmarksMap
                }
            });
        } catch (error) {
            logger.debug('通知书签缓存变化失败:', error);
        }
    }

    // 通知书签同步
    static async notifyBookmarkSync() {
        try {
            await AutoSyncManager.handleScheduledSync({
                reason: ScheduleSyncReason.BOOKMARKS,
            });
        } catch (error) {
            logger.debug('通知书签同步失败:', error);
        }
    }

    static setupListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            logger.debug('local storage manager 收到消息', { message: message });
            if (message.type === MessageType.BOOKMARK_STORAGE_UPDATED) {
                if (EnvIdentifier !== "background") {
                    logger.debug('local storage manager 更新本地书签缓存', { bookmarksMap: message.data.bookmarksMap });
                    this._bookmarksLocalCache = message.data.bookmarksMap;
                }
            }
        });
    }

    // ----------------------------------- 基础存储操作开始 分割线 -----------------------------------

    static async get(key) {
        const result = await chrome.storage.local.get(key);
        return result[key];
    }

    static async batchGet(...keys) {
        const result = await chrome.storage.local.get(keys);
        return result;
    }

    static async set(key, value) {
        await this.setObject({ [key]: value })
    }

    static async setObject(object) {
        await chrome.storage.local.set(object);
    }

    static async remove(keys) {
        await chrome.storage.local.remove(keys);
    }

    static async getAllKeys() {
        try {
            // 优先使用新版API（Chrome 130+）
            if (chrome.storage.local.getKeys) {
                logger.debug('使用新版API获取所有键名');
                return await chrome.storage.local.getKeys();
            }
            logger.debug('使用旧版API获取所有键名');
            const allData = await chrome.storage.local.get(null);
            return Object.keys(allData);
        } catch (error) {
            logger.error('获取所有键名失败:', error);
            return [];
        }
    }

    static async getKeysByPrefix(prefix) {
        const allKeys = await this.getAllKeys();
        const keys = allKeys.filter(key => key.startsWith(prefix));
        const allData = await chrome.storage.local.get(keys);
        return allData;
    }

    static async removeKeysByPrefix(prefix) {
        const allKeys = await this.getAllKeys();
        const keysToRemove = allKeys.filter(key => key.startsWith(prefix));
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
        }
    }

    // ----------------------------------- 基础存储操作结束 分割线 -----------------------------------

    // ----------------------------------- 书签相关操作开始 分割线 -----------------------------------

    static getBookmarkKey(url) {
        return `${this.Namespace.BOOKMARK}${url}`;
    }

    // 返回书签对象，key为url，value为书签对象
    static async getBookmarks() {
        if (EnvIdentifier !== "background") {
            return await getFullBookmarksFromBackground();
        }
        logger.debug('开始获取书签');
        if (this._bookmarksCache) {
            logger.debug('获取书签完成，缓存命中');
            return this._bookmarksCache;
        }
        const bookmarks = await this.getKeysByPrefix(this.Namespace.BOOKMARK);
        logger.debug('获取书签完成，缓存未命中');
        this._bookmarksCache = bookmarks;
        return bookmarks;
    }

    static async getBookmarksList() {
        const bookmarks = await this.getBookmarks();
        return Object.values(bookmarks);
    }

    /**
     * 根据URL数组获取书签数据
     * @param {Array<string>} urls URL数组
     * @param {boolean} withoutCache 是否跳过缓存直接获取
     * @returns {Promise<Array>} 存在的书签数组
     */
    static async batchGetBookmarks(urls, withoutCache = false) {
        if (!withoutCache) {
            const bookmarks = await this.getBookmarks();
            // 过滤出存在的书签
            return urls
                .map(url => bookmarks[this.getBookmarkKey(url)])
                .filter(bookmark => bookmark !== undefined && bookmark !== null);
        } else {
            const result = await this.batchGet(...urls.map(url => this.getBookmarkKey(url)));
            // 过滤出存在的书签
            return Object.values(result).filter(bookmark => bookmark !== undefined && bookmark !== null);
        }
    }

    static async getBookmark(url, withoutCache = false) {
        const key = this.getBookmarkKey(url);
        if (!withoutCache) {
            const bookmarks = await this.getBookmarks();
            return bookmarks[key];
        } else {
            return await this.get(key);
        }
    }

    static async setBookmark(url, bookmark, options = {}) {
        if (EnvIdentifier !== "background") {
            return await setBookmarksToBackground([bookmark], options);
        }
        const key = this.getBookmarkKey(url);
        await this.set(key, bookmark);
        // 更新缓存
        if (this._bookmarksCache) {
            this._bookmarksCache[key] = bookmark;
        }
        const bookmarksMap = await this.triggerBookmarkCacheUpdate();
        await this.notifyBookmarkCacheChange(bookmarksMap);
        if (!options.noSync) {
            await this.notifyBookmarkSync();
        }
        if (!options.noUpdateEmbedding) {
            this.scheduleUpdateEmbedding();
        }
    }

    static async setBookmarks(bookmarks, options = {}) {
        if (EnvIdentifier !== "background") {
            return await setBookmarksToBackground(bookmarks, options);
        }
        if (bookmarks.length === 0) {
            return;
        }
        // 过滤掉非法书签
        bookmarks = bookmarks.filter(bookmark => bookmark && bookmark.url && bookmark.url.length > 0);
        // 将书签数组转换为对象
        const bookmarksObject = bookmarks.reduce((obj, bookmark) => {
            obj[this.getBookmarkKey(bookmark.url)] = bookmark;
            return obj;
        }, {});
        await this.setObject(bookmarksObject);
        // 更新缓存
        if (this._bookmarksCache) {
            for (const key of Object.keys(bookmarksObject)) {
                this._bookmarksCache[key] = bookmarksObject[key];
            }
        }
        const bookmarksMap = await this.triggerBookmarkCacheUpdate();
        await this.notifyBookmarkCacheChange(bookmarksMap);
        if (!options.noSync) {
            await this.notifyBookmarkSync();
        }
        if (!options.noUpdateEmbedding) {
            this.scheduleUpdateEmbedding();
        }
    }

    static async removeBookmark(url, options = {}) {
        if (EnvIdentifier !== "background") {
            return await removeBookmarksByBackground([url], options);
        }
        const key = this.getBookmarkKey(url);
        await this.remove([key]);
        // 更新缓存
        if (this._bookmarksCache) {
            delete this._bookmarksCache[key];
        }
        const bookmarksMap = await this.triggerBookmarkCacheUpdate();
        await this.notifyBookmarkCacheChange(bookmarksMap);
        if (!options.noSync) {
            await this.notifyBookmarkSync();
        }
    }

    static async removeBookmarks(urls, options = {}) {
        if (EnvIdentifier !== "background") {
            return await removeBookmarksByBackground(urls, options);
        }
        const keys = urls.map(url => this.getBookmarkKey(url));
        await this.remove(keys);
        // 更新缓存
        if (this._bookmarksCache) {
            for (const key of keys) {
                delete this._bookmarksCache[key];
            }
        }
        const bookmarksMap = await this.triggerBookmarkCacheUpdate();
        await this.notifyBookmarkCacheChange(bookmarksMap);
        if (!options.noSync) {
            await this.notifyBookmarkSync();
        }
    }

    static async clearBookmarks(options = {}) {
        if (EnvIdentifier !== "background") {
            return await clearBookmarksByBackground(options);
        }
        await this.removeKeysByPrefix(this.Namespace.BOOKMARK);
        if (this._bookmarksCache) {
            this._bookmarksCache = {};  // 清空书签时清除缓存
        }
        const bookmarksMap = await this.triggerBookmarkCacheUpdate();
        await this.notifyBookmarkCacheChange(bookmarksMap);
        if (!options.noSync) {
            await this.notifyBookmarkSync();
        }
    }

    // 更新书签并检查是否更新嵌入向量, background调用
    static async updateBookmarksAndEmbedding(bookmarks, options = {}) {
        if (EnvIdentifier !== "background") {
            return;
        }
        for (const bookmark of bookmarks) {
            if (!bookmark.embedding) { // 如果书签没有嵌入向量，则检查是否可以保留本地的向量数据
                const oldBookmark = await this.getBookmark(bookmark.url);
                if (oldBookmark) {
                    const oldEmbeddingText = makeEmbeddingText(oldBookmark);
                    const newEmbeddingText = makeEmbeddingText(bookmark);
                    if (oldBookmark && oldEmbeddingText === newEmbeddingText) {
                        bookmark.apiService = oldBookmark.apiService;
                        bookmark.embedModel = oldBookmark.embedModel;
                        bookmark.embedding = oldBookmark.embedding;
                    }
                }
            }
        }
        await this.setBookmarks(bookmarks, options);
    }

    // 计划扫描并更新向量
    static scheduleUpdateEmbedding() {
        if (EnvIdentifier !== "background") {
            return;
        }
        
        // 如果正在更新向量，则跳过本次调度
        if (this._isUpdatingEmbedding) {
            logger.debug('向量更新正在进行中，跳过本次调度');
            return;
        }
        
        if (this._updateEmbeddingTimer) {
            clearTimeout(this._updateEmbeddingTimer);
        }
        logger.debug('计划扫描并更新向量, 将在20秒后触发');
        this._updateEmbeddingTimer = setTimeout(async () => {
            this._updateEmbeddingTimer = null;
            await this.scanAndUpdateEmbedding();
        }, this.UPDATE_EMBEDDING_DELAY);
    }

    // 扫描并更新向量
    static async scanAndUpdateEmbedding() {
        if (EnvIdentifier !== "background") {
            return;
        }
        
        // 如果正在更新向量，则跳过本次执行
        if (this._isUpdatingEmbedding) {
            logger.debug('向量更新正在进行中，跳过本次执行');
            return;
        }
        
        // 设置更新标志，防止重复触发
        this._isUpdatingEmbedding = true;
        
        // 写入状态标记到storage，通知popup等页面，同时记录时间戳
        await this.set('isRegeneratingEmbeddings', {
            isRegenerating: true,
            timestamp: Date.now()
        });
        
        try {
            logger.info('开始扫描并更新向量');
            
            // 先筛选出需要更新向量的书签
            const bookmarks = await this.getBookmarksList();
            const embeddingService = await ConfigManager.getEmbeddingService();
            
            // 验证 API 配置
            if (!embeddingService || !embeddingService.apiKey || !embeddingService.embedModel) {
                logger.warn('未配置有效的向量模型，跳过向量更新');
                return;
            }
            
            const needUpdateBookmarks = bookmarks.filter(bookmark => 
                ConfigManager.isNeedUpdateEmbedding(bookmark, embeddingService)
            );
            
            if (needUpdateBookmarks.length === 0) {
                logger.info('没有需要更新向量的书签');
                return;
            }
            
            logger.info(`需要更新向量的书签数量: ${needUpdateBookmarks.length}`);
            
            // 调用批量更新函数
            await this.batchUpdateEmbeddings(needUpdateBookmarks, embeddingService);
            
            logger.info('扫描并更新向量完成');
        } catch (error) {
            logger.error('扫描并更新向量失败:', error);
        } finally {
            // 无论成功还是失败，都要清除更新标志
            // 确保所有退出路径都会清除标志
            this._isUpdatingEmbedding = false;
            // 清除状态标记
            await this.set('isRegeneratingEmbeddings', {
                isRegenerating: false,
                timestamp: Date.now()
            });
            logger.debug('向量更新标志已清除');
        }
    }
    
    /**
     * 批量更新书签的嵌入向量
     * @param {Array} bookmarks - 需要更新的书签数组
     * @param {Object} embeddingService - embedding 服务配置
     */
    static async batchUpdateEmbeddings(bookmarks, embeddingService) {
        if (!bookmarks || bookmarks.length === 0) {
            return;
        }
        
        logger.debug(`开始批量更新 ${bookmarks.length} 个书签的向量`);
        
        // 准备文本数据和书签映射
        const textsToEmbed = [];
        const bookmarkMapping = []; // 存储文本索引到书签的映射
        
        for (const bookmark of bookmarks) {
            const text = makeEmbeddingText(bookmark);
            if (text) {
                textsToEmbed.push(text);
                bookmarkMapping.push(bookmark);
            }
        }
        
        if (textsToEmbed.length === 0) {
            logger.warn('没有有效的文本需要生成向量');
            return;
        }
        
        // 分批处理，每批最多处理 BATCH_SIZE 个书签
        const batchSize = this.BATCH_SIZE;
        const totalBatches = Math.ceil(textsToEmbed.length / batchSize);
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < totalBatches; i++) {
            const startIdx = i * batchSize;
            const endIdx = Math.min(startIdx + batchSize, textsToEmbed.length);
            const batchTexts = textsToEmbed.slice(startIdx, endIdx);
            const batchBookmarks = bookmarkMapping.slice(startIdx, endIdx);
            
            logger.debug(`处理第 ${i + 1}/${totalBatches} 批，包含 ${batchTexts.length} 个书签`);
            
            try {
                // 调用批量 embedding API
                const results = await getBatchEmbeddings(batchTexts);
                
                // 处理结果并更新书签
                const updatedBookmarks = [];
                for (let j = 0; j < results.length; j++) {
                    const result = results[j];
                    const bookmark = batchBookmarks[j];
                    
                    if (result.embedding) {
                        // 更新书签的 embedding 信息
                        const updatedBookmark = {
                            ...bookmark,
                            embedding: result.embedding,
                            apiService: embeddingService.id,
                            embedModel: embeddingService.embedModel
                        };
                        updatedBookmarks.push(updatedBookmark);
                        successCount++;
                    } else {
                        logger.error(`书签 "${bookmark.title}" 向量生成失败: ${result.error}`);
                        failCount++;
                    }
                }
                
                // 渐进式保存：每批处理完立即保存
                if (updatedBookmarks.length > 0) {
                    await this.setBookmarks(updatedBookmarks, {
                        noSync: true,  // 不触发同步
                        noUpdateEmbedding: true  // 不再次触发向量更新
                    });
                    logger.debug(`第 ${i + 1} 批已保存 ${updatedBookmarks.length} 个书签`);
                }
                
                // API 调用频率控制：每批之间延迟，避免超过速率限制
                // 除了最后一批，其他批次之间都要延迟
                if (i < totalBatches - 1) {
                    const delayMs = 1000; // 1秒延迟
                    logger.debug(`等待 ${delayMs}ms 后处理下一批...`);
                    await sleep(delayMs);
                }
                
            } catch (error) {
                logger.error(`第 ${i + 1} 批处理失败:`, error);
                failCount += batchTexts.length;
                
                // 即使失败也继续处理下一批
                continue;
            }
        }
        
        logger.info(`批量更新向量完成: 成功 ${successCount}/${textsToEmbed.length}, 失败 ${failCount}`);
    }

    // ----------------------------------- 书签部分结束 分割线 -----------------------------------

    // ----------------------------------- 书签缓存部分开始 分割线 -----------------------------------

    static async getBookmarksFromLocalCache() {
        logger.debug('开始获取本地书签缓存');
        if (this._bookmarksLocalCache) {
            logger.debug('获取本地书签缓存完成，缓存命中');
            return this._bookmarksLocalCache;
        }
        const bookmarks = await this.get(this.Namespace.BOOKMARK_CACHE);
        // 转成map
        if (!bookmarks || !Array.isArray(bookmarks)) {
            logger.debug('获取本地书签缓存完成，缓存未命中');
            this._bookmarksLocalCache = {};
            return {};
        }
        
        const bookmarksMap = {};
        for (const bookmark of bookmarks) {
            if (bookmark && bookmark.url) {
                bookmark.isCached = true;
                bookmarksMap[bookmark.url] = bookmark;
            }
        }
        logger.debug('获取本地书签缓存完成，缓存未命中');
        this._bookmarksLocalCache = bookmarksMap;
        return bookmarksMap;
    }

    static async updateBookmarkCache() {
        logger.debug('开始更新书签缓存');
        const bookmarksMap = await this.getBookmarks();
        // 创建清理后的缓存副本，清除书签的apiService、embedModel、embedding
        const cleanedBookmarksMap = {};
        for (const key in bookmarksMap) {
            const bookmark = bookmarksMap[key];
            const cleanedBookmark = {
                ...bookmark,
                apiService: undefined,
                embedModel: undefined,
                embedding: undefined
            };
            cleanedBookmarksMap[key] = cleanedBookmark;
        }
        this._bookmarksLocalCache = cleanedBookmarksMap;
        logger.debug('书签缓存更新完成');
        return cleanedBookmarksMap;
    }

    // 刷新书签缓存
    static async flushBookmarkCache() {
        if (this._bookmarksLocalCache) {
            logger.debug('开始刷新书签缓存到本地');
            // 将书签缓存对象转换为数组
            const bookmarks = Object.values(this._bookmarksLocalCache);
            await this.set(this.Namespace.BOOKMARK_CACHE, bookmarks);
            logger.debug('刷新书签缓存到本地完成');
        }
    }

    static async triggerBookmarkCacheUpdate() {
        if (this._bookmarkCacheUpdateTimer) {
            clearTimeout(this._bookmarkCacheUpdateTimer);
        }
        logger.debug('计划刷新书签缓存到本地, 将在4秒后触发');
        this._bookmarkCacheUpdateTimer = setTimeout(async () => {
            this._bookmarkCacheUpdateTimer = null;
            await this.flushBookmarkCache();
        }, this.BOOKMARK_CACHE_UPDATE_DELAY);
        return await this.updateBookmarkCache();
    }

    // ----------------------------------- 书签缓存部分结束 分割线 -----------------------------------

    // 标签缓存
    static async getTags(url) {
        try {
            const data = await this.get(this.Namespace.TAGCACHE);
            return data && data.url === url ? data.tags : null;
        } catch (error) {
            logger.error('获取缓存标签失败:', error);
            return null;
        }
    }

    static async setTags(url, tags) {
        try {
            await this.set(this.Namespace.TAGCACHE, { url: url, tags: tags });
        } catch (error) {
            logger.error('缓存标签失败:', error);
        }
    }

    // 获取上次显示的版本信息
    static async getLastShownVersion() {
        return await this.get('last_shown_version');
    }

    // 设置上次显示的版本信息
    static async setLastShownVersion(version) {
        await this.set('last_shown_version', version);
    }

    // 自定义分组折叠状态
    static async getCustomGroupCollapsedStates() {
        const key = this.Namespace.CACHE + 'group_collapsed_states';
        if (this._commonCache[key]) {
            return this._commonCache[key];
        }
        const states = await this.get(key);
        this._commonCache[key] = states;
        return states || {};
    }

    static async setCustomGroupCollapsedStates(states) {
        const key = this.Namespace.CACHE + 'group_collapsed_states';
        await this.set(key, states);
        this._commonCache[key] = states;
    }
    // 自定义分组折叠状态结束

    // 层级视图展开状态管理
    static async getHierarchyExpandedStates() {
        const key = this.Namespace.CACHE + 'hierarchy_expanded_states';
        if (this._commonCache[key]) {
            return this._commonCache[key];
        }
        const states = await this.get(key);
        this._commonCache[key] = states;
        return states || [];
    }

    static async setHierarchyExpandedStates(states) {
        const key = this.Namespace.CACHE + 'hierarchy_expanded_states';
        await this.set(key, states);
        this._commonCache[key] = states;
    }

    // 层级视图标签树宽度管理
    static async getHierarchyTreeWidth() {
        const key = this.Namespace.CACHE + 'hierarchy_tree_width';
        if (this._commonCache[key]) {
            return this._commonCache[key];
        }
        const width = await this.get(key);
        this._commonCache[key] = width;
        return width || null;
    }

    static async setHierarchyTreeWidth(width) {
        const key = this.Namespace.CACHE + 'hierarchy_tree_width';
        await this.set(key, width);
        this._commonCache[key] = width;
    }
    // 层级视图展开状态管理结束
}