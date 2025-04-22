/**
 * 同步服务基类
 * 提供通用的配置和状态管理功能
 */
class BaseSyncService {
    constructor(serviceId, serviceCard, configDialog) {
        this.serviceCard = serviceCard;
        this.configDialog = configDialog;
        this.serviceId = serviceId;
        
        // 获取通用的DOM元素
        this.statusText = serviceCard.querySelector('.sync-status-text');
        this.statusContainer = serviceCard.querySelector('.sync-service-status');
        this.successIcon = serviceCard.querySelector('.sync-status-icon.success');
        this.errorIcon = serviceCard.querySelector('.sync-status-icon.error');
        this.syncToggle = serviceCard.querySelector('.sync-toggle');
        this.settingsBtn = serviceCard.querySelector('.sync-settings-btn');
        this.syncNowBtn = serviceCard.querySelector('.sync-now-btn');
        
        // 绑定通用事件
        this.bindCommonEvents();
    }

    /**
     * 绑定通用事件
     */
    bindCommonEvents() {
        // 同步开关事件
        if (this.syncToggle) {
            this.syncToggle.addEventListener('change', () => {
                this.handleAutoSyncToggle(this.syncToggle.checked);
            });
        }

        // 设置按钮事件
        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', () => this.showConfigDialog());
        }

        // 同步按钮事件
        if (this.syncNowBtn) {
            this.syncNowBtn.addEventListener('click', () => this.handleSyncNow());
        }
    }

    async initialize() {
        await this.updateServiceCardUI();
    }

    /**
     * 更新服务状态UI
     */
    async updateServiceCardUI() {
        const config = await this.getServiceConfig();
        const status = await this.getServiceStatus();

        const {valid} = await this.validateConfig(config);
        // 更新自动同步开关状态
        if (this.syncToggle) {
            this.syncToggle.checked = valid && this.getAutoSync(config);
        }

        // 更新同步状态
        if (status.lastSync) {
            const lastSyncTime = new Date(status.lastSync);
            const timeString = lastSyncTime.toLocaleString();
            
            if (status.lastSyncResult === 'success') {
                this.statusText.textContent = `上次同步: ${timeString}`;
                this.statusContainer.classList.remove('error');
                this.statusContainer.classList.add('success');
                this.successIcon.classList.add('show');
                this.errorIcon.classList.remove('show');
            } else {
                this.statusText.textContent = `${status.lastSyncResult}`;
                this.statusContainer.classList.remove('success');
                this.statusContainer.classList.add('error');
                this.successIcon.classList.remove('show');
                this.errorIcon.classList.add('show');
            }
        } else {
            this.statusText.textContent = '上次同步: 从未同步';
            this.statusContainer.classList.remove('success', 'error');
            this.successIcon.classList.remove('show');
            this.errorIcon.classList.remove('show');
        }
    }

    /**
     * 显示配置对话框
     */
    async showConfigDialog() {
        if (this.configDialog) {
            this.configDialog.classList.add('show');
            await this.initializeConfigForm();
        }
    }

    async handleAutoSyncToggleFailed() {
        this.showConfigDialog();
    }
    
    /**
     * 隐藏配置对话框
     */
    hideConfigDialog() {
        if (this.configDialog) {
            this.configDialog.classList.remove('show');
        }
    }

    async getServiceConfig() {
        return await SyncSettingsManager.getServiceConfig(this.serviceId);
    }

    async updateServiceConfig(config) {
        await SyncSettingsManager.updateServiceConfig(this.serviceId, config);
    }

    async getServiceStatus() {
        return await SyncStatusManager.getServiceStatus(this.serviceId);
    }

    async updateServiceStatus(status) {
        await SyncStatusManager.updateStatus(this.serviceId, status);
    }

    /**
     * 处理自动同步开关变化
     * @param {boolean} enabled - 是否启用
     */
    async handleAutoSyncToggle(enabled) {
        try {
            const config = await this.getServiceConfig();
            const { valid } = await this.validateConfig(config);
            if (!valid) {
                await this.handleAutoSyncToggleFailed();
                await this.updateServiceCardUI();
                return;
            }

            await this.updateAutoSync(enabled);

            showToast(enabled ? '已开启自动同步' : '已关闭自动同步');
        } catch (error) {
            logger.error('更新自动同步设置失败:', error);
            showToast('更新自动同步设置失败', true);
            await this.updateServiceCardUI();
        }
    }

    /**
     * 处理同步按钮点击事件
     */
    async handleSyncNow() {
        const syncBtn = this.syncNowBtn;

        try {
            const config = await this.getServiceConfig();
            const { valid, error } = await this.validateConfig(config);
            if (!valid) {
                showToast(error, true);
                return;
            }

            // 添加同步中的动画效果
            syncBtn.classList.add('syncing');
            syncBtn.disabled = true;

            // 执行同步
            await this.syncNow(config);

            showToast('同步完成');
        } catch (error) {
            logger.error(`${this.serviceId}同步失败:`, error);
            showToast(error.message, true);
        } finally {
            syncBtn.classList.remove('syncing');
            syncBtn.disabled = false;
            await this.updateServiceCardUI();
        }
    }

    /**
     * 更新自动同步状态
     * @param {boolean} autoSync - 是否启用自动同步
     */
    async updateAutoSync(autoSync) {
        throw new Error('子类必须实现 updateAutoSync 方法');
    }

    getAutoSync(config) {
        throw new Error('子类必须实现 getAutoSyncStatus 方法');
    }

    /**
     * 初始化配置对话框
     */
    async initializeConfigForm() {
        throw new Error('子类必须实现 initializeConfigForm 方法');
    }

    /**
     * 处理同步按钮点击事件
     * @param {Object} config - 配置对象
     * @returns {Object} 同步结果
     */
    async syncNow(config) {
        throw new Error('子类必须实现 handleSyncNow 方法');
    }

    /**
     * 验证配置是否有效（子类需要实现）
     * @param {Object} config - 配置对象
     * @returns {valid: boolean, error: string}
     */
    async validateConfig(config) {
        throw new Error('子类必须实现 validateConfig 方法');
    }
}

