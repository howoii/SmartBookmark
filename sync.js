class SyncManager {
    constructor() {
        this.changeManager = new LocalChangeManager(this);
        this.isSyncing = false;
        this.BATCH_SIZE = 50; // 每批同步的书签数量
    }

    async getSyncVersion() {
        return await LocalStorageMgr.get('lastSyncVersion') || 0;
    }

    async cleanup() {
        logger.info('清理同步状态');
        await this.changeManager.cleanup();
        this.isSyncing = false;
    }

    // 初始化同步
    async startSync(force = false) {
        // 如果是第一次同步(版本号为0),则需要同步所有本地书签
        const lastSyncVersion = await this.getSyncVersion();
        if (lastSyncVersion === 0) {
            await this.syncAllLocalBookmarks(force);
        }else {
            await this.syncChange(force);
        }
    }

    // 记录书签变更
    async recordBookmarkChange(bookmarks, isDeleted = false, beginSync = true) {
        // 支持单个书签或书签数组
        const bookmarkArray = Array.isArray(bookmarks) ? bookmarks : [bookmarks];

        logger.debug('记录书签变更', {
            bookmarks: bookmarkArray,
            isDeleted: isDeleted,
            beginSync: beginSync
        });
        
        const lastSyncVersion = await this.getSyncVersion();
        if (lastSyncVersion == 0 && beginSync) {
            await this.syncAllLocalBookmarks();
        } else {
            // 批量添加变更
            await this.changeManager.addChange(bookmarkArray, isDeleted);
            // 一次性同步所有变更
            if (beginSync) {
                await this.syncChange();
            }
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
                sendMessageSafely({
                    type: MessageType.START_SYNC
                });
            }
            logger.info('开始同步变更, 变更数:', changes.length);

            const lastSyncVersion = await this.getSyncVersion();
            const response = await this.syncToServer({
                lastSyncVersion: lastSyncVersion,
                changes: changes
            });

            // 处理服务器返回的变更
            await this.processServerChanges(response, changes);

            await LocalStorageMgr.set('lastSyncVersion', Date.now());

            // 清空已同步的变更
            await this.changeManager.clearChanges();

            logger.info('同步变更完成, 服务器最新版本:', response.currentVersion);
        } catch (error) {
            logger.error('同步变更失败:', error);
            throw error;
        } finally {
            await this.changeManager.mergeTempQueueToStorage();
            this.isSyncing = false;
            if (!force) {
                sendMessageSafely({
                    type: MessageType.FINISH_SYNC
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
                sendMessageSafely({
                    type: MessageType.START_SYNC
                });
            }

            // 获取所有本地书签
            const localBookmarks = await LocalStorageMgr.getBookmarks();
            
            // 转换为服务器格式的书签列表
            const changes = Object.values(localBookmarks)
                .map(bookmark => this.convertToServerFormat(bookmark));

            logger.info('开始同步所有本地书签, 书签数:', changes.length);

            // 执行同步
            const lastSyncVersion = await this.getSyncVersion();
            const response = await this.syncToServer({
                lastSyncVersion: lastSyncVersion,
                changes: changes
            });

            // 处理服务器返回的变更
            await this.processServerChanges(response, changes);
            
            await LocalStorageMgr.set('lastSyncVersion', Date.now());
            logger.info('同步本地书签完成, 服务器最新版本:', response.currentVersion);
        } catch (error) {
            logger.error('同步本地书签失败:', error);
            throw error;
        } finally {
            this.isSyncing = false;
            if (!force) {
                sendMessageSafely({
                    type: MessageType.FINISH_SYNC
                });
            }
        }
    }

    // 修改 syncToServer 方法，支持分批请求
    async syncToServer(syncData) {
        const token = await LocalStorageMgr.get('token');
        if (!token) {
            throw new Error('未登录');
        }

        const { lastSyncVersion, changes } = syncData;
        const totalChanges = changes.length;
        logger.info(`开始分批同步，总变更数: ${totalChanges}`);

        // 如果变更数量小于批量大小，直接发送
        if (totalChanges <= this.BATCH_SIZE) {
            return await this.sendSyncRequest(token, { lastSyncVersion, changes });
        }

        // 分批处理变更
        const batches = Math.ceil(totalChanges / this.BATCH_SIZE);
        let serverChanges = [];
        let maxVersion = 0;
        let syncVersion = lastSyncVersion;

        for (let i = 0; i < batches; i++) {
            const start = i * this.BATCH_SIZE;
            const end = Math.min(start + this.BATCH_SIZE, totalChanges);
            const batchChanges = changes.slice(start, end);

            logger.info(`发送第 ${i + 1}/${batches} 批变更，数量: ${batchChanges.length}`);

            const response = await this.sendSyncRequest(token, {
                lastSyncVersion: syncVersion,
                changes: batchChanges,
                isBatchSync: true,
                batchInfo: {
                    current: i + 1,
                    total: batches
                }
            });
            
            logger.debug('服务器返回结果:', response);

            // 合并服务器返回的变更
            if (response.changes) {
                serverChanges = serverChanges.concat(response.changes);
            }

            // 更新最大版本号
            if (response.currentVersion > maxVersion) {
                maxVersion = response.currentVersion;
            }

            // 更新同步版本
            syncVersion = response.currentVersion;

            // 添加小延迟，避免请求过于频繁
            await sleep(200);
        }

        logger.info(`分批同步完成，合并后的变更数: ${serverChanges.length}`);

        // 返回合并后的结果
        return {
            currentVersion: maxVersion,
            changes: serverChanges
        };
    }

    // 新增发送同步请求的辅助方法
    async sendSyncRequest(token, requestData) {
        logger.debug('发送同步请求:', requestData);

        const response = await fetch(`${SERVER_URL}/api/bookmarks/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(requestData)
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
                    await LocalStorageMgr.remove(['token']);
                    throw new Error('登录已过期，请重新登录');
                default:
                    let errorMessage = `${response.status} ${response.statusText || '未知错误'}`;
                    try {
                        const errorBody = await response.json();
                        errorMessage = `${errorBody.error || '未知错误'}`;
                    } catch (error) {
                        logger.error('获取错误信息失败:', error);
                    }
                    throw new Error(errorMessage);
            }
        } catch (error) {
            if (error.name === 'SyntaxError') {
                throw new Error('响应格式错误');
            }
            throw error;
        }
    }

    // 处理服务器返回的变更
    async processServerChanges(response, localChanges) {     
        logger.debug('服务器返回的变更:', response);

        const { changes } = response;
        let hasChanges = false;
        
        logger.info('处理服务器变更 - 数量:', changes.length);

        // 批量处理的缓存
        const batchSize = 100; // 每批处理的数量
        const bookmarksToSave = new Map(); // 需要保存的书签
        const urlsToDelete = new Set(); // 需要删除的书签URL

        // 创建本地变更版本的映射，用于快速查找
        const localVersionMap = new Map(
            localChanges.map(change => [change.content.url, change.version])
        );

        // 首先处理所有变更，但不立即写入存储
        for (const serverBookmark of changes) {
            const bookmarkUrl = serverBookmark.content.url;
            const serverVersion = serverBookmark.version;
            const localVersion = localVersionMap.get(bookmarkUrl) || 0;

            logger.debug('处理服务器变更:', {
                url: bookmarkUrl,
                serverVersion,
                localVersion,
                isDeleted: serverBookmark.isDeleted
            });

            // 只有当服务器版本大于本地版本时才应用变更
            if (serverVersion > localVersion) {
                const localBookmark = await LocalStorageMgr.getBookmark(bookmarkUrl);
                const updatedBookmark = this.convertToLocalFormat(serverBookmark, localBookmark);
                
                if (serverBookmark.isDeleted) {
                    if (localBookmark) {
                        urlsToDelete.add(updatedBookmark.url);
                        hasChanges = true;
                        logger.debug('将删除书签:', bookmarkUrl, '(服务器版本更新)');
                    }
                } else {
                    bookmarksToSave.set(updatedBookmark.url, updatedBookmark);
                    hasChanges = true;
                    logger.debug('将更新书签:', bookmarkUrl, '(服务器版本更新)');
                }
            } else {
                logger.debug('跳过书签更新:', bookmarkUrl, '(本地版本更新或相同)');
            }
        }

        logger.info('处理服务器变更 - 最终结果:', {
            待保存数量: bookmarksToSave.size,
            待删除数量: urlsToDelete.size
        });

        // 批量处理删除操作
        if (urlsToDelete.size > 0) {
            // 将Set转换为数组
            const urlsArray = Array.from(urlsToDelete);
            for (let i = 0; i < urlsArray.length; i += batchSize) {
                const batch = urlsArray.slice(i, i + batchSize);
                logger.debug(`批量删除书签 ${i + 1}-${i + batch.length}/${urlsArray.length}`);
                await LocalStorageMgr.removeBookmarks(batch);
            }
        }

        // 批量处理保存操作
        if (bookmarksToSave.size > 0) {
            // 将Map转换为数组
            const bookmarksArray = Array.from(bookmarksToSave.values());
            for (let i = 0; i < bookmarksArray.length; i += batchSize) {
                const batch = bookmarksArray.slice(i, i + batchSize);
                logger.debug(`批量保存书签 ${i + 1}-${i + batch.length}/${bookmarksArray.length}`);
                await LocalStorageMgr.setBookmarks(batch);
            }
        }

        // 如果有变更，通知更新书签列表
        if (hasChanges) {
            sendMessageSafely({
                type: MessageType.BOOKMARKS_UPDATED,
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
                apiService: localBookmark.apiService,
                embedModel: localBookmark.embedModel
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
            embedModel: serverBookmark.content.embedModel,
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
    async addChange(bookmarks, isDeleted = false) {
        // 统一转换为数组处理
        const bookmarkArray = Array.isArray(bookmarks) ? bookmarks : [bookmarks];
        
        // 如果是空数组则直接返回
        if (bookmarkArray.length === 0) return;
        
        // 生成所有变更记录
        const changeEntries = bookmarkArray.map(bookmark => {
            const change = {
                timestamp: Date.now(),
                change: this.syncManager.convertToServerFormat(bookmark, isDeleted)
            };
            return [bookmark.url, change];
        });

        if (this.syncManager.isSyncing) {
            // 如果正在同步，添加到临时队列
            changeEntries.forEach(([url, change]) => {
                this.tempQueue.set(url, change);
            });
            logger.info('同步进行中，批量变更已添加到临时队列，数量:', bookmarkArray.length);
        } else {
            // 如果没有同步，直接添加到存储
            const changes = await this.getPendingChanges();
            changeEntries.forEach(([url, change]) => {
                changes[url] = change;
            });
            await LocalStorageMgr.set(this.STORAGE_KEY, changes);
            logger.info('批量变更已保存到存储，数量:', bookmarkArray.length);
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

const syncManager = new SyncManager();