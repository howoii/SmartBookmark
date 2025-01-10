// 添加书签数据源枚举
const BookmarkSource = {
    EXTENSION: 'extension',
    CHROME: 'chrome'
};

// 统一的书签数据结构
class UnifiedBookmark {
    constructor(data, source) {
        this.url = data.url;
        this.title = data.title;
        this.source = source;
        
        if (source === BookmarkSource.EXTENSION) {
            this.tags = data.tags;
            this.excerpt = data.excerpt;
            this.embedding = data.embedding;
            // 这里需要确保日期格式的一致性
            this.savedAt = data.savedAt ? new Date(data.savedAt).toISOString() : new Date().toISOString();
            this.useCount = data.useCount;
            this.lastUsed = data.lastUsed ? new Date(data.lastUsed).toISOString() : null;
            this.apiService = data.apiService;
        } else {
            this.tags = [...data.folderTags || []];
            this.excerpt = '';
            this.embedding = null;
            // Chrome书签的日期是时间戳（毫秒）
            this.savedAt = new Date(data.dateAdded).toISOString();
            this.useCount = 0;
            this.lastUsed = data.dateLastUsed ? new Date(data.dateLastUsed).toISOString() : null;
            this.chromeId = data.id;
        }
    }
}

// 获取所有书签的统一接口
async function getAllBookmarks() {
    try {
        // 获取扩展书签
        const extensionBookmarks = await LocalStorageMgr.getBookmarks();
        const extensionBookmarksMap = Object.entries(extensionBookmarks)
            .reduce((map, [_, data]) => {
                const bookmark = new UnifiedBookmark(data, BookmarkSource.EXTENSION);
                map[bookmark.url] = bookmark;
                return map;
            }, {});

            // 获取显示设置
        const showChromeBookmarks = await SettingsManager.get('display.showChromeBookmarks');
        let chromeBookmarksMap = {};
        // 获取Chrome书签
        if (showChromeBookmarks) {
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

function isValidUrl(url) {
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

// 更新保存按钮和图标状态
async function updateTabState() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        logger.error('无法获取当前标签页信息');
        return;
    }

    const isSaved = await checkIfPageSaved(tab.url);
    updateSaveButtonState(isSaved);
    updatePrivacyIconState(tab);
    // 更新图标状态
    await updateExtensionIcon(tab.id, isSaved);
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

async function handlePrivacyIconClick(isPrivate) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        return;
    }
    if (!isPrivate) {
        try {
            const urlObj = new URL(tab.url);
            const domain = urlObj.hostname;
            logger.debug('点击隐私图标，添加域名:', domain, tab.url);
            
            // 获取现有的隐私域名列表
            let privacyDomains = await SettingsManager.get('privacy.customDomains') || [];
            
            // 添加新域名
            if (!privacyDomains.includes(domain)) {
                // 更新设置
                const newDomains = [...privacyDomains, domain];
                await SettingsManager.update({
                    privacy: {
                        customDomains: newDomains
                    }
                });
                
                // 更新图标状态
                await updatePrivacyIconState(tab);
                updateStatus(`已将 ${domain} 添加到隐私域名列表`);

                // 更新域名列表
                sendMessageSafely({
                    type: 'UPDATE_DOMAINS_LIST',
                    data: newDomains
                });
            }
        } catch (error) {
            logger.error('添加隐私域名失败:', error);
            updateStatus('添加隐私域名时出错');
        }
    } else {
        const autoPrivacyMode = await SettingsManager.get('privacy.autoDetect');
        if (autoPrivacyMode) {
            // 跳转到隐私模式设置页面
            openOptionsPage('privacy'); 
        } else {
            if (settingsDialog) {
                settingsDialog.open();
            }
        }   
    }
}

async function updatePrivacyIconState(tab) {
    const privacyIcon = document.getElementById('privacy-mode');
    const toolbar = document.querySelector('.toolbar');
    if (!privacyIcon) {
        return;
    }

    // 首先检查URL是否可标记 或 隐私模式是否手动关闭    
    if (isNonMarkableUrl(tab.url) || await isPrivacyModeManuallyDisabled()) {
        // 如果不可标记，隐藏隐私图标
        privacyIcon.style.display = 'none';
        toolbar.classList.remove('privacy-mode');
        return;
    }
    // 恢复显示
    privacyIcon.style.display = 'flex';

    const isPrivate = await determinePrivacyMode(tab);
    
    // 更新隐私模式图标状态
    if (isPrivate) {
        const autoPrivacyMode = await SettingsManager.get('privacy.autoDetect');
        privacyIcon.classList.add('active');
        toolbar.classList.add('privacy-mode');
        privacyIcon.title = autoPrivacyMode ? 
            '此页面可能包含隐私内容，将不会读取页面内容' : 
            '隐私模式已开启，将不会读取页面内容';
    } else {
        privacyIcon.classList.remove('active');
        toolbar.classList.remove('privacy-mode');
        privacyIcon.title = '点击将此网站标记为隐私域名';
    }

    // 更新数据属性以供点击事件使用
    privacyIcon.dataset.isPrivate = isPrivate;
}

async function getLocalChangeCount() {
    try {
        const lastSyncVersion = await LocalStorageMgr.get('lastSyncVersion') || 0;
        if (lastSyncVersion == 0) {
            return 999;
        }
        const pendingChanges = await LocalStorageMgr.get('pendingChanges') || {};
        // 确保返回值是数字类型
        return Object.keys(pendingChanges).length;
    } catch (error) {
        logger.error('获取本地更改数量失败:', error);
        return 0; // 发生错误时返回0
    }
}

// 保存状态管理器
class SaveManager {
    static isSaving = false;
    
    static async startSave(bookmarkManager) {
        if (this.isSaving) return false;
        
        const saveButton = bookmarkManager.elements.required.saveButton;
        if (!saveButton) {
            logger.error('保存按钮未找到');
            return false;
        }
        
        this.isSaving = true;
        saveButton.disabled = true;
        saveButton.classList.add('saving');
        return true;
    }
    
    static endSave(bookmarkManager) {
        const saveButton = bookmarkManager.elements.required.saveButton;
        if (!saveButton) {
            logger.error('保存按钮未找到');
            return;
        }
        
        this.isSaving = false;
        saveButton.disabled = false;
        saveButton.classList.remove('saving');
    }
}

// 添加获取 BookmarkManager 实例的函数
async function getBookmarkManager() {
    if (!window.bookmarkManagerInstance) {
        const bookmarkManagerInstance = new BookmarkManager();
        await bookmarkManagerInstance.initialize();
        window.bookmarkManagerInstance = bookmarkManagerInstance;
    }
    return window.bookmarkManagerInstance;
}

// 书签管理器类
class BookmarkManager {
    constructor() {
        this.pageContent = null;
        this.currentTab = null;
        this.generatedTags = [];
        this.isInitialized = false;
        this.tagCache = {
            url: null,
            tags: []
        };
        this.isEditMode = false;
        this.editingBookmark = null;
        // 将 DOM 元素分为必需和可选两类
        this.elements = {
            required: {
                saveButton: null,
                dialog: null,
                tagsList: null,
                apiKeyNotice: null,
                syncButton: null,
                regenerateEmbeddings: null,
                privacyIcon: null
            },
            optional: {
                newTagInput: null,
                saveTagsBtn: null,
                cancelTagsBtn: null,
                deleteBookmarkBtn: null,
                dialogContent: null,
                recommendedTags: null,
                pageExcerpt: null,
                dialogTitle: null   
            }
        };
        this.alertDialog = null;
        this.syncManager = null;
        this.syncBadgeTimeoutId = null;
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            // 获取必需的 DOM 元素
            this.elements.required = {
                saveButton: document.getElementById('save-page'),
                dialog: document.getElementById('tags-dialog'),
                tagsList: document.getElementById('tags-list'),
                apiKeyNotice: document.getElementById('api-key-notice'),
                syncButton: document.getElementById('sync-button'),
                regenerateEmbeddings: document.getElementById('regenerate-embeddings'),
                privacyIcon: document.getElementById('privacy-mode')
            };

            // 检查必需元素
            const missingRequired = Object.entries(this.elements.required)
                .filter(([key, element]) => !element)
                .map(([key]) => key);

            if (missingRequired.length > 0) {
                throw new Error(`缺少必需的DOM元素: ${missingRequired.join(', ')}`);
            }

            // 获取可选的 DOM 元素
            this.elements.optional = {
                newTagInput: document.getElementById('new-tag-input'),
                saveTagsBtn: document.getElementById('save-tags-btn'),
                cancelTagsBtn: document.getElementById('cancel-tags-btn'),
                deleteBookmarkBtn: document.getElementById('delete-bookmark-btn'),
                dialogContent: document.querySelector('#tags-dialog .dialog-content'),
                recommendedTags: document.querySelector('.recommended-tags'),
                pageExcerpt: document.querySelector('.page-excerpt'),
                dialogTitle: document.querySelector('.page-title')  
            };

            // 记录缺失的可选元素（仅用于调试）
            const missingOptional = Object.entries(this.elements.optional)
                .filter(([key, element]) => !element)
                .map(([key]) => key);

            if (missingOptional.length > 0) {
                logger.warn('以下可选DOM元素未找到:', missingOptional);
            }
            
            this.alertDialog = new AlertDialog();
            this.syncManager = new SyncButtonManager(this.alertDialog);

            // 绑定核心事件处理器
            this.bindEvents();
            await Promise.all([
                this.checkLoginRelatedDisplay(),
                this.checkEmbeddingStatus(),
                this.checkApiKeyConfig(true),
                this.checkSyncBookmark()
            ]);
                        
            this.isInitialized = true;
            logger.info('BookmarkManager 初始化成功');
        } catch (error) {
            logger.error('初始化失败:', error);
            throw error; // 重新抛出错误，让调用者知道初始化失败
        }
    }

    async refreshBookmarksList() {
        logger.debug('刷新书签列表');
        await renderBookmarksList();
    }

    bindEvents() {
        this.elements.required.saveButton.addEventListener('click', this.handleSaveClick.bind(this));
        this.elements.required.syncButton.addEventListener('click', this.handleSyncClick.bind(this));
        this.elements.required.regenerateEmbeddings.addEventListener('click', this.handleRegenerateEmbeddingsClick.bind(this));
        this.elements.required.privacyIcon.addEventListener('click', this.handlePrivacyIconClick.bind(this));
        this.setupTagsDialogEvents();
        this.setupStorageListener();
    }

    async handleSyncClick() {
        this.syncManager.handleSync();
    }

    async handlePrivacyIconClick() {
        await handlePrivacyIconClick(this.elements.required.privacyIcon.dataset.isPrivate === 'true');
    }

    async checkSyncBookmark() {
        logger.debug('检查同步书签');
        if (await this.syncManager.checkAutoSync()) {
            await this.syncManager.handleSync(true);
        }
    }

    setSyncingState(isSyncing) {
        const isSyncInProgress = this.syncManager.isSyncInProgress();
        if (isSyncing && !isSyncInProgress) {
            this.syncManager.setSyncingState(true);
        } else if (!isSyncing && isSyncInProgress) {
            this.syncManager.setSyncingState(false);
        }
    }

    async checkLoginRelatedDisplay() {
        const {valid} = await validateToken();
        const syncButton = this.elements.required.syncButton;
        syncButton.dataset.isLogin = valid;
        
        if (valid) {
            syncButton.title = '同步书签';
            syncButton.style.opacity = '0.6';
        } else {
            syncButton.title = '登录后可同步书签';
            syncButton.style.opacity = '0.3';
            this.syncManager.setSyncingState(false);
            this.syncManager.setCoolDownState(false);
        }   
        // 添加检查未同步数量
        await this.updateSyncBadge(0);
    }
    
    // 更新同步徽章
    async updateSyncBadge(delay = 0) {
        if (delay > 0) {
            if (this.syncBadgeTimeoutId) {
                clearTimeout(this.syncBadgeTimeoutId);
            }
            this.syncBadgeTimeoutId = setTimeout(() => {
                this.updateSyncBadge(0);
            }, delay);
            return;
        }
        const syncButton = this.elements.required.syncButton;
        let badge = syncButton.querySelector('.sync-badge');
        // 获取未同步的变更数量
        const changeCount = await getLocalChangeCount();
        const isLogin = syncButton.dataset.isLogin == 'true';
        if (!isLogin || changeCount === 0) {
            if (badge) {
                badge.remove();
            }
            return;
        }
        
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'sync-badge';
            syncButton.appendChild(badge);
        }
        
        if (changeCount > 99) {
            badge.textContent = '';
            badge.classList.add('dot');
        } else {
            badge.textContent = changeCount.toString();
            badge.classList.remove('dot');
        }
    }
    
    // 移除同步徽章
    removeSyncBadge() {
        const syncButton = this.elements.required.syncButton;
        const badge = syncButton.querySelector('.sync-badge');
        if (badge) {
            badge.remove();
        }
    }

    setupTagsDialogEvents() {
        const { dialog, tagsList, apiKeyNotice } = this.elements.required;
        const { 
            newTagInput, 
            saveTagsBtn, 
            cancelTagsBtn, 
            dialogContent,
            dialogTitle,
            deleteBookmarkBtn
        } = this.elements.optional;

        // 基本的对话框关闭功能（必需）
        const closeDialog = () => {
            dialog.classList.remove('show');
            updateStatus('已取消保存');
            this.resetEditMode();
        };

        // 必需的事件监听器
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                closeDialog();
            }
        });

        // 可选功能的事件监听器
        if (dialogContent) {
            dialogContent.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        if (newTagInput) {
            // 回车键提交新标签
            newTagInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const newTag = newTagInput.value.trim();
                    if (newTag) {
                        const currentTags = this.getCurrentTags();
                        if (!currentTags.includes(newTag)) {
                            this.renderTags([...currentTags, newTag]);
                            newTagInput.value = '';
                        }
                    }
                }
            });
        }

        if (tagsList) {
            tagsList.addEventListener('click', (e) => {
                if (e.target.classList.contains('remove-tag-btn')) {
                    const tagElement = e.target.parentElement;
                    tagElement.remove();
                }
            });
        }

        if (saveTagsBtn) {
            saveTagsBtn.addEventListener('click', async () => {
                dialog.classList.remove('show');
                const finalTags = this.getCurrentTags();
                const title = this.getEditedTitle();
                await this.saveBookmark(finalTags, title);
            });
        }

        if (cancelTagsBtn) {
            cancelTagsBtn.addEventListener('click', closeDialog);
        }

        if (deleteBookmarkBtn) {
            deleteBookmarkBtn.addEventListener('click', async () => {
                const confirmation = confirm('确定要删除此收藏吗？');
                if (confirmation) {
                    dialog.classList.remove('show');
                    await this.handleUnsave(this.currentTab);
                    this.resetEditMode();
                }
            });
        }


        if (dialogTitle) { 
            const handlers = {
                focus: () => {
                    dialogTitle.dataset.originalTitle = dialogTitle.textContent;
                },
                
                blur: () => {
                    const newTitle = dialogTitle.textContent.trim();
                    if (!newTitle) {
                        dialogTitle.textContent = dialogTitle.dataset.originalTitle;
                    }
                },
                
                keydown: (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        dialogTitle.blur();
                    } else if (e.key === 'Escape') {
                        dialogTitle.textContent = dialogTitle.dataset.originalTitle;
                        dialogTitle.blur();
                    }
                }
            }
            // 绑定事件
            dialogTitle.addEventListener('focus', handlers.focus);
            dialogTitle.addEventListener('blur', handlers.blur);
            dialogTitle.addEventListener('keydown', handlers.keydown);
        }

        const apiKeyLink = apiKeyNotice.querySelector('.api-key-link');
        if (apiKeyLink) {
            apiKeyLink.addEventListener('click', async (e) => {
                e.preventDefault();
                openOptionsPage('services');
            });
        }
    }

    async checkApiKeyConfig(isInit = false) {
        const apiKey = await ConfigManager.getAPIKey();
        const skipApiKeyNotice = await SettingsManager.get('display.skipApiKeyNotice');
        
        if (!apiKey) {
            // 显示API Key配置链接
            this.elements.required.apiKeyNotice.style.display = 'block';

            // 如果未设置跳过提示，显示欢迎对话框
            if (!skipApiKeyNotice && isInit) {
                this.alertDialog.show({
                    title: '欢迎使用',
                    message: '检测到您还未配置API Key，这将影响书签搜索等核心功能的使用。是否现在配置？',
                    primaryText: '去配置',
                    secondaryText: '暂不配置',
                    onPrimary: () => {
                        openOptionsPage('services');
                    },
                    onSecondary: async () => {
                        await SettingsManager.update({
                            display: {
                                skipApiKeyNotice: true
                            }
                        }); 
                    }
                });
            }
        } else {
            this.elements.required.apiKeyNotice.style.display = 'none';
        }
    }

    async checkEmbeddingStatus() {
        try {
            const apiKey = await ConfigManager.getAPIKey();
            if (!apiKey) {
                this.elements.required.regenerateEmbeddings.style.display = 'none';
                return;
            }

            const activeService = await ConfigManager.getActiveService();
            const bookmarks = await LocalStorageMgr.getBookmarks();
            const needsUpdate = Object.values(bookmarks).some(bookmark => 
                !bookmark.embedding || bookmark.apiService !== activeService.id
            );

            const regenerateButton = this.elements.required.regenerateEmbeddings;
            regenerateButton.style.display = needsUpdate ? 'flex' : 'none';
            
            if (needsUpdate) {
                const count = Object.values(bookmarks).filter(bookmark => 
                    !bookmark.embedding || bookmark.apiService !== activeService.id
                ).length;
                regenerateButton.title = `有 ${count} 个书签需要更新`;
            }
        } catch (error) {
            logger.error('检查embedding状态时出错:', error);
        }
    }

    async handleRegenerateEmbeddingsClick() {
        this.alertDialog.show({
            title: '确认重新生成',
            message: '这将重新生成所有使用旧API服务生成的向量，该过程可能需要一些时间。是否继续？',
            primaryText: '继续',
            secondaryText: '取消',
            onPrimary: async () => {
                await this.regenerateEmbeddings();
            }
        });
    }

    async regenerateEmbeddings() {
        const regenerateButton = this.elements.required.regenerateEmbeddings;
        const updatedBookmarks = [];
        try {
            regenerateButton.classList.add('processing');

            const activeService = await ConfigManager.getActiveService();
            const bookmarks = await LocalStorageMgr.getBookmarks();
            let updatedCount = 0;
            
            for (const [key, bookmark] of Object.entries(bookmarks)) {
                if (!bookmark.embedding || bookmark.apiService !== activeService.id) {
                    StatusManager.startOperation(`正在更新 ${++updatedCount} 个书签...`);
                    
                    const text = preprocessText({
                        excerpt: bookmark.excerpt,
                        title: bookmark.title,
                        url: bookmark.url
                    }, null, bookmark.tags);
                    
                    const newEmbedding = await getEmbedding(text);
                    if (!newEmbedding) {
                        throw new Error('向量生成失败');
                    }
                    const updatedBookmark = {
                        ...bookmark,
                        embedding: newEmbedding,
                        apiService: activeService.id
                    };
                    updatedBookmarks.push(updatedBookmark);
                    await LocalStorageMgr.setBookmark(bookmark.url, updatedBookmark);
                }
            }

            StatusManager.endOperation(`成功更新 ${updatedCount} 个书签的向量`);
            regenerateButton.style.display = 'none';
        } catch (error) {
            logger.error('重新生成embedding时出错:', error);
            StatusManager.endOperation('更新向量失败', true);
        } finally {
            regenerateButton.classList.remove('processing');
            // 批量记录变更
            if (updatedBookmarks.length > 0) {
                await recordBookmarkChange(updatedBookmarks);
            }
        }
    }

    setupStorageListener() {
        chrome.storage.onChanged.addListener(async (changes, areaName) => {
            if (areaName === 'sync') {  // 确保是监听sync storage
                // 监听API Keys的变化
                if (changes[ConfigManager.STORAGE_KEYS.API_KEYS] || changes[ConfigManager.STORAGE_KEYS.ACTIVE_SERVICE]) {
                    logger.debug('API Keys发生变化:', changes[ConfigManager.STORAGE_KEYS.API_KEYS], changes[ConfigManager.STORAGE_KEYS.ACTIVE_SERVICE]);
                    this.checkApiKeyConfig(false);
                    this.checkEmbeddingStatus();
                    // 清除向量缓存
                    await searchHistoryManager.clearVectorCache();
                }
            } else if (areaName === 'local') {
                if (changes['token']) {
                    await this.checkLoginRelatedDisplay();
                }
                // 添加对未同步变更的监听
                if (changes['pendingChanges'] || changes['lastSyncVersion']) {
                    await this.updateSyncBadge(2000);
                }
            }
        });
    }

    getCurrentTags() {
        const { tagsList } = this.elements.required;
        if (!tagsList) return [];
        
        const tagElements = tagsList.querySelectorAll('.tag');
        return Array.from(tagElements).map(el => el.textContent.replace('×', '').trim());
    }

    getEditedTitle() {
        return document.querySelector('.page-title').textContent.trim();
    }

    async handleSaveClick() {
        if (!(await SaveManager.startSave(this))) {
            return;
        }

        try {
            // 重置编辑模式
            this.resetEditMode();

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            this.currentTab = tab;
            logger.debug('当前标签页:', tab);

            if (tab) {
                const isSaved = await checkIfPageSaved(tab.url);
                
                if (isSaved) {
                    const bookmark = await LocalStorageMgr.getBookmark(tab.url);
                    this.handleEdit(bookmark);
                    return;
                }

                // 添加对非http页面的检查
                if (isNonMarkableUrl(tab.url)) {
                    updateStatus('基于隐私安全保护，不支持保存此页面', false);
                    return;
                }

                if (tab.status !== 'complete') {
                    updateStatus('页面正在加载中，请等待加载完成后再试', true);
                    return;
                }

                await this.processAndShowTags(tab);
            } else {
                updateStatus('基于隐私安全保护，不支持保存此页面', false);
            }
        } catch (error) {
            logger.error('保存过程中出错:', error);
            updateStatus('保存失败: ' + error.message, true);
        } finally {
            SaveManager.endSave(this);
        }
    }

    async handleUnsave(tab) {
        const bookmark = await LocalStorageMgr.getBookmark(tab.url);
        if (bookmark) {
            await LocalStorageMgr.removeBookmark(tab.url);
            await recordBookmarkChange(bookmark, true);
            updateStatus('已取消收藏');
            await Promise.all([
                renderBookmarksList(),
                updateBookmarkCount(),
                updateTabState(),
            ]);
        }
    }

    async processAndShowTags(tab) {
        this.pageContent = await getPageContent(tab);
        logger.debug('pageContent:', this.pageContent);

        // 检查是否有缓存的标签
        if (this.tagCache.url === tab.url && this.tagCache.tags.length > 0) {
            logger.debug('使用缓存的标签:', this.tagCache.tags);
            this.generatedTags = this.tagCache.tags;
        } else {
            // 没有缓存或URL不匹配，重新生成标签
            StatusManager.startOperation('正在生成标签');
            this.generatedTags = await generateTags(this.pageContent, tab);
            this.generatedTags = cleanTags(this.generatedTags);
            StatusManager.endOperation('标签生成完成: ' + this.generatedTags.join(', '));
        }   

        // 获取确认标签设置
        const confirmTags = await SettingsManager.get('display.confirmTags');
        if (confirmTags) {
            await this.showTagsDialog(this.generatedTags);
        } else {
            await this.saveBookmark(this.generatedTags, this.currentTab.title);
        }
    }

    // 添加重置编辑模式的方法
    resetEditMode() {
        this.isEditMode = false;
        this.editingBookmark = null;
        logger.debug('编辑模式已重置');
    }

    // 添加编辑模式的处理方法
    async handleEdit(bookmark) {
        this.isEditMode = true;
        this.editingBookmark = bookmark;
        this.currentTab = {
            url: bookmark.url,
            title: bookmark.title
        };
        
        // 设置页面内容
        this.pageContent = {
            excerpt: bookmark.excerpt,
            metadata: {}
        };

        // 显示编辑对话框
        await this.showTagsDialog(bookmark.tags);
    }

    async showTagsDialog(tags) {
        const dialog = document.getElementById('tags-dialog');
        const dialogTitle = dialog.querySelector('.page-title');
        const dialogUrl = dialog.querySelector('.page-url');
        const dialogFavicon = dialog.querySelector('.page-favicon img');
        const dialogExcerpt = dialog.querySelector('.page-excerpt');
        const recommendedTags = dialog.querySelector('.recommended-tags');
        const deleteBookmarkBtn = dialog.querySelector('#delete-bookmark-btn');

        // 缓存标签
        if (this.currentTab) {
            this.tagCache = {
                url: this.currentTab.url,
                tags: tags
            };
            logger.debug('已缓存标签:', this.tagCache);
        }

        // 设置删除按钮
        deleteBookmarkBtn.style.display = this.isEditMode ? 'flex' : 'none';
        // 设置标题
        dialogTitle.textContent = this.currentTab.title;
        dialogTitle.title = this.currentTab.title;
        
        // 设置URL
        dialogUrl.textContent = this.currentTab.url;
        dialogUrl.title = this.currentTab.url;

        // 设置图标
        dialogFavicon.src = await getFaviconUrl(this.currentTab.url);
        dialogFavicon.onerror = () => {
            // 如果图标加载失败，使用默认图标或隐藏图标容器
            dialogFavicon.src = 'icons/default_favicon.png'; // 确保你有一个默认图标
        };

        // 处理摘要
        if (this.pageContent?.excerpt) {
            const maxLength = 300; // 最大字符数
            const truncatedExcerpt = this.pageContent.excerpt.length > maxLength 
                ? this.pageContent.excerpt.substring(0, maxLength) + '...' 
                : this.pageContent.excerpt;
            dialogExcerpt.textContent = truncatedExcerpt;
            dialogExcerpt.style.display = 'block';
        } else {
            dialogExcerpt.style.display = 'none';
        }
        
        // 处理推荐标签
        recommendedTags.innerHTML = '';
        const metaKeywords = this.pageContent?.metadata?.keywords;
        if (metaKeywords) {
            const keywordTags = metaKeywords
                .split(/[,，;；]/)
                .map(tag => tag.trim())
                .filter(tag => tag.length > 0 && tag.length <= 20)
                .slice(0, 10);
                
            if (keywordTags.length > 0) {
                // 限制推荐标签数量
                const maxRecommendedTags = 10;
                const limitedTags = keywordTags.slice(0, maxRecommendedTags);
                
                // 在生成推荐标签的部分
                const recommendedTagsHtml = `
                    <div class="recommended-tags-title">推荐标签：</div>
                    <div class="recommended-tags-list">
                        ${limitedTags.map(tag => `<span class="tag" data-tag="${tag}">${tag}</span>`).join('')}
                    </div>
                `;
                
                recommendedTags.innerHTML = recommendedTagsHtml;
                
                // 为推荐标签添加点击事件
                recommendedTags.querySelectorAll('.tag').forEach(tagElement => {
                    tagElement.addEventListener('click', () => {
                        const tag = tagElement.dataset.tag;
                        const currentTags = this.getCurrentTags();
                        if (!currentTags.includes(tag)) {
                            this.renderTags([...currentTags, tag]);
                        }
                    });
                });
            }
        }

        // 渲染已有标签
        this.renderTags(tags);
        
        // 显示对话框
        dialog.classList.add('show');
    }

    renderTags(tags) {
        const tagsList = document.getElementById('tags-list');
        tagsList.innerHTML = '';
        
        tags.forEach(tag => {
            const tagElement = document.createElement('span');
            tagElement.className = 'tag';
            tagElement.innerHTML = `
                ${tag}
                <button class="remove-tag-btn">×</button>
            `;
            tagsList.appendChild(tagElement);
        });
    }

    async saveBookmark(tags, title) {
        try {
            if (!this.currentTab) {
                throw new Error('页面信息获取失败');
            }
            StatusManager.startOperation(this.isEditMode ? '正在更新书签' : '正在保存书签');
            
            // 如果是编辑现有书签,保留原有的 embedding 和其他信息
            const embedding = this.isEditMode ? this.editingBookmark.embedding : await getEmbedding(preprocessText(this.pageContent, this.currentTab, tags));
            const apiService = await ConfigManager.getActiveService();
            
            const pageInfo = {
                url: this.currentTab.url,
                title: title,
                tags: tags,
                excerpt: this.pageContent?.excerpt || '',
                embedding: embedding,
                savedAt: this.isEditMode ? this.editingBookmark.savedAt : new Date().toISOString(),
                useCount: this.isEditMode ? this.editingBookmark.useCount : 1,
                lastUsed: this.isEditMode ? this.editingBookmark.lastUsed : new Date().toISOString(),
                apiService: this.isEditMode ? this.editingBookmark.apiService : apiService.id,
            };

            // 打印书签编辑信息
            logger.debug('书签编辑信息:', {
                isEditMode: this.isEditMode,
                before: this.isEditMode ? this.editingBookmark : null,
                after: pageInfo
            });
            
            await LocalStorageMgr.setBookmark(this.currentTab.url, pageInfo);
            await recordBookmarkChange(pageInfo);

            await Promise.all([
                renderBookmarksList(),
                updateBookmarkCount(),
                updateTabState(),
            ]);
            StatusManager.endOperation(this.isEditMode ? '书签更新成功' : '书签保存成功', false);
        } catch (error) {
            logger.error('保存书签时出错:', error);
            StatusManager.endOperation(this.isEditMode ? '书签更新失败' : '书签保存失败', true);
        } finally {
            this.resetEditMode();
        }   
    }
}

