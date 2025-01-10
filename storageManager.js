class LocalStorageMgr {
    static Namespace = {
        BOOKMARK: 'bookmark.'
    };

    static _bookmarksCache = null;

    static async init() {
        await this.getBookmarks();
        this.setupStorageListener();
    }

    static setupStorageListener() {
        chrome.storage.onChanged.addListener(async (changes, areaName) => {
            if (areaName === 'local') {
                if (Object.keys(changes).some(key => key.startsWith('bookmark.'))) {
                    this._bookmarksCache = null;
                }   
            }
        });
    }

    // 基础存储操作
    static async get(key) {
        const result = await chrome.storage.local.get(key);
        return result[key];
    }

    static async set(key, value) {
        await chrome.storage.local.set({ [key]: value });
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
    static async getBookmarks() {
        if (this._bookmarksCache) {
            return this._bookmarksCache;
        }
        const bookmarks = await this.getKeysByPrefix(this.Namespace.BOOKMARK);
        this._bookmarksCache = bookmarks;
        return bookmarks;
    }

    static async getBookmark(id) {
        return await this.get(`${this.Namespace.BOOKMARK}${id}`);
    }

    static async setBookmark(id, bookmark) {
        await this.set(`${this.Namespace.BOOKMARK}${id}`, bookmark);
        this._bookmarksCache = null;  // 更新书签时清除缓存
    }

    static async removeBookmark(id) {
        await this.remove([`${this.Namespace.BOOKMARK}${id}`]);
        this._bookmarksCache = null;  // 删除书签时清除缓存
    }

    static async clearBookmarks() {
        await this.removeKeysByPrefix(this.Namespace.BOOKMARK);
        this._bookmarksCache = null;  // 清空书签时清除缓存
    }
}