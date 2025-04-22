/**
 * 自动同步管理器
 * 负责管理WebDAV等服务的定时自动同步功能
 */
class AutoSyncManager {
    // WebDAV同步的闹钟名称
    static WEBDAV_ALARM_NAME = 'webdav_auto_sync';
    // 云同步闹钟名称
    static CLOUD_ALARM_NAME = 'cloud_auto_sync';
    
    // 同步状态标志
    static isSyncing = false;
    static lastSyncTime = 0;
    
    // 预定同步的防抖定时器和延迟时间
    static scheduledWebdavSyncDebounceTimer = null;
    static scheduledCloudSyncDebounceTimer = null;
    static SCHEDULED_SYNC_DEBOUNCE_DELAY = 30000; // 30秒
    
    // 闹钟日志相关配置
    static ALARM_LOGS_KEY = 'alarm_logs';
    static MAX_LOG_ENTRIES = 100;
    
    /**
     * 初始化自动同步系统
     * 在后台脚本启动时调用
     */
    static async initialize() {
        try {
            logger.info('初始化自动同步系统');
            
            // 为不同的同步服务设置闹钟
            await this.setupWebDAVSync();
            await this.setupCloudSync();
            
            // 监听存储变化事件，以便在配置更改时更新同步设置
            this.setupStorageListener();
            
            // 记录系统启动日志
            await this.addAlarmLog({
                type: 'system',
                action: 'startup',
                message: '自动同步系统初始化完成'
            });
            
            logger.info('自动同步系统初始化完成');
        } catch (error) {
            logger.error('初始化自动同步系统失败:', error);
        }
    }
    
    /**
     * 设置WebDAV自动同步
     */
    static async setupWebDAVSync() {
        try {
            // 获取WebDAV配置
            const config = await SyncSettingsManager.getServiceConfig('webdav');
            await this.updateWebDAVSyncAlarm(config);
        } catch (error) {
            logger.error('设置WebDAV同步失败:', error);
        }
    }
    
    /**
     * 设置云同步闹钟
     */
    static async setupCloudSync() {
        try {
            // 获取云同步配置
            const config = await SyncSettingsManager.getServiceConfig('cloud');
            await this.updateCloudSyncAlarm(config);
        } catch (error) {
            logger.error('设置云同步失败:', error);
        }
    }
    
    /**
     * 更新WebDAV同步闹钟
     * @param {Object} config - WebDAV配置
     */
    static async updateWebDAVSyncAlarm(config) {
        // 获取当前闹钟
        const alarm = await chrome.alarms.get(this.WEBDAV_ALARM_NAME);
        
        // 如果未开启自动同步，则直接返回
        if (!config.syncStrategy.autoSync) {
            logger.debug('WebDAV自动同步已关闭');
            await chrome.alarms.clear(this.WEBDAV_ALARM_NAME);
            return;
        }
        
        // 验证配置是否有效
        const isValid = SyncSettingsManager.validateWebDAVConfig(config);
        if (!isValid) {
            logger.debug('WebDAV配置无效，不创建自动同步闹钟');
            await chrome.alarms.clear(this.WEBDAV_ALARM_NAME);
            return;
        }
        
        // 获取同步间隔（分钟）
        const intervalMinutes = Math.max(5, config.syncStrategy.interval || 30);
        if (alarm && alarm.periodInMinutes === intervalMinutes) {
            logger.debug('WebDAV自动同步闹钟已存在，且间隔相同，不重复创建');
            await this.addAlarmLog({
                type: 'alarm',
                action: 'exists',
                alarmName: this.WEBDAV_ALARM_NAME,
                periodInMinutes: intervalMinutes,
                scheduledTime: new Date(alarm.scheduledTime).toLocaleString(),
            });
            return;
        }

        // 清除已存在的闹钟
        await chrome.alarms.clear(this.WEBDAV_ALARM_NAME);
        
        // 创建闹钟
        await chrome.alarms.create(this.WEBDAV_ALARM_NAME, {
            // 延迟1分钟后首次执行，避免启动时立即同步
            delayInMinutes: 1,
            // 设置重复间隔
            periodInMinutes: intervalMinutes
        });
        
        await this.addAlarmLog({
            type: 'alarm',
            action: 'create',
            alarmName: this.WEBDAV_ALARM_NAME,
            periodInMinutes: intervalMinutes,
            delayInMinutes: 1,
            nextFireTime: Date.now() + 60000 // 1分钟后
        });
        
        logger.info(`WebDAV自动同步已开启，间隔: ${intervalMinutes} 分钟`);
    }
    