// 获取当前页面的文本内容
async function getPageContent(tab) {
    try {
        const isPrivate = await determinePrivacyMode(tab);
        if (isPrivate || !isValidUrl(tab.url)) {
            logger.info('页面为隐私模式或URL无效');
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

// 用 ChatGPT API 生成标签
async function generateTags(pageContent, tab) {
    const { title, content, excerpt, metadata } = pageContent;
    try {
        const cleanUrl = tab.url.replace(/\?.+$/, '').replace(/[#&].*$/, '').replace(/\/+$/, '');
        
        // 构建更丰富的 prompt
        const prompt = `请根据以下网页内容提取2-5个简短、具有区分度的关键词，用于分类和查找。

网页信息：
标题：${title ? title : tab.title}
URL：${cleanUrl}
${excerpt ? `摘要：${smartTruncate(excerpt, 500)}` : ''}
${metadata?.keywords ? `关键词：${metadata.keywords.slice(0, 500)}` : ''}
${metadata?.author ? `作者：${metadata.author}` : ''}
${content ? `页面正文开头：${smartTruncate(content, 500)}` : ''}

关键词应符合以下要求：
1. 关键词长度：中文关键词2-5字，英文关键词不超过2个单词。
2. 准确性：关键词需精准反映文章核心主题。
3. 多样性：必须涵盖以下四类信息（如有）：
   - 网站名称或品牌信息。
   - 网站标题核心内容。
   - 网站涉及的领域（如科技、教育、金融等）。
   - 页面具体内容的关键词（如技术名词、专业术语）。
4. 去重性：避免标题、正文等重复关键词。
5. 输出格式：直接返回关键词列表，关键词不能包含标点符号，各关键词之间用"|"分隔，无需其他说明。

例如：小红书|AI生成|内容分析|关键词优化|提示词设计`;

        logger.debug('生成标签的prompt:', prompt);

        const apiService = await ConfigManager.getActiveService();
        const apiKey = await ConfigManager.getAPIKey(apiService.id);
        if (!apiKey) {
            throw new Error('API密钥不存在');
        }   
        // 调用 API 生成标签
        const response = await fetch(apiService.baseUrl + 'chat/completions', {
            method: 'POST',
            headers: apiService.headers(apiKey),
            body: JSON.stringify({
                model: apiService.chatModel,
                messages: [{
                    role: "system",
                    content: "你是一个专业的网页内容分析专家，擅长提取文章的核心主题并生成准确的标签。"
                }, {
                    role: "user",
                    content: prompt
                }],
                temperature: 0.3, // 降低温度以获得更稳定的输出
                max_tokens: 100,
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            const errorMessage = errorData.error?.message || response.statusText;
            const errorType = errorData.error?.type || 'unknown';
            const errorCode = errorData.error?.code || 'unknown';
            throw new Error(`API 请求失败: ${errorMessage} (类型: ${errorType}, 代码: ${errorCode})`);
        }

        const data = await response.json();
        logger.debug('completion response:', data);
        const tagsText = data.choices[0].message.content.trim();

        // 记录使用统计
        await statsManager.recordChatUsage(
            data.usage?.prompt_tokens || 0,
            data.usage?.completion_tokens || 0
        );
        
        // 处理返回的标签
        let tags = tagsText
            .split('|')
            .map(tag => tag.trim())
            .filter(tag => {
                if (!tag) return false;
                const tagLength = getStringVisualLength(tag);
                logger.debug('标签长度:', {
                    tag: tag,
                    length: tagLength
                });
                if (tagLength < 2 || tagLength > 20) {
                    return false;
                }
                return /^[^\.,\/#!$%\^&\*;:{}=\-_`~()]+$/.test(tag);
            })
            // 添加去重逻辑
            .filter((tag, index, self) => self.indexOf(tag) === index)
            // 限制最多5个标签
            .slice(0, 5);
        

        logger.debug('AI生成的标签:', tags);
        
        // 如果没有生成有效标签，使用备选方案
        if (tags.length === 0) {
            tags = getFallbackTags(title, metadata);
        }

        return tags.length > 0 ? tags : ['未分类'];

    } catch (error) {
        logger.error('生成标签时出错:', error);
        const fallbackTags = getFallbackTags(tab.title, metadata);
        return fallbackTags.length > 0 ? fallbackTags : ['未分类'];
    }
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
            const maxWords = Math.round(maxLength * 0.6);
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

function preprocessText(pageContent, tab, tags) {
    let text = "";
    if (pageContent) {
        text += pageContent.title ? `标题: ${pageContent.title};` : '';
        text += tags.length > 0 ? `标签: ${tags.join(',')};` : '';
        text += pageContent.excerpt ? `摘要: ${smartTruncate(pageContent.excerpt, 200)};` : '';
    } else {
        const cleanUrl = tab.url.replace(/\?.+$/, '').replace(/[#&].*$/, '').replace(/\/+$/, '');
        text += `标题: ${tab.title};`;
        text += `URL: ${cleanUrl};`;
    }
    
    // 优化的文本清理
    text = text
        .replace(/[\r\n]+/g, ' ')        // 将所有换行符替换为空格
        .replace(/\s+/g, ' ')            // 将连续空白字符替换为单个空格
        .replace(/[\t\f\v]+/g, ' ')      // 替换制表符等特殊空白字符
        .trim();                         // 去除首尾空格
    
    // 限制总长度（考虑token限制）
    const maxLength = 4096;
    if (text.length > maxLength) {
        // 尝试在词边界处截断
        const truncated = text.slice(0, maxLength);
        // 找到最后一个完整词的位置
        const lastSpace = truncated.lastIndexOf(' ');
        if (lastSpace > maxLength * 0.8) { // 如果找到的位置会损失太多内容
            text = truncated.slice(0, lastSpace);
        } else {
            text = truncated;
        }
    }
    
    return text;
}

// 优化后的嵌入向量生成函数
async function getEmbedding(text) {
    logger.debug('获取嵌入向量:', text);
    try {
        const apiService = await ConfigManager.getActiveService();  
        const apiKey = await ConfigManager.getAPIKey(apiService.id);
        if (!apiKey) {
            throw new Error('API密钥不存在');
        }
        const response = await fetch(apiService.baseUrl + 'embeddings', {
            method: 'POST',
            headers: apiService.headers(apiKey),
            body: JSON.stringify({
                model: apiService.embedModel,
                input: text,
                dimensions: 1024
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API错误: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        logger.debug('embedding response:', data);
        if (!data.data?.[0]?.embedding) {
            throw new Error('无效的API响应格式');
        }

        // 记录使用统计
        await statsManager.recordEmbeddingUsage(data.usage?.total_tokens || 0);

        return data.data[0].embedding;
    } catch (error) {
        logger.error(`获取嵌入向量失败:`, error);
    }
    return null;
}

function displaySearchResults(results) {
    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = '';
    const searchInput = document.getElementById('search-input').value.toLowerCase().trim();

    // 将结果处理包装在异步函数中
    const createResultElement = async (result) => {
        const li = document.createElement('li');
        li.className = 'result-item';
        
        // 添加高相关度样式
        if (result.score >= 80) {
            li.classList.add('high-relevance');
        }

        // 高亮显示匹配的文本
        const highlightText = (text) => {
            if (!text || !searchInput) return text;
            const regex = new RegExp(`(${searchInput})`, 'gi');
            return text.replace(regex, '<mark>$1</mark>');
        };

        // 限制摘要长度为一行（约100个字符）
        const truncateExcerpt = (text) => {
            if (!text) return '';
            return text.length > 100 ? text.slice(0, 100) + '...' : text;
        };

        const tags = result.tags.map(tag => 
            result.source === BookmarkSource.CHROME ? 
            `<span class="tag folder-tag">${highlightText(tag)}</span>` :
            `<span class="tag">${highlightText(tag)}</span>`
        ).join('');

        const preview = highlightText(truncateExcerpt(result.excerpt || ''));

        // 使用 getFaviconUrl 函数获取图标
        const faviconUrl = await getFaviconUrl(result.url);

        // 添加相关度显示
        const scoreDisplay = result.score > 60 ? 
            `<div class="result-score">
                ${result.score >= 80 ? '⭐ ' : ''}相关度: ${Math.round(result.score)}%
            </div>` : '';

        li.innerHTML = `
            <a href="${result.url}" class="result-link" target="_self">
                <div class="result-header">
                    <div class="result-title-wrapper">
                        <div class="result-favicon">
                            <img src="${faviconUrl}" alt="">
                        </div>
                        <span class="result-title" title="${result.title}">${highlightText(result.title)}</span>
                    </div>
                </div>
                <div class="result-preview" title="${result.excerpt || ''}">${preview}</div>
                <div class="result-tags">${tags}</div>
                ${scoreDisplay}
            </a>
            <button class="delete-btn" title="删除">
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>
                </svg>
            </button>
        `;

        // 为图标添加错误处理
        const img = li.querySelector('.result-favicon img');
        img.addEventListener('error', function() {
            this.src = 'icons/default_favicon.png';
        });

        // 修改点击事件处理
        const link = li.querySelector('.result-link');
        link.addEventListener('click', async (e) => {
            // 根据点击方式决定打开方式
            if (isNonMarkableUrl(result.url)) {
                e.preventDefault();
                // 显示提示并提供复制链接选项
                const copyConfirm = confirm('此页面无法直接打开。是否复制链接到剪贴板？');
                if (copyConfirm) {
                    await navigator.clipboard.writeText(result.url);
                    updateStatus('链接已复制到剪贴板');
                }
            } else {
                // 更新使用频率
                if (result.source === BookmarkSource.EXTENSION) {
                    await updateBookmarkUsage(result.url);
                }
                // 如果是按住 Ctrl 键点击或中键点击，使用默认行为（在新标签页打开）
                if (e.ctrlKey || e.metaKey || e.button === 1) {
                    return; // 不阻止默认行为，让浏览器处理
                }
                
                // 普通点击，在当前标签页打开
                e.preventDefault();
                chrome.tabs.update({ url: result.url });
            }
        });

        // 删除按钮事件处理保持不变
        li.querySelector('.delete-btn').onclick = (e) => {
            e.stopPropagation();
            deleteBookmark(result);
        };

        return li;
    };

    // 使用 Promise.all 处理所有结果
    Promise.all(results.map(createResultElement))
        .then(elements => elements.forEach(li => resultsContainer.appendChild(li)));
}

// 删除书签的函数
async function deleteBookmark(bookmark) {
    try {
        const confirmation = confirm('确定要删除此收藏吗？');
        if (confirmation) {
            // 先删除书签
            if (bookmark.source === BookmarkSource.EXTENSION) {
                await LocalStorageMgr.removeBookmark(bookmark.url);
                await recordBookmarkChange(bookmark, true);
            } else {
                await chrome.bookmarks.remove(bookmark.chromeId);
            }
            
            // 并行执行所有UI更新
            await Promise.all([
                renderBookmarksList(),    // 确保更新书签列表
                updateBookmarkCount(),    // 更新计数
                updateTabState(),    // 更新保存按钮状态
            ]);

            // 如果在搜索模式，更新搜索结果
            const searchInput = document.getElementById('search-input');
            if (searchInput.value) {
                const queryEmbedding = await getEmbedding(searchInput.value);
                const results = await searchSavedPages(queryEmbedding);
                displaySearchResults(results);
            }
            updateStatus('书签已成功删除', false);
        }
    } catch (error) {
        logger.error('删除书签时出错:', error);
        updateStatus('删除失败: ' + error.message, true);
    }
}

// 状态显示管理器
const StatusManager = {
    timeoutId: null,
    
    // 显示状态消息
    show(message, isError = false, duration = null) {
        const status = document.getElementById('status');
        if (!status) {
            logger.error('状态显示元素未找到');
            return;
        }
        
        // 清除之前的任何状态
        this.clear();
        
        // 显示新消息
        status.textContent = message;
        status.className = 'status-message ' + (isError ? 'error' : 'success');
        
        // 如果指定了持续时间，设置自动清除
        if (duration !== null) {
            this.timeoutId = setTimeout(() => {
                this.clear();
            }, duration);
        }
    },
    
    // 开始新操作
    startOperation(operationName) {
        // 显示加载状态，不自动清除
        this.show(`${operationName}...`);
    },

    endOperation(message, failed = false) {
        // 显示结果消息，并设置适当的显示时间
        const duration = failed ? 3000 : 2000;
        this.show(message, failed, duration);
    },
    
    // 清除状态显示
    clear() {
        const status = document.getElementById('status');
        if (status) {
            status.textContent = '';
            status.className = 'status-message';
        }
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }
};

// 更新状态显示的辅助函数
function updateStatus(message, isError = false) {
    const duration = isError ? 3000 : 2000;
    StatusManager.show(message, isError, duration);
}

// 修改搜索函数，添加相似度阈值
async function searchSavedPages(queryEmbedding) {
    const searchInput = document.getElementById('search-input').value.toLowerCase().trim();
    const allBookmarks = await getAllBookmarks();
    
    // 定义相似度阈值
    const apiService = await ConfigManager.getActiveService();
    const SIMILARITY_THRESHOLDS = {
        MAX: apiService.similarityThreshold?.MAX || 0.85,
        HIGH: apiService.similarityThreshold?.HIGH || 0.65, // 高相关性，分数 >= 80
        MEDIUM: apiService.similarityThreshold?.MEDIUM || 0.5, // 有点相关，可以显示， 分数 >= 60
        LOW: apiService.similarityThreshold?.LOW || 0.4 // 基本无关，如果有关键词可能显示
    };
    logger.debug('相似度阈值:', SIMILARITY_THRESHOLDS);

    //  计算单个书签的分数
    const calculateBookmarkScore = (item, queryEmbedding, searchInput) => {
        // 1. 计算向量相似度
        let similarity = 0;
        if (item.source === BookmarkSource.EXTENSION && item.embedding) {
            similarity = cosineSimilarity(queryEmbedding, item.embedding);
        }
        
        // 2. 检查关键词匹配
        const keywordMatch = {
            title: item.title?.toLowerCase().includes(searchInput) || false,
            tags: item.tags?.some(tag => tag.toLowerCase().includes(searchInput)) || false,
            excerpt: item.excerpt?.toLowerCase().includes(searchInput) || false
        };
        
        const hasKeywordMatch = Object.values(keywordMatch).some(match => match);
        
        // 3. 计算基础分数
        let score = 0;
        if (similarity >= SIMILARITY_THRESHOLDS.HIGH) {
            score = hasKeywordMatch 
                ? 90 + 10 * (similarity - SIMILARITY_THRESHOLDS.HIGH) / (SIMILARITY_THRESHOLDS.MAX - SIMILARITY_THRESHOLDS.HIGH)
                : 80 + 20 * (similarity - SIMILARITY_THRESHOLDS.HIGH) / (SIMILARITY_THRESHOLDS.MAX - SIMILARITY_THRESHOLDS.HIGH);
        } else if (similarity >= SIMILARITY_THRESHOLDS.MEDIUM) {
            score = hasKeywordMatch
                ? 70 + 20 * (similarity - SIMILARITY_THRESHOLDS.MEDIUM) / (SIMILARITY_THRESHOLDS.HIGH - SIMILARITY_THRESHOLDS.MEDIUM)
                : 60 + 20 * (similarity - SIMILARITY_THRESHOLDS.MEDIUM) / (SIMILARITY_THRESHOLDS.HIGH - SIMILARITY_THRESHOLDS.MEDIUM);
        } else if (similarity >= SIMILARITY_THRESHOLDS.LOW) {
            score = hasKeywordMatch
                ? 30 + 30 * (similarity - SIMILARITY_THRESHOLDS.LOW) / (SIMILARITY_THRESHOLDS.MEDIUM - SIMILARITY_THRESHOLDS.LOW)
                : 20 + 40 * (similarity - SIMILARITY_THRESHOLDS.LOW) / (SIMILARITY_THRESHOLDS.MEDIUM - SIMILARITY_THRESHOLDS.LOW);
        }
        
        // 4. 根据匹配位置微调分数
        if (hasKeywordMatch) {
            score += (keywordMatch.title ? 5 : 0) +
                    (keywordMatch.tags ? 3 : 0) +
                    (keywordMatch.excerpt ? 2 : 0);
        }
        
        // 确保分数在0-100范围内
        score = Math.min(100, Math.max(0, score));
        
        return {
            ...item,
            score,
            similarity,
            keywordMatch
        };
    };

    // 重构后的搜索函数部分
    const results = Object.values(allBookmarks)
        .map(item => calculateBookmarkScore(item, queryEmbedding, searchInput));

    if (DEBUG) {
        // 打印详细的匹配信息用于调试
        results.sort((a, b) => b.score - a.score || b.similarity - a.similarity);
        logger.debug('搜索结果详情:', results.map(r => ({
            title: r.title,
            score: Math.round(r.score),
            similarity: r.similarity.toFixed(3),
            keywordMatch: r.keywordMatch
        })));
    }

    const filteredResults = results.filter(item => item.score >= 60 || Object.values(item.keywordMatch).some(match => match));
    // 按分数降序排序, 分数相同按相似度排序
    filteredResults.sort((a, b) => b.score - a.score || b.similarity - a.similarity);
    
    return filteredResults;
}

// 计算余弦相似度
function cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length === 0 || vec2.length === 0) {
        return 0;
    }

    const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
    const magnitudeA = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
    return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    logger.debug("popup 收到消息", {
        message: message,
        sender: sender,
    });

    if (message.type === 'UPDATE_TAB_STATE') {
        const [tab] = await chrome.tabs.query({ 
            active: true, 
            currentWindow: true 
        });
        if (tab) {
            const isSaved = await checkIfPageSaved(tab.url);
            updateSaveButtonState(isSaved);
            await updatePrivacyIconState(tab);
        }
    } else if (message.type === 'TOGGLE_SEARCH') {
        toggleSearching();
    } else if (message.type === 'BOOKMARKS_UPDATED') {
        await Promise.all([
            renderBookmarksList(),    // 确保更新书签列表
            updateBookmarkCount(),    // 更新计数
            updateTabState(),    // 更新保存按钮状态
        ]);
        const bookmarkMgr = await getBookmarkManager();
        await bookmarkMgr.checkEmbeddingStatus();
    } else if (message.type === 'START_SYNC') {
        const bookmarkMgr = await getBookmarkManager();
        bookmarkMgr.setSyncingState(true);
    } else if (message.type === 'FINISH_SYNC') {
        const bookmarkMgr = await getBookmarkManager();
        bookmarkMgr.setSyncingState(false);
    }
});

// 修改现有的搜索框切换功能，添加一个可复用的函数
function toggleSearching(skipAnimation = false) {
    const toolbar = document.querySelector('.toolbar');
    if (!toolbar) return;

    const isSearching = toolbar.classList.contains('searching');
    if (isSearching) {
        closeSearching();
    } else {
        openSearching(skipAnimation);
    }
}

// 打开搜索框
function openSearching(skipAnimation = false) {
    const toolbar = document.querySelector('.toolbar');
    const searchInput = document.getElementById('search-input');
    if (!toolbar || !searchInput) return;

    if (skipAnimation) {
        toolbar.classList.add('searching', 'no-transition');
        requestAnimationFrame(() => {
            toolbar.classList.remove('no-transition');
        });
    } else {
        toolbar.classList.add('searching');
        setTimeout(() => {
            searchInput.focus();
        }, 300);
    }
    // 渲染搜索历史
    renderSearchHistory().then(() => {
        logger.debug('搜索历史渲染完成');
    }).catch(error => {
        logger.error('搜索历史渲染失败:', error);
    });
}

// 关闭搜索框
function closeSearching() {
    const toolbar = document.querySelector('.toolbar');
    const searchInput = document.getElementById('search-input');
    if (!toolbar || !searchInput) return;

    toolbar.classList.remove('searching');
    searchInput.value = ''; // 清空搜索框
    // 清空搜索结果
    const searchResults = document.getElementById('search-results');
    if (searchResults) {
        searchResults.innerHTML = '';
    }
}

// 更新保存按钮状态的函数
function updateSaveButtonState(isSaved) {
    const saveButton = document.getElementById('save-page');
    if (!saveButton) return;
    
    if (isSaved) {
        saveButton.classList.add('editing');
        saveButton.title = '编辑书签';
    } else {
        saveButton.classList.remove('editing');
        saveButton.title = '为此页面添加书签';
    }
}

// 更新收藏数量显示
async function updateBookmarkCount() {
    try {
        const allBookmarks = await getAllBookmarks();
        const count = Object.keys(allBookmarks).length;
        const bookmarkCount = document.getElementById('bookmark-count');
        bookmarkCount.setAttribute('data-count', count);
        bookmarkCount.textContent = '书签';
    } catch (error) {
        logger.error('获取收藏数量失败:', error);
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

// 保存当前渲染器实例的引用
let currentRenderer = null;

// 修改渲染书签列表函数
async function renderBookmarksList() {
    const settings = await SettingsManager.getAll();
    const viewMode = settings.display.viewMode;
    const sortBy = settings.sort.bookmarks;

    const bookmarksList = document.getElementById('bookmarks-list');
    if (!bookmarksList) return;

    try {
        if (currentRenderer) {
            currentRenderer.cleanup();
            currentRenderer = null;
        }

        const data = viewMode === 'group'
            ? Object.values(await getAllBookmarks())
            : await filterManager.getFilteredBookmarks();

        let bookmarks = data.map((item) => ({
                ...item,
                // 统一使用时间戳进行比较
                savedAt: item.savedAt ? new Date(item.savedAt).getTime() : 0,
                useCount: calculateWeightedScore(item.useCount, item.lastUsed),
                lastUsed: item.lastUsed ? new Date(item.lastUsed).getTime() : 0
            }));
        // 添加空状态处理
        if (bookmarks.length === 0) {
            bookmarksList.innerHTML = `
                <li class="empty-state">
                    <div class="empty-message">
                        还没有保存任何书签
                        <br>
                        点击左上角的书签图标开始收藏
                    </div>
                </li>`;
            return;
        }

        // 根据选择的排序方式进行排序
        const [sortField, sortOrder] = sortBy.split('_');
        const isAsc = sortOrder === 'asc';
        
        bookmarks.sort((a, b) => {
            let comparison = 0;
            
            switch (sortField) {
                case 'savedAt':
                    comparison = (b.savedAt || 0) - (a.savedAt || 0);
                    break;
                    
                case 'useCount':
                    comparison = (b.useCount || 0) - (a.useCount || 0);
                    if (comparison === 0) {
                        // 使用次数相同时，按保存时间排序
                        comparison = (b.savedAt || 0) - (a.savedAt || 0);
                    }
                    break;
                    
                case 'lastUsed':
                    comparison = (b.lastUsed || 0) - (a.lastUsed || 0);
                    if (comparison === 0) {
                        // 最后使用时间相同时，按保存时间排序
                        comparison = (b.savedAt || 0) - (a.savedAt || 0);
                    }
                    break;
            }
            
            return isAsc ? -comparison : comparison;
        });

        // 根据视图模式选择渲染器
        if (viewMode === 'group') {
            currentRenderer = new GroupedBookmarkRenderer(bookmarksList, bookmarks);
        } else {
            currentRenderer = new BookmarkRenderer(bookmarksList, bookmarks);
        }
        await currentRenderer.initialize();
        
    } catch (error) {
        logger.error('渲染书签列表失败:', error);
        updateStatus('加载书签失败: ' + error.message, true);
    }
}

// 修改视图模式切换事件处理
async function initializeViewModeSwitch() {
    const viewButtons = document.querySelectorAll('.view-mode-button');
    
    // 初始化时设置保存的视图模式
    const savedViewMode = await SettingsManager.get('display.viewMode');
    viewButtons.forEach(button => {
        if (button.dataset.mode === savedViewMode) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });
    filterManager.toggleDisplayFilter(savedViewMode === 'list');

    viewButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const mode = button.dataset.mode;
            if (button.classList.contains('active')) return;

            // 更新按钮状态
            viewButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // 保存视图模式设置
            await SettingsManager.update({
                display: {
                    viewMode: mode
                }
            });
            filterManager.toggleDisplayFilter(mode === 'list');

            // 切换视图模式
            await renderBookmarksList();
        });
    });
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

// 修改更新书签使用频率的函数
async function updateBookmarkUsage(url) {
    try {
        const data = await LocalStorageMgr.getBookmark(url);
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

async function recordBookmarkChange(bookmarks, isDeleted) {
    chrome.runtime.sendMessage({
        type: 'SYNC_BOOKMARK_CHANGE',
        data: { bookmarks, isDeleted }
    }, (response) => {
        if (chrome.runtime.lastError) {
            logger.error('同步失败:', chrome.runtime.lastError);
            return;
        }
        logger.debug("recordBookmarkChange response", response);
        if (!response.success) {
            updateStatus('同步失败: ' + response.error, true);
        }
    });
}

// 添加分页配置
const PAGINATION = {
    INITIAL_SIZE: 50,
    LOAD_MORE_SIZE: 25
};

// 书签渲染器类
class BookmarkRenderer {
    constructor(container, bookmarks) {
        this.container = container;
        this.allBookmarks = bookmarks;
        this.displayedCount = 0;
        this.loading = false;
        this.observer = null;
        this.loadingIndicator = null;
    }

    // 添加清理方法
    cleanup() {
        // 断开观察器连接
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        // 移除加载指示器
        if (this.loadingIndicator && this.loadingIndicator.parentNode) {
            this.loadingIndicator.parentNode.removeChild(this.loadingIndicator);
            this.loadingIndicator = null;
        }
        // 清空容器
        if (this.container) {
            this.container.innerHTML = '';
        }
        // 重置状态
        this.displayedCount = 0;
        this.loading = false;
    }

    async initialize() {
        // 清理之前的实例
        this.cleanup();

        // 创建加载指示器
        this.loadingIndicator = document.createElement('div');
        this.loadingIndicator.className = 'loading-indicator';
        this.loadingIndicator.innerHTML = `
            <div class="loading-spinner"></div>
            <span>加载更多...</span>
        `;
        this.container.parentNode.appendChild(this.loadingIndicator);

        // 初始渲染
        await this.renderBookmarks(0, PAGINATION.INITIAL_SIZE);

        // 设置无限滚动
        this.setupInfiniteScroll();
    }

    async renderBookmarks(start, count) {
        if (this.loading || start >= this.allBookmarks.length) return;
        
        this.loading = true;
        const fragment = document.createDocumentFragment();
        const end = Math.min(start + count, this.allBookmarks.length);

        for (let i = start; i < end; i++) {
            const bookmark = this.allBookmarks[i];
            const li = await this.createBookmarkElement(bookmark);
            fragment.appendChild(li);
        }

        this.container.appendChild(fragment);
        this.displayedCount = end;
        this.loading = false;

        // 更新加载指示器的可见性
        this.loadingIndicator.style.display = 
            this.displayedCount < this.allBookmarks.length ? 'flex' : 'none';
    }

    async createBookmarkElement(bookmark) {
        const li = document.createElement('li');
        li.className = 'bookmark-item';

        // 根据标签类型使用不同的样式
        const tags = bookmark.tags.map(tag => {
            if (bookmark.source === BookmarkSource.CHROME) {
                return `<span class="tag folder-tag">${tag}</span>`;
            } else {
                return `<span class="tag">${tag}</span>`;
            }
        }).join('');

        const editBtn = bookmark.source === BookmarkSource.EXTENSION 
            ? `<button class="edit-btn" title="编辑">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M3,17.25V21H6.75L17.81,9.93L14.06,6.18M17.5,3C19.54,3 21.43,4.05 22.39,5.79L20.11,7.29C19.82,6.53 19.19,6 18.5,6A2.5,2.5 0 0,0 16,8.5V11H18V13H16V15H18V17.17L16.83,18H13V16H15V14H13V12H15V10H13V8.83"></path>
                    </svg>
                </button>` 
            : '';
        
        li.innerHTML = `
            <a href="${bookmark.url}" class="bookmark-link" target="_self">
                <div class="bookmark-info">
                    <div class="bookmark-main">
                        <div class="bookmark-favicon">
                            <img src="${await getFaviconUrl(bookmark.url)}" alt="" loading="lazy">
                        </div>
                        <h3 class="bookmark-title" title="${bookmark.title}">${bookmark.title}</h3>
                        <div class="bookmark-actions">
                            ${editBtn}
                            <button class="delete-btn" title="删除">
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                    <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="bookmark-meta">
                        <div class="bookmark-tags">
                            ${tags}
                        </div>
                    </div>
                </div>
            </a>
        `;

        // 为标签添加动画延迟
        const tagElements = li.querySelectorAll('.bookmark-tags .tag');
        const baseDelay = 0.05; // 基础延迟时间（秒）
        tagElements.forEach((tag, index) => {
            const delay = index < 5 ? baseDelay * index : 0.25;
            tag.style.setProperty('--delay', `${delay}s`);
        });

        // 添加事件监听器
        this.setupBookmarkEvents(li, bookmark);
        
        return li;
    }

    setupBookmarkEvents(li, bookmark) {
        // 删除按钮事件
        li.querySelector('.delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            deleteBookmark(bookmark);
        });

        // 添加编辑按钮事件处理
        const editBtn = li.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                // 获取 BookmarkManager 实例
                const bookmarkManager = await getBookmarkManager();
                if (bookmarkManager) {
                    await bookmarkManager.handleEdit(bookmark);
                }
            });
        }

        // 保持原有的图标错误处理逻辑
        const img = li.querySelector('.bookmark-favicon img');
        img.addEventListener('error', function() {
            this.src = 'icons/default_favicon.png';
        });

        // 修改点击事件处理，只处理链接点击
        const link = li.querySelector('.bookmark-link');
        link.addEventListener('click', async (e) => {
            if (isNonMarkableUrl(bookmark.url)) {
                e.preventDefault();
                // 显示提示并提供复制链接选项   
                const copyConfirm = confirm('此页面无法直接打开。是否复制链接到剪贴板？');
                if (copyConfirm) {
                    await navigator.clipboard.writeText(bookmark.url);  
                    updateStatus('链接已复制到剪贴板'); 
                }
            } else {
                if (bookmark.source === BookmarkSource.EXTENSION) {
                    // 更新使用频率
                    await updateBookmarkUsage(bookmark.url);
                }
                // 根据点击方式决定打开方式
                if (e.ctrlKey || e.metaKey || e.button === 1) {
                    return;
                }

                e.preventDefault(); // 阻止默认的新标签页打开
                chrome.tabs.update({ url: bookmark.url });
            }
        });
    }

    setupInfiniteScroll() {
        // 使用 Intersection Observer 监控加载指示器
        this.observer = new IntersectionObserver(async (entries) => {
            const entry = entries[0];
            if (entry.isIntersecting && !this.loading) {
                await this.renderBookmarks(
                    this.displayedCount,
                    PAGINATION.LOAD_MORE_SIZE
                );
            }
        }, {
            root: null,
            rootMargin: '100px',
            threshold: 0.1
        });

        this.observer.observe(this.loadingIndicator);
    }
}

class GroupedBookmarkRenderer extends BookmarkRenderer {
    constructor(container, bookmarks) {
        super(container, bookmarks);
        this.groups = [];
    }

    async initialize() {
        // 获取所有自定义标签规则
        const rules = customFilter.getRules();
        
        // 按规则对书签进行分组
        for (const rule of rules) {
            const matchedBookmarks = await customFilter.filterBookmarks(this.allBookmarks, rule);
            this.groups.push({
                name: rule.name,
                rule: rule,
                bookmarks: matchedBookmarks
            });
        }
        
        await this.render();
    }

    async render() {
        this.container.innerHTML = '';
        
        for (const [index, group] of this.groups.entries()) {
            const groupElement = document.createElement('div');
            groupElement.className = 'bookmarks-group';
            
            // 创建分组头部
            const header = document.createElement('div');
            header.className = 'group-header';
            header.innerHTML = `
                <svg class="group-toggle collapsed" viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
                </svg>
                <span class="group-title">
                    ${group.name}
                    <span class="group-count">${group.bookmarks.length}</span>
                </span>
            `;
            
            // 创建分组内容
            const content = document.createElement('div');
            content.className = 'group-content collapsed';
            
            if (group.bookmarks.length > 0) {
                const bookmarksList = document.createElement('ul');
                bookmarksList.className = 'bookmarks-list';
                
                for (const bookmark of group.bookmarks) {
                    const bookmarkElement = await this.createBookmarkElement(bookmark);
                    bookmarksList.appendChild(bookmarkElement);
                }
                
                content.appendChild(bookmarksList);
            } else {
                content.innerHTML = '<div class="group-empty">暂无书签</div>';
            }
            
            // 绑定折叠事件
            header.addEventListener('click', () => {
                const toggle = header.querySelector('.group-toggle');
                toggle.classList.toggle('collapsed');
                content.classList.toggle('collapsed');
            });

            if (index === 0) {
                const toggle = header.querySelector('.group-toggle');
                toggle.classList.toggle('collapsed');
                content.classList.toggle('collapsed');
            }
            
            groupElement.appendChild(header);
            groupElement.appendChild(content);
            this.container.appendChild(groupElement);
        }
        
        // 在所有分组之后添加"添加自定义书签"提示
        const addCustomGroupTip = document.createElement('div');
        addCustomGroupTip.className = 'add-custom-group-tip';
        addCustomGroupTip.innerHTML = `
            <div class="tip-content">
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
                </svg>
                <span>添加自定义分组</span>
            </div>
        `;
        
        // 添加点击事件，跳转到设置页面
        addCustomGroupTip.addEventListener('click', () => {
            openOptionsPage('filters');
        });
        
        this.container.appendChild(addCustomGroupTip);
    }

    cleanup() {
        this.container.innerHTML = '';
    }
}

class SettingsDialog {
    constructor() {
        this.dialog = document.getElementById('settings-dialog');
        this.elements = {
            openBtn: document.getElementById('open-settings'),
            closeBtn: this.dialog.querySelector('.close-dialog-btn'),
            showChromeBookmarks: document.getElementById('show-chrome-bookmarks'),
            autoFocusSearch: document.getElementById('auto-focus-search'),
            confirmTags: document.getElementById('confirm-tags'),
            autoPrivacySwitch: document.getElementById('auto-privacy-mode'),
            manualPrivacySwitch: document.getElementById('manual-privacy-mode'),
            manualPrivacyContainer: document.getElementById('manual-privacy-container'),
            shortcutsBtn: document.getElementById('keyboard-shortcuts'),
            openSettingsPageBtn: document.getElementById('open-settings-page')
        };
    }

    async initialize() {
        // 绑定基本事件
        this.setupEventListeners();
        // 初始化设置状态
        await this.loadSettings();
        // 设置项隐藏
        this.hideSettings();
    }

    setupEventListeners() {
        // 对话框开关事件
        this.elements.openBtn.addEventListener('click', () => this.open());
        this.elements.closeBtn.addEventListener('click', () => this.close());
        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) this.close();
        });
        
        // ESC键关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.dialog.classList.contains('show')) {
                this.close();
            }
        });

        // 设置变更事件
        this.elements.showChromeBookmarks.addEventListener('change', async (e) => 
            await this.handleSettingChange('display.showChromeBookmarks', e.target.checked, async () => {
                await Promise.all([
                    renderBookmarksList(),
                    updateBookmarkCount()
                ]);
            }));

        this.elements.autoFocusSearch.addEventListener('change', async (e) =>
            await this.handleSettingChange('display.autoFocusSearch', e.target.checked));

        this.elements.confirmTags.addEventListener('change', async (e) =>
            await this.handleSettingChange('display.confirmTags', e.target.checked));

        this.elements.autoPrivacySwitch.addEventListener('change', async (e) => {
            const isAutoDetect = e.target.checked;
            await this.handleSettingChange('privacy.autoDetect', isAutoDetect, async () => {
                this.elements.manualPrivacyContainer.classList.toggle('show', !isAutoDetect);
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) {
                    updatePrivacyIconState(tab);
                }
            });
        });

        this.elements.manualPrivacySwitch.addEventListener('change', async (e) => {
            await this.handleSettingChange('privacy.enabled', e.target.checked, async () => {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) {
                    updatePrivacyIconState(tab);
                }
            });
        });

        // 快捷键和设置页面按钮
        this.elements.shortcutsBtn.addEventListener('click', () => {
            chrome.tabs.create({
                url: 'chrome://extensions/shortcuts'
            });
            this.close();
        });

        this.elements.openSettingsPageBtn.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
            this.close();
        });
    }

    async loadSettings() {
        try {
            const settings = await SettingsManager.getAll();
            const {
                display: { 
                    showChromeBookmarks, 
                    autoFocusSearch, 
                    confirmTags 
                } = {},
                privacy: { 
                    autoDetect: autoPrivacyMode, 
                    enabled: manualPrivacyMode 
                } = {}
            } = settings;

            // 初始化开关状态
            this.elements.showChromeBookmarks.checked = showChromeBookmarks;
            this.elements.autoFocusSearch.checked = autoFocusSearch;
            this.elements.confirmTags.checked = confirmTags;
            this.elements.autoPrivacySwitch.checked = autoPrivacyMode;
            this.elements.manualPrivacySwitch.checked = manualPrivacyMode;
            this.elements.manualPrivacyContainer.classList.toggle('show', !autoPrivacyMode);

        } catch (error) {
            logger.error('加载设置失败:', error);
            updateStatus('加载设置失败', true);
        }
    }

    hideSettings() {
        const autoFocusSearchContainer = document.getElementById('auto-focus-search-container');
        if (autoFocusSearchContainer) {
            autoFocusSearchContainer.classList.add('hide');
        }
    }

    async handleSettingChange(settingPath, value, additionalAction = null) {
        try {
            const updateObj = settingPath.split('.').reduceRight(
                (acc, key) => ({ [key]: acc }), 
                value
            );
            await SettingsManager.update(updateObj);
            
            if (additionalAction) {
                await additionalAction();
            }
        } catch (error) {
            logger.error(`更新设置失败 (${settingPath}):`, error);
            updateStatus('设置更新失败', true);
        }
    }

    open() {
        this.dialog.classList.add('show');
    }

    close() {
        this.dialog.classList.remove('show');
    }
}

