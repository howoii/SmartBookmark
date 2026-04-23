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
                await updateSettingsWithSync({
                    privacy: {
                        customDomains: newDomains
                    }
                });
                
                // 更新图标状态
                await updatePrivacyIconState(tab);
                updateStatus(i18n.getMessage('popup_privacy_domain_added', [domain]), false);

                // 更新域名列表
                sendMessageSafely({
                    type: MessageType.UPDATE_DOMAINS_LIST,
                    data: newDomains
                });
            }
        } catch (error) {
            logger.error('添加隐私域名失败:', error);
            updateStatus(i18n.getMessage('popup_privacy_domain_add_error'), true);
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
        const privacyTitleKey = autoPrivacyMode ? 
            'popup_privacy_mode_auto' : 
            'popup_privacy_mode_active';
        privacyIcon.title = i18n.getMessage(privacyTitleKey);
    } else {
        privacyIcon.classList.remove('active');
        toolbar.classList.remove('privacy-mode');
        privacyIcon.title = i18n.getMessage('popup_privacy_domain_mark');
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
function getBookmarkManager() {
    if (!window.bookmarkManagerInstance) {
        const bookmarkManagerInstance = new BookmarkManager();
        window.bookmarkManagerInstance = bookmarkManagerInstance;
    }
    return window.bookmarkManagerInstance;
}

/**
 * 同步状态弹窗类
 * 负责显示和管理同步状态弹窗
 */
class SyncStatusDialog {
    constructor() {
        this.dialog = document.getElementById('sync-status-dialog');
        this.servicesContainer = this.dialog.querySelector('.sync-services-container');
        this.closeButton = this.dialog.querySelector('.close-dialog-btn');
        this.syncServiceTemplate = document.getElementById('sync-service-template');
        
        this.listenOnSyncProcessChange = null;
        this.refreshSyncStatus = this.refreshSyncStatus.bind(this);
        
        // 绑定事件处理函数到当前实例
        this.bindEvents();
    }
    
    /**
     * 绑定事件
     */
    bindEvents() {
        // 关闭按钮事件
        this.closeButton.addEventListener('click', () => this.close());
        
        // 点击空白区域关闭弹窗
        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) {
                this.close();
            }
        });
    }
    
    /**
     * 打开弹窗并刷新同步状态
     */
    async open() {
        this.dialog.classList.add('show');
        await this.refreshSyncStatus();
    }
    
    /**
     * 关闭弹窗
     */
    close() {
        this.dialog.classList.remove('show');
        this.listenOnSyncProcessChange = null;
    }

    isOpen() {
        return this.dialog.classList.contains('show');
    }

    onSyncProcessChange() {
        if (!this.isOpen()) {
            return;
        }

        if (this.listenOnSyncProcessChange) {
            this.listenOnSyncProcessChange();
        }
    }
    
    /**
     * 刷新同步状态
     */
    async refreshSyncStatus() {
        if (!this.isOpen()) {
            return;
        }

        try {
            // 清空服务容器
            this.servicesContainer.innerHTML = '';
            this.listenOnSyncProcessChange = null;

            // 添加loading图标
            const loadingElement = document.createElement('div');
            loadingElement.className = 'loading-state';
            loadingElement.innerHTML = `
                <div class="loading-spinner"></div>
                <div class="loading-text" data-i18n="popup_sync_status_loading"></div>
            `;
            i18n.updateNodeText(loadingElement);
            this.servicesContainer.appendChild(loadingElement);
            
            // 获取同步配置
            const config = await SyncSettingsManager.getConfig();
            const status = await SyncStatusManager.getStatus();
            const isSyncing = await SyncStatusManager.isSyncing();
            const syncProcess = await SyncStatusManager.getSyncProcess();
            
            // 检查是否有开启的同步服务
            const enabledServices = [];

            // 检查云同步是否开启
            if (FEATURE_FLAGS.ENABLE_CLOUD_SYNC && config.cloud && config.cloud.autoSync) {
                const {valid} = await validateToken();
                if (valid) {
                    enabledServices.push({
                        id: 'cloud',
                        name: i18n.getMessage('popup_sync_service_cloud'),
                        status: status.cloud || {},
                        isSyncing: isSyncing && syncProcess.service === 'cloud'
                    });
                }
            }
            
            // 检查WebDAV同步是否开启
            if (config.webdav && config.webdav.syncStrategy.autoSync) {
                const valid = SyncSettingsManager.validateWebDAVConfig(config.webdav)
                if (valid) {
                    enabledServices.push({
                        id: 'webdav',
                        name: i18n.getMessage('popup_sync_service_webdav'),
                        status: status.webdav || {},
                        isSyncing: isSyncing && syncProcess.service === 'webdav'
                    });
                }
            }

            // 移除加载状态
            this.servicesContainer.innerHTML = '';
            
            // 如果没有开启的同步服务，显示提示信息
            if (enabledServices.length === 0) {
                this.servicesContainer.innerHTML = `
                    <div class="no-services-message">
                        <p data-i18n="popup_sync_no_services"></p>
                        <a href="#" id="go-to-sync-settings" class="primary-button">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                                <path fill="currentColor" d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
                            </svg>
                            <span data-i18n="popup_sync_configure_button"></span>
                        </a>
                    </div>
                `;
                i18n.updateNodeText(this.servicesContainer);

                const goToSyncSettingsBtn = document.getElementById('go-to-sync-settings');
                // 绑定事件
                if (goToSyncSettingsBtn) {
                    goToSyncSettingsBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.close();
                        openOptionsPage('sync');
                    });
                }
                return;
            }
            
            // 渲染每个开启的同步服务
            for (const service of enabledServices) {
                const serviceElement = this.createServiceElement(service);
                this.servicesContainer.appendChild(serviceElement);
            }

            if (isSyncing) {
                this.listenOnSyncProcessChange = this.refreshSyncStatus;
            }
        } catch (error) {
            logger.error('刷新同步状态失败:', error);
            updateStatus(i18n.getMessage('popup_sync_status_fetch_error'), true);
            this.close();
        }
    }
    
    /**
     * 创建同步服务元素
     * @param {Object} service - 同步服务对象
     * @returns {HTMLElement} 服务元素
     */
    createServiceElement(service) {
        // 克隆模板
        const template = this.syncServiceTemplate.content.cloneNode(true);
        const serviceItem = template.querySelector('.sync-service-item');
        
        // 设置服务名称
        const nameElement = serviceItem.querySelector('.sync-service-name');
        nameElement.textContent = service.name;
        
        // 设置服务状态
        const statusElement = serviceItem.querySelector('.sync-service-status');
        let statusKey;
        if (service.isSyncing) {
            statusKey = 'popup_status_syncing';
            statusElement.classList.add('syncing');
        } else if (service.status.lastSyncResult && service.status.lastSyncResult !== 'success') {
            statusKey = 'popup_status_sync_failed';
            statusElement.classList.add('error');
        } else if (service.status.lastSync) {
            statusKey = 'popup_status_synced';
            statusElement.classList.add('success');
        } else {
            statusKey = 'popup_status_not_synced';
        }
        statusElement.setAttribute('data-i18n', statusKey);
        
        // 设置上次同步时间
        const timeContainer = serviceItem.querySelector('.sync-time-container');
        const timeElement = serviceItem.querySelector('.sync-time');
        
        // 设置同步结果
        const resultContainer = serviceItem.querySelector('.sync-result-container');
        const resultElement = serviceItem.querySelector('.sync-result');
        
        const isError = service.status.lastSyncResult && service.status.lastSyncResult !== 'success';
        const hasSuccessfulSync = service.status.lastSync && !isError;
        
        // 根据同步状态决定显示内容
        if (hasSuccessfulSync) {
            // 成功同步 - 显示时间，隐藏结果
            timeContainer.classList.add('success-text');
            const date = new Date(service.status.lastSync);
            // 移除data-i18n属性，因为我们要显示动态时间
            timeElement.removeAttribute('data-i18n');
            timeElement.textContent = date.toLocaleString();
            timeContainer.style.display = 'flex';
            resultContainer.style.display = 'none';
        } else if (isError) {
            // 同步失败 - 显示错误信息，隐藏时间
            resultElement.textContent = service.status.lastSyncResult;
            resultElement.classList.add('error-text');
            timeContainer.style.display = 'none';
            resultContainer.style.display = 'flex';
        } else {
            // 未同步过 - 显示默认提示
            timeElement.setAttribute('data-i18n', 'popup_sync_never');
            timeContainer.style.display = 'flex';
            resultContainer.style.display = 'none';
        }
        
        // 设置设置按钮
        const settingsButton = serviceItem.querySelector('.sync-settings-button');
        settingsButton.addEventListener('click', () => {
            // 跳转到同步设置页面
            openOptionsPage('sync');
        });
        
        // 设置立即同步按钮
        const syncButton = serviceItem.querySelector('.sync-now-button');
        const buttonText = syncButton.querySelector('span');
        if (service.isSyncing) {
            syncButton.classList.add('syncing');
            buttonText.setAttribute('data-i18n', 'popup_sync_syncing');
        } else {
            // 确保按钮文本使用国际化
            buttonText.setAttribute('data-i18n', 'popup_sync_button_text');
        }
        
        // 更新模板中的所有国际化文本（必须在设置动态内容之后调用）
        i18n.updateNodeText(serviceItem);
        
        // 添加同步按钮事件
        syncButton.addEventListener('click', async () => {
            if (service.isSyncing) return; // 如果正在同步中，不执行操作
            
            syncButton.classList.add('syncing');
            buttonText.setAttribute('data-i18n', 'popup_sync_syncing');
            buttonText.textContent = i18n.getMessage('popup_sync_syncing');
            
            try {
                // 根据服务类型执行不同的同步操作
                let result;
                if (service.id === 'webdav') {
                    // 执行WebDAV同步
                    result = await this.executeWebDAVSync();
                } else if (service.id === 'cloud') {
                    // 执行云同步
                    result = await this.executeCloudSync();
                }
                logger.debug('同步结果:', result);
                
                // 显示同步结果
                if (result && result.success) {
                    updateStatus(i18n.getMessage('popup_sync_success'), false);
                } else {
                    const errorMsg = result?.error || i18n.getMessage('popup_sync_error_unknown');
                    updateStatus(i18n.getMessage('popup_sync_failed_with_error', [errorMsg]), true);
                }
            } catch (error) {
                logger.error(`${service.name}同步失败:`, error);
                updateStatus(i18n.getMessage('popup_sync_failed_with_error', [error.message]), true);
            } finally { 
                await this.refreshSyncStatus(); 
            }
        });
        
        return serviceItem;
    }
    
    /**
     * 执行WebDAV同步
     * @returns {Promise<Object>} 同步结果
     */
    async executeWebDAVSync() {
        try {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: MessageType.EXECUTE_WEBDAV_SYNC
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    
                    resolve(response);
                });
            });
        } catch (error) {
            logger.error('执行WebDAV同步失败:', error);
            throw error;
        }
    }
    
    /**
     * 执行云同步
     * @returns {Promise<Object>} 同步结果
     */
    async executeCloudSync() {
        if (!FEATURE_FLAGS.ENABLE_CLOUD_SYNC) {
            throw new Error(i18n.getMessage('popup_sync_cloud_disabled'));
        }
        try {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: MessageType.EXECUTE_CLOUD_SYNC
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    
                    resolve(response);
                });
            });
        } catch (error) {
            logger.error('执行云同步失败:', error);
            throw error;
        }
    }
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
        this.tagRequest = null;
        this.excerptRequest = null;
        this.translateRequest = null;
        this.originalTitle = null; // 保存原始标题
        this.hasTranslated = false; // 标记是否已翻译
        this.browserBookmarkSavePreference = BrowserBookmarkSelector.normalizePreference({}, { directoryOnly: true });
        this.browserBookmarkSelector = null;
        this.browserBookmarkSelectorRefreshTimer = null;
        // 将 DOM 元素分为必需和可选两类
        this.elements = {
            required: {                
                saveButton: document.getElementById('save-page'),
                dialog: document.getElementById('tags-dialog'),
                tagsList: document.getElementById('tags-list'),
                apiKeyNotice: document.getElementById('api-key-notice'),
                syncButton: document.getElementById('sync-button'),
                regeneratingStatus: document.getElementById('regenerating-embeddings-status'),
                privacyIcon: document.getElementById('privacy-mode')
            },
            optional: {
                newTagInput: document.getElementById('new-tag-input'),
                saveTagsBtn: document.getElementById('save-tags-btn'),
                cancelTagsBtn: document.getElementById('cancel-tags-btn'),
                deleteBookmarkBtn: document.getElementById('delete-bookmark-btn'),
                dialogContent: document.querySelector('#tags-dialog .dialog-content'),
                generateTagsBtn: document.getElementById('generate-tags-btn'),
                pageExcerpt: document.getElementById('page-excerpt'),
                dialogTitle: document.querySelector('.page-title'),
                pageUrl: document.querySelector('.page-url'),
                translateTitleBtn: document.getElementById('translate-title-btn'),
                browserBookmarkSelector: document.getElementById('browser-bookmark-selector'),
                folderInputDialog: document.getElementById('folder-input-dialog'),
                folderInputTitle: document.getElementById('folder-input-dialog-title'),
                folderInputField: document.getElementById('folder-input-field'),
                folderInputConfirmBtn: document.getElementById('folder-input-confirm-btn'),
                folderInputCancelBtn: document.getElementById('folder-input-cancel-btn'),
                folderMoveSelectorRoot: document.getElementById('folder-move-selector-root'),
                batchMoveSelectorRoot: document.getElementById('batch-move-selector-root')
            }
        };

        // 检查必需元素
        const missingRequired = Object.entries(this.elements.required)
        .filter(([key, element]) => !element)
        .map(([key]) => key);

        if (missingRequired.length > 0) {
            throw new Error(`缺少必需的DOM元素: ${missingRequired.join(', ')}`);
        }
        
        this.alertDialog = new AlertDialog();
        this.syncStatusDialog = new SyncStatusDialog();
        this.browserBookmarkSelector = new BrowserBookmarkSelector({
            root: this.elements.optional.browserBookmarkSelector,
            directoryOnly: true,
            preferredVerticalPlacement: 'above',
            recommendationProvider: () => this.getRecommendedFolders()
        });
        this.folderInputDialog = new FolderInputDialog({
            dialog: this.elements.optional.folderInputDialog,
            title: this.elements.optional.folderInputTitle,
            input: this.elements.optional.folderInputField,
            confirm: this.elements.optional.folderInputConfirmBtn,
            cancel: this.elements.optional.folderInputCancelBtn
        });
        if (this.elements.optional.folderMoveSelectorRoot) {
            this.elements.optional.folderMoveSelectorRoot.hidden = false;
        }
        this.folderMoveSelector = new BrowserBookmarkSelector({
            root: this.elements.optional.folderMoveSelectorRoot,
            directoryOnly: false,
            preferredVerticalPlacement: 'auto',
            onChange: async (value) => {
                await this.directoryFolderActionsController?.handleMoveSelectorChange(value);
            }
        });
        this.directoryFolderActionsController = new DirectoryFolderActionsController({
            selector: this.folderMoveSelector,
            folderDialog: this.folderInputDialog,
            alertDialog: this.alertDialog,
            onRefresh: async () => this.refreshBookmarksList()
        });

        this.batchMoveSelector = this.createBatchMoveSelector(
            this.elements.optional.batchMoveSelectorRoot
        );

        this.showDialog = this.showDialog.bind(this);
        this.refreshBookmarksList = this.refreshBookmarksList.bind(this);
        this.initBookmarkListEditMode();
        this.initSearchListEditMode();
        this.bindEvents();
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            this.isInitialized = true;
            // 绑定核心事件处理器
            await Promise.all([
                this.updateRegeneratingStatus(),
                this.checkApiKeyConfig(true),
                this.updateSyncButtonState(),
                this.loadBrowserBookmarkSavePreference()
            ]);
                        
            logger.info('BookmarkManager 初始化成功');
        } catch (error) {
            logger.error('初始化失败:', error);
            throw error; // 重新抛出错误，让调用者知道初始化失败
        }
    }

    async loadBrowserBookmarkSavePreference() {
        const savedPreference = await SettingsManager.get('display.browserBookmarkSave');
        const preference = await BrowserBookmarkSelector.resolvePreferenceInCurrentBrowser(savedPreference || {}, {
            directoryOnly: true
        });

        this.browserBookmarkSavePreference = preference;
        this.browserBookmarkSelector.setValue(this.browserBookmarkSavePreference);
    }

    isTagsDialogOpen() {
        return Boolean(this.elements.required.dialog?.classList.contains('show'));
    }

    areBrowserBookmarkPreferencesEqual(left, right) {
        const normalizedLeft = BrowserBookmarkSelector.normalizePreference(left || {}, {
            directoryOnly: true
        });
        const normalizedRight = BrowserBookmarkSelector.normalizePreference(right || {}, {
            directoryOnly: true
        });
        return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
    }

    async syncStoredBrowserBookmarkPreference(options = {}) {
        const { syncVisibleSelector = false } = options;
        const previousPreference = this.browserBookmarkSavePreference;
        const savedPreference = await SettingsManager.get('display.browserBookmarkSave');
        const nextPreference = await BrowserBookmarkSelector.resolvePreferenceInCurrentBrowser(savedPreference || {}, {
            directoryOnly: true
        });
        this.browserBookmarkSavePreference = nextPreference;

        if (!syncVisibleSelector || !this.browserBookmarkSelector || !this.isTagsDialogOpen()) {
            return;
        }

        if (this.isEditMode && this.editingBookmark?.chromeId) {
            return;
        }

        const currentValue = this.browserBookmarkSelector.getValue();
        if (this.areBrowserBookmarkPreferencesEqual(currentValue, previousPreference)) {
            this.browserBookmarkSelector.setValue(nextPreference);
        }
    }

    async refreshVisibleBrowserBookmarkSelector() {
        if (!this.browserBookmarkSelector || !this.isTagsDialogOpen()) {
            return;
        }

        if (this.isEditMode && this.editingBookmark?.chromeId) {
            await this.syncBrowserBookmarkSelectorState();
            return;
        }

        const currentValue = this.browserBookmarkSelector.getValue();
        const matchesSavedPreference = this.areBrowserBookmarkPreferencesEqual(
            currentValue,
            this.browserBookmarkSavePreference
        );
        const resolvedValue = await BrowserBookmarkSelector.resolvePreferenceInCurrentBrowser(currentValue, {
            directoryOnly: true
        });
        this.browserBookmarkSelector.setValue(resolvedValue);

        if (matchesSavedPreference) {
            this.browserBookmarkSavePreference = BrowserBookmarkSelector.normalizePreference(resolvedValue, {
                directoryOnly: true
            });
        }
    }

    async refreshBrowserBookmarkSelectorFromExternalChange() {
        if (this.isTagsDialogOpen()) {
            await this.refreshVisibleBrowserBookmarkSelector();
            return;
        }

        await this.syncStoredBrowserBookmarkPreference();
    }

    async prepareBrowserBookmarkSelectorForDialog() {
        await this.syncStoredBrowserBookmarkPreference();
        await this.syncBrowserBookmarkSelectorState();
    }

    scheduleBrowserBookmarkSelectorRefresh() {
        if (this.browserBookmarkSelectorRefreshTimer) {
            clearTimeout(this.browserBookmarkSelectorRefreshTimer);
        }

        this.browserBookmarkSelectorRefreshTimer = setTimeout(() => {
            this.browserBookmarkSelectorRefreshTimer = null;
            void this.refreshBrowserBookmarkSelectorFromExternalChange();
        }, 50);
    }

    async resolveChromeBookmarkTarget(chromeId) {
       if (!chromeId) return null;

        const [node] = await chrome.bookmarks.get(chromeId);
        if (!node) return null;
        return BrowserBookmarkSelector.buildTargetFromBookmarkNode(node);
    }

    async syncBrowserBookmarkSelectorState() {
        if (!this.browserBookmarkSelector) return;

        if (this.editingBookmark?.chromeId) {
            const lockedTarget = await this.resolveChromeBookmarkTarget(this.editingBookmark.chromeId);
            this.browserBookmarkSelector.setValue({
                mode: BrowserBookmarkSaveMode.BROWSER,
                target: lockedTarget
            });
            this.browserBookmarkSelector.setLockMode(true, '');
            return;
        }

        this.browserBookmarkSelector.setLockMode(false, '');
        this.browserBookmarkSelector.setValue(this.browserBookmarkSavePreference);
    }

    async persistBrowserBookmarkPreference(preferredValue = null) {
        if (!this.browserBookmarkSelector) {
            return;
        }

        const sourceValue = preferredValue ?? this.browserBookmarkSelector.getValue();
        const value = await BrowserBookmarkSelector.resolvePreferenceInCurrentBrowser(
            sourceValue,
            { directoryOnly: true }
        );
        this.browserBookmarkSelector.setValue(value);
        await BrowserBookmarkSelector.savePreference(value);
        this.browserBookmarkSavePreference = BrowserBookmarkSelector.normalizePreference(value, {
            directoryOnly: true
        });
    }

    async resolveBrowserBookmarkSaveForSubmit() {
        if (!this.browserBookmarkSelector) {
            return BrowserBookmarkSelector.buildPreferencePayload(BrowserBookmarkSaveMode.NONE, null);
        }

        const preference = await BrowserBookmarkSelector.resolvePreferenceInCurrentBrowser(
            this.browserBookmarkSelector.getValue(),
            { directoryOnly: true }
        );

        if (
            this.isEditMode &&
            this.editingBookmark?.chromeId &&
            this.browserBookmarkSelector.directoryOnly &&
            this.browserBookmarkSelector.lockMode
        ) {
            const lockedTarget = await this.resolveChromeBookmarkTarget(this.editingBookmark.chromeId);
            if (lockedTarget?.folderId !== preference.target?.folderId) {
                return preference;
            }
            
            return await BrowserBookmarkSelector.resolvePreferenceInCurrentBrowser({
                mode: BrowserBookmarkSaveMode.BROWSER,
                target: lockedTarget
            });
        }

        return preference
    }

    async getRecommendedFolders() {
        if (this.editingBookmark?.chromeId) return [];

        try {
            const url = this.currentTab?.url || '';
            let embedding = null;
            if (url) {
                const stored = await LocalStorageMgr.getBookmark(url, true);
                embedding = stored?.embedding || null;
            }
            const bookmarkInfo = {
                url,
                title: this.currentTab?.title || '',
                tags: this.getCurrentTags(),
                excerpt: this.pageContent?.excerpt || this.editingBookmark?.excerpt || '',
                embedding,
            };
            return await FolderRecommender.recommend(bookmarkInfo);
        } catch (error) {
            logger.error('获取推荐目录失败:', error);
            return [];
        }
    }

    createBatchMoveSelector(rootElement) {
        if (!rootElement) return null;
        rootElement.hidden = false;

        const selector = new BrowserBookmarkSelector({
            root: rootElement,
            directoryOnly: true,
            preferredVerticalPlacement: 'below',
            onChange: async (value) => {
                if (this._batchMoveSuppressChange) return;
                await this.handleBatchMoveSelectorChange(value);
            }
        });
        return selector;
    }

    async openBatchMoveSelector(editManager) {
        const selector = this.batchMoveSelector;
        if (!selector || !editManager?.isEditMode || editManager.selectedBookmarks.size === 0) {
            return;
        }

        this._batchMoveEditManager = editManager;
        this._batchMoveSuppressChange = true;

        try {
            await this.syncStoredBrowserBookmarkPreference();
            selector.setValue(this.browserBookmarkSavePreference);

            const toolbar = editManager.container.querySelector(
                '.edit-toolbar, .search-edit-toolbar'
            );
            if (toolbar) {
                selector.setAnchorElement(toolbar);
            }

            await selector.openPopover();
        } finally {
            this._batchMoveSuppressChange = false;
        }
    }

    async handleBatchMoveSelectorChange(value) {
        const editManager = this._batchMoveEditManager;
        if (!editManager?.isEditMode) return;

        const nextValue = value;
        if (nextValue?.mode !== BrowserBookmarkSaveMode.BROWSER || !nextValue?.target) {
            return;
        }

        const bookmarks = editManager.getSelectedBookmarksList();
        if (bookmarks.length === 0) return;

        await this.executeBatchMove(bookmarks, nextValue.target, editManager);
    }

    async executeBatchMove(bookmarks, browserTarget, editManager) {
        const target = BrowserBookmarkSelector.normalizeTarget(browserTarget);
        if (!target?.folderId) {
            updateStatus(i18n.getMessage('popup_batch_move_no_target'), true);
            return;
        }

        const targetFolderId = target.folderId;
        updateStatus(i18n.getMessage('popup_batch_move_moving'), false);

        let movedCount = 0;
        let createdCount = 0;
        let skippedCount = 0;
        let failCount = 0;

        for (const bookmark of bookmarks) {
            try {
                if (bookmark.chromeId) {
                    const [currentNode] = await chrome.bookmarks.get(bookmark.chromeId);
                    if (!currentNode) {
                        failCount++;
                        continue;
                    }
                    if (currentNode.parentId === targetFolderId) {
                        skippedCount++;
                        continue;
                    }
                    const children = await chrome.bookmarks.getChildren(targetFolderId);
                    await bookmarkOps._proxyMove(bookmark.chromeId, {
                        parentId: targetFolderId,
                        index: children.length
                    });
                    movedCount++;
                } else if (bookmark.url) {
                    const children = await chrome.bookmarks.getChildren(targetFolderId);
                    await bookmarkOps._proxyCreate({
                        parentId: targetFolderId,
                        index: children.length,
                        title: bookmark.title || '',
                        url: bookmark.url
                    });
                    createdCount++;
                }
            } catch (e) {
                logger.error('批量移动书签失败:', bookmark.url, e);
                failCount++;
            }
        }

        const totalSuccess = movedCount + createdCount;
        if (failCount === 0 && totalSuccess > 0) {
            updateStatus(
                i18n.getMessage('popup_batch_move_success', [totalSuccess]),
                false
            );
        } else if (totalSuccess > 0) {
            updateStatus(
                i18n.getMessage('popup_batch_move_partial', [totalSuccess, bookmarks.length]),
                false
            );
        } else if (skippedCount === bookmarks.length) {
            updateStatus(i18n.getMessage('popup_batch_move_all_skipped'), false);
        } else {
            updateStatus(i18n.getMessage('popup_batch_move_failed'), true);
        }

        editManager.exitEditMode();
        await this.refreshBookmarksList();
    }

    _injectEditToolbarIcons(elements) {
        const iconMap = {
            batchMoveButton: 'FolderInput',
            batchOpenButton: 'ExternalLink',
            batchDeleteButton: 'Trash2',
            exitEditModeButton: 'X'
        };
        for (const [key, iconName] of Object.entries(iconMap)) {
            if (elements[key]) {
                elements[key].innerHTML = IconPicker.getIconSvg(iconName, 16);
            }
        }
    }

    initBookmarkListEditMode() {
        const editElements = {
            container: document.querySelector('.container'),
            bookmarkList: document.getElementById('bookmarks-list'),
            selectAllCheckbox: document.getElementById('select-all-checkbox'),
            selectedCountElement: document.getElementById('selected-count'),
            batchMoveButton: document.getElementById('batch-move-btn'),
            batchDeleteButton: document.getElementById('batch-delete-btn'),
            batchOpenButton: document.getElementById('batch-open-btn'),
            exitEditModeButton: document.getElementById('exit-edit-mode-btn')
        }
        this._injectEditToolbarIcons(editElements);
        const callbacks = {
            showStatus: updateStatus,
            showDialog: this.showDialog,
            afterDelete: this.refreshBookmarksList,
            onBatchMove: (mgr) => this.openBatchMoveSelector(mgr),
            onExitEditMode: () => this.batchMoveSelector?.closePopover()
        }
        this.editManager = new BookmarkEditManager(editElements, callbacks, 'bookmark-item');
    }

    initSearchListEditMode() {
        const editElements = {
            container: document.querySelector('.search-content'),
            bookmarkList: document.getElementById('search-results'),
            selectAllCheckbox: document.getElementById('search-select-all-checkbox'),
            selectedCountElement: document.getElementById('search-selected-count'),
            batchMoveButton: document.getElementById('search-batch-move-btn'),
            batchDeleteButton: document.getElementById('search-batch-delete-btn'),
            batchOpenButton: document.getElementById('search-batch-open-btn'),
            exitEditModeButton: document.getElementById('search-exit-edit-mode-btn')
        };
        this._injectEditToolbarIcons(editElements);
        const callbacks = {
            showStatus: updateStatus,
            showDialog: this.showDialog,
            afterDelete: this.refreshBookmarksList,
            onBatchMove: (mgr) => this.openBatchMoveSelector(mgr),
            onExitEditMode: () => this.batchMoveSelector?.closePopover()
        };
        this.searchEditManager = new BookmarkEditManager(editElements, callbacks, 'result-item');
    }

    async refreshBookmarksList() {
        logger.debug('刷新书签列表');
        await refreshBookmarksInfo();
    }

    bindEvents() {
        this.elements.required.saveButton.addEventListener('click', this.handleSaveClick.bind(this));
        this.elements.required.syncButton.addEventListener('click', this.handleSyncClick.bind(this));
        this.elements.required.privacyIcon.addEventListener('click', this.handlePrivacyIconClick.bind(this));
        this.setupTagsDialogEvents();
        this.setupStorageListener();
        this.setupBrowserBookmarkSelectorListener();
    }

    async handleSyncClick() {
        // 打开同步状态弹窗
        await this.syncStatusDialog.open();
    }

    async handlePrivacyIconClick() {
        await handlePrivacyIconClick(this.elements.required.privacyIcon.dataset.isPrivate === 'true');
    }

    async hasSyncError() {
        const config = await SyncSettingsManager.getConfig();
        const status = await SyncStatusManager.getStatus();
        
        // 检查云同步是否开启
        if (FEATURE_FLAGS.ENABLE_CLOUD_SYNC && config.cloud && config.cloud.autoSync) {
            const {valid} = await validateToken();
            if (valid && status.cloud && status.cloud.lastSyncResult && status.cloud.lastSyncResult !== 'success') {
                return true;
            }
        }
        
        // 检查WebDAV同步是否开启
        if (config.webdav && config.webdav.syncStrategy.autoSync) {
            const valid = SyncSettingsManager.validateWebDAVConfig(config.webdav)
            if (valid && status.webdav && status.webdav.lastSyncResult && status.webdav.lastSyncResult !== 'success') {
                return true;
            }
        }
        return false;
    }

    async updateSyncButtonState() {
        try {
            const syncButton = this.elements.required.syncButton;

            // 获取同步状态
            const isSyncing = await SyncStatusManager.isSyncing();
            
            let state = 'idle';
            if (isSyncing) {
                state = 'syncing';
            } else {
                const hasSyncError = await this.hasSyncError();
                if (hasSyncError) {
                    state = 'error';
                }
            }
            
            // 移除所有状态类
            syncButton.classList.remove('syncing', 'error');
            switch (state) {
                case 'syncing':
                    syncButton.classList.add('syncing');
                    syncButton.setAttribute('data-i18n-title', 'popup_sync_syncing');
                    syncButton.title = i18n.getMessage('popup_sync_syncing');
                    break;
                case 'error':
                    syncButton.classList.add('error');
                    syncButton.setAttribute('data-i18n-title', 'popup_status_sync_failed');
                    syncButton.title = i18n.getMessage('popup_status_sync_failed');
                    break;
                default:
                    syncButton.setAttribute('data-i18n-title', 'popup_sync_button_text');
                    syncButton.title = i18n.getMessage('popup_sync_button_text');
                    break;
            }
        } catch (error) {
            logger.error('更新同步按钮状态失败:', error);
        }
    }

    showDialog(params) {
        this.alertDialog.show(params);
    }

    closeTagsDialog(event = null) {
        event?.stopPropagation?.();
        event?.preventDefault?.();

        const dialog = this.elements.required.dialog;
        dialog.classList.remove('show');
        if (!this.isEditMode) {
            updateStatus(i18n.getMessage('popup_status_cancel_save'), false);
        }
        this.resetEditMode();
        if (this.excerptRequest) {
            this.excerptRequest.abort();
            this.excerptRequest = null;
        }
        this._resolveTagsReady = null;
        this._tagsReadyPromise = null;

        return true;
    }

    handleTagsDialogEscape(event) {
        if (this.browserBookmarkSelector?.consumeEscapeKey?.(event)) {
            return true;
        }

        const dialog = this.elements.required.dialog;
        if (event.key !== 'Escape' || !dialog?.classList.contains('show')) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.closeTagsDialog();
        return true;
    }

    setupTagsDialogEvents() {
        const { dialog, tagsList, apiKeyNotice } = this.elements.required;
        const { 
            newTagInput, 
            saveTagsBtn, 
            cancelTagsBtn, 
            dialogContent,
            dialogTitle,
            deleteBookmarkBtn,
            pageUrl,
            pageExcerpt
        } = this.elements.optional;

        const closeDialog = (e) => this.closeTagsDialog(e);

        document.addEventListener('keydown', (e) => {
            this.handleTagsDialogEscape(e);
        });

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
                        } else {
                            updateStatus(i18n.getMessage('popup_tags_already_exists'), true);
                        }
                    }
                }
            });
        }

        if (tagsList) {
            tagsList.addEventListener('click', (e) => {
                if (e.target.closest('.clear-all-tags-btn')) {
                    this.renderTags([]);
                } else if (e.target.classList.contains('remove-tag-btn')) {
                    const tagElement = e.target.parentElement;
                    tagElement.remove();
                    if (this.getCurrentTags().length === 0) {
                        this.renderTags([]);
                    }
                } else if (e.target.classList.contains('tag-text')) {
                    const tagText = e.target.textContent.trim();
                    if (newTagInput && tagText) {
                        newTagInput.value = tagText;
                        newTagInput.focus();
                    }
                }
            });
        }

        if (saveTagsBtn) {
            saveTagsBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const finalTags = this.getCurrentTags();
                const title = this.getEditedTitle();
                const success = await this.saveBookmark(finalTags, title);
                if (success) dialog.classList.remove('show');
            });
        }

        if (cancelTagsBtn) {
            cancelTagsBtn.addEventListener('click', closeDialog);
        }

        if (deleteBookmarkBtn) {
            deleteBookmarkBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                
                this.alertDialog.show({
                    title: i18n.getMessage('popup_confirm_delete_title'),
                    message: i18n.getMessage('msg_confirm_delete_bookmark'),
                    primaryText: i18n.getMessage('action_delete_bookmark'),
                    secondaryText: i18n.getMessage('ui_button_cancel'),
                    onPrimary: async () => {
                        dialog.classList.remove('show');
                        await this.handleUnsave(this.currentTab);
                        this.resetEditMode();
                    }
                });
            });
        }


        if (dialogTitle) { 
            const { translateTitleBtn } = this.elements.optional;
            
            const handlers = {
                focus: () => {
                    dialogTitle.dataset.originalTitle = dialogTitle.textContent;
                    // 显示翻译按钮
                    if (translateTitleBtn) {
                        translateTitleBtn.style.display = 'flex';
                    }
                },
                
                blur: (e) => {
                    const newTitle = dialogTitle.textContent.trim();
                    if (!newTitle) {
                        dialogTitle.textContent = dialogTitle.dataset.originalTitle;
                    }
                    
                    // 如果失去焦点是因为点击了翻译按钮，则保持焦点
                    if (translateTitleBtn && e.relatedTarget === translateTitleBtn) {
                        setTimeout(() => {
                            if (document.activeElement !== dialogTitle) {
                                dialogTitle.focus();
                            }
                        }, 0);
                        return;
                    }
                    
                    // 延迟隐藏翻译按钮
                    setTimeout(() => {
                        if (document.activeElement !== dialogTitle && document.activeElement !== translateTitleBtn) {
                            if (translateTitleBtn) {
                                translateTitleBtn.style.display = 'none';
                            }
                        }
                    }, 100);
                },
                
                keydown: (e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        dialogTitle.textContent = dialogTitle.dataset.originalTitle;
                        dialogTitle.blur();
                        return false;
                    }
                    // 监听撤销快捷键（只在翻译后支持）
                    else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                        if (this.hasTranslated && this.originalTitle) {
                            const currentText = dialogTitle.textContent.trim();
                            if (currentText !== this.originalTitle) {
                                e.preventDefault();
                                e.stopPropagation();
                                dialogTitle.textContent = this.originalTitle;
                                dialogTitle.title = this.originalTitle;
                                this.hasTranslated = false;
                                return false;
                            }
                        }
                    }
                },
                keypress: (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        dialogTitle.blur();
                    }
                },
                
                input: () => {
                    // 用户手动编辑时，清除翻译标记
                    if (this.hasTranslated) {
                        const currentText = dialogTitle.textContent.trim();
                        if (currentText !== this.originalTitle) {
                            this.hasTranslated = false;
                        }
                    }
                }
            }
            // 绑定事件
            dialogTitle.addEventListener('focus', handlers.focus);
            dialogTitle.addEventListener('blur', handlers.blur);
            dialogTitle.addEventListener('keydown', handlers.keydown);
            dialogTitle.addEventListener('keypress', handlers.keypress);
            dialogTitle.addEventListener('input', handlers.input);
            
            // 翻译按钮点击事件 - 使用 mousedown 避免失去焦点
            if (translateTitleBtn) {
                translateTitleBtn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.translateTitle();
                });
            }
        }

        if (pageUrl) {
            pageUrl.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    pageUrl.blur();
                }
            });

            pageUrl.addEventListener('blur', () => {
                this.validateUrl();
            });
        }

        const apiKeyLink = apiKeyNotice.querySelector('.api-key-link');
        if (apiKeyLink) {
            apiKeyLink.addEventListener('click', async (e) => {
                e.preventDefault();
                openOptionsPage('services');
            });
        }

        // 添加AI生成摘要按钮点击事件
        const generateExcerptBtn = document.getElementById('generate-excerpt-btn');
        if (generateExcerptBtn && pageExcerpt) {
            generateExcerptBtn.addEventListener('click', async () => {
                await this.generateExcerpt(pageExcerpt);
            });
        }

        const { generateTagsBtn } = this.elements.optional;
        if (generateTagsBtn) {
            generateTagsBtn.addEventListener('click', async () => {
                if (generateTagsBtn.classList.contains('loading')) {
                    if (this.tagRequest) {
                        this.tagRequest.abort();
                        this.tagRequest = null;
                    }
                    return;
                }
                await this.generateTagsForDialog({ useCache: false, interactive: true });
            });
        }

        if (pageExcerpt) {
            // 监听输入事件和初始加载
            pageExcerpt.addEventListener('input', () => {
                this.adjustTextareaHeight(pageExcerpt);
                this.updateCharCount(pageExcerpt);
            });
        }
    }
    
    // AI生成书签摘要
    async generateExcerpt(textarea) {
        if (!textarea) return;
        
        // 获取生成按钮
        const generateBtn = document.getElementById('generate-excerpt-btn');
        if (!generateBtn) return;
        
        // 如果已经在loading状态，尝试取消请求
        if (generateBtn.classList.contains('loading')) {
            if (this.excerptRequest) {
                this.excerptRequest.abort();
                this.excerptRequest = null;
            }
            return;
        }
        
        try {
            // 显示加载状态
            generateBtn.classList.add('loading');
            generateBtn.setAttribute('data-i18n-title', 'popup_tags_cancel_generate');
            generateBtn.title = i18n.getMessage('popup_tags_cancel_generate');

            // 检查API Key是否有效
            await checkAPIKeyValid('chat');

            // 创建可取消的请求
            this.excerptRequest = requestManager.create('generate_excerpt');

            // 调用API生成摘要，传入signal
            const excerpt = await generateExcerpt(this.pageContent, this.currentTab, this.excerptRequest.signal);
            
            if (excerpt) {
                // 设置摘要内容
                textarea.value = excerpt;
                // 调整文本区域高度和字符计数
                this.adjustTextareaHeight(textarea);
                this.updateCharCount(textarea);
            } else {
                throw new Error(i18n.getMessage('popup_tags_generate_excerpt_failed'));
            }
        } catch (error) {
            if (isUserCanceledError(error)) {
                updateStatus(i18n.getMessage('popup_tags_cancel_generate_excerpt'), false);
            } else {
                updateStatus(`${error.message}`, true);
            }
        } finally {
            // 移除loading状态
            generateBtn.classList.remove('loading');
            generateBtn.setAttribute('data-i18n-title', 'popup_tags_generate_excerpt_title');
            generateBtn.title = i18n.getMessage('popup_tags_generate_excerpt_title');
            
            // 清理请求
            if (this.excerptRequest) {
                this.excerptRequest.done();
                this.excerptRequest = null;
            }
        }
    }

    async translateTitle() {
        const { dialogTitle, translateTitleBtn } = this.elements.optional;
        if (!dialogTitle || !translateTitleBtn) return;
        
        // 如果已经在loading状态，尝试取消请求
        if (translateTitleBtn.classList.contains('loading')) {
            if (this.translateRequest) {
                this.translateRequest.abort();
                this.translateRequest = null;
            }
            return;
        }
        
        try {
            // 显示加载状态
            translateTitleBtn.classList.add('loading');
            translateTitleBtn.setAttribute('data-i18n-title', 'ui_button_cancel_translate');
            translateTitleBtn.title = i18n.M('ui_button_cancel_translate');

            await checkAPIKeyValid('chat');

            // 使用原始标题进行翻译，而不是当前标题
            const textToTranslate = this.originalTitle || dialogTitle.textContent.trim();
            if (!textToTranslate) {
                throw new Error(i18n.M('msg_error_empty_title'));
            }

            // 创建可取消的请求
            this.translateRequest = requestManager.create();

            // 调用API进行翻译（使用原始标题）
            const translatedText = await translateText(textToTranslate, this.translateRequest.signal);
            
            if (translatedText) {
                // 保存原始标题（如果还没有保存）
                if (!this.originalTitle) {
                    this.originalTitle = dialogTitle.textContent.trim();
                }
                
                // 替换标题内容
                dialogTitle.textContent = translatedText;
                dialogTitle.title = translatedText;
                
                // 标记已翻译，支持撤销
                this.hasTranslated = true;
            } else {
                throw new Error(i18n.M('msg_error_translate_failed'));
            }
        } catch (error) {
            if (isUserCanceledError(error)) {
                updateStatus(i18n.M('msg_status_translate_canceled'), false);
            } else {
                updateStatus(error.message || i18n.M('msg_error_translate_failed'), true);
            }
        } finally {
            // 移除loading状态
            translateTitleBtn.classList.remove('loading');
            translateTitleBtn.setAttribute('data-i18n-title', 'ui_button_translate_title');
            translateTitleBtn.title = i18n.M('ui_button_translate_title');
            
            // 清理请求
            if (this.translateRequest) {
                this.translateRequest.done();
                this.translateRequest = null;
            }
        }
    }

    adjustTextareaHeight(textarea) {
        if (!textarea) return;

        // 重置高度为自动，计算新高度
        textarea.style.height = 'auto';
        
        // 计算新的高度
        const scrollHeight = textarea.scrollHeight;
        
        // 获取css中设置的最大高度限制
        const maxHeight = parseInt(window.getComputedStyle(textarea).maxHeight);
        
        // 设置新高度，但不超过最大高度
        textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
    }
    
    updateCharCount(textarea) {
        if (!textarea) return;
        
        const charCount = document.getElementById('char-count');
        if (!charCount) return;
        
        const maxLength = textarea.getAttribute('maxlength');
        const currentLength = textarea.value.length;
        
        // 更新计数
        charCount.textContent = currentLength;
        
        // 根据字符数添加样式
        const charCounter = charCount.parentElement;
        
        // 清除现有样式
        charCounter.classList.remove('near-limit', 'at-limit');
        
        // 添加新样式
        if (currentLength >= maxLength) {
            charCounter.classList.add('at-limit');
        } else if (currentLength >= maxLength * 0.8) {
            charCounter.classList.add('near-limit');
        }
    }

    async checkApiKeyConfig(isInit = false) {
        const apiKeyValid = await checkAPIKeyValidSafe();
        logger.debug('apiKeyValid', apiKeyValid);

        const skipApiKeyNotice = await SettingsManager.get('display.skipApiKeyNotice');
        if (!apiKeyValid) {
            // 显示API Key配置链接
            this.elements.required.apiKeyNotice.style.display = 'block';

            // 如果未设置跳过提示，显示欢迎对话框
            if (!skipApiKeyNotice && isInit) {
                this.alertDialog.show({
                    title: i18n.getMessage('popup_welcome_title'),
                    message: i18n.getMessage('popup_welcome_message'),
                    primaryText: i18n.getMessage('popup_welcome_configure'),
                    secondaryText: i18n.getMessage('popup_welcome_later'),
                    onPrimary: () => {
                        openOptionsPage('services');
                    },
                    onSecondary: async () => {
                        await updateSettingsWithSync({
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

    // 更新重新生成索引状态显示
    async updateRegeneratingStatus() {
        try {
            const statusData = await LocalStorageMgr.get('isRegeneratingEmbeddings');
            const statusElement = this.elements.required.regeneratingStatus;
            
            if (!statusElement) {
                return;
            }
            
            // 检查状态数据
            let isRegenerating = false;
            if (statusData && typeof statusData === 'object') {
                const REGENERATING_TIMEOUT = 5 * 60 * 1000; // 5分钟超时时间（毫秒）
                const now = Date.now();
                const timestamp = statusData.timestamp || 0;
                
                // 检查是否超时
                if (statusData.isRegenerating && (now - timestamp) > REGENERATING_TIMEOUT) {
                    // 状态超时，自动清除
                    logger.warn('重新生成索引状态已超时，自动清除');
                    await LocalStorageMgr.set('isRegeneratingEmbeddings', {
                        isRegenerating: false,
                        timestamp: now
                    });
                    isRegenerating = false;
                } else {
                    isRegenerating = statusData.isRegenerating || false;
                }
            }
            
            statusElement.style.display = isRegenerating ? 'flex' : 'none';
        } catch (error) {
            logger.error('更新重新生成索引状态时出错:', error);
        }
    }

    setupStorageListener() {
        chrome.storage.onChanged.addListener(async (changes, areaName) => {
            if (areaName === 'sync') {  // 确保是监听sync storage
                // 监听API Keys的变化
                if (changes[ConfigManager.STORAGE_KEYS.SERVICE_TYPES]) {
                    logger.debug('API Keys发生变化:', changes[ConfigManager.STORAGE_KEYS.SERVICE_TYPES], changes[ConfigManager.STORAGE_KEYS.SERVICE_TYPES]);
                    this.checkApiKeyConfig(false);
                    if (settingsDialog) {
                        settingsDialog.refreshServiceSelector();
                    }
                }
                if (changes[ConfigManager.STORAGE_KEYS.API_KEYS]) {
                    this.checkApiKeyConfig(false);
                    if (settingsDialog) {
                        settingsDialog.refreshServiceSelector();
                    }
                }
                if (changes[ConfigManager.STORAGE_KEYS.CUSTOM_SERVICES]) {
                    this.checkApiKeyConfig(false);
                    if (settingsDialog) {
                        settingsDialog.refreshServiceSelector();
                    }
                }
            } else if (areaName === 'local') {
                // 监听重新生成索引状态
                if (changes.isRegeneratingEmbeddings) {
                    this.updateRegeneratingStatus();
                }
                if (changes[SyncStatusManager.SYNC_PROCESS_KEY] || changes[SyncSettingsManager.SYNC_CONFIG_KEY]) {
                    this.updateSyncButtonState();
                    this.syncStatusDialog.onSyncProcessChange();
                }
            }
        });
    }

    setupBrowserBookmarkSelectorListener() {
        const handleBookmarkChange = () => {
            this.scheduleBrowserBookmarkSelectorRefresh();
        };

        chrome.bookmarks.onCreated.addListener(handleBookmarkChange);
        chrome.bookmarks.onRemoved.addListener(handleBookmarkChange);
        chrome.bookmarks.onChanged.addListener(handleBookmarkChange);
        chrome.bookmarks.onMoved.addListener(handleBookmarkChange);
    }

    getCurrentTags() {
        const { tagsList } = this.elements.required;
        if (!tagsList) return [];
        
        const tagElements = tagsList.querySelectorAll('.tag-text');
        return Array.from(tagElements).map(el => el.textContent.trim());
    }

    showTagsLoading() {
        const { tagsList } = this.elements.required;
        tagsList.innerHTML = `
            <div class="loading-spinner"></div>
            <span data-i18n="ui_label_tags_loading">正在生成标签...</span>
        `;
        tagsList.classList.add('loading');
        i18n.updateNodeText(tagsList);
    }

    setGenerateTagsButtonLoading(isLoading) {
        const { generateTagsBtn } = this.elements.optional;
        if (!generateTagsBtn) return;

        generateTagsBtn.classList.toggle('loading', isLoading);
        generateTagsBtn.title = i18n.getMessage(isLoading ? 'popup_tags_cancel_generate' : 'popup_tags_generate_tags_title');
    }

    async generateTagsForDialog({ useCache = false, interactive = false } = {}) {
        if (this.isEditMode || !this.currentTab) return;

        if (!interactive) {
            const autoGenerate = await SettingsManager.get('ai.autoGenerateTags');
            if (autoGenerate === false) {
                this.generatedTags = [];
                this.renderTags([]);
                this.notifyTagsReady();
                return;
            }
        }

        const unclassifiedTag = i18n.M('ui_tag_unclassified');
        const previousTags = this.getCurrentTags();

        // 内存缓存命中：不展示加载态、不调 API
        if (useCache && this.tagCache.url === this.currentTab.url && this.tagCache.tags.length > 0) {
            logger.debug('使用缓存的标签:', this.tagCache.tags);
            this.generatedTags = this.tagCache.tags;
            this.renderTags(this.generatedTags);
            this.notifyTagsReady();
            return;
        }

        // 手动生成：未配置时直接提示并返回，不进入标签区 loading
        if (interactive) {
            try {
                await checkAPIKeyValid('chat');
            } catch (error) {
                updateStatus(`${error.message}`, true);
                this.notifyTagsReady();
                return;
            }
        } else {
            // 自动拉取：未配置时静默为未分类，不提示、不展示加载
            try {
                await checkAPIKeyValid('chat');
            } catch {
                this.generatedTags = [unclassifiedTag];
                this.renderTags(this.generatedTags);
                this.notifyTagsReady();
                return;
            }
        }

        this.showTagsLoading();
        this.setGenerateTagsButtonLoading(true);

        try {
            this.tagRequest = requestManager.create('popup_generate_tags');
            const tags = await generateTags(this.pageContent, this.currentTab, this.tagRequest.signal);

            if (tags && tags.length > 0) {
                this.generatedTags = tags;
                this.tagCache = {
                    url: this.currentTab.url,
                    tags
                };
                this.renderTags(tags);
            } else {
                this.generatedTags = [unclassifiedTag];
                this.renderTags(this.generatedTags);
            }
        } catch (error) {
            logger.error('生成标签失败:', error);
            if (isUserCanceledError(error)) {
                updateStatus(i18n.getMessage('popup_tags_cancel_generate'), false);
                this.generatedTags = previousTags;
                this.renderTags(previousTags);
                return;
            }
            if (interactive) {
                updateStatus(`${error.message}`, true);
            }
            this.generatedTags = [unclassifiedTag];
            this.renderTags(this.generatedTags);
        } finally {
            this.setGenerateTagsButtonLoading(false);
            if (this.tagRequest) {
                this.tagRequest.done();
                this.tagRequest = null;
            }
            this.notifyTagsReady();
        }
    }

    // 验证URL格式
    validateUrl() {
        const {pageUrl} = this.elements.optional;
        let url = pageUrl.textContent.trim();
        
        try {
            // 尝试创建URL对象以验证格式
            new URL(url);
        } catch (error) {
            // URL无效，恢复原始URL
            updateStatus(i18n.getMessage('popup_url_format_error'), true);
            pageUrl.textContent = this.currentTab?.url;
        }
    }

    getEditedTitle() {
        const {dialogTitle} = this.elements.optional;
        return dialogTitle.textContent.trim();
    }
    
    // 获取编辑后的URL
    getEditedUrl() {
        const {pageUrl} = this.elements.optional;
        let url = pageUrl.textContent.trim();
        try {
            new URL(url);
            return url;
        } catch (error) {
            return this.currentTab?.url;
        }
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
                    const bookmarks = await getAllBookmarks(false);
                    const bookmark = bookmarks[tab.url] || Object.values(bookmarks).find(b => b.url === tab.url);
                    logger.debug('handleSaveClick bookmark', {
                        bookmark: bookmark,
                        tab: tab,
                        isSaved: isSaved,
                    });
                    if (bookmark) {
                        this.handleEdit(bookmark);
                        return;
                    }
                }

                // 添加对非http页面的检查
                if (isNonMarkableUrl(tab.url)) {
                    updateStatus(i18n.getMessage('msg_status_page_unsupported'), false);
                    return;
                }

                await this.processAndShowTags(tab);
            } else {
                updateStatus(i18n.getMessage('msg_status_page_unsupported'), false);
            }
        } catch (error) {
            logger.error('保存过程中出错:', error);
            updateStatus(i18n.getMessage('msg_error_save_failed', [error.message]), true);
        } finally {
            SaveManager.endSave(this);
        }
    }

    async handleUnsave(tab) {
        const bookmarks = await getAllBookmarks(false);
        const bookmark = bookmarks[tab.url] || Object.values(bookmarks).find(b => b.url === tab.url);
        if (bookmark) {
            await bookmarkOps.deleteBookmark(bookmark);
            updateStatus(i18n.getMessage('popup_status_cancel_bookmark'), false);
            await refreshBookmarksInfo();
        }
    }

    async processAndShowTags(tab) {
        if (tab.status !== 'complete') {
            if (tab.title && tab.url) {
                this.pageContent = {};
                logger.debug('页面正在加载中，不访问页面内容', tab);
            } else {
                updateStatus(i18n.getMessage('msg_status_page_loading'), true);
                return;
            }
        } else {
            this.pageContent = await getPageContent(tab);
            logger.debug('获取页面内容:', this.pageContent);
        }

        const cachedTags = this.tagCache.url === tab.url ? this.tagCache.tags : [];
        this.generatedTags = cachedTags;

        await this.showTagsDialog(cachedTags);
        if (cachedTags.length > 0) {
            return;
        }

        void this.generateTagsForDialog({ useCache: true });
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
        
        // 保存原始标题
        this.originalTitle = bookmark.title;
        this.hasTranslated = false; // 重置翻译标记
        
        // 设置页面内容
        this.pageContent = {
            title: bookmark.title,
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
        const dialogExcerpt = dialog.querySelector('#page-excerpt');
        const deleteBookmarkBtn = dialog.querySelector('#delete-bookmark-btn');

        if (this.isEditMode) {
            dialog.classList.add('edit-mode');
        } else {
            dialog.classList.remove('edit-mode');
        }

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
        
        // 保存原始标题
        this.originalTitle = this.currentTab.title;
        this.hasTranslated = false; // 重置翻译标记
        
        // 设置标题
        dialogTitle.textContent = this.currentTab.title;
        dialogTitle.title = this.currentTab.title;
        
        // 设置URL
        dialogUrl.textContent = this.currentTab.url;
        dialogUrl.title = this.currentTab.url;
        
        // 设置URL是否可编辑 
        dialogUrl.contentEditable = "true";
        dialogUrl.classList.add("editable");
        
        // 设置图标
        dialogFavicon.src = await getFaviconUrl(this.currentTab.url);
        dialogFavicon.onerror = () => {
            // 如果图标加载失败，使用默认图标或隐藏图标容器
            dialogFavicon.src = 'icons/default_favicon.png'; // 确保你有一个默认图标
        };

        // 处理摘要
        if (this.pageContent?.excerpt) {
            dialogExcerpt.value = this.pageContent.excerpt;
        } else {
            dialogExcerpt.value = '';
            dialogExcerpt.setAttribute('data-i18n', 'popup_tags_excerpt_placeholder');
            dialogExcerpt.placeholder = i18n.getMessage('popup_tags_excerpt_placeholder');
        }
        
        // 渲染已有标签
        this.renderTags(tags);
        await this.prepareBrowserBookmarkSelectorForDialog();
        
        // 显示对话框
        dialog.classList.add('show');
        requestAnimationFrame(() => {
            this.adjustTextareaHeight(dialogExcerpt);
            this.updateCharCount(dialogExcerpt);
        });
        if (this.isEditMode) {
            this.browserBookmarkSelector?.clearRecommendations();
        } else {
            this.scheduleAutoRecommend(tags.length > 0);
        }
    }

    scheduleAutoRecommend(tagsReady) {
        if (tagsReady) {
            void this.browserBookmarkSelector?.autoRecommend();
            return;
        }
        this._resolveTagsReady = null;
        this._tagsReadyPromise = new Promise(resolve => {
            this._resolveTagsReady = resolve;
        });
        void this._tagsReadyPromise.then(() => {
            this.browserBookmarkSelector?.autoRecommend();
        });
    }

    notifyTagsReady() {
        if (this._resolveTagsReady) {
            this._resolveTagsReady();
            this._resolveTagsReady = null;
            this._tagsReadyPromise = null;
        }
    }

    renderTags(tags) {
        const tagsList = document.getElementById('tags-list');
        tagsList.classList.remove('loading');
        tagsList.innerHTML = '';
        
        tags.forEach(tag => {
            const tagElement = document.createElement('span');
            tagElement.className = 'tag';
            tagElement.innerHTML = `
                <span class="tag-text">${tag}</span>
                <button class="remove-tag-btn">×</button>
            `;
            tagsList.appendChild(tagElement);
        });

        if (tags.length > 0) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'clear-all-tags-btn';
            clearBtn.title = i18n.getMessage('ui_tags_clear_all_title');
            clearBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>${i18n.getMessage('ui_tags_clear_all')}`;
            tagsList.appendChild(clearBtn);
        }
    }

    getEditedExcerpt() {
        const dialogExcerpt = document.querySelector('#page-excerpt');
        return dialogExcerpt ? dialogExcerpt.value.trim() : '';
    }

    async saveBookmark(tags, title) {
        try {
            if (!this.currentTab) {
                throw new Error(i18n.getMessage('popup_page_info_fetch_failed'));
            }
            const operationKey = this.isEditMode ? 'popup_status_updating_bookmark' : 'msg_status_saving_bookmark';
            StatusManager.startOperation(i18n.getMessage(operationKey));
            
            const url = this.getEditedUrl();
            const editedExcerpt = this.getEditedExcerpt();
            const updates = {
                url,
                title,
                tags,
                excerpt: editedExcerpt,
                savedAt: this.isEditMode ? this.editingBookmark.savedAt : Date.now(),
                useCount: this.isEditMode ? this.editingBookmark.useCount : 1,
                lastUsed: this.isEditMode ? this.editingBookmark.lastUsed : Date.now(),
            };

            logger.debug('书签编辑信息:', {
                isEditMode: this.isEditMode,
                before: this.isEditMode ? this.editingBookmark : null,
                after: updates
            });

            // 编辑改 URL 冲突：新 URL 已存在时提示合并确认
            if (this.isEditMode && this.editingBookmark.url !== url) {
                const existing = await LocalStorageMgr.getBookmark(url, true);
                if (existing) {
                    const confirmed = await new Promise(resolve => {
                        const bm = getBookmarkManager();
                        if (!bm?.alertDialog) {
                            resolve(true);
                            return;
                        }
                        bm.alertDialog.show({
                            title: i18n.getMessage('popup_confirm_delete_title'),
                            message: i18n.getMessage('popup_url_merge_confirm'),
                            primaryText: i18n.getMessage('popup_alert_confirm') || '确定',
                            secondaryText: i18n.getMessage('ui_button_cancel'),
                            onPrimary: () => resolve(true),
                            onSecondary: () => resolve(false)
                        });
                    });
                    if (!confirmed) {
                        StatusManager.endOperation(i18n.getMessage('popup_status_cancel_save'), false);
                        this.resetEditMode();
                        return;
                    }
                }
            }

            // 统一使用 bookmarkOps 更新（extension + Chrome）
            const bookmarkToUpdate = this.isEditMode ? this.editingBookmark : { url, title, tags: updates.tags, excerpt: updates.excerpt, savedAt: updates.savedAt, useCount: updates.useCount, lastUsed: updates.lastUsed, _presence: 'extension_only' };
            const browserSave = await this.resolveBrowserBookmarkSaveForSubmit();
            if (this.browserBookmarkSelector) {
                this.browserBookmarkSelector.setValue(browserSave);
            }
            const bookmarkOperationResult = await bookmarkOps.updateBookmark(
                bookmarkToUpdate,
                updates,
                this.isEditMode && this.editingBookmark.url !== url ? this.editingBookmark.url : null,
                { browserSave }
            );
            if (BrowserBookmarkSelector.shouldPersistPreferenceAfterBookmarkSave({
                isEditMode: this.isEditMode,
                bookmarkOperationResult
            })) {
                await this.persistBrowserBookmarkPreference(browserSave);
            }

            await refreshBookmarksInfo();
            const successKey = this.isEditMode ? 'popup_status_update_success' : 'msg_status_save_success';
            StatusManager.endOperation(i18n.getMessage(successKey), false);
            this.resetEditMode();
            return true;
        } catch (error) {
            logger.error('保存书签时出错:', error);
            const failKey = this.isEditMode ? 'popup_status_update_failed' : 'msg_error_save_failed';
            StatusManager.endOperation(i18n.getMessage(failKey, [error.message]), true);
            this.resetEditMode();
            return false;
        }
    }
}

async function updateSearchResults() {
    const searchInput = document.getElementById('search-input');
    if (searchInput.value) {
        logger.debug('更新搜索结果');
        const query = searchInput.value.trim();
        const results = await searchBookmarksFromBackground(query, {
            debounce: false,
            includeUrl: true
        });
        displaySearchResults(results, query);
    }
}

function displaySearchResults(results, query) {
    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = '';

    const bookmarkManager = getBookmarkManager();
    if (bookmarkManager) {
        bookmarkManager.searchEditManager.initialize(results);
    }

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
                    <div class="empty-title" data-i18n="popup_search_no_results_title"></div>
                    <div class="empty-detail">${i18n.getMessage('popup_search_no_results_detail', [query])}</div>
                    <div class="empty-suggestion" data-i18n="popup_search_no_results_suggestion"></div>
                </div>
            </div>
        `;
        i18n.updateNodeText(resultsContainer);
        return;
    }

    // 将结果处理包装在异步函数中
    const createResultElement = async (result) => {
        const li = document.createElement('li');
        li.className = 'result-item';
        li.dataset.url = result.url;
        
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

        const firstTag = result.tags.length > 0 ? (
            result.source === BookmarkSource.CHROME
                ? `<span class="tag folder-tag">${result.tags[0]}</span>`
                : `<span class="tag">${result.tags[0]}</span>`
        ) : '';
        const restCount = result.tags.length - 1;
        const tagsHtml = firstTag + (restCount > 0
            ? `<span class="tag-overflow-count" title="${result.tags.slice(1).join(', ')}">+${restCount}</span>`
            : '');

        const preview = truncateExcerpt(result.excerpt || '');

        // 使用 getFaviconUrl 函数获取图标
        const faviconUrl = await getFaviconUrl(result.url);

        // 修改相关度显示
        const getRelevanceIndicator = (score, similarity) => {
            if (similarity < 0.01) {
                return '';
            }
            
            let stars;
            if (score >= 85) {
                // 高相关：三颗绿星
                stars = `
                    <span class="relevance-star high">★</span>
                    <span class="relevance-star high">★</span>
                    <span class="relevance-star high">★</span>
                `;
            } else if (score >= 65) {
                // 中等相关：根据分数显示1-2颗橙星
                stars = `
                    <span class="relevance-star medium">★</span>
                    ${score >= 75 ? '<span class="relevance-star medium">★</span>' : '<span class="relevance-star low">★</span>'}
                    <span class="relevance-star low">★</span>
                `;
            } else {
                // 低相关：三颗灰星
                stars = `
                    <span class="relevance-star low">★</span>
                    <span class="relevance-star low">★</span>
                    <span class="relevance-star low">★</span>
                `;
            }

            return `<div class="result-score">
                <div class="relevance-stars">${stars}</div>
            </div>`;
        };

        const editTitle = i18n.getMessage('action_edit_bookmark');
        const editBtnHtml = (result.source === BookmarkSource.EXTENSION || result.source === BookmarkSource.CHROME) ? `
            <button class="action-btn edit-btn" data-i18n-title="action_edit_bookmark" title="${editTitle}">
                <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z" />
                </svg>
            </button>
        ` : '';
        
        const unknownTime = i18n.getMessage('popup_time_unknown');
        const formattedDate = result.savedAt ? new Date(result.savedAt).toLocaleDateString(navigator.language, {year: 'numeric', month: 'long', day: 'numeric'}) : unknownTime;

        const folderPathText = !bookmarkOps.isExtensionOnly(result) ? formatBookmarkFolderPath(result.folderTags) : '';
        const folderPathSlot = folderPathText
            ? `<div class="result-folder-path">
                <svg class="result-folder-path-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path fill="currentColor" d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/>
                </svg>
                <span class="result-folder-path-text"></span>
            </div>`
            : '';

        // 添加选择复选框
        li.innerHTML = `
            <div class="bookmark-checkbox">
                <input type="checkbox" data-i18n-title="popup_select_bookmark" title="">
            </div>
            <a href="${result.url}" class="result-link" target="_blank">
                <div class="result-header">
                    <div class="result-title-wrapper">
                        <div class="result-favicon">
                            <img src="${faviconUrl}" alt="">
                        </div>
                        <span class="result-title" title="${result.title}">${highlightText(result.title)}</span>
                        ${getRelevanceIndicator(result.score, result.similarity)}
                    </div>
                </div>
                <div class="result-url" title="${result.url}">${result.url}</div>
                <div class="result-preview" title="${result.excerpt || ''}">${preview}</div>
                ${(tagsHtml || folderPathSlot) ? `<div class="result-footer">
                    <div class="result-tags">${tagsHtml}</div>
                    <div class="result-metadata">
                        ${folderPathSlot}
                    </div>
                </div>` : ''}
            </a>
            
            <!-- 添加三点菜单按钮 -->
            <div class="more-actions-btn" data-i18n-title="popup_more_actions" title="">
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <circle cx="12" cy="5" r="2.2" fill="currentColor" />
                    <circle cx="12" cy="12" r="2.2" fill="currentColor" />
                    <circle cx="12" cy="19" r="2.2" fill="currentColor" />
                </svg>
            </div>
            
            <!-- 操作菜单（默认隐藏） -->
            <div class="actions-menu">
                <div class="actions-menu-content">
                    ${editBtnHtml}
                    <button class="action-btn delete-btn" data-i18n-title="action_delete_bookmark" title="">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>
                        </svg>
                    </button>
                </div>
                <div class="actions-menu-header">
                    <button class="close-menu-btn" data-i18n-title="ui_button_close" title="">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        if (folderPathText) {
            const folderWrap = li.querySelector('.result-folder-path');
            const folderTextEl = folderWrap?.querySelector('.result-folder-path-text');
            if (folderWrap && folderTextEl) {
                folderTextEl.textContent = folderPathText;
                folderWrap.title = folderPathText;
            }
        }

        // 为图标添加错误处理
        const img = li.querySelector('.result-favicon img');
        img.addEventListener('error', function() {
            this.src = 'icons/default_favicon.png';
        });
        
        // 修改点击事件处理
        const link = li.querySelector('.result-link');
        link.addEventListener('click', async (e) => {
            // 非编辑模式下的正常处理
            if (isNonMarkableUrl(result.url)) {
                e.preventDefault();
                // 显示提示并提供复制链接选项
                const copyConfirm = confirm(i18n.getMessage('popup_copy_link_confirm'));
                if (copyConfirm) {
                    await navigator.clipboard.writeText(result.url);
                    updateStatus(i18n.getMessage('popup_link_copied'), false);
                }
            } else {
                // 获取用户的打开方式配置
                const openInNewTab = await SettingsManager.get('display.openInNewTab');
                
                // 如果不是在新标签页打开，修改链接行为
                if (!openInNewTab) {
                    e.preventDefault();
                    chrome.tabs.update({ url: result.url });
                }
                
                // 更新使用频率
                if (result.source === BookmarkSource.EXTENSION) {
                    await updateBookmarkUsage(result.url);
                }
            }
        });

        li.addEventListener('click', async (e) => {
            if (bookmarkManager && bookmarkManager.searchEditManager.isInEditMode()) {
                if (!e.target.closest('a') && !e.target.closest('button') && !e.target.closest('.bookmark-checkbox')) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // 触发复选框点击
                    const checkbox = li.querySelector('.bookmark-checkbox input');
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        const changeEvent = new CustomEvent('change', { 
                            bubbles: true,
                            detail: { shiftKey: e.shiftKey }
                        });
                        changeEvent.shiftKey = e.shiftKey;
                        checkbox.dispatchEvent(changeEvent);
                    }
                    return;
                }
            }
        });
        
        // 设置复选框事件处理
        const checkbox = li.querySelector('.bookmark-checkbox input');
        if (checkbox) {
            checkbox.addEventListener('change', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // 获取搜索结果编辑管理器
                if (bookmarkManager) {
                    const searchEditManager = bookmarkManager.searchEditManager;
                    // 如果尚未进入编辑模式，则进入编辑模式并选中当前项
                    if (!searchEditManager.isInEditMode()) {
                        searchEditManager.enterEditMode(li);
                    } else {
                        // 如果已经在编辑模式，则切换当前项的选中状态
                        const isShiftKey = e.shiftKey || (e.detail && e.detail.shiftKey);
                        searchEditManager.toggleBookmarkSelection(li, e.target.checked, isShiftKey);
                    }
                }  
            });
        }

        // 处理三点菜单按钮点击
        const moreActionsBtn = li.querySelector('.more-actions-btn');
        if (moreActionsBtn) {
            moreActionsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // 获取当前菜单
                const menu = moreActionsBtn.nextElementSibling;
                
                // 关闭所有其他打开的菜单
                document.querySelectorAll('.actions-menu.visible').forEach(openMenu => {
                    if (openMenu !== menu) {
                        openMenu.classList.remove('visible');
                    }
                });
                
                // 切换当前菜单
                menu.classList.toggle('visible');
            });
        }
        
        // 处理关闭菜单按钮点击
        const closeMenuBtn = li.querySelector('.close-menu-btn');
        if (closeMenuBtn) {
            closeMenuBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeMenuBtn.closest('.actions-menu').classList.remove('visible');
            });
        }

        // 编辑按钮事件处理
        const editBtn = li.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // 关闭菜单
                editBtn.closest('.actions-menu').classList.remove('visible');
                
                // 获取 BookmarkManager 实例
                const bookmarkManager = getBookmarkManager();
                if (bookmarkManager) {
                    await bookmarkManager.handleEdit(result);
                }
            });
        }

        // 删除按钮事件处理
        const deleteBtn = li.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // 关闭菜单
                deleteBtn.closest('.actions-menu').classList.remove('visible');
                
                await deleteBookmark(result);
            });
        }

        // 更新国际化文本
        i18n.updateNodeText(li);

        return li;
    };

    // 使用 Promise.all 处理所有结果
    Promise.all(results.map(createResultElement))
        .then(elements => elements.forEach(li => resultsContainer.appendChild(li)));
}

// 删除书签的函数
async function deleteBookmark(bookmark) {
    try {
        // 获取书签管理器实例，以便使用其 alertDialog
        const bookmarkManager = getBookmarkManager();
        if (!bookmarkManager || !bookmarkManager.alertDialog) {
            logger.error('获取 AlertDialog 失败');
            return;
        }

        bookmarkManager.alertDialog.show({
            title: i18n.getMessage('popup_confirm_delete_title'),
            message: i18n.getMessage('msg_confirm_delete_bookmark'),
            primaryText: i18n.getMessage('action_delete_bookmark'),
            secondaryText: i18n.getMessage('ui_button_cancel'),
            onPrimary: async () => {
                await bookmarkOps.deleteBookmark(bookmark);

                await refreshBookmarksInfo();
                updateStatus(i18n.getMessage('popup_bookmark_deleted_success'), false);
            }
        });
    } catch (error) {
        logger.error('删除书签时出错:', error);
        updateStatus(i18n.getMessage('popup_bookmark_delete_failed', [error.message]), true);
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
        
        // 添加 show 类使 toast 显示
        requestAnimationFrame(() => {
            status.classList.add('show');
        });
        
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
            // 首先移除 show 类，触发隐藏动画
            status.classList.remove('show');
            
            // 等待动画完成后再清空内容
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
        }
    }
};

// 更新状态显示的辅助函数
function updateStatus(message, isError = false) {
    const duration = isError ? 3000 : 2000;
    StatusManager.show(message, isError, duration);
}

function onSyncError(errorMessage) {
    updateStatus(i18n.getMessage('popup_sync_failed_with_error', [errorMessage]), true);
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    logger.debug("popup 收到消息", {
        message: message,
        sender: sender,
    });

    // 使用同步函数，避免 Chrome 144+ 将 async 函数视为返回 Promise
    // 对于需要异步操作的部分，使用 async IIFE 处理
    if (message.type === MessageType.UPDATE_TAB_STATE) {
        (async () => {
            const [tab] = await chrome.tabs.query({ 
                active: true, 
                currentWindow: true 
            });
            if (tab) {
                const isSaved = await checkIfPageSaved(tab.url);
                updateSaveButtonState(isSaved);
                await updatePrivacyIconState(tab);
            }
        })();
    } else if (message.type === MessageType.TOGGLE_SEARCH) {
        toggleSearching();
    } else if (message.type === MessageType.BOOKMARKS_UPDATED) {
        refreshBookmarksInfo();
    } else if (message.type === MessageType.SETTINGS_CHANGED) {
        if (window.settingsDialog) {
            window.settingsDialog.loadSettings();
        }
    }
    // 不返回任何值，让其他 listener 处理需要响应的消息
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

    const bookmarkManager = getBookmarkManager()
    if (bookmarkManager && bookmarkManager.editManager) {
        bookmarkManager.editManager.exitEditMode();
    }

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
    
    // 退出搜索结果编辑模式
    const bookmarkManager = getBookmarkManager();
    if (bookmarkManager && bookmarkManager.searchEditManager) {
        bookmarkManager.searchEditManager.exitEditMode();
    }
    
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
        const editTitle = i18n.getMessage('popup_toolbar_button_edit_title');
        saveButton.setAttribute('data-i18n-title', 'popup_toolbar_button_edit_title');
        saveButton.title = `${editTitle} ${quickSaveKey}`;
    } else {
        saveButton.classList.remove('editing');
        const saveTitle = i18n.getMessage('popup_toolbar_button_save_title');
        saveButton.setAttribute('data-i18n-title', 'popup_toolbar_button_save_title');
        saveButton.title = `${saveTitle} ${quickSaveKey}`;
    }
}

// 更新收藏数量显示
async function updateBookmarkCount() {
    try {
        const allBookmarks = await getDisplayedBookmarks();
        const count = Object.keys(allBookmarks).length;
        const bookmarkCount = document.getElementById('bookmark-count');
        bookmarkCount.setAttribute('data-count', count);
        bookmarkCount.setAttribute('data-i18n', 'popup_toolbar_bookmark_count');
        bookmarkCount.textContent = i18n.getMessage('popup_toolbar_bookmark_count');
    } catch (error) {
        logger.error('获取收藏数量失败:', error);
    }
}

// 保存当前渲染器实例的引用
let currentRenderer = null;

/** 按排序字段对书签数组就地排序 */
function sortBookmarks(bookmarks, sortBy) {
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
                if (comparison === 0) comparison = (b.savedAt || 0) - (a.savedAt || 0);
                break;
            case 'lastUsed':
                comparison = (b.lastUsed || 0) - (a.lastUsed || 0);
                if (comparison === 0) comparison = (b.savedAt || 0) - (a.savedAt || 0);
                break;
        }
        return isAsc ? -comparison : comparison;
    });
}

async function renderBookmarksList() {
    logger.debug('renderBookmarksList 开始');
    const bookmarksList = document.getElementById('bookmarks-list');
    if (!bookmarksList) return;

    // 退出编辑模式
    const bookmarkManager = getBookmarkManager();
    if (bookmarkManager && bookmarkManager.editManager) {
        bookmarkManager.editManager.exitEditMode();
    }

    try {
        // 如果当前渲染器存在，则清理
        let rendererState;
        if (currentRenderer) {
            rendererState = currentRenderer.getRendererState();
            currentRenderer.cleanup();
            currentRenderer = null;
        }

        // 显示加载状态
        bookmarksList.innerHTML = `
            <li class="loading-state">
                <div class="loading-spinner"></div>
                <div class="loading-text" data-i18n="popup_status_loading"></div>
            </li>`;
        i18n.updateNodeText(bookmarksList);

        const settings = await SettingsManager.getAll();
        const viewMode = settings.display.viewMode;
        const sortBy = settings.sort.bookmarks;

        let data;
        if (viewMode === 'directory') {
            data = await getBookmarksForDirectoryView();
        } else if (viewMode === 'group') {
            data = Object.values(await getDisplayedBookmarks());
        } else {
            data = await filterManager.getFilteredBookmarks();
        }

        let bookmarks;
        if (viewMode === 'directory') {
            bookmarks = null;
        } else {
            bookmarks = data.map((item) => ({
                ...item,
                savedAt: item.savedAt ? getDateTimestamp(item.savedAt) || 0 : 0,
                useCount: calculateWeightedScore(item.useCount, item.lastUsed),
                lastUsed: item.lastUsed ? getDateTimestamp(item.lastUsed) || 0 : 0
            }));
        }

        // 添加空状态处理
        const isEmpty = viewMode === 'directory'
            ? !data.facets || data.facets.size === 0
            : bookmarks.length === 0;
        if (isEmpty) {
            bookmarksList.innerHTML = `
                <li class="empty-state">
                    <div class="empty-message">
                        <div class="empty-icon">
                            <svg viewBox="0 0 24 24" width="48" height="48">
                                <path fill="currentColor" d="M17,3H7A2,2 0 0,0 5,5V21L12,18L19,21V5A2,2 0 0,0 17,3M12,7A2,2 0 0,1 14,9A2,2 0 0,1 12,11A2,2 0 0,1 10,9A2,2 0 0,1 12,7Z" />
                            </svg>
                        </div>
                        <div class="empty-title" data-i18n="popup_no_bookmarks_yet"></div>
                        <div class="empty-actions">
                            <div class="action-item">
                                <span data-i18n="popup_empty_start_bookmark"></span>
                            </div>
                        </div>
                    </div>
                </li>`;
            i18n.updateNodeText(bookmarksList);
            return;
        }

        if (viewMode !== 'directory') {
            sortBookmarks(bookmarks, sortBy);
        }

        // 根据视图模式选择渲染器
        if (viewMode === 'directory') {
            const tree = buildDirectoryViewTree(data);
            currentRenderer = new DirectoryBookmarkRenderer(bookmarksList, tree);
        } else if (viewMode === 'group') {
            currentRenderer = new GroupedBookmarkRenderer(bookmarksList, bookmarks);
        } else {
            currentRenderer = new BookmarkRenderer(bookmarksList, bookmarks);
        }
        await currentRenderer.initialize(rendererState);
        logger.debug('renderBookmarksList 完成');
    } catch (error) {
        logger.error('渲染书签列表失败:', error);
        // 显示错误状态
        const errorMessage = i18n.getMessage('popup_load_bookmarks_failed', [error.message]);
        bookmarksList.innerHTML = `
            <li class="error-state">
                <div class="error-message">
                    ${errorMessage}
                </div>
            </li>`;
        updateStatus(i18n.getMessage('popup_load_bookmarks_failed', [error.message]), true);
    }
}

async function refreshBookmarksInfo() {
    await Promise.all([
        updateBookmarkCount(),
        updateTabState(),
        updateSearchResults(),
    ]);
    await renderBookmarksList();
}

// 视图模式切换：更新触发按钮显示和下拉选项选中状态
function updateViewModeTriggerDisplay(mode) {
    const trigger = document.getElementById('view-mode-trigger');
    const listIcon = trigger?.querySelector('.view-mode-list-icon');
    const groupIcon = trigger?.querySelector('.view-mode-group-icon');
    const directoryIcon = trigger?.querySelector('.view-mode-directory-icon');
    const options = document.querySelectorAll('.view-mode-option');

    const titleKeys = {
        list: 'popup_view_mode_list_title',
        group: 'popup_view_mode_group_title',
        directory: 'popup_view_mode_directory_title'
    };
    if (trigger) {
        trigger.dataset.mode = mode;
        const titleKey = titleKeys[mode] || titleKeys.list;
        trigger.setAttribute('data-i18n-title', titleKey);
        trigger.title = i18n.getMessage(titleKey);
        if (listIcon) listIcon.style.display = mode === 'list' ? '' : 'none';
        if (groupIcon) groupIcon.style.display = mode === 'group' ? '' : 'none';
        if (directoryIcon) directoryIcon.style.display = mode === 'directory' ? '' : 'none';
    }
    options.forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.mode === mode);
    });
}

/** 列表视图显示全局排序；目录/分组视图隐藏（分组视图使用分组级排序） */
function updateSortContainerVisibility(viewMode) {
    const sortContainer = document.querySelector('.sort-container');
    if (!sortContainer) return;
    if (viewMode === 'list') {
        sortContainer.style.display = '';
    } else {
        sortContainer.style.display = 'none';
        document.getElementById('sort-dropdown')?.classList.remove('show');
    }
}

/** 目录视图下显示操作栏（展开/收起/定位），非目录视图隐藏 */
function updateDirectoryActionsVisibility(viewMode) {
    const container = document.getElementById('directory-actions-container');
    if (!container) return;
    container.style.display = viewMode === 'directory' ? '' : 'none';
}

function updateGroupActionsVisibility(viewMode) {
    const container = document.getElementById('group-actions-container');
    if (!container) return;
    container.style.display = viewMode === 'group' ? '' : 'none';
}

function initializeGroupActions() {
    const manageBtn = document.getElementById('group-manage-btn');
    if (!manageBtn) return;
    manageBtn.title = i18n.getMessage('popup_manage_group');
    manageBtn.addEventListener('click', () => {
        openOptionsPage('filters');
    });
}

function initializeDirectoryActions() {
    const expandBtn = document.getElementById('directory-expand-all');
    const collapseBtn = document.getElementById('directory-collapse-all');
    const locateBtn = document.getElementById('directory-locate-current');
    if (!expandBtn || !collapseBtn || !locateBtn) return;

    expandBtn.title = i18n.getMessage('popup_directory_expand_all');
    collapseBtn.title = i18n.getMessage('popup_directory_collapse_all');
    locateBtn.title = i18n.getMessage('popup_directory_locate_current');

    expandBtn.addEventListener('click', async () => {
        if (currentRenderer?.rendererType !== 'directory') return;
        await currentRenderer.expandAll();
    });
    collapseBtn.addEventListener('click', async () => {
        if (currentRenderer?.rendererType !== 'directory') return;
        await currentRenderer.collapseAll();
    });
    locateBtn.addEventListener('click', async () => {
        const showNotFoundStatus = () => {
            updateStatus(i18n.getMessage('popup_directory_locate_not_in_bookmarks'), false);
        };
        if (currentRenderer?.rendererType !== 'directory') {
            showNotFoundStatus();
            return;
        }
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) return;
        const ok = await currentRenderer.revealBookmarkByUrl(tab.url);
        if (!ok) showNotFoundStatus();
    });
}

// 视图模式切换事件处理（下拉菜单样式，鼠标悬浮显示，点击后隐藏）
async function initializeViewModeSwitch() {
    const container = document.querySelector('.view-mode-container');
    const options = document.querySelectorAll('.view-mode-option');

    // 初始化时设置保存的视图模式
    const savedViewMode = await SettingsManager.get('display.viewMode') || 'directory';
    updateViewModeTriggerDisplay(savedViewMode);
    filterManager.toggleDisplayFilter(savedViewMode === 'list');
    updateSortContainerVisibility(savedViewMode);
    updateDirectoryActionsVisibility(savedViewMode);
    updateGroupActionsVisibility(savedViewMode);

    // 移出容器时移除关闭状态，下次悬浮可再次显示
    container.addEventListener('mouseleave', () => {
        container.classList.remove('dropdown-closed');
    });

    options.forEach(option => {
        option.addEventListener('click', async () => {
            const mode = option.dataset.mode;
            if (option.classList.contains('selected')) return;

            updateViewModeTriggerDisplay(mode);

            // 保存视图模式设置
            await updateSettingsWithSync({
                display: {
                    viewMode: mode
                }
            });
            filterManager.toggleDisplayFilter(mode === 'list');
            updateSortContainerVisibility(mode);
            updateDirectoryActionsVisibility(mode);
            updateGroupActionsVisibility(mode);

            await renderBookmarksList();

            // 点击后隐藏下拉菜单
            container.classList.add('dropdown-closed');
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
        this.rendererType = 'list';
        this.container = container;
        this.allBookmarks = bookmarks;
        this.displayedCount = 0;
        this.initialDisplayedCount = PAGINATION.INITIAL_SIZE;
        this.loading = false;
        this.observer = null;
        this.loadingIndicator = null;
    }

    getRendererState() {
        return {
            rendererType: this.rendererType,
            displayedCount: this.displayedCount
        };
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

    async restoreRendererState(state) {
        if (state.rendererType !== this.rendererType) {
            return;
        }
        this.initialDisplayedCount = state.displayedCount;
    }    

    async initialize(state={}) {
        // 清理之前的实例
        this.cleanup();

        // 恢复渲染器状态
        await this.restoreRendererState(state);

        // 初始化编辑模式
        const bookmarkManager = getBookmarkManager();
        if (bookmarkManager && bookmarkManager.editManager) {
            bookmarkManager.editManager.initialize(this.allBookmarks);
        }

        // 创建加载指示器
        this.loadingIndicator = document.createElement('div');
        this.loadingIndicator.className = 'loading-indicator';
        this.loadingIndicator.innerHTML = `
            <div class="loading-spinner"></div>
            <span>加载更多...</span>
        `;
        this.container.parentNode.appendChild(this.loadingIndicator);

        // 初始渲染
        await this.renderBookmarks(0, this.initialDisplayedCount);

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
        li.dataset.url = bookmark.url;
        if (bookmark._nodeKey) li.dataset.nodeKey = bookmark._nodeKey;

        const editBtn = (bookmark.source === BookmarkSource.EXTENSION || bookmark._presence === 'chrome_only')
            ? `<button class="edit-btn" data-i18n-title="action_edit_bookmark" title="">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M3,17.25V21H6.75L17.81,9.93L14.06,6.18M17.5,3C19.54,3 21.43,4.05 22.39,5.79L20.11,7.29C19.82,6.53 19.19,6 18.5,6A2.5,2.5 0 0,0 16,8.5V11H18V13H16V15H18V17.17L16.83,18H13V16H15V14H13V12H15V10H13V8.83"></path>
                    </svg>
                </button>` 
            : '';
        
        li.innerHTML = `
            <a href="${bookmark.url}" class="bookmark-link" target="_blank">
                <div class="bookmark-info">
                    <div class="bookmark-main">
                        <div class="bookmark-favicon-checkbox-wrap">
                            <div class="bookmark-checkbox">
                                <input type="checkbox" data-i18n-title="popup_select_bookmark" title="">
                            </div>
                            <div class="bookmark-favicon">
                                <img src="${await getFaviconUrl(bookmark.url)}" alt="" loading="lazy">
                            </div>
                        </div>
                        <h3 class="bookmark-title">${bookmark.title}</h3>
                        <div class="bookmark-actions">
                            ${editBtn}
                            <button class="delete-btn" data-i18n-title="action_delete_bookmark" title="">
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                    <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </a>
        `;

        // 更新国际化文本
        i18n.updateNodeText(li);

        // 添加事件监听器
        this.setupBookmarkEvents(li, bookmark);
        
        // 更新书签选择状态
        const bookmarkManager = getBookmarkManager();
        if (bookmarkManager && bookmarkManager.editManager) {
            bookmarkManager.editManager.refreshBookmarkSelection(li);
        }

        return li;
    }

    setupBookmarkEvents(li, bookmark) {
        // 添加书签项的事件处理
        const checkbox = li.querySelector('.bookmark-checkbox input[type="checkbox"]');
        const bookmarkManager = getBookmarkManager();
        const deleteBtn = li.querySelector('.delete-btn');
        const editBtn = li.querySelector('.edit-btn');
        
        // 添加鼠标悬停事件来显示tooltip
        li.addEventListener('mouseenter', (e) => {
            showTooltip(li, bookmark);
        });
        
        // 添加鼠标离开事件来隐藏tooltip
        li.addEventListener('mouseleave', () => {
            hideTooltip();
        });
        
        // 删除按钮事件
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                
                await deleteBookmark(bookmark);
            });
        }

        // 添加编辑按钮事件处理
        if (editBtn) {
            editBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (bookmarkManager) {
                    await bookmarkManager.handleEdit(bookmark);
                }
            });
        }

        // 图标错误处理
        const faviconImg = li.querySelector('.bookmark-favicon img');
        if (faviconImg) {
            faviconImg.addEventListener('error', function() {
                this.src = 'icons/default_favicon.png';
            });
        }
        
        // 修改点击事件处理，处理特殊链接
        const link = li.querySelector('.bookmark-link');
        if (link) {
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
                    // 获取用户的打开方式配置
                    const openInNewTab = await SettingsManager.get('display.openInNewTab');
                    
                    // 如果不是在新标签页打开，修改链接行为
                    if (!openInNewTab) {
                        e.preventDefault();
                        chrome.tabs.update({ url: bookmark.url });
                    }
                    
                    if (bookmark.source === BookmarkSource.EXTENSION) {
                        // 更新使用频率
                        await updateBookmarkUsage(bookmark.url);
                    }
                }
            });
        }
        
        // 勾选框在 link 内，点击时阻止冒泡避免触发跳转
        const checkboxWrap = li.querySelector('.bookmark-checkbox');
        if (checkboxWrap) {
            checkboxWrap.addEventListener('click', (e) => e.stopPropagation());
        }
        // 添加复选框点击事件，进入编辑模式
        if (checkbox) {
            checkbox.addEventListener('change', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // 获取书签管理器实例
                if (bookmarkManager && bookmarkManager.editManager) {
                    const bookmarkItem = e.target.closest('.bookmark-item');
                    
                    // 如果尚未进入编辑模式，则进入编辑模式并选中当前项
                    if (!bookmarkManager.editManager.isInEditMode()) {
                        bookmarkManager.editManager.enterEditMode(bookmarkItem);
                    } else {
                        // 如果已经在编辑模式，则切换当前项的选中状态
                        // 获取shift键状态
                        const isShiftKey = e.shiftKey;
                        bookmarkManager.editManager.toggleBookmarkSelection(bookmarkItem, e.target.checked, isShiftKey);
                    }
                }
            });
        }
        
        // 添加整个书签项点击时可以触发复选框的功能
        li.addEventListener('click', async (e) => {
            // 如果已经在编辑模式，点击书签项时触发复选框点击
            if (bookmarkManager && bookmarkManager.editManager && bookmarkManager.editManager.isInEditMode()) {
                // 如果点击的不是链接、不是按钮、不是复选框，则触发复选框点击
                if (!e.target.closest('a') && !e.target.closest('button') && !e.target.closest('.bookmark-checkbox')) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        // 保存shift键状态
                        const isShiftKey = e.shiftKey;
                        // 创建自定义事件，保留shift键信息
                        const changeEvent = new CustomEvent('change', { 
                            bubbles: true,
                            detail: { shiftKey: isShiftKey }
                        });
                        // 在事件对象上添加shift键状态
                        changeEvent.shiftKey = isShiftKey;
                        checkbox.dispatchEvent(changeEvent);
                    }
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
    constructor(container, bookmarks, state={}) {
        super(container, bookmarks, state);
        this.rendererType = 'grouped';
        this.groups = [];
        this.collapsedStates = new Map(); // 存储每个分组的折叠状态
    }

    getRendererState() {
        return {
            rendererType: this.rendererType,
            collapsedStates: new Map(this.collapsedStates) // 创建新的Map
        };
    }

    async restoreRendererState(state) {
        if (state.rendererType !== this.rendererType) {
            return;
        }
        if (state.collapsedStates && state.collapsedStates instanceof Map) {
            this.collapsedStates = state.collapsedStates;
        } 
    }

    async initialize(state={}) {
        // 清理之前的实例
        this.cleanup();

        // 恢复渲染器状态
        await this.restoreRendererState(state);

        // 从 storage 读取折叠状态
        if (this.collapsedStates.size === 0) {
            const groupCollapsedStates = await LocalStorageMgr.getCustomGroupCollapsedStates();
            this.collapsedStates = new Map(Object.entries(groupCollapsedStates));
        }

        const rules = customFilter.getVisibleRules();
        const settings = await SettingsManager.getAll();
        const globalSortBy = settings.sort.bookmarks;
        this.groupSortSettings = settings.sort.groupSort || {};
        
        for (const rule of rules) {
            const matchedBookmarks = await customFilter.filterBookmarks(this.allBookmarks, rule);
            const sortBy = this.groupSortSettings[rule.id] || globalSortBy;
            sortBookmarks(matchedBookmarks, sortBy);
            this.groups.push({
                name: rule.name,
                rule: rule,
                bookmarks: matchedBookmarks
            });
        }

        // 初始化编辑模式
        const bookmarkManager = getBookmarkManager();
        if (bookmarkManager && bookmarkManager.editManager) {
            const allBookmarksMap = new Map();
            for (const group of this.groups) {
                for (const bookmark of group.bookmarks) {
                    // 使用URL作为键来确保唯一性
                    if (!allBookmarksMap.has(bookmark.url)) {
                        allBookmarksMap.set(bookmark.url, bookmark);
                    }
                }
            }
            const uniqueBookmarks = Array.from(allBookmarksMap.values());
            bookmarkManager.editManager.initialize(uniqueBookmarks);
        }
        
        await this.render();
    }

    // 保存折叠状态到 storage
    async saveCollapsedStates() {
        // 清理失效的分组状态
        const validGroupIds = this.groups.map(group => group.rule.id);
        for (const [groupId] of this.collapsedStates) {
            if (!validGroupIds.includes(groupId)) {
                this.collapsedStates.delete(groupId);
            }
        }
        
        const states = Object.fromEntries(this.collapsedStates);
        await LocalStorageMgr.setCustomGroupCollapsedStates(states);
    }

    async render() {
        this.container.innerHTML = '';
        this._closeSortDropdown();
        
        for (const [index, group] of this.groups.entries()) {
            const groupElement = document.createElement('div');
            groupElement.className = 'bookmarks-group';
            
            const header = document.createElement('div');
            header.className = 'group-header';
            const rule = group.rule;
            const groupColor = rule.color || '';
            const colorStyle = groupColor ? ` style="color:${groupColor}"` : '';
            
            let groupIconHtml = '';
            if (rule.icon) {
                groupIconHtml = IconPicker.getIconSvg(rule.icon, 16, groupColor || null);
            } else if (rule.color) {
                groupIconHtml = IconPicker.getIconSvg(IconPicker.DEFAULT_ICON, 16, groupColor);
            }
            const iconSpan = groupIconHtml ? `<span class="group-icon">${groupIconHtml}</span>` : '';

            const sortTitle = i18n.getMessage('popup_group_sort_title');
            
            header.innerHTML = `
                <svg class="group-toggle collapsed" viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
                </svg>
                <span class="group-title"${colorStyle}>
                    ${iconSpan}
                    ${group.name}
                    <span class="group-count">${group.bookmarks.length}</span>
                </span>
                <button class="group-sort-button" data-group-id="${rule.id}" title="${sortTitle}">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>
                    </svg>
                </button>
            `;
            
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
                const emptyHtml = `<div class="group-empty" data-i18n="popup_group_empty"></div>`;
                content.innerHTML = emptyHtml;
                i18n.updateNodeText(content);
            }

            // 排序按钮事件
            const sortBtn = header.querySelector('.group-sort-button');
            sortBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._showSortDropdown(sortBtn, rule.id, group, content);
            });
            
            // 折叠事件
            header.addEventListener('click', (e) => {
                if (e.target.closest('.group-sort-button')) return;
                const toggle = header.querySelector('.group-toggle');
                const isCollapsed = toggle.classList.toggle('collapsed');
                content.classList.toggle('collapsed');
                this.collapsedStates.set(group.rule.id, isCollapsed);
                this.saveCollapsedStates();
            });

            const isCollapsed = this.collapsedStates.get(group.rule.id);
            if (isCollapsed !== undefined) {
                const toggle = header.querySelector('.group-toggle');
                if (isCollapsed) {
                    toggle.classList.add('collapsed');
                    content.classList.add('collapsed');
                } else {
                    toggle.classList.remove('collapsed');
                    content.classList.remove('collapsed');
                }
            } else if (index === 0) {
                const toggle = header.querySelector('.group-toggle');
                toggle.classList.remove('collapsed');
                content.classList.remove('collapsed');
                this.collapsedStates.set(group.rule.id, false);
                this.saveCollapsedStates();
            }
            
            groupElement.appendChild(header);
            groupElement.appendChild(content);
            this.container.appendChild(groupElement);
        }
    }

    _closeSortDropdown() {
        const existing = document.querySelector('.group-sort-dropdown');
        if (existing) {
            existing._anchorBtn?.classList.remove('active');
            existing.remove();
        }
    }

    _showSortDropdown(anchorBtn, ruleId, group, contentEl) {
        const existing = document.querySelector('.group-sort-dropdown');
        if (existing && existing._anchorBtn === anchorBtn) {
            this._closeSortDropdown();
            return;
        }
        this._closeSortDropdown();

        const currentSort = this.groupSortSettings[ruleId] || 'savedAt_desc';
        const options = [
            { value: 'savedAt_desc', icon: 'icons/sort-saved-desc.svg', i18nKey: 'popup_sort_option_newest' },
            { value: 'savedAt_asc', icon: 'icons/sort-saved-asc.svg', i18nKey: 'popup_sort_option_oldest' },
            { value: 'useCount', icon: 'icons/sort-use-count.svg', i18nKey: 'popup_sort_option_most_used' },
            { value: 'lastUsed', icon: 'icons/sort-latest.svg', i18nKey: 'popup_sort_option_recent_used' },
        ];

        const dropdown = document.createElement('div');
        dropdown.className = 'group-sort-dropdown';
        dropdown._anchorBtn = anchorBtn;

        for (const opt of options) {
            const item = document.createElement('div');
            item.className = 'sort-option';
            if (opt.value === currentSort) item.classList.add('selected');
            item.innerHTML = `<img src="${opt.icon}" class="sort-icon"><span data-i18n="${opt.i18nKey}">${i18n.getMessage(opt.i18nKey)}</span>`;
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                this._closeSortDropdown();
                if (opt.value === currentSort) return;

                this.groupSortSettings[ruleId] = opt.value;
                await updateSettingsWithSync({ sort: { groupSort: { ...this.groupSortSettings } } });

                sortBookmarks(group.bookmarks, opt.value);
                await this._rerenderGroupContent(contentEl, group.bookmarks);
            });
            dropdown.appendChild(item);
        }

        // 定位到按钮下方
        const rect = anchorBtn.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.top = (rect.bottom + 4) + 'px';
        dropdown.style.right = (window.innerWidth - rect.right) + 'px';
        document.body.appendChild(dropdown);
        anchorBtn.classList.add('active');

        const closeOnClick = (e) => {
            if (!dropdown.contains(e.target) && !anchorBtn.contains(e.target)) {
                this._closeSortDropdown();
                document.removeEventListener('click', closeOnClick);
            }
        };
        setTimeout(() => document.addEventListener('click', closeOnClick), 0);
    }

    async _rerenderGroupContent(contentEl, bookmarks) {
        contentEl.innerHTML = '';
        if (bookmarks.length > 0) {
            const bookmarksList = document.createElement('ul');
            bookmarksList.className = 'bookmarks-list';
            for (const bookmark of bookmarks) {
                const el = await this.createBookmarkElement(bookmark);
                bookmarksList.appendChild(el);
            }
            contentEl.appendChild(bookmarksList);
        } else {
            contentEl.innerHTML = `<div class="group-empty" data-i18n="popup_group_empty"></div>`;
            i18n.updateNodeText(contentEl);
        }
    }

    cleanup() {
        this.container.innerHTML = '';
    }
}

/** 未归类文件夹书签数超过此值时默认折叠 */
const UNCATEGORIZED_COLLAPSE_THRESHOLD = 100;

function buildFolderTargetFromDirectoryNode(node) {
    const target = {
        kind: BrowserBookmarkTargetKind.FOLDER,
        nodeId: node?.chromeId || '',
        parentId: node?.parentId || '',
        folderId: node?.chromeId || '',
        placement: BrowserBookmarkPlacement.BOTTOM,
        title: node?.title || '',
        pathIds: Array.isArray(node?.pathIds) ? [...node.pathIds] : [],
        pathTitles: Array.isArray(node?.pathTitles) ? [...node.pathTitles] : []
    };

    if (typeof BrowserBookmarkSelector?.normalizeTarget === 'function') {
        return BrowserBookmarkSelector.normalizeTarget(target);
    }

    return target;
}

class FolderInputDialog {
    constructor(elements = {}) {
        this.dialog = elements.dialog || document.getElementById('folder-input-dialog');
        this.title = elements.title || document.getElementById('folder-input-dialog-title');
        this.input = elements.input || document.getElementById('folder-input-field');
        this.confirm = elements.confirm || document.getElementById('folder-input-confirm-btn');
        this.cancel = elements.cancel || document.getElementById('folder-input-cancel-btn');
        this.content = elements.content || this.dialog?.querySelector?.('.dialog-content') || null;
        this.onSubmit = async () => {};
        this.submitting = false;

        this.handleBackdropClick = this.handleBackdropClick.bind(this);
        this.handleConfirmClick = this.handleConfirmClick.bind(this);
        this.handleCancelClick = this.handleCancelClick.bind(this);
        this.handleInputKeydown = this.handleInputKeydown.bind(this);
        this.handleDocumentKeydown = this.handleDocumentKeydown.bind(this);

        this.bindEvents();
    }

    bindEvents() {
        this.dialog?.addEventListener?.('click', this.handleBackdropClick);
        this.confirm?.addEventListener?.('click', this.handleConfirmClick);
        this.cancel?.addEventListener?.('click', this.handleCancelClick);
        this.input?.addEventListener?.('keydown', this.handleInputKeydown);
        this.content?.addEventListener?.('click', (event) => {
            event.stopPropagation();
        });
        document.addEventListener?.('keydown', this.handleDocumentKeydown, true);
    }

    open({ title = '', confirmText = '', initialValue = '', onSubmit = async () => {} } = {}) {
        this.onSubmit = typeof onSubmit === 'function' ? onSubmit : async () => {};
        this.submitting = false;
        if (this.title) {
            this.title.textContent = title;
        }
        if (this.confirm) {
            this.confirm.textContent = confirmText;
            this.confirm.disabled = false;
        }
        if (this.input) {
            this.input.value = initialValue || '';
        }
        this.dialog?.classList?.add('show');
        this.input?.focus?.();
        this.input?.select?.();
    }

    close() {
        this.dialog?.classList?.remove('show');
        this.submitting = false;
        this.onSubmit = async () => {};
        if (this.confirm) {
            this.confirm.disabled = false;
        }
    }

    isOpen() {
        return Boolean(this.dialog?.classList?.contains('show'));
    }

    handleBackdropClick(event) {
        if (event?.target === this.dialog) {
            this.close();
        }
    }

    handleConfirmClick(event) {
        event?.preventDefault?.();
        void this.submit();
    }

    handleCancelClick(event) {
        event?.preventDefault?.();
        this.close();
    }

    handleInputKeydown(event) {
        if (event?.key !== 'Enter') {
            return;
        }
        event.preventDefault?.();
        event.stopPropagation?.();
        void this.submit();
    }

    handleDocumentKeydown(event) {
        this.handleEscape(event);
    }

    handleEscape(event) {
        if (event?.key !== 'Escape' || !this.isOpen()) {
            return false;
        }

        event.preventDefault?.();
        event.stopPropagation?.();
        event.stopImmediatePropagation?.();
        this.close();
        return true;
    }

    async submit() {
        if (!this.isOpen() || this.submitting) {
            return false;
        }

        const value = this.input?.value?.trim?.() || '';
        if (!value) {
            updateStatus(i18n.getMessage('popup_directory_folder_name_required'), true);
            this.input?.focus?.();
            return false;
        }

        this.submitting = true;
        if (this.confirm) {
            this.confirm.disabled = true;
        }

        try {
            await this.onSubmit(value);
            this.close();
            return true;
        } catch (error) {
            logger.error('目录输入弹窗提交失败:', error);
            this.submitting = false;
            if (this.confirm) {
                this.confirm.disabled = false;
            }
            return false;
        }
    }
}

class DirectoryFolderActionsController {
    constructor({ selector = null, folderDialog = null, alertDialog = null, onRefresh = async () => {} } = {}) {
        this.selector = selector;
        this.folderDialog = folderDialog;
        this.alertDialog = alertDialog;
        this.onRefresh = typeof onRefresh === 'function' ? onRefresh : async () => {};
        this.currentMoveNode = null;
        this.currentMoveAnchor = null;
        this.suppressSelectorChange = false;

        this.wrapSelectorClose();
    }

    wrapSelectorClose() {
        if (!this.selector?.closePopover || this.selector.__directoryFolderActionsWrapped) {
            return;
        }

        const originalClosePopover = this.selector.closePopover.bind(this.selector);
        this.selector.closePopover = (...args) => {
            const result = originalClosePopover(...args);
            this.finishMoveSelection();
            return result;
        };
        this.selector.__directoryFolderActionsWrapped = true;
    }

    setMoveAnchor(anchorElement) {
        this.currentMoveAnchor?.classList?.remove?.('directory-tree-folder-actions-open');
        this.currentMoveAnchor = anchorElement?.closest?.('.directory-tree-folder') || anchorElement || null;
        this.currentMoveAnchor?.classList?.add?.('directory-tree-folder-actions-open');
    }

    finishMoveSelection() {
        this.currentMoveAnchor?.classList?.remove?.('directory-tree-folder-actions-open');
        this.currentMoveAnchor = null;
        this.currentMoveNode = null;
        this.suppressSelectorChange = false;
        this.selector?.clearAnchorElement?.();
    }

    async openCreateDialog(node) {
        if (!node?.chromeId || node?.isVirtual) {
            return;
        }

        this.folderDialog?.open({
            title: i18n.getMessage('popup_directory_folder_create_title'),
            confirmText: i18n.getMessage('popup_directory_folder_create_confirm'),
            initialValue: '',
            onSubmit: async (title) => {
                try {
                    await bookmarkOps.createFolder({
                        parentId: node.chromeId,
                        title
                    });
                    await this.onRefresh();
                    updateStatus(i18n.getMessage('popup_directory_folder_created_success'), false);
                } catch (error) {
                    logger.error('创建目录失败:', error);
                    updateStatus(i18n.getMessage('popup_directory_folder_create_failed', [error.message || '']), true);
                    throw error;
                }
            }
        });
    }

    async openRenameDialog(node) {
        if (!node?.chromeId || node?.isVirtual || node?.isRoot) {
            return;
        }

        this.folderDialog?.open({
            title: i18n.getMessage('popup_directory_folder_rename_title'),
            confirmText: i18n.getMessage('popup_directory_folder_rename_confirm'),
            initialValue: node.title || '',
            onSubmit: async (title) => {
                try {
                    await bookmarkOps.renameFolder(node.chromeId, { title });
                    await this.onRefresh();
                    updateStatus(i18n.getMessage('popup_directory_folder_renamed_success'), false);
                } catch (error) {
                    logger.error('重命名目录失败:', error);
                    updateStatus(i18n.getMessage('popup_directory_folder_rename_failed', [error.message || '']), true);
                    throw error;
                }
            }
        });
    }

    async openMoveSelector(node, anchorElement) {
        if (!this.selector || !node?.chromeId || node?.isVirtual || node?.isRoot) {
            return;
        }

        if (this.currentMoveNode && this.selector.closePopover) {
            this.selector.closePopover();
        }

        this.currentMoveNode = node;
        this.setMoveAnchor(anchorElement);
        this.suppressSelectorChange = true;

        try {
            this.selector.setAnchorElement?.(anchorElement);
            this.selector.setValue?.({
                mode: BrowserBookmarkSaveMode.BROWSER,
                target: buildFolderTargetFromDirectoryNode(node)
            });
            await this.selector.openPopover?.();
        } finally {
            this.suppressSelectorChange = false;
        }
    }

    async handleMoveSelectorChange(value) {
        if (this.suppressSelectorChange || !this.currentMoveNode) {
            return;
        }

        const nextValue = value || this.selector?.getValue?.();
        if (nextValue?.mode !== BrowserBookmarkSaveMode.BROWSER || !nextValue?.target) {
            return;
        }

        if (nextValue.target.nodeId === this.currentMoveNode.chromeId) {
            updateStatus(i18n.getMessage('popup_directory_folder_move_invalid_target'), true);
            return;
        }

        try {
            const { moved } = await bookmarkOps.moveFolder(this.currentMoveNode.chromeId, nextValue.target);
            if (moved) {
                await this.onRefresh();
                updateStatus(i18n.getMessage('popup_directory_folder_moved_success'), false);
            }
        } catch (error) {
            logger.error('移动目录失败:', error);
            updateStatus(i18n.getMessage('popup_directory_folder_move_failed', [error.message || '']), true);
        } finally {
            this.finishMoveSelection();
        }
    }

    async confirmDelete(node) {
        if (!this.alertDialog || !node?.chromeId || node?.isVirtual || node?.isRoot) {
            return;
        }

        this.alertDialog.show({
            title: i18n.getMessage('popup_confirm_delete_title'),
            message: i18n.getMessage('popup_directory_folder_delete_confirm_message', [
                node.title || i18n.getMessage('bookmark_save_target_unnamed_folder')
            ]),
            primaryText: i18n.getMessage('popup_directory_folder_delete_confirm'),
            secondaryText: i18n.getMessage('ui_button_cancel'),
            onPrimary: async () => {
                try {
                    await bookmarkOps.removeFolderTree(node.chromeId);
                    await this.onRefresh();
                    updateStatus(i18n.getMessage('popup_directory_folder_deleted_success'), false);
                } catch (error) {
                    logger.error('删除目录失败:', error);
                    updateStatus(i18n.getMessage('popup_directory_folder_delete_failed', [error.message || '']), true);
                }
            }
        });
    }

    async sortChildren(node, sortMode) {
        if (!node?.chromeId || node?.isVirtual) {
            return;
        }

        try {
            const children = await chrome.bookmarks.getChildren(node.chromeId);
            if (!children || children.length < 2) return;

            const folders = children.filter(c => !c.url);
            const bookmarks = children.filter(c => c.url);

            const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

            const sortByTitle = (a, b) => collator.compare(a.title || '', b.title || '');

            const sortByDateAdded = (a, b) => (a.dateAdded || 0) - (b.dateAdded || 0);

            const getHostname = (url) => {
                try { return new URL(url).hostname; } catch { return url || ''; }
            };

            switch (sortMode) {
                case 'domain':
                    folders.sort(sortByTitle);
                    bookmarks.sort((a, b) => {
                        const cmp = collator.compare(getHostname(a.url), getHostname(b.url));
                        return cmp !== 0 ? cmp : sortByTitle(a, b);
                    });
                    break;
                case 'dateAdded':
                    folders.sort(sortByDateAdded);
                    bookmarks.sort(sortByDateAdded);
                    break;
                case 'name':
                    folders.sort(sortByTitle);
                    bookmarks.sort(sortByTitle);
                    break;
                default:
                    return;
            }

            const sorted = [...folders, ...bookmarks];
            const originalIds = children.map(c => c.id);
            const sortedIds = sorted.map(c => c.id);
            const alreadySorted = sortedIds.every((id, i) => id === originalIds[i]);
            if (alreadySorted) return;

            for (let i = 0; i < sorted.length; i++) {
                await bookmarkOps._proxyMove(sorted[i].id, {
                    parentId: node.chromeId,
                    index: i
                });
            }

            await this.onRefresh();
            updateStatus(i18n.getMessage('popup_directory_folder_sorted_success'), false);
        } catch (error) {
            logger.error('整理目录子项失败:', error);
            updateStatus(i18n.getMessage('popup_directory_folder_sort_failed', [error.message || '']), true);
        }
    }
}

/**
 * 目录视图渲染器
 * 按需加载：折叠时不渲染子节点，展开时再渲染；折叠后仅隐藏不移除
 */
class DirectoryBookmarkRenderer extends BookmarkRenderer {
    constructor(container, tree) {
        super(container, []);
        this.rendererType = 'directory';
        this.tree = tree;
        this.collapsedStates = new Map();
        this.nodeMap = this._buildNodeMap(tree);
        this.allBookmarks = this._flattenBookmarks(tree);
    }

    /** 一次遍历构建 nodeKey -> node 映射，O(1) 查找 */
    _buildNodeMap(nodes, map = new Map()) {
        for (const node of nodes || []) {
            if (node.nodeKey) map.set(node.nodeKey, node);
            if (node.children?.length) this._buildNodeMap(node.children, map);
        }
        return map;
    }

    /** 判断文件夹是否展开（含默认逻辑：无存储时顶层展开、其余折叠，未归类>100 默认折叠） */
    _isFolderExpanded(nodeKey, node, depth) {
        if (this.collapsedStates.has(nodeKey)) {
            return !this.collapsedStates.get(nodeKey);
        }
        if (depth === 0) return true;
        if (node.type === 'virtual-folder' && (node.children?.length || 0) > UNCATEGORIZED_COLLAPSE_THRESHOLD) {
            return false;
        }
        return false;
    }

    _flattenBookmarks(nodes) {
        const list = [];
        for (const node of nodes || []) {
            if (node.type === 'bookmark' && node.facet) {
                list.push(this._nodeToBookmark(node));
            }
            if (node.children?.length) {
                list.push(...this._flattenBookmarks(node.children));
            }
        }
        return list;
    }

    _nodeToBookmark(node) {
        const { facet, chromeId, title } = node;
        const ext = facet.extension;
        const chromeRef = facet.chromeRefs?.find(r => r.chromeId === chromeId) || facet.chromeRefs?.[0];
        const url = facet.url;
        const displayTitle = title || ext?.title || chromeRef?.title || url;
        // chrome_only 默认无标签，不把目录路径作为标签
        const tags = facet.presence === 'chrome_only' ? [] : (ext?.tags || []);
        return {
            url,
            title: displayTitle,
            source: ext ? BookmarkSource.EXTENSION : BookmarkSource.CHROME,
            tags,
            excerpt: ext?.excerpt || '',
            chromeId,
            savedAt: ext?.savedAt && chromeRef?.dateAdded ? Math.min(ext.savedAt, chromeRef.dateAdded) : (ext?.savedAt ?? chromeRef?.dateAdded),
            useCount: ext?.useCount || 0,
            lastUsed: ext?.lastUsed && chromeRef?.dateLastUsed ? Math.max(ext.lastUsed, chromeRef.dateLastUsed) : (ext?.lastUsed ?? chromeRef?.dateLastUsed),
            _nodeKey: node.nodeKey,
            _facet: facet,
            _presence: facet.presence
        };
    }

    getFolderActionState(node) {
        if (!node || node.isVirtual || node.type === 'virtual-folder') {
            return {
                canCreate: false,
                canRename: false,
                canMove: false,
                canDelete: false,
                canSort: false,
                hasActions: false
            };
        }

        const canCreate = node.type === 'folder';
        const canManage = canCreate && !node.isRoot;
        const canSort = canCreate && (node.children || []).length > 1;
        return {
            canCreate,
            canRename: canManage,
            canMove: canManage,
            canDelete: canManage,
            canSort,
            hasActions: canCreate || canManage || canSort
        };
    }

    renderFolderActions(actionState) {
        if (!actionState?.hasActions) {
            return '';
        }

        const iconSize = 16;
        const menuItems = [];

        if (actionState.canCreate) {
            menuItems.push(`
                <div class="directory-folder-menu-item" data-folder-action="create">
                    ${IconPicker.getIconSvg('FolderPlus', iconSize)}
                    <span data-i18n="popup_directory_folder_create_title"></span>
                </div>`);
        }
        if (actionState.canRename) {
            menuItems.push(`
                <div class="directory-folder-menu-item" data-folder-action="rename">
                    ${IconPicker.getIconSvg('Pencil', iconSize)}
                    <span data-i18n="popup_directory_folder_rename_title"></span>
                </div>`);
        }
        if (actionState.canMove) {
            menuItems.push(`
                <div class="directory-folder-menu-item" data-folder-action="move">
                    ${IconPicker.getIconSvg('FolderInput', iconSize)}
                    <span data-i18n="popup_directory_folder_move_title"></span>
                </div>`);
        }
        if (actionState.canSort) {
            menuItems.push(`
                <div class="directory-folder-menu-item directory-folder-menu-item-has-sub" data-folder-action="sort">
                    ${IconPicker.getIconSvg('ArrowUpDown', iconSize)}
                    <span data-i18n="popup_directory_folder_sort_title"></span>
                    ${IconPicker.getIconSvg('ChevronRight', 14)}
                    <div class="directory-folder-submenu">
                        <div class="directory-folder-submenu-item" data-sort-mode="name">
                            <span data-i18n="popup_directory_folder_sort_by_name"></span>
                        </div>
                        <div class="directory-folder-submenu-item" data-sort-mode="dateAdded">
                            <span data-i18n="popup_directory_folder_sort_by_date"></span>
                        </div>
                        <div class="directory-folder-submenu-item" data-sort-mode="domain">
                            <span data-i18n="popup_directory_folder_sort_by_domain"></span>
                        </div>
                    </div>
                </div>`);
        }
        if (actionState.canDelete) {
            menuItems.push(`
                <div class="directory-folder-menu-item directory-folder-menu-item-danger" data-folder-action="delete">
                    ${IconPicker.getIconSvg('Trash2', iconSize)}
                    <span data-i18n="popup_directory_folder_delete_title"></span>
                </div>`);
        }

        return `
            <div class="directory-tree-row-actions">
                <button type="button" class="directory-folder-more-btn" aria-label="More actions">
                    ${IconPicker.getIconSvg('EllipsisVertical', 18)}
                </button>
                <div class="directory-folder-menu">
                    ${menuItems.join('')}
                </div>
            </div>
        `;
    }

    setupFolderActionEvents(row, node) {
        const controller = getBookmarkManager()?.directoryFolderActionsController;
        if (!controller) {
            return;
        }

        const moreBtn = row.querySelector('.directory-folder-more-btn');
        const menu = row.querySelector('.directory-folder-menu');
        if (!moreBtn || !menu) return;

        const folderRow = row.closest('.directory-tree-folder') || row;

        const closeMenu = () => {
            menu.classList.remove('visible');
            folderRow.classList.remove('directory-tree-folder-actions-open');
        };

        const positionMenu = () => {
            const btnRect = moreBtn.getBoundingClientRect();
            const menuHeight = menu.offsetHeight || 160;
            const spaceBelow = window.innerHeight - btnRect.bottom;
            menu.classList.toggle('directory-folder-menu-upward', spaceBelow < menuHeight + 8);
        };

        moreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // 关闭其他已打开的目录菜单
            document.querySelectorAll('.directory-folder-menu.visible').forEach(m => {
                if (m !== menu) {
                    m.classList.remove('visible');
                    m.closest('.directory-tree-folder')?.classList.remove('directory-tree-folder-actions-open');
                }
            });

            const willOpen = !menu.classList.contains('visible');
            if (willOpen) {
                menu.classList.add('visible');
                folderRow.classList.add('directory-tree-folder-actions-open');
                positionMenu();
            } else {
                closeMenu();
            }
        });

        menu.querySelectorAll('[data-folder-action]').forEach((item) => {
            if (item.dataset.folderAction === 'sort') return;
            item.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const action = item.dataset.folderAction;
                closeMenu();

                if (action === 'create') {
                    await controller.openCreateDialog(node);
                } else if (action === 'rename') {
                    await controller.openRenameDialog(node);
                } else if (action === 'move') {
                    await controller.openMoveSelector(node, row);
                } else if (action === 'delete') {
                    await controller.confirmDelete(node);
                }
            });
        });

        // 排序子菜单：定位 + 点击事件
        const sortItem = menu.querySelector('[data-folder-action="sort"]');
        if (sortItem) {
            const submenu = sortItem.querySelector('.directory-folder-submenu');
            if (submenu) {
                sortItem.addEventListener('mouseenter', () => {
                    const rect = sortItem.getBoundingClientRect();
                    const submenuWidth = submenu.offsetWidth || 140;
                    const spaceRight = window.innerWidth - rect.right;
                    submenu.classList.toggle('directory-folder-submenu-left', spaceRight < submenuWidth + 8);
                });

                submenu.querySelectorAll('[data-sort-mode]').forEach(sub => {
                    sub.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        closeMenu();
                        await controller.sortChildren(node, sub.dataset.sortMode);
                    });
                });
            }
        }

        // 点击外部关闭
        document.addEventListener('click', (e) => {
            if (menu.classList.contains('visible') && !moreBtn.contains(e.target) && !menu.contains(e.target)) {
                closeMenu();
            }
        });

        // Escape 关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && menu.classList.contains('visible')) {
                closeMenu();
            }
        });
    }

    getRendererState() {
        return {
            rendererType: this.rendererType,
            collapsedStates: new Map(this.collapsedStates)
        };
    }

    async restoreRendererState(state) {
        if (state?.rendererType !== this.rendererType) return;
        if (state.collapsedStates instanceof Map) {
            this.collapsedStates = state.collapsedStates;
        }
    }

    async initialize(state = {}) {
        this.cleanup();
        await this.restoreRendererState(state);
        if (this.collapsedStates.size === 0) {
            const stored = await LocalStorageMgr.getDirectoryFolderCollapsedStates();
            this.collapsedStates = new Map(Object.entries(stored || {}));
        }
        const bookmarkManager = getBookmarkManager();
        if (bookmarkManager?.editManager) {
            bookmarkManager.editManager.initialize(this.allBookmarks);
        }
        await this.render();
    }

    async saveCollapsedStates() {
        // 仅保存当前树中存在的文件夹节点状态，避免无效 state 占用存储
        const validFolderKeys = new Set();
        for (const [nodeKey, node] of this.nodeMap) {
            if ((node?.type === 'folder' || node?.type === 'virtual-folder') && nodeKey) {
                validFolderKeys.add(nodeKey);
            }
        }
        const states = {};
        for (const [key, value] of this.collapsedStates) {
            if (validFolderKeys.has(key) && typeof value === 'boolean') {
                states[key] = value;
            }
        }
        await LocalStorageMgr.setDirectoryFolderCollapsedStates(states);
    }

    /** 展开所有目录 */
    async expandAll() {
        for (const [nodeKey, node] of this.nodeMap) {
            if ((node?.type === 'folder' || node?.type === 'virtual-folder') && nodeKey) {
                this.collapsedStates.set(nodeKey, false);
            }
        }
        await this.saveCollapsedStates();
        await this.render();
    }

    /** 收起所有目录 */
    async collapseAll() {
        for (const [nodeKey, node] of this.nodeMap) {
            if ((node?.type === 'folder' || node?.type === 'virtual-folder') && nodeKey) {
                this.collapsedStates.set(nodeKey, true);
            }
        }
        await this.saveCollapsedStates();
        await this.render();
    }

    /**
     * 在树中查找与 tabUrl 匹配的书签，返回从根到其父文件夹的 nodeKey 链（不含书签自身）
     */
    _findFolderKeysOnPathToUrl(nodes, targetUrl, ancestorKeys = []) {
        for (const node of nodes || []) {
            if (node.type === 'bookmark' && node.facet?.url) {
                if (node.facet.url === targetUrl) {
                    return [...ancestorKeys];
                }
            }
            if ((node.type === 'folder' || node.type === 'virtual-folder') && node.children?.length) {
                const found = this._findFolderKeysOnPathToUrl(
                    node.children,
                    targetUrl,
                    [...ancestorKeys, node.nodeKey]
                );
                if (found !== null) return found;
            }
        }
        return null;
    }

    /**
     * 仅展开通往目标书签路径上的文件夹，渲染后滚动并高亮。未找到返回 false
     */
    async revealBookmarkByUrl(tabUrl) {
        const folderKeys = this._findFolderKeysOnPathToUrl(this.tree, tabUrl);
        if (!folderKeys) return false;
        for (const key of folderKeys) {
            this.collapsedStates.set(key, false);
        }
        await this.saveCollapsedStates();
        await this.render();
        const list = this.container;
        const row = [...list.querySelectorAll('.directory-tree-bookmark')].find(
            (li) => li.dataset.url === tabUrl
        );
        if (row) {
            const scrollParent = row.closest('.bookmarks-container');
            if (scrollParent) {
                const top =
                    row.getBoundingClientRect().top -
                    scrollParent.getBoundingClientRect().top +
                    scrollParent.scrollTop;
                scrollParent.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
            } else {
                row.scrollIntoView({ block: 'start', behavior: 'smooth' });
            }
            row.classList.add('directory-locate-highlight');
            setTimeout(() => row.classList.remove('directory-locate-highlight'), 2000);
        }
        return true;
    }

    async render() {
        this.container.innerHTML = '';
        this.container.classList.add('directory-tree-view');
        const uncategorizedTitle = i18n.getMessage('popup_directory_uncategorized') || '插件书签';
        const fragment = document.createDocumentFragment();
        for (const node of this.tree || []) {
            await this._renderTreeRows(node, uncategorizedTitle, 0, fragment, true);
        }
        this.container.appendChild(fragment);
    }

    /**
     * 按需渲染：仅当父级展开时渲染子节点
     * @param {boolean} parentExpanded - 父级是否展开
     */
    async _renderTreeRows(node, uncategorizedTitle, depth, fragment, parentExpanded) {
        if (node.type === 'folder' || node.type === 'virtual-folder') {
            const title = node.type === 'virtual-folder' ? uncategorizedTitle : node.title;
            const isExpanded = this._isFolderExpanded(node.nodeKey, node, depth);
            const hasChildren = (node.children || []).length > 0;
            const actionState = this.getFolderActionState(node);
            const row = document.createElement('li');
            row.className = 'directory-tree-row directory-tree-folder' + (node.type === 'virtual-folder' ? ' directory-tree-folder-extension' : '');
            row.dataset.nodeKey = node.nodeKey;
            row.dataset.chromeId = node.chromeId || '';
            row.dataset.depth = depth;
            row.style.setProperty('--tree-depth', depth);
            const toggleSvg = hasChildren
                ? `<svg class="directory-tree-toggle" viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
                   </svg>`
                : `<span class="directory-tree-toggle directory-tree-toggle-empty"></span>`;
            row.innerHTML = `
                <div class="directory-tree-row-inner">
                    <div class="directory-tree-row-main">
                        ${toggleSvg}
                        <span class="directory-tree-icon directory-tree-icon-folder">
                            <svg viewBox="0 0 24 24" width="18" height="18">
                                <path fill="currentColor" d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/>
                            </svg>
                        </span>
                        <span class="directory-tree-label">${title}</span>
                    </div>
                    ${this.renderFolderActions(actionState)}
                </div>
            `;
            i18n.updateNodeText(row);
            this.setupFolderActionEvents(row, node);
            const toggle = row.querySelector('.directory-tree-toggle');
            if (toggle && hasChildren) {
                if (!isExpanded) toggle.classList.add('collapsed');
                row.addEventListener('click', (e) => {
                    if (!e.target.closest('a') && !e.target.closest('.directory-tree-row-actions')) {
                        this._handleFolderToggle(row, node, uncategorizedTitle, toggle);
                    }
                });
            }
            fragment.appendChild(row);
            if (hasChildren && isExpanded) {
                for (const child of node.children) {
                    await this._renderTreeRows(child, uncategorizedTitle, depth + 1, fragment, true);
                }
                row.dataset.childrenRendered = 'true';
            }
        } else if (node.type === 'bookmark' && node.facet && parentExpanded) {
            const bookmark = this._nodeToBookmark(node);
            const li = await this.createBookmarkElement(bookmark);
            li.classList.add('directory-tree-row', 'directory-tree-bookmark');
            li.dataset.depth = depth;
            li.style.setProperty('--tree-depth', depth);
            const treePrefix = document.createElement('div');
            treePrefix.className = 'directory-tree-bookmark-prefix';
            treePrefix.innerHTML = '<span class="directory-tree-spacer"></span>';
            li.insertBefore(treePrefix, li.firstChild);
            fragment.appendChild(li);
        }
    }

    async _handleFolderToggle(folderRow, node, uncategorizedTitle, toggle) {
        const nodeKey = node.nodeKey;
        const collapsed = toggle.classList.toggle('collapsed');
        this.collapsedStates.set(nodeKey, collapsed);
        this.saveCollapsedStates();
        if (collapsed) {
            this._setChildrenVisibility(folderRow, true);
        } else {
            const childrenRendered = folderRow.dataset.childrenRendered === 'true';
            if (childrenRendered) {
                this._setChildrenVisibility(folderRow, false);
            } else {
                await this._renderAndInsertChildren(folderRow, node, uncategorizedTitle);
            }
        }
    }

    /** 设置子节点 visibility（隐藏/显示），展开时跳过内层已折叠子文件夹的后代 */
    _setChildrenVisibility(folderRow, hidden) {
        const folderDepth = parseInt(folderRow.dataset.depth || '0', 10);
        let skipUntilDepth = -1;
        let next = folderRow.nextElementSibling;
        while (next && next.classList.contains('directory-tree-row')) {
            const depth = parseInt(next.dataset.depth || '0', 10);
            if (depth <= folderDepth) break;
            if (!hidden && skipUntilDepth >= 0) {
                if (depth > skipUntilDepth) {
                    next = next.nextElementSibling;
                    continue;
                }
                skipUntilDepth = -1;
            }
            next.classList.toggle('directory-tree-hidden', hidden);
            if (!hidden && next.classList.contains('directory-tree-folder')) {
                const toggle = next.querySelector('.directory-tree-toggle');
                if (toggle?.classList.contains('collapsed')) {
                    skipUntilDepth = depth;
                }
            }
            next = next.nextElementSibling;
        }
    }

    /** 渲染并插入子节点（首次展开时调用） */
    async _renderAndInsertChildren(folderRow, node, uncategorizedTitle) {
        const depth = parseInt(folderRow.dataset.depth || '0', 10) + 1;
        const fragment = document.createDocumentFragment();
        for (const child of node.children || []) {
            await this._renderTreeRows(child, uncategorizedTitle, depth, fragment, true);
        }
        let insertBeforeRef = folderRow.nextSibling;
        while (fragment.firstChild) {
            const child = fragment.firstChild;
            folderRow.parentNode.insertBefore(child, insertBeforeRef);
            insertBeforeRef = child.nextSibling;
        }
        folderRow.dataset.childrenRendered = 'true';
    }

    cleanup() {
        this.container.innerHTML = '';
        this.container.classList.remove('directory-tree-view');
    }
}

class SettingsDialog {
    constructor() {
        this.dialog = document.getElementById('settings-dialog');
        this.elements = {
            openBtn: document.getElementById('open-settings'),
            closeBtn: this.dialog.querySelector('.close-dialog-btn'),
            autoFocusSearch: document.getElementById('auto-focus-search'),
            openInNewTab: document.getElementById('open-in-new-tab'), // 添加新元素引用
            themeOptions: document.querySelectorAll('.theme-option-popup'),
            aiTargetLanguage: document.getElementById('popup-ai-target-language'),
            autoPrivacySwitch: document.getElementById('auto-privacy-mode'),
            manualPrivacySwitch: document.getElementById('manual-privacy-mode'),
            manualPrivacyContainer: document.getElementById('manual-privacy-container'),
            shortcutsBtn: document.getElementById('keyboard-shortcuts'),
            openSettingsPageBtn: document.getElementById('open-settings-page'),
            donateButton: document.getElementById('donate-button'),
            feedbackBtn: document.getElementById('feedback-button'),
            storeReviewButton: document.getElementById('store-review-button'),
            showUpdateLogBtn: document.getElementById('show-update-log'),
            closeUpdateNotification: document.getElementById('close-update-notification'),
            viewAllUpdatesLink: document.getElementById('view-all-updates'),
            modelSelectorContainer: document.getElementById('popup-model-selector'),
            chatServiceSelect: document.getElementById('popup-chat-service-select'),
            embeddingServiceSelect: document.getElementById('popup-embedding-service-select'),
        };
    }

    async initialize() {
        // 绑定基本事件
        this.setupEventListeners();
        // 初始化AI语言设置
        this.initializeAILanguageSettings();
        // 初始化服务选择器
        await this.initializeServiceSelector();
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
            this.handleDialogEscape(e);
        }, true);

        // 设置变更事件
        this.elements.autoFocusSearch.addEventListener('change', async (e) =>
            await this.handleSettingChange('display.autoFocusSearch', e.target.checked));
            
        // 添加打开方式设置的事件监听器
        this.elements.openInNewTab.addEventListener('change', async (e) =>
            await this.handleSettingChange('display.openInNewTab', e.target.checked));

        // 主题切换事件
        this.elements.themeOptions.forEach(option => {
            option.addEventListener('click', async () => {
                const theme = option.dataset.theme;
                await this.handleThemeChange(theme);
            });
        });

        // 目标语言变更事件
        if (this.elements.aiTargetLanguage) {
            this.elements.aiTargetLanguage.addEventListener('change', async (e) => {
                const newLanguage = e.target.value;
                try {
                    await this.handleSettingChange('ai.targetLanguage', newLanguage);
                    updateStatus(i18n.getMessage('popup_settings_target_language_updated'), false);
                } catch (error) {
                    logger.error('更新目标语言设置失败:', error);
                    updateStatus(i18n.getMessage('popup_settings_target_language_update_failed'), true);
                }
            });
        }

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
            chrome.tabs.create({ url: getExtensionStoreReviewUrl() });
            this.close();
        });

        // 添加捐赠按钮点击事件
        this.elements.donateButton.addEventListener('click', () => {
            chrome.tabs.create({
                url: getSupportPageUrl('donate')
            });
            this.close();
        });

        // 添加查看更新日志按钮点击事件
        this.elements.showUpdateLogBtn.addEventListener('click', () => {
            // 获取当前版本
            const manifest = chrome.runtime.getManifest();
            const currentVersion = manifest.version;
            showUpdateNotification(currentVersion);
            this.close();
        });

         
        // 绑定关闭按钮事件
        this.elements.closeUpdateNotification.addEventListener('click', async () => {
            const container = document.getElementById('update-notification');
            container.classList.remove('show');
        });
        
        // 绑定查看所有更新链接事件
        this.elements.viewAllUpdatesLink.addEventListener('click', (e) => {
            e.preventDefault();
            // 打开更新日志页面
            chrome.tabs.create({ url: getSupportPageUrl('changelog') });
        });

        // 添加点击背景关闭功能
        const overlay = document.querySelector('.update-overlay');
        if (overlay) {
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) {
                    const container = document.getElementById('update-notification');
                    container.classList.remove('show');
                }
            });
        }

        // 隐私设置链接点击
        const privacySettingsLink = document.getElementById('privacy-settings-link');
        if (privacySettingsLink) {
            privacySettingsLink.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openOptionsPage('privacy');
            });
        }
    }

    async initializeServiceSelector() {
        if (!this.elements.chatServiceSelect || !this.elements.embeddingServiceSelect) return;

        this.elements.chatServiceSelect.addEventListener('change', async (e) => {
            const result = await ConfigManager.setServiceType('chat', e.target.value);
            if (!result) await this.refreshServiceSelector();
        });

        this.elements.embeddingServiceSelect.addEventListener('change', async (e) => {
            const result = await ConfigManager.setServiceType('embedding', e.target.value);
            if (!result) await this.refreshServiceSelector();
        });

        await this.refreshServiceSelector();
    }

    async refreshServiceSelector() {
        if (!this.elements.chatServiceSelect || !this.elements.embeddingServiceSelect) return;

        const chatServices = [];
        const embeddingServices = [];

        for (const service of Object.values(API_SERVICES)) {
            const fullService = await ConfigManager.findServiceById(service.id);
            if (!fullService?.apiKey) continue;
            const svc = { id: fullService.id, name: fullService.name };
            if (fullService.chatModel) chatServices.push(svc);
            if (fullService.embedModel) embeddingServices.push(svc);
        }

        const customServices = await ConfigManager.getCustomServices();
        for (const service of Object.values(customServices)) {
            if (!service.apiKey) continue;
            const svc = { id: service.id, name: service.name };
            if (service.chatModel) chatServices.push(svc);
            if (service.embedModel) embeddingServices.push(svc);
        }

        if (chatServices.length === 0 && embeddingServices.length === 0) {
            this.elements.modelSelectorContainer.style.display = 'none';
            return;
        }

        this.elements.modelSelectorContainer.style.display = '';

        const chatService = await ConfigManager.getChatService();
        const embeddingService = await ConfigManager.getEmbeddingService();

        this.elements.chatServiceSelect.innerHTML = '';
        this.elements.embeddingServiceSelect.innerHTML = '';

        const notConfiguredLabel = i18n.getMessage('settings_services_not_configured');
        this._appendServiceOptions(
            this.elements.chatServiceSelect, chatServices, chatService, notConfiguredLabel
        );
        this._appendServiceOptions(
            this.elements.embeddingServiceSelect, embeddingServices, embeddingService, notConfiguredLabel
        );
    }

    _appendServiceOptions(selectEl, services, activeService, notConfiguredLabel) {
        const isActiveInList = services.some(svc => svc.id === activeService.id);
        if (!isActiveInList) {
            const opt = document.createElement('option');
            opt.value = activeService.id;
            opt.textContent = `${activeService.name}(${notConfiguredLabel})`;
            opt.selected = true;
            opt.disabled = true;
            selectEl.appendChild(opt);
        }
        for (const svc of services) {
            const opt = document.createElement('option');
            opt.value = svc.id;
            opt.textContent = svc.name;
            opt.selected = svc.id === activeService.id;
            selectEl.appendChild(opt);
        }
    }

    async loadSettings() {
        try {
            const settings = await SettingsManager.getAll();
            const {
                display: { 
                    autoFocusSearch, 
                    openInNewTab,
                    theme: themeSettings,
                } = {},
                privacy: { 
                    autoDetect: autoPrivacyMode, 
                    enabled: manualPrivacyMode 
                } = {},
                ai: {
                    targetLanguage
                } = {}
            } = settings;

            // 初始化开关状态
            this.elements.autoFocusSearch.checked = autoFocusSearch;
            this.elements.openInNewTab.checked = openInNewTab;
            this.elements.autoPrivacySwitch.checked = autoPrivacyMode;
            this.elements.manualPrivacySwitch.checked = manualPrivacyMode;
            this.elements.manualPrivacyContainer.classList.toggle('show', !autoPrivacyMode);

            // 初始化主题选择器
            const currentTheme = themeSettings?.mode || 'system';
            this.updateThemeUI(currentTheme);

            // 初始化目标语言设置
            const currentTargetLanguage = targetLanguage || AI_DEFAULT_TARGET_LANGUAGE;
            if (this.elements.aiTargetLanguage) {
                this.elements.aiTargetLanguage.value = currentTargetLanguage;
            }

            // 刷新服务选择器（可能在设置页面新增了服务配置）
            await this.refreshServiceSelector();

        } catch (error) {
            logger.error('加载设置失败:', error);
            updateStatus(i18n.getMessage('popup_settings_load_failed'), true);
        }
    }

    hideSettings() {
        const autoFocusSearchContainer = document.getElementById('auto-focus-search-container');
        if (autoFocusSearchContainer) {
            autoFocusSearchContainer.classList.add('hide');
        }
        this.elements.feedbackBtn.style.display = 'none';
        this.elements.showUpdateLogBtn.style.display = 'none';
    }

    async handleSettingChange(settingPath, value, additionalAction = null) {
        try {
            const updateObj = settingPath.split('.').reduceRight(
                (acc, key) => ({ [key]: acc }), 
                value
            );
            await updateSettingsWithSync(updateObj);
            
            if (additionalAction) {
                await additionalAction();
            }
        } catch (error) {
            logger.error(`更新设置失败 (${settingPath}):`, error);
            updateStatus(i18n.getMessage('popup_settings_update_failed'), true);
        }
    }

    open() {
        this.dialog.classList.add('show');
    }

    handleDialogEscape(event) {
        if (window.bookmarkManagerInstance?.browserBookmarkSelector?.consumeEscapeKey?.(event)) {
            return true;
        }

        if (event.key !== 'Escape' || !this.dialog.classList.contains('show')) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.close();
        return true;
    }

    close() {
        this.dialog.classList.remove('show');
    }

    /**
     * 更新主题UI状态
     * @param {string} theme - 主题模式：'light' | 'dark' | 'system'
     */
    updateThemeUI(theme) {
        this.elements.themeOptions.forEach(option => {
            if (option.dataset.theme === theme) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });
    }

    /**
     * 处理主题切换
     * @param {string} theme - 主题模式：'light' | 'dark' | 'system'
     */
    async handleThemeChange(theme) {
        try {
            await themeManager.updateTheme({
                mode: theme
            });
            this.updateThemeUI(theme);
            // 主题切换后立即生效，不需要额外操作，themeManager 会自动应用
        } catch (error) {
            logger.error('更新主题失败:', error);
            updateStatus(i18n.getMessage('popup_settings_theme_update_failed'), true);
        }
    }

    /**
     * 初始化AI目标语言设置
     */
    initializeAILanguageSettings() {
        const targetLanguageSelect = this.elements.aiTargetLanguage;
        if (!targetLanguageSelect) return;

        // 动态生成语言选项，使用对应语言本身来显示
        targetLanguageSelect.innerHTML = '';
        for (const [code, name] of Object.entries(AI_SUPPORTED_LANGUAGES)) {
            const option = document.createElement('option');
            option.value = code;
            // 使用对应语言本身来显示，如果AI_LANGUAGE_DISPLAY_NAMES中没有则使用原来的名称
            option.textContent = AI_LANGUAGE_DISPLAY_NAMES[code] || name;
            targetLanguageSelect.appendChild(option);
        }
    }
}

class AlertDialog {
    constructor() {
        this.dialog = document.getElementById('alert-dialog');
        this.title = this.dialog.querySelector('.alert-title');
        this.message = this.dialog.querySelector('.alert-message');
        this.extraContainer = this.dialog.querySelector('.alert-extra');
        this.buttonsLeftContainer = this.dialog.querySelector('.alert-buttons-left');
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
        customContent = null,
        onPrimary = () => {},
        onSecondary = () => {},
    }) {
        if (this.dialog.classList.contains('show')) {
            this.hide();
        }

        this.title.textContent = title;
        this.message.textContent = message;
        this.message.style.display = message ? 'block' : 'none';
        // customContent 渲染到按钮行左侧（方案一布局）
        const left = this.buttonsLeftContainer || this.dialog?.querySelector('.alert-buttons-left');
        if (left) {
            left.innerHTML = '';
            if (customContent) {
                if (typeof customContent === 'string') {
                    left.innerHTML = customContent;
                } else if (customContent instanceof Node) {
                    left.appendChild(customContent);
                }
                i18n.updateNodeText(left);
            }
        }
        // 清空 alert-extra，当前仅使用按钮行左侧
        if (this.extraContainer) {
            this.extraContainer.innerHTML = '';
        }
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
        if (this.extraContainer) this.extraContainer.innerHTML = '';
        if (this.buttonsLeftContainer) this.buttonsLeftContainer.innerHTML = '';
        this.onPrimary = () => {};
        this.onSecondary = () => {};
    }
}

async function handleSearch() {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const query = searchInput.value.trim();
    
    if (!query) {
        searchResults.innerHTML = '';
        return;
    }

    const bookmarkManager = getBookmarkManager();
    if (bookmarkManager) {
        bookmarkManager.searchEditManager.exitEditMode();
    }

    try {
        // 显示加载状态
        searchResults.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <div class="loading-text" data-i18n="popup_status_searching"></div>
            </div>
        `;
        i18n.updateNodeText(searchResults);

        const results = await searchBookmarksFromBackground(query, {
            debounce: false,
            includeUrl: true
        });
        displaySearchResults(results, query);
    } catch (error) {
        logger.error('搜索失败:', error);
        StatusManager.endOperation(i18n.getMessage('popup_search_failed', [error.message]), true);
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
        history = history.filter(item => {
            // 同时匹配原文和拼音
            return item.query.toLowerCase().includes(query) || 
                    PinyinMatch.match(item.query, query);
        });
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
            <svg class="delete-history-btn" viewBox="0 0 24 24" title="删除此搜索记录">
                <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"></path>
            </svg>
        </div>
    `).join('');
    
    // 添加删除按钮点击事件
    wrapper.querySelectorAll('.delete-history-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation(); // 阻止冒泡，防止触发搜索项点击事件
            const item = e.target.closest('.recent-search-item');
            const itemQuery = item.dataset.query;
            
            // 删除此搜索历史
            await searchManager.searchHistoryManager.removeSearch(itemQuery);
            
            // 重新渲染搜索历史
            renderSearchHistory(query);
        });
    });
    
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
        const sortTitle = i18n.getMessage('popup_sort_current', [text]);
        sortButton.setAttribute('data-i18n-title', 'popup_sort_current');
        sortButton.title = sortTitle;
        
        // 添加排序指示器
        const indicator = document.createElement('div');
        indicator.className = 'sort-indicator';
        indicator.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="currentColor" d="M7 10l5 5 5-5H7z"/>
            </svg>
        `;
        sortButton.appendChild(indicator);

        // 更新所有选项的选中状态
        sortOptions.forEach(option => {
            option.classList.remove('selected');
        });
        selectedOption.classList.add('selected');
    }

    // 点击按钮显示/隐藏下拉菜单
    sortButton.addEventListener('click', () => {
        sortDropdown.classList.toggle('show');
    });

    // 点击选项时更新排序
    sortOptions.forEach(option => {
        option.addEventListener('click', async () => {
            const value = option.dataset.value;
            
            // 更新按钮显示
            updateSortButton(option);
            
            // 保存设置并刷新列表
            await updateSettingsWithSync({
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

    const searchTitle = i18n.getMessage('popup_toolbar_button_search_title');
    const searchPlaceholder = i18n.getMessage('popup_search_input_placeholder');
    toggleSearch.setAttribute('data-i18n-title', 'popup_toolbar_button_search_title');
    toggleSearch.title = `${searchTitle} ${quickSearchKey}`;
    searchInput.setAttribute('data-i18n', 'popup_search_input_placeholder');
    searchInput.placeholder = `${searchPlaceholder} ${quickSearchKey}`;
    
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
        const bookmarkManager = getBookmarkManager();
        if (bookmarkManager?.searchEditManager?.isInEditMode()) {
            return;
        }

        if (e.key === 'Escape' && toolbar?.classList.contains('searching')) {
            closeSearching();
        }
    });
    
    // 添加全局点击事件处理，用于关闭打开的菜单
    document.addEventListener('click', (e) => {
        // 如果点击的是菜单按钮或菜单本身，不执行关闭操作
        if (e.target.closest('.more-actions-btn') || e.target.closest('.actions-menu')) {
            return;
        }
        
        // 关闭所有打开的菜单
        document.querySelectorAll('.actions-menu.visible').forEach(menu => {
            menu.classList.remove('visible');
        });
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

function initializeGlobalTooltip() {
    const tooltip = document.getElementById('global-bookmark-tooltip');
    if (!tooltip) return;
    
    let isScrolling = false;
    
    // 监听文档滚动事件（捕获阶段）
    document.addEventListener('scroll', () => {
        if (!isScrolling) {
            logger.debug('文档滚动开始，隐藏tooltip');
            hideTooltip();
        }
        isScrolling = true;
    }, { passive: true, capture: true });

    document.addEventListener("scrollend", (event) => {
        logger.debug('文档滚动结束');
        isScrolling = false;
    }, { passive: true, capture: true });
    
    // 添加全局点击事件，关闭tooltip
    document.addEventListener('click', (e) => {
        // 如果tooltip正在显示，则关闭它
        if (tooltip.classList.contains('show')) {
            // 检查点击的元素是否是tooltip本身或其子元素
            if (!tooltip.contains(e.target)) {
                hideTooltip();
            }
        }
    }, { passive: true });
}

let tooltipTimeout;

function showTooltip(li, bookmark) {
    const tooltip = document.getElementById('global-bookmark-tooltip');
    if (!tooltip) return;
    
    // 清除任何可能存在的超时
    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
        tooltip.classList.remove('show');
    }
    
    tooltipTimeout = setTimeout(() => {
        // 根据标签类型使用不同的样式
        const tags = bookmark.tags.map(tag => {
            if (bookmark.source === BookmarkSource.CHROME) {
                return `<span class="tag folder-tag">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12">
                        <path fill="currentColor" d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/>
                    </svg>
                    ${tag}
                </span>`;
            } else {
                return `<span class="tag">${tag}</span>`;
            }
        }).join('');

        // 格式化保存时间
        const savedDate = bookmark.savedAt ? new Date(bookmark.savedAt) : new Date();
        const formattedDate = savedDate.toLocaleDateString(navigator.language, {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        // 提取域名
        let domain = '';
        try {
            const urlObj = new URL(bookmark.url);
            domain = urlObj.hostname.replace(/^www\./, ''); // 移除 www. 前缀
        } catch (e) {
            // 如果 URL 解析失败，使用原始 URL
            domain = bookmark.url;
        }
        
        // 更新tooltip内容
        tooltip.querySelector('.bookmark-tooltip-title').textContent = bookmark.title;
        tooltip.querySelector('.bookmark-tooltip-url span').textContent = domain;
        tooltip.querySelector('.bookmark-tooltip-tags').innerHTML = tags;
        
        // 添加对摘要的处理
        const excerptElement = tooltip.querySelector('.bookmark-tooltip-excerpt p');
        if (bookmark.excerpt && bookmark.excerpt.trim()) {
            excerptElement.textContent = bookmark.excerpt.trim();
            excerptElement.parentElement.classList.remove('hide');
        } else {
            excerptElement.textContent = '';
            excerptElement.parentElement.classList.add('hide');
        }
        
        tooltip.querySelector('.bookmark-tooltip-time span').textContent = formattedDate;
        
        // 计算位置
        const rect = li.getBoundingClientRect();
        
        // 设置tooltip的位置
        tooltip.style.top = `${rect.bottom + 8}px`;
        tooltip.style.left = `${rect.left}px`;
        
        // 检查是否会超出右侧边界
        const tooltipRect = tooltip.getBoundingClientRect();
        const rightOverflow = window.innerWidth - (rect.left + tooltipRect.width);
        
        if (rightOverflow < 0) {
            // 如果会超出右边界，调整位置
            tooltip.style.left = `${Math.max(10, rect.left + rightOverflow - 10)}px`;
        }
        
        // 检查是否会超出底部边界
        const bottomOverflow = window.innerHeight - (rect.bottom + tooltipRect.height + 8);
        
        if (bottomOverflow < 0) {
            // 如果会超出底部边界，显示在元素上方
            tooltip.style.top = `${rect.top - tooltipRect.height - 8}px`;
        }
        
        // 显示tooltip
        tooltip.classList.add('show');
    }, 500); // 500ms的延迟
}

function hideTooltip() {
    const tooltip = document.getElementById('global-bookmark-tooltip');
    if (!tooltip) return;
    
    // 清除显示的超时
    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
    }
    
    if (tooltip.classList.contains('show')) {
        tooltip.classList.remove('show');
    }
}

// 检查更新并显示更新提示
async function checkForUpdates() {
    try {
        // 获取当前版本
        const manifest = chrome.runtime.getManifest();
        const currentVersion = manifest.version;
        
        // 获取上次显示的版本
        const lastShownVersion = await LocalStorageMgr.getLastShownVersion();
        
        // 如果当前版本与上次显示的版本不同，显示更新提示
        if (lastShownVersion !== currentVersion) {
            await showUpdateNotification(currentVersion);
        }
    } catch (error) {
        logger.error('检查更新失败:', error);
    }
}

// 显示更新提示
async function showUpdateNotification(version) {
    // 获取更新内容
    const updateContent = getUpdateContent(version);
    logger.info('更新内容:', updateContent, version);
    if (!updateContent) {
        return;
    }

    const container = document.getElementById('update-notification');

    // 设置标题
    const updateNotificationTitle = container.querySelector('.update-notification-header h3');
    updateNotificationTitle.textContent = updateContent.title;
    
    // 设置更新内容
    const updateNotificationBody = container.querySelector('.update-notification-body');
    updateNotificationBody.innerHTML = updateContent.content;

    // 给content里的所有a标签添加点击事件
    updateNotificationBody.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: a.href });
        });
    });

    // 显示更新提示
    container.classList.add('show');
}

// 获取更新内容
function getUpdateContent(version) {
    // 这里可以根据不同版本返回不同的更新内容
    const updateNotes = {
        '1.2.4': {
            title: i18n.getMessage('popup_update_version_title', [version]),
            content: `
                <ul>
                    <li>优化了同步功能，支持<a href="settings.html#sync">WebDAV同步</a></li>
                    <li>支持删除搜索历史 <a href="settings.html#overview">去查看</a></li>
                    <li>修复了一些已知问题</li>
                </ul>
            `
        }
    };
    
    return updateNotes[version];
}

// 主初始化函数
async function initializePopup() {
    logger.info(`当前环境: ${ENV.current}, SERVER_URL: ${SERVER_URL}`);
    try {        
        // 初始化UI组件
        const settingsDialog = new SettingsDialog();
        window.settingsDialog = settingsDialog;
        initializeGlobalTooltip();
        const bookmarkManager = getBookmarkManager();
        
        // 初始化必需的管理器
        await Promise.all([
            SettingsManager.init(),
            SyncSettingsManager.init(),
        ]);
        
        // 先刷新视图模式与工具栏状态（filter、隐私图标），避免书签加载完成后才隐藏导致 UI 跳动
        await Promise.all([
            initializeViewModeSwitch(),
            updateTabState(),
            initializeSearch(),
            initializeSortDropdown(),
            window.settingsDialog.initialize(),
        ]);
        initializeDirectoryActions();
        initializeGroupActions();

        // 初始化中间数据层
        await LocalStorageMgr.init();
        await filterManager.init();

        // 再加载书签列表及其他初始化
        await Promise.all([
            refreshBookmarksInfo(),
            bookmarkManager.initialize(),
        ]);

        logger.info('弹出窗口初始化完成');
    } catch (error) {
        logger.error('初始化失败:', error);
        updateStatus(i18n.getMessage('msg_error_init_failed', [error.message]), true);
    }
}

// 初始化设置对话框
document.addEventListener('DOMContentLoaded', async () => {
    i18n.initializeI18n();
    await initShortcutKey();
    initializePopup().catch(error => {
        logger.error('初始化过程中发生错误:', error);
        updateStatus(i18n.getMessage('popup_init_failed_retry'), true);
    });
});
