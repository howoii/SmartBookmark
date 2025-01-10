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
}

class OverviewSettingsTab extends BaseSettingsTab {
    constructor() {
        super();
        this.section = document.getElementById('overview-section');
        this.statusDiv = document.getElementById('loginStatus');
        this.actionDiv = document.getElementById('actionButtons');
        
        // 获取模板
        this.loggedInTemplate = document.getElementById('logged-in-template');
        this.loggedOutTemplate = document.getElementById('logged-out-template');
        
        // 绑定方法到实例
        this.checkLoginStatus = this.checkLoginStatus.bind(this);
        this.handleLogout = this.handleLogout.bind(this);
    }

    async initialize() {
        // 初始检查登录状态
        await this.checkLoginStatus();
        this.setupStorageListener();
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
        const {valid, user} = await validateToken();
        if (!valid) {
            this.showLoggedOutState();
            return;
        }
        this.showLoggedInState(user.email);
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
        loginLink.href = `${SERVER_URL}/login?return_url=${encodeURIComponent(chrome.runtime.getURL('settings.html'))}`;

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
        await LocalStorageMgr.remove(['token', 'user']);
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
        try {
            const settings = await SettingsManager.getAll();
            if (settings?.privacy?.customDomains) {
                this.renderDomainsList(settings.privacy.customDomains);
            }
        } catch (error) {
            logger.error('Failed to load settings:', error);
        }

        await this.bindEvents();
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

        document.addEventListener('keydown', this.handleEscKey);
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
        document.removeEventListener('keydown', this.handleEscKey);
    }
}

class ServicesSettingsTab extends BaseSettingsTab {
    constructor() {
        super();
        this.section = document.getElementById('services-section');
        this.serviceConfigDialog = document.getElementById('service-config-dialog');
        this.currentService = null;
        this.activeService = null;
        
        this.handleEscKey = this.handleEscKey.bind(this);
    }

    async initialize() {
        await this.initializeAPIServices();
        this.initializeServiceConfigDialog();
        await this.updateStatsUI();
    }