class AlertDialog {
    constructor() {
        this.dialog = document.getElementById('alert-dialog');
        this.title = this.dialog.querySelector('.alert-title');
        this.message = this.dialog.querySelector('.alert-message');
        this.primaryBtn = document.getElementById('alert-primary-btn');
        this.secondaryBtn = document.getElementById('alert-secondary-btn');
        this.onPrimary = () => {};
        this.onSecondary = () => {};
        this.bindEvents();
    }

    bindEvents() {
        // 在构造函数中绑定事件处理函数
        this.handlePrimaryClick = this.handlePrimaryClick.bind(this);
        this.handleSecondaryClick = this.handleSecondaryClick.bind(this);

        this.primaryBtn.addEventListener('click', this.handlePrimaryClick);
        this.secondaryBtn.addEventListener('click', this.handleSecondaryClick);

        // 点击背景关闭
        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) this.hide();
        }); 
    }

    // 将事件处理逻辑抽离为单独的方法
    handlePrimaryClick() {
        this.onPrimary();
        this.hide();
    }

    handleSecondaryClick() {
        this.onSecondary();
        this.hide();
    }   

    show({
        title = '提示',
        message = '',
        primaryText = '确定',
        secondaryText = '取消',
        showSecondary = true,
        onPrimary = () => {},
        onSecondary = () => {},
    }) {
        this.title.textContent = title;
        this.message.textContent = message;
        this.primaryBtn.textContent = primaryText;
        this.secondaryBtn.textContent = secondaryText;
        this.onPrimary = onPrimary;
        this.onSecondary = onSecondary; 
        
        // 显示/隐藏次要按钮
        this.secondaryBtn.style.display = showSecondary ? 'block' : 'none';
        this.dialog.classList.add('show');
    }

    hide() {
        this.dialog.classList.remove('show');
    }
}

