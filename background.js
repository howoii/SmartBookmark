// background.js
importScripts('consts.js', 'common.js', 'env.js', 'logger.js', 'i18n.js', 'config.js', 'models.js', 'storageManager.js', 'settingsManager.js', 'statsManager.js',
     'util.js', 'api.js', 'search.js', 'customFilter.js', 'syncSettingManager.js', 'sync.js', 'webdavClient.js', 'webdavSync.js', 'autoSync.js',
     'chromeBookmarkSync.js');

EnvIdentifier = 'background';
// ------------------------------ 辅助函数分割线 ------------------------------
// 更新页面状态（图标和按钮）
async function updatePageState() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) return;

        const isSaved = await checkIfPageSaved(tab.url);
        await updateExtensionIcon(tab.id, isSaved);
        sendMessageSafely({ type: MessageType.UPDATE_TAB_STATE });
    } catch (error) {
        if (error.message?.includes('No tab with id')) {
            logger.debug('标签页已关闭，忽略状态更新');
            return;
        }
        logger.error('更新页面状态失败:', error);
    }
}

let _updatePageStateTimer = null;
const UPDATE_PAGE_STATE_DEBOUNCE_MS = 80;

function scheduleUpdatePageState() {
    if (_updatePageStateTimer) clearTimeout(_updatePageStateTimer);
    _updatePageStateTimer = setTimeout(() => {
        _updatePageStateTimer = null;
        updatePageState();
    }, UPDATE_PAGE_STATE_DEBOUNCE_MS);
}

// 创建初始化函数
async function initializeExtension() {
    try {
        await Promise.all([
            LocalStorageMgr.init(),
            SettingsManager.init(),
            SyncSettingsManager.init(),
        ]);
        
        // 初始化自动同步系统
        await AutoSyncManager.initialize();
        
        logger.info("扩展初始化完成");
    } catch (error) {
        logger.error("扩展初始化失败:", error);
    }
}

// ------------------------------ 事件监听分割线 ------------------------------
logger.info("background.js init");

// 调用初始化函数
initializeExtension();

// 设置侧边栏行为   
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => logger.error(error));

// 监听插件首次安装时的事件
chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
    const currentVersion = chrome.runtime.getManifest().version;
    if (reason === 'install') {
        logger.info("Smart Bookmark 插件已成功安装！");
        try {
            await ChromeBookmarkSync.runBootstrapSync({
                reason,
                previousVersion,
                currentVersion,
            });
        } catch (error) {
            logger.error('安装期浏览器书签同步失败:', error);
        }
        // 打开介绍页
        chrome.tabs.create({
            url: chrome.runtime.getURL('intro.html')
        });
    } else if (reason === 'update') {
        logger.info("Smart Bookmark 插件已成功更新！");
        try {
            await ChromeBookmarkSync.runBootstrapSync({
                reason,
                previousVersion,
                currentVersion,
            });
        } catch (error) {
            logger.error('升级期浏览器书签同步失败:', error);
        }
        // 打开介绍页
        const introCompleted = await LocalStorageMgr.get('intro-completed');
        if (!introCompleted) {
            chrome.tabs.create({
                url: chrome.runtime.getURL('intro.html')
            });
        }
    }
});