/**
 * 云同步服务类
 */
class CloudSyncService extends BaseSyncService {
    constructor(serviceCard, configDialog) {
        super('cloud', serviceCard, configDialog);

        // 登录状态元素
        this.loginStatus = this.serviceCard.querySelector('.login-status');
        this.loginStatusText = this.serviceCard.querySelector('.login-status-text');
        this.loginLink = this.serviceCard.querySelector('.login-link');

        // 配置对话框元素
        this.autoSyncCheck = this.configDialog.querySelector('#cloud-auto-sync');
        this.resetCacheBtn = this.configDialog.querySelector('.reset-cloud-cache-btn');

        this.bindEvents();
        this.checkLoginStatus();
    }

    /**
     * 绑定云同步特有的事件
     */
    bindEvents() {
        // 关闭按钮
        const closeBtn = this.configDialog.querySelector('.close-dialog-btn');
        closeBtn.addEventListener('click', () => this.hideConfigDialog());

        // 取消按钮
        const cancelBtn = this.configDialog.querySelector('.cancel-cloud-btn');
        cancelBtn.addEventListener('click', () => this.hideConfigDialog());

        // 保存按钮
        const saveBtn = this.configDialog.querySelector('.save-cloud-btn');
        saveBtn.addEventListener('click', () => this.handleSaveConfig());

        // 重置缓存按钮
        this.resetCacheBtn.addEventListener('click', () => this.handleResetCache());

        // 登录链接
        this.loginLink.addEventListener('click', (e) => {
            e.preventDefault();
            this.handleLogin();
        });
    }

    /**
     * 检查用户登录状态并更新UI
     */
    async checkLoginStatus() {
        try {
            const {valid, user} = await validateToken();

            if (valid) {
                this.updateLoginUI(user.email);
            } else {
                this.updateLogoutUI();
            }
            this.updateServiceCardUI();
        } catch (error) {
            logger.error('获取用户登录状态失败', error);
            this.updateLogoutUI();
        }
    }

    /**
     * 更新已登录UI
     * @param {string} username 用户名
     */
    updateLoginUI(username) {
        this.loginStatus.classList.add('logged-in-title');
    }

