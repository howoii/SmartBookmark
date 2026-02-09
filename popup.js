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
                <div class="loading-text">正在获取同步状态...</div>
            `;
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
                        name: '云同步',
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
                        name: 'WebDAV同步',
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
                        <p>您尚未配置任何同步服务，您可以前往设置页面开启同步功能，实现跨浏览器同步您的书签。</p>
                        <a href="#" id="go-to-sync-settings" class="primary-button">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                                <path fill="currentColor" d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
                            </svg>
                            配置同步服务
                        </a>
                    </div>
                `;

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
            updateStatus('获取同步状态失败', true);
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
        if (service.isSyncing) {
            statusElement.textContent = '同步中';
            statusElement.classList.add('syncing');
        } else if (service.status.lastSyncResult && service.status.lastSyncResult !== 'success') {
            statusElement.textContent = '同步失败';
            statusElement.classList.add('error');
        } else if (service.status.lastSync) {
            statusElement.textContent = '已同步';
            statusElement.classList.add('success');
        } else {
            statusElement.textContent = '未同步';
        }
        
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
            timeElement.textContent = '从未同步';
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
            buttonText.textContent = '同步中...';
        }
        
        // 添加同步按钮事件
        syncButton.addEventListener('click', async () => {
            if (service.isSyncing) return; // 如果正在同步中，不执行操作
            
            syncButton.classList.add('syncing');
            buttonText.textContent = '同步中...';
            
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
                    updateStatus('同步成功', false);
                } else {
                    updateStatus('同步失败: ' + (result?.error || '未知错误'), true);
                }
            } catch (error) {
                logger.error(`${service.name}同步失败:`, error);
                updateStatus('同步失败: ' + error.message, true);
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
            throw new Error('云同步功能已禁用');
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
        this.excerptRequest = null;
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
                recommendedTags: document.querySelector('.recommended-tags'),
                pageExcerpt: document.getElementById('page-excerpt'),
                dialogTitle: document.querySelector('.page-title'),
                pageUrl: document.querySelector('.page-url')
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
                this.updateSyncButtonState()
            ]);
                        
            logger.info('BookmarkManager 初始化成功');
        } catch (error) {
            logger.error('初始化失败:', error);
            throw error; // 重新抛出错误，让调用者知道初始化失败
        }
    }

    initBookmarkListEditMode() {
        const editElements = {
            container: document.querySelector('.container'),
            bookmarkList: document.getElementById('bookmarks-list'),
            selectAllCheckbox: document.getElementById('select-all-checkbox'),
            selectedCountElement: document.getElementById('selected-count'),
            batchDeleteButton: document.getElementById('batch-delete-btn'),
            batchOpenButton: document.getElementById('batch-open-btn'),
            exitEditModeButton: document.getElementById('exit-edit-mode-btn')
        }
        const callbacks = {
            showStatus: updateStatus,
            showDialog: this.showDialog,
            afterDelete: this.refreshBookmarksList
        }
        this.editManager = new BookmarkEditManager(editElements, callbacks, 'bookmark-item');
    }

    initSearchListEditMode() {
        // 准备编辑管理器需要的元素和回调
        const editElements = {
            container: document.querySelector('.search-content'),
            bookmarkList: document.getElementById('search-results'),
            selectAllCheckbox: document.getElementById('search-select-all-checkbox'),
            selectedCountElement: document.getElementById('search-selected-count'),
            batchDeleteButton: document.getElementById('search-batch-delete-btn'),
            batchOpenButton: document.getElementById('search-batch-open-btn'),
            exitEditModeButton: document.getElementById('search-exit-edit-mode-btn')
        };
        const callbacks = {
            showStatus: updateStatus,
            showDialog: this.showDialog,
            afterDelete: this.refreshBookmarksList
        };
        // 创建编辑管理器实例
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
                    syncButton.title = '同步中...';
                    break;
                case 'error':
                    syncButton.classList.add('error');
                    syncButton.title = '同步失败';
                    break;
                default:
                    syncButton.title = '同步';
                    break;
            }
        } catch (error) {
            logger.error('更新同步按钮状态失败:', error);
        }
    }

    showDialog(params) {
        this.alertDialog.show(params);
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

        // 基本的对话框关闭功能（必需）
        const closeDialog = (e) => {
            e.stopPropagation();
            e.preventDefault();
            dialog.classList.remove('show');
            if (!this.isEditMode) {
                updateStatus('已取消保存');
            }
            this.resetEditMode();
            if (this.excerptRequest) {
                this.excerptRequest.abort();
                this.excerptRequest = null;
            }
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
                    const newTag = newTagInput.value.trim().replace(/>/g, '/'); // 将>转换为/
                    if (newTag) {
                        const currentTags = this.getCurrentTags();
                        if (!currentTags.includes(newTag)) {
                            this.renderTags([...currentTags, newTag]);
                            newTagInput.value = '';
                        } else {
                            updateStatus('标签已存在', true);
                        }
                    }
                }
            });

            // 输入时显示自动补全建议
            newTagInput.addEventListener('input', async (e) => {
                const inputValue = e.target.value.trim();
                if (inputValue.length > 0) {
                    await this.showTagAutoComplete(inputValue);
                } else {
                    this.hideTagSuggestions();
                }
            });

            // 失去焦点时隐藏建议（延迟以允许点击建议）
            newTagInput.addEventListener('blur', () => {
                setTimeout(() => this.hideTagSuggestions(), 200);
            });
        }

        if (tagsList) {
            tagsList.addEventListener('click', (e) => {
                if (e.target.classList.contains('remove-tag-btn')) {
                    // 点击删除按钮，删除标签
                    const tagElement = e.target.parentElement;
                    tagElement.remove();
                } else if (e.target.classList.contains('tag-text')) {
                    // 点击扁平标签本身，将标签内容设置到输入框中
                    const tagText = e.target.textContent.trim();
                    if (newTagInput && tagText) {
                        newTagInput.value = tagText;
                        newTagInput.focus();
                    }
                } else if (e.target.className && e.target.className.startsWith('tag-level-')) {
                    // 点击层级标签的某个层级，将完整标签路径设置到输入框中
                    const tagElement = e.target.closest('.tag');
                    if (tagElement && tagElement.classList.contains('hierarchical-tag')) {
                        const levelSpans = tagElement.querySelectorAll('[class^="tag-level-"]');
                        const fullPath = Array.from(levelSpans).map(span => span.textContent.trim()).join('/');
                        if (newTagInput && fullPath) {
                            newTagInput.value = fullPath;
                            newTagInput.focus();
                        }
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
                await this.saveBookmark(finalTags, title);
                dialog.classList.remove('show');
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
                    title: '确认删除',
                    message: '确定要删除此书签吗？',
                    primaryText: '删除',
                    secondaryText: '取消',
                    onPrimary: async () => {
                        dialog.classList.remove('show');
                        await this.handleUnsave(this.currentTab);
                        this.resetEditMode();
                    }
                });
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
                    if (e.key === 'Escape') {
                        dialogTitle.textContent = dialogTitle.dataset.originalTitle;
                        dialogTitle.blur();
                    }
                },
                keypress: (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        dialogTitle.blur();
                    }
                }
            }
            // 绑定事件
            dialogTitle.addEventListener('focus', handlers.focus);
            dialogTitle.addEventListener('blur', handlers.blur);
            dialogTitle.addEventListener('keydown', handlers.keydown);
            dialogTitle.addEventListener('keypress', handlers.keypress);
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
            generateBtn.title = "取消生成";

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
                throw new Error('摘要生成失败');
            }
        } catch (error) {
            if (error.message.includes('UserCanceled')) {
                updateStatus('已取消生成摘要', false);
            } else {
                updateStatus(`${error.message}`, true);
            }
        } finally {
            // 移除loading状态
            generateBtn.classList.remove('loading');
            generateBtn.title = "AI生成摘要";
            
            // 清理请求
            if (this.excerptRequest) {
                this.excerptRequest.done();
                this.excerptRequest = null;
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
                    title: '欢迎使用',
                    message: '您需要配置 API 服务才能使用书签搜索等核心功能。是否现在配置？',
                    primaryText: '去配置',
                    secondaryText: '暂不配置',
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
                }
                if (changes[ConfigManager.STORAGE_KEYS.API_KEYS]) {
                    this.checkApiKeyConfig(false);
                }
                if (changes[ConfigManager.STORAGE_KEYS.CUSTOM_SERVICES]) {
                    this.checkApiKeyConfig(false);
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

    getCurrentTags() {
        const { tagsList } = this.elements.required;
        if (!tagsList) return [];

        const tagElements = tagsList.querySelectorAll('.tag');
        return Array.from(tagElements).map(tagEl => {
            // 检查是否为层级标签
            if (tagEl.classList.contains('hierarchical-tag')) {
                // 提取所有层级span的文本并用/连接
                const levelSpans = tagEl.querySelectorAll('[class^="tag-level-"]');
                return Array.from(levelSpans).map(span => span.textContent.trim()).join('/');
            } else {
                // 扁平标签
                const tagText = tagEl.querySelector('.tag-text');
                return tagText ? tagText.textContent.trim() : '';
            }
        }).filter(tag => tag); // 过滤空标签
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
            updateStatus('URL格式错误', true);
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
                    const bookmark = await LocalStorageMgr.getBookmark(tab.url, true);
                    this.handleEdit(bookmark);
                    return;
                }

                // 添加对非http页面的检查
                if (isNonMarkableUrl(tab.url)) {
                    updateStatus('基于浏览器安全策略，不支持保存此页面', false);
                    return;
                }

                await this.processAndShowTags(tab);
            } else {
                updateStatus('基于浏览器安全策略，不支持保存此页面', false);
            }
        } catch (error) {
            logger.error('保存过程中出错:', error);
            updateStatus('保存失败: ' + error.message, true);
        } finally {
            SaveManager.endSave(this);
        }
    }

    async handleUnsave(tab) {
        const bookmark = await LocalStorageMgr.getBookmark(tab.url, true);
        if (bookmark) {
            await LocalStorageMgr.removeBookmark(tab.url);
            updateStatus('已取消收藏');
            await refreshBookmarksInfo();
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
            this.generatedTags = await generateHierarchicalTags(this.pageContent, tab);
            StatusManager.endOperation('标签生成完成');
        }   

        // 直接显示标签对话框
        await this.showTagsDialog(this.generatedTags);
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
        const recommendedTags = dialog.querySelector('.recommended-tags');
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
            dialogExcerpt.placeholder = '添加或编辑书签摘要...';
        }
        requestAnimationFrame(() => {
            this.adjustTextareaHeight(dialogExcerpt);
            this.updateCharCount(dialogExcerpt);
        });
        
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

            // 检查是否为层级标签
            if (tag.includes('/')) {
                // 渲染层级标签
                tagElement.className = 'tag hierarchical-tag';
                const parts = tag.split('/');
                let innerHTML = '';

                parts.forEach((part, index) => {
                    const levelClass = `tag-level-${index + 1}`;
                    innerHTML += `<span class="${levelClass}">${part.trim()}</span>`;
                    if (index < parts.length - 1) {
                        innerHTML += '<span class="tag-separator">/</span>';
                    }
                });

                innerHTML += '<button class="remove-tag-btn">×</button>';
                tagElement.innerHTML = innerHTML;
            } else {
                // 渲染扁平标签
                tagElement.className = 'tag';
                tagElement.innerHTML = `
                    <span class="tag-text">${tag}</span>
                    <button class="remove-tag-btn">×</button>
                `;
            }

            tagsList.appendChild(tagElement);
        });
    }

    /**
     * 显示标签自动补全建议
     * @param {string} inputValue - 输入的值
     */
    async showTagAutoComplete(inputValue) {
        // 获取所有现有书签的标签
        const bookmarks = await LocalStorageMgr.getBookmarksList();
        const allTags = new Set();

        for (const bookmark of bookmarks) {
            const tags = bookmark.hierarchicalTags || bookmark.tags || [];
            tags.forEach(tag => allTags.add(tag));
        }

        // 过滤匹配的标签（支持前缀和包含匹配）
        const suggestions = Array.from(allTags).filter(tag => {
            const normalizedTag = tag.toLowerCase();
            const normalizedInput = inputValue.toLowerCase().replace(/>/g, '/');
            return normalizedTag.includes(normalizedInput);
        }).slice(0, 10); // 最多显示10个建议

        if (suggestions.length > 0) {
            this.renderTagSuggestions(suggestions, inputValue);
        } else {
            this.hideTagSuggestions();
        }
    }

    /**
     * 渲染标签建议列表
     * @param {Array<string>} suggestions - 建议的标签列表
     * @param {string} inputValue - 当前输入值
     */
    renderTagSuggestions(suggestions, inputValue) {
        const newTagInput = this.elements.optional.newTagInput;
        if (!newTagInput) return;

        // 创建或获取建议容器
        let suggestionsContainer = document.querySelector('.tag-suggestions');
        if (!suggestionsContainer) {
            suggestionsContainer = document.createElement('div');
            suggestionsContainer.className = 'tag-suggestions';
            newTagInput.parentElement.appendChild(suggestionsContainer);
        }

        // 清空并填充新建议
        suggestionsContainer.innerHTML = '';
        suggestions.forEach(tag => {
            const suggestionItem = document.createElement('div');
            suggestionItem.className = 'tag-suggestion-item';

            // 高亮匹配部分
            const normalizedInput = inputValue.toLowerCase().replace(/>/g, '/');
            const normalizedTag = tag.toLowerCase();
            const matchIndex = normalizedTag.indexOf(normalizedInput);

            if (matchIndex !== -1) {
                const before = tag.substring(0, matchIndex);
                const match = tag.substring(matchIndex, matchIndex + inputValue.length);
                const after = tag.substring(matchIndex + inputValue.length);
                suggestionItem.innerHTML = `${before}<strong>${match}</strong>${after}`;
            } else {
                suggestionItem.textContent = tag;
            }

            // 点击建议项添加标签
            suggestionItem.addEventListener('click', () => {
                const currentTags = this.getCurrentTags();
                if (!currentTags.includes(tag)) {
                    this.renderTags([...currentTags, tag]);
                    newTagInput.value = '';
                } else {
                    updateStatus('标签已存在', true);
                }
                this.hideTagSuggestions();
            });

            suggestionsContainer.appendChild(suggestionItem);
        });

        suggestionsContainer.style.display = 'block';
    }

    /**
     * 隐藏标签建议
     */
    hideTagSuggestions() {
        const suggestionsContainer = document.querySelector('.tag-suggestions');
        if (suggestionsContainer) {
            suggestionsContainer.style.display = 'none';
        }
    }

    getEditedExcerpt() {
        const dialogExcerpt = document.querySelector('#page-excerpt');
        return dialogExcerpt ? dialogExcerpt.value.trim() : '';
    }

    async saveBookmark(tags, title) {
        try {
            if (!this.currentTab) {
                throw new Error('页面信息获取失败');
            }
            StatusManager.startOperation(this.isEditMode ? '正在更新书签' : '正在保存书签');
            
            // 获取编辑后的 URL 和摘要
            const url = this.getEditedUrl();
            const editedExcerpt = this.getEditedExcerpt();
            const pageInfo = {
                url: url,
                title: title,
                tags: tags,
                excerpt: editedExcerpt,
                savedAt: this.isEditMode ? this.editingBookmark.savedAt : Date.now(),
                useCount: this.isEditMode ? this.editingBookmark.useCount : 1,
                lastUsed: this.isEditMode ? this.editingBookmark.lastUsed : Date.now(),
            };

            // 打印书签编辑信息
            logger.debug('书签编辑信息:', {
                isEditMode: this.isEditMode,
                before: this.isEditMode ? this.editingBookmark : null,
                after: pageInfo
            });

            // 如果编辑模式下URL发生变化，则先删除旧书签
            if (this.isEditMode && this.editingBookmark.url !== url) {
                await LocalStorageMgr.removeBookmark(this.editingBookmark.url);
            }
                        
            await updateBookmarksAndEmbedding(pageInfo);

            await refreshBookmarksInfo();
            StatusManager.endOperation(this.isEditMode ? '书签更新成功' : '书签保存成功', false);
        } catch (error) {
            logger.error('保存书签时出错:', error);
            StatusManager.endOperation(this.isEditMode ? '书签更新失败' : '书签保存失败', true);
        } finally {
            this.resetEditMode();
        }   
    }
}

