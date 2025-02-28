EnvIdentifier = 'popup';

let quickSaveKey = 'Ctrl+B';
let quickSearchKey = 'Ctrl+K';
async function initShortcutKey() {
    const commands = await chrome.commands.getAll();
    commands.forEach((command) => {
            if (command.name === 'quick-search') {
                quickSearchKey = command.shortcut;
                logger.info('搜索快捷键:', quickSearchKey);
            } else if (command.name === 'quick-save') {
                quickSaveKey = command.shortcut;
                logger.info('保存快捷键:', quickSaveKey);
            }
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
                    type: MessageType.UPDATE_DOMAINS_LIST,
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
        const closeDialog = (e) => {
            e.stopPropagation();
            e.preventDefault();
            dialog.classList.remove('show');
            updateStatus('已取消保存');
            this.resetEditMode();
        };

        // 必需的事件监听器
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                closeDialog(e);
            }
        });

        // 可选功能的事件监听器
        if (dialogContent) {
            dialogContent.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
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
            saveTagsBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
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
            deleteBookmarkBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
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
        const apiKey = await ConfigManager.getActiveAPIKey();
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
            const activeService = await ConfigManager.getActiveService();
            if (!activeService.apiKey) {
                this.elements.required.regenerateEmbeddings.style.display = 'none';
                return;
            }

            const bookmarks = await LocalStorageMgr.getBookmarks();
            const needsUpdate = Object.values(bookmarks).some(bookmark => 
                ConfigManager.isNeedUpdateEmbedding(bookmark, activeService)
            );

            const regenerateButton = this.elements.required.regenerateEmbeddings;
            regenerateButton.style.display = needsUpdate ? 'flex' : 'none';
            
            if (needsUpdate) {
                const count = Object.values(bookmarks).filter(bookmark => 
                    ConfigManager.isNeedUpdateEmbedding(bookmark, activeService)
                ).length;
                regenerateButton.title = `检测到API模型发生改变，需要更新 ${count} 个书签的向量`;
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
        try {
            regenerateButton.classList.add('processing');

            const activeService = await ConfigManager.getActiveService();
            const bookmarks = await LocalStorageMgr.getBookmarks();
            const needUpdateCount = Object.values(bookmarks).filter(bookmark => 
                ConfigManager.isNeedUpdateEmbedding(bookmark, activeService)
            ).length;
            let updatedCount = 0;
            
            const BATCH_SIZE = 10; // 每批处理的书签数量
            let batchBookmarks = [];
            
            for (const [key, bookmark] of Object.entries(bookmarks)) {
                if (ConfigManager.isNeedUpdateEmbedding(bookmark, activeService)) {
                    StatusManager.startOperation(`正在更新 ${++updatedCount}/${needUpdateCount} 个书签...`);
                    
                    const text = makeEmbeddingText({
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
                        apiService: activeService.id,
                        embedModel: activeService.embedModel
                    };
                    
                    // 将更新后的书签添加到批次中
                    batchBookmarks.push(updatedBookmark);
                    
                    // 当达到批次大小或是最后一个书签时,执行批量更新
                    if (batchBookmarks.length >= BATCH_SIZE || updatedCount === needUpdateCount) {
                        // 批量更新storage
                        LocalStorageMgr.setBookmarks(batchBookmarks);
                        // 批量记录变更
                        const isLast = updatedCount === needUpdateCount;
                        recordBookmarkChange(batchBookmarks, false, isLast, onSyncError);
                        // 清空当前批次
                        batchBookmarks = [];
                    }
                }
            }

            StatusManager.endOperation(`成功更新 ${updatedCount} 个书签的向量`);
            regenerateButton.style.display = 'none';
        } catch (error) {
            logger.error('重新生成embedding时出错:', error);
            StatusManager.endOperation('更新向量失败', true);
        } finally {
            regenerateButton.classList.remove('processing');
        }
    }

    setupStorageListener() {
        chrome.storage.onChanged.addListener(async (changes, areaName) => {
            if (areaName === 'sync') {  // 确保是监听sync storage
                // 监听API Keys的变化
                if (changes[ConfigManager.STORAGE_KEYS.ACTIVE_SERVICE]) {
                    logger.debug('API Keys发生变化:', changes[ConfigManager.STORAGE_KEYS.API_KEYS], changes[ConfigManager.STORAGE_KEYS.ACTIVE_SERVICE]);
                    this.checkApiKeyConfig(false);
                    this.checkEmbeddingStatus();
                }
                if (changes[ConfigManager.STORAGE_KEYS.API_KEYS]) {
                    this.checkApiKeyConfig(false);
                }
                if (changes[ConfigManager.STORAGE_KEYS.CUSTOM_SERVICES]) {
                    this.checkApiKeyConfig(false);
                    this.checkEmbeddingStatus();
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
            await recordBookmarkChange(bookmark, true, true, onSyncError);
            updateStatus('已取消收藏');
            await Promise.all([
                renderBookmarksList(),
                updateBookmarkCount(),
                updateTabState(),
            ]);
        }
    }

    async processAndShowTags(tab) {
        if (tab.status !== 'complete') {
            if (tab.title && tab.url) {
                this.pageContent = {};
                logger.debug('页面正在加载中，不访问页面内容', tab);
            } else {
                updateStatus('页面正在加载中，请等待加载完成后再试', true);
                return;
            }
        } else {
            this.pageContent = await getPageContent(tab);
            logger.debug('获取页面内容:', this.pageContent);
        }

        // 检查是否有缓存的标签
        if (this.tagCache.url === tab.url && this.tagCache.tags.length > 0) {
            logger.debug('使用缓存的标签:', this.tagCache.tags);
            this.generatedTags = this.tagCache.tags;
        } else {
            // 没有缓存或URL不匹配，重新生成标签
            StatusManager.startOperation('正在生成标签');
            this.generatedTags = await generateTags(this.pageContent, tab);
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
            const embedding = this.isEditMode ? this.editingBookmark.embedding : await getEmbedding(makeEmbeddingText(this.pageContent, this.currentTab, tags));
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
                embedModel: this.isEditMode ? this.editingBookmark.embedModel : apiService.embedModel,
            };

            // 打印书签编辑信息
            logger.debug('书签编辑信息:', {
                isEditMode: this.isEditMode,
                before: this.isEditMode ? this.editingBookmark : null,
                after: pageInfo
            });
            
            await LocalStorageMgr.setBookmark(this.currentTab.url, pageInfo);
            await recordBookmarkChange(pageInfo, false, true, onSyncError);

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

function displaySearchResults(results, query) {
    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = '';

    // 如果没有搜索结果，显示空状态
    if (results.length === 0) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" width="48" height="48">
                        <path fill="currentColor" d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z" />
                    </svg>
                </div>
                <div class="empty-message">
                    <div class="empty-title">未找到相关书签</div>
                    <div class="empty-detail">没有找到与"${query}"相关的书签</div>
                    <div class="empty-suggestion">建议尝试其他关键词</div>
                </div>
            </div>
        `;
        return;
    }

    // 将结果处理包装在异步函数中
    const createResultElement = async (result) => {
        const li = document.createElement('li');
        li.className = 'result-item';
        
        // 添加高相关度样式
        if (result.score >= 85) {
            li.classList.add('high-relevance');
        }

        // 高亮显示匹配的文本
        const highlightText = (text) => {
            if (!text || !query) return text;
            const regex = new RegExp(`(${query})`, 'gi');
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

        // 修改相关度显示
        const getRelevanceIndicator = (score, similarity) => {
            if (similarity < 0.01) {
                return '';
            }
            let bars;
            let text = '';
            if (score >= 85) {
                // 高相关：三根绿条
                bars = `
                    <div class="relevance-bar high"></div>
                    <div class="relevance-bar high"></div>
                    <div class="relevance-bar high"></div>
                `;
                text = '相关度高';
            } else if (score >= 65) {
                // 中等相关
                bars = `
                    <div class="relevance-bar medium"></div>
                    ${score >= 75 ? '<div class="relevance-bar medium"></div>' : '<div class="relevance-bar low"></div>'}
                    <div class="relevance-bar low"></div>
                `;
                text = '相关度中';
            } else {
                // 低相关：三根灰条
                bars = `
                    <div class="relevance-bar low"></div>
                    <div class="relevance-bar low"></div>
                    <div class="relevance-bar low"></div>
                `;
                text = '相关度低';
            }
            return `<div class="result-score"><span class="relevance-text">${text}</span>${bars}</div>`;
        };

        li.innerHTML = `
            <a href="${result.url}" class="result-link" target="_blank">
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
                ${getRelevanceIndicator(result.score, result.similarity)}
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
            }
        });

        // 删除按钮事件处理保持不变
        li.querySelector('.delete-btn').onclick = async (e) => {
            e.stopPropagation();
            e.preventDefault();
            await deleteBookmark(result);
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
                await recordBookmarkChange(bookmark, true, true, onSyncError);
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
                const query = searchInput.value.trim().toLowerCase();
                const includeChromeBookmarks = await SettingsManager.get('display.showChromeBookmarks');
                const results = await searchManager.search(query, {
                    debounce: false,
                    includeUrl: true,
                    includeChromeBookmarks: includeChromeBookmarks
                });
                displaySearchResults(results, query);
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

function onSyncError(errorMessage) {
    updateStatus('同步失败: ' + errorMessage, true);
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    logger.debug("popup 收到消息", {
        message: message,
        sender: sender,
    });

    if (message.type === MessageType.UPDATE_TAB_STATE) {
        const [tab] = await chrome.tabs.query({ 
            active: true, 
            currentWindow: true 
        });
        if (tab) {
            const isSaved = await checkIfPageSaved(tab.url);
            updateSaveButtonState(isSaved);
            await updatePrivacyIconState(tab);
        }
    } else if (message.type === MessageType.TOGGLE_SEARCH) {
        toggleSearching();
    } else if (message.type === MessageType.BOOKMARKS_UPDATED) {
        await renderBookmarksList();    // 确保更新书签列表
        await Promise.all([
            updateBookmarkCount(),    // 更新计数
            updateTabState(),    // 更新保存按钮状态
        ]);
        const bookmarkMgr = await getBookmarkManager();
        await bookmarkMgr.checkEmbeddingStatus();
    } else if (message.type === MessageType.START_SYNC) {
        const bookmarkMgr = await getBookmarkManager();
        bookmarkMgr.setSyncingState(true);
    } else if (message.type === MessageType.FINISH_SYNC) {
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
        renderSearchHistory();
    } else {
        toolbar.classList.add('searching');
        setTimeout(() => {
            searchInput.focus();
        }, 300);
    }
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
    const recentSearches = document.getElementById('recent-searches');
    if (recentSearches) {
        recentSearches.classList.remove('show');
    }
}

// 更新保存按钮状态的函数
function updateSaveButtonState(isSaved) {
    const saveButton = document.getElementById('save-page');
    if (!saveButton) return;
    
    if (isSaved) {
        saveButton.classList.add('editing');
        saveButton.title = `编辑书签 ${quickSaveKey}`;
    } else {
        saveButton.classList.remove('editing');
        saveButton.title = `为此页面添加书签 ${quickSaveKey}`;
    }
}

// 更新收藏数量显示
async function updateBookmarkCount() {
    try {
        const allBookmarks = await getDisplayedBookmarks();
        const count = Object.keys(allBookmarks).length;
        const bookmarkCount = document.getElementById('bookmark-count');
        bookmarkCount.setAttribute('data-count', count);
        bookmarkCount.textContent = '书签';
    } catch (error) {
        logger.error('获取收藏数量失败:', error);
    }
}

// 保存当前渲染器实例的引用
let currentRenderer = null;

// 修改渲染书签列表函数
async function renderBookmarksList() {
    logger.debug('renderBookmarksList 开始', Date.now()/1000);
    const bookmarksList = document.getElementById('bookmarks-list');
    if (!bookmarksList) return;

    try {
        if (currentRenderer) {
            currentRenderer.cleanup();
            currentRenderer = null;
        }

        // 显示加载状态
        bookmarksList.innerHTML = `
            <li class="loading-state">
                <div class="loading-spinner"></div>
                <div class="loading-text">正在加载书签...</div>
            </li>`;

        const settings = await SettingsManager.getAll();
        const viewMode = settings.display.viewMode;
        const sortBy = settings.sort.bookmarks;

        const data = viewMode === 'group'
            ? Object.values(await getDisplayedBookmarks())
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
                        <div class="empty-icon">
                            <svg viewBox="0 0 24 24" width="48" height="48">
                                <path fill="currentColor" d="M17,3H7A2,2 0 0,0 5,5V21L12,18L19,21V5A2,2 0 0,0 17,3M12,7A2,2 0 0,1 14,9A2,2 0 0,1 12,11A2,2 0 0,1 10,9A2,2 0 0,1 12,7Z" />
                            </svg>
                        </div>
                        <div class="empty-title">还没有保存任何书签</div>
                        <div class="empty-actions">
                            <div class="action-item">
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                    <path fill="currentColor" d="M17,3H7A2,2 0 0,0 5,5V21L12,18L19,21V5A2,2 0 0,0 17,3M12,7A2,2 0 0,1 14,9A2,2 0 0,1 12,11A2,2 0 0,1 10,9A2,2 0 0,1 12,7Z" />
                                </svg>
                                点击左上角的书签图标开始收藏
                            </div>
                            <div class="action-item import-action">
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                    <path fill="currentColor" d="M14,12L10,8V11H2V13H10V16M20,18V6C20,4.89 19.1,4 18,4H6A2,2 0 0,0 4,6V9H6V6H18V18H6V15H4V18A2,2 0 0,0 6,20H18A2,2 0 0,0 20,18Z" />
                                </svg>
                                <a href="#" class="import-link">导入浏览器书签</a>
                            </div>
                        </div>
                    </div>
                </li>`;

            // 为导入链接添加点击事件
            const importLink = bookmarksList.querySelector('.import-link');
            if (importLink) {
                importLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    openOptionsPage('import-export');
                });
            }
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
        logger.debug('renderBookmarksList 完成', Date.now()/1000);
    } catch (error) {
        logger.error('渲染书签列表失败:', error);
        // 显示错误状态
        bookmarksList.innerHTML = `
            <li class="error-state">
                <div class="error-message">
                    加载书签失败
                    <br>
                    ${error.message}
                </div>
            </li>`;
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
            <a href="${bookmark.url}" class="bookmark-link" target="_blank">
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
            e.preventDefault();
            await deleteBookmark(bookmark);
        });

        // 添加编辑按钮事件处理
        const editBtn = li.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
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
            openSettingsPageBtn: document.getElementById('open-settings-page'),
            feedbackBtn: document.getElementById('feedback-button'),
            storeReviewButton: document.getElementById('store-review-button')
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
                await renderBookmarksList();
                await updateBookmarkCount();
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

        // 添加反馈按钮点击事件
        this.elements.feedbackBtn.addEventListener('click', () => {
            chrome.tabs.create({
                url: `${SERVER_URL}/feedback`
            });
            this.close();
        });
        
        // 添加商店评价按钮点击事件
        this.elements.storeReviewButton.addEventListener('click', () => {
            // 获取扩展ID并打开Chrome商店评价页面
            const extensionId = chrome.runtime.id;
            const storeUrl = `https://chrome.google.com/webstore/detail/${extensionId}`;
            chrome.tabs.create({ url: storeUrl });
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
            sendMessageSafely({
                type: MessageType.FORCE_SYNC_BOOKMARK
            }, async (response) => {
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

async function handleSearch() {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const query = searchInput.value.trim().toLowerCase();
    
    if (!query) {
        searchResults.innerHTML = '';
        return;
    }

    try {
        // 显示加载状态
        searchResults.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <div class="loading-text">正在搜索...</div>
            </div>
        `;
        
        const includeChromeBookmarks = await SettingsManager.get('display.showChromeBookmarks');
        const results = await searchManager.search(query, {
            debounce: false,
            includeUrl: true,
            includeChromeBookmarks: includeChromeBookmarks
        });
        displaySearchResults(results, query);
    } catch (error) {
        logger.error('搜索失败:', error);
        StatusManager.endOperation('搜索失败: ' + error.message, true);
    }
}

async function renderSearchHistory(query) {
    const container = document.getElementById('recent-searches');
    const showHistory = await SettingsManager.get('search.showSearchHistory');
    if (!showHistory) {
        container.classList.remove('show');
        return;
    }
    
    const wrapper = container.querySelector('.recent-searches-wrapper');
    let history = await searchManager.searchHistoryManager.getHistory();

    // 如果有搜索内容，则过滤历史记录与搜索内容不匹配的
    if (query) {
        history = history.filter(item => item.query.includes(query));
    }
    
    // 如果历史记录为空，则不显示
    if (history.length === 0) {
        container.classList.remove('show');
        return;
    }

    // 如果历史记录超过最大显示数量，则截断
    if (history.length > searchManager.searchHistoryManager.MAX_HISTORY_SHOW) {
        history = history.slice(0, searchManager.searchHistoryManager.MAX_HISTORY_SHOW);
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

    // 检查是否需要自动聚焦搜索框
    const autoFocusSearch = await SettingsManager.get('display.autoFocusSearch');
    if (autoFocusSearch) {
        openSearching(true); // 初始化时跳过动画
    }

    // 设置搜索相关事件监听器
    toggleSearch?.addEventListener('click', () => openSearching(false));
    closeSearch?.addEventListener('click', closeSearching);

    toggleSearch.title = `搜索书签 ${quickSearchKey}`;
    searchInput.placeholder = `搜索书签 ${quickSearchKey}`;
    
    let isMouseInSearchHistory = false;
    
    // 搜索框焦点事件
    searchInput?.addEventListener('focus', async () => {
        await renderSearchHistory();
    });

    // 跟踪鼠标是否在搜索历史区域内
    recentSearches?.addEventListener('mouseenter', () => {
        isMouseInSearchHistory = true;
    });

    recentSearches?.addEventListener('mouseleave', () => {
        isMouseInSearchHistory = false;
    });

    // 搜索框失去焦点事件
    searchInput?.addEventListener('blur', () => {
        logger.debug('搜索框失去焦点', {
            isMouseInSearchHistory: isMouseInSearchHistory
        });
        // 只有当鼠标不在搜索历史区域内时才隐藏
        if (!isMouseInSearchHistory) {
            recentSearches.classList.remove('show');
        }
    });

    // 添加输入框内容变化事件
    searchInput?.addEventListener('input', () => {
        logger.debug('搜索框内容变化', searchInput.value);
        const query = searchInput.value.trim().toLowerCase();
        renderSearchHistory(query);
    });

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
            recentSearches.classList.remove('show');
        }
    });

    // 最近搜索项点击事件
    recentSearches?.addEventListener('click', async (e) => {
        const item = e.target.closest('.recent-search-item');
        if (item) {
            const query = item.dataset.query;
            searchInput.value = query;
            recentSearches.classList.remove('show');
            await handleSearch();
        }
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
    await initShortcutKey();
    initializePopup().catch(error => {
        logger.error('初始化过程中发生错误:', error);
        updateStatus('初始化失败，请刷新页面重试', true);
    });
});