    /**
     * 更新未登录UI
     */
    updateLogoutUI() {
        this.loginStatus.classList.remove('logged-in-title');
    }

    /**
     * 处理登录按钮点击
     */
    async handleLogin() {
        // 打开登录页面
        const returnUrl = encodeURIComponent(chrome.runtime.getURL('settings.html'));
        const loginUrl = `${SERVER_URL}/login?return_url=${returnUrl}`;
        
        // 使用 window.open() 打开登录页面
        window.open(loginUrl, '_blank');
    }

    async updateAutoSync(autoSync) {
        const config = await this.getServiceConfig();
        await SyncSettingsManager.updateServiceConfig('cloud', {
            ...config,
            autoSync
        });
    }

    getAutoSync(config) {
        return config.autoSync;
    }

    /**
     * 初始化配置表单
     */
    async initializeConfigForm() {
        const config = await this.getServiceConfig();
        this.autoSyncCheck.checked = config.autoSync;
    }

    /**
     * 保存配置
     */
    async handleSaveConfig() {
        try {
            const autoSync = this.autoSyncCheck.checked;
            
            // 保存配置
            await this.updateAutoSync(autoSync);
            
            // 更新UI
            await this.updateServiceCardUI();
            
            // 关闭对话框
            this.hideConfigDialog();
            showToast('云同步配置已保存');
        } catch (error) {
            logger.error('保存云同步配置失败:', error);
            showToast('保存配置失败', true);
        }
    }

    /**
     * 处理重置云端缓存
     */
    async handleResetCache() {
        try {
            // 发送重置缓存请求
            sendMessageSafely({
                type: MessageType.RESET_CLOUD_SYNC_CACHE
            }, (response) => {
                if (response && response.success) {
                    showToast('同步缓存已重置');
                } else {
                    showToast(`重置同步缓存失败: ${response?.error || '未知错误'}`, true);
                }
            });
        } catch (error) {
            logger.error('重置同步缓存失败:', error);
            showToast(`重置同步缓存失败: ${error.message}`, true);
        }
    }

    async validateConfig(config) {
        // 云同步需要登录才能使用
        const {valid, user} = await validateToken();

        return {
            valid: valid,
            error: '请先登录账号'
        };
    }

    async handleAutoSyncToggleFailed() {
        showToast('请先登录账号', true);
    }

    /**
     * 执行同步
     */
    async syncNow(config) {
        try {
            // 向background脚本发送执行云同步的消息
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: MessageType.EXECUTE_CLOUD_SYNC
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    
                    if (response.success) {
                        resolve(response.result);
                    } else {
                        reject(new Error(response.error || '同步失败'));
                    }
                });
            });
        } catch (error) {
            throw error;
        }
    }
}

/**
 * WebDAV同步服务类
 */
class WebDAVSyncService extends BaseSyncService {
    constructor(serviceCard, configDialog) {
        super('webdav', serviceCard, configDialog);

        // 同步服务配置
        this.urlInput = this.configDialog.querySelector('#webdav-url');
        this.usernameInput = this.configDialog.querySelector('#webdav-username');
        this.passwordInput = this.configDialog.querySelector('#webdav-password');
        this.folderInput = this.configDialog.querySelector('#webdav-folder');

        // 同步数据选项
        this.bookmarksCheck = this.configDialog.querySelector('#sync-bookmarks');
        this.settingsCheck = this.configDialog.querySelector('#sync-settings');
        this.filtersCheck = this.configDialog.querySelector('#sync-filters');
        this.servicesCheck = this.configDialog.querySelector('#sync-services');

        // 同步策略
        this.autoSyncCheck = this.configDialog.querySelector('#auto-sync');
        this.intervalInput = this.configDialog.querySelector('#sync-interval');
        this.mechanismInputs = this.configDialog.querySelectorAll('input[name="sync-mechanism"]');
        this.syncEmbeddingsCheck = this.configDialog.querySelector('#sync-embeddings');

        this.bindEvents();
    }