    /**
     * 更新云同步闹钟
     * @param {Object} config - 云同步配置
     */
    static async updateCloudSyncAlarm(config) {
        // 获取当前闹钟
        const alarm = await chrome.alarms.get(this.CLOUD_ALARM_NAME);
        
        // 如果未开启自动同步，则直接返回
        if (!config.autoSync) {
            logger.debug('云同步自动同步已关闭');
            await chrome.alarms.clear(this.CLOUD_ALARM_NAME);
            return;
        }
        
        // 验证配置是否有效
        const isValid = await this.validateCloudConfig();
        if (!isValid) {
            logger.debug('云同步配置无效，不创建自动同步闹钟');
            await chrome.alarms.clear(this.CLOUD_ALARM_NAME);
            return;
        }
        
        // 固定同步间隔（分钟）- 8小时 = 480分钟
        const intervalMinutes = 480;
        
        if (alarm && alarm.periodInMinutes === intervalMinutes) {
            logger.debug('云同步自动同步闹钟已存在，且间隔相同，不重复创建');
            await this.addAlarmLog({
                type: 'alarm',
                action: 'exists',
                alarmName: this.CLOUD_ALARM_NAME,
                periodInMinutes: intervalMinutes,
                scheduledTime: new Date(alarm.scheduledTime).toLocaleString(),
            });
            return;
        }

        // 清除已存在的闹钟
        await chrome.alarms.clear(this.CLOUD_ALARM_NAME);
        
        // 创建闹钟
        await chrome.alarms.create(this.CLOUD_ALARM_NAME, {
            // 延迟2分钟后首次执行，避免启动时立即同步，并与WebDAV同步错开时间
            delayInMinutes: 2,
            // 设置重复间隔
            periodInMinutes: intervalMinutes
        });
        
        await this.addAlarmLog({
            type: 'alarm',
            action: 'create',
            alarmName: this.CLOUD_ALARM_NAME,
            periodInMinutes: intervalMinutes,
            delayInMinutes: 2,
            nextFireTime: Date.now() + 120000 // 2分钟后
        });
        
        logger.info(`云同步自动同步已开启，间隔: ${intervalMinutes} 分钟（8小时）`);
    }
    
    /**
     * 验证云同步配置是否有效
     * @returns {Promise<boolean>} 配置是否有效
     */
    static async validateCloudConfig() {
        try {
            // 检查是否已登录
            const {valid} = await validateToken();
            if (!valid) {
                return false;
            }
            
            return true;
        } catch (error) {
            logger.error('验证云同步配置失败:', error);
            return false;
        }
    }
    