// 监听来自插件内部的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    logger.debug("background 收到消息", {
        message: message, // message 格式为 { type: MessageType, data: any }
        sender: sender,
    });

    if (message.type === MessageType.SYNC_BOOKMARK_CHANGE) { // 废弃, 云同步功能已废弃
        syncManager.recordBookmarkChange(message.data.bookmarks, message.data.isDeleted)
            .then(() => sendResponse({ success: true }))
            .catch(error => {
                logger.error('Error during sync:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === MessageType.EXECUTE_WEBDAV_SYNC) {
        // 执行WebDAV同步
        AutoSyncManager.executeWebDAVSync()
            .then(result => {
                logger.debug('发送WebDAV同步结果:', result);
                sendResponse({ success: result.success, result: result.result, error: result.error });
            })
            .catch(error => {
                logger.error('WebDAV同步失败:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === MessageType.EXECUTE_CLOUD_SYNC) {
        // 检查云同步功能是否启用
        if (!FEATURE_FLAGS.ENABLE_CLOUD_SYNC) {
            sendResponse({ success: false, error: i18n.getMessage('autosync_error_cloud_sync_disabled') });
            return false; // 同步调用 sendResponse，不需要返回 true
        }
        // 执行云同步
        AutoSyncManager.executeCloudSync()
            .then(result => {
                sendResponse({ success: result.success, result: result.result, error: result.error });
            })
            .catch(error => {
                logger.error('云同步失败:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === MessageType.SCHEDULE_SYNC) {
        // 预定同步请求，由数据变更触发
        AutoSyncManager.handleScheduledSync(message.data)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch(error => {
                logger.error('处理预定同步请求失败:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === MessageType.RESET_CLOUD_SYNC_CACHE) {
        // 重置同步缓存
        syncManager.resetSyncCache()
            .then(() => {
                sendResponse({ success: true });
            }).catch(error => {
                logger.error('重置同步缓存失败:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === MessageType.SEARCH_BOOKMARKS) {
        searchManager.search(message.data.query, message.data.options).then(results => {
            sendResponse({ success: true, results: results });
        }).catch(error => {
            logger.error('搜索书签失败:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    } else if (message.type === MessageType.GET_FULL_BOOKMARKS) {
        LocalStorageMgr.getBookmarks()
            .then(bookmarks => {
                sendResponse({ success: true, bookmarks: bookmarks });
            })
            .catch(error => {
                logger.error('获取书签失败:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === MessageType.GET_BOOKMARKS_LOCAL_CACHE) {
        // 非 background 页面冷启动时从此获取书签缓存，确保拿到最新数据（含刚更新后未 flush 到 storage 的）
        LocalStorageMgr.getBookmarksFromLocalCache()
            .then(bookmarksMap => {
                sendResponse({ success: true, bookmarksMap: bookmarksMap });
            })
            .catch(error => {
                logger.error('获取书签本地缓存失败:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === MessageType.SET_BOOKMARKS) {
        LocalStorageMgr.setBookmarks(message.data.bookmarks, message.data.options)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch(error => {
                logger.error('更新书签失败:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === MessageType.REMOVE_BOOKMARKS) {
        LocalStorageMgr.removeBookmarks(message.data.urls, message.data.options)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch(error => {
                logger.error('删除书签失败:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === MessageType.CLEAR_BOOKMARKS) {
        LocalStorageMgr.clearBookmarks(message.data.options)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch(error => {
                logger.error('清除书签失败:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === MessageType.UPDATE_BOOKMARKS_AND_EMBEDDING) {
        LocalStorageMgr.updateBookmarksAndEmbedding(message.data.bookmarks, message.data.options)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch(error => {
                logger.error('更新书签和向量失败:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === MessageType.PROXY_CHROME_BOOKMARK_CREATE) {
        ChromeBookmarkSync.proxyCreate(message.data.createDetails)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    } else if (message.type === MessageType.PROXY_CHROME_BOOKMARK_UPDATE) {
        ChromeBookmarkSync.proxyUpdate(message.data.chromeId, message.data.changes)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    } else if (message.type === MessageType.PROXY_CHROME_BOOKMARK_REMOVE) {
        ChromeBookmarkSync.proxyRemove(message.data.chromeId)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    } else if (message.type === MessageType.PROXY_CHROME_BOOKMARK_MOVE) {
        ChromeBookmarkSync.proxyMove(message.data.chromeId, message.data.destination)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    } else if (message.type === MessageType.PROXY_CHROME_BOOKMARK_REMOVE_TREE) {
        ChromeBookmarkSync.proxyRemoveTree(message.data.chromeId)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

// 监听来自登录页面的消息
chrome.runtime.onMessageExternal.addListener(async (message, sender, sendResponse) => {
    logger.debug("background 收到网页消息", {
        message: message,
        sender: sender,
    }); 
    if (sender.origin !== SERVER_URL) {
        return;
    }
    // 如果登录功能被禁用，直接返回
    if (!FEATURE_FLAGS.ENABLE_LOGIN) {
        return;
    }
    if (message.type === ExternalMessageType.LOGIN_SUCCESS) {
        const { token, user } = message.data;
        logger.debug('登录成功', {user: user});

        const lastUser = await LocalStorageMgr.get('user');
        const lastSyncVersion = await LocalStorageMgr.get('lastSyncVersion') || 0;
        if (lastUser && lastUser.id !== user.id && lastSyncVersion > 0) {
            // 如果用户发生变化，则需要重新同步全部书签
            await syncManager.resetSyncCache();
        }
            
        Promise.all([
            LocalStorageMgr.set('token', token),
            LocalStorageMgr.set('user', user)
        ]).then(() => {
            sendResponse({ success: true });
        });
            
        // 重要：返回 true 表示我们会异步发送响应
        return true;
    }  else if (message.type === ExternalMessageType.CHECK_LOGIN_STATUS) {
        const token = await LocalStorageMgr.get('token');
        const user = await LocalStorageMgr.get('user');
        sendResponse({ success: true, token: token, user: user });
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

// 标签页 URL 变化时更新图标状态（仅活动标签页，避免后台标签页冗余调用）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && tab.active) {
        scheduleUpdatePageState();
    }
});

// 切换标签页时更新图标状态
chrome.tabs.onActivated.addListener(() => {
    scheduleUpdatePageState();
});

// 切换窗口时更新图标状态
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    scheduleUpdatePageState();
});

// 监听快捷键命令
chrome.commands.onCommand.addListener(async (command) => {
    // 获取当前激活的标签页
    const [tab] = await chrome.tabs.query({ 
        active: true, 
        currentWindow: true
    });
    if (!tab) {
        logger.debug('未找到活动标签页，无法执行快捷键命令');
        return;
    }
    logger.debug('执行快捷键命令', {command: command, tab: tab});
    if (command === "quick-search") {
        try {
            // 确保当前窗口是活动的
            await chrome.windows.update(tab.windowId, { focused: true });
            handleRuntimeError();
            // 打开弹出窗口
            await chrome.action.setPopup({popup: 'quickSearch.html'});
            await chrome.action.openPopup({windowId: tab.windowId});
        } catch (error) {
            logger.error('处理弹出窗口失败:', error);
        }
    } else if (command === "quick-save") {
        try {
            // 确保当前窗口是活动的
            await chrome.windows.update(tab.windowId, { focused: true });
            handleRuntimeError();
            // 打开弹出窗口
            await chrome.action.setPopup({popup: 'quickSave.html'});
            await chrome.action.openPopup({windowId: tab.windowId});
        } catch (error) {
            logger.error('处理弹出窗口失败:', error);
        }
    }
});

// 地址栏事件监听
if (chrome.omnibox) {
    let cachedQuery = '';
    chrome.omnibox.setDefaultSuggestion({
        description: `输入搜索词，按Space键开始搜索`,
    });

    chrome.omnibox.onInputStarted.addListener(() => {
        logger.debug("Omnibox 输入开始");
        cachedQuery = '';
    });

    chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
        logger.debug("Omnibox 输入变化", {
            text: text,
        });
        const query = text.trim();
        const description = `${query ? `按Space键开始搜索: ${query}` : '输入搜索词，按Space键开始搜索'}`;
        chrome.omnibox.setDefaultSuggestion({
            description: description,
        });

        // 如果输入不是以空格结尾，则不进行搜索
        if (!text.endsWith(' ')) {
            return;
        }
        if (!query || query.length < 2) {
            logger.debug("Omnibox 输入太短，不进行搜索");
            return;
        }
        cachedQuery = query;

        try {
            // 获取用户设置的omnibox结果数量限制
            const settings = await SettingsManager.getAll();
            const omniboxLimit = settings.search?.omniboxSearchLimit || 5;

            const results = await searchManager.search(query, {
                debounce: false,
                maxResults: omniboxLimit, // 使用设置中的限制值
                includeUrl: true,
                recordSearch: false
            });

            const suggestions = results.map((result) => {
                const title = escapeXml(result.title);
                const url = escapeXml(result.url);

                const description = `
                    <dim>${title}</dim>
                    | 🔗<url>${url}</url>
                `.trim().replace(/\s+/g, ' ');
                return {
                    content: url,
                    description: description
                };
            });

            suggest(suggestions);
        } catch (error) {
            logger.error('生成搜索建议失败:', error);
        }
    });

    chrome.omnibox.onInputEntered.addListener(async (url) => {
        logger.debug("Omnibox 输入完成", {
            url: url,
        });
        // 检查url格式，如果不是正确的url则返回
        url = url.trim();
        if (!url) return;
        
        try {
            new URL(url);
        } catch (error) {
            logger.debug('输入非URL:', {
                url: url,
                error: error,
            });
            const newURL = 'https://www.google.com/search?q=' + encodeURIComponent(url);
            chrome.tabs.create({ url: newURL });
            return;
        }
        
        // 更新使用频率
        await Promise.all([
            updateBookmarkUsage(url),
            searchManager.searchHistoryManager.addSearch(cachedQuery)
        ]);
        // 在当前标签页打开URL
        chrome.tabs.create({ url: url });
    });

    chrome.omnibox.onInputStarted.addListener(() => {
        logger.debug("Omnibox 输入开始");
    });

    chrome.omnibox.onInputCancelled.addListener(() => {
        logger.debug("Omnibox 输入取消");
    });
} else {
    logger.error("Omnibox API 不可用");
}

// 监听闹钟触发事件
chrome.alarms.onAlarm.addListener(async (alarm) => {
    await AutoSyncManager.handleAlarm(alarm);
});

// 注册 Chrome 书签事件监听（mute + 外部变更同步 + 刷新通知）
ChromeBookmarkSync.registerListeners();
