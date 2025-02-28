EnvIdentifier = 'settings';

class BaseSettingsTab {
    constructor() {
        this.section = null;
    }

    initialize() {
        // 子类实现具体初始化逻辑
    }

    show() {
        if (this.section) {
            this.section.style.display = 'block';
        }
    }

    hide() {
        if (this.section) {
            this.section.style.display = 'none';
        }
    }

    cleanup() {
        // 清理工作（如果需要）
    }
}

function showToast(message, error = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    if (error) {
        toast.classList.add('error');
    }else {
        toast.classList.remove('error');
    }
    // 2.5秒后隐藏
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2500);
}

class OverviewSettingsTab extends BaseSettingsTab {
    constructor() {
        super();
        this.section = document.getElementById('overview-section');
        this.statusDiv = document.getElementById('loginStatus');
        this.actionDiv = document.getElementById('actionButtons');
        
        // 添加搜索设置相关元素
        this.maxSearchResults = document.getElementById('max-search-results');
        this.omniboxSearchLimit = document.getElementById('omnibox-search-limit');
        this.quickSearchSitesDisplay = document.getElementById('quick-search-sites-display');
        this.sitesDisplayCount = document.getElementById('sites-display-count');
        this.sitesDisplayCountContainer = document.getElementById('sites-display-count-container');
        this.showSearchHistory = document.getElementById('show-search-history');

        // 添加快捷键相关元素
        this.quickSaveShortcut = document.getElementById('quickSave-shortcut');
        this.quickSearchShortcut = document.getElementById('quickSearch-shortcut');
        this.editShortcutsBtn = document.getElementById('edit-shortcuts-btn');
        
        // 获取模板
        this.loggedInTemplate = document.getElementById('logged-in-template');
        this.loggedOutTemplate = document.getElementById('logged-out-template');
        
        // 绑定方法到实例
        this.checkLoginStatus = this.checkLoginStatus.bind(this);
        this.handleLogout = this.handleLogout.bind(this);
        this.handleMaxSearchResultsChange = this.handleMaxSearchResultsChange.bind(this);
        this.handleOmniboxSearchLimitChange = this.handleOmniboxSearchLimitChange.bind(this);
        this.handleSitesDisplayChange = this.handleSitesDisplayChange.bind(this);
        this.handleSitesDisplayCountChange = this.handleSitesDisplayCountChange.bind(this);
        this.handleSearchHistoryChange = this.handleSearchHistoryChange.bind(this);
    }

    async initialize() {
        await this.initializeSearchSettings();
        await this.initializeThemeSettings();
        await this.checkLoginStatus();
        await this.initializeShortcuts();
        this.setupEventListeners();
        this.setupStorageListener();
    }

    async initializeSearchSettings() {
        // 获取当前设置
        const settings = await SettingsManager.getAll();
        this.maxSearchResults.value = settings.search.maxResults || 50;
        this.omniboxSearchLimit.value = settings.search.omniboxSearchLimit || 5;
        this.showSearchHistory.checked = settings.search.showSearchHistory;
        const sitesDisplay = settings.search.sitesDisplay || 'pinned';
        this.quickSearchSitesDisplay.value = sitesDisplay;
        this.sitesDisplayCount.value = settings.search.sitesDisplayCount || 10;
        this.sitesDisplayCountContainer.style.display = 
            (sitesDisplay === 'pinned' || sitesDisplay === 'none') ? 'none' : 'flex';
    }

    async initializeThemeSettings() {
        try {
            const settings = await SettingsManager.get('display.theme');
            this.updateThemeUI(settings.mode);
            
            // 添加主题选择事件监听
            const themeOptions = document.querySelectorAll('.theme-option');
            themeOptions.forEach(option => {
                option.addEventListener('click', () => {
                    const theme = option.dataset.theme;
                    this.handleThemeChange(theme);
                });
            });
        } catch (error) {
            logger.error('初始化主题设置失败:', error);
        }
    }

    updateThemeUI(theme) {
        // 移除所有选项的active状态
        document.querySelectorAll('.theme-option').forEach(option => {
            option.classList.remove('active');
        });
        
        // 添加当前选中选项的active状态
        const activeOption = document.querySelector(`.theme-option[data-theme="${theme}"]`);
        if (activeOption) {
            activeOption.classList.add('active');
        }
    }

    async handleThemeChange(theme) {
        try {
            await themeManager.updateTheme({
                mode: theme
            });
            this.updateThemeUI(theme);
            showToast('主题设置已更新');
        } catch (error) {
            logger.error('更新主题失败:', error);
            showToast('主题设置更新失败', true);
        }
    }

    setupEventListeners() {
        this.maxSearchResults.addEventListener('change', this.handleMaxSearchResultsChange);
        this.omniboxSearchLimit.addEventListener('change', this.handleOmniboxSearchLimitChange);
        this.showSearchHistory.addEventListener('change', this.handleSearchHistoryChange);
        this.editShortcutsBtn.addEventListener('click', () => this.handleEditShortcuts());

        // 添加网站显示设置的事件监听
        this.quickSearchSitesDisplay.addEventListener('change', this.handleSitesDisplayChange);
        this.sitesDisplayCount.addEventListener('change', this.handleSitesDisplayCountChange);
    }

    setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local') {  // 确保是监听sync storage
                // 监听API Keys的变化
                if (changes['token']) {
                    logger.info('token changed');
                    this.checkLoginStatus();
                }
            }
        });
    }

    async checkLoginStatus() {
        logger.debug('开始检查登录状态', Date.now()/1000);
        const {valid, user} = await validateToken();
        if (!valid) {
            this.showLoggedOutState();
            return;
        }
        this.showLoggedInState(user.email);
        logger.debug('检查登录状态完成', Date.now()/1000);
    }

    showLoggedInState(username) {
        // 克隆模板
        const content = this.loggedInTemplate.content.cloneNode(true);
        
        // 设置用户名
        content.querySelector('.username').textContent = username;
        
        // 添加登出按钮事件监听
        const logoutBtn = content.querySelector('.logout-btn');
        logoutBtn.addEventListener('click', this.handleLogout);
        
        // 清空并添加新内容
        this.statusDiv.innerHTML = '';
        this.actionDiv.innerHTML = '';
        this.statusDiv.appendChild(content.querySelector('.status-box'));
        this.actionDiv.appendChild(content.querySelector('.status-actions'));
    }

    showLoggedOutState() {
        // 克隆模板
        const content = this.loggedOutTemplate.content.cloneNode(true);
        
        // 设置登录链接
        const loginLink = content.querySelector('.login-btn');
        // 移除 href 属性，改用点击事件处理
        loginLink.removeAttribute('href');
        loginLink.addEventListener('click', () => {
            const returnUrl = encodeURIComponent(chrome.runtime.getURL('settings.html'));
            const loginUrl = `${SERVER_URL}/login?return_url=${returnUrl}`;
            
            // 使用 window.open() 打开登录页面
            const loginWindow = window.open(loginUrl, 'login', 
                'width=500,height=600,resizable=yes,scrollbars=yes,status=yes');
            
            // 可以存储引用以便后续使用
            this.loginWindow = loginWindow;
        });
        
        // 清空并添加新内容
        this.statusDiv.innerHTML = '';
        this.actionDiv.innerHTML = '';
        this.statusDiv.appendChild(content.querySelector('.status-box'));
        this.actionDiv.appendChild(content.querySelector('.status-actions'));
    }

    async handleLogout() {
        await LocalStorageMgr.remove(['token']);
    }


    async handleMaxSearchResultsChange() {
        logger.debug('handleMaxSearchResultsChange', this.maxSearchResults.value);

        const value = parseInt(this.maxSearchResults.value);
        if (value >= 1 && value <= 100) {
            await SettingsManager.update({
                search: {
                    maxResults: value
                }
            });
            showToast('设置已保存');
        } else {
            this.maxSearchResults.value = 50; // 重置为默认值
        }
    }

    async handleOmniboxSearchLimitChange() {
        logger.debug('handleOmniboxSearchLimitChange', this.omniboxSearchLimit.value);

        const value = parseInt(this.omniboxSearchLimit.value);
        if (value >= 1 && value <= 9) {
            await SettingsManager.update({
                search: {
                    omniboxSearchLimit: value
                }
            });
            showToast('设置已保存');
        } else {
            this.omniboxSearchLimit.value = 5; // 重置为默认值
        }
    }

    // 初始化快捷键显示
    async initializeShortcuts() {
        try {
            const commands = await chrome.commands.getAll();
            commands.forEach(command => {
                if (command.name === '_execute_action') return; // 跳过默认的扩展图标快捷键
                
                switch (command.name) {
                    case 'quick-save':
                        this.quickSaveShortcut.textContent = command.shortcut || '未设置';
                        break;
                    case 'quick-search':
                        this.quickSearchShortcut.textContent = command.shortcut || '未设置';
                        break;
                }
            });
        } catch (error) {
            console.error('获取快捷键设置失败:', error);
        }
    }

    // 处理编辑快捷键按钮点击
    handleEditShortcuts() {
        // 打开 Chrome 扩展快捷键设置页面
        chrome.tabs.create({
            url: 'chrome://extensions/shortcuts'
        });
    }

    async handleSitesDisplayChange() {
        const displayType = this.quickSearchSitesDisplay.value;
        
        // 显示/隐藏数量设置
        this.sitesDisplayCountContainer.style.display = 
            (displayType === 'pinned' || displayType === 'none') ? 'none' : 'flex';

        try {
            await SettingsManager.update({
                search: {
                    sitesDisplay: displayType
                }
            });
            showToast('设置已保存');
        } catch (error) {
            logger.error('保存网站显示设置失败:', error);
            showToast('保存设置失败: ' + error.message, true);
        }
    }

    async handleSitesDisplayCountChange() {
        let count = parseInt(this.sitesDisplayCount.value);
        if (isNaN(count)) {
            showToast('显示数量必须是数字', true);
            return;
        }
        if (count < 1) {
            this.sitesDisplayCount.value = 1;
            count = 1;
        }
        if (count > 50) {
            this.sitesDisplayCount.value = 50;
            count = 50;
        }

        try {
            await SettingsManager.update({
                search: {
                    sitesDisplayCount: count
                }
            });
            showToast('设置已保存');
        } catch (error) {
            logger.error('保存显示数量设置失败:', error);
            showToast('保存设置失败: ' + error.message, true);
        }
    }

    async handleSearchHistoryChange() {
        try {
            const showSearchHistory = this.showSearchHistory.checked;
            await SettingsManager.update({
                search: {
                    showSearchHistory: showSearchHistory
                }
            });
            showToast('设置已保存');
        } catch (error) {
            logger.error('保存搜索历史显示设置失败:', error);
            showToast('保存设置失败: ' + error.message, true);
        }
    }

    cleanup() {
    }
}

class PrivacySettingsTab extends BaseSettingsTab {
    constructor() {
        super();
        this.section = document.getElementById('privacy-section');
        this.domainsList = document.getElementById('domains-list');
        this.addDomainBtn = document.getElementById('add-domain-btn');
        this.addDomainDialog = document.getElementById('add-domain-dialog');
        this.domainInput = document.getElementById('domain-input');
        this.saveDomainBtn = document.getElementById('save-domain-btn');
        this.cancelDomainBtn = document.getElementById('cancel-domain-btn');

        this.handleEscKey = this.handleEscKey.bind(this);
    }

    async initialize() {
        logger.debug('开始初始化隐私设置', Date.now()/1000);
        try {
            const settings = await SettingsManager.getAll();
            if (settings?.privacy?.customDomains) {
                this.renderDomainsList(settings.privacy.customDomains);
            }
        } catch (error) {
            logger.error('Failed to load settings:', error);
        }
        await this.bindEvents();
        logger.debug('初始化隐私设置完成', Date.now()/1000);
    }

