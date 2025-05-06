class LocalStorageMgr {
    static Namespace = {
        BOOKMARK: 'bookmark.',
        TAGCACHE: 'tagcache',
        BOOKMARK_CACHE: 'bookmark_cache'
    };

    static _bookmarksCache = null;
    static _debounceTimer = null;
    static _bookmarksLocalCache = null;
    static _bookmarkCacheUpdateTimer = null;
    static DEBOUNCE_DELAY = 2000; // 2000毫秒的防抖延迟
    static BOOKMARK_CACHE_UPDATE_DELAY = 4000; // 4000毫秒的更新间隔

    static async init() {
        await this.getBookmarks();
        this.setupListener();
    }

    // 初始化本地缓存，不需要监听变化，因为只有第一次加载时需要
    static async initLocalCache() {
        await this.getBookmarksFromLocalCache();
    }

    static sendMessageSafely(message, callback = null) {
        message.env = EnvIdentifier;
        chrome.runtime.sendMessage(message, (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
                logger.debug('消息处理失败:', {
                    error: lastError.message,
                    message: message
                });
            }
            if (callback) {
                callback(response);
            }
        });
    }

    // 防抖函数
    static async _debouncedUpdateBookmarks() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }

        this._bookmarksCache = null;
        return new Promise((resolve) => {
            this._debounceTimer = setTimeout(async () => {
                await this.getBookmarks();
                resolve();
            }, this.DEBOUNCE_DELAY);
        });
    }

    static setupListener() {
        chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
            if (message.type === MessageType.BOOKMARK_STORAGE_UPDATED) {
                // 使用防抖处理
                this._debouncedUpdateBookmarks();
            }
        });
    }

    // 基础存储操作
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

    // 书签相关操作
    static getBookmarkKey(url) {
        return `${this.Namespace.BOOKMARK}${url}`;
    }

    static async getBookmarks() {
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

    static async setBookmark(url, bookmark) {
        const key = this.getBookmarkKey(url);
        await this.set(key, bookmark);
        // 更新缓存
        if (this._bookmarksCache) {
            this._bookmarksCache[key] = bookmark;
        }
        this.sendMessageSafely({
            type: MessageType.BOOKMARK_STORAGE_UPDATED,
        });
        this.triggerBookmarkCacheUpdate();
    }

    static async setBookmarks(bookmarks) {
        if (bookmarks.length === 0) {
            return;
        }
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
        this.sendMessageSafely({
            type: MessageType.BOOKMARK_STORAGE_UPDATED,
        });
        this.triggerBookmarkCacheUpdate();
    }

    static async removeBookmark(url) {
        const key = this.getBookmarkKey(url);
        await this.remove([key]);
        // 更新缓存
        if (this._bookmarksCache) {
            delete this._bookmarksCache[key];
        }
        this.sendMessageSafely({
            type: MessageType.BOOKMARK_STORAGE_UPDATED,
        });
        this.triggerBookmarkCacheUpdate();
    }

    static async removeBookmarks(urls) {
        const keys = urls.map(url => this.getBookmarkKey(url));
        await this.remove(keys);
        // 更新缓存
        if (this._bookmarksCache) {
            for (const key of keys) {
                delete this._bookmarksCache[key];
            }
        }
        this.sendMessageSafely({
            type: MessageType.BOOKMARK_STORAGE_UPDATED,
        });
        this.triggerBookmarkCacheUpdate();
    }

    static async clearBookmarks() {
        await this.removeKeysByPrefix(this.Namespace.BOOKMARK);
        if (this._bookmarksCache) {
            this._bookmarksCache = {};  // 清空书签时清除缓存
        }
        this.sendMessageSafely({
            type: MessageType.BOOKMARK_STORAGE_UPDATED,
        });
        this.triggerBookmarkCacheUpdate();
    }

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

    static scheduleBookmarkCacheUpdate() {
        logger.debug('4s后开始更新书签缓存');
        if (this._bookmarkCacheUpdateTimer) {
            clearTimeout(this._bookmarkCacheUpdateTimer);
        }
        this._bookmarkCacheUpdateTimer = setTimeout(async () => {
            await this.updateBookmarkCache();
        }, this.BOOKMARK_CACHE_UPDATE_DELAY);
    }

    static async updateBookmarkCache() {
        logger.debug('开始更新书签缓存');
        let bookmarks = await this.getBookmarksList();
        bookmarks = bookmarks.map(bookmark => {
            return {
                ...bookmark,
                apiService: undefined,
                embedModel: undefined,
                embedding: undefined
            };
        });
        await this.set(this.Namespace.BOOKMARK_CACHE, bookmarks);
        this._bookmarksLocalCache = null;
    }

    static triggerBookmarkCacheUpdate() {
        logger.debug('触发书签缓存更新');
        if (EnvIdentifier === 'background') {
            this.scheduleBookmarkCacheUpdate();
        } else {
            this.sendMessageSafely({
                type: MessageType.TRIGGER_BOOKMARK_CACHE_UPDATE,
            });
        }
    }

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
}