// background.js
importScripts('storageManager.js', 'util.js', 'env.js', 'sync.js');

// ------------------------------ 辅助函数分割线 ------------------------------
// 更新页面状态（图标和按钮）
async function updatePageState() {
    try {
        const [tab] = await chrome.tabs.query({ 
            active: true, 
            currentWindow: true 
        });
        
        if (!tab) {
            logger.debug('未找到活动标签页');
            return;
        }

        // 检查标签页是否仍然存在
        try {
            await chrome.tabs.get(tab.id);
        } catch (error) {
            logger.debug('标签页已不存在:', tab.id);
            return;
        }

        const isSaved = await checkIfPageSaved(tab.url);
        await updateExtensionIcon(tab.id, isSaved);
        sendMessageSafely({
            type: 'UPDATE_TAB_STATE'
        });
    } catch (error) {
        logger.error('更新页面状态失败:', error);
    }
}

let syncManager = null;
async function getSyncManager() {
    if (!syncManager) {
        syncManager = new SyncManager();
        await syncManager.init();
    }
    return syncManager;
}

// ------------------------------ 事件监听分割线 ------------------------------
logger.info("background.js init");

// 设置侧边栏行为   
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => logger.error(error));

// 监听插件首次安装时的事件
chrome.runtime.onInstalled.addListener(() => {
    logger.info("Smart Bookmark 插件已成功安装！");
});

// 监听来自插件内部的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    logger.debug("background 收到消息", {
        message: message,
        sender: sender,
    });

    if (message.type === 'FORCE_SYNC_BOOKMARK') {
        getSyncManager()
            .then(syncManager => syncManager.forceSync())
            .then(() => sendResponse({ success: true }))
            .catch(error => {
                logger.error('Error during sync:', error);
                sendResponse({ success: false, error: error.message });
            });

        return true;
    } else if (message.type === 'SYNC_BOOKMARK_CHANGE') {
        getSyncManager()
            .then(syncManager => syncManager.recordBookmarkChange(message.data.bookmarks, message.data.isDeleted))
            .then(() => sendResponse({ success: true }))
            .catch(error => {
                logger.error('Error during sync:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }
});

// 监听来自登录页面的消息
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    logger.debug("background 收到网页消息", {
        message: message,
        sender: sender,
    }); 
    if (sender.origin !== SERVER_URL) {
        return;
    }   
    if (message.type === 'LOGIN_SUCCESS') {
        const { token, user } = message.data;
            
        Promise.all([
            LocalStorageMgr.set('token', token),
            LocalStorageMgr.set('user', user)
        ]).then(() => {
            sendResponse({ success: true });
        });
            
        // 重要：返回 true 表示我们会异步发送响应
        return true;
    } 
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'local') {
        if (changes['lastSyncVersion']) {
            const newValue = changes['lastSyncVersion'].newValue || 0;
            if (syncManager && newValue == 0) {
                await syncManager.cleanup();
            }
        }
    }
});

// 监听标签页更新事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    logger.debug("background 标签页更新", {
        tabId: tabId,
        changeInfo: changeInfo,
        tab: tab,
    });
    if (changeInfo.url) {
        try {
            updatePageState().catch(error => {
                if (error.message.includes('No tab with id')) {
                    logger.debug('标签页已关闭，忽略更新');
                    return;
                }
                logger.error('更新页面状态失败:', error);
            });
        } catch (error) {
            logger.error('处理标签页更新事件失败:', error);
        }
    }
});

// 监听标签页激活事件（切换标签页）
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    logger.debug("background 标签页激活", {
        activeInfo: activeInfo,
    });
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url) {
            updatePageState();
        }
    } catch (error) {
        logger.error('获取标签页信息失败:', error);
    }
});

// 监听窗口焦点变化事件（切换窗口）
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    logger.debug("background 窗口焦点变化", {
        windowId: windowId,
    });
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    
    try {
        updatePageState();
    } catch (error) {
        logger.error('获取窗口活动标签页失败:', error);
    }
});

// 监听快捷键命令
chrome.commands.onCommand.addListener(async (command) => {
    if (command === "toggle-search") {
        // 获取当前激活的标签页
        const [tab] = await chrome.tabs.query({ 
            active: true, 
        });
        if (tab) {
            sendMessageSafely({
                type: 'TOGGLE_SEARCH',
            });
        }
    }
});