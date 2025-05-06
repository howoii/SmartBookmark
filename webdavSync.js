/**
 * WebDAV 同步管理类
 * 处理数据同步和冲突解决
 */

// 数据文件名
const BOOKMARKS_FILE = 'data.json.gz'; // 书签数据文件
const CONFIG_FILE = 'config.json';    // 配置数据文件
const META_FILE = 'meta.json';        // 元数据文件

/**
 * 计算字符串的哈希值
 * @param {string} str - 要计算的字符串
 * @returns {Promise<string>} 哈希值
 */
async function calculateMD5(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

/**
 * 压缩JSON数据
 * @param {Object} data - 要压缩的JSON数据
 * @returns {Promise<Uint8Array>} 压缩后的数据
 */
async function compressData(data) {
    // 将数据转换为JSON字符串
    const jsonString = JSON.stringify(data);
    // 创建文本编码器
    const encoder = new TextEncoder();
    // 将字符串转换为Uint8Array
    const uint8Array = encoder.encode(jsonString);
    
    // 使用CompressionStream进行GZIP压缩
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();
    
    // 写入数据
    writer.write(uint8Array);
    writer.close();
    
    // 读取压缩结果
    const chunks = [];
    let done, value;
    while (({done, value} = await reader.read(), !done)) {
        chunks.push(value);
    }
    
    // 合并结果
    const totalLength = chunks.reduce((acc, val) => acc + val.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    
    return result;
}

/**
 * 解压缩数据
 * @param {Uint8Array} compressedData - 压缩的数据
 * @returns {Promise<Object>} 解压后的JSON对象
 */
async function decompressData(compressedData) {
    // 使用DecompressionStream进行解压
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    
    // 写入压缩数据
    writer.write(compressedData);
    writer.close();
    
    // 读取解压结果
    const chunks = [];
    let done, value;
    while (({done, value} = await reader.read(), !done)) {
        chunks.push(value);
    }
    
    // 合并结果
    const totalLength = chunks.reduce((acc, val) => acc + val.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    
    // 解码为字符串
    const decoder = new TextDecoder();
    const jsonString = decoder.decode(result);
    
    // 解析JSON
    return JSON.parse(jsonString);
}

/**
 * WebDAV同步管理器类
 */
class WebDAVSyncManager {
    /**
     * 创建同步管理器
     * @param {Object} config - 配置信息
     */
    constructor(config) {
        const { url, username, password, folder } = config.server;
        this.client = new WebDAVClient(url, username, password);
        this.folder = folder;
        this.syncConfig = config;
    }

    /**
     * 获取文件路径
     * @param {string} fileName - 文件名
     * @returns {string} 完整路径
     */
    getPath(fileName) {
        const folder = this.folder.endsWith('/') ? this.folder : `${this.folder}/`;
        return `${folder}${fileName}`;
    }

    /**
     * 生成空的元数据结构
     * @returns {Object} 元数据结构
     */
    createEmptyMetadata() {
        return {
            syncAt: new Date().getTime(),
            bookmarks: null,
            config: {
                settings: null,
                filters: null,
                services: null,
                lastModified: new Date().getTime(),
            }
        };
    }

    /**
     * 获取远程元数据
     * @returns {Promise<Object>} 元数据对象
     */
    async getRemoteMetadata() {
        try {
            const metaPath = this.getPath(META_FILE);
            const exists = await this.client.fileExists(metaPath);
            
            if (!exists) {
                return null;
            }
            
            const metaContent = await this.client.downloadFile(metaPath);
            return JSON.parse(metaContent);
        } catch (error) {
            throw error;
        }
    }

    /**
     * 获取本地书签数据
     * @param {boolean} syncEmbeddings - 是否同步嵌入向量
     * @returns {Promise<Object>} 本地书签数据
     */
    async getLocalBookmarksData(syncEmbeddings=true) {
        const localData = {
            version: chrome.runtime.getManifest().version,
            createAt: new Date().toISOString(),
            data: {}
        };
        
        try {
            // 获取书签数据
            if (this.syncConfig.syncData.bookmarks) {
                localData.data.bookmarks = await LocalStorageMgr.getBookmarksList();
                if (!syncEmbeddings) {
                    // 不同步书签的向量数据
                    localData.data.bookmarks = localData.data.bookmarks.map(bookmark => {
                        return {
                            ...bookmark,
                            embedding: null
                        };
                    });
                }
            }
            
            return localData;
        } catch (error) {
            logger.error('获取本地书签数据失败:', error);
            throw error;
        }
    }

    /**
     * 获取本地配置数据
     * @returns {Promise<Object>} 本地配置数据
     */
    async getLocalConfigData() {
        const localData = {
            version: chrome.runtime.getManifest().version,
            createAt: new Date().toISOString(),
            data: {}
        };
        
        try {
            const syncData = this.syncConfig.syncData;
            
            // 获取设置数据
            if (syncData.settings) {
                localData.data.settings = await SettingsManager.getAll();
                localData.data.configs = await ConfigManager.getConfigExportData();
            }
            
            // 获取过滤器数据
            if (syncData.filters) {
                localData.data.filters = await customFilter.getExportData();
            }
            
            // 获取API服务设置
            if (syncData.services) {
                localData.data.apiServices = await ConfigManager.getServiceExportData();
            }
            
            return localData;
        } catch (error) {
            logger.error('获取本地配置数据失败:', error);
            throw error;
        }
    }

    /**
     * 计算本地书签数据的元数据
     * @param {Object} bookmarksData - 本地书签数据
     * @returns {Promise<Object>} 元数据
     */
    async calculateBookmarksMetadata(bookmarksData) {
        const metadata = this.createEmptyMetadata();
        const now = new Date().getTime();
        
        try {
            // 计算书签数据的MD5
            if (bookmarksData.data.bookmarks) {
                // 先对书签按url进行排序，以保证md5值一致
                const sortedBookmarks = bookmarksData.data.bookmarks.sort((a, b) => a.url.localeCompare(b.url));
                const bookmarksJson = JSON.stringify(sortedBookmarks.map(bookmark => this.getBookmarkMeta(bookmark)));
                metadata.bookmarks = {
                    md5: await calculateMD5(bookmarksJson),
                    lastModified: now
                };
            }
            
            metadata.syncAt = now;
            return metadata;
        } catch (error) {
            logger.error('计算书签元数据失败:', error);
            throw error;
        }
    }

    /**
     * 计算本地配置数据的元数据
     * @param {Object} configData - 本地配置数据
     * @returns {Promise<Object>} 元数据
     */
    async calculateConfigMetadata(configData) {
        const metadata = this.createEmptyMetadata();
        const now = new Date().getTime();
        
        try {
            // 计算设置数据的MD5
            if (configData.data.settings) {
                const settingsJson = JSON.stringify({
                    settings: configData.data.settings,
                    configs: configData.data.configs
                });
                metadata.config.settings = {
                    md5: await calculateMD5(settingsJson),
                };
            }
            
            // 计算过滤器数据的MD5
            if (configData.data.filters) {
                const filtersJson = JSON.stringify(configData.data.filters);
                metadata.config.filters = {
                    md5: await calculateMD5(filtersJson),
                };
            }
            
            // 计算API服务设置的MD5
            if (configData.data.apiServices) {
                const servicesJson = JSON.stringify(configData.data.apiServices);
                metadata.config.services = {
                    md5: await calculateMD5(servicesJson),
                };
            }
            
            metadata.config.lastModified = now;
            metadata.syncAt = now;
            return metadata;
        } catch (error) {
            logger.error('计算配置元数据失败:', error);
            throw error;
        }
    }

    /**
     * 获取远程数据 (支持压缩)
     * @returns {Promise<Object>} 远程数据
     */
    async getRemoteData(metadata) {
        try {
            const dataPath = this.getPath(BOOKMARKS_FILE);
            const exists = await this.client.fileExists(dataPath);
            
            if (!exists) {
                return null;
            }
            
            // 下载数据文件
            const dataContent = await this.client.downloadFile(dataPath, true);
            
            // 处理压缩数据
            return await decompressData(dataContent);
        } catch (error) {
            logger.error('获取远程书签数据失败:', error);
            return null;
        }
    }

    /**
     * 获取远程配置数据
     * @returns {Promise<Object>} 远程配置数据
     */
    async getRemoteConfigData() {
        try {
            const configPath = this.getPath(CONFIG_FILE);
            const exists = await this.client.fileExists(configPath);
            
            if (!exists) {
                return null;
            }
            
            // 下载配置文件
            const configContent = await this.client.downloadFile(configPath);
            
            // 解析JSON
            return JSON.parse(configContent);
        } catch (error) {
            logger.error('获取远程配置数据失败:', error);
            return null;
        }
    }

    /**
     * 保存远程数据
     * @param {Object} data - 数据对象
     * @param {Object} metadata - 元数据对象
     * @returns {Promise<boolean>} 是否成功
     */
    async saveRemoteData(data, metadata) {
        try {
            metadata.bookmarks.device = await getDeviceInfo();

            // 压缩数据
            const compressedData = await compressData(data);
            
            // 保存压缩数据文件 (使用二进制模式)
            await this.client.uploadFile(this.getPath(BOOKMARKS_FILE), compressedData, {
                'Content-Type': 'application/gzip'
            });
            
            // 保存元数据文件
            const metaJson = JSON.stringify(metadata);
            await this.client.uploadFile(this.getPath(META_FILE), metaJson, {
                'Content-Type': 'application/json'
            });
            
            return true;
        } catch (error) {
            logger.error('保存远程书签数据失败:', error);
            throw error;
        }
    }

    /**
     * 保存远程配置数据
     * @param {Object} configData - 配置数据对象
     * @param {Object} metadata - 元数据对象
     * @returns {Promise<boolean>} 是否成功
     */
    async saveRemoteConfigData(configData, metadata) {
        try {
            metadata.config.device = await getDeviceInfo();

            // 将配置数据转换为JSON字符串
            const configJson = JSON.stringify(configData);
            
            // 保存配置文件
            await this.client.uploadFile(this.getPath(CONFIG_FILE), configJson, {
                'Content-Type': 'application/json'
            });
            
            // 更新元数据
            const metaJson = JSON.stringify(metadata);
            await this.client.uploadFile(this.getPath(META_FILE), metaJson, {
                'Content-Type': 'application/json'
            });
            
            return true;
        } catch (error) {
            logger.error('保存远程配置数据失败:', error);
            throw error;
        }
    }

    /**
     * 导入书签数据
     * @param {Array} bookmarks - 书签数据
     * @param {boolean} overwrite - 是否覆盖本地数据
     * @returns {Promise<boolean>} 是否成功
     */
    async importBookmarks(bookmarks, overwrite=false) {
        try {
            if (!bookmarks || !this.syncConfig.syncData.bookmarks) {
                return false;
            }

            const localBookmarks = await LocalStorageMgr.getBookmarksList();
            const diffResult = this.diffBookmarks(localBookmarks, bookmarks);
            logger.debug('同步书签差异', diffResult);
            
            if (overwrite) {
                if (diffResult.added.length > 0 || diffResult.updated.length > 0) {
                    const bookmarks = diffResult.added.concat(diffResult.updated);
                    await LocalStorageMgr.setBookmarks(bookmarks);
                }
                if (diffResult.removed.length > 0) {
                    await LocalStorageMgr.removeBookmarks(diffResult.removed);
                }
            } else {
                const bookmarks = diffResult.added.concat(diffResult.updated);
                if (bookmarks.length > 0) {
                    await LocalStorageMgr.setBookmarks(bookmarks);
                }
            }

            // 发送书签更新消息
            sendMessageSafely({
                type: MessageType.BOOKMARKS_UPDATED,
                source: 'import_from_webdav'
            });
            
            return true;
        } catch (error) {
            logger.error('导入书签数据失败:', error);
            throw error;
        }
    }

    /**
     * 导入配置数据
     * @param {Object} configData - 配置数据
     * @param {boolean} overwrite - 是否覆盖本地数据
     * @returns {Promise<boolean>} 是否成功
     */
    async importConfigData(configData, overwrite=false) {
        try {
            // 导入设置
            if (configData.settings && this.syncConfig.syncData.settings) {
                if (overwrite) {
                    await SettingsManager.reset();
                }
                await SettingsManager.update(configData.settings);
                await ConfigManager.importConfigData(configData.configs, overwrite);
            }
            
            // 导入过滤器
            if (configData.filters && this.syncConfig.syncData.filters) {
                await customFilter.importFilters(configData.filters, overwrite);
            }
            
            // 导入API服务设置
            if (configData.apiServices && this.syncConfig.syncData.services) {
                await ConfigManager.importServiceData(configData.apiServices, overwrite);
            }
            
            return true;
        } catch (error) {
            logger.error('导入配置数据失败:', error);
            throw error;
        }
    }

    /**
     * 同步逻辑简述：
     * 我们假设
     * 1. 服务器数据永远是最新的（即所有本地修改都会在可接受的延迟内同步到服务器）
     * 2. 用户没有并发操作，即不存在两个客户端同时修改并同时同步的情况，所有操作都是串行进行。
     * 基于这个假设，同步流程分为两种操作：下拉同步和推送同步
     * 下拉同步：
     * 根据配置每隔一段时间执行一次同步，用远程数据覆盖本地数据
     * 推送同步：
     * 每次本地数据发生变化后自动执行，确保本地数据与远程数据一致
     * 一个理想的操作流程：客户端1本地修改->推送同步->客户端2下拉同步->覆盖本地数据->客户端2本地修改->推送同步...
     * 
     * 冲突处理策略：
     * 主要用于解决非并发操作时导致的数据冲突，我们假设这种情况比较少见，所以冲突处理策略比较简单
     * 分为三种策略，可以配置：
     * 1. 本地优先：本地数据优先，远程数据覆盖本地数据
     * 2. 远程优先：远程数据优先，本地数据覆盖远程数据
     * 3. 合并：合并本地数据和远程数据
     * 如何认定是并发操作？
     * 1. 本地数据的md5与本地上次同步时的md5不同（本地数据被修改）
     * 且 2. 本地记录的上次同步的远程时间戳与远程数据的syncAt不同（远程数据被修改）
     * 
     * @returns {Promise<Object>} 同步结果
     */
    async sync() {
        try {
            const syncStrategy = this.syncConfig.syncStrategy;

            // 获取远程元数据
            const remoteMetadata = await this.getRemoteMetadata();

            const syncStatus = await SyncStatusManager.getServiceStatus('webdav');
            
            // 创建同步结果对象
            const result = {
                lastSync: new Date().getTime(),
                lastSyncResult: 'success',
                metadata: syncStatus.metadata || {}
            };
            
            // 如果远程没有元数据，创建新的元数据
            if (!remoteMetadata) {
                logger.info("远程没有元数据，执行首次上传");
                const fullResult = await this.syncFullData(null, syncStrategy);
                result.metadata = fullResult.metadata;
                return result;
            }

            // 同步书签数据
            if (this.syncConfig.syncData.bookmarks) {
                const bookmarksResult = await this.syncBookmarks(remoteMetadata, syncStrategy);
                result.metadata.bookmarks = bookmarksResult.metadata.bookmarks;
                result.metadata.syncAt = bookmarksResult.metadata.syncAt;
                remoteMetadata.bookmarks = bookmarksResult.metadata.bookmarks;
            }

            // 同步配置数据
            if (this.isConfigSyncOpen()) {
                const configResult = await this.syncConfigData(remoteMetadata, syncStrategy);
                result.metadata.config = configResult.metadata.config;
                result.metadata.syncAt = configResult.metadata.syncAt;
            }
            
            return result;
        } catch (error) {
            logger.error('同步失败:', error);
            throw error;
        }
    }

    /**
     * 同步全部数据（首次同步使用）
     * @param {Object} remoteMetadata - 远程元数据
     * @param {Object} syncStrategy - 同步策略
     * @returns {Promise<Object>} 同步结果
     */
    async syncFullData(remoteMetadata, syncStrategy) {
        try {
            // 获取本地书签数据
            const localBookmarksData = await this.getLocalBookmarksData(syncStrategy.syncEmbeddings);
            // 获取本地配置数据
            const localConfigData = await this.getLocalConfigData();
            
            // 合并元数据
            const bookmarksMetadata = await this.calculateBookmarksMetadata(localBookmarksData);
            const configMetadata = await this.calculateConfigMetadata(localConfigData);
            
            const combinedMetadata = this.createEmptyMetadata();
            combinedMetadata.syncAt = new Date().getTime();
            combinedMetadata.bookmarks = bookmarksMetadata.bookmarks;
            combinedMetadata.config = configMetadata.config;
            
            // 保存书签数据
            if (this.syncConfig.syncData.bookmarks) {
                await this.saveRemoteData(localBookmarksData, combinedMetadata);
            }
            
            // 保存配置数据
            if (this.isConfigSyncOpen()) {
                await this.saveRemoteConfigData(localConfigData, combinedMetadata);
            }
            
            return {
                metadata: combinedMetadata,
                changed: true
            };
        } catch (error) {
            logger.error('同步全部数据失败:', error);
            throw error;
        }
    }

    isConfigSyncOpen() {
        const syncData = this.syncConfig.syncData;
        return syncData.settings || syncData.filters || syncData.services;
    }

    /**
     * 同步书签数据
     * @param {Object} remoteMetadata - 远程元数据
     * @param {Object} syncStrategy - 同步策略
     * @returns {Promise<Object>} 同步结果
     */
    async syncBookmarks(remoteMetadata, syncStrategy) {
        try {
            // 获取本地书签数据
            const localBookmarksData = await this.getLocalBookmarksData(syncStrategy.syncEmbeddings);
            
            // 计算本地书签数据的元数据
            const localMetadata = await this.calculateBookmarksMetadata(localBookmarksData);
            
            // 创建同步结果对象
            const result = {
                metadata: remoteMetadata,
                changed: false
            };
            
            // 本地优先
            const localFirst = syncStrategy.mechanism === 'local-first';
            // 远程优先
            const remoteFirst = syncStrategy.mechanism === 'remote-first';
            // 合并
            const merge = syncStrategy.mechanism === 'merge';

            const syncStatus = await SyncStatusManager.getServiceStatus('webdav');
            
            // 检查书签是否发生变化
            const lastSyncMetadata = syncStatus.metadata || {};
            const {isBookmarksChanged: isLocalChange} = this.compareMetadata(lastSyncMetadata, localMetadata);
            const {isBookmarksChanged: isRemoteDifferent} = this.compareMetadata(localMetadata, remoteMetadata);
            const isRemoteChange = lastSyncMetadata.bookmarks?.lastModified !== remoteMetadata.bookmarks?.lastModified;

            logger.debug('书签同步状态检查', {
                isLocalChange,
                isRemoteDifferent,
                isRemoteChange,
                lastSyncMetadata,
                localMetadata,
                remoteMetadata
            });

            if (!isRemoteDifferent) {
                logger.info("本地书签与远程书签一致，无需同步");
                return result;
            }

            if (isLocalChange && isRemoteChange) {
                logger.info("本地和远程书签都发生了变化，执行冲突解决策略");

                if (localFirst) {
                    // 本地优先策略 - 强制上传本地数据
                    const updatedMetadata = { ...remoteMetadata };
                    updatedMetadata.bookmarks = localMetadata.bookmarks;
                    updatedMetadata.syncAt = new Date().getTime();
                    
                    await this.saveRemoteData(localBookmarksData, updatedMetadata);
                    result.metadata = updatedMetadata;
                    result.changed = true;
                    return result;
                }
    
                // 获取远程数据
                const remoteData = await this.getRemoteData(remoteMetadata);
    
                if (!remoteData || !remoteData.data.bookmarks) {
                    logger.warn("远程没有书签数据，执行上传");
                    const updatedMetadata = { ...remoteMetadata };
                    updatedMetadata.bookmarks = localMetadata.bookmarks;
                    updatedMetadata.syncAt = new Date().getTime();
                    
                    await this.saveRemoteData(localBookmarksData, updatedMetadata);
                    result.metadata = updatedMetadata;
                    result.changed = true;
                    return result;
                }
    
                if (remoteFirst) {
                    // 导入远程书签，并强制覆盖本地数据
                    await this.importBookmarks(remoteData.data.bookmarks, true);
                    result.metadata = remoteMetadata;
                    result.changed = true;
                    return result;
                }
                
                // 合并策略
                if (merge) {
                    // 导入书签，并与本地书签合并
                    await this.importBookmarks(remoteData.data.bookmarks, false);
    
                    // 重新获取本地书签数据和元数据
                    const updatedLocalData = await this.getLocalBookmarksData(syncStrategy.syncEmbeddings);
                    const updatedLocalMetadata = await this.calculateBookmarksMetadata(updatedLocalData);
    
                    // 更新远程书签元数据
                    const updatedMetadata = { ...remoteMetadata };
                    updatedMetadata.bookmarks = updatedLocalMetadata.bookmarks;
                    updatedMetadata.syncAt = new Date().getTime();
                    
                    // 保存更新后的书签数据
                    await this.saveRemoteData(updatedLocalData, updatedMetadata);
                    
                    result.metadata = updatedMetadata;
                    result.changed = true;
                    return result;
                }

                // 默认情况
                return result;
            }

            if (isLocalChange) {
                logger.info("本地书签发生了变化，执行推送同步");

                const updatedMetadata = { ...remoteMetadata };
                updatedMetadata.bookmarks = localMetadata.bookmarks;
                updatedMetadata.syncAt = new Date().getTime();
                
                await this.saveRemoteData(localBookmarksData, updatedMetadata);
                result.metadata = updatedMetadata;
                result.changed = true;
                return result;
            }
            
            if (isRemoteChange) {
                logger.info("远程书签发生了变化，执行下拉同步");

                // 获取远程书签数据
                const remoteData = await this.getRemoteData(remoteMetadata);
    
                if (!remoteData || !remoteData.data.bookmarks) {
                    logger.warn("远程没有书签数据，执行上传");
                    const updatedMetadata = { ...remoteMetadata };
                    updatedMetadata.bookmarks = localMetadata.bookmarks;
                    updatedMetadata.syncAt = new Date().getTime();
                    
                    await this.saveRemoteData(localBookmarksData, updatedMetadata);
                    result.metadata = updatedMetadata;
                    result.changed = true;
                    return result;
                }

                // 导入远程书签
                await this.importBookmarks(remoteData.data.bookmarks, true);
                result.metadata = remoteMetadata;
                result.changed = true;
                return result;
            }

            return result;
        } catch (error) {
            logger.error('同步书签数据失败:', error);
            throw error;
        }
    }

    /**
     * 同步配置数据
     * @param {Object} remoteMetadata - 远程元数据
     * @param {Object} syncStrategy - 同步策略
     * @returns {Promise<Object>} 同步结果
     */
    async syncConfigData(remoteMetadata, syncStrategy) {
        try {
            // 获取本地配置数据
            const localConfigData = await this.getLocalConfigData();
            
            // 计算本地配置数据的元数据
            const localMetadata = await this.calculateConfigMetadata(localConfigData);
            
            // 创建同步结果对象
            const result = {
                metadata: remoteMetadata,
                changed: false
            };
            
            // 本地优先
            const localFirst = syncStrategy.mechanism === 'local-first';
            // 远程优先
            const remoteFirst = syncStrategy.mechanism === 'remote-first';
            // 合并
            const merge = syncStrategy.mechanism === 'merge';

            const syncStatus = await SyncStatusManager.getServiceStatus('webdav');
            
            // 检查配置数据是否发生变化 (任何一部分配置变化都算变化)
            const lastSyncMetadata = syncStatus.metadata || {};
            const {isConfigChanged: isLocalChange} = this.compareMetadata(lastSyncMetadata, localMetadata);
            const {isConfigChanged: isRemoteDifferent} = this.compareMetadata(localMetadata, remoteMetadata);
            const isRemoteChange = lastSyncMetadata.config?.lastModified !== remoteMetadata.config?.lastModified;

            logger.debug('配置同步状态检查', {
                isLocalChange,
                isRemoteDifferent,
                isRemoteChange,
                lastSyncMetadata,
                localMetadata,
                remoteMetadata
            });

            if (!isRemoteDifferent) {
                logger.info("本地配置与远程配置一致，无需同步");
                return result;
            }

            if (isLocalChange && isRemoteChange) {
                logger.info("本地和远程配置都发生了变化，执行冲突解决策略");

                if (localFirst) {
                    // 本地优先策略 - 强制上传本地数据
                    const updatedMetadata = { ...remoteMetadata };
                    updatedMetadata.config = localMetadata.config;
                    updatedMetadata.syncAt = new Date().getTime();
                    
                    await this.saveRemoteConfigData(localConfigData, updatedMetadata);
                    result.metadata = updatedMetadata;
                    result.changed = true;
                    return result;
                }
    
                // 获取远程配置数据
                const remoteConfigData = await this.getRemoteConfigData();
    
                if (!remoteConfigData) {
                    logger.warn("远程没有配置数据，执行上传");
                    const updatedMetadata = { ...remoteMetadata };
                    updatedMetadata.config = localMetadata.config;
                    updatedMetadata.syncAt = new Date().getTime();
                    
                    await this.saveRemoteConfigData(localConfigData, updatedMetadata);
                    result.metadata = updatedMetadata;
                    result.changed = true;
                    return result;
                }
    
                if (remoteFirst) {
                    // 导入远程配置，并强制覆盖本地配置
                    await this.importConfigData(remoteConfigData.data, true);
                    result.metadata = remoteMetadata;
                    result.changed = true;
                    return result;
                }
                
                // 合并策略
                if (merge) {
                    // 导入配置，并与本地配置合并
                    await this.importConfigData(remoteConfigData.data, false);
    
                    // 重新获取本地配置数据和元数据
                    const updatedLocalData = await this.getLocalConfigData();
                    const updatedLocalMetadata = await this.calculateConfigMetadata(updatedLocalData);
    
                    // 更新远程配置元数据
                    const updatedMetadata = { ...remoteMetadata };
                    updatedMetadata.config = updatedLocalMetadata.config;
                    updatedMetadata.syncAt = new Date().getTime();
                    
                    // 保存更新后的配置数据
                    await this.saveRemoteConfigData(updatedLocalData, updatedMetadata);
                    
                    result.metadata = updatedMetadata;
                    result.changed = true;
                    return result;
                }

                // 默认情况
                return result;
            }

            if (isLocalChange) {
                logger.info("本地配置发生了变化，执行推送同步");

                const updatedMetadata = { ...remoteMetadata };
                updatedMetadata.config = localMetadata.config;
                updatedMetadata.syncAt = new Date().getTime();
                
                await this.saveRemoteConfigData(localConfigData, updatedMetadata);
                result.metadata = updatedMetadata;
                result.changed = true;
                return result;
            }
            
            if (isRemoteChange) {
                logger.info("远程配置发生了变化，执行下拉同步");

                // 获取远程配置数据
                const remoteConfigData = await this.getRemoteConfigData();
    
                if (!remoteConfigData) {
                    logger.warn("远程没有配置数据，执行上传");
                    const updatedMetadata = { ...remoteMetadata };
                    updatedMetadata.config = localMetadata.config;
                    updatedMetadata.syncAt = new Date().getTime();
                    
                    await this.saveRemoteConfigData(localConfigData, updatedMetadata);
                    result.metadata = updatedMetadata;
                    result.changed = true;
                    return result;
                }

                // 导入远程配置
                await this.importConfigData(remoteConfigData.data, true);
                result.metadata = remoteMetadata;
                result.changed = true;
                return result;
            }

            return result;
        } catch (error) {
            logger.error('同步配置数据失败:', error);
            throw error;
        }
    }

    compareMetadata(localMetadata, remoteMetadata) {
        const dataTypes = ['bookmarks', 'config'];

        const changedTypes = [];
        for (const type of dataTypes) {
            if (!localMetadata[type] && !remoteMetadata[type]) {
                continue;
            }

            if (!localMetadata[type] || !remoteMetadata[type]) {
                changedTypes.push(type);
                continue;
            }
            
            if (type === 'bookmarks') {
                // 直接比较书签的MD5
                if (localMetadata[type].md5 !== remoteMetadata[type].md5) {
                    changedTypes.push(type);
                }
            } else if (type === 'config') {
                // 比较配置数据的各个部分
                const configTypes = ['settings', 'filters', 'services'];
                for (const configType of configTypes) {
                    if (!localMetadata[type][configType] && !remoteMetadata[type][configType]) {
                        continue;
                    }

                    if (!localMetadata[type][configType] || !remoteMetadata[type][configType]) {
                        changedTypes.push(type);
                        break;
                    }
                    
                    if (localMetadata[type][configType].md5 !== remoteMetadata[type][configType].md5) {
                        changedTypes.push(type);
                        break;
                    }
                }
            }
        }

        const isBookmarksChanged = changedTypes.includes('bookmarks');
        const isConfigChanged = changedTypes.includes('config');
        return {
            isBookmarksChanged,
            isConfigChanged
        };
    }

    diffBookmarks(localBookmarks, remoteBookmarks) {
        const localBookmarksMap = new Map(localBookmarks.map(bookmark => [bookmark.url, bookmark]));
        const remoteBookmarksMap = new Map(remoteBookmarks.map(bookmark => [bookmark.url, bookmark]));

        const diffResult = {
            added: [],
            removed: [],
            updated: [],
            same: []
        };
        
        for (const bookmark of localBookmarks) {
            const remoteBookmark = remoteBookmarksMap.get(bookmark.url);
            if (remoteBookmark) {
                if (this.isBookmarkChanged(bookmark, remoteBookmark)) {
                    if (!remoteBookmark.embedding) {
                        remoteBookmark.embedding = bookmark.embedding;
                    }
                    diffResult.updated.push(remoteBookmark);
                } else if (remoteBookmark.embedding && !bookmark.embedding) {
                    diffResult.updated.push(remoteBookmark);
                } else {
                    diffResult.same.push(bookmark);
                }
            } else {
                diffResult.removed.push(bookmark.url);
            }
        }

        for (const bookmark of remoteBookmarks) {
            if (!localBookmarksMap.has(bookmark.url)) {
                diffResult.added.push(bookmark);
            }
        }

        return diffResult;
    }

    isBookmarkChanged(localBookmark, remoteBookmark) {
        const localBookmarkMeta = this.getBookmarkMeta(localBookmark);
        const remoteBookmarkMeta = this.getBookmarkMeta(remoteBookmark);
        
        return JSON.stringify(localBookmarkMeta) !== JSON.stringify(remoteBookmarkMeta);
    }

    getBookmarkMeta(bookmark) {
        return {
            url: bookmark.url,
            title: bookmark.title,
            tags: bookmark.tags,
            excerpt: bookmark.excerpt,
            savedAt: bookmark.savedAt,
            lastUsed: bookmark.lastUsed,
            useCount: bookmark.useCount,
            apiService: bookmark.apiService,
            embedModel: bookmark.embedModel,
        }
    }
}