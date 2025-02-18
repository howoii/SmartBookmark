// 设置管理器
class SettingsManager {

    static settingsCache = null;
    // 默认设置
    static DEFAULT_SETTINGS = {
        sort: {
            bookmarks: 'savedAt_desc'  // 书签排序方式
        },
        display: {
            showChromeBookmarks: false,  // 控制是否显示Chrome书签的设置
            autoFocusSearch: false,  // 打开时自动聚焦搜索框
            confirmTags: true,       // 保存时确认标签，默认开启
            skipApiKeyNotice: false,   // 跳过API Key检查提示，默认关闭
            viewMode: 'list', // 添加默认视图模式
            theme: {
                mode: 'light',  // 'system' | 'light' | 'dark'
            }
        },
        privacy: {
            autoDetect: true,  // 默认开启自动检测
            enabled: false,     // 默认关闭手动隐私模式
            customDomains: []   // 新增:用户自定义的隐私域名列表
        },
        search: {
            maxResults: 50,
            omniboxSearchLimit: 9,
            sitesDisplay: 'pinned',
            sitesDisplayCount: 10
        }
    };

    // 设置键前缀，用于区分不同类型的存储数据
    static SETTINGS_KEY = 'settings';

    static async init() {
        await this.getAll();
        this.setupStorageListener();
    }

    static async setupStorageListener() {
        chrome.storage.onChanged.addListener(async (changes, areaName) => {
            if (areaName === 'sync' && changes[this.SETTINGS_KEY]) {
                logger.debug('设置发生变化, 清除缓存');
                this.settingsCache = null;
            }
        });
    }

    // 获取所有设置
    static async getAll() {
        try {
            if (this.settingsCache) {
                return this.settingsCache;
            }
            const result = await chrome.storage.sync.get(this.SETTINGS_KEY);
            const storedSettings = result[this.SETTINGS_KEY] || {};
            
            // 使用深度合并确保所有层级的默认值都被正确应用
            const settingsCache = this.deepMerge(this.DEFAULT_SETTINGS, storedSettings);
            this.settingsCache = settingsCache;
            return settingsCache;
            
        } catch (error) {
            logger.error('获取设置失败:', error);
            return this.DEFAULT_SETTINGS;
        }
    }

    // 获取特定设置项
    static async get(path) {
        try {
            const settings = await this.getAll();
            return path.split('.').reduce((obj, key) => obj?.[key], settings);
        } catch (error) {
            logger.error(`获取设置[${path}]失败:`, error);
            return this.getDefaultValue(path);
        }
    }

    // 更新设置
    static async update(updates) {
        try {
            const currentSettings = await this.getAll();
            const newSettings = {
                ...currentSettings,
                ...this.deepMerge(currentSettings, updates)
            };
            
            // 添加调试日志
            logger.debug('更新设置:', {
                currentSettings,
                updates,
                newSettings
            });
            
            await chrome.storage.sync.set({
                [this.SETTINGS_KEY]: newSettings
            });
            this.settingsCache = null;
            return newSettings;
        } catch (error) {
            logger.error('更新设置失败:', error);
            throw error;
        }
    }

    // 重置所有设置
    static async reset() {
        try {
            await chrome.storage.sync.set({
                [this.SETTINGS_KEY]: this.DEFAULT_SETTINGS
            });
            this.settingsCache = null;
            return this.DEFAULT_SETTINGS;
        } catch (error) {
            logger.error('重置设置失败:', error);
            throw error;
        }
    }

    // 获取默认值
    static getDefaultValue(path) {
        return path.split('.').reduce((obj, key) => obj?.[key], this.DEFAULT_SETTINGS);
    }

    // 深度合并对象
    static deepMerge(target, source) {
        const result = { ...target };
        for (const key in source) {
            // 处理数组类型
            if (Array.isArray(source[key])) {
                result[key] = [...source[key]];
            }
            // 处理对象类型
            else if (source[key] instanceof Object && key in target) {
                result[key] = this.deepMerge(target[key], source[key]);
            } 
            // 处理其他类型
            else {
                result[key] = source[key];
            }
        }
        return result;
    }
} 