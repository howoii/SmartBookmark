const MessageType = {
    // 书签相关
    BOOKMARKS_UPDATED: 'BOOKMARKS_UPDATED',
    BOOKMARK_STORAGE_UPDATED: 'BOOKMARK_STORAGE_UPDATED',
    
    // tab页相关
    UPDATE_TAB_STATE: 'UPDATE_TAB_STATE',
    
    // 同步相关
    FORCE_SYNC_BOOKMARK: 'FORCE_SYNC_BOOKMARK',
    SYNC_BOOKMARK_CHANGE: 'SYNC_BOOKMARK_CHANGE', // 废弃, 云同步功能已废弃
    EXECUTE_WEBDAV_SYNC: 'EXECUTE_WEBDAV_SYNC',
    EXECUTE_CLOUD_SYNC: 'EXECUTE_CLOUD_SYNC',
    SCHEDULE_SYNC: 'SCHEDULE_SYNC',
    RESET_CLOUD_SYNC_CACHE: 'RESET_CLOUD_SYNC_CACHE',

    // 快捷键相关
    TOGGLE_SEARCH: 'TOGGLE_SEARCH',

    // 设置页相关
    SWITCH_TO_TAB: 'SWITCH_TO_TAB',
    UPDATE_DOMAINS_LIST: 'UPDATE_DOMAINS_LIST',
    SETTINGS_CHANGED: 'SETTINGS_CHANGED',

    // 主题相关
    THEME_CHANGED: 'THEME_CHANGED',

    // Chrome 书签代理操作（bookmarkOps → background.js，避免事件通知竞态）
    PROXY_CHROME_BOOKMARK_CREATE: 'PROXY_CHROME_BOOKMARK_CREATE',
    PROXY_CHROME_BOOKMARK_UPDATE: 'PROXY_CHROME_BOOKMARK_UPDATE',
    PROXY_CHROME_BOOKMARK_REMOVE: 'PROXY_CHROME_BOOKMARK_REMOVE',
    PROXY_CHROME_BOOKMARK_MOVE: 'PROXY_CHROME_BOOKMARK_MOVE',
    PROXY_CHROME_BOOKMARK_REMOVE_TREE: 'PROXY_CHROME_BOOKMARK_REMOVE_TREE',

    // Background脚本对外接口
    SEARCH_BOOKMARKS: 'SEARCH_BOOKMARKS',
    GET_FULL_BOOKMARKS: 'GET_FULL_BOOKMARKS',
    GET_BOOKMARKS_LOCAL_CACHE: 'GET_BOOKMARKS_LOCAL_CACHE',
    SET_BOOKMARKS: 'SET_BOOKMARKS',
    REMOVE_BOOKMARKS: 'REMOVE_BOOKMARKS',
    CLEAR_BOOKMARKS: 'CLEAR_BOOKMARKS',
    UPDATE_BOOKMARKS_AND_EMBEDDING: 'UPDATE_BOOKMARKS_AND_EMBEDDING',
}

const ExternalMessageType = {
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    CHECK_LOGIN_STATUS: 'CHECK_LOGIN_STATUS',
}

const ScheduleSyncReason = {
    BOOKMARKS: 'bookmarks',
    SETTINGS: 'settings',
    FILTERS: 'filters',
    SERVICES: 'services',
}

const SyncStatus = {
    IDLE: 'idle',
    SYNCING: 'syncing'
}

const MAX_PINNED_SITES = 10;

/**
 * 浏览器标准根书签文件夹 id 集合（收藏夹栏 / 其他书签 / 移动设备书签）。
 * Edge 等浏览器会在根层额外注入"工作区"之类的专有文件夹，其 id 不在此集合中。
 */
const KNOWN_ROOT_BOOKMARK_FOLDER_IDS = new Set(['1', '2', '3']);

// 批量嵌入向量配置
const BATCH_EMBEDDING_CONFIG = {
    // 单次请求最大文本数量（保守设置，适配所有模型）
    MAX_BATCH_SIZE: 10,
    // 估算的最大 token 数（保守估计，避免超限）
    // 对于 bge-m3 模型，实际限制是 8192 tokens
    MAX_TOTAL_TOKENS: 8192
};

// 特性开关 - 用于暂时禁用某些功能
const FEATURE_FLAGS = {
    ENABLE_LOGIN: false,        // 暂时禁用登录功能
    ENABLE_CLOUD_SYNC: false,    // 暂时禁用云同步功能
    ENABLE_BROWSER_IMPORT: false, // 暂时禁用浏览器书签批量导入功能
};

// AI 支持的语言配置
const AI_SUPPORTED_LANGUAGES = {
    'zh': '中文',
    'en': '英文',
    'ja': '日文',
    'ko': '韩文',
    'fr': '法文',
    'de': '德文',
    'es': '西班牙文',
    'ru': '俄文',
    'pt': '葡萄牙文',
    'it': '意大利文'
};

// AI 语言显示名称（使用对应语言本身来显示）
const AI_LANGUAGE_DISPLAY_NAMES = {
    'zh': '中文',
    'en': 'English',
    'ja': '日本語',
    'ko': '한국어',
    'fr': 'Français',
    'de': 'Deutsch',
    'es': 'Español',
    'ru': 'Русский',
    'pt': 'Português',
    'it': 'Italiano'
};

/**
 * 根据浏览器语言获取默认目标语言
 * 使用 navigator.language 获取浏览器首选语言
 * @returns {string} 支持的语言代码，如果不支持则返回'en'
 */
function getDefaultTargetLanguage() {
    // 获取浏览器首选语言
    const browserLang = navigator.language || navigator.userLanguage || 'en';
    // 提取语言代码（如 'en-US' -> 'en', 'zh-CN' -> 'zh'）
    const langCode = browserLang.split('-')[0].toLowerCase();
    
    // 检查是否在支持的语言列表中
    if (AI_SUPPORTED_LANGUAGES[langCode]) {
        return langCode;
    }
    
    // 如果不支持，返回英文作为默认值
    return 'en';
}

// AI 默认目标语言（根据浏览器语言自动检测）
const AI_DEFAULT_TARGET_LANGUAGE = getDefaultTargetLanguage();
