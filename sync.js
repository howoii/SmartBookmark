class SyncManager {
    constructor() {
        this.lastSyncVersion = 0;
        this.changeManager = new LocalChangeManager(this);
        this.isSyncing = false;
    }

    sendMessageSafely(message) {
        chrome.runtime.sendMessage(message, () => {
            const lastError = chrome.runtime.lastError;
        });
    }

    async init() {
        this.lastSyncVersion = await LocalStorageMgr.get('lastSyncVersion') || 0;
    }

    async cleanup() {
        logger.info('清理同步状态');
        this.lastSyncVersion = 0;
        await this.changeManager.cleanup();
        this.isSyncing = false;
    }

    // 初始化同步
    async forceSync() {
        // 如果是第一次同步(版本号为0),则需要同步所有本地书签
        if (this.lastSyncVersion === 0) {
            await this.syncAllLocalBookmarks(true);
        }else {
            await this.syncChange(true);
        }
    }

    // 记录书签变更
    async recordBookmarkChange(bookmarks, isDeleted = false) {
        // 支持单个书签或书签数组
        const bookmarkArray = Array.isArray(bookmarks) ? bookmarks : [bookmarks];

        if (this.lastSyncVersion == 0) {
            await this.syncAllLocalBookmarks();
        } else {
            // 批量添加变更
            for (const bookmark of bookmarkArray) {
                await this.changeManager.addChange(bookmark, isDeleted);
            }
            // 一次性同步所有变更
            await this.syncChange();
        }
    }

    // 检查是否可以同步
    async canSync() {
        const online = navigator.onLine;
        if (!online) {
            return false;
        }

        const {valid} = await validateToken();
        return valid;
    }

    // 同步本地修改
    async syncChange(force = false) {
        if (this.isSyncing) {
            throw new Error('同步正在进行中');
        }
        
        try {
            if (!await this.canSync()) {
                logger.warn('无法同步: 离线或未登录');
                if (force) {
                    throw new Error('无法同步: 离线或未登录');
                }else {
                    return
                }
            }

            const pendingChanges = await this.changeManager.getPendingChanges();
            const changes = Object.values(pendingChanges).map(item => item.change);
            
            if (changes.length === 0 && !force) {
                logger.info('没有待同步的变更');
                return;
            }

            this.isSyncing = true;
            if (!force) {
                this.sendMessageSafely({
                    type: 'START_SYNC'
                });
            }
            logger.info('开始同步变更, 变更数:', changes.length);

            const response = await this.syncToServer({
                lastSyncVersion: this.lastSyncVersion,
                changes: changes
            });

            // 处理服务器返回的变更
            await this.processServerChanges(response);

            // 更新最后同步版本
            let syncVersion = response.currentVersion;
            if (syncVersion == 0) {
                syncVersion = Date.now();
            }else if (syncVersion < this.lastSyncVersion) {
                logger.info('服务器返回的版本号小于本地版本号，使用本地版本号');
                syncVersion = this.lastSyncVersion;
            }

            await LocalStorageMgr.set('lastSyncVersion', syncVersion);
            this.lastSyncVersion = syncVersion;

            // 清空已同步的变更
            await this.changeManager.clearChanges();

            logger.info('同步变更完成, 最新版本:', syncVersion);
        } catch (error) {
            logger.error('同步变更失败:', error);
            throw error;
        } finally {
            await this.changeManager.mergeTempQueueToStorage();
            this.isSyncing = false;
            if (!force) {
                this.sendMessageSafely({
                    type: 'FINISH_SYNC'
                });
            }
        }
    }

    // 同步所有本地书签
    async syncAllLocalBookmarks(force=false) {
        logger.info('同步本地书签');

        if (this.isSyncing) {
            logger.warn('同步正在进行中');
            throw new Error('同步正在进行中');
        }

        try {
            if (!await this.canSync()) {
                logger.warn('无法同步: 离线或未登录');
                if (force) {
                    throw new Error('无法同步: 离线或未登录');
                }else {
                    return
                }
            }

            this.isSyncing = true;
            if (!force) {
                this.sendMessageSafely({
                    type: 'START_SYNC'
                });
            }

            // 获取所有本地书签
            const localBookmarks = await LocalStorageMgr.getBookmarks();
            
            // 转换为服务器格式的书签列表
            const changes = Object.values(localBookmarks)
                .map(bookmark => this.convertToServerFormat(bookmark));

            logger.info('开始同步所有本地书签, 书签数:', changes.length);

            // 执行同步
            const response = await this.syncToServer({
                lastSyncVersion: this.lastSyncVersion,
                changes: changes
            });

            // 处理服务器返回的变更
            await this.processServerChanges(response);

            // 更新最后同步版本
            let syncVersion = response.currentVersion;
            if (syncVersion == 0) {
                syncVersion = Date.now();
            }else if (syncVersion < this.lastSyncVersion) {
                logger.info('服务器返回的版本号小于本地版本号，使用本地版本号');
                syncVersion = this.lastSyncVersion;
            }

            await LocalStorageMgr.set('lastSyncVersion', syncVersion);
            this.lastSyncVersion = syncVersion;

            logger.info('同步本地书签完成, 最新版本:', syncVersion);
        } catch (error) {
            logger.error('同步本地书签失败:', error);
            throw error;
        } finally {
            this.isSyncing = false;
            if (!force) {
                this.sendMessageSafely({
                    type: 'FINISH_SYNC'
                });
            }
        }
    }

    // 发送同步请求到服务器
    async syncToServer(syncData) {
        const token = await LocalStorageMgr.get('token');
        if (!token) {
            throw new Error('未登录');
        }
        
        logger.debug('同步请求数据:', syncData);

        const response = await fetch(`${SERVER_URL}/api/bookmarks/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(syncData)
        });

        return await this.checkResponseError(response);
    }

    async checkResponseError(response) {
        try {
            if (response.ok) {
                const responseBody = await response.json();
                return responseBody;
            }
    
            // 处理特定的错误状态码
            switch (response.status) {
                case 401:
                    // token过期，清除登录状态
                    await LocalStorageMgr.remove(['token', 'user']);
                    throw new Error('登录已过期，请重新登录');
                default:
                    throw new Error(`${response.status} ${response.statusText || '未知错误'}`);
            }
        } catch (error) {
            if (error.name === 'SyntaxError') {
                throw new Error('响应格式错误');
            }
            throw error;
        }
    }

    // 处理服务器返回的变更
    async processServerChanges(response) {     
        logger.debug('服务器返回的变更:', response);

        const { changes } = response;
        let hasChanges = false;
        
        logger.info('处理服务器变更 - 数量:', changes.length);
        for (const serverBookmark of changes) {
            logger.debug('处理服务器变更 - URL:', serverBookmark.content.url, 
                '版本:', serverBookmark.version, 
                '删除状态:', serverBookmark.isDeleted);
                
            const localBookmark = await LocalStorageMgr.getBookmark(serverBookmark.content.url);
            const updatedBookmark = this.convertToLocalFormat(serverBookmark, localBookmark);
            
            if (serverBookmark.isDeleted) {
                if (localBookmark) {
                    // 处理删除的书签
                    logger.debug('删除本地书签:', updatedBookmark.url);
                    await LocalStorageMgr.removeBookmark(updatedBookmark.url);
                    hasChanges = true;
                }else {
                    logger.debug('本地书签不存在:', updatedBookmark.url);
                }
            } else {
                // 更新或新增书签
                logger.debug('保存本地书签:', updatedBookmark.url);
                await LocalStorageMgr.setBookmark(updatedBookmark.url, updatedBookmark);
                hasChanges = true;
            }
        }
    
        // 如果有变更，通知更新书签列表
        if (hasChanges) {
            // 发送消息给 popup 和 background
            chrome.runtime.sendMessage({
                type: 'BOOKMARKS_UPDATED',
                source: 'sync'
            });
        }
    }

    // 转换为服务器格式
    convertToServerFormat(localBookmark, isDeleted = false) {
        return {
            content: {
                url: localBookmark.url,
                title: localBookmark.title,
                tags: localBookmark.tags || [],
                excerpt: localBookmark.excerpt || '',
                embedding: localBookmark.embedding,
                savedAt: localBookmark.savedAt ? (typeof localBookmark.savedAt === 'number' ? localBookmark.savedAt : new Date(localBookmark.savedAt).getTime()) : 0,
                apiService: localBookmark.apiService
            },
            version: Date.now(),
            isDeleted: isDeleted
        };
    }

    // 转换为本地格式
    convertToLocalFormat(serverBookmark, localBookmark) {
        return {
            url: serverBookmark.content.url,
            title: serverBookmark.content.title,
            tags: serverBookmark.content.tags || [],
            excerpt: serverBookmark.content.excerpt || '',
            embedding: serverBookmark.content.embedding,
            savedAt: serverBookmark.content.savedAt ? new Date(serverBookmark.content.savedAt).toISOString() : new Date().toISOString(),
            apiService: serverBookmark.content.apiService,
            lastUsed: localBookmark?.lastUsed ? localBookmark.lastUsed : null,
            useCount: localBookmark?.useCount || 0
        };
    }
}

class LocalChangeManager {
    constructor(syncManager) {
        this.syncManager = syncManager;
        this.STORAGE_KEY = 'pendingChanges';
        this.tempQueue = new Map(); // 添加临时队列
    }

    async cleanup() {
        this.tempQueue.clear();
        await this.clearChanges();
    }

    // 获取待同步的变更列表
    async getPendingChanges() {
        const changes = await LocalStorageMgr.get(this.STORAGE_KEY) || {};
        return changes;
    }

    // 添加一个变更到列表
    async addChange(bookmark, isDeleted = false) {
        const change = {
            timestamp: Date.now(),
            change: this.syncManager.convertToServerFormat(bookmark, isDeleted)
        };

        if (this.syncManager.isSyncing) {
            // 如果正在同步，添加到临时队列
            this.tempQueue.set(bookmark.url, change);
            logger.info('同步进行中，变更已添加到临时队列:', bookmark.url);
        } else {
            // 如果没有同步，直接添加到存储
            const changes = await this.getPendingChanges();
            changes[bookmark.url] = change;
            await LocalStorageMgr.set(this.STORAGE_KEY, changes);
        }
    }

    // 移除一个变更
    async removeChange(url) {
        const changes = await this.getPendingChanges();
        delete changes[url];
        await LocalStorageMgr.set(this.STORAGE_KEY, changes);
    }

    // 清空变更列表
    async clearChanges() {
        await LocalStorageMgr.set(this.STORAGE_KEY, {});
    }

    async mergeTempQueueToStorage() {
        // 处理临时队列中的变更
        if (this.tempQueue.size > 0) {
            logger.info('处理临时队列中的变更，数量:', this.tempQueue.size);
            const changes = {};
            for (const [url, change] of this.tempQueue.entries()) {
                changes[url] = change;
            }
            await LocalStorageMgr.set(this.STORAGE_KEY, changes);
            this.tempQueue.clear();
        }
    }

    // 获取变更列表大小
    async getChangeCount() {
        const changes = await this.getPendingChanges();
        return Object.keys(changes).length;
    }
}