async function updateSearchResults() {
    const searchInput = document.getElementById('search-input');
    if (searchInput.value) {
        logger.debug('更新搜索结果');
        const query = searchInput.value.trim();
        const includeChromeBookmarks = await SettingsManager.get('display.showChromeBookmarks');
        const results = await searchBookmarksFromBackground(query, {
            debounce: false,
            includeUrl: true,
            includeChromeBookmarks: includeChromeBookmarks
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

        const tags = result.tags.map(tag => 
            result.source === BookmarkSource.CHROME ? 
            `<span class="tag folder-tag">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12">
                    <path fill="currentColor" d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/>
                </svg>
                ${tag}
            </span>` :
            `<span class="tag">${tag}</span>`
        ).join('');

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

        const editBtnHtml = result.source !== BookmarkSource.EXTENSION ? '' : `
            <button class="action-btn edit-btn" title="编辑">
                <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z" />
                </svg>
            </button>
        `;
        
        const formattedDate = result.savedAt ? new Date(result.savedAt).toLocaleDateString(navigator.language, {year: 'numeric', month: 'long', day: 'numeric'}) : '未知时间';

        // 添加选择复选框
        li.innerHTML = `
            <div class="bookmark-checkbox">
                <input type="checkbox" title="选择此书签">
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
                <div class="result-tags">${tags}</div>
                <!-- 书签底部信息栏 -->
                <div class="result-metadata">
                    <div class="result-saved-time" title="收藏于 ${formattedDate}">
                        <svg viewBox="0 0 24 24" width="14" height="14">
                            <path fill="currentColor" d="M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22C6.47,22 2,17.5 2,12A10,10 0 0,1 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z" />
                        </svg>
                        <span>${formattedDate}</span>
                    </div>
                </div>
            </a>
            
            <!-- 添加三点菜单按钮 -->
            <div class="more-actions-btn" title="更多操作">
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
                    <button class="action-btn delete-btn" title="删除">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>
                        </svg>
                    </button>
                </div>
                <div class="actions-menu-header">
                    <button class="close-menu-btn" title="关闭">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;

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
                const copyConfirm = confirm('此页面无法直接打开。是否复制链接到剪贴板？');
                if (copyConfirm) {
                    await navigator.clipboard.writeText(result.url);
                    updateStatus('链接已复制到剪贴板');
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
            title: '确认删除',
            message: '确定要删除此书签吗？',
            primaryText: '删除',
            secondaryText: '取消',
            onPrimary: async () => {
                // 先删除书签
                if (bookmark.source === BookmarkSource.EXTENSION) {
                    await LocalStorageMgr.removeBookmark(bookmark.url);
                } else {
                    await chrome.bookmarks.remove(bookmark.chromeId);
                }
                
                // 并行执行所有UI更新
                await refreshBookmarksInfo();

                updateStatus('书签已成功删除', false);
            }
        });
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
    updateStatus('同步失败: ' + errorMessage, true);
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
                <div class="loading-text">正在加载书签...</div>
            </li>`;

        const settings = await SettingsManager.getAll();
        const viewMode = settings.display.viewMode;
        const sortBy = settings.sort.bookmarks;

        // 层级视图和分组视图获取所有书签，列表视图使用筛选器
        const data = (viewMode === 'group' || viewMode === 'hierarchy')
            ? Object.values(await getDisplayedBookmarks())
            : await filterManager.getFilteredBookmarks();

        let bookmarks = data.map((item) => ({
                ...item,
                // 统一使用时间戳进行比较
                savedAt: item.savedAt ? getDateTimestamp(item.savedAt) || 0 : 0,
                useCount: calculateWeightedScore(item.useCount, item.lastUsed),
                lastUsed: item.lastUsed ? getDateTimestamp(item.lastUsed) || 0 : 0
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
                                点击左上角的收藏图标开始收藏
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
        } else if (viewMode === 'hierarchy') {
            currentRenderer = new HierarchicalBookmarkRenderer(bookmarksList, bookmarks);
        } else {
            currentRenderer = new BookmarkRenderer(bookmarksList, bookmarks);
        }
        await currentRenderer.initialize(rendererState);
        logger.debug('renderBookmarksList 完成');
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

async function refreshBookmarksInfo() {
    await renderBookmarksList();
    await Promise.all([
        updateBookmarkCount(),
        updateTabState(),
        updateSearchResults(),
    ]);
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
    // 判断如果没有active的按钮，则设置为list
    if (!Array.from(viewButtons).some(button => button.classList.contains('active'))) {
        viewButtons[0].classList.add('active');
    }
    filterManager.toggleDisplayFilter(savedViewMode === 'list');

    viewButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const mode = button.dataset.mode;
            if (button.classList.contains('active')) return;

            // 更新按钮状态
            viewButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // 保存视图模式设置
            await updateSettingsWithSync({
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
        // 重置容器的 className 为原始值
        if (this.container) {
            this.container.className = 'bookmarks-list';
            // 清空容器
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

        const editBtn = bookmark.source === BookmarkSource.EXTENSION
            ? `<button class="edit-btn" title="编辑">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M3,17.25V21H6.75L17.81,9.93L14.06,6.18M17.5,3C19.54,3 21.43,4.05 22.39,5.79L20.11,7.29C19.82,6.53 19.19,6 18.5,6A2.5,2.5 0 0,0 16,8.5V11H18V13H16V15H18V17.17L16.83,18H13V16H15V14H13V12H15V10H13V8.83"></path>
                    </svg>
                </button>` 
            : '';
        
        li.innerHTML = `
            <div class="bookmark-checkbox">
                <input type="checkbox" title="选择此书签">
            </div>
            <a href="${bookmark.url}" class="bookmark-link" target="_blank">
                <div class="bookmark-info">
                    <div class="bookmark-main">
                        <div class="bookmark-favicon">
                            <img src="${await getFaviconUrl(bookmark.url)}" alt="" loading="lazy">
                        </div>
                        <h3 class="bookmark-title"">${bookmark.title}</h3>
                        <div class="bookmark-actions">
                            ${editBtn}
                            <button class="delete-btn" title="删除">
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                    <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </a>
        `;

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
                const isCollapsed = toggle.classList.toggle('collapsed');
                content.classList.toggle('collapsed');
                
                // 更新并保存折叠状态
                this.collapsedStates.set(group.rule.id, isCollapsed);
                this.saveCollapsedStates();
            });

            // 应用保存的折叠状态
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
                // 如果是第一次打开，默认展开第一个分组
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
        
        // 在所有分组之后添加"添加自定义书签"提示
        const addCustomGroupTip = document.createElement('div');
        addCustomGroupTip.className = 'add-custom-group-tip';
        addCustomGroupTip.innerHTML = `
            <div class="tip-content">
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
                </svg>
                <span>添加分组</span>
            </div>
        `;
        
        // 添加点击事件，跳转到设置页面
        addCustomGroupTip.addEventListener('click', () => {
            openOptionsPage('filters');
        });
        
        this.container.appendChild(addCustomGroupTip);
    }

    cleanup() {
        // 重置容器的 className 为原始值
        this.container.className = 'bookmarks-list';
        // 清空内容
        this.container.innerHTML = '';
    }
}

/**
 * 层级标签展示渲染器
 * 以树形结构展示标签，点击标签筛选书签
 */
class HierarchicalBookmarkRenderer extends BookmarkRenderer {
    constructor(container, bookmarks, config = {}) {
        super(container, bookmarks);
        this.rendererType = 'hierarchy';

        // 配置项（预留扩展性）
        this.config = {
            layout: config.layout || 'split-horizontal',
            defaultView: config.defaultView || 'all',
            showFilter: config.showFilter || false,
            treeWidth: config.treeWidth || 220,
            defaultExpanded: config.defaultExpanded || 'first-level',
            sortBy: config.sortBy || 'count',
            showCount: config.showCount !== false
        };

        // 状态管理
        this.tagHierarchy = null;
        this.selectedTag = null;
        this.expandedTags = new Set();
        this.filteredBookmarks = [];
        this.availableTags = new Set();
        this.tagCounts = new Map();
        this.displayCount = 0;
        this.isLoading = false;

        // 为了兼容性，添加 bookmarks 别名
        this.bookmarks = this.allBookmarks;
    }

    /**
     * 初始化渲染器
     */
    async initialize(state = {}) {
        try {
            // 加载展开状态
            const savedStates = await LocalStorageMgr.getHierarchyExpandedStates() || [];
            this.expandedTags = new Set(savedStates);

            // 加载保存的宽度
            const savedWidth = await LocalStorageMgr.getHierarchyTreeWidth();
            if (savedWidth) {
                this.config.treeWidth = savedWidth;
            }

            // 创建布局
            this.createLayout();

            // 设置拖拽功能
            this.setupResizeHandle();

            // 构建标签树
            this.buildTagHierarchy();

            // 渲染标签树
            this.renderTagTree();

            // 默认显示全部书签
            this.selectTag(null);

        } catch (error) {
            logger.error('初始化层级视图失败:', error);
            throw error;
        }
    }

    /**
     * 创建左右分栏布局
     */
    createLayout() {
        this.container.innerHTML = '';
        this.container.className = 'hierarchy-split-container';

        // 左侧标签树容器
        this.tagTreeContainer = document.createElement('div');
        this.tagTreeContainer.className = 'hierarchy-tag-tree';
        this.tagTreeContainer.style.width = `${this.config.treeWidth}px`;
        this.tagTreeContainer.style.minWidth = `${this.config.treeWidth}px`;

        // 添加拖拽分隔条
        this.resizeHandle = document.createElement('div');
        this.resizeHandle.className = 'hierarchy-resize-handle';
        this.tagTreeContainer.appendChild(this.resizeHandle);

        // 右侧书签列表容器
        this.bookmarkListContainer = document.createElement('div');
        this.bookmarkListContainer.className = 'hierarchy-bookmark-list';

        this.container.appendChild(this.tagTreeContainer);
        this.container.appendChild(this.bookmarkListContainer);
    }

    /**
     * 设置拖拽调整宽度功能
     */
    setupResizeHandle() {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        const onMouseDown = (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = this.tagTreeContainer.offsetWidth;
            this.resizeHandle.classList.add('resizing');

            // 防止文本选择
            e.preventDefault();
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
        };

        const onMouseMove = (e) => {
            if (!isResizing) return;

            const deltaX = e.clientX - startX;
            const newWidth = startWidth + deltaX;

            // 限制最小和最大宽度
            const minWidth = 140;
            const maxWidth = 400;
            const constrainedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

            this.tagTreeContainer.style.width = `${constrainedWidth}px`;
            this.tagTreeContainer.style.minWidth = `${constrainedWidth}px`;
        };

        const onMouseUp = async () => {
            if (!isResizing) return;

            isResizing = false;
            this.resizeHandle.classList.remove('resizing');
            document.body.style.userSelect = '';
            document.body.style.cursor = '';

            // 保存新的宽度
            const newWidth = this.tagTreeContainer.offsetWidth;
            this.config.treeWidth = newWidth;
            await LocalStorageMgr.setHierarchyTreeWidth(newWidth);
        };

        this.resizeHandle.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // 保存事件处理器引用，用于清理
        this.resizeHandlers = {
            mouseMove: onMouseMove,
            mouseUp: onMouseUp
        };
    }

    /**
     * 构建标签层级结构
     */
    buildTagHierarchy() {
        // 收集所有标签和计数
        this.availableTags.clear();
        this.tagCounts.clear();

        // 防御性检查
        if (!this.bookmarks || !Array.isArray(this.bookmarks)) {
            logger.warn('书签数据无效，使用空数组');
            this.bookmarks = [];
            this.tagHierarchy = {};
            return;
        }

        this.bookmarks.forEach(bookmark => {
            const tags = bookmark.tags || [];
            tags.forEach(tag => {
                if (!tag) return;

                this.availableTags.add(tag);
                this.tagCounts.set(tag, (this.tagCounts.get(tag) || 0) + 1);

                // 为层级标签的每一级也计数
                if (tag.includes('/')) {
                    const parts = tag.split('/');
                    let currentPath = '';
                    parts.forEach((part, index) => {
                        currentPath += (index > 0 ? '/' : '') + part;
                        if (currentPath !== tag) {
                            this.tagCounts.set(currentPath, (this.tagCounts.get(currentPath) || 0) + 1);
                        }
                    });
                }
            });
        });

        // 构建层级结构
        const hierarchy = {};

        Array.from(this.availableTags).forEach(tag => {
            if (!tag) return;

            const parts = tag.split('/');
            let currentLevel = hierarchy;

            parts.forEach((part, index) => {
                const trimmedPart = part.trim();
                if (!trimmedPart) return;

                const fullPath = parts.slice(0, index + 1).join('/');

                if (!currentLevel[trimmedPart]) {
                    currentLevel[trimmedPart] = {
                        fullPath: fullPath,
                        count: this.tagCounts.get(fullPath) || 0,
                        children: {},
                        expanded: this.expandedTags.has(fullPath)
                    };
                }

                currentLevel = currentLevel[trimmedPart].children;
            });
        });

        this.tagHierarchy = hierarchy;
    }

    /**
     * 渲染标签树
     */
    renderTagTree() {
        this.tagTreeContainer.innerHTML = '';

        // 重新创建拖拽分隔条
        this.resizeHandle = document.createElement('div');
        this.resizeHandle.className = 'hierarchy-resize-handle';
        this.tagTreeContainer.appendChild(this.resizeHandle);

        // 重新绑定拖拽事件
        this.setupResizeHandle();

        // 添加"全部书签"选项
        const allBookmarksNode = document.createElement('div');
        allBookmarksNode.className = 'hierarchy-tag-node all-bookmarks';
        if (!this.selectedTag) {
            allBookmarksNode.classList.add('selected');
        }
        allBookmarksNode.innerHTML = `
            <span class="expand-placeholder"></span>
            <span class="tag-name">全部书签</span>
            <span class="tag-count">${this.bookmarks.length}</span>
        `;
        allBookmarksNode.addEventListener('click', () => this.selectTag(null));
        this.tagTreeContainer.appendChild(allBookmarksNode);

        // 渲染标签树
        const treeContainer = document.createElement('div');
        treeContainer.className = 'hierarchy-tree-container';

        Object.entries(this.tagHierarchy)
            .sort(([labelA, nodeA], [labelB, nodeB]) => {
                if (this.config.sortBy === 'count') {
                    const countDiff = nodeB.count - nodeA.count;
                    if (countDiff === 0) {
                        return labelA.localeCompare(labelB, 'zh-CN');
                    }
                    return countDiff;
                } else {
                    return labelA.localeCompare(labelB, 'zh-CN');
                }
            })
            .forEach(([label, node]) => {
                this.renderTagNode(node, label, treeContainer, 0);
            });

        this.tagTreeContainer.appendChild(treeContainer);
    }

    /**
     * 递归渲染标签节点
     */
    renderTagNode(node, label, container, level = 0) {
        const nodeElement = document.createElement('div');
        nodeElement.className = 'hierarchy-tag-node';
        nodeElement.style.paddingLeft = `${level * 16 + 8}px`;

        const hasChildren = Object.keys(node.children).length > 0;
        const isSelected = this.selectedTag === node.fullPath;

        // 创建节点内容
        const expandBtn = hasChildren ?
            `<span class="expand-btn">${node.expanded ? '▼' : '▶'}</span>` :
            '<span class="expand-placeholder"></span>';

        nodeElement.innerHTML = `
            ${expandBtn}
            <span class="tag-name ${isSelected ? 'selected' : ''}">${label}</span>
            ${this.config.showCount ? `<span class="tag-count">${node.count}</span>` : ''}
        `;

        // 展开/折叠按钮点击事件
        const expandBtnElement = nodeElement.querySelector('.expand-btn');
        if (expandBtnElement) {
            expandBtnElement.addEventListener('click', (e) => {
                e.stopPropagation();
                node.expanded = !node.expanded;

                // 更新展开状态
                if (node.expanded) {
                    this.expandedTags.add(node.fullPath);
                } else {
                    this.expandedTags.delete(node.fullPath);
                }

                // 保存状态
                this.saveExpandedStates();

                // 重新渲染标签树
                this.renderTagTree();
            });
        }

        // 标签名称点击事件
        const tagNameElement = nodeElement.querySelector('.tag-name');
        tagNameElement.addEventListener('click', () => {
            this.selectTag(node.fullPath);
        });

        container.appendChild(nodeElement);

        // 如果展开且有子节点，渲染子节点
        if (hasChildren && node.expanded) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'hierarchy-tag-children';

            Object.entries(node.children)
                .sort(([labelA, nodeA], [labelB, nodeB]) => {
                    if (this.config.sortBy === 'count') {
                        const countDiff = nodeB.count - nodeA.count;
                        if (countDiff === 0) {
                            return labelA.localeCompare(labelB, 'zh-CN');
                        }
                        return countDiff;
                    } else {
                        return labelA.localeCompare(labelB, 'zh-CN');
                    }
                })
                .forEach(([childLabel, childNode]) => {
                    this.renderTagNode(childNode, childLabel, childrenContainer, level + 1);
                });

            container.appendChild(childrenContainer);
        }
    }

    /**
     * 选择标签并筛选书签
     */
    selectTag(tagPath) {
        this.selectedTag = tagPath;

        // 重新渲染标签树以更新选中状态
        this.renderTagTree();

        // 筛选书签
        this.filterBookmarksByTag(tagPath);

        // 重置显示计数
        this.displayCount = 0;

        // 渲染书签列表
        this.renderBookmarkList();
    }

    /**
     * 根据标签筛选书签（支持前缀匹配）
     */
    filterBookmarksByTag(tagPath) {
        if (!tagPath) {
            // 显示全部书签
            this.filteredBookmarks = [...this.bookmarks];
        } else {
            // 筛选包含该标签或其子标签的书签
            this.filteredBookmarks = this.bookmarks.filter(bookmark => {
                const tags = bookmark.tags || [];
                return tags.some(tag =>
                    tag === tagPath || tag.startsWith(tagPath + '/')
                );
            });
        }
    }

    /**
     * 渲染书签列表
     */
    async renderBookmarkList() {
        this.bookmarkListContainer.innerHTML = '';

        // 创建书签列表容器
        const listElement = document.createElement('ul');
        listElement.className = 'bookmarks-list';

        // 显示前 50 条书签
        const itemsToShow = Math.min(this.displayCount + 50, this.filteredBookmarks.length);

        for (let i = this.displayCount; i < itemsToShow; i++) {
            const bookmark = this.filteredBookmarks[i];
            const bookmarkElement = await this.createBookmarkElement(bookmark);
            listElement.appendChild(bookmarkElement);
        }

        this.displayCount = itemsToShow;
        this.bookmarkListContainer.appendChild(listElement);

        // 设置无限滚动
        this.setupInfiniteScroll();

        // 如果没有书签，显示空状态
        if (this.filteredBookmarks.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.innerHTML = `
                <div class="empty-message">
                    <svg viewBox="0 0 24 24" width="48" height="48">
                        <path fill="currentColor" d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z" />
                    </svg>
                    <p>该标签下暂无书签</p>
                </div>
            `;
            this.bookmarkListContainer.appendChild(emptyState);
        }
    }

    /**
     * 设置无限滚动
     */
    setupInfiniteScroll() {
        const listElement = this.bookmarkListContainer.querySelector('.bookmarks-list');
        if (!listElement) return;

        // 移除旧的滚动监听器
        if (this.scrollHandler) {
            this.bookmarkListContainer.removeEventListener('scroll', this.scrollHandler);
        }

        // 创建新的滚动监听器
        this.scrollHandler = async () => {
            const scrollTop = this.bookmarkListContainer.scrollTop;
            const scrollHeight = this.bookmarkListContainer.scrollHeight;
            const clientHeight = this.bookmarkListContainer.clientHeight;

            // 当滚动到底部附近时加载更多
            if (scrollTop + clientHeight >= scrollHeight - 100) {
                if (this.displayCount < this.filteredBookmarks.length && !this.isLoading) {
                    this.isLoading = true;

                    const itemsToShow = Math.min(this.displayCount + 25, this.filteredBookmarks.length);

                    for (let i = this.displayCount; i < itemsToShow; i++) {
                        const bookmark = this.filteredBookmarks[i];
                        const bookmarkElement = await this.createBookmarkElement(bookmark);
                        listElement.appendChild(bookmarkElement);
                    }

                    this.displayCount = itemsToShow;
                    this.isLoading = false;
                }
            }
        };

        this.bookmarkListContainer.addEventListener('scroll', this.scrollHandler);
    }

    /**
     * 保存展开状态
     */
    async saveExpandedStates() {
        try {
            await LocalStorageMgr.setHierarchyExpandedStates(Array.from(this.expandedTags));
        } catch (error) {
            logger.error('保存展开状态失败:', error);
        }
    }

    /**
     * 清理资源
     */
    cleanup() {
        // 移除滚动监听器
        if (this.scrollHandler) {
            this.bookmarkListContainer.removeEventListener('scroll', this.scrollHandler);
        }

        // 移除拖拽事件监听器
        if (this.resizeHandlers) {
            document.removeEventListener('mousemove', this.resizeHandlers.mouseMove);
            document.removeEventListener('mouseup', this.resizeHandlers.mouseUp);
        }

        // 重置样式
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        // 重置容器的 className 为原始值
        this.container.className = 'bookmarks-list';

        // 清空内容
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
            openInNewTab: document.getElementById('open-in-new-tab'), // 添加新元素引用
            themeOptions: document.querySelectorAll('.theme-option-popup'),
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
                await refreshBookmarksInfo();
            }));

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
            // 获取扩展ID
            const extensionId = chrome.runtime.id;
            
            // 判断浏览器类型并选择对应的商店链接
            const userAgent = navigator.userAgent;
            // Edge 的 userAgent 包含 "Edg"，Chrome 的 userAgent 包含 "Chrome" 但不包含 "Edg"
            const isEdge = userAgent.indexOf('Edg') !== -1;
            const isChrome = userAgent.indexOf('Chrome') !== -1 && !isEdge;
            
            let storeUrl;
            if (isEdge) {
                // Edge 商店链接
                storeUrl = `https://microsoftedge.microsoft.com/addons/detail/${extensionId}`;
            } else if (isChrome) {
                // Chrome 商店链接
                storeUrl = `https://chrome.google.com/webstore/detail/${extensionId}`;
            } else {
                // 默认使用 Chrome 商店链接（兼容其他基于 Chromium 的浏览器）
                storeUrl = `https://chrome.google.com/webstore/detail/nlboajobccgidfcdoedphgfaklelifoa`;
            }
            
            chrome.tabs.create({ url: storeUrl });
            this.close();
        });

        // 添加捐赠按钮点击事件
        this.elements.donateButton.addEventListener('click', () => {
            chrome.tabs.create({
                url: 'https://howoii.github.io/smartbookmark-support/donate.html'
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
            chrome.tabs.create({ url: `https://howoii.github.io/smartbookmark-support/changelog.html`});
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

    async loadSettings() {
        try {
            const settings = await SettingsManager.getAll();
            const {
                display: { 
                    showChromeBookmarks, 
                    autoFocusSearch, 
                    openInNewTab,
                    theme: themeSettings,
                } = {},
                privacy: { 
                    autoDetect: autoPrivacyMode, 
                    enabled: manualPrivacyMode 
                } = {}
            } = settings;

            // 初始化开关状态
            this.elements.showChromeBookmarks.checked = showChromeBookmarks;
            this.elements.autoFocusSearch.checked = autoFocusSearch;
            this.elements.openInNewTab.checked = openInNewTab; // 初始化打开方式开关状态
            this.elements.autoPrivacySwitch.checked = autoPrivacyMode;
            this.elements.manualPrivacySwitch.checked = manualPrivacyMode;
            this.elements.manualPrivacyContainer.classList.toggle('show', !autoPrivacyMode);

            // 初始化主题选择器
            const currentTheme = themeSettings?.mode || 'system';
            this.updateThemeUI(currentTheme);

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
            updateStatus('设置更新失败', true);
        }
    }

    open() {
        this.dialog.classList.add('show');
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
            updateStatus('主题设置更新失败', true);
        }
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
        if (this.dialog.classList.contains('show')) {
            this.hide();
        }

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
                <div class="loading-text">正在搜索...</div>
            </div>
        `;
        
        const includeChromeBookmarks = await SettingsManager.get('display.showChromeBookmarks');
        const results = await searchBookmarksFromBackground(query, {
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
            title: `v${version} 版本更新内容`,
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

// 初始化与书签向量无关的部分
async function initPopupFastPass() {
    logger.debug('initPopupFastPass 开始');
    // 初始化必需的管理器
    await Promise.all([
        LocalStorageMgr.init(),
        SettingsManager.init(),
        SyncSettingsManager.init(),
    ]);

    // 初始化中间数据层
    await filterManager.init();

    // 使用缓存书签先渲染一次书签列表
    await Promise.all([
        initializeViewModeSwitch(),
        initializeSearch(),
        initializeSortDropdown(),
        window.settingsDialog.initialize(),
        refreshBookmarksInfo(),
        initializeGlobalTooltip(),
    ]);

    logger.debug('initPopupFastPass 结束');
}

// 主初始化函数
async function initializePopup() {
    logger.info(`当前环境: ${ENV.current}, SERVER_URL: ${SERVER_URL}`);
    try {        
        // 初始化UI组件
        const settingsDialog = new SettingsDialog();
        window.settingsDialog = settingsDialog;
        const bookmarkManager = getBookmarkManager();
        
        // 先初始化一部分，减少初始化时间
        await initPopupFastPass();

        // 初始化UI状态 (并行执行以提高性能)
        await Promise.all([
            bookmarkManager.initialize(),
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
