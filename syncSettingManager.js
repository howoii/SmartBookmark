// 同步状态管理器
class SyncStatusManager {
    static SYNC_STATUS_KEY = 'sync_status';
    static SYNC_PROCESS_KEY = 'sync_process';

    // 默认状态
    static DEFAULT_STATUS = {
        cloud: {
            lastSync: null,
            lastSyncResult: null
        },
        webdav: {
            lastSync: null,
            lastSyncResult: null,
            metadata: null,
        }
    };

    // 获取所有同步状态
    static async getStatus() {
        try {
            const storedStatus = await LocalStorageMgr.get(this.SYNC_STATUS_KEY) || {};
            
            // 合并默认状态
            const statusCache = { ...this.DEFAULT_STATUS, ...storedStatus };
            return statusCache;
        } catch (error) {
            logger.error('获取同步状态失败:', error);
            return this.DEFAULT_STATUS;
        }
    }

    // 获取特定服务的同步状态
    static async getServiceStatus(service) {
        try {
            const status = await this.getStatus();
            return status[service];
        } catch (error) {
            logger.error(`获取同步服务[${service}]状态失败:`, error);
            return this.DEFAULT_STATUS[service];
        }
    }

    // 更新同步状态
    static async updateStatus(service, status) {
        try {
            const currentStatus = await this.getStatus();
            const newStatus = {
                ...currentStatus,
                [service]: status
            };
            
            logger.debug('更新同步状态:', {
                currentStatus,
                newStatus
            });
            
            await LocalStorageMgr.set(this.SYNC_STATUS_KEY, newStatus);
            return newStatus;
        } catch (error) {
            logger.error(`更新同步状态失败[${service}]:`, error);
            throw error;
        }
    }

    static async hasSyncError() {
        const status = await this.getStatus();
        if (status.cloud.lastSyncResult && status.cloud.lastSyncResult !== 'success') {
            return true;
        }
        if (status.webdav.lastSyncResult && status.webdav.lastSyncResult !== 'success') {
            return true;
        }
        return false;
    }

    static async updateSyncProcess(process) {
        try {
            await LocalStorageMgr.set(this.SYNC_PROCESS_KEY, process);
        } catch (error) {
            logger.error(`更新同步过程失败:`, error);
        }
    }

    static async getSyncProcess() {
        try {
            const result = await LocalStorageMgr.get(this.SYNC_PROCESS_KEY);
            return result || {};
        } catch (error) {
            logger.error(`获取同步过程失败:`, error);
            return {};
        }
    }

    static async isSyncing() {
        const process = await this.getSyncProcess();
        const now = Date.now(); 
        const startTime = process.startTime || 0;
        const timeSinceLastSync = (now - startTime) / 1000; // 转换为秒
        if (timeSinceLastSync < 300) { // 5分钟 = 300秒
            return true;
        }
        return false;
    }
}

// 同步服务管理器
class SyncSettingsManager {
    static syncConfigCache = null;
    static SYNC_CONFIG_KEY = 'sync_config';

    // 默认配置
    static DEFAULT_CONFIG = {
        cloud: {
            autoSync: true,
        },
        webdav: {
            server: {
                url: '',
                username: '',
                password: '',
                folder: '/bookmarks'  // 默认文件夹路径
            },
            syncData: {
                bookmarks: true,      // 同步书签
                settings: true,       // 同步设置
                filters: true,        // 同步自定义标签
                services: true        // 同步API服务配置
            },
            syncStrategy: {
                autoSync: false,       // 自动同步
                interval: 15,         // 同步间隔（分钟）
                mechanism: 'merge',    // 同步机制：merge（合并）, override（覆盖）
                syncEmbeddings: true  // 同步书签向量数据
            }
        }
    };

    static async init() {
        await this.getConfig();
        this.setupStorageListener();
    }

    static setupStorageListener() {
        chrome.storage.onChanged.addListener(async (changes, areaName) => {
            if (areaName === 'local' && changes[this.SYNC_CONFIG_KEY]) {
                logger.debug('同步配置发生变化, 清除缓存');
                this.syncConfigCache = null;
            }
        });
    }

    // 获取所有同步配置
    static async getConfig() {
        try {
            if (this.syncConfigCache) {
                return this.syncConfigCache;
            }
            const storedConfig = await LocalStorageMgr.get(this.SYNC_CONFIG_KEY) || {};
            
            // 使用深度合并确保所有层级的默认值都被正确应用
            const configCache = this.deepMerge(this.DEFAULT_CONFIG, storedConfig);
            this.syncConfigCache = configCache;
            return configCache;
        } catch (error) {
            logger.error('获取同步配置失败:', error);
            return this.DEFAULT_CONFIG;
        }
    }

    // 获取特定同步服务的配置
    static async getServiceConfig(service) {
        try {
            const config = await this.getConfig();
            return config[service];
        } catch (error) {
            logger.error(`获取同步服务[${service}]配置失败:`, error);
            return this.DEFAULT_CONFIG[service];
        }
    }

    // 更新配置
    static async updateConfig(updates) {
        try {
            const currentConfig = await this.getConfig();
            const newConfig = this.deepMerge(currentConfig, updates);
            
            logger.debug('更新同步配置:', {
                currentConfig,
                updates,
                newConfig
            });
            
            await LocalStorageMgr.set(this.SYNC_CONFIG_KEY, newConfig);
            this.syncConfigCache = null;
            return newConfig;
        } catch (error) {
            logger.error('更新同步配置失败:', error);
            throw error;
        }
    }

    // 更新特定同步服务的配置
    static async updateServiceConfig(service, config) {
        try {
            const update = {
                [service]: config
            };
            return await this.updateConfig(update);
        } catch (error) {
            logger.error(`更新同步服务[${service}]配置失败:`, error);
            throw error;
        }
    }

    static async isAutoSyncEnabled(service) {
        const config = await this.getServiceConfig(service);
        switch (service) {
            case 'cloud':
                return config.autoSync;
            case 'webdav':
                if (!config.syncStrategy.autoSync) {
                    return false;
                }
                if (!config.server.url || !config.server.username || !config.server.password) {
                    return false;
                }
                return true;
            default:
                return false;
        }
    }

    // 重置所有配置
    static async resetConfig() {
        try {
            await LocalStorageMgr.set(this.SYNC_CONFIG_KEY, this.DEFAULT_CONFIG);
            this.syncConfigCache = null;
            return this.DEFAULT_CONFIG;
        } catch (error) {
            logger.error('重置同步配置失败:', error);
            throw error;
        }
    }

    // 深度合并对象
    static deepMerge(target, source) {
        const result = { ...target };
        for (const key in source) {
            if (Array.isArray(source[key])) {
                result[key] = [...source[key]];
            }
            else if (source[key] instanceof Object && key in target) {
                result[key] = this.deepMerge(target[key], source[key]);
            } 
            else {
                result[key] = source[key];
            }
        }
        return result;
    }

    /**
     * 验证WebDAV配置是否有效
     * @param {Object} config - WebDAV配置
     * @returns {boolean} 配置是否有效
     */
    static validateWebDAVConfig(config) {
        // 验证必要的服务器信息
        if (!config.server.url || !config.server.username || !config.server.password) {
            return false;
        }
        
        // 验证同步间隔
        if (config.syncStrategy.autoSync) {
            const interval = config.syncStrategy.interval;
            if (isNaN(interval) || interval < 5 || interval > 1440) {
                return false;
            }
        }
        
        // 验证至少选择了一项要同步的数据
        const hasSelectedData = Object.values(config.syncData).some(value => value);
        if (!hasSelectedData) {
            return false;
        }
        
        return true;
    }
}