class SyncButtonManager {

    constructor(dialog) {
        this.syncButton = document.getElementById('sync-button');
        this.lastSyncTime = 0;
        this.dialog = dialog;
        this.COOLDOWN_TIME = 5000; // 5秒冷却时间
        this.AUTO_SYNC_INTERVAL = 8 * 60 * 60 * 1000; // 8小时
        this.isSyncing = false; // 添加同步状态标记
    }

    // 添加同步状态管理方法
    setSyncingState(isSyncing) {
        this.isSyncing = isSyncing;
        if (isSyncing) {
            this.syncButton.classList.add('syncing');
        } else {
            this.syncButton.classList.remove('syncing');
        }
    }

    setCoolDownState(isCoolDown) {
        if (isCoolDown) {
            this.syncButton.classList.add('cooldown');
        } else {
            this.syncButton.classList.remove('cooldown');
        }
    }   

    // 添加检查是否需要自动同步的方法
    async checkAutoSync() {
        try {
            // 检查登录状态
            const {valid} = await validateToken();
            logger.debug('检查自动同步状态', {
                valid: valid
            });
            if (!valid) {
                return false;
            }

            // 获取上次同步时间
            const lastSync = await LocalStorageMgr.get('lastAutoSyncTime') || 0;
            const now = Date.now();

            logger.debug('检查自动同步状态', {
                lastSync: lastSync,
                now: now,
            });
            // 如果从未同步过或者距离上次同步超过24小时
            if (!lastSync || (now - lastSync > this.AUTO_SYNC_INTERVAL)) {
                logger.debug('需要自动同步:', {
                    lastSync: new Date(lastSync),
                    now: new Date(now),
                    timeDiff: (now - lastSync) / 1000 / 60 / 60 + '小时'
                });
                return true;
            }

            return false;
        } catch (error) {
            logger.error('检查自动同步状态失败:', error);
            return false;
        }
    }
    
