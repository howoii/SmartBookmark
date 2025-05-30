const MessageType = {
    // 书签相关
    BOOKMARKS_UPDATED: 'BOOKMARKS_UPDATED',
    BOOKMARK_STORAGE_UPDATED: 'BOOKMARK_STORAGE_UPDATED',
    TRIGGER_BOOKMARK_CACHE_UPDATE: 'TRIGGER_BOOKMARK_CACHE_UPDATE',
    
    // tab页相关
    UPDATE_TAB_STATE: 'UPDATE_TAB_STATE',
    
    // 同步相关
    FORCE_SYNC_BOOKMARK: 'FORCE_SYNC_BOOKMARK',
    SYNC_BOOKMARK_CHANGE: 'SYNC_BOOKMARK_CHANGE',
    EXECUTE_WEBDAV_SYNC: 'EXECUTE_WEBDAV_SYNC',
    EXECUTE_CLOUD_SYNC: 'EXECUTE_CLOUD_SYNC',
    SCHEDULE_SYNC: 'SCHEDULE_SYNC',
    RESET_CLOUD_SYNC_CACHE: 'RESET_CLOUD_SYNC_CACHE',

    // 快捷键相关
    TOGGLE_SEARCH: 'TOGGLE_SEARCH',

    // 设置页相关
    SWITCH_TO_TAB: 'SWITCH_TO_TAB',
    UPDATE_DOMAINS_LIST: 'UPDATE_DOMAINS_LIST',

    // 主题相关
    THEME_CHANGED: 'THEME_CHANGED',
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