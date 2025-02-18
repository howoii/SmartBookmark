class LocalStorageMgr {
    static Namespace = {
        BOOKMARK: 'bookmark.',
        TAGCACHE: 'tagcache'
    };

    static _bookmarksCache = null;
    static _debounceTimer = null;
    static DEBOUNCE_DELAY = 300; // 300毫秒的防抖延迟

    static async init() {
        await this.getBookmarks();
        this.setupListener();
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

    static async set(key, value) {
        await this.setObject({ [key]: value })
    }

    static async setObject(object) {
        await chrome.storage.local.set(object);
    }

    static async remove(keys) {
        await chrome.storage.local.remove(keys);
    }

    static async getKeysByPrefix(prefix) {
        const allData = await chrome.storage.local.get(null);
        return Object.entries(allData)
            .filter(([key]) => key.startsWith(prefix))
            .reduce((obj, [key, value]) => {
                obj[key] = value;
                return obj;
            }, {});
    }

    static async removeKeysByPrefix(prefix) {
        const allData = await chrome.storage.local.get(null);
        const keysToRemove = Object.keys(allData).filter(key => key.startsWith(prefix));
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
        }
    }

    // 书签相关操作
    static getBookmarkKey(url) {
        return `${this.Namespace.BOOKMARK}${url}`;
    }

    static async getBookmarks() {
        logger.debug('开始获取书签', Date.now()/1000);
        if (this._bookmarksCache) {
            logger.debug('书签缓存命中', Date.now()/1000);
            return this._bookmarksCache;
        }
        const bookmarks = await this.getKeysByPrefix(this.Namespace.BOOKMARK);
        logger.debug('书签缓存未命中', Date.now()/1000);
        this._bookmarksCache = bookmarks;
        return bookmarks;
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
    }

    static async setBookmarks(bookmarks) {
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
    }

    static async clearBookmarks() {
        await this.removeKeysByPrefix(this.Namespace.BOOKMARK);
        if (this._bookmarksCache) {
            this._bookmarksCache = {};  // 清空书签时清除缓存
        }
        this.sendMessageSafely({
            type: MessageType.BOOKMARK_STORAGE_UPDATED,
        });
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
}