    // 修改现有的handleSync方法，添加自动同步支持
    async handleSync(isAutoSync = false) {
        if (!this.syncButton) return;

        // 如果已经在同步中，直接返回
        if (this.isSyncInProgress()) {
            logger.info('同步正在进行中...');
            return;
        }

        try {
            // 检查登录状态
            const {valid} = await validateToken();
            if (!valid) {
                if (!isAutoSync) {
                    this.dialog.show({
                        title: '未登录',
                        message: '登录后即可使用书签同步功能',
                        primaryText: '去登录',
                        secondaryText: '取消',
                        onPrimary: () => {
                            openOptionsPage('overview');
                        },
                    });
                }
                return;
            }

            // 手动同步时检查冷却时间
            if (!isAutoSync && Date.now() - this.lastSyncTime < this.COOLDOWN_TIME) {
                const remainingTime = Math.ceil((this.COOLDOWN_TIME - (Date.now() - this.lastSyncTime)) / 1000);
                updateStatus(`请等待 ${remainingTime} 秒后再次同步`, true);
                return;
            }
            
            // 开始同步
            this.setSyncingState(true);
            if (!isAutoSync) {
                StatusManager.startOperation('正在同步书签');
            }
            
            // 发送同步消息
            chrome.runtime.sendMessage({
                type: 'FORCE_SYNC_BOOKMARK'
            }, async (response) => {
                if (chrome.runtime.lastError) {
                    logger.error('同步失败:', chrome.runtime.lastError);
                    return;
                }

                logger.debug("handleSync response", response);
                // 更新UI状态
                this.setSyncingState(false);
                if (response.success) {
                    // 更新最后同步时间
                    await LocalStorageMgr.set('lastAutoSyncTime', Date.now());
                    if (!isAutoSync) {
                        StatusManager.endOperation('书签同步完成');
                        this.setCoolDownState(true);
                        this.lastSyncTime = Date.now();
                        setTimeout(() => {
                            this.setCoolDownState(false);
                        }, this.COOLDOWN_TIME);
                    }
                } else {
                    if (!isAutoSync) {
                        StatusManager.endOperation('同步失败: ' + response.error, true);
                    }
                }
            });
        } catch (error) {
            logger.error('同步失败:', error);
            this.setSyncingState(false); 
            if (!isAutoSync) {
                StatusManager.endOperation('同步失败: ' + error.message, true);
            }
        }
    }