    async bindEvents() {
        this.addDomainBtn.addEventListener('click', () => {
            this.showAddDomainDialog();
        });

        this.saveDomainBtn.addEventListener('click', async () => {
            await this.saveDomain();
        });

        this.cancelDomainBtn.addEventListener('click', () => {
            this.hideAddDomainDialog();
        });
    }

    renderDomainsList(domains) {
        this.domainsList.innerHTML = '';
        
        domains.forEach(domain => {
            const domainItem = document.createElement('div');
            domainItem.className = 'domain-item';
            domainItem.innerHTML = `
                <span class="domain-text">${domain}</span>
                <button class="remove-domain-btn" data-domain="${domain}">×</button>
            `;
            
            const removeBtn = domainItem.querySelector('.remove-domain-btn');
            removeBtn.addEventListener('click', () => this.removeDomain(domain));
            
            this.domainsList.appendChild(domainItem);
        });
    }

    showAddDomainDialog() {
        this.addDomainDialog.classList.add('show');
        this.domainInput.value = '';
        this.domainInput.focus();
    }

    hideAddDomainDialog() {
        this.addDomainDialog.classList.remove('show');
        this.domainInput.value = '';
    }

    async saveDomain() {
        const domain = this.domainInput.value.trim();
        if (!domain) return;

        try {
            if (!this.isValidDomainPattern(domain)) {
                throw new Error('无效的域名格式');
            }

            const settings = await SettingsManager.getAll();
            const customDomains = settings.privacy.customDomains || [];
            
            if (customDomains.includes(domain)) {
                throw new Error('该域名已存在');
            }

            await SettingsManager.update({
                privacy: {
                    customDomains: [...customDomains, domain]
                }
            });

            this.renderDomainsList([...customDomains, domain]);
            this.hideAddDomainDialog();

        } catch (error) {
            alert(error.message);
        }
    }

    async removeDomain(domain) {
        const settings = await SettingsManager.getAll();
        const customDomains = settings.privacy.customDomains || [];
        
        const newDomains = customDomains.filter(d => d !== domain);
        
        await SettingsManager.update({
            privacy: {
                customDomains: newDomains
            }
        });

        this.renderDomainsList(newDomains);
    }

    isValidDomainPattern(pattern) {
        try {
            if (pattern.startsWith('/') && pattern.endsWith('/')) {
                new RegExp(pattern.slice(1, -1));
                return true;
            }

            const domainPattern = /^(?:\*\.)?[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)*$/;
            return domainPattern.test(pattern);
        } catch {
            return false;
        }
    }

    handleEscKey(e) {
        if (e.key === 'Escape' && this.addDomainDialog.classList.contains('show')) {
            this.hideAddDomainDialog();
        }
    }

    cleanup() {
    }
}

class ServicesSettingsTab extends BaseSettingsTab {
    constructor() {
        super();
        this.section = document.getElementById('services-section');
        this.serviceConfigDialog = document.getElementById('service-config-dialog');
        this.customServiceDialog = document.getElementById('custom-service-dialog');
        this.currentService = null;

        this.handleEscKey = this.handleEscKey.bind(this);
        this.handleCopyConfig = this.handleCopyConfig.bind(this);
        this.handlePasteConfig = this.handlePasteConfig.bind(this);
    }

    async initialize() {
        logger.debug('开始初始化服务设置', Date.now()/1000);
        await this.initializeAPIServices();
        this.initializeServiceConfigDialog();
        this.initializeCustomServiceDialog();
        this.initializeCopyPasteButtons();
        await this.updateStatsUI();
        logger.debug('初始化服务设置完成', Date.now()/1000);
    }

    // 初始化复制粘贴按钮
    initializeCopyPasteButtons() {
        // 为所有复制按钮添加事件监听
        const copyButtons = document.querySelectorAll('.copy-config-btn');
        copyButtons.forEach(btn => {
            btn.addEventListener('click', this.handleCopyConfig);
        });

        // 为粘贴按钮添加事件监听
        const pasteButton = this.customServiceDialog.querySelector('.paste-config-btn');
        if (pasteButton) {
            pasteButton.addEventListener('click', this.handlePasteConfig);
        }
    }

    // 处理复制配置
    async handleCopyConfig(event) {
        const dialog = event.target.closest('.dialog');
        let serviceId = null;
        if (dialog?.id === 'service-config-dialog') {
            if (this.currentService) {
                serviceId = this.currentService.id;
            }
        } else if (dialog?.id === 'custom-service-dialog') {
            serviceId = dialog.dataset.service;
        }

        const config = await ConfigManager.findServiceById(serviceId);
        if (!config) {
            showToast('服务配置不存在', true);
            return;
        }

        try {
            await navigator.clipboard.writeText(JSON.stringify(config));
            showToast('配置已复制到剪贴板');
        } catch (error) {
            showToast('复制失败：' + error.message, true);
        }
    }

    // 处理粘贴配置
    async handlePasteConfig() {
        try {
            let config = null;
            const text = await navigator.clipboard.readText();
            try {
                config = JSON.parse(text);
            } catch (error) {
                throw new Error('配置格式不正确, 请检查剪贴板内容');
            }

            if (!config.id || !config.name || !config.baseUrl) {
                throw new Error('配置格式不正确, 请检查剪贴板内容');
            }

            const dialog = this.customServiceDialog;
            
            const nameInput = dialog.querySelector('#custom-service-name');
            nameInput.value = '';
            const nameFormGroup = nameInput.closest('.form-group');
            nameFormGroup.setAttribute('data-char-count', `${nameInput.value.length}/${nameInput.maxLength}`);

            dialog.querySelector('#custom-base-url').value = config.baseUrl || '';
            dialog.querySelector('#custom-chat-model').value = config.chatModel || '';
            dialog.querySelector('#custom-embed-model').value = config.embedModel || '';
            dialog.querySelector('#custom-api-key').value = config.apiKey || '';
            dialog.querySelector('#similarity-threshold').value = config.highSimilarity || config.similarityThreshold?.MEDIUM || 0.35;
            dialog.querySelector('#hide-low-similarity').checked = config.hideLowSimilarity === true;
            dialog.querySelector('.threshold-value').textContent = config.highSimilarity || config.similarityThreshold?.MEDIUM || 0.35;

            // 重置测试状态
            dialog.querySelectorAll('.test-status').forEach(el => {
                el.textContent = '';
                el.className = 'test-status';
            });
            showToast(`${config.name} 配置已粘贴`);
        } catch (error) {
            if (error.message.includes('Read permission denied')) {
                showToast('没有权限，请允许此网站查看剪贴板', true);
            } else {
                showToast(error.message, true);
            }
        }
    }

    async initializeAPIServices() {
        const serviceSelect = document.getElementById('active-service-select');
        const servicesGrid = document.querySelector('.api-services-grid');
        
        const activeService = await ConfigManager.getActiveService();

        // 添加内置服务
        for (const service of Object.values(API_SERVICES)) {
            const option = document.createElement('option');
            option.value = service.id;
            option.textContent = service.name;
            const isActive = service.id === activeService.id;   
            option.selected = isActive;
            serviceSelect.appendChild(option);

            const serviceConfig = await ConfigManager.findServiceById(service.id);
            const serviceCard = this.createServiceCard(serviceConfig, isActive);
            servicesGrid.appendChild(serviceCard);
        }

        // 添加自定义服务
        const customServices = await ConfigManager.getCustomServices();
        for (const service of Object.values(customServices)) {
            const option = document.createElement('option');
            option.value = service.id;
            option.textContent = service.name;
            const isActive = service.id === activeService.id;
            option.selected = isActive;
            serviceSelect.appendChild(option);

            const serviceCard = this.createServiceCard(service, isActive);
            servicesGrid.appendChild(serviceCard);
        }

        // 添加"添加自定义服务"卡片
        const addCustomCard = this.createAddCustomServiceCard();
        servicesGrid.appendChild(addCustomCard);
        await this.updateAddCustomServiceCard();

        serviceSelect.addEventListener('change', async (e) => {
            logger.debug('change active service', e.target.value);
            await ConfigManager.setActiveService(e.target.value);
            this.updateActiveService(e.target.value);
        });
    }

    async updateStatsUI() {
        const stats = await statsManager.loadStats();

        // 更新显示的统计数据
        const elements = {
            chatCalls: document.getElementById('chat-calls'),
            chatInputTokens: document.getElementById('chat-input-tokens'),
            chatOutputTokens: document.getElementById('chat-output-tokens'),
            embeddingCalls: document.getElementById('embedding-calls'),
            embeddingTokens: document.getElementById('embedding-tokens')
        };

        if (elements.chatCalls) {
            elements.chatCalls.textContent = stats.chat.calls.toLocaleString();
            elements.chatInputTokens.textContent = stats.chat.inputTokens.toLocaleString();
            elements.chatOutputTokens.textContent = stats.chat.outputTokens.toLocaleString();
        }

        if (elements.embeddingCalls) {
            elements.embeddingCalls.textContent = stats.embedding.calls.toLocaleString();
            elements.embeddingTokens.textContent = stats.embedding.tokens.toLocaleString();
        }
    }

    async updateActiveServiceUI(serviceId) {
        const serviceSelect = document.getElementById('active-service-select');
        serviceSelect.value = serviceId;
        this.updateActiveService(serviceId);
    }

    createServiceCard(service, isActive) {
        const apiKey = service.apiKey;
        const card = document.createElement('div');
        card.className = 'service-card';
        card.setAttribute('data-service', service.id);
        
        const isCustom = service.isCustom;
        const logoUrl = isCustom ? 'icons/logo-custom.svg' : `icons/${service.logo}`;
        card.innerHTML = `
            <div class="service-card-header">
                <div class="service-logo">
                    <img src="${logoUrl}" alt="${service.name}">
                </div>
                <div class="service-info">
                    <h3 class="service-name">${service.name}</h3>
                </div>
            </div>
            <p class="service-description">
                ${isCustom ? '自定义API服务' : service.description || ''}
            </p>
            <div class="service-status">
                <div class="api-status ${apiKey ? 'configured' : ''}"></div>
                <div class="status-toggle ${isActive ? 'active' : ''}"></div>
            </div>
            ${isCustom ? `
                <button class="delete-service-btn" title="删除服务">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>
                    </svg>
                </button>
            ` : ''}`;

        // 添加推荐标签
        if (service.recommendTags && service.recommendTags.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'recommend-tags';
            service.recommendTags.forEach(tag => {
                const tagElement = document.createElement('span');
                tagElement.className = 'recommend-tag';
                tagElement.textContent = tag;
                tagsContainer.appendChild(tagElement);
            });
            card.appendChild(tagsContainer);
        }
        
        card.querySelector('.delete-service-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteCustomService(service.id);
        });

        card.addEventListener('click', async () => {
            if (service.isCustom) {
                await this.showCustomServiceDialog(service.id);
            } else {
                await this.showServiceConfigDialog(service.id);
            }
        });

        const img = card.querySelector('img');
        img.addEventListener('error', () => {
            img.src = 'icons/default_favicon.png';
        });