    /**
     * 绑定WebDAV特有的事件
     */
    bindEvents() {
        // 关闭按钮
        const closeBtn = this.configDialog.querySelector('.close-dialog-btn');
        closeBtn.addEventListener('click', () => this.hideConfigDialog());

        // 取消按钮
        const cancelBtn = this.configDialog.querySelector('.cancel-btn');
        cancelBtn.addEventListener('click', () => this.hideConfigDialog());

        // 保存按钮
        const saveBtn = this.configDialog.querySelector('.save-btn');
        saveBtn.addEventListener('click', () => this.handleSaveConfig());

        // 测试连接按钮
        const testBtn = this.configDialog.querySelector('.test-connection-btn');
        testBtn.addEventListener('click', () => this.handleTestConnection());

        // 密码显示切换
        const togglePasswordBtn = this.configDialog.querySelector('.toggle-password-btn');
        const passwordInput = this.configDialog.querySelector('#webdav-password');
        togglePasswordBtn.addEventListener('click', () => {
            const type = passwordInput.type === 'password' ? 'text' : 'password';
            passwordInput.type = type;
            togglePasswordBtn.innerHTML = type === 'password' ? 
                '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z"/></svg>' :
                '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11.83,9L15,12.16C15,12.11 15,12.05 15,12A3,3 0 0,0 12,9C11.94,9 11.89,9 11.83,9M7.53,9.8L9.08,11.35C9.03,11.56 9,11.77 9,12A3,3 0 0,0 12,15C12.22,15 12.44,14.97 12.65,14.92L14.2,16.47C13.53,16.8 12.79,17 12,17A5,5 0 0,1 7,12C7,11.21 7.2,10.47 7.53,9.8M2,4.27L4.28,6.55L4.73,7C3.08,8.3 1.78,10 1,12C2.73,16.39 7,19.5 12,19.5C13.55,19.5 15.03,19.2 16.38,18.66L16.81,19.08L19.73,22L21,20.73L3.27,3M12,7A5,5 0 0,1 17,12C17,12.64 16.87,13.26 16.64,13.82L19.57,16.75C21.07,15.5 22.27,13.86 23,12C21.27,7.61 17,4.5 12,4.5C10.6,4.5 9.26,4.75 8,5.2L10.17,7.35C10.74,7.13 11.35,7 12,7Z"/></svg>';
        });

        // 自动同步开关事件
        const autoSyncCheck = this.configDialog.querySelector('#auto-sync');
        const intervalInput = this.configDialog.querySelector('#sync-interval');
        autoSyncCheck.addEventListener('change', () => {
            intervalInput.disabled = !autoSyncCheck.checked;
        });
    }

    async updateAutoSync(autoSync) {
        const config = await this.getServiceConfig();
        await SyncSettingsManager.updateServiceConfig('webdav', {
            ...config,
            syncStrategy: {
                ...config.syncStrategy,
                autoSync: autoSync
            }
        });
    }

    getAutoSync(config) {
        return config.syncStrategy.autoSync;
    }

    async initializeConfigForm() {
        const config = await this.getServiceConfig();
        // 服务器信息
        this.urlInput.value = config.server.url || '';
        this.usernameInput.value = config.server.username || '';
        this.passwordInput.value = config.server.password || '';
        this.folderInput.value = config.server.folder || '';

        // 同步数据选项
        this.bookmarksCheck.checked = config.syncData.bookmarks;
        this.settingsCheck.checked = config.syncData.settings;
        this.filtersCheck.checked = config.syncData.filters;
        this.servicesCheck.checked = config.syncData.services;

        // 同步策略
        this.autoSyncCheck.checked = config.syncStrategy.autoSync;
        this.intervalInput.value = config.syncStrategy.interval || 30;
        this.intervalInput.disabled = !this.autoSyncCheck.checked;
        this.syncEmbeddingsCheck.checked = config.syncStrategy.syncEmbeddings;
        
        // 设置同步机制单选框
        this.mechanismInputs.forEach(input => {
            if (input.value === config.syncStrategy.mechanism) {
                input.checked = true;
            }
        });
    }

