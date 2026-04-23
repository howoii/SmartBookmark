// 业务无关的辅助函数

// ==================== API 错误处理统一工具 ====================

/** 用户取消请求时的标准错误标识 */
const USER_CANCELED = 'UserCanceled';

/**
 * 判断错误是否为 fetch 中断产生的 AbortError
 * 注意：某些环境下 abort(reason) 可能将 reason 字符串直接作为 reject 值传递
 * @param {Error|string} error - 捕获的错误对象或字符串
 * @returns {boolean}
 */
function isAbortError(error) {
    if (typeof error === 'string' && error.includes(USER_CANCELED)) {
        return true;
    }
    return error?.name === 'AbortError' ||
        (error?.message && String(error.message).toLowerCase().includes('aborted'));
}

/**
 * 判断错误是否为用户取消（包括 AbortError、已规范化的 UserCanceled、以及 abort(reason) 传入的字符串）
 * 注意：AbortController.abort('UserCanceled') 时，fetch 的 catch 可能收到字符串而非 Error 对象
 * @param {Error|string} error - 捕获的错误对象或字符串
 * @returns {boolean}
 */
function isUserCanceledError(error) {
    if (error === USER_CANCELED || (typeof error === 'string' && error.includes(USER_CANCELED))) {
        return true;
    }
    return error?.message === USER_CANCELED ||
        (error?.message && error.message.includes(USER_CANCELED));
}

/**
 * 在 catch 块中调用：若为 AbortError 则抛出 UserCanceled，否则不处理
 * 用于内层 catch，在解析响应体时若用户已取消，需正确传递取消状态
 * @param {Error} error - 捕获的错误对象
 * @throws {Error} 若为 AbortError 则抛出 UserCanceled
 */
function throwIfAbortError(error) {
    if (isAbortError(error)) {
        throw new Error(USER_CANCELED);
    }
}

/**
 * 在 API 调用的最外层 catch 中调用：将 AbortError 规范化为 UserCanceled 后抛出
 * @param {Error} error - 捕获的错误对象
 * @throws {Error} 若为 AbortError 或已是 UserCanceled，抛出 UserCanceled；否则重新抛出原错误
 */
function normalizeApiError(error) {
    if (isAbortError(error) || isUserCanceledError(error)) {
        throw new Error(USER_CANCELED);
    }
    throw error;
}

// 睡眠函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 安全地发送消息的辅助函数
function sendMessageSafely(message, callback = null) {
    message.env = EnvIdentifier;
    chrome.runtime.sendMessage(message, (response) => {
        // 检查是否有错误，但不做任何处理
        // 这样可以防止未捕获的错误
        const lastError = chrome.runtime.lastError;
        if (lastError) {
            logger.debug('消息处理失败:', {
                error: lastError.message,
                message: message
            });
        }
        if (callback) {
            callback(response);
        }
    });
}

// 处理运行时错误
function handleRuntimeError() {
    const error = chrome.runtime.lastError;
    if (error) {
        throw new Error(error);
    }
}

// 添加 XML 转义函数
function escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/[<>&'"]/g, c => {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
                default: return c;
            }
        });
}

// 计算字符串的视觉长度
function getStringVisualLength(str) {
    let length = 0;
    for (let i = 0; i < str.length; i++) {
        // 中日韩文字计为2个单位长度
        if (/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf]/.test(str[i])) {
            length += 2;
        }
        // 其他字符计为1个单位长度
        else {
            length += 1;
        }
    }
    return length;
}

// 获取网站图标的辅函数
async function getFaviconUrl(bookmarkUrl) {
    try {
        const url = new URL(chrome.runtime.getURL("/_favicon/"));
        url.searchParams.set("pageUrl", bookmarkUrl);
        url.searchParams.set("size", "32");

        return url.toString();  
    } catch (error) {
        logger.error('获取网站图标失败:', error);
        return 'icons/default_favicon.png'; // 返回默认图标
    }
}

/**
 * 根据用户语言获取支持网站页面 URL
 * @param {string} page - 页面名称，如 'changelog', 'donate'
 * @returns {string} 完整的 URL
 */
function getSupportPageUrl(page) {
    const userLang = navigator.language || navigator.userLanguage;
    const isZH = userLang.toLowerCase().includes('zh');
    const baseUrl = 'https://howoii.github.io/smartbookmark-support';
    
    // 中文返回根目录下的页面，英文/其他语言返回 en 子目录
    return isZH ? `${baseUrl}/${page}.html` : `${baseUrl}/en/${page}.html`;
}

/**
 * 根据浏览器类型获取扩展商店链接
 * @returns {string} 商店详情页链接
 */
function getExtensionStoreUrl() {
    const extensionId = chrome.runtime.id;
    const userAgent = navigator.userAgent;
    const isEdge = userAgent.indexOf('Edg') !== -1;
    const isChrome = userAgent.indexOf('Chrome') !== -1 && !isEdge;

    if (isEdge) {
        // Edge 商店链接
        return `https://microsoftedge.microsoft.com/addons/detail/${extensionId}`;
    } else if (isChrome) {
        // Chrome 商店链接
        return `https://chromewebstore.google.com/detail/smart-bookmark/${extensionId}`;
    } else {
        // 默认使用 Chrome 商店链接（兼容其他 Chromium 浏览器）
        return 'https://chromewebstore.google.com/detail/smart-bookmark/nlboajobccgidfcdoedphgfaklelifoa';
    }
}

/**
 * 获取扩展商店评分页链接
 * @returns {string} 商店评分页链接
 */
function getExtensionStoreReviewUrl() {
    const storeUrl = getExtensionStoreUrl();
    const userAgent = navigator.userAgent;
    const isEdge = userAgent.indexOf('Edg') !== -1;
    
    // Edge 商店的评分和详情页是同一个链接，Chrome 商店需要加 /reviews
    return isEdge ? storeUrl : `${storeUrl}/reviews`;
}

// 更新扩展图标状态
async function updateExtensionIcon(tabId, isSaved) {
    try {
        let iconName = isSaved ? 'saved_32.png' : 'unsaved_32.png';
        const iconPath = `icons/${iconName}`;

        await chrome.action.setIcon({
            tabId: tabId,
            path: iconPath
        });
    } catch (error) {
        logger.error('更新图标失败:', {
            error: error.message,
            tabId: tabId,
            isSaved: isSaved,
            stack: error.stack
        });
    }
}