        return card;
    }

    createAddCustomServiceCard() {
        const card = document.createElement('div');
        card.className = 'service-card add-custom-card';
        card.innerHTML = `
            <div class="add-custom-content">
                <div class="add-icon">+</div>
                <div class="add-text">添加 OpenAI 兼容服务</div>
            </div>
        `;

        card.addEventListener('click', async () => {
            const customServices = await ConfigManager.getCustomServices();
            if (Object.keys(customServices).length >= MAX_CUSTOM_SERVICES) {
                alert(`最多只能添加${MAX_CUSTOM_SERVICES}个自定义服务`);
                return;
            }
            this.showCustomServiceDialog();
        });

        return card;
    }

    // ServicesSettingsTab 类的继续
    initializeServiceConfigDialog() {
        const dialog = this.serviceConfigDialog;
        const apiKeyInput = dialog.querySelector('.service-api-key');
        
        dialog.querySelector('.toggle-visibility').addEventListener('click', () => {
            if (apiKeyInput.type === 'password') {
                apiKeyInput.type = 'text';
                dialog.querySelector('.toggle-visibility svg').innerHTML = `
                    <path d="M13.359 11.238L15 9.597V9.5C15 7.5 12.5 4 8 4C7.359 4 6.734 4.102 6.133 4.281L7.582 5.73C7.719 5.705 7.857 5.687 8 5.687C10.617 5.687 12.75 7.82 12.75 10.437C12.75 10.582 12.734 10.718 12.707 10.856L13.359 11.238Z" fill="currentColor"/>
                    <path d="M2.727 2L1.5 3.227L3.969 5.696C2.891 6.754 2.086 8.043 1.75 9.5C1.75 11.5 4.25 15 8.75 15C9.734 15 10.676 14.8 11.547 14.445L13.273 16.171L14.5 14.944L2.727 2ZM8.75 13.312C6.133 13.312 4 11.18 4 8.562C4 8.273 4.031 7.992 4.086 7.719L5.945 9.578C5.969 10.742 6.914 11.687 8.078 11.711L9.937 13.57C9.555 13.469 9.156 13.312 8.75 13.312Z" fill="currentColor"/>
                `;
            } else {
                apiKeyInput.type = 'password';
                dialog.querySelector('.toggle-visibility svg').innerHTML = `
                    <path d="M8 3C4.5 3 2 6 2 8C2 10 4.5 13 8 13C11.5 13 14 10 14 8C14 6 11.5 3 8 3Z" stroke="currentColor" fill="none"/>
                    <circle cx="8" cy="8" r="2" fill="currentColor"/>
                `;
            }
        });
        
        dialog.querySelector('.save-key').addEventListener('click', async () => {
            await this.saveBuiltinServiceSettings();
        });
        
        dialog.querySelector('.verify-key').addEventListener('click', async () => {
            await this.verifyBuiltinServiceSettings();
        });

        dialog.querySelector('.close-dialog-btn').addEventListener('click', () => {
            this.closeServiceConfigDialog();
        });   

        const apiServiceStatus = dialog.querySelector('.api-service-status');
        apiServiceStatus.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(apiServiceStatus.textContent);
                showToast('已复制到剪贴板');
            } catch (err) {
                logger.error('复制失败:', err);
            }
        });    

         // 添加编辑按钮点击事件
         const editModelBtn = dialog.querySelector('.edit-model-btn');
         const chatModelInput = dialog.querySelector('.chat-model input');
         editModelBtn.addEventListener('click', () => {
            if (chatModelInput.readOnly) {
                chatModelInput.readOnly = false;
                editModelBtn.classList.add('active');
                chatModelInput.focus();
            } else {
                chatModelInput.readOnly = true;
                editModelBtn.classList.remove('active');
            }
        });

        // 添加输入框失焦事件
        chatModelInput.addEventListener('blur', () => {
            chatModelInput.value = chatModelInput.value.trim();
            chatModelInput.readOnly = true;
            editModelBtn.classList.remove('active');
        });

        // 添加输入框回车事件
        chatModelInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                chatModelInput.blur();
            }
        });
    }

    async saveBuiltinServiceSettings() {
        if (!this.currentService) return;
        const dialog = this.serviceConfigDialog;
        const chatModelInput = dialog.querySelector('.chat-model input');
        const verifyIcon = dialog.querySelector('.verify-icon');
        const apiKeyInput = dialog.querySelector('.service-api-key');
        const apiServiceStatus = dialog.querySelector('.api-service-status');
            
        try {
            this.updateStatus(apiServiceStatus, '正在保存...', 'verifying');
            verifyIcon.classList.remove('success', 'error');

            const apiKey = apiKeyInput.value.trim();
            const setting = {
                chatModel: chatModelInput.value.trim()
            };
            await ConfigManager.saveBuiltinAPIKey(this.currentService.id, apiKey, setting);
            this.updateStatus(apiServiceStatus, '保存成功', 'success');
            this.updateServiceCardStatus(this.currentService.id, true);

            // 检查是否有激活的API服务
            const activeApiKey = await ConfigManager.getActiveAPIKey();
            if (!activeApiKey) {
                await ConfigManager.setActiveService(this.currentService.id);
                // 更新UI显示
                this.updateActiveServiceUI(this.currentService.id);
            }
            this.closeServiceConfigDialog();
        } catch (error) {
            this.updateStatus(apiServiceStatus, error.message, 'error');
            verifyIcon.classList.add('error');
        }
    }

    async verifyBuiltinServiceSettings() {
        if (!this.currentService) return;
        const dialog = this.serviceConfigDialog;
        const chatModelInput = dialog.querySelector('.chat-model input');
        const verifyIcon = dialog.querySelector('.verify-icon');
        const apiKeyInput = dialog.querySelector('.service-api-key');
        const apiServiceStatus = dialog.querySelector('.api-service-status'); 

        try {
            this.updateStatus(apiServiceStatus, '正在验证...', 'verifying');
            verifyIcon.classList.remove('success', 'error');
            
            const chatModel = chatModelInput.value.trim();
            const apiKey = apiKeyInput.value.trim();
            await ConfigManager.verifyAPIKey(this.currentService.id, apiKey, chatModel);
            this.updateStatus(apiServiceStatus, 'API Key 有效', 'success');
            verifyIcon.classList.add('success');
        } catch (error) {
            this.updateStatus(apiServiceStatus, error.message, 'error');
            verifyIcon.classList.add('error');
        }
    }

    async showServiceConfigDialog(serviceId) {
        const dialog = this.serviceConfigDialog;
        const service = await ConfigManager.findServiceById(serviceId);
        const apiKey = service.apiKey;
        this.currentService = service;
        
        dialog.querySelector('.service-name').textContent = `${service.name} 配置`;
        dialog.querySelector('.get-key-link').href = service.getKeyUrl;
        dialog.querySelector('.model-pricing-link').href = service.pricingUrl;
        
        const apiKeyInput = dialog.querySelector('.service-api-key');
        apiKeyInput.value = apiKey || '';
        
        dialog.querySelector('.api-service-status').textContent = '';
        dialog.querySelector('.verify-icon').classList.remove('success', 'error');

        // 更新模型信息
        const chatModelInput = dialog.querySelector('.chat-model input');
        chatModelInput.value = service.chatModel || '';
        chatModelInput.readOnly = true;
        const editModelBtn = dialog.querySelector('.edit-model-btn');
        editModelBtn.classList.remove('active');

        const embeddingModelEl = dialog.querySelector('.embedding-model');
        embeddingModelEl.textContent = service.embedModel;

        dialog.classList.add('show');
    }

    closeServiceConfigDialog() {
        this.serviceConfigDialog.classList.remove('show');
        this.currentService = null;
    }

    updateServiceCardStatus(serviceId, hasApiKey) {
        const card = document.querySelector(`.service-card[data-service="${serviceId}"]`);
        if (card) {
            const apiStatus = card.querySelector('.api-status');
            if (hasApiKey) {
                apiStatus.classList.add('configured');
            } else {
                apiStatus.classList.remove('configured');
            }
        }
    }

    updateStatus(element, message, type) {
        element.textContent = message;
        element.className = `api-service-status ${type}`;
        element.title = message;
    }

    updateActiveService(serviceId) {
        document.querySelectorAll('.service-card').forEach(card => {
            if (card.classList.contains('add-custom-card')) return;
            const toggle = card.querySelector('.status-toggle');
            if (card.getAttribute('data-service') === serviceId) {
                toggle.classList.add('active');
            } else {
                toggle.classList.remove('active');
            }
        });
    }

    async showCustomServiceDialog(serviceId) {
        const dialog = this.customServiceDialog;
        const defaultCustomService = {
            id: 'custom_' + Date.now(),
            highSimilarity: 0.35,
            hideLowSimilarity: false
        };
        const service = await ConfigManager.findServiceById(serviceId);
        const customService = service || defaultCustomService;
        dialog.dataset.service = customService.id;
        
        // 填充现有配置
        const nameInput = dialog.querySelector('#custom-service-name');
        nameInput.value = customService.name || '';
        const nameFormGroup = nameInput.closest('.form-group');
        nameFormGroup.setAttribute('data-char-count', `${nameInput.value.length}/${nameInput.maxLength}`);

        dialog.querySelector('#custom-base-url').value = customService.baseUrl || '';
        dialog.querySelector('#custom-chat-model').value = customService.chatModel || '';
        dialog.querySelector('#custom-embed-model').value = customService.embedModel || '';
        dialog.querySelector('#custom-api-key').value = customService.apiKey || '';
        dialog.querySelector('#similarity-threshold').value = customService.highSimilarity;
        dialog.querySelector('#hide-low-similarity').checked = customService.hideLowSimilarity === true;
        dialog.querySelector('.threshold-value').textContent = customService.highSimilarity;

        // 重置测试状态
        dialog.querySelectorAll('.test-status').forEach(el => {
            el.textContent = '';
            el.className = 'test-status';
        });
        
        dialog.classList.add('show');
    }

    async deleteCustomService(serviceId) {
        if (!confirm('确定要删除这个自定义服务吗？')) {
            return;
        }

        try {
            await ConfigManager.deleteCustomService(serviceId);
            
            // 移除服务卡片和选择项
            const card = document.querySelector(`.service-card[data-service="${serviceId}"]`);
            card?.remove();
            
            const option = document.querySelector(`option[value="${serviceId}"]`);
            option?.remove();

            // 更新UI
            const activeService = await ConfigManager.getActiveService();
            this.updateActiveServiceUI(activeService.id);
            await this.updateAddCustomServiceCard();
        } catch (error) {
            alert('删除服务失败: ' + error.message);
        }
    }

    async updateAddCustomServiceCard() {
        const customServices = await ConfigManager.getCustomServices();
        const card = document.querySelector('.add-custom-card');
        if (Object.keys(customServices).length >= MAX_CUSTOM_SERVICES) {
            card.style.display = 'none';
        } else {
            card.style.display = 'block';
        }
    }

    async saveCustomService() {
        const dialog = this.customServiceDialog;
        const config = {
            id: dialog.dataset.service,
            name: dialog.querySelector('#custom-service-name').value.trim(),
            baseUrl: dialog.querySelector('#custom-base-url').value.trim(),
            chatModel: dialog.querySelector('#custom-chat-model').value.trim(),
            embedModel: dialog.querySelector('#custom-embed-model').value.trim(),
            apiKey: dialog.querySelector('#custom-api-key').value.trim(),
            highSimilarity: parseFloat(dialog.querySelector('#similarity-threshold').value),
            hideLowSimilarity: dialog.querySelector('#hide-low-similarity').checked ? true : false
        };

        // 验证必填字段
        if (!config.name || !config.baseUrl || !config.chatModel || !config.embedModel || !config.apiKey || isNaN(config.highSimilarity)) {
            alert('请填写所有必填字段');
            return;
        }

        if (config.highSimilarity < 0 || config.highSimilarity > 1) {
            alert('相似度阈值必须在0-1之间');
            return;
        }

        const oldConfig = await ConfigManager.findServiceById(config.id);
        const chatModelChanged = oldConfig?.chatModel !== config.chatModel;
        const embedModelChanged = oldConfig?.embedModel !== config.embedModel;
        const baseInfoChanged = oldConfig?.baseUrl !== config.baseUrl || oldConfig?.apiKey !== config.apiKey;
        
        try {
            // 先测试 Chat 接口
            if (chatModelChanged || baseInfoChanged) {
                const chatStatus = dialog.querySelector('.test-status[data-type="chat"]');
                chatStatus.textContent = '验证中...';
                chatStatus.className = 'test-status testing';
                
                try {
                    await ConfigManager.testChatAPI(config.baseUrl, config.apiKey, config.chatModel);
                    chatStatus.textContent = '验证成功';
                    chatStatus.className = 'test-status success';
                } catch (error) {
                    chatStatus.textContent = error.message;
                    chatStatus.title = error.message;
                    chatStatus.className = 'test-status error';
                    throw new Error('Chat接口验证失败');
                }
            }

            // 再测试 Embedding 接口
            if (embedModelChanged || baseInfoChanged) {
                const embedStatus = dialog.querySelector('.test-status[data-type="embedding"]');
                embedStatus.textContent = '验证中...';
                embedStatus.className = 'test-status testing';
                
                try {
                    await ConfigManager.testEmbeddingAPI(config.baseUrl, config.apiKey, config.embedModel);
                    embedStatus.textContent = '验证成功';
                    embedStatus.className = 'test-status success';
                } catch (error) {
                    embedStatus.textContent = error.message;
                    embedStatus.title = error.message;
                    embedStatus.className = 'test-status error';
                    throw new Error('Embedding接口验证失败');
                }
            }

            // 两个接口都验证成功后，保存配置
            await ConfigManager.saveCustomService(config);
            await this.updateCustomServiceCard(config.id);
            this.hideCustomServiceDialog();
            
            // 如果没有激活的服务，自动激活这个自定义服务
            const activeApiKey = await ConfigManager.getActiveAPIKey();
            if (!activeApiKey) {
                await ConfigManager.setActiveService(config.id);
                this.updateActiveServiceUI(config.id);
            }

            await this.updateAddCustomServiceCard();
        } catch (error) {
            // 验证失败的错误已经在测试状态中显示了，这里不需要再显示 alert
            logger.error('保存自定义服务失败:', error);
        }
    }

    hideCustomServiceDialog() {
        this.customServiceDialog.classList.remove('show');
    }

    async testCustomService(type) {
        const dialog = this.customServiceDialog;
        const config = {
            baseUrl: dialog.querySelector('#custom-base-url').value.trim(),
            chatModel: dialog.querySelector('#custom-chat-model').value.trim(),
            embedModel: dialog.querySelector('#custom-embed-model').value.trim(),
            apiKey: dialog.querySelector('#custom-api-key').value.trim()
        };

        // 检查是否为空
        if (!config.baseUrl || !config.apiKey) {
            alert('请填写API接口地址和API Key');
            return;
        }
        if (type === 'chat' && !config.chatModel) {
            alert('请填写 Chat Model');
            return;
        }
        if (type === 'embedding' && !config.embedModel) {
            alert('请填写 Embedding Model');
            return;
        }

        const statusEl = dialog.querySelector(`.test-status[data-type="${type}"]`);
        statusEl.textContent = '测试中...';
        statusEl.className = 'test-status testing';

        try {
            if (type === 'chat') {
                await ConfigManager.testChatAPI(config.baseUrl, config.apiKey, config.chatModel);
            } else {
                await ConfigManager.testEmbeddingAPI(config.baseUrl, config.apiKey, config.embedModel);
            }
            statusEl.textContent = '测试成功';
            statusEl.className = 'test-status success';
        } catch (error) {
            statusEl.textContent = error.message;
            statusEl.title = error.message;
            statusEl.className = 'test-status error';
        }
    }

    async updateCustomServiceCard(serviceId) {
        const card = document.querySelector(`.service-card[data-service="${serviceId}"]`);
        if (card) {
            const apiStatus = card.querySelector('.api-status');
            apiStatus.classList.add('configured');
            // 更新卡片信息
            const service = await ConfigManager.findServiceById(serviceId);
            const serviceName = card.querySelector('.service-name');
            serviceName.textContent = service.name;
            // 更新option
            const serviceSelect = document.getElementById('active-service-select');
            const option = serviceSelect.querySelector(`option[value="${serviceId}"]`);
            if (option) {
                option.textContent = service.name;
            }
        } else {
            // 添加新的自定义服务卡片和选项
            const service = await ConfigManager.findServiceById(serviceId);
            const newCard = this.createServiceCard(service, false);
            const addCustomCard = document.querySelector('.add-custom-card');
            addCustomCard.parentNode.insertBefore(newCard, addCustomCard);

            // 添加到服务选择下拉框
            const serviceSelect = document.getElementById('active-service-select');
            const option = document.createElement('option');
            option.value = service.id;
            option.textContent = service.name;
            serviceSelect.appendChild(option);
        }
    }

    initializeCustomServiceDialog() {
        this.initSimilaritySlider();
        const dialog = this.customServiceDialog;
        const apiKeyInput = dialog.querySelector('#custom-api-key');
        const nameInput = dialog.querySelector('#custom-service-name');
        const nameFormGroup = nameInput.closest('.form-group');

        // 添加名称输入框的字数统计
        const updateCharCount = () => {
            const length = nameInput.value.length;
            const maxLength = nameInput.maxLength;
            nameFormGroup.setAttribute('data-char-count', `${length}/${maxLength}`);
        };
        nameInput.addEventListener('input', updateCharCount);

        dialog.querySelector('.toggle-visibility').addEventListener('click', () => {
            if (apiKeyInput.type === 'password') {
                apiKeyInput.type = 'text';
                dialog.querySelector('.toggle-visibility svg').innerHTML = `
                    <path d="M13.359 11.238L15 9.597V9.5C15 7.5 12.5 4 8 4C7.359 4 6.734 4.102 6.133 4.281L7.582 5.73C7.719 5.705 7.857 5.687 8 5.687C10.617 5.687 12.75 7.82 12.75 10.437C12.75 10.582 12.734 10.718 12.707 10.856L13.359 11.238Z" fill="currentColor"/>
                    <path d="M2.727 2L1.5 3.227L3.969 5.696C2.891 6.754 2.086 8.043 1.75 9.5C1.75 11.5 4.25 15 8.75 15C9.734 15 10.676 14.8 11.547 14.445L13.273 16.171L14.5 14.944L2.727 2ZM8.75 13.312C6.133 13.312 4 11.18 4 8.562C4 8.273 4.031 7.992 4.086 7.719L5.945 9.578C5.969 10.742 6.914 11.687 8.078 11.711L9.937 13.57C9.555 13.469 9.156 13.312 8.75 13.312Z" fill="currentColor"/>
                `;
            } else {
                apiKeyInput.type = 'password';
                dialog.querySelector('.toggle-visibility svg').innerHTML = `
                    <path d="M8 3C4.5 3 2 6 2 8C2 10 4.5 13 8 13C11.5 13 14 10 14 8C14 6 11.5 3 8 3Z" stroke="currentColor" fill="none"/>
                    <circle cx="8" cy="8" r="2" fill="currentColor"/>
                `;
            }
        });
        
        // 关闭按钮
        dialog.querySelector('.close-dialog-btn').addEventListener('click', () => {
            this.hideCustomServiceDialog();
        });

        // 取消按钮
        dialog.querySelector('.cancel-custom-btn').addEventListener('click', () => {
            this.hideCustomServiceDialog();
        });

        // 保存按钮
        dialog.querySelector('.save-custom-btn').addEventListener('click', () => {
            this.saveCustomService();
        });

        // 测试Chat接口按钮
        dialog.querySelector('.test-chat-btn').addEventListener('click', () => {
            this.testCustomService('chat');
        });

        // 测试Embedding接口按钮
        dialog.querySelector('.test-embed-btn').addEventListener('click', () => {
            this.testCustomService('embedding');
        });

        // 点击test-status复制内容
        dialog.querySelectorAll('.test-status').forEach(el => {
            el.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (el.classList.contains('error')) {
                    try {
                        await navigator.clipboard.writeText(el.textContent);
                        showToast('已复制到剪贴板');
                    } catch (error) {
                        logger.error('复制失败:', error);
                    }
                }
            });
        });
    }

    // 初始化相似度滑动条
    initSimilaritySlider() {
        const dialog = this.customServiceDialog;
        const slider = dialog.querySelector('#similarity-threshold');
        const valueDisplay = dialog.querySelector('.threshold-value');
        
        // 初始化显示
        valueDisplay.textContent = slider.value;
        // 监听滑动事件
        slider.addEventListener('input', (e) => {
            const value = e.target.value;
            valueDisplay.textContent = value;
        });
    }

    handleEscKey(e) {
        if (e.key === 'Escape') {
            if (this.serviceConfigDialog.classList.contains('show')) {
                this.closeServiceConfigDialog();
            }
            if (this.customServiceDialog.classList.contains('show')) {
                this.hideCustomServiceDialog();
            }
        }
    }

    cleanup() {
    }
}

