// 定义日志级别常量
const LOG_LEVELS = {
    TRACE: 0,
    DEBUG: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4
};

const logger = {
    info: (...args) => {
        if (LOG_LEVEL <= LOG_LEVELS.INFO) {
            console.log('%c[INFO]', 'color: #2ecc71; font-weight: bold;', ...args);
        }
    },
    
    warn: (...args) => {
        if (LOG_LEVEL <= LOG_LEVELS.WARN) {
            console.log('%c[WARN]', 'color: #f1c40f; font-weight: bold;', ...args);
        }
    },
    
    error: (...args) => {
        if (LOG_LEVEL <= LOG_LEVELS.ERROR) {
            console.log('%c[ERROR]', 'color: #e74c3c; font-weight: bold;', ...args);
        }
    },
    
    debug: (...args) => {
        if (LOG_LEVEL <= LOG_LEVELS.DEBUG) {
            console.log('%c[DEBUG]', 'color: #3498db; font-weight: bold;', ...args);
        }
    },
    
    trace: (...args) => {
        if (LOG_LEVEL <= LOG_LEVELS.TRACE) {
            console.log('%c[TRACE]', 'color: #95a5a6; font-weight: bold;', ...args);
        }
    }
};

async function validateToken() {
    const token = await LocalStorageMgr.get('token');
    logger.debug('检查登录token是否过期', {token: token});
    if (!token) {
        return {valid: false, user: null};
    }

    try {
        // 解析 JWT token
        const tokenData = JSON.parse(atob(token.split('.')[1]));
        // 检查 token 是否过期
        if (tokenData.exp && tokenData.exp < Date.now() / 1000) {
            // token 已过期，清除登录状态
            await LocalStorageMgr.remove(['token', 'user']);
            return {valid: false, user: null};
        }

        return {valid: true, user: tokenData};
    } catch (error) {
        logger.error('Token 解析失败:', error);
        return {valid: false, user: null};
    }
}

// 安全地发送消息的辅助函数
function sendMessageSafely(message) {
    chrome.runtime.sendMessage(message, () => {
        // 检查是否有错误，但不做任何处理
        // 这样可以防止未捕获的错误
        const lastError = chrome.runtime.lastError;
    });
}

// 检查页面是否已收藏
async function checkIfPageSaved(url) {
    const result = await LocalStorageMgr.getBookmark(url);
    return !!result;
}

// 更新扩展图标状态
async function updateExtensionIcon(tabId, isSaved) {
    try {
        await chrome.action.setIcon({
            tabId: tabId,
            path: {
                "32": `/icons/${isSaved ? 'saved' : 'unsaved'}_32.png`,
                "48": `/icons/${isSaved ? 'saved' : 'unsaved'}_48.png`,
                "128": `/icons/${isSaved ? 'saved' : 'unsaved'}_128.png`,
            }
        }, () => {
            if (chrome.runtime.lastError) {
                logger.error('更新图标失败:', chrome.runtime.lastError);
            }
        });
    } catch (error) {
        logger.error('更新图标失败:', error);
    }
}

async function openOptionsPage(section='overview') {
    // 查找所有标签页
    const tabs = await chrome.tabs.query({
        url: chrome.runtime.getURL('settings.html*')  // 使用通配符匹配任何hash
    });
    
    if (tabs.length > 0) {
        chrome.runtime.openOptionsPage(()=>{
            sendMessageSafely({
                type: 'SWITCH_TO_TAB',
                tab: section
            });
        });
    } else {
        // 如果没有找到settings页面，创建新页面
        await chrome.tabs.create({
            url: chrome.runtime.getURL('settings.html#' + section)
        });
    }
}