    async initializeAPIServices() {
        const serviceSelect = document.getElementById('active-service-select');
        const servicesGrid = document.querySelector('.api-services-grid');
        
        this.activeService = await ConfigManager.getActiveService();

        for (const [key, service] of Object.entries(API_SERVICES)) {
            const option = document.createElement('option');
            option.value = service.id;
            option.textContent = service.name;
            option.selected = service.id === this.activeService.id;
            serviceSelect.appendChild(option);
        }

        for (const service of Object.values(API_SERVICES)) {
            const apiKey = await ConfigManager.getAPIKey(service.id);
            const serviceCard = this.createServiceCard(service, apiKey);
            servicesGrid.appendChild(serviceCard);
        }

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

    createServiceCard(service, apiKey) {
        const card = document.createElement('div');
        card.className = 'service-card';
        card.setAttribute('data-service', service.id);
        
        const isActive = service.id === this.activeService?.id;
        
        card.innerHTML = `
            <div class="service-card-header">
                <div class="service-logo">
                    <img src="icons/${service.logo}" alt="${service.name}">
                </div>
                <div class="service-info">
                    <h3 class="service-name">${service.name}</h3>
                    <p class="service-description">${service.description || ''}</p>
                </div>
                <div class="service-status">
                    <div class="api-status ${apiKey ? 'configured' : ''}"></div>
                    <div class="status-toggle ${isActive ? 'active' : ''}"></div>
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            this.showServiceConfigDialog(service);
        });

        const img = card.querySelector('img');
        img.addEventListener('error', () => {
            img.src = 'icons/default_favicon.png';
        });

        return card;
    }

    // ServicesSettingsTab 类的继续
    initializeServiceConfigDialog() {
        const dialog = this.serviceConfigDialog;
        const apiKeyInput = dialog.querySelector('.service-api-key');
        const verifyIcon = dialog.querySelector('.verify-icon');
        
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
            if (!this.currentService) return;
            
            try {
                await ConfigManager.setAPIKey(this.currentService.id, apiKeyInput.value.trim());
                this.updateStatus(dialog.querySelector('.api-service-status'), '保存成功', 'success');
                this.updateServiceCardStatus(this.currentService.id, true);
                verifyIcon.classList.remove('success', 'error');

                // 检查是否有激活的API服务
                const activeApiKey = await ConfigManager.getAPIKey();
                if (!activeApiKey) {
                    await ConfigManager.setActiveService(this.currentService.id);
                    // 更新UI显示
                    this.updateActiveServiceUI(this.currentService.id);
                }
            } catch (error) {
                this.updateStatus(dialog.querySelector('.api-service-status'), error.message, 'error');
            }
        });
        
        dialog.querySelector('.verify-key').addEventListener('click', async () => {
            if (!this.currentService) return;
            
            try {
                await ConfigManager.verifyAPIKey(this.currentService.id, apiKeyInput.value.trim());
                this.updateStatus(dialog.querySelector('.api-service-status'), 'API Key 有效', 'success');
                verifyIcon.classList.add('success');
                verifyIcon.classList.remove('error');
            } catch (error) {
                this.updateStatus(dialog.querySelector('.api-service-status'), error.message, 'error');
                verifyIcon.classList.add('error');
                verifyIcon.classList.remove('success');
            }
        });
        
        dialog.querySelector('.close-dialog-btn').addEventListener('click', () => {
            this.closeServiceConfigDialog();
        });
    
        document.addEventListener('keydown', this.handleEscKey);
    }

    async showServiceConfigDialog(service) {
        this.currentService = service;
        const dialog = this.serviceConfigDialog;
        const apiKey = await ConfigManager.getAPIKey(service.id);
        
        dialog.querySelector('.service-name').textContent = `${service.name} 配置`;
        dialog.querySelector('.get-key-link').href = service.getKeyUrl;
        // 添加模型定价链接
        dialog.querySelector('.model-pricing-link').href = service.pricingUrl;
        
        const apiKeyInput = dialog.querySelector('.service-api-key');
        apiKeyInput.value = apiKey || '';
        
        dialog.querySelector('.api-service-status').textContent = '';
        dialog.querySelector('.verify-icon').classList.remove('success', 'error');

        // 更新模型信息
        const chatModelEl = dialog.querySelector('.chat-model');
        chatModelEl.textContent = service.chatModel;
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
        setTimeout(() => {
            element.textContent = '';
            element.className = 'api-service-status';
        }, 3000);
    }

    updateActiveService(serviceId) {
        document.querySelectorAll('.service-card').forEach(card => {
            const toggle = card.querySelector('.status-toggle');
            if (card.getAttribute('data-service') === serviceId) {
                toggle.classList.add('active');
            } else {
                toggle.classList.remove('active');
            }
        });
    }

    handleEscKey(e) {
        if (e.key === 'Escape' && this.serviceConfigDialog.classList.contains('show')) {
            this.closeServiceConfigDialog();
        }
    }

    cleanup() {
        document.removeEventListener('keydown', this.handleEscKey);
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
    }

    async initialize() {
        // 绑定事件
        this.addFilterBtn.addEventListener('click', () => this.showFilterDialog());
        this.addConditionBtn.addEventListener('click', this.handleAddCondition);
        this.saveFilterBtn.addEventListener('click', () => this.saveFilter());
        this.cancelFilterBtn.addEventListener('click', () => this.hideFilterDialog());
        this.closeDialogBtn.addEventListener('click', () => this.hideFilterDialog());
        
        // 初始加载规则列表
        await this.loadFiltersList();
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

class SettingsUI {
    constructor() {
        this.navItems = document.querySelectorAll('.nav-item');
        this.sections = document.querySelectorAll('.settings-section');
        
        this.tabs = {
            privacy: new PrivacySettingsTab(),
            services: new ServicesSettingsTab(),
            overview: new OverviewSettingsTab(),
            filters: new FilterSettingsTab() // 添加新的 tab
        };

        this.initialize();
    }

    async initialize() {
        this.initializeNavigation();
        this.updateVersionDisplay();
        // 初始化隐私政策链接
        this.initializePrivacyPolicyLink();
        
        for (const tab of Object.values(this.tabs)) {
            await tab.initialize();
        }
        
        const hash = window.location.hash.slice(1) || 'overview';
        this.switchSection(hash);
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

    cleanup() {
        Object.values(this.tabs).forEach(tab => tab.cleanup());
    }

    initializePrivacyPolicyLink() {
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
    }
}

// 在页面加载完成后调用此函数
document.addEventListener('DOMContentLoaded', async () => {
    await customFilter.init();
    const settingsUI = new SettingsUI();
    window.settingsUI = settingsUI;
}); 

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    logger.debug('settings 收到消息', {message, sender});
    if (message.type === 'SWITCH_TO_TAB') {
        const sectionId = message.tab;
        if (window.settingsUI) {    
            window.settingsUI.switchSection(sectionId);
        }
    } else if (message.type === "UPDATE_DOMAINS_LIST") {
        if (window.settingsUI) {
            window.settingsUI.tabs.privacy.renderDomainsList(message.data);
        }
    }
});