class FilterSettingsTab extends BaseSettingsTab {
    constructor() {
        super();
        this.section = document.getElementById('filters-section');
        
        // 获取DOM元素
        this.addFilterBtn = document.getElementById('add-filter-btn');
        this.filterDialog = document.getElementById('filter-dialog');
        this.addConditionBtn = document.getElementById('add-condition-btn');
        this.saveFilterBtn = document.getElementById('save-filter-btn');
        this.cancelFilterBtn = document.getElementById('cancel-filter-btn');
        this.closeDialogBtn = this.filterDialog.querySelector('.close-dialog-btn');
        this.filtersList = document.getElementById('filters-list');
        
        // 绑定方法到实例
        this.showFilterDialog = this.showFilterDialog.bind(this);
        this.hideFilterDialog = this.hideFilterDialog.bind(this);
        this.saveFilter = this.saveFilter.bind(this);
        this.loadFiltersList = this.loadFiltersList.bind(this);
        this.handleAddCondition = this.handleAddCondition.bind(this);
        this.handleEscKey = this.handleEscKey.bind(this);
    }

    async initialize() {
        logger.debug('开始初始化过滤设置', Date.now()/1000);
        // 绑定事件
        this.addFilterBtn.addEventListener('click', () => this.showFilterDialog());
        this.addConditionBtn.addEventListener('click', this.handleAddCondition);
        this.saveFilterBtn.addEventListener('click', () => this.saveFilter());
        this.cancelFilterBtn.addEventListener('click', () => this.hideFilterDialog());
        this.closeDialogBtn.addEventListener('click', () => this.hideFilterDialog());
        
        // 初始加载规则列表
        await this.loadFiltersList();
        logger.debug('初始化过滤设置完成', Date.now()/1000);
    }

    showFilterDialog(existingRule = null, readonly = false) {
        const filterName = document.getElementById('filter-name');
        const conditionsList = document.getElementById('conditions-list');
        const saveBtn = document.getElementById('save-filter-btn');
        const addConditionBtn = document.getElementById('add-condition-btn');
        
        // 清空表单
        filterName.value = '';
        conditionsList.innerHTML = '';
        this.filterDialog.dataset.editingId = '';
        
        // 如果是编辑现有规则
        if (existingRule) {
            filterName.value = existingRule.name;
            this.filterDialog.dataset.editingId = existingRule.id;
            // 处理条件和分组
            existingRule.conditions.forEach(item => {
                if (Array.isArray(item)) {
                    // 创建分组
                    this.addGroup(item);
                } else {
                    // 创建单个条件
                    this.addCondition(item);
                }
            });
        } else {
            // 添加一个空条件
            this.addCondition();
        }
        
        // 如果是只读模式
        if (readonly) {
            filterName.disabled = true;
            saveBtn.style.display = 'none';
            addConditionBtn.style.display = 'none';
            // 禁用所有输入框和删除按钮
            conditionsList.querySelectorAll('input, select, button').forEach(el => {
                el.disabled = true;
            });
            // 移除拖拽功能
            conditionsList.querySelectorAll('.condition-item, .condition-group').forEach(el => {
                el.draggable = false;
            });
        } else {
            filterName.disabled = false;
            saveBtn.style.display = '';
            addConditionBtn.style.display = '';
            // 初始化拖拽功能
            this.initDragAndDrop();
        }
        
        this.filterDialog.classList.add('show');
    }

    hideFilterDialog() {
        this.filterDialog.classList.remove('show');
    }

    handleAddCondition() {
        const condition = this.addCondition();
        this.setupConditionItemDragAndDrop(condition, this.conditionsList);
    }

