// 业务无关的辅助函数

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