    isSyncInProgress() {
        return this.isSyncing;
    }   
}

class SearchHistoryManager {
    constructor() {
        this.MAX_HISTORY = 8;
        this.MAX_CACHE_HISTORY = 10;
        this.STORAGE_KEY = 'recentSearches';
        this.VECTOR_CACHE_KEY = 'searchVectorCache';
    }

    async getHistory() {
        return await LocalStorageMgr.get(this.STORAGE_KEY) || [];
    }

    async addSearch(query) {
        let history = await this.getHistory();
        // 移除重复项
        history = history.filter(item => item.query !== query);
        // 添加到开头
        history.unshift({
            query,
            timestamp: Date.now()
        });
        // 保持最大数量
        history = history.slice(0, this.MAX_HISTORY);
        await LocalStorageMgr.set(this.STORAGE_KEY, history);
    }

    async getVectorCache() {
        return await LocalStorageMgr.get(this.VECTOR_CACHE_KEY) || {};
    }

    async cacheVector(query, vector, serviceId) {
        const cache = await this.getVectorCache();
        cache[query] = {
            vector,
            serviceId,
            timestamp: Date.now()
        };
        
        // 如果缓存项超过10个，删除最旧的
        const entries = Object.entries(cache);
        if (entries.length > this.MAX_CACHE_HISTORY) {
            // 按时间戳排序
            entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
            // 只保留最新的10个
            const newCache = Object.fromEntries(entries.slice(0, this.MAX_CACHE_HISTORY));
            await LocalStorageMgr.set(this.VECTOR_CACHE_KEY, newCache);
        } else {
            await LocalStorageMgr.set(this.VECTOR_CACHE_KEY, cache);
        }
    }