    addCondition(condition = null) {
        const conditionsList = document.getElementById('conditions-list');
        const conditionItem = document.createElement('div');
        conditionItem.className = 'condition-item';
        conditionItem.dataset.id = this.generateUUID();
        
        // 定义可用的字段和操作符
        const fields = [
            { value: 'title', label: '标题', isNumber: false},
            { value: 'domain', label: '域名', isNumber: false },
            { value: 'url', label: '链接', isNumber: false },
            { value: 'tag', label: '标签', isNumber: false },
            { value: 'create', label: '创建时间', isNumber: true, unit: '天' },
            { value: 'lastUse', label: '上次使用', isNumber: true, unit: '天' },
            { value: 'use', label: '使用次数', isNumber: true, unit: '次' }
        ];
        
        const operators = {
            text: [
                { value: 'is', label: '等于' },
                { value: 'has', label: '包含' }
            ],
            number: [
                { value: '>', label: '大于' },
                { value: '<', label: '小于' },
                { value: '=', label: '等于' }
            ]
        };
        
        // 创建字段选择器
        const fieldSelect = document.createElement('select');
        fieldSelect.className = 'condition-select';
        fields.forEach(field => {
            const option = document.createElement('option');
            option.value = field.value;
            option.textContent = field.label;
            fieldSelect.appendChild(option);
        });
        
        // 创建操作符选择器
        const operatorSelect = document.createElement('select');
        operatorSelect.className = 'condition-operator';
        
        // 创建值输入框
        const valueContainer = document.createElement('div');
        valueContainer.className = 'condition-value';
        
        // 更新操作符和值输入框

        const onFieldChange = () => {
            const field = fieldSelect.value;
            const isNumber = fields.find(f => f.value === field)?.isNumber;
            const ops = isNumber ? operators.number : operators.text;
            operatorSelect.innerHTML = '';
            ops.forEach(op => {
                const option = document.createElement('option');
                option.value = op.value;
                option.textContent = op.label;
                operatorSelect.appendChild(option);
            });
            updateValueInput();
        }
        const onOperatorChange = () => {
            updateValueInput();
        };

        const updateValueInput = () => {
            const field = fieldSelect.value;
            const fieldSettings = fields.find(f => f.value === field);
            const isNumber = fieldSettings?.isNumber;
            // 更新值输入框
            valueContainer.innerHTML = '';
            if (!isNumber && operatorSelect.value === 'has') {
                this.createTagsInput(valueContainer);
            } else {
                const inputWrapper = document.createElement('div');
                inputWrapper.className = 'input-wrapper';
                
                const input = document.createElement('input');
                input.type = isNumber ? 'number' : 'text';
                input.className = 'condition-value-input';
                // 为数字类型添加限制
                if (isNumber) {
                    input.min = '1';  // 设置最小值为1
                    input.step = '1';  // 设置步进值为1
                    // 添加输入验证
                    input.addEventListener('input', (e) => {
                        const value = parseInt(e.target.value);
                        if (value < 1) {
                            e.target.value = '1';
                        }
                    });
                    // 失去焦点时检查空值
                    input.addEventListener('blur', (e) => {
                        if (!e.target.value) {
                            e.target.value = '1';
                        }
                    });
                }
                inputWrapper.appendChild(input);
                
                // 为数字类型添加单位
                if (isNumber) {
                    const unit = document.createElement('span');
                    unit.className = 'input-unit';
                    unit.textContent = fieldSettings?.unit;
                    inputWrapper.appendChild(unit);
                }
                
                valueContainer.appendChild(inputWrapper);
            }
        }
        
        // 添加字段变化事件监听器
        fieldSelect.addEventListener('change', onFieldChange);
        // 添加操作符变化事件监听器
        operatorSelect.addEventListener('change', onOperatorChange)
        
        // 创建删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'remove-condition-btn';
        deleteBtn.addEventListener('click', () => {
            conditionItem.remove();
        });
        
        // 组装条件项
        conditionItem.appendChild(fieldSelect);
        conditionItem.appendChild(operatorSelect);
        conditionItem.appendChild(valueContainer);
        conditionItem.appendChild(deleteBtn);
        
        // 如果有现有条件，设置值
        if (condition) {
            fieldSelect.value = condition.field;
            onFieldChange();
            operatorSelect.value = condition.operator;
            onOperatorChange();
            
            const tagsInput = valueContainer.querySelector('.tags-input-container');
            if (tagsInput) {
                const values = Array.isArray(condition.value) ? condition.value : [condition.value];
                values.forEach(value => this.addTag(tagsInput, value));
                if (values.length > 0) {
                    tagsInput.querySelector('.tags-input').placeholder = '';
                }
            } else {
                const input = valueContainer.querySelector('input');
                input.value = condition.value;
            }
        } else {
            onFieldChange();
        }
        
        conditionsList.appendChild(conditionItem);
        return conditionItem;
    }

