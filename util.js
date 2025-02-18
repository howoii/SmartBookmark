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

async function validateToken() {
    const token = await LocalStorageMgr.get('token');
    logger.debug('检查登录token是否过期', { token: token });
    if (!token) {
        return { valid: false, user: null };
    }

    try {
        // 解析 JWT token
        const tokenData = JSON.parse(atob(token.split('.')[1]));
        // 检查 token 是否过期
        if (tokenData.exp && tokenData.exp < Date.now() / 1000) {
            // token 已过期，清除登录状态
            await LocalStorageMgr.remove(['token']);
            return { valid: false, user: null };
        }

        return { valid: true, user: tokenData };
    } catch (error) {
        logger.error('Token 解析失败:', error);
        return { valid: false, user: null };
    }
}

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

function handleRuntimeError() {
    const error = chrome.runtime.lastError;
    if (error) {
        throw new Error(error);
    }
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

async function recordBookmarkChange(bookmarks, isDeleted = false, beginSync = true, onError = null) {
    sendMessageSafely({
        type: MessageType.SYNC_BOOKMARK_CHANGE,
        data: { bookmarks, isDeleted, beginSync }
    }, (response) => {
        logger.debug("recordBookmarkChange response", response);
        if (!response.success && onError) {
            onError(response.error);
        }
    });
}

// 检查页面是否已收藏
async function checkIfPageSaved(url) {
    const result = await LocalStorageMgr.getBookmark(url, true);
    return !!result;
}

// 更新扩展图标状态
async function updateExtensionIcon(tabId, isSaved) {
    try {
        await chrome.action.setIcon({
            tabId: tabId,
            path: {
                "16": `icons/${isSaved ? 'saved' : 'unsaved'}_16.png`,
                "32": `icons/${isSaved ? 'saved' : 'unsaved'}_32.png`,
                "48": `icons/${isSaved ? 'saved' : 'unsaved'}_48.png`,
                "128": `icons/${isSaved ? 'saved' : 'unsaved'}_128.png`
            }
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

async function openOptionsPage(section = 'overview') {
    // 查找所有标签页
    const tabs = await chrome.tabs.query({
        url: chrome.runtime.getURL('settings.html*')  // 使用通配符匹配任何hash
    });

    if (tabs.length > 0) {
        chrome.runtime.openOptionsPage(() => {
            sendMessageSafely({
                type: MessageType.SWITCH_TO_TAB,
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

// 修改更新书签使用频率的函数
async function updateBookmarkUsage(url) {
    try {
        const data = await LocalStorageMgr.getBookmark(url, true);
        if (data) {
            const bookmark = data;

            // 更新使用次数和最后使用时间
            bookmark.useCount = calculateWeightedScore(
                bookmark.useCount,
                bookmark.lastUsed
            ) + 1;
            bookmark.lastUsed = new Date().toISOString();

            await LocalStorageMgr.setBookmark(url, bookmark);
            return bookmark;
        }
    } catch (error) {
        logger.error('更新书签使用频率失败:', error);
    }
    return null;
}

// 添加计算加权使用分数的函数
function calculateWeightedScore(useCount, lastUsed) {
    if (!useCount || !lastUsed) return 0;

    const now = new Date();
    const lastUsedDate = new Date(lastUsed);
    const daysDiff = Math.floor((now - lastUsedDate) / (1000 * 60 * 60 * 24)); // 转换为天数并向下取整

    // 使用指数衰减函数
    // 半衰期设为30天，即30天前的使用次数权重减半
    const decayFactor = Math.exp(-Math.log(2) * daysDiff / 30);

    // 基础分数 = 使用次数 * 时间衰减因子
    const weightedScore = useCount * decayFactor;

    // 返回四舍五入后的整数
    return Math.round(weightedScore);
}

async function getAllBookmarks(includeChromeBookmarks = false) {
    try {
        // 获取扩展书签
        const extensionBookmarks = await LocalStorageMgr.getBookmarks();
        const extensionBookmarksMap = Object.entries(extensionBookmarks)
            .reduce((map, [_, data]) => {
                const bookmark = new UnifiedBookmark(data, BookmarkSource.EXTENSION);
                map[bookmark.url] = bookmark;
                return map;
            }, {});

        let chromeBookmarksMap = {};
        // 获取Chrome书签
        if (includeChromeBookmarks) {
            const chromeBookmarks = await getChromeBookmarks();
            chromeBookmarksMap = chromeBookmarks
                .reduce((map, bookmark) => {
                    // 如果URL已经存在于扩展书签中,则跳过
                    if (extensionBookmarksMap[bookmark.url]) {
                        return map;
                    }
                    const unifiedBookmark = new UnifiedBookmark(bookmark, BookmarkSource.CHROME);
                    map[bookmark.url] = unifiedBookmark;
                    return map;
                }, {});
        }

        // 合并并过滤扩展程序页面
        const allBookmarks = { ...extensionBookmarksMap, ...chromeBookmarksMap };
        return Object.entries(allBookmarks).reduce((map, [url, bookmark]) => {
            if (!isNonMarkableUrl(bookmark.url)) {
                map[url] = bookmark;
            }
            return map;
        }, {});
    } catch (error) {
        logger.error('获取书签失败:', error);
        return {};
    }
}

async function getDisplayedBookmarks() {
    const showChromeBookmarks = await SettingsManager.get('display.showChromeBookmarks');
    return await getAllBookmarks(showChromeBookmarks);
}

// 获取Chrome书签的辅助函数
async function getChromeBookmarks() {
    try {
        const bookmarkTree = await chrome.bookmarks.getTree();
        return flattenBookmarkTree(bookmarkTree);
    } catch (error) {
        logger.error('获取Chrome书签失败:', error);
        return [];
    }
}

// 展平书签树的辅助函数
function flattenBookmarkTree(nodes, parentFolders = []) {
    const bookmarks = [];

    function traverse(node, folders, level = 0) {
        // 如果是文件夹，添加到路径中
        if (!node.url) {
            const currentFolders = [...folders];
            if (node.title && level > 1) { // 排除根文件夹
                currentFolders.push(node.title);
            }

            if (node.children) {
                node.children.forEach(child => traverse(child, currentFolders, level + 1));
            }
        } else {
            // 如果是书签，添加文件夹路径作为标签
            bookmarks.push({
                ...node,
                folderTags: folders.filter(folder => folder.trim() !== '')
            });
        }
    }

    nodes.forEach(node => traverse(node, parentFolders));
    return bookmarks;
}

// 检查URL是否不可标记
function isNonMarkableUrl(url) {
    try {
        // 1. 基本URL格式检查
        if (!url || typeof url !== 'string') {
            logger.debug('无效URL格式');
            return true;
        }

        // 2. 解析URL
        const urlObj = new URL(url);

        // 3. 定义不可标记的URL模式
        const nonMarkablePatterns = {
            // Chrome特殊页面
            chromeInternal: {
                pattern: /^chrome(?:-extension|-search|-devtools|-component)?:\/\//i,
                description: 'Chrome内部页面',
                example: 'chrome://, chrome-extension://'
            },

            // 浏览器设置和内部页面
            browserInternal: {
                pattern: /^(?:about|edge|browser|file|view-source):/i,
                description: '浏览器内部页面',
                example: 'about:blank, file:///'
            },

            // 扩展和应用页面
            extensionPages: {
                pattern: /^(?:chrome-extension|moz-extension|extension):\/\//i,
                description: '浏览器扩展页面',
                example: 'chrome-extension://'
            },

            // 本地开发服务器
            localDevelopment: {
                pattern: /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|::1)(?::[0-9]+)?(?:\/|$)/i,
                description: '本地开发服务器',
                example: 'http://localhost:3000/'
            },

            // Web Socket连接
            webSocket: {
                pattern: /^wss?:/i,
                description: 'WebSocket连接',
                example: 'ws://, wss://'
            },

            // 数据URL
            dataUrl: {
                pattern: /^data:/i,
                description: '数据URL',
                example: 'data:text/plain'
            },

            // 空白页和无效页面
            emptyPages: {
                pattern: /^(?:about:blank|about:newtab|about:home)$/i,
                description: '空白页面',
                example: 'about:blank'
            }
        };

        // 4. 检查是否匹配任何不可标记模式
        for (const [key, rule] of Object.entries(nonMarkablePatterns)) {
            if (rule.pattern.test(url)) {
                logger.debug('URL不可标记:', {
                    url: url,
                    reason: rule.description,
                    pattern: rule.pattern.toString(),
                    example: rule.example,
                    protocol: urlObj.protocol
                });

                // 5. 检查是否有例外情况
                if (shouldAllowNonMarkableException(url, key)) {
                    logger.debug('URL虽然匹配不可标记规则，但属于例外情况');
                    continue;
                }

                return true;
            }
        }

        // 6. 检查URL长度限制
        const MAX_URL_LENGTH = 2048; // 常见浏览器的URL长度限制
        if (url.length > MAX_URL_LENGTH) {
            logger.debug('URL长度超出限制:', {
                url: url.substring(0, 100) + '...',
                length: url.length,
                maxLength: MAX_URL_LENGTH
            });
            return true;
        }

        // 7. 检查协议安全性
        if (!urlObj.protocol.match(/^https?:$/i)) {
            logger.debug('不支持的URL协议:', {
                url: url,
                protocol: urlObj.protocol
            });
            return true;
        }

        return false;

    } catch (error) {
        logger.error('URL检查失败:', error);
        return true; // 出错时默认为不可标记
    }
}

// 处理特殊例外情况
function shouldAllowNonMarkableException(url, ruleKey) {
    try {
        const urlObj = new URL(url);

        // 1. 允许特定的本地开发环境
        if (ruleKey === 'localDevelopment') {
            const allowedLocalPaths = [
                /^\/docs\//i,
                /^\/api\//i,
                /^\/swagger\//i
            ];
            if (allowedLocalPaths.some(pattern => pattern.test(urlObj.pathname))) {
                return true;
            }
        }

        // 2. 允许特定的Chrome扩展页面
        if (ruleKey === 'extensionPages') {
            const allowedExtensionPages = [
                /\/documentation\.html$/i,
                /\/help\.html$/i
            ];
            if (allowedExtensionPages.some(pattern => pattern.test(urlObj.pathname))) {
                return true;
            }
        }

        return false;
    } catch (error) {
        logger.error('处理URL例外情况时出错:', error);
        return false;
    }
}

// 处理标签格式的辅助函数
function cleanTags(tags) {
    return tags.map(tag => {
        // 移除序号、星号和多余空格
        return tag.replace(/^\d+\.\s*\*+|\*+/g, '').trim();
    });
}

// 获取隐私模式设置
async function determinePrivacyMode(tab) {
    const autoPrivacyMode = await SettingsManager.get('privacy.autoDetect');
    const manualPrivacyMode = await SettingsManager.get('privacy.enabled');
    // 打印隐私模式设置的调试信息
    logger.debug('隐私模式设置:', {
        autoPrivacyMode,
        manualPrivacyMode
    });
    
    // 判断是否启用隐私模式
    let isPrivate = false;
    if (autoPrivacyMode) {
        // 自动检测模式
        isPrivate = await containsPrivateContent(tab.url);
    } else {
        // 手动控制模式
        isPrivate = manualPrivacyMode;
    }
    return isPrivate;
}

async function isPrivacyModeManuallyDisabled() {
    const autoPrivacyMode = await SettingsManager.get('privacy.autoDetect');
    const manualPrivacyMode = await SettingsManager.get('privacy.enabled');
    if (autoPrivacyMode) {
        return false;
    }
    return !manualPrivacyMode;
}

// 检查URL是否包含隐私内容
async function containsPrivateContent(url) {
    try {
        const urlObj = new URL(url);

        // 1. 定义隐私相关路径模式
        const patterns = {
            // 认证相关页面
            auth: {
                pattern: /^.*\/(?:login|signin|signup|register|password|auth|oauth|sso)(?:\/|$)/i,
                scope: 'pathname',
                description: '认证页面'
            },

            // 验证和确认页面
            verification: {
                pattern: /^.*\/(?:verify|confirmation|activate|reset)(?:\/|$)/i,
                scope: 'pathname',
                description: '验证确认页面'
            },

            // 邮箱和消息页面
            mail: {
                pattern: /^.*\/(?:mail|inbox|compose|message|chat|conversation)(?:\/|$)/i,
                scope: 'pathname',
                description: '邮件消息页面'
            },

            // 个人账户和设置页面
            account: {
                pattern: /^.*\/(?:profile|account|settings|preferences|dashboard|admin)(?:\/|$)/i,
                scope: 'pathname',
                description: '账户设置页面'
            },

            // 支付和财务页面
            payment: {
                pattern: /^.*\/(?:payment|billing|invoice|subscription|wallet)(?:\/|$)/i,
                scope: 'pathname',
                description: '支付财务页面'
            },

            // 敏感查询参数
            sensitiveParams: {
                pattern: /[?&](?:token|auth|key|password|secret|access_token|refresh_token|session|code)=/i,
                scope: 'search',
                description: '包含敏感参数'
            }
        };

        // 2. 定义敏感域名列表
        const privateDomains = {
            // 邮箱服务
            mail: [
                'mail.google.com',
                'outlook.office.com',
                'mail.qq.com',
                'mail.163.com',
                'mail.126.com',
                'mail.sina.com',
                'mail.yahoo.com'
            ],
            // 网盘服务
            storage: [
                'drive.google.com',
                'onedrive.live.com',
                'dropbox.com',
                'pan.baidu.com'
            ],
            // 社交和通讯平台的私密页面
            social: [
                'messages.google.com',
                'web.whatsapp.com',
                'web.telegram.org',
                'discord.com/channels'
            ],
            // 在线办公和协作平台的私密页面
            workspace: [
                'docs.google.com',
                'sheets.googleapis.com',
                'notion.so'
            ]
        };

        // 3. 检查域名
        for (const [category, domains] of Object.entries(privateDomains)) {
            if (domains.some(domain => urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain))) {
                logger.debug('URL包含隐私内容:', {
                    url: url,
                    reason: `属于隐私域名类别: ${category}`,
                    domain: urlObj.hostname
                });

                // 检查是否有例外情况
                if (shouldAllowPrivateException(url, 'domain', category)) {
                    continue;
                }

                return true;
            }
        }

        // 4. 检查路径和查询参数
        for (const [key, rule] of Object.entries(patterns)) {
            let testString;

            switch (rule.scope) {
                case 'pathname':
                    testString = urlObj.pathname;
                    break;
                case 'search':
                    testString = urlObj.search;
                    break;
                case 'full':
                    testString = url;
                    break;
                default:
                    continue;
            }

            if (rule.pattern.test(testString)) {
                const match = testString.match(rule.pattern);
                logger.debug('URL包含隐私内容:', {
                    url: url,
                    reason: rule.description,
                    pattern: rule.pattern.toString(),
                    matchedPart: match[0],
                    matchLocation: rule.scope
                });

                // 检查是否有例外情况
                if (shouldAllowPrivateException(url, key, match)) {
                    continue;
                }

                return true;
            }
        }

        // 5. 检查自定义隐私域名
        const settings = await SettingsManager.getAll();
        const customDomains = settings.privacy.customDomains || [];

        for (const pattern of customDomains) {
            let isMatch = false;

            // 处理正则表达式模式
            if (pattern.startsWith('/') && pattern.endsWith('/')) {
                const regex = new RegExp(pattern.slice(1, -1));
                isMatch = regex.test(urlObj.hostname);
            }
            // 处理通配符模式
            else if (pattern.startsWith('*.')) {
                const domain = pattern.slice(2);
                isMatch = urlObj.hostname.endsWith(domain);
            }
            // 处理普通域名
            else {
                isMatch = urlObj.hostname === pattern;
            }

            if (isMatch) {
                logger.debug('URL匹配自定义隐私域名:', {
                    url: url,
                    pattern: pattern
                });
                return true;
            }
        }

        return false;

    } catch (error) {
        logger.error('隐私内容检查失败:', error);
        return true; // 出错时从安全角度返回true
    }
}

// 处理隐私检测的例外情况
function shouldAllowPrivateException(url, ruleKey, context) {
    try {
        const urlObj = new URL(url);

        // 1. 允许公开的文档页面
        if (context === 'workspace') {
            const publicDocPatterns = [
                /\/public\//i,
                /[?&]sharing=public/i,
                /[?&]view=public/i
            ];
            if (publicDocPatterns.some(pattern => pattern.test(url))) {
                return true;
            }
        }

        // 2. 允许公开的个人主页
        if (ruleKey === 'account') {
            const publicProfilePatterns = [
                /\/public\/profile\//i,
                /\/users\/[^\/]+$/i,
                /\/@[^\/]+$/i
            ];
            if (publicProfilePatterns.some(pattern => pattern.test(urlObj.pathname))) {
                return true;
            }
        }

        // 3. 允许特定域名的登录页面（如开发文档）
        if (ruleKey === 'auth') {
            const allowedAuthDomains = [
                'developer.mozilla.org',
                'docs.github.com',
                'learn.microsoft.com'
            ];
            if (allowedAuthDomains.some(domain => urlObj.hostname.endsWith(domain))) {
                return true;
            }
        }

        // 4. 允许公开的支付文档或API文档
        if (ruleKey === 'payment') {
            const publicPaymentDocs = [
                /\/docs\/payment/i,
                /\/api\/payment/i,
                /\/guides\/billing/i
            ];
            if (publicPaymentDocs.some(pattern => pattern.test(urlObj.pathname))) {
                return true;
            }
        }

        return false;
    } catch (error) {
        logger.error('处理隐私例外情况时出错:', error);
        return false;
    }
}

function isContentFulUrl(url) {
    try {
        const urlObj = new URL(url);

        // 1. 定义更精确的匹配规则
        const patterns = {
            // 错误页面 - 仅匹配路径部分
            errors: {
                pattern: /^.*\/(404|403|500|error|not[-\s]?found)(?:\.html?)?$/i,
                scope: 'pathname',
                description: '错误页面'
            },
            // 维护页面 - 仅匹配路径部分
            maintenance: {
                pattern: /^.*\/(maintenance|unavailable|blocked)(?:\.html?)?$/i,
                scope: 'pathname',
                description: '维护页面'
            },
            // 预览页面 - 需要考虑查询参数
            preview: {
                pattern: /^.*\/preview\/|[?&](?:preview|mode)=(?:preview|temp)/i,
                scope: 'full',
                description: '预览页面'
            },
            // 下载/上传页面 - 仅匹配路径结尾
            fileTransfer: {
                pattern: /\/(download|upload)(?:\/|$)/i,
                scope: 'pathname',
                description: '下载上传页面'
            },
            // 支付和订单页面 - 需要更精确的匹配
            payment: {
                pattern: /\/(?:cart|checkout|payment|order)(?:\/|$)|[?&](?:order_id|transaction_id)=/i,
                scope: 'full',
                description: '支付订单页面'
            },
            // 登出页面 - 仅匹配路径部分
            logout: {
                pattern: /\/(?:logout|signout)(?:\/|$)/i,
                scope: 'pathname',
                description: '登出页面'
            },
            // 打印页面 - 需要考虑查询参数
            print: {
                pattern: /\/print\/|[?&](?:print|format)=pdf/i,
                scope: 'full',
                description: '打印页面'
            },
            // 搜索结果页面 - 需要更精确的匹配
            search: {
                pattern: /\/search\/|\/(results|findings)(?:\/|$)|[?&](?:q|query|search|keyword)=/i,
                scope: 'full',
                description: '搜索结果页面'
            },
            // 回调和重定向页面 - 需要更精确的匹配
            redirect: {
                pattern: /\/(?:callback|redirect)(?:\/|$)|[?&](?:callback|redirect_uri|return_url)=/i,
                scope: 'full',
                description: '回调重定向页面'
            }
        };

        // 2. 检查每个规则
        for (const [key, rule] of Object.entries(patterns)) {
            let testString;

            switch (rule.scope) {
                case 'pathname':
                    // 仅检查路径部分
                    testString = urlObj.pathname;
                    break;
                case 'full':
                    // 检查完整URL（包括查询参数）
                    testString = url;
                    break;
                default:
                    continue;
            }

            if (rule.pattern.test(testString)) {
                // 记录详细的匹配信息
                const match = testString.match(rule.pattern);
                logger.debug('URL被过滤:', {
                    url: url,
                    reason: rule.description,
                    pattern: rule.pattern.toString(),
                    matchedPart: match[0],
                    matchLocation: rule.scope,
                    fullPath: urlObj.pathname,
                    hasQuery: urlObj.search.length > 0
                });

                // 3. 特殊情况处理
                if (shouldAllowException(url, key, match)) {
                    logger.debug('URL虽然匹配过滤规则，但属于例外情况，允许保存');
                    continue;
                }

                return false;
            }
        }

        return true;

    } catch (error) {
        logger.error('URL验证失败:', error);
        return false;
    }
}

// 处理特殊例外情况
function shouldAllowException(url, ruleKey, match) {
    try {
        const urlObj = new URL(url);

        // 1. 允许特定域名的搜索结果页面
        if (ruleKey === 'search') {
            const allowedSearchDomains = [
                'github.com',
                'stackoverflow.com',
                'developer.mozilla.org'
            ];
            if (allowedSearchDomains.some(domain => urlObj.hostname.endsWith(domain))) {
                return true;
            }
        }

        // 2. 允许包含有价值内容的错误页面
        if (ruleKey === 'errors') {
            const valuableErrorPages = [
                /\/guides\/errors\//i,
                /\/docs\/errors\//i,
                /\/error-reference\//i
            ];
            if (valuableErrorPages.some(pattern => pattern.test(urlObj.pathname))) {
                return true;
            }
        }

        // 3. 允许特定的下载页面（如软件发布页）
        if (ruleKey === 'fileTransfer') {
            const allowedDownloadPatterns = [
                /\/releases\/download\//i,
                /\/downloads\/release\//i,
                /\/software\/[^\/]+\/download\/?$/i
            ];
            if (allowedDownloadPatterns.some(pattern => pattern.test(urlObj.pathname))) {
                return true;
            }
        }

        return false;
    } catch (error) {
        logger.error('处理URL例外情况时出错:', error);
        return false;
    }
}

async function checkUrlAccessibility(url) {
    if (isNonMarkableUrl(url)) {
        return {accessible: false, reason: '不支持的URL'};
    }
    return {accessible: true, reason: '可访问'};
}

function smartTruncate(text, maxLength = 500) {
    if (!text) return text;
    if (text.length <= maxLength) return text;

    // 检测文本类型的辅助函数
    const detectTextType = (text) => {
        // 统计前100个字符的语言特征
        const sample = text.slice(0, 100);

        // 统计不同类型字符的数量
        const stats = {
            latin: 0,      // 拉丁字母 (英文等)
            cjk: 0,       // 中日韩文字
            cyrillic: 0,  // 西里尔字母 (俄文等)
            arabic: 0,    // 阿拉伯文
            other: 0      // 其他字符
        };

        // 遍历样本文本的每个字符
        for (const char of sample) {
            const code = char.codePointAt(0);

            if (/[\p{Script=Latin}]/u.test(char)) {
                stats.latin++;
            } else if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char)) {
                stats.cjk++;
            } else if (/[\p{Script=Cyrillic}]/u.test(char)) {
                stats.cyrillic++;
            } else if (/[\p{Script=Arabic}]/u.test(char)) {
                stats.arabic++;
            } else if (!/[\s\p{P}]/u.test(char)) { // 排除空格和标点
                stats.other++;
            }
        }

        // 计算主要字符类型的占比
        const total = Object.values(stats).reduce((a, b) => a + b, 0);
        const threshold = 0.6; // 60%的阈值

        // 返回主要语言类型
        if (stats.latin / total > threshold) return 'latin';
        if (stats.cjk / total > threshold) return 'cjk';
        if (stats.cyrillic / total > threshold) return 'cyrillic';
        if (stats.arabic / total > threshold) return 'arabic';

        // 如果没有明显主导的语言类型，返回混合类型
        return 'mixed';
    };

    const textType = detectTextType(text);
    logger.debug('文本类型:', textType);

    // 根据不同语言类型选择截取策略
    switch (textType) {
        case 'latin':
        case 'cyrillic':
        case 'arabic':
            // 按单词数量截取
            const maxWords = Math.round(maxLength * 0.5);
            const words = text.split(/\s+/).filter(word => word.length > 0);
            if (words.length <= maxWords) return text;

            return words
                .slice(0, maxWords)
                .join(' ');
        case 'cjk':
            // 中日韩文本按字符截取，在标点处断句
            const punctuation = /[，。！？；,!?;]/;
            let truncated = text.slice(0, maxLength);

            // 尝试在标点符号处截断
            for (let i = truncated.length - 1; i >= maxLength - 50; i--) {
                if (punctuation.test(truncated[i])) {
                    truncated = truncated.slice(0, i + 1);
                    break;
                }
            }
            return truncated;

        case 'mixed':
        default:
            // 混合文本采用通用策略
            // 先尝试在空格处截断
            let mixedTruncated = text.slice(0, maxLength);
            for (let i = mixedTruncated.length - 1; i >= maxLength - 30; i--) {
                if (/\s/.test(mixedTruncated[i])) {
                    mixedTruncated = mixedTruncated.slice(0, i);
                    break;
                }
            }
            return mixedTruncated;
    }
}

// 添加辅助函数计算字符串的视觉长度
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

// 获取备选标签的辅助函数
function getFallbackTags(title, metadata) {
    const maxTags = 5;
    const tags = new Set();

    // 1. 首先尝试使用 metadata 中的关键词
    if (metadata?.keywords) {
        const metaKeywords = metadata.keywords
            .split(/[,，;；]/) // 分割关键词
            .map(tag => tag.trim())
            .filter(tag => {
                return tag.length >= 1 &&
                    tag.length <= 20;
            });

        metaKeywords.forEach(tag => tags.add(tag));
    }

    const stopWords = new Set([
        // 中文停用词
        '的', '了', '和', '与', '或', '在', '是', '到', '等', '把',
        // 英文停用词
        'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for',
        'from', 'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on',
        'that', 'the', 'to', 'was', 'were', 'will', 'with', 'the',
        // 常见连接词和介词
        'about', 'after', 'before', 'but', 'how', 'into', 'over',
        'under', 'what', 'when', 'where', 'which', 'who', 'why',
        // 常见动词
        'can', 'could', 'did', 'do', 'does', 'had', 'have', 'may',
        'might', 'must', 'should', 'would',
        // 其他常见词
        'this', 'these', 'those', 'they', 'you', 'your'
    ]);

    // 2. 如果 metadata 中没有足够的关键词，使用标题关键词
    if (tags.size < 2 && title) {
        // 移除常见的无意义词
        const titleWords = title
            .split(/[\s\-\_\,\.\。\，]/) // 分割标题
            .map(word => word.trim())
            .filter(word => {
                return word.length >= 2 &&
                    word.length <= 20 &&
                    !stopWords.has(word) &&
                    !/[^\u4e00-\u9fa5a-zA-Z0-9]/.test(word);
            });

        titleWords.forEach(word => {
            if (tags.size < maxTags) { // 最多添加5个标签
                tags.add(word);
            }
        });
    }

    // 3. 如果还是没有足够的标签，尝试使用 metadata 的其他信息
    if (tags.size < 2) {
        // 尝试使用文章分类信息
        if (metadata?.category && metadata.category.length <= 20) {
            tags.add(metadata.category);
        }

        // 尝试使用文章题信息
        if (metadata?.subject && metadata.subject.length <= 20) {
            tags.add(metadata.subject);
        }

        // 尝试从描述中提取关键词
        if (metadata?.description) {
            const descWords = metadata.description
                .split(/[\s\,\.\。\，]/)
                .map(word => word.trim())
                .filter(word => {
                    return word.length >= 2 &&
                        word.length <= 20 &&
                        !stopWords.has(word) &&
                        !/[^\u4e00-\u9fa5a-zA-Z0-9]/.test(word);
                })
                .slice(0, 2); // 最多取2个关键词

            descWords.forEach(word => {
                if (tags.size < maxTags) {
                    tags.add(word);
                }
            });
        }
    }

    logger.debug('备选标签生成过程:', {
        fromMetaKeywords: metadata?.keywords ? true : false,
        fromTitle: title ? true : false,
        finalTags: Array.from(tags)
    });

    return Array.from(tags).slice(0, maxTags);
}

// 获取当前页面的文本内容
async function getPageContent(tab) {
    try {
        const isPrivate = await determinePrivacyMode(tab);
        if (isPrivate || !isContentFulUrl(tab.url)) {
            logger.info('页面为隐私模式或URL无内容');
            return {};
        }
        // 首先注 content script
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["lib/Readability.js", "contentScript.js"]
        });
        
        const response = await chrome.tabs.sendMessage(tab.id, { action: "getContent" });
        
        let content = response?.content;
        // 清理内容
        content = content
            .replace(/\s+/g, ' ')           // 将多个空白字符替换为单个空格
            .replace(/[\r\n]+/g, ' ')       // 将换行符替换为空格
            .replace(/\t+/g, ' ')           // 将制表符替换为空格
            .trim();                        // 去除首尾空白

        // 如果提取失败，返回空字符串
        if (!response || !content) {
            logger.warn('内容提取失败');
            return {};
        }

        return {
            title: response.title,
            content: content,
            excerpt: response.excerpt,
            metadata: response.metadata
        };
    } catch (error) {
        logger.error('获取页面内容时出错:', error);
        return {};
    }
}