    async getVector(query) {
        const cache = await this.getVectorCache();
        const activeService = await ConfigManager.getActiveService();
        if (cache[query] && cache[query].serviceId === activeService.id) {
            return cache[query].vector;
        }
        return null;
    }

    async clearVectorCache() {
        await LocalStorageMgr.remove(this.VECTOR_CACHE_KEY);
    }
}

const searchHistoryManager = new SearchHistoryManager();
// 在文件开头添加变量来跟踪搜索记录的显示状态
let shouldShowRecentSearches = true;

async function handleSearch() {
    const searchInput = document.getElementById('search-input');
    const query = searchInput.value.trim().toLowerCase();
    
    if (!query) {
        document.getElementById('search-results').innerHTML = '';
        return;
    }

    try {
        StatusManager.startOperation('正在搜索');
        
        // 尝试从缓存获取向量
        let queryEmbedding = await searchHistoryManager.getVector(query);
        logger.debug('从缓存获取向量:', queryEmbedding);
        
        // 如果缓存中没有,则请求新的向量
        if (!queryEmbedding) {
            queryEmbedding = await getEmbedding(query);
            if (queryEmbedding) {
                const activeService = await ConfigManager.getActiveService();
                await searchHistoryManager.cacheVector(query, queryEmbedding, activeService.id);
                logger.debug('向量缓存成功:', {
                    query,
                    vector: queryEmbedding,
                    serviceId: activeService.id
                });
            }
        }

        const results = await searchSavedPages(queryEmbedding);
        displaySearchResults(results);
        
        // 添加到搜索历史
        await searchHistoryManager.addSearch(query);
        await renderSearchHistory();
        
        StatusManager.endOperation('搜索完成');
    } catch (error) {
        logger.error('搜索失败:', error);
        StatusManager.endOperation('搜索失败: ' + error.message, true);
    }
}