    createTagsInput(container) {
        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'tags-input-container';
        
        const input = document.createElement('input');
        input.className = 'tags-input';
        input.placeholder = '可输入多个并列的关键词';
        
        // 更新placeholder的显示
        const updatePlaceholder = () => {
            const tags = tagsContainer.querySelectorAll('.tag-item');
            input.placeholder = tags.length > 0 ? '' : '可输入多个并列的关键词';
        };
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value.trim()) {
                e.preventDefault();
                this.addTag(tagsContainer, input.value.trim());
                input.value = '';
                updatePlaceholder();
            }
        });
        
        tagsContainer.appendChild(input);
        container.appendChild(tagsContainer);
    }

    addTag(container, text) {
        // 检查标签是否已存在
        const existingTags = Array.from(container.querySelectorAll('.tag-item span:first-child'))
            .map(span => span.textContent);
        if (existingTags.includes(text)) {
            return;
        }
        
        const tag = document.createElement('div');
        tag.className = 'tag-item';
        tag.innerHTML = `
            <span>${text}</span>
            <span class="remove-tag">×</span>
        `;
        
        tag.querySelector('.remove-tag').addEventListener('click', (e) => {
            tag.remove();
            // 更新placeholder
            const input = container.querySelector('.tags-input');
            const tags = container.querySelectorAll('.tag-item');
            input.placeholder = tags.length > 0 ? '' : '可输入多个并列的关键词';
        });
        
        container.insertBefore(tag, container.querySelector('.tags-input'));
    }

    async saveFilter() {
        const filterName = document.getElementById('filter-name');
        const conditionsList = document.getElementById('conditions-list');
        const editingFilterId = this.filterDialog.dataset.editingId;
        
        // 验证规则名称
        if (!filterName.value.trim()) {
            alert('请输入标签名称');
            filterName.focus();
            return;
        }
        
        // 收集所有条件和分组
        const conditions = [];
        let hasEmptyCondition = false;
        
        Array.from(conditionsList.children).forEach(item => {
            if (item.classList.contains('condition-group')) {
                // 收集分组中的条件
                const groupConditions = [];
                item.querySelectorAll('.condition-item').forEach(conditionItem => {
                    const conditionData = this.getConditionData(conditionItem);
                    if (!this.validateCondition(conditionData)) {
                        hasEmptyCondition = true;
                        return;
                    }
                    groupConditions.push(conditionData);
                });
                
                if (groupConditions.length > 0) {
                    conditions.push(groupConditions);
                }
            } else if (item.classList.contains('condition-item')) {
                // 收集单个条件
                const conditionData = this.getConditionData(item);
                if (!this.validateCondition(conditionData)) {
                    hasEmptyCondition = true;
                    return;
                }
                conditions.push(conditionData);
            }
        });
        
        // 检查是否有空条件
        if (hasEmptyCondition) {
            alert('请填写完整的标签条件');
            return;
        }
        
        // 检查是否有条件
        if (conditions.length === 0) {
            alert('请至少添加一个标签条件');
            return;
        }
        
        // 创建规则对象
        const rule = {
            id: editingFilterId || Date.now().toString(),
            name: filterName.value.trim(),
            conditions
        };
        
        // 保存规则
        await customFilter.saveRule(rule);
        
        // 刷新规则列表
        await this.loadFiltersList();
        
        // 关闭对话框
        this.hideFilterDialog();
        
        // 清除编辑状态
        this.filterDialog.dataset.editingId = '';
    }

    // 验证条件是否完整
    validateCondition(condition) {
        // 检查值是否为空
        if (condition.value === '' || condition.value === null || condition.value === undefined) {
            return false;
        }
        
        // 如果是数组（标签），检查是否为空数组
        if (Array.isArray(condition.value) && condition.value.length === 0) {
            return false;
        }
        
        // 如果是数字类型，检查是否为有效数字
        if (['create', 'use'].includes(condition.field)) {
            const num = parseInt(condition.value);
            if (isNaN(num) || num < 1) {
                return false;
            }
        }
        
        return true;
    }

    async loadFiltersList() {
        const rules = customFilter.getRules();
        this.filtersList.innerHTML = '';
        
        rules.forEach(rule => {
            const item = document.createElement('div');
            item.className = 'filter-item';
            if (rule.isBuiltIn) {
                item.classList.add('built-in');
            }
            item.dataset.id = rule.id;
            
            item.innerHTML = `
                <div class="filter-info">
                    <div class="filter-name">
                        <span>${rule.name}</span>
                        ${rule.isBuiltIn ? '<span class="built-in-badge">内置</span>' : ''}
                    </div>
                </div>
                <div class="filter-actions">
                    ${!rule.isBuiltIn ? `
                    <button class="edit-btn">
                        <svg viewBox="0 0 24 24">
                            <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                        编辑
                    </button>
                    <button class="delete-btn">
                        <svg viewBox="0 0 24 24">
                            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                        删除
                    </button>
                    ` : `
                    <button class="view-btn">
                        <svg viewBox="0 0 24 24">
                            <path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                        </svg>
                        查看
                    </button>
                    `}
                </div>
            `;
            
            // 绑定事件处理器
            if (!rule.isBuiltIn) {
                item.querySelector('.edit-btn').addEventListener('click', () => {
                    this.showFilterDialog(rule);
                });
                
                item.querySelector('.delete-btn').addEventListener('click', async () => {
                    if (confirm('确定要删除这个标签吗？')) {
                        await customFilter.deleteRule(rule.id);
                        await this.loadFiltersList();
                    }
                });
            } else {
                // 为内置规则添加查看事件
                item.querySelector('.view-btn').addEventListener('click', () => {
                    this.showFilterDialog(rule, true);
                });
            }
            
            this.filtersList.appendChild(item);
        });
        this.initSortable();
    }

    initSortable() {
        const sortableList = document.getElementById('filters-list');
        const items = sortableList.querySelectorAll('.filter-item');
        items.forEach(item => {
            item.setAttribute('draggable', true);

            // 添加拖拽事件监听器
            item.addEventListener('dragstart', (e) => {
                e.target.classList.add('dragging');
                e.dataTransfer.setData('text/plain', e.target.dataset.id);
            });
            
            item.addEventListener('dragend', async (e) => {
                e.target.classList.remove('dragging');
                await this.saveFilterOrder();
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (item.classList.contains('dragging')) {
                    return;
                }
                // 获取拖拽元素
                const draggedElement = document.querySelector('.dragging');
                // 如果拖拽元素在当前元素后面，则把拖拽元素移到当前元素前面
                // 如果拖拽元素在当前元素前面，则把拖拽元素移到当前元素后面
                const draggedIndex = Array.from(sortableList.children).indexOf(draggedElement);
                const currentIndex = Array.from(sortableList.children).indexOf(item);
                
                if (draggedIndex > currentIndex) {
                    sortableList.insertBefore(draggedElement, item);
                } else if (draggedIndex < currentIndex) {
                    sortableList.insertBefore(draggedElement, item.nextSibling);
                }
            });
        });
    }

    // 保存过滤器顺序的新方法
    async saveFilterOrder() {
        const items = Array.from(this.filtersList.querySelectorAll('.filter-item'));
        const orderedIds = items.map(item => item.dataset.id);
        await customFilter.saveFilterOrder(orderedIds);
    }

    formatConditions(conditions) {
        return conditions.map(item => {
            // 如果是条件组
            if (Array.isArray(item)) {
                return `(${item.map(condition => this.formatCondition(condition)).join(' 或 ')})`;
            }
            // 如果是单个条件
            return this.formatCondition(item);
        }).join(' 且 ');
    }
    
    // 格式化单个条件
    formatCondition(condition) {
        const field = {
            title: '标题',
            domain: '域名',
            url: '链接',
            tag: '标签',
            create: '创建时间',
            lastUse: '上次使用时间',
            use: '使用次数'
        }[condition.field];
        
        const operator = {
            is: '为',
            has: '包含',
            '>': '大于',
            '<': '小于',
            '=': '等于'
        }[condition.operator];
        
        const value = Array.isArray(condition.value) 
            ? condition.value.join('或')
            : condition.value;
            
        return `${field}${operator}${value}`;
    }

    handleEscKey(e) {
        if (this.filterDialog && this.filterDialog.classList.contains('show')) {
            this.hideFilterDialog();
        }
    }

    cleanup() {
        // 清理事件监听器等资源
    }

    // 初始化拖拽功能
    initDragAndDrop() {
        const conditionsList = document.getElementById('conditions-list');
        
        // 初始化现有元素的拖拽
        this.initializeDraggable(conditionsList);
    }

    setupConditionItemDragAndDrop(item, container) {
        item.setAttribute('draggable', true);

        // 添加被拖拽元素的拖拽事件
        item.addEventListener('dragstart', (e) => {
            e.target.classList.add('dragging');
            e.dataTransfer.setData('text/plain', e.target.dataset.id);
        });

        item.addEventListener('dragend', (e) => {
            e.target.classList.remove('dragging');
            document.querySelectorAll('.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });

            // 检查并清理空的条件组
            document.querySelectorAll('.condition-group').forEach(group => {
                const conditions = group.querySelector('.group-conditions');
                if (!conditions.children.length) {
                    group.remove();
                }
            });
        });

        // 添加目标元素的交互事件
        item.addEventListener('dragover', (e) => {
            const targetGroup = e.target.closest('.condition-group');
            if (targetGroup) {
                return;
            }
            const draggedElement = document.querySelector('.dragging');
            const draggedIsGroup = draggedElement.classList.contains('condition-group');
            if (draggedIsGroup) {
                return;
            }
            
            e.preventDefault();
            e.stopPropagation();
            if (!item.classList.contains('dragging')) {
                item.classList.add('drag-over');
            }
        });

        item.addEventListener('dragleave', (e) => {
            item.classList.remove('drag-over');
        });

        item.addEventListener('drop', (e) => {
            const targetGroup = e.target.closest('.condition-group');
            if (targetGroup) {
                return;
            }
            const draggedId = e.dataTransfer.getData('text/plain');
            const draggedElement = document.querySelector(`[data-id="${draggedId}"]`);
            const draggedIsGroup = draggedElement.classList.contains('condition-group');
            if (draggedIsGroup) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            item.classList.remove('drag-over');
            
            if (draggedElement && draggedElement !== item) {
                // 创建新分组并添加两个条件
                const group = this.addGroup([], item);
                const groupConditions = group.querySelector('.group-conditions');
                groupConditions.appendChild(draggedElement);
                groupConditions.appendChild(item);
                this.setupConditionGroupDragAndDrop(group, container);
            }
        });
    }

    setupConditionGroupDragAndDrop(group, container) {
        group.setAttribute('draggable', true);

        // 添加被拖拽元素的拖拽事件
        group.addEventListener('dragstart', (e) => {
            e.target.classList.add('dragging');
            e.dataTransfer.setData('text/plain', e.target.dataset.id);
        });

        group.addEventListener('dragend', (e) => {
            e.target.classList.remove('dragging');
            document.querySelectorAll('.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });

            // 检查并清理空的条件组
            document.querySelectorAll('.condition-group').forEach(group => {
                const conditions = group.querySelector('.group-conditions');
                if (!conditions.children.length) {
                    group.remove();
                }
            });
        });

        // 添加目标元素的交互事件
        group.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!group.classList.contains('dragging')) {
                group.classList.add('drag-over');

                const draggedElement = document.querySelector('.dragging');
                const draggedIsGroup = draggedElement.classList.contains('condition-group');
                if (draggedIsGroup) {
                    return;
                }

                const dropContainer = group.querySelector('.group-conditions');
                const afterElement = this.getDragAfterElement(dropContainer, e.clientY);
                if (afterElement) {
                    dropContainer.insertBefore(draggedElement, afterElement);
                } else {
                    dropContainer.appendChild(draggedElement);
                }
            }
        });

        group.addEventListener('dragleave', (e) => {
            group.classList.remove('drag-over');
        });

        group.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            group.classList.remove('drag-over');

            const draggedId = e.dataTransfer.getData('text/plain');
            const draggedElement = document.querySelector(`[data-id="${draggedId}"]`);
            const draggedIsGroup = draggedElement.classList.contains('condition-group');

            if (draggedIsGroup) {
                const dropContainer = group.querySelector('.group-conditions');
                const draggedGroupConditions = draggedElement.querySelector('.group-conditions');
                Array.from(draggedGroupConditions.children).forEach(condition => {
                    dropContainer.appendChild(condition);
                });
            }
        });
    }
    
    // 初始化可拖动元素
    initializeDraggable(container) {
        const conditionsList = document.getElementById('conditions-list');
        // 使所有条件项和分组可拖动
        const draggables = container.querySelectorAll('.condition-item, .condition-group');
        draggables.forEach(item => {
            if (item.classList.contains('condition-group')) {
                this.setupConditionGroupDragAndDrop(item, container);
            } else {
                this.setupConditionItemDragAndDrop(item, container);
            }
        });
        
        // 处理拖放目标
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            const dropContainer = e.target.closest('.group-conditions') || conditionsList;
            const draggedElement = document.querySelector('.dragging');

            console.log('container dragover', {
                e,
                target: e.target,
                dropContainer: dropContainer,
                draggedElement: draggedElement,
            });
            
            const afterElement = this.getDragAfterElement(dropContainer, e.clientY);
            if (afterElement) {
                dropContainer.insertBefore(draggedElement, afterElement);
            } else {
                dropContainer.appendChild(draggedElement);
            }
        });
    }
    
    // 获取拖动后的位置
    getDragAfterElement(container, y) {
        // 只获取直接子元素
        const draggableElements = [...container.children].filter(child => {
            return (child.classList.contains('condition-item') || 
                   child.classList.contains('condition-group')) &&
                   !child.classList.contains('dragging');
        });
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
    
    // 添加条件分组
    addGroup(conditions = [], insertBefore = null) {
        const conditionsList = document.getElementById('conditions-list');
        const groupId = this.generateUUID();
        
        const group = document.createElement('div');
        group.className = 'condition-group';
        group.dataset.id = groupId;
        
        group.innerHTML = `
            <div class="group-header">
                <span class="group-title">条件组（组内条件为"或"关系）</span>
                <button class="remove-group-btn">×</button>
            </div>
            <div class="group-conditions"></div>
        `;
        
        // 添加条件到分组
        const groupConditions = group.querySelector('.group-conditions');
        conditions.forEach(condition => {
            const conditionItem = this.addCondition(condition);
            groupConditions.appendChild(conditionItem);
        });
        
        // 绑定删除分组事件
        group.querySelector('.remove-group-btn').addEventListener('click', () => {
            const nextSibling = group.nextSibling;
            // 将组内条件移到组外
            const conditions = group.querySelectorAll('.condition-item');
            conditions.forEach(condition => {
                if (nextSibling) {
                    conditionsList.insertBefore(condition, nextSibling);
                } else {
                    conditionsList.appendChild(condition);
                }
            });
            group.remove();
        });
        
        if (insertBefore) {
            conditionsList.insertBefore(group, insertBefore);
        } else {
            conditionsList.appendChild(group);
        }
        
        return group;
    }

    // 从条件项元素中获取条件数据
    getConditionData(item) {
        const field = item.querySelector('.condition-select').value;
        const operator = item.querySelector('.condition-operator').value;
        let value;
        
        const tagsInput = item.querySelector('.tags-input-container');
        if (tagsInput) {
            const tags = Array.from(tagsInput.querySelectorAll('.tag-item span:first-child'))
                .map(span => span.textContent);
            value = tags.length === 1 ? tags[0] : tags;
        } else {
            value = item.querySelector('.condition-value-input').value;
            if (field === 'create' || field === 'use') {
                value = parseInt(value);
            }
        }
        
        return { field, operator, value };
    }

    // 生成UUID
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

class ImportExportSettingsTab extends BaseSettingsTab {
    constructor() {
        super();
        this.section = document.getElementById('import-export-section');
        this.importBrowserBtn = document.getElementById('import-browser-btn');
        this.exportLocalBtn = document.getElementById('export-local-btn');
        this.importLocalBtn = document.getElementById('import-local-btn');
        this.importProgressDialog = document.getElementById('import-progress-dialog');
        this.bookmarkSelectDialog = document.getElementById('bookmark-select-dialog');
        
        // 获取书签选择对话框中的元素
        this.bookmarkTree = document.getElementById('bookmark-tree');
        this.keepFolderTags = document.getElementById('keep-folder-tags');
        this.skipExisting = document.getElementById('skip-existing');
        this.selectAllCheckbox = document.getElementById('select-all-bookmarks');
        this.selectedCount = document.getElementById('selected-count');
        this.estimatedChatTokens = document.getElementById('estimated-chat-tokens');
        this.estimatedEmbedTokens = document.getElementById('estimated-embed-tokens');
        this.cancelImportBtn = document.getElementById('cancel-import-btn');
        this.confirmImportBtn = document.getElementById('confirm-import-btn');
        
        // 保存选中的书签
        this.selectedBookmarks = new Set();
        this.bookmarkNodes = new Map(); // 用于存储书签节点的引用
        this.folderNodes = new Map(); // 用于存储文件夹节点的引用
        
        // 添加取消导入的标志
        this.importCancelled = false;
        
        // 绑定方法
        this.handleImportBrowser = this.handleImportBrowser.bind(this);
        this.handleExportLocal = this.handleExportLocal.bind(this);
        this.handleImportLocal = this.handleImportLocal.bind(this);
        this.updateImportProgress = this.updateImportProgress.bind(this);
        this.handleSelectAll = this.handleSelectAll.bind(this);
        this.handleBookmarkSelect = this.handleBookmarkSelect.bind(this);
        this.handleFolderSelect = this.handleFolderSelect.bind(this);
        this.handleConfirmImport = this.handleConfirmImport.bind(this);
        this.handleCloseImportProgress = this.handleCloseImportProgress.bind(this);
        this.handleEscKey = this.handleEscKey.bind(this);
        
        // 添加导入统计数据
        this.importStats = null;
    }

    // 重置导入统计
    async resetImportStats() {
        const stats = await statsManager.loadStats();
        const inputTokens = stats.chat?.inputTokens || 0;
        const outputTokens = stats.chat?.outputTokens || 0;
        const embedTokens = stats.embedding?.tokens || 0;
        this.importStats = {
            startTime: Date.now(),
            imported: 0,
            chatTokens: 0,
            embedTokens: 0,
            processedTimes: [],
            startChatTokens: inputTokens + outputTokens,
            startEmbedTokens: embedTokens
        };
    }

    // 计算预计剩余时间
    calculateEstimatedTime(processed, total) {
        const remaining = total - processed;
        if (remaining == 0) return '0';
        const times = this.importStats.processedTimes;
        if (times.length === 0) return '计算中...';
        
        // 计算最近10个处理时间的平均值
        const recentTimes = times.slice(-10);
        const avgTime = recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length;
        const estimatedMs = avgTime * remaining;
        
        // 转换为可读时间
        if (estimatedMs < 60000) { // 小于1分钟
            return `约 ${Math.ceil(estimatedMs / 1000)} 秒`;
        } else if (estimatedMs < 3600000) { // 小于1小时
            return `约 ${Math.ceil(estimatedMs / 60000)} 分钟`;
        } else {
            const hours = Math.floor(estimatedMs / 3600000);
            const minutes = Math.ceil((estimatedMs % 3600000) / 60000);
            return `约 ${hours} 小时 ${minutes} 分钟`;
        }
    }

    async initialize() {
        logger.debug('开始初始化导入导出设置', Date.now()/1000);
        // 绑定事件监听器
        this.importBrowserBtn.addEventListener('click', this.handleImportBrowser);
        this.exportLocalBtn.addEventListener('click', this.handleExportLocal);
        this.importLocalBtn.addEventListener('click', this.handleImportLocal);
        
        // 绑定书签选择对话框的事件
        this.selectAllCheckbox.addEventListener('change', this.handleSelectAll);
        this.cancelImportBtn.addEventListener('click', () => this.bookmarkSelectDialog.classList.remove('show'));
        this.confirmImportBtn.addEventListener('click', this.handleConfirmImport);
        
        // 绑定对话框关闭按钮
        this.bookmarkSelectDialog.querySelector('.close-dialog-btn').addEventListener('click', () => {
            this.bookmarkSelectDialog.classList.remove('show');
        });
        
        // 添加关闭按钮事件监听
        this.importProgressDialog.querySelector('.close-dialog-btn').addEventListener('click', this.handleCloseImportProgress);
        logger.debug('初始化导入导出设置完成', Date.now()/1000);
    }

    // 处理从浏览器导入书签
    async handleImportBrowser() {
        try {
            // 显示书签选择对话框
            this.bookmarkSelectDialog.classList.add('show');
            this.bookmarkTree.innerHTML = '<div class="loading-spinner"></div>';
            
            // 获取所有Chrome书签
            const bookmarks = await chrome.bookmarks.getTree();
            
            // 清空之前的选择
            this.selectedBookmarks.clear();
            this.bookmarkNodes.clear();
            this.folderNodes.clear();
            this.selectAllCheckbox.checked = false;
            
            // 渲染书签树
            const bookmarkTree = this.renderBookmarkTree(bookmarks[0]);
            this.bookmarkTree.innerHTML = '';
            this.bookmarkTree.appendChild(bookmarkTree);
            
            // 更新选中计数
            this.updateSelectedCount();
            
        } catch (error) {
            logger.error('获取书签失败:', error);
            showToast('获取书签失败: ' + error.message, true);
        }
    }

    // 渲染书签树
    renderBookmarkTree(node, parentPath = []) {
        const container = document.createElement('div');
        
        if (node.children) {
            // 这是一个文件夹
            const folder = this.createFolderElement(node, parentPath);
            container.appendChild(folder);
            
            const folderContent = document.createElement('div');
            const shouldExpand = parentPath.length == 0;
            folderContent.className = 'folder-content collapsed';
            
            // 递归渲染子节点
            node.children.forEach(child => {
                const childPath = [...parentPath, node];
                folderContent.appendChild(this.renderBookmarkTree(child, childPath));
            });
            
            folder.appendChild(folderContent);

            if (shouldExpand) {
                this.toggleFolder(folder);
            }
        } else if (node.url) {
            // 这是一个书签
            const bookmark = this.createBookmarkElement(node, parentPath);
            container.appendChild(bookmark);
        }
        
        return container;
    }

    // 创建文件夹元素
    createFolderElement(node, parentPath) {
        const folder = document.createElement('div');
        folder.className = 'bookmark-folder';
        folder.dataset.bookmarkId = node.id;  // 添加书签ID作为数据属性
        
        const header = document.createElement('div');
        header.className = 'folder-header';
        
        // 复选框容器
        const checkboxWrapper = document.createElement('div');
        checkboxWrapper.className = 'checkbox-wrapper';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.addEventListener('change', () => this.handleFolderSelect(node, checkbox.checked, parentPath, true));
        checkboxWrapper.appendChild(checkbox);
        
        // 展开/折叠图标
        const expandIcon = document.createElement('span');
        expandIcon.className = 'expand-icon collapsed';
        expandIcon.innerHTML = '▼';
        expandIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleFolder(folder);
        });
        
        // 文件夹图标
        const folderIcon = document.createElement('span');
        folderIcon.className = 'folder-icon';
        folderIcon.innerHTML = '📁';
        
        // 文件夹标题
        const title = document.createElement('span');
        title.className = 'folder-title';
        if (!node.title && node.id === '0') {
            logger.debug('文件夹标题:', {
                node,
                title: node.title,
                id: node.id
            });
            title.textContent = '收藏夹🌟';
        } else {
            title.textContent = node.title || '未命名';
        }
        // 点击标题展开/收起文件夹
        title.addEventListener('click', () => {
            this.toggleFolder(folder);
        });
        
        // 书签计数
        const count = document.createElement('span');
        count.className = 'folder-count';
        const bookmarkCount = this.countBookmarks(node);
        count.textContent = `${bookmarkCount} 个书签`;
        
        header.appendChild(checkboxWrapper);
        header.appendChild(expandIcon);
        header.appendChild(folderIcon);
        header.appendChild(title);
        header.appendChild(count);
        
        folder.appendChild(header);
        
        // 保存节点引用
        this.folderNodes.set(node.id, {
            node,
            element: folder,
            checkbox,
            parentPath
        });
        
        return folder;
    }

    // 创建书签元素
    createBookmarkElement(node, parentPath) {
        const bookmark = document.createElement('div');
        bookmark.className = 'bookmark-item';
        
        // 复选框容器
        const checkboxWrapper = document.createElement('div');
        checkboxWrapper.className = 'checkbox-wrapper';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.addEventListener('change', () => this.handleBookmarkSelect(node, checkbox.checked, parentPath));
        checkboxWrapper.appendChild(checkbox);
        
        // 图标
        const icon = document.createElement('span');
        icon.className = 'bookmark-icon';
        icon.innerHTML = '🔖';
        
        // 标题
        const title = document.createElement('span');
        title.className = 'bookmark-title';
        title.textContent = node.title || '未命名书签';
        // 点击标题选择书签
        title.addEventListener('click', () => {
            checkbox.checked = !checkbox.checked;
            this.handleBookmarkSelect(node, checkbox.checked, parentPath);
        });
        
        // URL
        const url = document.createElement('span');
        url.className = 'bookmark-url';
        url.textContent = node.url;
        
        bookmark.appendChild(checkboxWrapper);
        bookmark.appendChild(icon);
        bookmark.appendChild(title);
        bookmark.appendChild(url);
        
        // 保存节点引用
        this.bookmarkNodes.set(node.id, {
            node,
            element: bookmark,
            checkbox,
            parentPath
        });
        
        return bookmark;
    }

    // 切换文件夹展开/收起状态
    toggleFolder(folder) {
        const content = folder.querySelector('.folder-content');
        const expandIcon = folder.querySelector('.expand-icon');
        
        if (content) {
            const isCollapsed = content.classList.contains('collapsed');
            content.classList.toggle('collapsed');
            expandIcon.classList.toggle('collapsed');
            
            // 更新图标
            expandIcon.style.transform = isCollapsed ? 'rotate(0)' : 'rotate(-90deg)';
        }
    }

    // 统计文件夹中的书签数量
    countBookmarks(node) {
        let count = 0;
        if (node.url) {
            return 1;
        }
        if (node.children) {
            node.children.forEach(child => {
                count += this.countBookmarks(child);
            });
        }
        return count;
    }

    // 处理全选/取消全选
    handleSelectAll(event) {
        const checked = event.target.checked;
        this.bookmarkNodes.forEach(({node, checkbox}) => {
            checkbox.checked = checked;
            if (checked) {
                this.selectedBookmarks.add(node.id);
            } else {
                this.selectedBookmarks.delete(node.id);
            }
        });
        this.folderNodes.forEach(({node, checkbox}) => {
            checkbox.checked = checked;
        });
        this.updateSelectedCount();
    }

    // 处理单个书签的选择
    handleBookmarkSelect(node, checked, parentPath) {
        if (checked) {
            this.selectedBookmarks.add(node.id);
        } else {
            this.selectedBookmarks.delete(node.id);
        }
        this.updateSelectedCount();
        
        // 更新父文件夹的选中状态
        this.updateParentFolderState(parentPath.map(p => p.id));
    }

    // 处理文件夹的选择
    handleFolderSelect(node, checked, parentPath, isRoot = false) {
        if (node.children) {
            node.children.forEach(child => {
                const nodeInfo = this.bookmarkNodes.get(child.id);
                if (nodeInfo) {
                    nodeInfo.checkbox.checked = checked;
                    if (checked) {
                        this.selectedBookmarks.add(child.id);
                    } else {
                        this.selectedBookmarks.delete(child.id);
                    }
                }
                const folderNode = this.folderNodes.get(child.id);
                if (folderNode) {
                    folderNode.checkbox.checked = checked;
                    this.handleFolderSelect(child, checked, [...parentPath, node], false);
                }
            });
        }
        if (isRoot) {
            this.updateSelectedCount();
            // 更新父文件夹的选中状态
            this.updateParentFolderState(parentPath.map(p => p.id));
        }
    }

    // 更新父文件夹的选中状态
    updateParentFolderState(parentIds) {
        // 从下往上遍历父ID
        for (let i = parentIds.length - 1; i >= 0; i--) {
            const folderId = parentIds[i];
            // 查找文件夹节点
            const folderNode = this.folderNodes.get(folderId);
            if (folderNode) {
                const checkbox = folderNode.checkbox;
                if (checkbox) {
                    const allChecked = folderNode.node.children.every(child => 
                        this.bookmarkNodes.get(child.id)?.checkbox.checked ||
                        this.folderNodes.get(child.id)?.checkbox.checked
                    );
                    checkbox.checked = allChecked;
                }
            }
        }
    }

    // 更新选中计数
    updateSelectedCount() {
        const selectedCount = this.selectedBookmarks.size;
        this.selectedCount.textContent = selectedCount;
        
        // 计算预估token
        const chatTokens = selectedCount * 300;
        const embedTokens = selectedCount * 50;
        
        // 更新显示
        this.estimatedChatTokens.textContent = chatTokens.toLocaleString();
        this.estimatedEmbedTokens.textContent = embedTokens.toLocaleString();
        
        // 更新确认按钮状态
        this.confirmImportBtn.disabled = selectedCount === 0;
    }

    // 处理确认导入
    async handleConfirmImport() {
        logger.debug('开始导入书签');
        try {
            // 重置取消标志
            this.importCancelled = false;
            
            const apiKey = await ConfigManager.getActiveAPIKey();
            if (!apiKey) {
                throw new Error('请先配置API服务');
            }

            // 隐藏选择对话框，显示进度对话框
            this.bookmarkSelectDialog.classList.remove('show');
            await this.showImportProgress('正在导入书签...');
            
            // 获取选中的书签
            const selectedBookmarks = Array.from(this.selectedBookmarks)
                .map(id => this.bookmarkNodes.get(id))
                .filter(info => info && info.node.url);

            if (selectedBookmarks.length === 0) {
                throw new Error('请至少选择一个有URL的书签');
            }

            const existingBookmarks = await LocalStorageMgr.getBookmarks();
            const existingUrls = new Set(Object.values(existingBookmarks).map(bookmark => bookmark.url));
            
            // 更新总数
            this.updateImportProgress(0, selectedBookmarks.length);
            
            // 开始导入
            let currentIndex = 0;
            for (const {node, parentPath} of selectedBookmarks) {
                // 检查是否已取消
                if (this.importCancelled) {
                    logger.info('导入已取消');
                    showToast('已取消导入');
                    break;
                }

                currentIndex++;
                try {
                    const {accessible, reason} = await checkUrlAccessibility(node.url);
                    if (!accessible) {
                        throw new Error(`${reason}`);
                    }
                    if (this.skipExisting.checked && existingUrls.has(node.url)) {
                        throw new Error(`书签已存在`);
                    }
                    await this.importBookmark(node, parentPath);
                    this.addImportLog(node, true);
                } catch (error) {
                    logger.error('导入书签失败:', error.message);
                    this.addImportLog(node, false, error.message);
                } finally {
                    this.updateImportProgress(currentIndex, selectedBookmarks.length);
                }
            }
            
            // 导入完成后开始同步
            if (this.importStats.imported > 0) {
                logger.info(`成功导入${this.importStats.imported}个书签`);
                sendMessageSafely({
                    type: MessageType.BOOKMARKS_UPDATED,
                    source: 'import_from_browser'
                });
                sendMessageSafely({
                    type: MessageType.AUTO_SYNC_BOOKMARK,
                }, (response) => {
                    if (response && response.error) {
                        showToast('书签同步失败: ' + response.error, true);
                    }
                });
            }
        } catch (error) {
            logger.error('导入失败:', error);
            showToast('导入失败: ' + error.message, true);
        }
    }

    // 导入单个书签
    async importBookmark(bookmark, parentPath) {
        const startTime = Date.now();
        try {
            // 构造书签数据
            logger.debug('开始导入书签', {
                bookmark,
                parentPath
            });
            const apiService = await ConfigManager.getActiveService();
            const tags = await generateTags({}, bookmark);
            const parentTitles = parentPath.map(p => p.title).filter(p => p);
            const folderTags = this.keepFolderTags.checked ? parentTitles.slice(1) : [];
            const finalTags = [...new Set([...folderTags, ...tags])];
            const embeddingText = makeEmbeddingText({}, bookmark, finalTags);
            const embedding = await getEmbedding(embeddingText);

            const bookmarkInfo = {
                url: bookmark.url,
                title: bookmark.title,
                tags: finalTags,
                excerpt: '',
                embedding: embedding,
                savedAt: new Date(bookmark.dateAdded).toISOString(),
                useCount: 0,
                lastUsed: new Date(bookmark.dateLastUsed || 0).toISOString(),
                apiService: apiService.id,
                embedModel: apiService.embedModel,
            };
            await LocalStorageMgr.setBookmark(bookmarkInfo.url, bookmarkInfo);
            await recordBookmarkChange(bookmarkInfo, false, false);
            this.importStats.imported++;
            logger.debug('导入的书签信息:', bookmarkInfo);
        } finally {
            const stats = await statsManager.loadStats();
            const inputTokens = stats.chat?.inputTokens || 0;
            const outputTokens = stats.chat?.outputTokens || 0;
            const embedTokens = stats.embedding?.tokens || 0;
            this.importStats.chatTokens = inputTokens + outputTokens - this.importStats.startChatTokens;
            this.importStats.embedTokens = embedTokens - this.importStats.startEmbedTokens;

            this.importStats.processedTimes.push(Date.now() - startTime);
        }
    }

    // 显示导入进度
    async showImportProgress(status) {
        const statusEl = this.importProgressDialog.querySelector('.progress-status');
        const progressFill = this.importProgressDialog.querySelector('.progress-fill');
        const progressCount = this.importProgressDialog.querySelector('.progress-count');
        const progressPercentage = this.importProgressDialog.querySelector('.progress-percentage');
        const logsList = this.importProgressDialog.querySelector('.logs-list');
        
        // 清空之前的日志
        logsList.innerHTML = '';
        
        statusEl.textContent = status;
        progressFill.style.width = '0%';
        progressCount.textContent = '0/0';
        progressPercentage.textContent = '0%';
        
        this.importProgressDialog.classList.add('show');
        await this.resetImportStats();
    }

    // 添加导入日志
    addImportLog(bookmark, success, error = '') {
        const logsList = this.importProgressDialog.querySelector('.logs-list');
        const logItem = document.createElement('div');
        logItem.className = `log-item ${success ? 'success' : 'error'}`;
        
        const logStatus = success ? '成功' : `${error}`;
        logItem.innerHTML = `
            <div class="log-title">
                <span class="title-text">
                    <svg class="bookmark-icon" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M17,3H7A2,2 0 0,0 5,5V21L12,18L19,21V5C19,3.89 18.1,3 17,3Z"/>
                    </svg>
                    ${bookmark.title || '未命名书签'}
                </span>
                <span class="log-status">
                    ${logStatus}
                </span>
            </div>
            <div class="log-url">${bookmark.url}</div>
        `;
        
        // 在列表顶部插入新日志
        logsList.insertBefore(logItem, logsList.firstChild);
    }

    // 修改更新导入进度方法
    updateImportProgress(current, total) {
        const percentage = Math.round((current / total) * 100);
        const statusEl = this.importProgressDialog.querySelector('.progress-status');
        const progressFill = this.importProgressDialog.querySelector('.progress-fill');
        const progressCount = this.importProgressDialog.querySelector('.progress-count');
        const progressPercentage = this.importProgressDialog.querySelector('.progress-percentage');
        
        // 如果导入已经开始
        if (current > 0) {
            const elapsedTime = Math.floor((Date.now() - this.importStats.startTime) / 1000);
            const estimatedTime = this.calculateEstimatedTime(current, total);
            
            statusEl.innerHTML = `
                <div class="progress-info">
                    <div>已导入: ${this.importStats.imported}/${total}</div>
                    <div>已用时: ${Math.floor(elapsedTime / 60)}分${elapsedTime % 60}秒</div>
                    <div>预计剩余: ${estimatedTime}</div>
                </div>
                <div class="tokens-info">
                    <div>Chat Tokens: ${this.importStats.chatTokens}</div>
                    <div>Embedding Tokens: ${this.importStats.embedTokens}</div>
                </div>
            `;
        }
        
        progressFill.style.width = `${percentage}%`;
        progressCount.textContent = `${current}/${total}`;
        progressPercentage.textContent = `${percentage}%`;
    }

    async handleExportLocal() {
        importExportManager.showExportDialog();
    }

    async handleImportLocal() {
        importExportManager.showImportDialog();
    }

    handleEscKey(e) {
        if (this.bookmarkSelectDialog.classList.contains('show')) {
            this.bookmarkSelectDialog.classList.remove('show');
        }
        if (this.importProgressDialog.classList.contains('show')) {
            this.importProgressDialog.classList.remove('show');
        }
        importExportManager.handleEscKey(e);
    }

    cleanup() {
        // 清理事件监听器
        this.importBrowserBtn.removeEventListener('click', this.handleImportBrowser);
        this.exportLocalBtn.removeEventListener('click', this.handleExportLocal);
        this.importLocalBtn.removeEventListener('click', this.handleImportLocal);
        this.selectAllCheckbox.removeEventListener('change', this.handleSelectAll);
        this.cancelImportBtn.removeEventListener('click', () => this.bookmarkSelectDialog.classList.remove('show'));
        this.confirmImportBtn.removeEventListener('click', this.handleConfirmImport);
        
        // 移除关闭按钮事件监听
        const closeBtn = this.importProgressDialog.querySelector('.close-dialog-btn');
        closeBtn.removeEventListener('click', this.handleCloseImportProgress);
    }

    // 处理关闭导入进度窗口
    handleCloseImportProgress() {
        this.importCancelled = true;
        this.importProgressDialog.classList.remove('show');
    }
}