    /**
     * 设置存储监听器
     * 当同步配置变化时，更新同步设置
     */
    static setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            
            // 当同步配置发生变化时
            if (changes[SyncSettingsManager.SYNC_CONFIG_KEY]) {
                const newConfig = changes[SyncSettingsManager.SYNC_CONFIG_KEY].newValue;
                
                if (newConfig && newConfig.webdav) {
                    logger.debug('检测到WebDAV配置变化，更新自动同步设置');
                    this.updateWebDAVSyncAlarm(newConfig.webdav);
                }
                
                if (newConfig && newConfig.cloud) {
                    logger.debug('检测到云同步配置变化，更新自动同步设置');
                    this.updateCloudSyncAlarm(newConfig.cloud);
                }
            }
        });
    }

    /**
     * 处理闹钟触发事件
     * @param {Object} alarm - 闹钟对象
     */
    static async handleAlarm(alarm) {
        // 记录闹钟触发日志
        await this.addAlarmLog({
            type: 'alarm',
            action: 'trigger',
            alarmName: alarm.name,
            scheduledTime: new Date(alarm.scheduledTime).toLocaleString(),
            syncState: this.isSyncing ? 'syncing' : 'idle'
        });
        
        // 处理WebDAV同步闹钟
        if (alarm.name === this.WEBDAV_ALARM_NAME) {
            try {
                logger.debug('WebDAV自动同步闹钟触发');
                
                const result = await this.executeWebDAVSync();
                
                // 记录同步结果日志
                await this.addAlarmLog({
                    type: 'sync',
                    alarmName: alarm.name,
                    result: result.success ? 'success' : result.error
                });
                
                if (!result.success) {
                    logger.error(`WebDAV自动同步失败: ${result.error}`);
                }
            } catch (error) {
                logger.error('执行WebDAV自动同步失败:', error);
                
                // 记录同步错误日志
                await this.addAlarmLog({
                    type: 'sync',
                    alarmName: alarm.name,
                    result: error.message
                });
            }
        }
        // 处理云同步闹钟
        else if (alarm.name === this.CLOUD_ALARM_NAME) {
            try {
                logger.debug('云同步自动同步闹钟触发');
                
                const result = await this.executeCloudSync();
                
                // 记录同步结果日志
                await this.addAlarmLog({
                    type: 'sync',
                    alarmName: alarm.name,
                    result: result.success ? 'success' : result.error
                });
                
                if (!result.success) {
                    logger.error(`云同步自动同步失败: ${result.error}`);
                }
            } catch (error) {
                logger.error('执行云同步自动同步失败:', error);
                
                // 记录同步错误日志
                await this.addAlarmLog({
                    type: 'sync',
                    alarmName: alarm.name,
                    result: error.message
                });
            }
        }
    }
    
    /**
     * 处理预定同步
     * 使用防抖机制避免频繁同步
     * @param {Object} data - 同步相关数据，可能包含同步原因、变更类型等
     * @returns {Promise<void>} Promise 对象
     */
    static async handleScheduledSync(data = {}) {
        await this.scheduleWebdavSync(data);
        await this.scheduleCloudSync(data);
    }

    static async scheduleWebdavSync(data = {}) {
        try {
            const autoSyncEnabled = await SyncSettingsManager.isAutoSyncEnabled('webdav');
            if (!autoSyncEnabled) {
                logger.debug('webdav 自动同步已关闭');
                return;
            }

            // 使用防抖机制避免频繁同步
            if (this.scheduledWebdavSyncDebounceTimer) {
                clearTimeout(this.scheduledWebdavSyncDebounceTimer);
            }
            
            const reason = data.reason || '未指定原因';
            logger.debug(`webdav 预定同步请求 (${reason})，将在30秒后触发同步`);
            
            this.scheduledWebdavSyncDebounceTimer = setTimeout(async () => {
                try {
                    logger.debug(`webdav 预定同步触发 (${reason})`);
                    const result = await this.executeWebDAVSync();
                    if (!result.success) {
                        logger.error(`webdav 预定同步失败 (${reason}): ${result.error}`);
                    }
                } catch (error) {
                    logger.error('执行webdav预定同步失败:', error);
                }
            }, this.SCHEDULED_SYNC_DEBOUNCE_DELAY);
        } catch (error) {
            logger.error('处理webdav预定同步失败:', error);
            throw error;
        }
    }

    static async scheduleCloudSync(data = {}) {
        if (data.reason !== ScheduleSyncReason.BOOKMARKS) {
            return;
        }

        try {
            const autoSyncEnabled = await SyncSettingsManager.isAutoSyncEnabled('cloud');
            if (!autoSyncEnabled) {
                logger.debug('cloud 自动同步已关闭');
                return;
            }

            const {valid} = await validateToken();
            if (!valid) {
                return;
            }

            // 使用防抖机制避免频繁同步
            if (this.scheduledCloudSyncDebounceTimer) {
                clearTimeout(this.scheduledCloudSyncDebounceTimer);
            }
            
            const reason = data.reason || '未指定原因';
            logger.debug(`cloud 预定同步请求 (${reason})，将在30秒后触发同步`);
            
            this.scheduledCloudSyncDebounceTimer = setTimeout(async () => {
                try {
                    logger.debug(`cloud 预定同步触发 (${reason})`);
                    const result = await this.executeCloudSync();
                    if (!result.success) {
                        logger.error(`cloud 预定同步失败 (${reason}): ${result.error}`);
                    }
                } catch (error) {
                    logger.error('执行cloud预定同步失败:', error);
                }
            }, this.SCHEDULED_SYNC_DEBOUNCE_DELAY); 
        } catch (error) {
            logger.error('处理cloud预定同步失败:', error);
            throw error;
        }
    }

    static async lockSync(service) {
        if (this.isSyncing) {
            const now = Date.now();
            const timeSinceLastSync = (now - this.lastSyncTime) / 1000; // 转换为秒
            if (timeSinceLastSync < 300) { // 5分钟 = 300秒
                return false;
            }
        }
        this.isSyncing = true;
        this.lastSyncTime = Date.now();
        await SyncStatusManager.updateSyncProcess({
            status: SyncStatus.SYNCING,
            startTime: Date.now(),
            service: service,
        });
        return true;
    }

    static async unlockSync() {
        if (!this.isSyncing) {
            return false;
        }
        this.isSyncing = false;
        await SyncStatusManager.updateSyncProcess({
            status: SyncStatus.IDLE
        });
        return true;
    }
    
    /**
     * 执行WebDAV同步
     * @returns {Promise<Object>} 同步结果
     */
    static async executeWebDAVSync() {
        // 检查是否有同步任务正在执行
        const isLocked = await this.lockSync('webdav');
        if (!isLocked) {
            return {
                success: false,
                error: `同步操作正在进行中，请稍后再试`
            };
        }
        
        try {
            logger.info('开始执行WebDAV同步');
            
            // 获取WebDAV配置
            const config = await SyncSettingsManager.getServiceConfig('webdav');
            
            // 验证配置
            const isValid = SyncSettingsManager.validateWebDAVConfig(config);
            if (!isValid) {
                logger.warn('WebDAV配置无效，跳过同步');
                return {
                    success: false,
                    error: 'WebDAV配置无效，请先完成配置'
                };
            }
            
            // 创建同步管理器并执行同步
            const syncManager = new WebDAVSyncManager(config);
            const result = await syncManager.sync();
            
            // 更新同步状态
            await SyncStatusManager.updateStatus('webdav', result);
            
            logger.info('WebDAV同步完成', result);
            return {
                success: true,
                result: result
            }
        } catch (error) {
            logger.error('WebDAV同步失败:', error);
            
            // 更新同步状态为失败
            const status = await SyncStatusManager.getServiceStatus('webdav');
            await SyncStatusManager.updateStatus('webdav', {
                ...status,
                lastSync: new Date().getTime(),
                lastSyncResult: error.message
            });
            return {
                success: false,
                error: error.message
            }
        } finally {
            await this.unlockSync();
        }
    }

    static async executeCloudSync() {
        const isLocked = await this.lockSync('cloud');
        if (!isLocked) {
            return {
                success: false,
                error: `同步操作正在进行中，请稍后再试`
            };
        }
        try {
            logger.info('开始执行云同步');

            const valid = await this.validateCloudConfig();
            if (!valid) {
                return {
                    success: false,
                    error: '云同步配置无效，请先完成配置'
                };
            }
            
            const result = await syncManager.startSync();

            // 更新同步状态
            await SyncStatusManager.updateStatus('cloud', result);

            logger.info('云同步完成', result);
            return {
                success: true,
                result: result
            }
        } catch (error) {
            logger.error('执行云同步失败:', error);

            // 更新同步状态为失败
            const status = await SyncStatusManager.getServiceStatus('cloud');
            await SyncStatusManager.updateStatus('cloud', {
                ...status,
                lastSync: new Date().getTime(),
                lastSyncResult: error.message
            });
            return {
                success: false,
                error: error.message
            }
        } finally {
            await this.unlockSync();
        }
    }
    
    /**
     * 获取闹钟日志
     * @returns {Promise<Array>} 闹钟日志数组
     */
    static async getAlarmLogs() {
        try {
            const result = await LocalStorageMgr.get(this.ALARM_LOGS_KEY);
            return result || [];
        } catch (error) {
            logger.error('获取闹钟日志失败:', error);
            return [];
        }
    }
    
    /**
     * 添加闹钟日志
     * @param {Object} logEntry - 日志条目
     * @returns {Promise<void>}
     */
    static async addAlarmLog(logEntry) {
        if (!DEBUG) {
            return;
        }
        try {
            // 获取现有日志
            const logs = await this.getAlarmLogs();
            
            // 创建新的日志条目
            const newLog = {
                _type: logEntry.type,
                _action: logEntry.action,
                date: new Date().toLocaleString(),
                logEntry: {
                    ...logEntry,
                    type: undefined,
                    action: undefined,
                },
            };
            
            // 添加到日志数组的开头
            logs.unshift(newLog);
            
            // 如果日志超过最大数量，则删除最旧的
            if (logs.length > this.MAX_LOG_ENTRIES) {
                logs.splice(this.MAX_LOG_ENTRIES);
            }
            
            // 保存到存储
            await LocalStorageMgr.set(this.ALARM_LOGS_KEY, logs);
            
        } catch (error) {
            logger.error('添加闹钟日志失败:', error);
        }
    }
    
    /**
     * 清除闹钟日志
     * @returns {Promise<void>}
     */
    static async clearAlarmLogs() {
        try {
            await LocalStorageMgr.remove(this.ALARM_LOGS_KEY);
            logger.info('闹钟日志已清除');
        } catch (error) {
            logger.error('清除闹钟日志失败:', error);
        }
    }
} 