async function renderSearchHistory() {
    const container = document.getElementById('recent-searches');
    const wrapper = container.querySelector('.recent-searches-wrapper');
    const history = await searchHistoryManager.getHistory();
    
    // 如果历史记录为空或者用户已关闭搜索记录，则不显示
    if (history.length === 0 || !shouldShowRecentSearches) {
        container.classList.remove('show');
        return;
    }

    // 清空容器
    wrapper.innerHTML = history.map(item => `
        <div class="recent-search-item" data-query="${item.query}" title="${item.query}">
            <svg viewBox="0 0 24 24">
                <path fill="currentColor" d="M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z" />
            </svg>
            <span>${item.query}</span>
        </div>
    `).join('');
    
    container.classList.add('show');
}


// 初始化排序功能
async function initializeSortDropdown() {
    const sortButton = document.getElementById('sort-button');
    const sortDropdown = document.getElementById('sort-dropdown');
    const currentSortText = sortButton.querySelector('.current-sort');
    const sortOptions = sortDropdown.querySelectorAll('.sort-option');

    // 更新按钮图标和文本
    function updateSortButton(selectedOption) {
        const icon = document.createElement('img');
        icon.src = selectedOption.querySelector('img').src;
        icon.className = 'sort-icon';
        const text = selectedOption.textContent.trim();
        
        sortButton.innerHTML = '';
        sortButton.appendChild(icon);
        
        // 添加提示文本
        sortButton.title = `当前排序：${text}`;
        
        // 添加排序指示器
        const indicator = document.createElement('div');
        indicator.className = 'sort-indicator';
        indicator.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="currentColor" d="M7 10l5 5 5-5H7z"/>
            </svg>
        `;
        sortButton.appendChild(indicator);
    }

    // 点击按钮显示/隐藏下拉菜单
    sortButton.addEventListener('click', () => {
        sortDropdown.classList.toggle('show');
    });

    // 点击选项时更新排序
    sortOptions.forEach(option => {
        option.addEventListener('click', async () => {
            const value = option.dataset.value;
            
            // 更新选中状态
            sortOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            
            // 更新按钮显示
            updateSortButton(option);
            
            // 保存设置并刷新列表
            await SettingsManager.update({
                sort: {
                    bookmarks: value
                }
            });
            renderBookmarksList();
            
            // 关闭下拉菜单
            sortDropdown.classList.remove('show');
        });
    });

    // 点击外部关闭下拉菜单
    document.addEventListener('click', (e) => {
        if (!sortButton.contains(e.target) && !sortDropdown.contains(e.target)) {
            sortDropdown.classList.remove('show');
        }
    });

    // 初始化选中状态
    const savedSort = await SettingsManager.get('sort.bookmarks');
    const selectedOption = sortDropdown.querySelector(`[data-value="${savedSort}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
        updateSortButton(selectedOption);
    }
}

async function initializeSearch() {
    const toolbar = document.querySelector('.toolbar');
    const toggleSearch = document.getElementById('toggle-search');
    const closeSearch = document.getElementById('close-search');
    const searchInput = document.getElementById('search-input');
    const recentSearches = document.getElementById('recent-searches');
    const closeRecentSearchesBtn = document.querySelector('.close-recent-searches');

    // 检查是否需要自动聚焦搜索框
    const autoFocusSearch = await SettingsManager.get('display.autoFocusSearch');
    if (autoFocusSearch) {
        openSearching(true); // 初始化时跳过动画
    }

    // 设置搜索相关事件监听器
    toggleSearch?.addEventListener('click', () => openSearching(false));
    closeSearch?.addEventListener('click', closeSearching);
    
    // ESC 键关闭搜索
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && toolbar?.classList.contains('searching')) {
            closeSearching();
        }
    });

    // 搜索输入框回车事件
    searchInput?.addEventListener('keypress', async (event) => {
        if (event.key === 'Enter') {
            await handleSearch();
        }
    });

    // 最近搜索项点击事件
    recentSearches?.addEventListener('click', async (e) => {
        const item = e.target.closest('.recent-search-item');
        if (item) {
            const query = item.dataset.query;
            searchInput.value = query;
            await handleSearch();
        }
    });

    // 关闭最近搜索按钮事件
    closeRecentSearchesBtn?.addEventListener('click', (e) => {
        e.stopPropagation(); // 防止事件冒泡
        shouldShowRecentSearches = false;
        recentSearches.classList.remove('show');
    });
}

// 主初始化函数
async function initializePopup() {
    logger.info(`当前环境: ${ENV.current}, SERVER_URL: ${SERVER_URL}`);
    try {
        // 1. 初始化必需的管理器
        await Promise.all([
            LocalStorageMgr.init(),
            SettingsManager.init(),
            statsManager.init(),
        ]);

        const settingsDialog = new SettingsDialog();
        window.settingsDialog = settingsDialog;

        // 2. 初始化中间数据层
        await Promise.all([
            filterManager.init(),
        ]);

        // 3. 初始化UI状态 (并行执行以提高性能)
        await Promise.all([
            getBookmarkManager(),
            initializeViewModeSwitch(),
            initializeSearch(),
            updateBookmarkCount(),
            initializeSortDropdown(),
            settingsDialog.initialize(),
            renderBookmarksList(),
            updateTabState(),
        ]);

        logger.info('弹出窗口初始化完成');
    } catch (error) {
        logger.error('初始化失败:', error);
        updateStatus('初始化失败: ' + error.message, true);
    }
}

// 初始化设置对话框
document.addEventListener('DOMContentLoaded', async () => {
    initializePopup().catch(error => {
        logger.error('初始化过程中发生错误:', error);
        updateStatus('初始化失败，请刷新页面重试', true);
    });
});