class AboutSettingsTab extends BaseSettingsTab {
    constructor() {
        super();
        this.section = document.getElementById('about-section');
    }

    async initialize() {
        await this.updateVersionInfo();
    }

    async updateVersionInfo() {
        // 获取manifest.json中的版本号
        const manifest = chrome.runtime.getManifest();
        const versionElement = document.getElementById('current-version');
        if (versionElement) {
            versionElement.textContent = manifest.version;
        }
    }

    cleanup() {
        // 清理工作（如果需要）
    }
}

class SettingsUI {
    constructor() {
        this.navItems = document.querySelectorAll('.nav-item');
        this.sections = document.querySelectorAll('.settings-section');
        
        this.tabs = {
            overview: new OverviewSettingsTab(),
            services: new ServicesSettingsTab(),
            filters: new FilterSettingsTab(),
            'import-export': new ImportExportSettingsTab(),
            privacy: new PrivacySettingsTab(),
            about: new AboutSettingsTab() // 添加About页签
        };
    }

    async initialize() {
        this.initializeNavigation();
        this.updateVersionDisplay();
        this.initializeSidebarFooter();
        
        for (const tab of Object.values(this.tabs)) {
            await tab.initialize();
        }
        
        const hash = window.location.hash.slice(1) || 'overview';
        this.switchSection(hash);

        // 添加全局事件监听器
        window.addEventListener('keydown', this.handleEscKey.bind(this));
    }