    async validateConfig(config) {
        // 验证URL
        if (!config.server.url) {
            return {
                valid: false,
                error: '服务器地址不能为空'
            };
        }

        try {
            new URL(config.server.url);
        } catch {
            return {
                valid: false,
                error: '无效的服务器地址'
            };
        }

        // 验证用户名和密码
        if (!config.server.username || !config.server.password) {
            return {
                valid: false,
                error: '用户名和密码不能为空'
            };
        }

        // 验证同步间隔
        if (config.syncStrategy.autoSync) {
            const interval = config.syncStrategy.interval;
            if (isNaN(interval) || interval < 5 || interval > 1440) {
                return {
                    valid: false,
                    error: '同步间隔必须在5分钟-24小时之间'
                };
            }
        }

        // 验证至少选择了一项要同步的数据
        const hasSelectedData = Object.values(config.syncData).some(value => value);
        if (!hasSelectedData) {
            return {
                valid: false,
                error: '请至少选择一项要同步的数据'
            };
        }

        return {
            valid: true,
            error: null
        };
    }

    async handleSaveConfig() {
        try {
            const config = this.getFormData();
            
            // 验证必填字段
            const { valid, error } = await this.validateConfig(config);
            if (!valid) {
                showToast(error, true);
                return;
            }

            // 保存配置
            await this.updateServiceConfig(config);

            // 更新UI
            await this.updateServiceCardUI();

            // 关闭对话框
            this.hideConfigDialog();
            showToast('WebDAV 配置已保存');
        } catch (error) {
            logger.error('保存WebDAV配置失败:', error);
            showToast('保存配置失败', true);
        }
    }

    getFormData() {
        return {
            server: {
                url: this.urlInput.value.trim(),
                username: this.usernameInput.value.trim(),
                password: this.passwordInput.value,
                folder: this.folderInput.value.trim()
            },
            syncData: {
                bookmarks: this.bookmarksCheck.checked,
                settings: this.settingsCheck.checked,
                filters: this.filtersCheck.checked,
                services: this.servicesCheck.checked
            },
            syncStrategy: {
                autoSync: this.autoSyncCheck.checked,
                interval: parseInt(this.intervalInput.value),
                mechanism: this.configDialog.querySelector('input[name="sync-mechanism"]:checked').value,
                syncEmbeddings: this.syncEmbeddingsCheck.checked
            }
        };
    }

    async handleTestConnection() {
        const testBtn = this.configDialog.querySelector('.test-connection-btn');
        const testBtnText = testBtn.querySelector('span');
        const config = this.getFormData();

        // 验证配置
        const { valid, error } = await this.validateConfig(config);
        if (!valid) {
            showToast(error, true);
            return;
        }

        try {
            // 禁用测试按钮
            testBtn.disabled = true;
            testBtn.classList.add('testing');
            testBtnText.textContent = '测试中...';

            // 执行连接测试
            await this.testConnection(config);
            
            // 如果没有抛出错误，则测试成功
            showToast('连接测试成功！WebDAV服务器配置有效');
        } catch (error) {
            logger.error('WebDAV连接测试失败:', error);
            showToast(`${error.message}`, true);
        } finally {
            // 恢复测试按钮
            testBtn.disabled = false;
            testBtn.classList.remove('testing');
            testBtnText.textContent = '测试连接';
        }
    }

    /**
     * 测试WebDAV连接
     * @param {Object} config - WebDAV配置
     * @throws {Error} 如果连接测试失败
     */
    async testConnection(config) {
        const { url, username, password, folder } = config.server;
        
        // 创建WebDAV客户端
        const client = new WebDAVClient(url, username, password);
        
        // 测试连接并检查文件夹
        return await client.testConnection(folder);
    }

    /**
     * 处理同步按钮点击事件
     * @param {Object} config - 配置对象
     * @returns {Object} 同步结果
     */
    async syncNow(config) {
        try {
            // 向background脚本发送执行WebDAV同步的消息
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: MessageType.EXECUTE_WEBDAV_SYNC
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    
                    if (response.success) {
                        resolve(response.result);
                    } else {
                        reject(new Error(response.error || '同步失败'));
                    }
                });
            });
        } catch (error) {
            throw error;
        }
    }
}