    initializeNavigation() {
        this.navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const sectionId = item.getAttribute('data-section');
                this.switchSection(sectionId);
            });
        });
    }

    // 在初始化时添加获取和更新版本号的函数
    async updateVersionDisplay() {
        try {
            const manifest = chrome.runtime.getManifest();
            const versionElement = document.querySelector('.app-version');
            if (versionElement && manifest.version) {
                versionElement.textContent = `v${manifest.version}`;
            }
        } catch (error) {
            logger.error('获取版本号失败:', error);
        }
    }

    switchSection(sectionId) {
        this.navItems.forEach(item => {
            item.classList.toggle('active', 
                item.getAttribute('data-section') === sectionId);
        });

        Object.entries(this.tabs).forEach(([id, tab]) => {
            if (id === sectionId) {
                tab.show();
            } else {
                tab.hide();
            }
        });

        history.replaceState(null, null, `#${sectionId}`);
    }

    handleEscKey(e) {
        if (e.key === 'Escape') {
            Object.values(this.tabs).forEach(tab => {
                if (tab.handleEscKey) {
                    tab.handleEscKey(e);
                }
            });
        }
    }

    cleanup() {
        Object.values(this.tabs).forEach(tab => tab.cleanup());
    }

    initializeSidebarFooter() {
        const privacyLink = document.getElementById('privacy-policy-link');
        if (privacyLink) {
            privacyLink.addEventListener('click', (e) => {
                e.preventDefault();
                
                // 获取用户浏览器语言
                const userLang = navigator.language || navigator.userLanguage;
                const isZH = userLang.toLowerCase().includes('zh');
                
                // 构建URL
                const baseUrl = `${SERVER_URL}/privacy`;
                const url = isZH ? baseUrl : `${baseUrl}?lang=en`;
                
                // 在新标签页中打开
                window.open(url, '_blank');
            });
        }
        const changelogLink = document.getElementById('changelog-link');
        if (changelogLink) {
            changelogLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.open(`${SERVER_URL}/changelog`, '_blank');
            });
        }
        const feedbackLink = document.getElementById('feedback-link');
        if (feedbackLink) {
            feedbackLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.open(`${SERVER_URL}/feedback`, '_blank');
            });
        }
    }
}

// 在页面加载完成后调用此函数
document.addEventListener('DOMContentLoaded', async () => {
    logger.debug('开始初始化页面', Date.now()/1000);
    await customFilter.init();
    const settingsUI = new SettingsUI();
    window.settingsUI = settingsUI;
    await settingsUI.initialize();
    await Promise.all([
        LocalStorageMgr.setupListener(),
        SettingsManager.init(),
    ]);
    logger.debug('初始化页面完成', Date.now()/1000);
}); 

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    logger.debug('settings 收到消息', {message, sender});
    if (message.type === MessageType.SWITCH_TO_TAB) {
        const sectionId = message.tab;
        if (window.settingsUI) {    
            window.settingsUI.switchSection(sectionId);
        }
    } else if (message.type === MessageType.UPDATE_DOMAINS_LIST) {
        if (window.settingsUI) {
            window.settingsUI.tabs.privacy.renderDomainsList(message.data);
        }
    }
});